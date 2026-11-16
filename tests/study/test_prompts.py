"""Prompts versionados, renderizadores de entrada y esquemas de salida (AI-02)."""

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from frances.cards.llm import strict_schema_for
from frances.models.content import GenerationInput, TextBlock
from frances.study.prompts import (
    MAX_QUIZ_INPUT_CHARS,
    MAX_TOPICS_INPUT_CHARS,
    PROMPT_VERSIONS,
    SCHEMAS,
    SYSTEM_PROMPTS,
    render_chat_messages,
    render_plan_why_input,
    render_quiz_input,
    render_sheet_input,
    render_topics_input,
)
from frances.study.schemas import (
    PromptCard,
    PromptFragment,
    PromptItem,
    PromptPlanEntry,
    PromptTopic,
)

_LOCK_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval" / "prompts.lock.json"


@pytest.fixture
def synthetic_items() -> Callable[[int], list[PromptItem]]:
    """Publicaciones sintéticas, todas con tema actual y sin fijar."""

    def build(count: int) -> list[PromptItem]:
        return [
            PromptItem(
                id=f"cw_{i:04d}",
                title=f"Clase sintética {i}",
                classroom_topic="Tema de prueba",
                summary_es="Resumen sintético de una clase de prueba con varias palabras.",
                tags=("verbos", "fecha"),
                current_topic_id="tp_1",
                locked=False,
            )
            for i in range(count)
        ]

    return build


def test_prompt_lock_matches_system_text() -> None:  # REVIEW FOCUS P10-3
    lock = json.loads(_LOCK_PATH.read_text(encoding="utf-8"))
    for task, text in SYSTEM_PROMPTS.items():
        assert lock[task] == {
            "version": PROMPT_VERSIONS[task],
            "system_sha256": hashlib.sha256(text.encode()).hexdigest(),
        }, f"cambiaste el prompt {task}: sube su versión en PROMPT_VERSIONS y en prompts.lock.json"


def test_renderers_are_deterministic_and_bounded(
    synthetic_items: Callable[[int], list[PromptItem]],
) -> None:
    a = render_topics_input([], synthetic_items(400))
    b = render_topics_input([], list(reversed(synthetic_items(400))))
    assert a == b
    assert len(a) <= MAX_TOPICS_INPUT_CHARS + 80
    assert "publicaciones antiguas omitidas" in a


def test_locked_marks_in_topics_input() -> None:
    text = render_topics_input(
        [PromptTopic("tp_1", "Saludos", "d", True)],
        [PromptItem("cw_1", "Clase 1", None, "r", (), "tp_1", True)],
    )
    assert "[fijo] tp_1 | Saludos" in text
    assert "[fija] cw_1 | tema actual: tp_1" in text


def test_chat_messages_number_fragments_and_keep_history() -> None:
    msgs = render_chat_messages(
        "¿Qué es «la pomme»?",
        [PromptFragment(1, "Clase 1", "la pomme = manzana")],
        [("user", "hola"), ("assistant", "¡hola!")],
    )
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert "[1] (Clase 1) la pomme" in msgs[-1]["content"]


def test_output_schemas_are_strict_compatible() -> None:
    for model in SCHEMAS.values():
        schema = strict_schema_for(model)
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(model.model_fields)


def test_quiz_input_is_bounded_and_ignores_arrival_order() -> None:
    fragments = [PromptFragment(n, "Clase 1", "palabra " * 200) for n in range(1, 30)]
    cards = [PromptCard("vocab", "la pomme", "manzana")]
    text = render_quiz_input("Tema", ["resumen"], cards, fragments)
    assert len(text) <= MAX_QUIZ_INPUT_CHARS
    assert "[1] (Clase 1)" in text and "[29] (" not in text
    assert text == render_quiz_input("Tema", ["resumen"], cards, list(reversed(fragments)))


def test_sheet_and_plan_inputs_ignore_arrival_order() -> None:
    inp = GenerationInput(
        item_id="cw_1",
        title="Clase 1",
        blocks=[TextBlock(text="Bonjour.", lang="fr", source="item")],
        input_hash="h",
    )
    assert render_sheet_input(inp, ["b", "A"]) == render_sheet_input(inp, ["A", "b"])
    entries = [PromptPlanEntry(2, "quiz", "B", "motivo"), PromptPlanEntry(1, "review", "A", "m")]
    assert render_plan_why_input(entries) == render_plan_why_input(list(reversed(entries)))
