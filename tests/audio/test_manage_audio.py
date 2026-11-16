"""Tests de audio v2: voces por defecto en `app_settings` y regeneración dirigida (CHG-18)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from frances.audio.cachekey import audio_request
from frances.audio.policy import (
    DEFAULT_VOICES_KEY,
    load_default_voice_ids,
    plan_audio,
    save_default_voice_ids,
    voices_for,
)
from frances.audio.repo import (
    link_card_audio,
    reset_for_regeneration,
    select_by_keys,
)
from frances.audio.run import EngineSet, run_audio_keys
from frances.config import Settings
from frances.db.store import Store
from frances.models.audio import Voice
from frances.stage import StageContext, make_context
from frances.textnorm import tts_norm

NOW = "2026-11-06T15:00:00.000000Z"
NOW2 = "2026-11-06T16:00:00.000000Z"
KEY_A = "a" * 32
KEY_B = "b" * 32
KEY_C = "c" * 32
VOICE = "fr-FR-DeniseNeural"


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    s = Store.open(tmp_path / "manage_audio.db")
    with s.tx() as conn:
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
            " VALUES ('u_admin', 'admin@example.test', 'Admin', 'x', 'admin', ?)",
            (NOW,),
        )
    yield s
    s.close()


@pytest.fixture
def voices() -> list[Voice]:
    return [
        _voice("fr-FR-DeniseNeural"),
        _voice("fr-FR-HenriNeural"),
        _voice("fr-FR-VivienneMultilingualNeural"),
    ]


@pytest.fixture
def settings() -> Settings:
    return Settings()


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[StageContext]:
    context = make_context(tmp_path / "data", env={})
    monkeypatch.setattr("frances.audio.run._sleep", _no_sleep)
    yield context
    context.store.close()


def _voice(voice_id: str, enabled: bool = True, **extra: Any) -> Voice:
    data: dict[str, Any] = {
        "id": voice_id,
        "label": voice_id,
        "engine": "edge",
        "age": "adult",
        "gender": "female",
        "accent": "Francia",
        "enabled": enabled,
    }
    data.update(extra)
    return Voice(**data)


def _insert_card(
    store: Store,
    card_id: str,
    front: str = "Bonjour",
    example: str | None = "Je dis bonjour",
) -> None:
    with store.tx() as conn:
        conn.execute(
            "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
            " ipa, phonemes, tags, generator, generator_version, stale, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                card_id,
                "vocab",
                front,
                "Hola",
                example,
                "Digo hola" if example else None,
                None,
                None,
                "[]",
                "[]",
                "rules",
                "1",
                0,
                NOW,
                NOW,
            ),
        )


def _insert_clip(
    store: Store,
    cache_key: str,
    text: str,
    *,
    status: str,
    attempts: int = 0,
    error: str | None = None,
    voice_id: str = VOICE,
) -> None:
    engine_used = "edge" if status == "done" else None
    path = f"audio/{cache_key}.mp3" if status == "done" else None
    duration_ms = 1200 if status == "done" else None
    with store.tx() as conn:
        conn.execute(
            "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
            " status, engine_used, path, duration_ms, attempts, error, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cache_key,
                text,
                tts_norm(text),
                voice_id,
                "ms-neural",
                "1",
                status,
                engine_used,
                path,
                duration_ms,
                attempts,
                error,
                NOW,
            ),
        )


def _pending_clip(store: Store, cache_key: str, text: str) -> None:
    _insert_clip(store, cache_key, text, status="pending")


def _done_clip(store: Store, cache_key: str, text: str, voice_id: str = VOICE) -> None:
    _insert_clip(store, cache_key, text, status="done", attempts=1, voice_id=voice_id)


def _status(store: Store, cache_key: str) -> str | None:
    row = store.conn.execute(
        "SELECT status FROM audio WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    return None if row is None else str(row[0])


def _used_voices(store: Store) -> set[str]:
    return {row[0] for row in store.conn.execute("SELECT DISTINCT voice_id FROM audio")}


class _FakeEngine:
    family = "ms-neural"
    family_version = "1"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: Voice, out_wav_or_mp3: Path) -> None:
        self.calls.append((text, voice.id))
        out_wav_or_mp3.parent.mkdir(parents=True, exist_ok=True)
        out_wav_or_mp3.write_bytes(b"fake-audio")


async def _no_sleep(_seconds: float) -> None:
    """Sustituye el backoff real en los tests."""


def _install_fake_tts(monkeypatch: pytest.MonkeyPatch) -> _FakeEngine:
    engine = _FakeEngine()
    monkeypatch.setattr(
        "frances.audio.run.make_engines",
        lambda _ctx: EngineSet(edge=engine, azure=None),
    )
    monkeypatch.setattr("frances.audio.run.postprocess", lambda _src, _dst, _ratio=1.0: 1200)
    return engine


def test_saved_default_voices_replace_config(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    save_default_voice_ids(store.conn, ["fr-FR-HenriNeural"], "u_admin", NOW)
    got = voices_for(
        "c_1",
        "vocab",
        "front",
        voices,
        settings,
        fixed_voice_ids=load_default_voice_ids(store.conn),
    )
    assert got[0].id == "fr-FR-HenriNeural"


def test_saved_defaults_are_not_repeated_by_rotation(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    save_default_voice_ids(store.conn, ["fr-FR-HenriNeural"], "u_admin", NOW)
    got = voices_for(
        "c_1",
        "vocab",
        "front",
        voices,
        settings,
        fixed_voice_ids=load_default_voice_ids(store.conn),
    )
    assert len(got) == 2
    assert len({voice.id for voice in got}) == 2


def test_plan_audio_uses_saved_defaults(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    _insert_card(store, "c_1")
    save_default_voice_ids(store.conn, ["fr-FR-HenriNeural"], "u_admin", NOW)
    plan_audio(store, voices, settings, NOW)
    assert "fr-FR-HenriNeural" in _used_voices(store)


def test_plan_audio_without_saved_defaults_uses_config(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    _insert_card(store, "c_1")
    assert load_default_voice_ids(store.conn) is None
    plan_audio(store, voices, settings, NOW)
    assert {"fr-FR-DeniseNeural", "fr-FR-HenriNeural"} <= _used_voices(store)


def test_invalid_saved_defaults_fall_back_to_config(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    store.conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_by, updated_at)"
        " VALUES (?, 'no-es-json', NULL, ?)",
        (DEFAULT_VOICES_KEY, NOW),
    )
    assert load_default_voice_ids(store.conn) is None
    _insert_card(store, "c_1")
    plan_audio(store, voices, settings, NOW)
    assert {"fr-FR-DeniseNeural", "fr-FR-HenriNeural"} <= _used_voices(store)


def test_non_string_saved_defaults_are_ignored(store: Store) -> None:
    store.conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_by, updated_at)"
        " VALUES (?, '[\"fr-FR-HenriNeural\", 3]', NULL, ?)",
        (DEFAULT_VOICES_KEY, NOW),
    )
    assert load_default_voice_ids(store.conn) is None


def test_empty_saved_defaults_fall_back_to_config(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    save_default_voice_ids(store.conn, [], "u_admin", NOW)
    assert load_default_voice_ids(store.conn) == []
    got = voices_for("c_1", "vocab", "example", voices, settings, fixed_voice_ids=[])
    assert [voice.id for voice in got] == ["fr-FR-DeniseNeural"]


def test_save_default_voices_upserts_single_row(store: Store) -> None:
    save_default_voice_ids(store.conn, ["fr-FR-HenriNeural"], "u_admin", NOW)
    save_default_voice_ids(
        store.conn,
        ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
        "u_admin",
        NOW2,
    )
    rows = store.conn.execute(
        "SELECT key, value_json, updated_by, updated_at FROM app_settings"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == DEFAULT_VOICES_KEY
    assert json.loads(rows[0][1]) == ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"]
    assert rows[0][2] == "u_admin" and rows[0][3] == NOW2


def test_saving_default_voices_does_not_touch_existing_clips(store: Store) -> None:
    _done_clip(store, KEY_A, "Bonjour")
    select = (
        "SELECT cache_key, text, text_norm, voice_id, family, family_version, status,"
        " engine_used, path, duration_ms, attempts, error, updated_at FROM audio"
        " WHERE cache_key = ?"
    )
    before = store.conn.execute(select, (KEY_A,)).fetchone()
    save_default_voice_ids(store.conn, ["fr-FR-HenriNeural"], "u_admin", NOW2)
    after = store.conn.execute(select, (KEY_A,)).fetchone()
    assert after == before
    assert before[6] == "done"


def test_plan_audio_keeps_done_clip_when_defaults_change(
    store: Store, voices: list[Voice], settings: Settings
) -> None:
    _insert_card(store, "c_1", front="Bonjour")
    henri = next(voice for voice in voices if voice.id == "fr-FR-HenriNeural")
    req = audio_request("Bonjour", henri)
    _done_clip(store, req.cache_key, "Bonjour", voice_id=henri.id)
    save_default_voice_ids(store.conn, [henri.id], "u_admin", NOW)
    plan_audio(store, voices, settings, NOW2)
    row = store.conn.execute(
        "SELECT status, attempts FROM audio WHERE cache_key = ?", (req.cache_key,)
    ).fetchone()
    assert row == ("done", 1)


def test_select_by_keys_returns_rows_with_work_columns(store: Store) -> None:
    _pending_clip(store, KEY_A, "Bonjour")
    _done_clip(store, KEY_B, "Salut")
    rows = select_by_keys(store.conn, [KEY_A, KEY_B, KEY_C])
    assert {row.cache_key for row in rows} == {KEY_A, KEY_B}
    row = next(item for item in rows if item.cache_key == KEY_A)
    assert (
        row.text,
        row.text_norm,
        row.voice_id,
        row.family,
        row.family_version,
        row.status,
        row.attempts,
    ) == ("Bonjour", "Bonjour", VOICE, "ms-neural", "1", "pending", 0)


def test_select_by_keys_with_no_keys_returns_empty(store: Store) -> None:
    _pending_clip(store, KEY_A, "Bonjour")
    assert select_by_keys(store.conn, []) == []


def test_run_audio_keys_only_processes_requested_clips(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pending_clip(ctx.store, KEY_A, "Bonjour")
    _pending_clip(ctx.store, KEY_B, "Salut")
    engine = _install_fake_tts(monkeypatch)
    report = run_audio_keys(ctx, [KEY_A])
    assert report.stage == "audio"
    assert report.counts["done"] == 1
    assert _status(ctx.store, KEY_B) == "pending"
    assert [text for text, _voice_id in engine.calls] == ["Bonjour"]


def test_run_audio_keys_ignores_missing_and_non_pending_clips(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pending_clip(ctx.store, KEY_A, "Bonjour")
    _done_clip(ctx.store, KEY_B, "Salut")
    engine = _install_fake_tts(monkeypatch)
    report = run_audio_keys(ctx, [KEY_A, KEY_B, KEY_C])
    assert report.counts["done"] == 1
    assert _status(ctx.store, KEY_A) == "done"
    assert _status(ctx.store, KEY_B) == "done"
    assert _status(ctx.store, KEY_C) is None
    assert len(engine.calls) == 1


def test_run_audio_keys_does_not_prune_card_audio_links(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _insert_card(ctx.store, "c_1", front="Bonjour")
    _pending_clip(ctx.store, KEY_A, "Bonjour")
    _done_clip(ctx.store, KEY_B, "Salut")
    with ctx.store.tx() as conn:
        link_card_audio(conn, "c_1", "front", KEY_A)
        link_card_audio(conn, "c_1", "front", KEY_B)
    _install_fake_tts(monkeypatch)
    run_audio_keys(ctx, [KEY_A])
    links = ctx.store.conn.execute(
        "SELECT cache_key FROM card_audio WHERE card_id = 'c_1' ORDER BY cache_key"
    ).fetchall()
    assert [row[0] for row in links] == [KEY_A, KEY_B]


def test_reset_for_regeneration_only_touches_that_clip(store: Store) -> None:
    _done_clip(store, KEY_A, "Bonjour")
    _done_clip(store, KEY_B, "Salut")
    assert reset_for_regeneration(store.conn, KEY_A, NOW2) is True
    assert _status(store, KEY_A) == "pending" and _status(store, KEY_B) == "done"
    assert reset_for_regeneration(store.conn, KEY_C, NOW2) is False


def test_reset_for_regeneration_clears_attempts_and_error(store: Store) -> None:
    _insert_clip(store, KEY_A, "Bonjour", status="failed", attempts=5, error="boom")
    assert reset_for_regeneration(store.conn, KEY_A, NOW2) is True
    row = store.conn.execute(
        "SELECT status, attempts, error, updated_at FROM audio WHERE cache_key = ?", (KEY_A,)
    ).fetchone()
    assert row == ("pending", 0, None, NOW2)


def test_run_audio_keys_synthesizes_reset_clip(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _done_clip(ctx.store, KEY_A, "Bonjour")
    _install_fake_tts(monkeypatch)
    assert reset_for_regeneration(ctx.store.conn, KEY_A, NOW2) is True
    report = run_audio_keys(ctx, [KEY_A])
    assert report.counts["done"] == 1
    assert _status(ctx.store, KEY_A) == "done"
    row = ctx.store.conn.execute(
        "SELECT attempts, engine_used FROM audio WHERE cache_key = ?", (KEY_A,)
    ).fetchone()
    assert row == (0, "edge")
