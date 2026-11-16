"""`POST /api/speech/token`: token de Azure Speech de corta vida para el navegador (SRV-10).

La clave de Azure se queda en el servidor (R-42): el navegador solo recibe un token de
10 minutos. El token se cachea 8 minutos por región y cada usuario tiene 30 peticiones por
hora. Red sin respuesta o respuesta no-200 → 503 ``speech_unavailable``.
"""

import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Request

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_ctx
from frances.api.security import CurrentUser, require_user
from frances.errors import ConfigError
from frances.log import get_logger, redact
from frances.models.api import SpeechToken
from frances.timeutil import format_ts

ISSUE_URL = "https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
TOKEN_TTL_S = 600
CACHE_S = 480
PER_USER_PER_HOUR = 30

_log = get_logger(__name__)

_UNAVAILABLE = "El servicio de voz no está disponible."
_RATE_LIMITED = "Demasiadas peticiones de voz. Espera un poco y vuelve a intentarlo."
_WINDOW_S = 3600.0
_PURGE_EVERY = 512
_MAX_KEYS = 10_000


class TokenIssuer:
    """Pide tokens a Azure y los cachea ``CACHE_S`` segundos por región.

    ``clock`` devuelve segundos epoch: el valor de emisión se usa tanto para la caché
    como para calcular ``expires_at``. El cliente lo inyecta la app (``httpx.Client``).
    """

    def __init__(self, client: httpx.Client, clock: Callable[[], float]) -> None:
        self._client = client
        self._clock = clock
        self._cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def get(self, region: str, key: str) -> tuple[str, float]:
        """Devuelve ``(token, emitido_en)``; reusa la caché si aún es válida."""
        with self._lock:
            now = self._clock()
            cached = self._cache.get(region)
            if cached is not None and now - cached[1] < CACHE_S:
                return cached
            try:
                response = self._client.post(
                    ISSUE_URL.format(region=region),
                    headers={"Ocp-Apim-Subscription-Key": key},
                    content=b"",
                    timeout=10.0,
                )
            except httpx.HTTPError as exc:
                # Sin cuerpo de la respuesta ni cabeceras: el cuerpo puede traer la clave.
                _log.warning("Azure Speech no disponible: %s", redact(str(exc)))
                raise ApiErrorResponse(503, "speech_unavailable", _UNAVAILABLE) from exc
            if response.status_code != 200:
                _log.warning("Azure Speech devolvió %s", response.status_code)
                raise ApiErrorResponse(503, "speech_unavailable", _UNAVAILABLE)
            token = response.text.strip()
            if not token:
                _log.warning("Azure Speech devolvió un token vacío")
                raise ApiErrorResponse(503, "speech_unavailable", _UNAVAILABLE)
            issued_at = self._clock()
            self._cache[region] = (token, issued_at)
            return token, issued_at


class _PerUserLimiter:
    """Ventana deslizante por usuario con purga periódica y tope duro de claves."""

    def __init__(
        self,
        limit: int,
        clock: Callable[[], float],
        *,
        window_s: float = _WINDOW_S,
        purge_every: int = _PURGE_EVERY,
        max_keys: int = _MAX_KEYS,
    ) -> None:
        self._limit = limit
        self._clock = clock
        self._window_s = window_s
        self._purge_every = purge_every
        self._max_keys = max_keys
        self._calls = 0
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        """Registra la petición. False si el usuario agotó su cupo en la ventana."""
        with self._lock:
            now = self._clock()
            self._calls += 1
            if self._calls % self._purge_every == 0:
                self._purge_expired(now)
            window = self._hits.pop(key, None)
            if window is None:
                window = deque()
            self._trim(window, now)
            allowed = len(window) < self._limit
            if allowed:
                window.append(now)
            if window:
                self._hits[key] = window
                self._enforce_cap()
            return allowed

    def _trim(self, window: deque[float], now: float) -> None:
        while window and now - window[0] >= self._window_s:
            window.popleft()

    def _purge_expired(self, now: float) -> None:
        for key in list(self._hits):
            self._trim(self._hits[key], now)
            if not self._hits[key]:
                del self._hits[key]

    def _enforce_cap(self) -> None:
        while len(self._hits) > self._max_keys:
            del self._hits[next(iter(self._hits))]


router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_state_lock = threading.Lock()


def _issuer(request: Request) -> TokenIssuer:
    """Instancia única por app, creada al primer uso (``app.state.speech_issuer``)."""
    with _state_lock:
        issuer: TokenIssuer | None = getattr(request.app.state, "speech_issuer", None)
        if issuer is None:
            issuer = TokenIssuer(httpx.Client(trust_env=False), time.time)
            request.app.state.speech_issuer = issuer
    return issuer


def _limiter(request: Request) -> _PerUserLimiter:
    """Límite por usuario del proceso api (``app.state.speech_rate_limiter``)."""
    with _state_lock:
        limiter: _PerUserLimiter | None = getattr(request.app.state, "speech_rate_limiter", None)
        if limiter is None:
            limiter = _PerUserLimiter(PER_USER_PER_HOUR, time.monotonic)
            request.app.state.speech_rate_limiter = limiter
    return limiter


@router.post("/speech/token", response_model=SpeechToken)
def issue_token(
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
) -> SpeechToken:
    """Emite un token de Azure para el navegador; nunca devuelve la clave."""
    try:
        key = ctx.settings.secret("AZURE_SPEECH_KEY")
        region = ctx.settings.secret("AZURE_SPEECH_REGION")
    except ConfigError as exc:
        _log.error("falta la configuración de Azure Speech")
        raise ApiErrorResponse(503, "speech_unavailable", _UNAVAILABLE) from exc

    if not _limiter(request).hit(user.id):
        raise ApiErrorResponse(429, "rate_limited", _RATE_LIMITED)

    token, issued_at = _issuer(request).get(region, key)
    expires_at = datetime.fromtimestamp(issued_at, UTC) + timedelta(seconds=TOKEN_TTL_S)
    return SpeechToken(
        token=token,
        region=region,
        locale="fr-FR",
        expires_at=format_ts(expires_at),
    )
