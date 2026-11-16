"""Ficha de estudio ampliada por publicación (AI-06).

La ficha base la deja CRD-05; esta capa la amplía con objetivos, gramática,
frases clave y errores típicos. Una ficha editada por el admin nunca se
reescribe y, sin LLM, la ficha base sigue visible.
"""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.cards.llm import LlmBudgetExceeded, LlmUnavailable
from frances.cards.merge import merge_output

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.db import store as _store  # noqa: F401
from frances.models import (
    CardDraft,
    Example,
    GenerationOutput,
    SheetDraft,
    StudySheet,
    card_id,
)
from frances.stage import StageContext, make_context
from frances.study.prompts import PROMPT_VERSIONS
from frances.study.schemas import SheetLlmOut
from frances.study.sheet import (
    build_sheet_request,
    items_needing_sheet,
    run_sheets,
    sheet_from_output,
    write_study_sheet,
)
from tests.study.conftest import FakeLlm

_NOW = "2026-11-03T01:00:00.000000Z"
_CLOCK = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)
_EVAL_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval" / "cases"

_SALUDOS_TEXT = (
    "Bonjour, comment ça va aujourd'hui ? Très bien, merci !\n\n"
    "Esta lección presenta los saludos formales e informales.\n\n"
    "Salut ! Ça va ? Oui, ça va bien, merci."
)


def eval_case(task: str, case_id: str) -> dict[str, Any]:
    """Caso sintético del set de evaluación del LLM (AI-03)."""
    data: dict[str, Any] = json.loads(
        (_EVAL_DIR / task / f"{case_id}.json").read_text(encoding="utf-8")
    )
    return data


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    """Contexto con reloj fijo y sin red; la base se cierra al terminar."""
    context = replace(make_context(tmp_path, {}), now=lambda: _CLOCK)
    try:
        context.store.conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_NOW,),
        )
        yield context
    finally:
        context.store.close()


def _item(
    conn: sqlite3.Connection,
    item_id: str,
    *,
    text: str = "",
    first_seen_at: str = _NOW,
    with_generation: bool = True,
) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (
            item_id,
            item_id,
            f"Clase {item_id}",
            text,
            _NOW,
            _NOW,
            f"{item_id}-h",
            first_seen_at,
            _NOW,
        ),
    )
    if with_generation:
        conn.execute(
            "INSERT INTO generations"
            " (item_id, input_hash, generator, generator_version, created_at)"
            " VALUES (?, ?, 'llm', '1', ?)",
            (item_id, f"{item_id}-input", _NOW),
        )


def _base_output(*, summary: str = "Resumen base de la ficha.") -> GenerationOutput:
    """Salida de CRD-05 con una tarjeta vocab y otra que no es vocab."""
    return GenerationOutput(
        cards=[
            CardDraft(kind="vocab", front_fr="bonjour", back_es="buenos días"),
            CardDraft(kind="drill", front_fr="Très bien, merci", back_es="Muy bien, gracias"),
        ],
        sheet=SheetDraft(
            summary_es=summary,
            vocab_fronts=["bonjour", "Très bien, merci"],
            grammar=[],
            key_phrases=[],
        ),
    )


@pytest.fixture
def generated_item(ctx: StageContext) -> str:
    """`cw_1` con texto, tarjetas y ficha base ya escritas por CRD-05."""
    _item(ctx.store.conn, "cw_1", text=_SALUDOS_TEXT)
    merge_output(ctx.store, "cw_1", _base_output(), "llm", "1", _NOW)
    return "cw_1"


@pytest.fixture
def three_generated_items(ctx: StageContext) -> list[str]:
    """Tres publicaciones con `generations` y sin ficha: candidatas al run."""
    ids = ["cw_1", "cw_2", "cw_3"]
    for position, item_id in enumerate(ids):
        _item(
            ctx.store.conn,
            item_id,
            text=f"Bonjour {position}.",
            first_seen_at=f"2026-11-0{position + 1}T10:00:00.000000Z",
        )
    return ids


def sheet_json(ctx: StageContext, item_id: str) -> str:
    row = ctx.store.conn.execute("SELECT json FROM sheets WHERE item_id = ?", (item_id,)).fetchone()
    assert row is not None
    return str(row[0])


def sheet_generator(ctx: StageContext, item_id: str) -> tuple[str, str]:
    row = ctx.store.conn.execute(
        "SELECT generator, generator_version FROM sheets WHERE item_id = ?", (item_id,)
    ).fetchone()
    assert row is not None
    return str(row[0]), str(row[1])


def rerun_cards_upgrade(ctx: StageContext, item_id: str) -> None:
    """CRD-05 reescribe la ficha base con la misma entrada (p. ej. sube versión)."""
    merge_output(ctx.store, item_id, _base_output(summary="Resumen base v2."), "llm", "2", _NOW)


def test_sheet_extends_base_and_links_vocab(ctx: StageContext, generated_item: str) -> None:
    llm = FakeLlm(model="m", replies=[eval_case("sheet", "saludos")["expected"]])

    res = run_sheets(ctx, llm)

    sheet = StudySheet.model_validate_json(sheet_json(ctx, "cw_1"))
    assert res.written == ["cw_1"] and sheet.prompt_version == "sheet-1"
    assert sheet.objectives_es and sheet.common_mistakes
    # Solo los fronts que existen como tarjeta vocab; el drill no entra.
    assert sheet.vocab_card_ids == [card_id("bonjour", "vocab")]
    assert sheet_generator(ctx, "cw_1") == ("study", "sheet-1")


