"""`POST /api/practice/tts`: audio modelo de un texto libre del usuario (PRACTICE-01).

El usuario escribe una frase y la oye con una voz del registro. La clave sale de
``audio_request`` (la misma de las tarjetas), así que una frase que ya existe como
tarjeta reusa su clip. La síntesis corre dentro de la petición: la práctica es
interactiva y la cola del worker puede estar ocupada con el pipeline (ADR-018).

Una clave ya hecha se devuelve sin red ni cupo. Cada usuario sintetiza a lo sumo
``PER_USER_PER_HOUR`` clips nuevos por hora. El texto nunca va a los logs ni a los
mensajes de error: solo la clave, que es un hash.
"""

import re
import sqlite3
import threading
import time
import unicodedata
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from frances.api.app import ApiContext
from frances.api.cards_repo import audio_for_download
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.routes.speech import _PerUserLimiter
from frances.api.security import CurrentUser, require_user
from frances.audio.cachekey import audio_request
from frances.audio.repo import insert_pending, reset_for_regeneration
from frances.audio.run import run_audio_keys
from frances.audio.voices import load_voices
from frances.db.store import Store
from frances.log import get_logger
from frances.models.api import PracticeTtsIn, PracticeTtsOut
from frances.models.audio import Voice
from frances.stage import StageContext
from frances.timeutil import format_ts

PER_USER_PER_HOUR = 120

_log = get_logger(__name__)

_BAD_REQUEST = "Escribe una frase en francés con al menos una letra."
_BAD_VOICE = "Esa voz no está disponible."
_RATE_LIMITED = "Llegaste al límite de audios nuevos por hora. Vuelve a intentarlo en un rato."
_UNAVAILABLE = "No se pudo generar el audio ahora. Vuelve a intentarlo."

_SPACES = re.compile(r"\s+")

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_state_lock = threading.Lock()
_synth_semaphore = threading.Semaphore(2)
_SYNTH_ACQUIRE_TIMEOUT_S = 6.0


def clean_practice_text(text: str) -> str:
    """NFC, espacios (tabs y saltos incluidos) colapsados a uno y sin extremos."""
    return _SPACES.sub(" ", unicodedata.normalize("NFC", text)).strip()


def _limiter(request: Request) -> _PerUserLimiter:
    """Límite por usuario del proceso api (``app.state.practice_rate_limiter``)."""
    with _state_lock:
        limiter: _PerUserLimiter | None = getattr(request.app.state, "practice_rate_limiter", None)
        if limiter is None:
            limiter = _PerUserLimiter(PER_USER_PER_HOUR, time.monotonic)
            request.app.state.practice_rate_limiter = limiter
    return limiter


def _enabled_voice(ctx: ApiContext, voice_id: str) -> Voice:
    for voice in load_voices(ctx.paths):
        if voice.id == voice_id and voice.enabled:
            return voice
    raise ApiErrorResponse(400, "bad_request", _BAD_VOICE)


def _synthesize(ctx: ApiContext, cache_key: str) -> None:
    """Sintetiza un clip ``pending`` con su propia conexión, fuera de toda transacción."""
    if not _synth_semaphore.acquire(timeout=_SYNTH_ACQUIRE_TIMEOUT_S):
        raise ApiErrorResponse(503, "tts_unavailable", _UNAVAILABLE)
    store: Store | None = None
    try:
        store = Store.connect(ctx.db_path)
        stage = StageContext(
            settings=ctx.settings,
            paths=ctx.paths,
            store=store,
            env=ctx.env,
            now=ctx.now,
        )
        run_audio_keys(stage, [cache_key])
    finally:
        if store is not None:
            store.close()
        _synth_semaphore.release()


def _ready(
    conn: sqlite3.Connection, ctx: ApiContext, cache_key: str, text: str, voice_id: str
) -> PracticeTtsOut | None:
    found = audio_for_download(conn, cache_key, ctx.paths)
    if found is None:
        return None
    path, duration_ms = found
    if not path.is_file():
        return None
    return PracticeTtsOut(
        cache_key=cache_key,
        text=text,
        voice_id=voice_id,
        status="done",
        url=f"/api/audio/{cache_key}",
        duration_ms=duration_ms,
    )


@router.post("/practice/tts", response_model=PracticeTtsOut)
def practice_tts(
    body: PracticeTtsIn,
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> PracticeTtsOut:
    """Devuelve el clip del texto; si no existe lo sintetiza en la misma petición."""
    text = clean_practice_text(body.text)
    if not any(char.isalpha() for char in text):
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST)
    voice = _enabled_voice(ctx, body.voice_id)
    req = audio_request(text, voice)

    ready = _ready(conn, ctx, req.cache_key, text, voice.id)
    if ready is not None:
        return ready

    if not _limiter(request).hit(user.id):
        raise ApiErrorResponse(429, "rate_limited", _RATE_LIMITED)

    now = format_ts(ctx.now())
    if not insert_pending(conn, req, now):
        reset_for_regeneration(conn, req.cache_key, now)

    try:
        _synthesize(ctx, req.cache_key)
    except ApiErrorResponse:
        raise
    except Exception as exc:
        # Solo el tipo y la clave: el mensaje puede traer el texto del usuario.
        _log.warning(
            "práctica: falló la síntesis del clip %s (%s)", req.cache_key, type(exc).__name__
        )
        raise ApiErrorResponse(503, "tts_unavailable", _UNAVAILABLE) from None

    ready = _ready(conn, ctx, req.cache_key, text, voice.id)
    if ready is None:
        _log.warning("práctica: el clip %s no quedó listo", req.cache_key)
        raise ApiErrorResponse(503, "tts_unavailable", _UNAVAILABLE)
    return ready
