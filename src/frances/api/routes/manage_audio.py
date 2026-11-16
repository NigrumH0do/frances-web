"""Admin de audio (MGT-02): cola, regeneración y voces por defecto.

Todas las rutas exigen ``role == "admin"`` (``require_admin``). Las escrituras
solo validan y encolan: la síntesis corre en el worker. La cola se sirve con
``JobOut`` y nunca expone ``payload`` ni ``result`` (Review Focus 6).
"""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from frances.api.app import ApiContext
from frances.api.cards_repo import enabled_voices
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import CurrentUser, require_admin
from frances.audio.policy import load_default_voice_ids
from frances.jobs.queue import list_jobs, to_out
from frances.manage.audio import (
    queue_audio_regeneration,
    set_default_voices,
    validate_default_voices,
)
from frances.models.bundle import VoiceOut
from frances.models.jobs import JobKind, JobOut
from frances.models.manage import DefaultVoicesIn
from frances.timeutil import format_ts

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

_CACHE_KEY_PATTERN = r"^[0-9a-f]{32}$"
_NOT_FOUND = "No existe."
_BAD_REQUEST = "Datos no válidos."
_AUDIO_KIND: JobKind = "audio.regenerate"


@router.get("/audio/queue", response_model=list[JobOut])
def audio_queue(conn: Annotated[sqlite3.Connection, Depends(get_conn)]) -> list[JobOut]:
    """Los 50 trabajos de audio más recientes, sin payload ni resultado."""
    return [to_out(job) for job in list_jobs(conn, kind=_AUDIO_KIND, limit=50)]


@router.post("/audio/{cache_key}/regenerate", response_model=JobOut, status_code=202)
def regenerate_audio(
    cache_key: Annotated[str, Path(pattern=_CACHE_KEY_PATTERN)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> JobOut:
    """Encola la regeneración de un clip existente (deduplicada por clave)."""
    row = conn.execute("SELECT 1 FROM audio WHERE cache_key = ?", (cache_key,)).fetchone()
    if row is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return queue_audio_regeneration(
        conn,
        {"cache_keys": [cache_key]},
        f"audio.regenerate:{cache_key}",
        ctx.now(),
    )


@router.put("/voices/default", response_model=list[VoiceOut])
def put_default_voices(
    body: DefaultVoicesIn,
    user: Annotated[CurrentUser, Depends(require_admin)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[VoiceOut]:
    """Guarda las voces por defecto; si cambian, encola la regeneración global."""
    enabled = enabled_voices(ctx.paths)
    try:
        voices = validate_default_voices(body.voice_ids, enabled)
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None
    if load_default_voice_ids(conn) != list(body.voice_ids):
        now = ctx.now()
        set_default_voices(conn, [voice.id for voice in voices], enabled, user.id, format_ts(now))
        queue_audio_regeneration(conn, {"scope": "all"}, "audio.regenerate:all", now)
    return voices