def test_second_run_is_noop_and_cache_survives_base_rewrite(
    ctx: StageContext, generated_item: str
) -> None:
    llm = FakeLlm(model="m", replies=[eval_case("sheet", "saludos")["expected"]])
    run_sheets(ctx, llm)
    assert items_needing_sheet(ctx.store.conn, "sheet-1") == []

    rerun_cards_upgrade(ctx, "cw_1")

    res = run_sheets(ctx, llm)
    assert res.cached == 1 and llm.calls == 1
    assert sheet_generator(ctx, "cw_1") == ("study", "sheet-1")


def test_human_edited_sheet_is_skipped(ctx: StageContext, generated_item: str) -> None:
    ctx.store.conn.execute("UPDATE sheets SET edited_by_human = 1 WHERE item_id = 'cw_1'")

    assert items_needing_sheet(ctx.store.conn, "sheet-1") == []
    assert run_sheets(ctx, FakeLlm(model="m", replies=[])).written == []


def test_write_study_sheet_never_overwrites_human_edit(
    ctx: StageContext, generated_item: str
) -> None:
    """REVIEW FOCUS: la protección está en el SQL, aunque se llame directo."""
    before = sheet_json(ctx, "cw_1")
    ctx.store.conn.execute("UPDATE sheets SET edited_by_human = 1 WHERE item_id = 'cw_1'")
    replacement = StudySheet(
        item_id="cw_1",
        summary_es="Resumen nuevo que no debe pisar la edición.",
        vocab_card_ids=[],
        grammar=[],
        key_phrases=[],
        prompt_version="sheet-1",
    )

    assert write_study_sheet(ctx.store.conn, replacement, _NOW) is False
    assert sheet_json(ctx, "cw_1") == before


def test_llm_off_keeps_base_sheet(ctx: StageContext, generated_item: str) -> None:
    before = sheet_json(ctx, "cw_1")

    res = run_sheets(ctx, None)

    assert res.pending == 1 and res.written == []
    assert sheet_generator(ctx, "cw_1")[0] in {"llm", "rules"}
    assert sheet_json(ctx, "cw_1") == before


def test_breaker_and_budget(ctx: StageContext, three_generated_items: list[str]) -> None:
    down = run_sheets(
        ctx,
        FakeLlm(model="m", replies=[LlmUnavailable("x"), LlmUnavailable("y"), {"never": 1}]),
    )
    assert down.llm_down and down.pending == 1 and len(down.failed) == 2

    broke = run_sheets(ctx, FakeLlm(model="m", replies=[LlmBudgetExceeded("tope")]))
    assert broke.budget_exhausted and broke.written == []


def test_rejected_output_counts_as_failure_and_is_not_cached(
    ctx: StageContext, generated_item: str
) -> None:
    bad = eval_case("sheet", "saludos")["bad"][0]["output"]

    res = run_sheets(ctx, FakeLlm(model="m", replies=[bad, bad]))

    assert res.failed == ["cw_1"]
    assert ctx.store.conn.execute("SELECT COUNT(*) FROM llm_cache").fetchone()[0] == 0


def test_ungrounded_key_phrases_are_dropped(ctx: StageContext, generated_item: str) -> None:
    out = SheetLlmOut.model_validate(eval_case("sheet", "saludos")["expected"])
    invented = Example(fr="Je mange une pomme.", es="Como una manzana.")
    out = out.model_copy(update={"key_phrases": [*out.key_phrases, invented]})
    req = build_sheet_request(ctx.store, ctx.paths, "cw_1")

    sheet = sheet_from_output(req, out, "sheet-1")

    assert invented not in sheet.key_phrases
    assert len(sheet.key_phrases) == len(out.key_phrases) - 1


def test_items_needing_sheet_requires_a_generation_row(ctx: StageContext) -> None:
    _item(ctx.store.conn, "cw_1", text="Bonjour.", with_generation=False)

    assert items_needing_sheet(ctx.store.conn, PROMPT_VERSIONS["sheet"]) == []


def test_identical_mistake_is_dropped_instead_of_rejecting_the_sheet(
    ctx: StageContext, generated_item: str
) -> None:
    """Un error típico con wrong_fr == right_fr no tira toda la ficha (ADR-019)."""
    reply = json.loads(json.dumps(eval_case("sheet", "saludos")["expected"]))
    good = list(reply["common_mistakes"])
    reply["common_mistakes"] = [
        *good,
        {"wrong_fr": "Bonjour", "right_fr": "Bonjour", "why_es": "Nada que corregir."},
    ]
    llm = FakeLlm(model="m", replies=[reply])

    res = run_sheets(ctx, llm)

    assert res.written == ["cw_1"] and res.failed == []
    sheet = StudySheet.model_validate_json(sheet_json(ctx, "cw_1"))
    assert len(sheet.common_mistakes) == len(good)
    assert all(m.wrong_fr != m.right_fr for m in sheet.common_mistakes)
