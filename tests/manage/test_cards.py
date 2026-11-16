"""Lógica de gestión de tarjetas (MGT-01), sin FastAPI.

Cada prueba usa una base migrada, usuarios reales y una publicación sintética.
Los generadores se inyectan: ningún test abre red.
"""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.cards.llm import LlmUnavailable
from frances.manage.cards import (
    CardConflict,
    CardNotVisible,
    admin_delete_card,
    admin_update_card,
    create_own_card,
    delete_my_card,
    delete_own_card,
    queue_regenerate_item,
    regenerate_item,
    upsert_my_card,
)
from frances.models import (
    CardDraft,
    GenerationInput,
    GenerationOutput,
    OwnCardIn,
    SheetDraft,
    card_id,
    user_card_id,
)
from frances.models.study import CardOverrideIn
from frances.stage import StageContext, make_context
from frances.timeutil import format_ts
from tests.testkit.api import create_user

NOW = format_ts(datetime(2026, 11, 3, 0, 0, tzinfo=UTC))
ITEM = "cw_1"
SHARED = card_id("Bonjour", "vocab")
AUDIO_KEY = "a" * 32


@dataclass
class Unit:
    """Contexto de etapa, conexión y los dos usuarios de las pruebas."""

    ctx: StageContext
    conn: sqlite3.Connection
    ana_id: str
    leo_id: str


def insert_shared_card(conn: sqlite3.Connection, front_fr: str = "Bonjour") -> str:
    """Tarjeta compartida con generación y origen en ``ITEM``."""
    cid = card_id(front_fr, "vocab")
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
        " phonemes, tags, generator, generator_version, stale, created_at, updated_at)"
        " VALUES (?, 'vocab', ?, 'Buenos días', NULL, NULL, NULL, '[]', '[]', 'demo', '1',"
        " 0, ?, ?)",
        (cid, front_fr, NOW, NOW),
    )
    conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (cid, ITEM))
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, 'gen-hash', 'llm', '1', ?)",
        (ITEM, NOW),
    )
    return cid


def insert_own_card(
    conn: sqlite3.Connection,
    owner: str,
    *,
    front_fr: str = "Secret d'Ana",
    card_id_value: str | None = None,
    removed_at: str | None = None,
) -> str:
    """Tarjeta propia de ``owner``."""
    cid = card_id_value or user_card_id(owner, front_fr, "vocab")
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
        " phonemes, tags, generator, generator_version, stale, created_at, updated_at,"
        " owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, 'Secreto de Ana', NULL, NULL, NULL, '[]', '[]', 'user', '1',"
        " 0, ?, ?, ?, ?)",
        (cid, front_fr, NOW, NOW, owner, removed_at),
    )
    return cid


def insert_state(conn: sqlite3.Connection, user_id: str, card_id_value: str, reps: int = 4) -> None:
    """Estado FSRS con ``reps`` reconocible."""
    conn.execute(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
        " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
        " suspended, flagged_hard, updated_at)"
        " VALUES (?, ?, ?, 1.0, 5.0, 0, 0, 0, ?, 0, 0, NULL, 0, 0, ?)",
        (user_id, card_id_value, NOW, reps, NOW),
    )


def insert_audio(conn: sqlite3.Connection, key: str = AUDIO_KEY) -> None:
    """Clip terminado para poder enlazarlo a una tarjeta."""
    conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, attempts, updated_at)"
        " VALUES (?, 'x', 'x', 'fr-FR-DeniseNeural', 'ms-neural', '1', 'done', 1, ?)",
        (key, NOW),
    )


@dataclass(frozen=True)
class FakeGenerator:
    """Generador inyectado con nombre, versión y salida fija."""

    name: str
    cards: tuple[CardDraft, ...]
    version: str = "1"

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        return GenerationOutput(
            cards=list(self.cards),
            sheet=SheetDraft(
                summary_es="resumen sintético",
                vocab_fronts=[draft.front_fr for draft in self.cards],
                grammar=[],
                key_phrases=[],
            ),
        )


