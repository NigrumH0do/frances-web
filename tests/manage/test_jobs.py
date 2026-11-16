"""Handlers de trabajos de gestión (MGT-04): regenerar tarjetas y audio.

Todo es sintético y sin red: el generador de tarjetas y el motor TTS se
sustituyen por dobles. Los tests llaman a los handlers directamente (y uno pasa
por el worker real) para comprobar que encolan, deduplican y no filtran texto
del curso a ``jobs.result`` ni a ``jobs.last_error``.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.audio.policy import save_default_voice_ids
from frances.audio.run import EngineSet
from frances.jobs.queue import Job, PermanentJobError, enqueue
from frances.jobs.registry import HandlerRegistry, load_handlers
from frances.jobs.worker import run_one
from frances.manage.jobs import (
    handle_audio_regenerate,
    handle_cards_regenerate_item,
    register_handlers,
)
from frances.models import CardDraft, GenerationInput, GenerationOutput, SheetDraft, card_id
from frances.models.audio import Voice
from frances.stage import StageContext, make_context
from frances.timeutil import format_ts
from tests.testkit.api import create_user

NOW = datetime(2026, 11, 6, 15, 0, tzinfo=UTC)
TS = format_ts(NOW)
COURSE = "c_1"
ITEM = "cw_1"
TEXT = "Bonjour à tous. Salut la classe. Merci beaucoup."
EDITED = card_id("Bonjour", "vocab")
DELETED = card_id("Salut", "vocab")
KEY_A = "a" * 32
KEY_B = "b" * 32
VOICE = "fr-FR-DeniseNeural"


@dataclass(frozen=True)
class Unit:
    """Contexto de etapa y conexión de una prueba."""

    ctx: StageContext
    conn: sqlite3.Connection


class FakeGenerator:
    """Generador de tarjetas inyectado: devuelve siempre los mismos frentes."""

    name = "rules"
    version = "1"

    def __init__(self, fronts: Sequence[str]) -> None:
        self._fronts = tuple(fronts)

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        del inp
        cards = [
            CardDraft(kind="vocab", front_fr=front, back_es="traducción sintética")
            for front in self._fronts
        ]
        return GenerationOutput(
            cards=cards,
            sheet=SheetDraft(
                summary_es="resumen sintético",
                vocab_fronts=list(self._fronts),
                grammar=[],
                key_phrases=[],
            ),
        )


class FakeEngine:
    """Motor TTS que solo apunta las llamadas y escribe un archivo cualquiera."""

    family = "ms-neural"
    family_version = "1"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: Voice, out_wav_or_mp3: Path) -> None:
        self.calls.append((text, voice.id))
        out_wav_or_mp3.parent.mkdir(parents=True, exist_ok=True)
        out_wav_or_mp3.write_bytes(b"audio")


def _install_generator(monkeypatch: pytest.MonkeyPatch, fronts: Sequence[str]) -> FakeGenerator:
    """Sustituye la elección real de generador por uno con salida fija."""
    generator = FakeGenerator(fronts)

    def choose(_ctx: StageContext, _inp: GenerationInput) -> tuple[FakeGenerator, GenerationOutput]:
        return generator, generator.generate(_inp)

    monkeypatch.setattr("frances.manage.cards._generate_with_defaults", choose)
    return generator


def _install_fake_tts(monkeypatch: pytest.MonkeyPatch) -> FakeEngine:
    """Motor TTS falso y post-proceso no-op (sin subprocess ni ffmpeg)."""
    engine = FakeEngine()
    monkeypatch.setattr(
        "frances.audio.run.make_engines", lambda _ctx: EngineSet(edge=engine, azure=None)
    )
    monkeypatch.setattr("frances.audio.run.postprocess", lambda _src, _dst, _shift_ratio=1.0: 1234)
    return engine


def _insert_card(
    conn: sqlite3.Connection,
    cid: str,
    front: str = "Bonjour",
    *,
    example: str | None = None,
    stale: int = 0,
    removed_at: str | None = None,
    edited_by_human: int = 0,
    edited_input_hash: str | None = None,
) -> None:
    """Tarjeta con columnas explícitas (las migraciones agregan columnas)."""
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
        " phonemes, tags, generator, generator_version, stale, created_at, updated_at,"
        " edited_by_human, edited_input_hash, removed_at)"
        " VALUES (?, 'vocab', ?, 'Traducción', ?, NULL, NULL, '[]', '[]', 'rules', '1',"
        " ?, ?, ?, ?, ?, ?)",
        (cid, front, example, stale, TS, TS, edited_by_human, edited_input_hash, removed_at),
    )


def _insert_item(ctx: StageContext) -> None:
    """Curso y publicación sintéticos con una generación vigente."""
    conn = ctx.store.conn
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES (?, 'Français 1', 'ACTIVE', ?, '{}')",
        (COURSE, TS),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, ?, 'material', '1', 'Leçon 1', ?, 'PUBLISHED', ?, ?, 'item-hash',"
        " '{}', ?, ?)",
        (ITEM, COURSE, TEXT, TS, TS, TS, TS),
    )
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, 'gen-hash', 'llm', '1', ?)",
        (ITEM, TS),
    )


def _card(conn: sqlite3.Connection, cid: str) -> dict[str, Any]:
    """Fila de ``cards`` como diccionario; falla si no existe."""
    columns = (
        "id",
        "front_fr",
        "removed_at",
        "edited_by_human",
        "edited_input_hash",
        "owner_user_id",
    )
    row = conn.execute(f"SELECT {', '.join(columns)} FROM cards WHERE id = ?", (cid,)).fetchone()
    assert row is not None
    return dict(zip(columns, row, strict=True))


def _job(kind: str, payload: dict[str, Any], *, job_id: int = 1) -> Job:
    """Trabajo en curso para llamar al handler sin pasar por la cola."""
    return Job(
        id=job_id,
        kind=kind,  # type: ignore[arg-type]
        payload=payload,
        state="running",
        priority=0,
        attempts=1,
        max_attempts=5,
        run_after=TS,
        dedupe_key=None,
        locked_by="test",
        last_error=None,
        created_at=TS,
        updated_at=TS,
    )


def _done_clip(ctx: StageContext, cache_key: str, *, text: str) -> None:
    """Clip ya sintetizado que se podrá o no pedir en la regeneración."""
    ctx.store.conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, attempts, updated_at)"
        " VALUES (?, ?, ?, ?, 'ms-neural', '1', 'done', 1, ?)",
        (cache_key, text, text, VOICE, TS),
    )


def _status(ctx: StageContext, cache_key: str) -> str | None:
    row = ctx.store.conn.execute(
        "SELECT status FROM audio WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    return None if row is None else str(row[0])


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    """Contexto vacío; las pruebas de audio siembran sus propios clips."""
    context = make_context(tmp_path / "data", env={})
    try:
        yield context
    finally:
        context.store.close()


@pytest.fixture
def work_ctx(tmp_path: Path) -> Iterator[StageContext]:
    """Contexto con una tarjeta viva y su ejemplo para ``scope=all``."""
    context = make_context(tmp_path / "data", env={})
    _insert_card(context.store.conn, "c_1", "Bonjour", example="Je dis bonjour")
    try:
        yield context
    finally:
        context.store.close()


@pytest.fixture
def item_with_cards(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Unit]:
    """Publicación viva con una tarjeta editada y otra borrada por el admin."""
    ctx = make_context(tmp_path / "data", env={})
    conn = ctx.store.conn
    _insert_item(ctx)
    _insert_card(
        conn,
        EDITED,
        "texte édité par l'admin",
        edited_by_human=1,
        edited_input_hash="gen-hash",
    )
    _insert_card(
        conn,
        DELETED,
        "Salut",
        edited_by_human=1,
        edited_input_hash="gen-hash",
        removed_at=TS,
    )
    for cid in (EDITED, DELETED):
        conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (cid, ITEM))
    _install_generator(monkeypatch, ("Bonjour", "Merci"))
    try:
        yield Unit(ctx=ctx, conn=conn)
    finally:
        ctx.store.close()


def test_manage_handlers_are_registered() -> None:
    reg = HandlerRegistry()
    load_handlers(reg)
    assert {"cards.regenerate_item", "audio.regenerate"} <= reg.kinds()


def test_regenerate_item_keeps_human_edits(item_with_cards: Unit) -> None:
    result = handle_cards_regenerate_item(
        item_with_cards.ctx, _job("cards.regenerate_item", {"item_id": ITEM})
    )

    assert result["kept_human"] == 1 and result["created"] >= 1
    current = _card(item_with_cards.conn, EDITED)
    assert current["front_fr"] == "texte édité par l'admin"
    assert current["edited_by_human"] == 1
    assert current["edited_input_hash"] == "gen-hash"


def test_regenerate_item_does_not_resurrect_deleted_card(
    item_with_cards: Unit, monkeypatch: pytest.MonkeyPatch
) -> None:
    # El generador vuelve a proponer el frente de la tarjeta borrada: aun así no revive.
    _install_generator(monkeypatch, ("Bonjour", "Salut", "Merci"))
    handle_cards_regenerate_item(
        item_with_cards.ctx, _job("cards.regenerate_item", {"item_id": ITEM})
    )

    current = _card(item_with_cards.conn, DELETED)
    assert current["removed_at"] == TS
    assert current["edited_by_human"] == 1


def test_regenerate_item_audio_job_is_deduped(item_with_cards: Unit) -> None:
    first = handle_cards_regenerate_item(
        item_with_cards.ctx, _job("cards.regenerate_item", {"item_id": ITEM})
    )
    second = handle_cards_regenerate_item(
        item_with_cards.ctx, _job("cards.regenerate_item", {"item_id": ITEM})
    )

    assert first["audio_job"] is not None
    assert second["audio_job"] == first["audio_job"]
    rows = item_with_cards.conn.execute(
        "SELECT payload, dedupe_key FROM jobs WHERE kind = 'audio.regenerate'"
    ).fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0][0])["cache_keys"]
    assert rows[0][1] == f"audio.regenerate:item:{ITEM}"


def test_audio_regenerate_resets_only_requested_clip(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _done_clip(ctx, KEY_A, text="Salut")
    _done_clip(ctx, KEY_B, text="Merci")
    engine = _install_fake_tts(monkeypatch)

    result = handle_audio_regenerate(ctx, _job("audio.regenerate", {"cache_keys": [KEY_A]}))

    assert result["done"] == 1
    assert _status(ctx, KEY_B) == "done"
    assert [text for text, _voice in engine.calls] == ["Salut"]


def test_audio_regenerate_all_uses_default_voices(
    work_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin_id = create_user(work_ctx.store.conn, "admin@example.test", role="admin")
    save_default_voice_ids(work_ctx.store.conn, ["fr-FR-HenriNeural"], admin_id, TS)
    _install_fake_tts(monkeypatch)

    result = handle_audio_regenerate(work_ctx, _job("audio.regenerate", {"scope": "all"}))

    assert work_ctx.store.conn.execute("SELECT COUNT(*) FROM audio").fetchone()[0] > 0
    assert result["done"] > 0
    example_voices = {
        str(row[0])
        for row in work_ctx.store.conn.execute(
            "SELECT DISTINCT audio.voice_id FROM card_audio"
            " JOIN audio ON audio.cache_key = card_audio.cache_key"
            " WHERE card_audio.field = 'example'"
        )
    }
    assert example_voices == {"fr-FR-HenriNeural"}


def test_audio_regenerate_by_card_id_only_touches_that_card(
    work_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _insert_card(work_ctx.store.conn, "c_extra", "Salut", example="Je dis salut")
    engine = _install_fake_tts(monkeypatch)

    result = handle_audio_regenerate(work_ctx, _job("audio.regenerate", {"card_id": "c_1"}))

    assert result["done"] > 0
    linked = {
        str(row[0])
        for row in work_ctx.store.conn.execute("SELECT DISTINCT card_id FROM card_audio")
    }
    assert linked == {"c_1"}
    assert {text for text, _voice in engine.calls} <= {"Bonjour", "Je dis bonjour"}


def test_audio_regenerate_by_card_id_with_nothing_pending_is_noop(
    work_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = _install_fake_tts(monkeypatch)
    first = handle_audio_regenerate(work_ctx, _job("audio.regenerate", {"card_id": "c_1"}))
    assert first["done"] > 0
    calls = len(engine.calls)

    second = handle_audio_regenerate(work_ctx, _job("audio.regenerate", {"card_id": "c_1"}))

    assert second["done"] == 0 and second["requested"] == 0
    assert len(engine.calls) == calls


def test_bad_payload_is_permanent(ctx: StageContext) -> None:
    with pytest.raises(PermanentJobError):
        handle_cards_regenerate_item(ctx, _job("cards.regenerate_item", {}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {"cache_keys": ["f" * 32]}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {"card_id": "no-existe"}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {"scope": "un-rango"}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(
            ctx, _job("audio.regenerate", {"scope": "all", "cache_keys": [KEY_A]})
        )
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {"cache_keys": "no-es-lista"}))
    with pytest.raises(PermanentJobError):
        handle_audio_regenerate(ctx, _job("audio.regenerate", {"cache_keys": [1]}))


def test_job_result_has_no_course_text(item_with_cards: Unit) -> None:
    result = handle_cards_regenerate_item(
        item_with_cards.ctx, _job("cards.regenerate_item", {"item_id": ITEM})
    )
    dumped = json.dumps(result)
    assert "Leçon" not in dumped
    assert "Bonjour" not in dumped
    assert "Salut" not in dumped


def test_permanent_failure_has_no_course_text(item_with_cards: Unit) -> None:
    item_with_cards.conn.execute("UPDATE items SET deleted_at = ? WHERE id = ?", (TS, ITEM))
    job_id = enqueue(item_with_cards.conn, "cards.regenerate_item", {"item_id": ITEM}, now=NOW)
    reg = HandlerRegistry()
    register_handlers(reg)

    assert run_one(item_with_cards.ctx, reg, "worker-test") == job_id

    row = item_with_cards.conn.execute(
        "SELECT state, attempts, last_error FROM jobs WHERE id = ?", (job_id,)
    ).fetchone()
    assert row is not None
    assert row[0] == "failed" and row[1] == 1
    error = row[2] or ""
    assert "Leçon" not in error and "Bonjour" not in error
