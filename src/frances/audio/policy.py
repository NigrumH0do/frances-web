"""Política de voces y planificación de clips de audio (AUD-02, CHG-18)."""

import hashlib
import json
import sqlite3
from collections.abc import Sequence
from typing import Literal

from frances.audio.cachekey import audio_request
from frances.audio.repo import insert_pending, link_card_audio, prune_card_audio
from frances.config import Settings
from frances.db.store import Store
from frances.models.audio import Voice
from frances.models.content import CardKind

DEFAULT_VOICES_KEY = "audio.default_voice_ids"


def load_default_voice_ids(conn: sqlite3.Connection) -> list[str] | None:
    """Voces por defecto guardadas en `app_settings`; `None` si faltan o no son válidas."""
    row = conn.execute(
        "SELECT value_json FROM app_settings WHERE key = ?", (DEFAULT_VOICES_KEY,)
    ).fetchone()
    if row is None:
        return None
    try:
        value = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    if not isinstance(value, list):
        return None
    voice_ids: list[str] = []
    for item in value:
        if not isinstance(item, str):
            return None
        voice_ids.append(item)
    return voice_ids


def save_default_voice_ids(
    conn: sqlite3.Connection,
    voice_ids: Sequence[str],
    updated_by: str,
    now: str,
) -> None:
    """UPSERT de `audio.default_voice_ids` en `app_settings`."""
    conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?,?,?,?)"
        " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,"
        " updated_by = excluded.updated_by, updated_at = excluded.updated_at",
        (DEFAULT_VOICES_KEY, json.dumps(list(voice_ids)), updated_by, now),
    )


def _effective_fixed_ids(settings: Settings, fixed_voice_ids: Sequence[str] | None) -> list[str]:
    """Lista efectiva de fijas: la guardada si no está vacía, si no la config."""
    if fixed_voice_ids:
        return list(fixed_voice_ids)
    return list(settings.audio.fixed_voices)


def _fixed_enabled(
    voices: list[Voice], settings: Settings, fixed_voice_ids: Sequence[str] | None
) -> list[Voice]:
    """Fijas habilitadas en el orden efectivo; inexistentes se ignoran."""
    by_id = {v.id: v for v in voices}
    out: list[Voice] = []
    for voice_id in _effective_fixed_ids(settings, fixed_voice_ids):
        voice = by_id.get(voice_id)
        if voice is not None and voice.enabled:
            out.append(voice)
    return out


def _rotating_pool(
    voices: list[Voice], settings: Settings, fixed_voice_ids: Sequence[str] | None
) -> list[Voice]:
    """Habilitadas fuera de las fijas efectivas, ordenadas por id."""
    fixed = set(_effective_fixed_ids(settings, fixed_voice_ids))
    return sorted((v for v in voices if v.enabled and v.id not in fixed), key=lambda v: v.id)


def voices_for(
    card_id: str,
    kind: CardKind,
    field: Literal["front", "example"],
    voices: list[Voice],
    settings: Settings,
    *,
    fixed_voice_ids: Sequence[str] | None = None,
) -> list[Voice]:
    """Elige las voces para un campo de una tarjeta."""
    if field == "example":
        return _fixed_enabled(voices, settings, fixed_voice_ids)[:1]
    if kind == "drill":
        return sorted((v for v in voices if v.enabled), key=lambda v: v.id)
    fixed = _fixed_enabled(voices, settings, fixed_voice_ids)
    pool = _rotating_pool(voices, settings, fixed_voice_ids)
    if not pool or settings.audio.rotating <= 0:
        return list(fixed)
    start = int(hashlib.sha256(card_id.encode()).hexdigest(), 16) % len(pool)
    count = min(settings.audio.rotating, len(pool))
    rot = [pool[(start + i) % len(pool)] for i in range(count)]
    return [*fixed, *rot]


def plan_audio(store: Store, voices: list[Voice], settings: Settings, now: str) -> int:
    """Crea pendientes y enlaces para tarjetas no stale; devuelve filas nuevas."""
    fixed_voice_ids = load_default_voice_ids(store.conn)
    created = 0
    with store.tx() as conn:
        cards = conn.execute(
            "SELECT id, kind, front_fr, example_fr FROM cards WHERE stale = 0"
        ).fetchall()
        for card_id, kind, front_fr, example_fr in cards:
            front_voices = voices_for(
                card_id,
                kind,
                "front",
                voices,
                settings,
                fixed_voice_ids=fixed_voice_ids,
            )
            front_keys: set[str] = set()
            for voice in front_voices:
                req = audio_request(front_fr, voice)
                if insert_pending(conn, req, now):
                    created += 1
                link_card_audio(conn, card_id, "front", req.cache_key)
                front_keys.add(req.cache_key)
            prune_card_audio(conn, card_id, "front", front_keys)
            example_keys: set[str] = set()
            if example_fr:
                for voice in voices_for(
                    card_id,
                    kind,
                    "example",
                    voices,
                    settings,
                    fixed_voice_ids=fixed_voice_ids,
                ):
                    req = audio_request(example_fr, voice)
                    if insert_pending(conn, req, now):
                        created += 1
                    link_card_audio(conn, card_id, "example", req.cache_key)
                    example_keys.add(req.cache_key)
            prune_card_audio(conn, card_id, "example", example_keys)
    return created
