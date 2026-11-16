"""Lógica de gestión de audio (MGT-02): voces por defecto y regeneración dirigida.

Estas funciones solo escriben en SQLite y planifican clips; ninguna sintetiza
audio ni hace red. La síntesis corre en el worker (MGT-04) y la clave de cada
clip se arma siempre con ``audio_request`` (AUD-02).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from datetime import datetime

from frances.audio.cachekey import audio_request
from frances.audio.policy import (
    load_default_voice_ids,
    save_default_voice_ids,
    voices_for,
)
from frances.audio.repo import insert_pending, link_card_audio, prune_card_audio
from frances.audio.voices import load_voices
from frances.jobs.queue import enqueue, get_job, to_out
from frances.models.bundle import VoiceOut
from frances.models.jobs import JobOut
from frances.stage import StageContext
from frances.timeutil import format_ts


def validate_default_voices(
    voice_ids: Sequence[str], enabled: Sequence[VoiceOut]
) -> list[VoiceOut]:
    """Valida las voces por defecto y las devuelve en el orden pedido.

    ``ValueError`` si la lista está vacía, trae duplicados o ids vacíos, o pide
    una voz que no está en ``enabled`` (desconocida o deshabilitada).
    """
    if not voice_ids:
        raise ValueError("se requiere al menos una voz por defecto")
    by_id = {voice.id: voice for voice in enabled}
    seen: set[str] = set()
    out: list[VoiceOut] = []
    for voice_id in voice_ids:
        if not voice_id or voice_id.strip() != voice_id:
            raise ValueError(f"voz inválida: {voice_id!r}")
        if voice_id in seen:
            raise ValueError(f"voz duplicada: {voice_id!r}")
        voice = by_id.get(voice_id)
        if voice is None:
            raise ValueError(f"voz desconocida o deshabilitada: {voice_id!r}")
        seen.add(voice_id)
        out.append(voice)
    return out


def set_default_voices(
    conn: sqlite3.Connection,
    voice_ids: Sequence[str],
    enabled: Sequence[VoiceOut],
    updated_by: str,
    now: str,
) -> list[VoiceOut]:
    """Valida y guarda ``audio.default_voice_ids``; no toca clips existentes."""
    voices = validate_default_voices(voice_ids, enabled)
    save_default_voice_ids(conn, [voice.id for voice in voices], updated_by, now)
    return voices


def plan_audio_for_cards(ctx: StageContext, card_ids: Sequence[str]) -> list[str]:
    """Planifica front/example de esas tarjetas y devuelve claves no ``done``.

    Solo mira tarjetas vivas (``stale = 0`` y ``removed_at IS NULL``), usa las
    voces por defecto guardadas y poda los enlaces por campo. Nunca sintetiza ni
    hace red: los clips quedan ``pending`` para el worker.
    """
    ids = sorted(set(card_ids))
    if not ids:
        return []
    voices = load_voices(ctx.paths)
    now = format_ts(ctx.now())
    planned: set[str] = set()
    placeholders = ",".join("?" for _ in ids)
    with ctx.store.tx() as conn:
        fixed_voice_ids = load_default_voice_ids(conn)
        rows = conn.execute(
            "SELECT id, kind, front_fr, example_fr FROM cards"
            f" WHERE id IN ({placeholders}) AND stale = 0 AND removed_at IS NULL",
            tuple(ids),
        ).fetchall()
        for card_id, kind, front_fr, example_fr in rows:
            front_keys: set[str] = set()
            for voice in voices_for(
                card_id,
                kind,
                "front",
                voices,
                ctx.settings,
                fixed_voice_ids=fixed_voice_ids,
            ):
                req = audio_request(front_fr, voice)
                insert_pending(conn, req, now)
                link_card_audio(conn, card_id, "front", req.cache_key)
                front_keys.add(req.cache_key)
            prune_card_audio(conn, card_id, "front", front_keys)
            planned.update(front_keys)
            example_keys: set[str] = set()
            if example_fr:
                for voice in voices_for(
                    card_id,
                    kind,
                    "example",
                    voices,
                    ctx.settings,
                    fixed_voice_ids=fixed_voice_ids,
                ):
                    req = audio_request(example_fr, voice)
                    insert_pending(conn, req, now)
                    link_card_audio(conn, card_id, "example", req.cache_key)
                    example_keys.add(req.cache_key)
            prune_card_audio(conn, card_id, "example", example_keys)
            planned.update(example_keys)
        if not planned:
            return []
        key_placeholders = ",".join("?" for _ in planned)
        statuses = conn.execute(
            f"SELECT cache_key, status FROM audio WHERE cache_key IN ({key_placeholders})",
            tuple(sorted(planned)),
        ).fetchall()
    return sorted(str(cache_key) for cache_key, status in statuses if status != "done")


def queue_audio_regeneration(
    conn: sqlite3.Connection,
    payload: Mapping[str, object],
    dedupe_key: str,
    now: datetime,
) -> JobOut:
    """Encola ``audio.regenerate`` (deduplicado) y devuelve su vista pública."""
    job_id = enqueue(conn, "audio.regenerate", payload, now=now, dedupe_key=dedupe_key)
    job = get_job(conn, job_id)
    assert job is not None  # enqueue siempre deja una fila
    return to_out(job)