@pytest.fixture
def unit(tmp_path: Path) -> Iterator[Unit]:
    """Contexto con curso, publicación, tarjeta compartida y dos usuarios."""
    ctx = make_context(tmp_path, {})
    conn = ctx.store.conn
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (NOW,),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'material', '1', 'Leçon 1', 'Bonjour à tous.', 'PUBLISHED',"
        " ?, ?, 'item-hash', '{}', ?, ?)",
        (ITEM, NOW, NOW, NOW, NOW),
    )
    insert_shared_card(conn)
    ana_id = create_user(conn, "ana@ex.org")
    leo_id = create_user(conn, "leo@ex.org")
    try:
        yield Unit(ctx=ctx, conn=conn, ana_id=ana_id, leo_id=leo_id)
    finally:
        ctx.store.close()


def row(conn: sqlite3.Connection, card_id_value: str) -> tuple[Any, ...] | None:
    return conn.execute(
        "SELECT front_fr, back_es, edited_by_human, edited_input_hash, removed_at,"
        " owner_user_id FROM cards WHERE id = ?",
        (card_id_value,),
    ).fetchone()


def test_upsert_my_card_only_for_shared_visible_cards(unit: Unit) -> None:
    body = CardOverrideIn(front_fr="Salut", back_es="Hola")
    view = upsert_my_card(unit.conn, unit.ana_id, SHARED, body, NOW)
    assert view.mine is not None and view.mine.front_fr == "Salut"
    assert view.front_fr == "Salut" and view.owner == "shared"

    own = insert_own_card(unit.conn, unit.ana_id)
    with pytest.raises(CardConflict):
        upsert_my_card(unit.conn, unit.ana_id, own, body, NOW)

    foreign = insert_own_card(unit.conn, unit.leo_id)
    with pytest.raises(CardNotVisible):
        upsert_my_card(unit.conn, unit.ana_id, foreign, body, NOW)

    with pytest.raises(CardNotVisible):
        upsert_my_card(unit.conn, unit.ana_id, "no-existe", body, NOW)

    removed = card_id("Salut", "vocab")
    unit.conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at, removed_at)"
        " VALUES (?, 'vocab', 'Salut', 'Hola', 'demo', '1', 0, ?, ?, ?)",
        (removed, NOW, NOW, NOW),
    )
    with pytest.raises(CardNotVisible):
        upsert_my_card(unit.conn, unit.ana_id, removed, body, NOW)


def test_upsert_my_card_rejects_empty_front_or_back(unit: Unit) -> None:
    with pytest.raises(ValueError):
        upsert_my_card(
            unit.conn, unit.ana_id, SHARED, CardOverrideIn(front_fr="  ", back_es="Hola"), NOW
        )
    with pytest.raises(ValueError):
        upsert_my_card(
            unit.conn, unit.ana_id, SHARED, CardOverrideIn(front_fr="Salut", back_es="  "), NOW
        )


def test_delete_my_card_returns_base_view_and_keeps_fsrs(unit: Unit) -> None:
    body = CardOverrideIn(front_fr="Salut", back_es="Hola")
    upsert_my_card(unit.conn, unit.ana_id, SHARED, body, NOW)
    insert_state(unit.conn, unit.ana_id, SHARED, reps=5)

    view = delete_my_card(unit.conn, unit.ana_id, SHARED, NOW)
    assert view.mine is None and view.front_fr == "Bonjour"
    assert view.state is not None and view.state.fsrs.reps == 5
    assert unit.conn.execute("SELECT COUNT(*) FROM card_overrides").fetchone() == (0,)


def test_delete_own_card_removes_children_and_checks_visibility(unit: Unit) -> None:
    own = insert_own_card(unit.conn, unit.ana_id)
    insert_state(unit.conn, unit.ana_id, own)
    insert_audio(unit.conn)
    unit.conn.execute(
        "INSERT INTO review_log (user_id, card_id, rating, state, due, stability, difficulty,"
        " elapsed_days, scheduled_days, review_at)"
        " VALUES (?, ?, 3, 0, ?, 1.0, 5.0, 0, 0, ?)",
        (unit.ana_id, own, NOW, NOW),
    )
    unit.conn.execute(
        "INSERT INTO card_overrides (user_id, card_id, front_fr, back_es, example_fr,"
        " example_es, notes, base_updated_at, updated_at)"
        " VALUES (?, ?, 'x', 'y', NULL, NULL, NULL, ?, ?)",
        (unit.ana_id, own, NOW, NOW),
    )
    unit.conn.execute(
        "INSERT INTO card_audio (card_id, field, cache_key) VALUES (?, 'front', ?)",
        (own, AUDIO_KEY),
    )
    unit.conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (own, ITEM))

    delete_own_card(unit.conn, unit.ana_id, own)
    assert unit.conn.execute("SELECT COUNT(*) FROM cards WHERE id = ?", (own,)).fetchone() == (0,)
    for table in ("user_card_state", "review_log", "card_overrides", "card_audio", "card_sources"):
        assert unit.conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE card_id = ?", (own,)
        ).fetchone() == (0,), table

    with pytest.raises(PermissionError):
        delete_own_card(unit.conn, unit.ana_id, SHARED)
    foreign = insert_own_card(unit.conn, unit.leo_id)
    with pytest.raises(CardNotVisible):
        delete_own_card(unit.conn, unit.ana_id, foreign)


