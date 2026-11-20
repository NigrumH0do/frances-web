"""Sesión, CSRF, Origin y límite de intentos de login (plan SRV-04, plan maestro v2).

Ninguna función de este módulo lee ``os.environ``: el origen público llega por
``ApiContext.settings`` (``public_origin``). Los tokens y cookies nunca se registran.
"""

import hmac
import sqlite3
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, Request, Response

from frances.accounts.repo import lookup_session, touch_session
from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.config import public_origin
from frances.models.accounts import Role

#: Rutas `/api/*` sin sesión. Lista cerrada: agregar una es un CHG (R-33).
PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/health"),
        ("GET", "/api/auth/providers"),
        ("GET", "/api/auth/google/start"),
        ("GET", "/api/auth/google/callback"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/invite/check"),
        ("POST", "/api/auth/invite/accept"),
    }
)

SESSION_COOKIE = "__Host-frances_session"
CSRF_COOKIE = "__Host-frances_csrf"
CSRF_HEADER = "X-CSRF-Token"

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_WINDOW_S = 60.0
_PURGE_EVERY = 512  # llamadas entre purgas de claves vencidas
_MAX_KEYS = 50_000  # tope duro de claves en memoria
_CSRF_MESSAGE = "Petición rechazada por seguridad."


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    display_name: str
    role: Role
    session_sha256: str
    csrf_token: str


class LoginLimiter:
    """Ventana deslizante de 60 s por clave (``ip:<ip>`` o ``email:<correo>``).

    Vive en memoria del proceso ``api`` (R-37): se pierde al reiniciar, lo que se acepta.
    """

    def __init__(
        self,
        per_minute: int,
        clock: Callable[[], float],
        *,
        purge_every: int = _PURGE_EVERY,
        max_keys: int = _MAX_KEYS,
    ) -> None:
        self._limit = per_minute
        self._clock = clock
        self._purge_every = purge_every
        self._max_keys = max_keys
        self._calls = 0
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        """Registra un intento. False si la clave ya agotó su cupo en la ventana."""
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
                self._hits[key] = window  # al final del dict: la usada más recientemente
                self._enforce_cap()
            return allowed

    def allows(self, key: str) -> bool:
        """Consulta sin registrar: True si la clave aún tiene cupo en la ventana."""
        with self._lock:
            window = self._hits.get(key)
            if window is None:
                return self._limit > 0
            self._trim(window, self._clock())
            if not window:
                del self._hits[key]
                return self._limit > 0
            return len(window) < self._limit

    @staticmethod
    def _trim(window: deque[float], now: float) -> None:
        while window and now - window[0] >= _WINDOW_S:
            window.popleft()

    def _purge_expired(self, now: float) -> None:
        for key in list(self._hits):
            window = self._hits[key]
            self._trim(window, now)
            if not window:
                del self._hits[key]

    def _enforce_cap(self) -> None:
        while len(self._hits) > self._max_keys:
            del self._hits[next(iter(self._hits))]  # la clave menos usada recientemente


_limiter_lock = threading.Lock()


def login_limiter(request: Request) -> LoginLimiter:
    """Una instancia por app, creada al primer uso con ``server.login_max_per_minute``."""
    with _limiter_lock:
        limiter: LoginLimiter | None = getattr(request.app.state, "login_limiter", None)
        if limiter is None:
            ctx = get_ctx(request)
            limiter = LoginLimiter(
                per_minute=ctx.settings.server.login_max_per_minute, clock=time.monotonic
            )
            request.app.state.login_limiter = limiter
    return limiter


def normalize_origin(raw: str) -> str | None:
    """``esquema://host[:puerto]`` en minúsculas, sin puerto por defecto ni ``?``/``#`` vacíos.

    Devuelve None si no es un origen web válido (sin usuario, con path o con query no vacía).
    """
    try:
        parts = urlsplit(raw.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if scheme not in ("http", "https") or not host:
        return None
    if parts.username is not None or parts.password is not None:
        return None
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        return None
    if port is None or (scheme == "https" and port == 443) or (scheme == "http" and port == 80):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def _same_origin(received: str, expected: str) -> bool:
    got = normalize_origin(received)
    want = normalize_origin(expected)
    if got is None or want is None:
        return False
    return hmac.compare_digest(got.encode("utf-8"), want.encode("utf-8"))


def _expected_origin(request: Request) -> str:
    return public_origin(get_ctx(request).settings)


def check_public_origin(request: Request) -> None:
    """Para POST públicos (sin sesión): ``Origin`` obligatorio e igual al origen público."""
    received = request.headers.get("origin")
    if received is None or not _same_origin(received, _expected_origin(request)):
        raise ApiErrorResponse(403, "csrf", _CSRF_MESSAGE)


def set_session_cookies(response: Response, token: str, csrf: str, max_age_s: int) -> None:
    """Sesión: HttpOnly. CSRF: legible por JS para copiarlo al header. Ambas Secure, sin Domain."""
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age_s,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        max_age=max_age_s,
        path="/",
        secure=True,
        httponly=False,
        samesite="lax",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=True, httponly=False, samesite="lax")


def require_user(
    request: Request,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> CurrentUser:
    """Sesión válida o 401 ``unauthenticated``. Métodos no seguros: Origin y CSRF o 403 ``csrf``."""
    ctx = get_ctx(request)
    now = ctx.now()
    token = request.cookies.get(SESSION_COOKIE)
    row = lookup_session(conn, token, now) if token else None
    if row is None:
        raise ApiErrorResponse(401, "unauthenticated", "Inicia sesión para continuar.")

    if request.method not in _SAFE_METHODS:
        received = request.headers.get("origin")
        if received is not None and not _same_origin(received, _expected_origin(request)):
            raise ApiErrorResponse(403, "csrf", _CSRF_MESSAGE)
        header = request.headers.get(CSRF_HEADER)
        if header is None or not hmac.compare_digest(
            header.encode("utf-8"), row.csrf_token.encode("utf-8")
        ):
            raise ApiErrorResponse(403, "csrf", _CSRF_MESSAGE)

    ttl = session_ttl(ctx)
    touch_session(conn, row.token_sha256, ttl, now)
    return CurrentUser(
        id=row.user.id,
        email=row.user.email,
        display_name=row.user.display_name,
        role=row.user.role,
        session_sha256=row.token_sha256,
        csrf_token=row.csrf_token,
    )


def require_admin(user: Annotated[CurrentUser, Depends(require_user)]) -> CurrentUser:
    if user.role != "admin":
        raise ApiErrorResponse(403, "forbidden", "No tienes permiso para esta acción.")
    return user


def session_ttl(ctx: ApiContext) -> timedelta:
    return timedelta(days=ctx.settings.server.session_ttl_days)
