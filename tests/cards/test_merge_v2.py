"""Merge v2: ediciones humanas, tarjetas borradas y filtro de tarjetas LLM (CHG-10)."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from frances.cards.merge import merge_output, recompute_stale, retranslate_pending
from frances.cards.repo import CardRow, get_card, set_translation, upsert_card
from frances.cards.rules import PENDING_NOTE
from frances.cards.run import run_cards_with
from frances.db.store import Store
from frances.models import CardDraft, GenerationInput, GenerationOutput, SheetDraft, card_id
from frances.stage import StageContext, make_context

T0 = "2026-10-01T10:00:00.000000Z"
T1 = "2026-10-02T10:00:00.000000Z"
ITEM_ID = "cw_1"
TEXT = "Je mange une pomme."


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    """Contexto con un único ítem vivo `cw_1` y su texto."""
    context = make_context(tmp_path, {})
    conn = context.store.conn
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (T0,),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'material', 'a-1', 'Leçon', ?, 'PUBLISHED',"
        " ?, ?, 'cw_1-content', '{}', ?, ?)",
        (ITEM_ID, TEXT, T0, T0, T0, T0),
    )
    try:
        yield context
    finally:
        context.store.close()


@pytest.fixture
def item_cw1() -> str:
    return ITEM_ID


@pytest.fixture
def item_with_text() -> str:
    return ITEM_ID


def card(front: str, back: str, kind: str = "vocab", notes: str | None = None) -> CardDraft:
    return CardDraft(kind=kind, front_fr=front, back_es=back, notes=notes)


def output(*cards: CardDraft, summary: str = "resumen") -> GenerationOutput:
    return GenerationOutput(
        cards=list(cards),
        sheet=SheetDraft(
            summary_es=summary,
            vocab_fronts=[draft.front_fr for draft in cards],
            grammar=[],
            key_phrases=[],
        ),
    )


class FakeRules:
    """Generador de reglas sin tarjetas: la prueba se centra en el LLM."""

    name = "rules"
    version = "1"

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        return output()


class FakeLlmGen:
    """Generador LLM falso que devuelve una salida fija."""

    name = "llm"
    version = "1"

    def __init__(self, out: GenerationOutput) -> None:
        self.out = out

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        return self.out


class FakeTranslator:
    """Traductor de prueba: prefija `ES:` y registra los lotes."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def translate(self, texts: list[str], src: str = "fr", dst: str = "es") -> list[str | None]:
        self.calls.append(list(texts))
        return ["ES:" + text for text in texts]


def test_human_edited_card_is_not_overwritten(store: Store, item_cw1: str) -> None:
    merge_output(store, item_cw1, output(card("la pomme", "manzana")), "llm", "1", T0)
    cid = card_id("la pomme", "vocab")
    store.conn.execute(
        "UPDATE cards SET back_es = 'manzana (editada)', edited_by_human = 1 WHERE id = ?",
        (cid,),
    )

    stats = merge_output(store, item_cw1, output(card("la pomme", "otra")), "llm", "2", T1)

    row = store.conn.execute(
        "SELECT back_es, generator_version FROM cards WHERE id = ?", (cid,)
    ).fetchone()
    assert row == ("manzana (editada)", "1") and stats.cards_kept_human == 1
    assert stats.cards_updated == 0
    sources = store.conn.execute(
        "SELECT COUNT(*) FROM card_sources WHERE card_id = ?", (cid,)
    ).fetchone()
    assert sources is not None and sources[0] == 1


def test_human_edited_sheet_is_not_overwritten(store: Store, item_cw1: str) -> None:
    merge_output(store, item_cw1, output(summary="v1"), "llm", "1", T0)
    store.conn.execute(
        "UPDATE sheets SET json = json_set(json, '$.summary_es', 'mía'), edited_by_human = 1"
    )

    merge_output(store, item_cw1, output(summary="v2"), "llm", "1", T1)

    row = store.conn.execute("SELECT json FROM sheets").fetchone()
    assert row is not None
    assert json.loads(row[0])["summary_es"] == "mía"


def test_removed_card_is_not_resurrected(store: Store, item_cw1: str) -> None:
    merge_output(store, item_cw1, output(card("le chat", "gato")), "llm", "1", T0)
    cid = card_id("le chat", "vocab")
    store.conn.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (T0, cid))

    merge_output(store, item_cw1, output(card("le chat", "gato")), "llm", "1", T1)
    recompute_stale(store)

    row = store.conn.execute("SELECT removed_at FROM cards WHERE id = ?", (cid,)).fetchone()
    assert row == (T0,)