def test_create_own_card_normalizes_and_rejects_duplicates(unit: Unit) -> None:
    body = OwnCardIn(kind="vocab", front_fr="  le  chien ", back_es="el perro")
    view = create_own_card(unit.conn, unit.ana_id, body, NOW)
    expected = user_card_id(unit.ana_id, "le chien", "vocab")
    assert view.id == expected and view.front_fr == "le chien"
    assert row(unit.conn, expected) == (
        "le chien",
        "el perro",
        0,
        None,
        None,
        unit.ana_id,
    )
    with pytest.raises(CardConflict):
        create_own_card(
            unit.conn,
            unit.ana_id,
            OwnCardIn(kind="vocab", front_fr="le chien", back_es="otro"),
            NOW,
        )
    with pytest.raises(ValueError):
        create_own_card(
            unit.conn, unit.ana_id, OwnCardIn(kind="vocab", front_fr=" ", back_es="x"), NOW
        )
    with pytest.raises(ValueError):
        create_own_card(
            unit.conn, unit.ana_id, OwnCardIn(kind="vocab", front_fr="x", back_es=" "), NOW
        )


def test_admin_update_only_shared_and_marks_human_edit(unit: Unit) -> None:
    body = CardOverrideIn(front_fr="le chat", back_es="el gato", notes="revisado")
    view = admin_update_card(unit.conn, unit.ana_id, SHARED, body, NOW)
    assert view.edited_by_human is True
    assert row(unit.conn, SHARED) == (
        "le chat",
        "el gato",
        1,
        "gen-hash",
        None,
        None,
    )

    own = insert_own_card(unit.conn, unit.ana_id)
    with pytest.raises(CardConflict):
        admin_update_card(unit.conn, unit.ana_id, own, body, NOW)

    with pytest.raises(CardNotVisible):
        admin_update_card(unit.conn, unit.ana_id, "no-existe", body, NOW)


def test_admin_delete_marks_removed_and_keeps_row_and_fsrs(unit: Unit) -> None:
    insert_state(unit.conn, unit.ana_id, SHARED, reps=4)
    admin_delete_card(unit.conn, unit.ana_id, SHARED, NOW)

    current = row(unit.conn, SHARED)
    assert current is not None
    assert current[2] == 1 and current[3] == "gen-hash" and current[4] == NOW
    assert unit.conn.execute(
        "SELECT reps FROM user_card_state WHERE user_id = ? AND card_id = ?",
        (unit.ana_id, SHARED),
    ).fetchone() == (4,)

    own = insert_own_card(unit.conn, unit.ana_id)
    with pytest.raises(CardConflict):
        admin_delete_card(unit.conn, unit.ana_id, own, NOW)


