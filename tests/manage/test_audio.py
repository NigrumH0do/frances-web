"""Audio de gestión (MGT-02): validación de voces, planificación y cola."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest

from frances.audio.policy import load_default_voice_ids
from frances.manage.audio import (
    plan_audio_for_cards,
    queue_audio_regeneration,
    set_default_voices,
    validate_default_voices,
)
from frances.models.bundle import VoiceOut
from frances.stage import StageContext, make_context
from frances.timeutil import format_ts

NOW = datetime(2026, 11, 6, 15, 0, tzinfo=UTC)
NOW_STR = format_ts(NOW)
VOICE_A = "fr-FR-HenriNeural"
VOICE_B = "fr-FR-DeniseNeural"
OLD_KEY = "b" * 32


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = make_context(tmp_path / "data", env={})
    with context.store.tx() as conn:
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
            " VALUES ('u_admin', 'admin@example.test', 'Admin', 'x', 'admin', ?)",
            (NOW_STR,),
        )
    yield context
    context.store.close()


def _voice_out(voice_id: str) -> VoiceOut:
    return VoiceOut(
        id=voice_id,
        label=voice_id,
        age="adult",
        gender="female",
        accent="Francia",
    )


def _enabled() -> list[VoiceOut]:
    return [_voice_out(VOICE_B), _voice_out(VOICE_A)]


def _insert_card(
    ctx: StageContext,
    card_id: str,
    *,
    front: str = "Bonjour",
    example: str | None = "Je dis bonjour",
    stale: int = 0,
    removed_at: str | None = None,
) -> None:
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
            " ipa, phonemes, tags, generator, generator_version, stale, created_at, updated_at,"
            " removed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
                stale,
                NOW_STR,
                NOW_STR,
                removed_at,
            ),
        )


def _insert_audio(ctx: StageContext, cache_key: str, status: str = "pending") -> None:
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
            " status, attempts, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (cache_key, "Salut", "Salut", VOICE_B, "ms-neural", "1", status, 0, NOW_STR),
        )


def _status(ctx: StageContext, cache_key: str) -> str | None:
    row = ctx.store.conn.execute(
        "SELECT status FROM audio WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    return None if row is None else str(row[0])


def _links(ctx: StageContext) -> list[tuple[str, str, str]]:
    rows = ctx.store.conn.execute(
        "SELECT card_id, field, cache_key FROM card_audio ORDER BY card_id, field, cache_key"
    ).fetchall()
    return [(str(row[0]), str(row[1]), str(row[2])) for row in rows]


def _used_example_voices(ctx: StageContext) -> set[str]:
    rows = ctx.store.conn.execute(
        "SELECT DISTINCT audio.voice_id FROM card_audio"
        " JOIN audio ON audio.cache_key = card_audio.cache_key"
        " WHERE card_audio.field = 'example'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def test_validate_default_voices_preserves_requested_order() -> None:
    out = validate_default_voices([VOICE_A, VOICE_B], _enabled())
    assert [voice.id for voice in out] == [VOICE_A, VOICE_B]


def test_validate_default_voices_rejects_empty_duplicates_unknown_and_disabled() -> None:
    # fr-FR-EloiseNeural existe en el registro pero no está en `enabled`.
    for voice_ids in (
        [],
        [VOICE_A, VOICE_A],
        ["no-existe"],
        ["fr-FR-EloiseNeural"],
        [""],
    ):
        with pytest.raises(ValueError):
            validate_default_voices(voice_ids, _enabled())


def test_set_default_voices_saves_requested_order(ctx: StageContext) -> None:
    out = set_default_voices(ctx.store.conn, [VOICE_A, VOICE_B], _enabled(), "u_admin", NOW_STR)
    assert [voice.id for voice in out] == [VOICE_A, VOICE_B]
    assert load_default_voice_ids(ctx.store.conn) == [VOICE_A, VOICE_B]
    row = ctx.store.conn.execute(
        "SELECT updated_by, updated_at FROM app_settings WHERE key = 'audio.default_voice_ids'"
    ).fetchone()
    assert row == ("u_admin", NOW_STR)


def test_set_default_voices_rejects_invalid_without_writing(ctx: StageContext) -> None:
    with pytest.raises(ValueError):
        set_default_voices(ctx.store.conn, ["no-existe"], _enabled(), "u_admin", NOW_STR)
    assert load_default_voice_ids(ctx.store.conn) is None


def test_plan_audio_for_cards_only_touches_requested_cards(ctx: StageContext) -> None:
    _insert_card(ctx, "c_1", front="Bonjour")
    _insert_card(ctx, "c_2", front="Salut")
    keys = plan_audio_for_cards(ctx, ["c_1"])
    assert keys
    assert {card_id for card_id, _field, _key in _links(ctx)} == {"c_1"}
    assert set(keys) == {key for _card, _field, key in _links(ctx)}


def test_plan_audio_for_cards_uses_saved_default_voices(ctx: StageContext) -> None:
    _insert_card(ctx, "c_1")
    set_default_voices(ctx.store.conn, [VOICE_A], _enabled(), "u_admin", NOW_STR)
    plan_audio_for_cards(ctx, ["c_1"])
    assert _used_example_voices(ctx) == {VOICE_A}


def test_plan_audio_for_cards_skips_stale_and_removed_cards(ctx: StageContext) -> None:
    _insert_card(ctx, "c_ok")
    _insert_card(ctx, "c_stale", stale=1)
    _insert_card(ctx, "c_removed", removed_at=NOW_STR)
    keys = plan_audio_for_cards(ctx, ["c_ok", "c_stale", "c_removed"])
    assert keys
    assert {card_id for card_id, _field, _key in _links(ctx)} == {"c_ok"}


def test_plan_audio_for_cards_returns_only_clips_not_done(ctx: StageContext) -> None:
    _insert_card(ctx, "c_1")
    first = plan_audio_for_cards(ctx, ["c_1"])
    done_key = first[0]
    with ctx.store.tx() as conn:
        conn.execute("UPDATE audio SET status = 'done' WHERE cache_key = ?", (done_key,))
    second = plan_audio_for_cards(ctx, ["c_1"])
    assert set(second) == set(first) - {done_key}
    assert _status(ctx, done_key) == "done"


def test_plan_audio_for_cards_prunes_old_links_but_keeps_audio_row(ctx: StageContext) -> None:
    _insert_card(ctx, "c_1")
    _insert_audio(ctx, OLD_KEY)
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO card_audio (card_id, field, cache_key) VALUES ('c_1', 'front', ?)",
            (OLD_KEY,),
        )
    plan_audio_for_cards(ctx, ["c_1"])
    assert OLD_KEY not in {key for _card, field, key in _links(ctx) if field == "front"}
    assert _status(ctx, OLD_KEY) == "pending"


def test_plan_audio_for_cards_clears_example_without_text(ctx: StageContext) -> None:
    _insert_card(ctx, "c_1", example=None)
    _insert_audio(ctx, OLD_KEY)
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO card_audio (card_id, field, cache_key) VALUES ('c_1', 'example', ?)",
            (OLD_KEY,),
        )
    plan_audio_for_cards(ctx, ["c_1"])
    assert not [link for link in _links(ctx) if link[1] == "example"]


def test_plan_audio_for_cards_with_no_ids_is_noop(ctx: StageContext) -> None:
    assert plan_audio_for_cards(ctx, []) == []
    assert _links(ctx) == []


def test_queue_audio_regeneration_dedupes_and_returns_job_out(ctx: StageContext) -> None:
    first = queue_audio_regeneration(
        ctx.store.conn, {"cache_keys": [OLD_KEY]}, f"audio.regenerate:{OLD_KEY}", NOW
    )
    again = queue_audio_regeneration(
        ctx.store.conn, {"cache_keys": [OLD_KEY]}, f"audio.regenerate:{OLD_KEY}", NOW
    )
    assert first.id == again.id
    assert first.kind == "audio.regenerate" and first.state == "queued"
    assert "payload" not in first.model_dump() and "result" not in first.model_dump()
    row = ctx.store.conn.execute(
        "SELECT payload, dedupe_key FROM jobs WHERE id = ?", (first.id,)
    ).fetchone()
    assert json.loads(row[0]) == {"cache_keys": [OLD_KEY]}
    assert row[1] == f"audio.regenerate:{OLD_KEY}"