def test_recompute_stale_leaves_removed_cards_untouched(store: Store, item_cw1: str) -> None:
    merge_output(store, item_cw1, output(card("le chat", "gato")), "llm", "1", T0)
    cid = card_id("le chat", "vocab")
    store.conn.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (T0, cid))
    store.conn.execute("DELETE FROM card_sources WHERE card_id = ?", (cid,))

    assert recompute_stale(store) == 0

    row = store.conn.execute("SELECT removed_at, stale FROM cards WHERE id = ?", (cid,)).fetchone()
    assert row == (T0, 0)


def test_upsert_card_sql_skips_human_edited_rows(store: Store, item_cw1: str) -> None:
    """REVIEW FOCUS: el WHERE del upsert protege aunque se llame sin pasar por merge."""
    merge_output(store, item_cw1, output(card("la pomme", "manzana")), "llm", "1", T0)
    cid = card_id("la pomme", "vocab")
    store.conn.execute(
        "UPDATE cards SET back_es = 'manzana (editada)', edited_by_human = 1,"
        " edited_input_hash = 'hash-viejo', removed_at = ? WHERE id = ?",
        (T1, cid),
    )
    existing = get_card(store.conn, cid)
    assert existing is not None and existing.edited_by_human
    replacement = CardRow(
        id=cid,
        kind="vocab",
        front_fr="la pomme",
        back_es="otra",
        example_fr=None,
        example_es=None,
        notes=None,
        tags="[]",
        generator="llm",
        generator_version="2",
        stale=0,
        created_at=T0,
    )

    upsert_card(store.conn, replacement, updated_at=T1)

    row = store.conn.execute(
        "SELECT back_es, generator_version, edited_by_human, edited_input_hash, removed_at"
        " FROM cards WHERE id = ?",
        (cid,),
    ).fetchone()
    assert row == ("manzana (editada)", "1", 1, "hash-viejo", T1)


def test_llm_cards_without_fragment_are_dropped(ctx: StageContext, item_with_text: str) -> None:
    llm = FakeLlmGen(output(card("la pomme", "manzana"), card("le dragon", "dragón")))

    report = run_cards_with(ctx, FakeRules(), llm, FakeTranslator())

    fronts = {row[0] for row in ctx.store.conn.execute("SELECT front_fr FROM cards")}
    assert fronts == {"la pomme"} and report.counts["cards.llm_dropped"] == 1


def test_human_edited_pending_translation_is_not_overwritten(store: Store, item_cw1: str) -> None:
    merge_output(
        store, item_cw1, output(card("la pomme", "", notes=PENDING_NOTE)), "rules", "1", T0
    )
    cid = card_id("la pomme", "vocab")
    store.conn.execute("UPDATE cards SET edited_by_human = 1 WHERE id = ?", (cid,))
    translator = FakeTranslator()

    assert retranslate_pending(store, translator, T1) == 0

    row = store.conn.execute("SELECT back_es, notes FROM cards WHERE id = ?", (cid,)).fetchone()
    assert row == ("", PENDING_NOTE) and translator.calls == []


def test_set_translation_sql_skips_human_edited_rows(store: Store, item_cw1: str) -> None:
    merge_output(
        store, item_cw1, output(card("la pomme", "", notes=PENDING_NOTE)), "rules", "1", T0
    )
    cid = card_id("la pomme", "vocab")
    store.conn.execute("UPDATE cards SET edited_by_human = 1 WHERE id = ?", (cid,))

    set_translation(store.conn, cid, "otra", T1)

    row = store.conn.execute("SELECT back_es, notes FROM cards WHERE id = ?", (cid,)).fetchone()
    assert row == ("", PENDING_NOTE)


def test_rules_cards_are_not_filtered(ctx: StageContext, item_with_text: str) -> None:
    class _RulesWithUnanchoredCard(FakeRules):
        def generate(self, inp: GenerationInput) -> GenerationOutput:
            return output(card("le dragon", "dragón"))

    report = run_cards_with(ctx, _RulesWithUnanchoredCard(), None, FakeTranslator())

    fronts = {row[0] for row in ctx.store.conn.execute("SELECT front_fr FROM cards")}
    assert fronts == {"le dragon"} and report.counts["cards.llm_dropped"] == 0