def test_regenerate_item_keeps_human_edits_and_removed_cards(unit: Unit) -> None:
    """REVIEW FOCUS 3 y 9: el pipeline respeta ``edited_by_human`` y ``removed_at``."""
    unit.conn.execute(
        "UPDATE cards SET back_es = 'editada', edited_by_human = 1, edited_input_hash = 'gen-hash'"
        " WHERE id = ?",
        (SHARED,),
    )
    removed = card_id("Salut", "vocab")
    unit.conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at, edited_by_human, removed_at)"
        " VALUES (?, 'vocab', 'Salut', 'Hola', 'demo', '1', 0, ?, ?, 1, ?)",
        (removed, NOW, NOW, NOW),
    )
    unit.conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (removed, ITEM))
    insert_state(unit.conn, unit.ana_id, SHARED, reps=4)

    generator = FakeGenerator(
        name="rules",
        cards=(
            CardDraft(kind="vocab", front_fr="Bonjour", back_es="otra"),
            CardDraft(kind="vocab", front_fr="Salut", back_es="otra"),
        ),
    )
    result = regenerate_item(unit.ctx, ITEM, generator=generator)

    assert result["generator"] == "rules"
    assert result["cards"] == 2
    assert result["kept_human"] == 2 and result["created"] == 0
    current = row(unit.conn, SHARED)
    assert current is not None and current[1] == "editada"
    removed_row = row(unit.conn, removed)
    assert removed_row is not None and removed_row[4] == NOW
    assert unit.conn.execute(
        "SELECT reps FROM user_card_state WHERE user_id = ? AND card_id = ?",
        (unit.ana_id, SHARED),
    ).fetchone() == (4,)


def test_regenerate_item_filters_ungrounded_llm_cards(unit: Unit) -> None:
    generator = FakeGenerator(
        name="llm",
        cards=(
            CardDraft(kind="vocab", front_fr="Bonjour", back_es="Hola"),
            CardDraft(kind="vocab", front_fr="le dragon", back_es="el dragón"),
        ),
    )
    result = regenerate_item(unit.ctx, ITEM, generator=generator)
    assert result["cards"] == 1 and result["dropped"] == 1
    fronts = {str(value) for (value,) in unit.conn.execute("SELECT front_fr FROM cards").fetchall()}
    assert fronts == {"Bonjour"}


class _FailingLlm:
    """LLM configurado que falla antes del primer token."""

    name = "llm"
    version = "1"

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        raise LlmUnavailable("sin red")


class _FakeLlm(_FailingLlm):
    """LLM configurado que devuelve una salida válida."""

    def __init__(self, cards: tuple[CardDraft, ...]) -> None:
        self._cards = cards

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        return GenerationOutput(
            cards=list(self._cards),
            sheet=SheetDraft(
                summary_es="resumen sintético",
                vocab_fronts=[draft.front_fr for draft in self._cards],
                grammar=[],
                key_phrases=[],
            ),
        )


def test_regenerate_item_falls_back_to_rules_when_llm_fails(
    unit: Unit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("frances.manage.cards.llm_from_env", lambda *args, **kwargs: _FailingLlm())
    result = regenerate_item(unit.ctx, ITEM)
    assert result["generator"] == "rules"


def test_regenerate_item_uses_configured_llm_and_counts_the_call(
    unit: Unit, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = _FakeLlm((CardDraft(kind="vocab", front_fr="Bonjour", back_es="Hola"),))
    monkeypatch.setattr("frances.manage.cards.llm_from_env", lambda *args, **kwargs: fake)
    result = regenerate_item(unit.ctx, ITEM)
    assert result["generator"] == "llm" and result["cards"] == 1
    assert unit.conn.execute("SELECT amount FROM usage WHERE meter = 'llm_items'").fetchone() == (
        1,
    )


def test_regenerate_item_missing_or_deleted_item(unit: Unit) -> None:
    generator = FakeGenerator(name="rules", cards=())
    with pytest.raises(LookupError):
        regenerate_item(unit.ctx, "no-existe", generator=generator)
    unit.conn.execute("UPDATE items SET deleted_at = ? WHERE id = ?", (NOW, ITEM))
    with pytest.raises(LookupError):
        regenerate_item(unit.ctx, ITEM, generator=generator)


def test_queue_regenerate_item_dedupes_and_validates_item(unit: Unit) -> None:
    now = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
    first = queue_regenerate_item(unit.conn, ITEM, now)
    second = queue_regenerate_item(unit.conn, ITEM, now)
    assert first.id == second.id
    assert first.kind == "cards.regenerate_item" and first.state == "queued"
    stored = unit.conn.execute(
        "SELECT payload, dedupe_key, priority FROM jobs WHERE id = ?", (first.id,)
    ).fetchone()
    assert stored is not None
    assert json.loads(stored[0]) == {"item_id": ITEM}
    assert stored[1:] == (f"cards.regenerate_item:{ITEM}", 5)

    with pytest.raises(LookupError):
        queue_regenerate_item(unit.conn, "no-existe", now)
