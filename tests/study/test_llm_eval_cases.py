"""Set de evaluación del LLM: casos sintéticos, al día con build_eval.py y validados (AI-03)."""

import importlib.util
import json
import re
from collections import Counter
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from frances.models.content import GenerationInput, GenerationOutput
from frances.study.prompts import SCHEMAS
from frances.study.quality import (
    card_problems,
    chat_problems,
    plan_why_problems,
    question_problems,
    sheet_problems,
    topics_problems,
)
from frances.study.schemas import (
    PlanWhyLlmOut,
    QuizLlmOut,
    SheetLlmOut,
    TopicsLlmOut,
)

EVAL_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval"
CASES_DIR = EVAL_DIR / "cases"
CASES = sorted(CASES_DIR.rglob("*.json"))
TASKS = ("cards", "sheet", "topics", "quiz", "plan_why", "chat")
FORBIDDEN = re.compile(r"@|unal\.edu|classroom\.google|\b\d{11,}\b")


def _load_build_eval() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_eval", EVAL_DIR / "build_eval.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_eval = _load_build_eval()


def _read(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def _schema_errors(model: type[BaseModel], output: Any) -> list[str]:
    try:
        model.model_validate(output)
    except ValidationError as exc:
        return [f"esquema: {'.'.join(map(str, e['loc']))} {e['msg']}" for e in exc.errors()]
    return []


def _schema_only(case: dict[str, Any], output: dict[str, Any]) -> list[str]:
    """Errores de esquema de la salida. Una variante `bad` debe pasarlo: su fallo es de calidad."""
    task = case["task"]
    if task == "chat":
        return []
    model = GenerationOutput if task == "cards" else SCHEMAS[task]
    return _schema_errors(model, output)


def problems_for(case: dict[str, Any], output: dict[str, Any]) -> list[str]:
    """Despacha la salida al validador de su tarea, después de validar el esquema."""
    task = case["task"]
    inp = case["input"]
    if task == "chat":
        return chat_problems(output["text"], len(inp["fragments"]))
    errors = _schema_only(case, output)
    if errors:
        return errors
    if task == "cards":
        gen = GenerationInput.model_validate(inp["generation"])
        parsed = GenerationOutput.model_validate(output)
        return [
            f"cards[{i}]: {problem}"
            for i, card in enumerate(parsed.cards)
            for problem in card_problems(card, gen)
        ]
    if task == "sheet":
        gen = GenerationInput.model_validate(inp["generation"])
        return sheet_problems(SheetLlmOut.model_validate(output), gen)
    if task == "topics":
        items = inp["items"]
        locked_items = {
            i["id"]: i["current_topic_id"] for i in items if i["locked"] and i["current_topic_id"]
        }
        locked_topics = {t["id"]: t["title"] for t in inp["topics"] if t["locked"]}
        return topics_problems(
            TopicsLlmOut.model_validate(output),
            [i["id"] for i in items],
            locked_items,
            locked_topics,
        )
    if task == "quiz":
        parsed = QuizLlmOut.model_validate(output)
        fragments = len(inp["fragments"])
        return [
            f"preguntas[{i}]: {problem}"
            for i, question in enumerate(parsed.questions)
            for problem in question_problems(question, fragments)
        ]
    if task == "plan_why":
        positions = [entry["position"] for entry in inp["entries"]]
        return plan_why_problems(PlanWhyLlmOut.model_validate(output), positions)
    raise AssertionError(f"tarea desconocida: {task}")


def test_cases_are_synthetic_and_up_to_date(tmp_path: Path) -> None:
    assert CASES, "no hay casos en tests/fixtures/llm_eval/cases"
    build_eval.build(tmp_path)
    generated = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*.json"))
    committed = sorted(p.relative_to(CASES_DIR) for p in CASES)
    assert generated == committed
    for path in CASES:
        text = path.read_text(encoding="utf-8")
        assert json.loads(text)["synthetic"] is True
        assert (tmp_path / path.relative_to(CASES_DIR)).read_text(encoding="utf-8") == text
        assert not FORBIDDEN.search(text), path


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_case_metadata_matches_its_path(path: Path) -> None:
    case = _read(path)
    assert case["task"] == path.parent.name
    assert case["case_id"] == path.stem


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_expected_passes(path: Path) -> None:
    case = _read(path)
    assert _schema_only(case, case["expected"]) == []
    assert problems_for(case, case["expected"]) == []


@pytest.mark.parametrize("path", CASES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_bad_fails_for_the_reason_it_names(path: Path) -> None:
    case = _read(path)
    assert case["bad"], "cada caso necesita al menos una variante rota"
    for bad in case["bad"]:
        output = bad["output"]
        assert _schema_only(case, output) == [], "la variante debe ser válida por esquema"
        found = problems_for(case, output)
        assert any(bad["problem"] in p for p in found), found


def test_minimum_cases_per_task() -> None:
    counts = Counter(p.parent.name for p in CASES)
    assert set(counts) == set(TASKS)
    assert all(counts[task] >= 4 for task in TASKS), counts


def test_chat_has_two_cases_without_material() -> None:
    no_material = [
        p
        for p in CASES
        if p.parent.name == "chat"
        and _read(p)["expected"]["text"].startswith("El material del curso no cubre")
    ]
    assert len(no_material) >= 2
