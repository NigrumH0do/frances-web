"""Evaluación de calidad de las salidas del LLM de estudio (AI-17).

Uso::

    uv run python scripts/llm_eval.py --task {sheet,topics,plan_why,chat,all} \
        [--out DIR] [--max-cases N]

Las tareas ``cards`` y ``quiz`` se evalúan con reglas y sus tests propios
(``tests/cards`` y ``tests/study/test_quiz_rules.py``); no se piden al LLM.
Lee ``LLM_BASE_URL``, ``LLM_API_KEY`` y ``LLM_MODEL`` del entorno a través de
:mod:`frances.config` (``Settings.optional_secret``). Si falta alguna, sale con
2 sin crear el cliente ni tocar la red. Los casos salen de
``tests/fixtures/llm_eval/cases/`` y se ejecutan sin caché; cada reporte guarda
solo ``case_id``, ``ok``, ``problems`` y latencias. Nunca el texto del modelo.
"""

import argparse
import json
import math
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from frances.cards.llm import (
    CARDS_PROMPT_VERSION,
    LlmGenerator,
    LlmUnavailable,
    llm_from_env,
    render_input,
)
from frances.cards.llm import SYSTEM_PROMPT as CARDS_SYSTEM_PROMPT
from frances.config import ConfigError, load_settings, process_env
from frances.models.content import GenerationInput, GenerationOutput
from frances.study.prompts import (
    PROMPT_VERSIONS,
    SYSTEM_PROMPTS,
    render_chat_messages,
    render_plan_why_input,
    render_quiz_input,
    render_sheet_input,
    render_topics_input,
)
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
    PromptCard,
    PromptFragment,
    PromptItem,
    PromptPlanEntry,
    PromptTopic,
    QuizLlmOut,
    SheetLlmOut,
    TopicsLlmOut,
)

TASKS: tuple[str, ...] = ("sheet", "topics", "plan_why", "chat")
RULES_TASKS: tuple[str, ...] = ("cards", "quiz")
ALL_TASKS: tuple[str, ...] = RULES_TASKS + TASKS
PASS_RATE = 0.8
REQUIRED_ENV: tuple[str, ...] = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
CASES_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "llm_eval" / "cases"
DEFAULT_OUT = Path(".cache/llm_eval")


@dataclass(frozen=True)
class CaseResult:
    """Resultado de un caso: métricas y problemas, nunca la salida del modelo."""

    case_id: str
    ok: bool
    problems: list[str]
    latency_s: float
    first_token_s: float | None = None

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "case_id": self.case_id,
            "ok": self.ok,
            "problems": list(self.problems),
            "latency_s": round(self.latency_s, 3),
        }
        if self.first_token_s is not None:
            data["first_token_s"] = round(self.first_token_s, 3)
        return data


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evalúa las salidas del LLM real contra el set sintético (AI-17)."
    )
    parser.add_argument("--task", choices=[*ALL_TASKS, "all"], required=True)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--max-cases", type=_positive_int, default=None)
    return parser.parse_args(argv)


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("debe ser un entero >= 1")
    return number


def load_cases(task: str, *, max_cases: int | None = None) -> list[dict[str, Any]]:
    """Casos de ``task`` en orden estable; ``max_cases`` limita cuántos se corren."""
    paths = sorted((CASES_DIR / task).glob("*.json"))
    if max_cases is not None:
        paths = paths[:max_cases]
    cases: list[dict[str, Any]] = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    return cases


def _schema_problems(exc: ValidationError) -> list[str]:
    """Problemas de esquema sin valores de entrada (no copia texto generado)."""
    return [f"esquema: {'.'.join(map(str, error['loc']))} {error['msg']}" for error in exc.errors()]


def _eval_cards(llm: LlmGenerator, case: Mapping[str, Any]) -> list[str]:
    inp = GenerationInput.model_validate(case["input"]["generation"])
    data = llm.complete_json(
        task="cards",
        system=CARDS_SYSTEM_PROMPT,
        user=render_input(inp),
        schema=GenerationOutput,
        prompt_version=CARDS_PROMPT_VERSION,
    )
    output = GenerationOutput.model_validate(data)
    return [
        f"cards[{index}]: {problem}"
        for index, card in enumerate(output.cards)
        for problem in card_problems(card, inp)
    ]


def _eval_sheet(llm: LlmGenerator, case: Mapping[str, Any]) -> list[str]:
    inp = GenerationInput.model_validate(case["input"]["generation"])
    data = llm.complete_json(
        task="sheet",
        system=SYSTEM_PROMPTS["sheet"],
        user=render_sheet_input(inp, case["input"]["card_fronts"]),
        schema=SheetLlmOut,
        prompt_version=PROMPT_VERSIONS["sheet"],
    )
    return sheet_problems(SheetLlmOut.model_validate(data), inp)


def _eval_topics(llm: LlmGenerator, case: Mapping[str, Any]) -> list[str]:
    inp = case["input"]
    topics = [
        PromptTopic(
            id=topic["id"],
            title=topic["title"],
            description_es=topic["description_es"],
            locked=bool(topic["locked"]),
        )
        for topic in inp["topics"]
    ]
    items = [
        PromptItem(
            id=item["id"],
            title=item["title"],
            classroom_topic=item["classroom_topic"],
            summary_es=item["summary_es"],
            tags=tuple(item["tags"]),
            current_topic_id=item["current_topic_id"],
            locked=bool(item["locked"]),
        )
        for item in inp["items"]
    ]
    data = llm.complete_json(
        task="topics",
        system=SYSTEM_PROMPTS["topics"],
        user=render_topics_input(topics, items),
        schema=TopicsLlmOut,
        prompt_version=PROMPT_VERSIONS["topics"],
    )
    locked_items = {
        item["id"]: item["current_topic_id"]
        for item in inp["items"]
        if item["locked"] and item["current_topic_id"]
    }
    locked_topics = {topic["id"]: topic["title"] for topic in inp["topics"] if topic["locked"]}
    return topics_problems(
        TopicsLlmOut.model_validate(data),
        [item["id"] for item in inp["items"]],
        locked_items,
        locked_topics,
    )


def _eval_quiz(llm: LlmGenerator, case: Mapping[str, Any]) -> list[str]:
    inp = case["input"]
    cards = [
        PromptCard(kind=card["kind"], front_fr=card["front_fr"], back_es=card["back_es"])
        for card in inp["cards"]
    ]
    fragments = [
        PromptFragment(n=fragment["n"], label=fragment["label"], text=fragment["text"])
        for fragment in inp["fragments"]
    ]
    data = llm.complete_json(
        task="quiz",
        system=SYSTEM_PROMPTS["quiz"],
        user=render_quiz_input(inp["title"], inp["summaries"], cards, fragments),
        schema=QuizLlmOut,
        prompt_version=PROMPT_VERSIONS["quiz"],
    )
    output = QuizLlmOut.model_validate(data)
    return [
        f"preguntas[{index}]: {problem}"
        for index, question in enumerate(output.questions)
        for problem in question_problems(question, len(fragments))
    ]


def _eval_plan_why(llm: LlmGenerator, case: Mapping[str, Any]) -> list[str]:
    inp = case["input"]
    entries = [
        PromptPlanEntry(
            position=entry["position"],
            kind=entry["kind"],
            title_es=entry["title_es"],
            reason_es=entry["reason_es"],
        )
        for entry in inp["entries"]
    ]
    data = llm.complete_json(
        task="plan_why",
        system=SYSTEM_PROMPTS["plan_why"],
        user=render_plan_why_input(entries),
        schema=PlanWhyLlmOut,
        prompt_version=PROMPT_VERSIONS["plan_why"],
    )
    return plan_why_problems(
        PlanWhyLlmOut.model_validate(data), [entry["position"] for entry in inp["entries"]]
    )


def _eval_chat(llm: LlmGenerator, case: Mapping[str, Any]) -> tuple[list[str], float | None]:
    """Mide el primer token además del tiempo total; el texto no sale de aquí."""
    inp = case["input"]
    fragments = [
        PromptFragment(n=fragment["n"], label=fragment["label"], text=fragment["text"])
        for fragment in inp["fragments"]
    ]
    messages = render_chat_messages(inp["question"], fragments, [])
    started = time.perf_counter()
    first_token_s: float | None = None
    parts: list[str] = []
    try:
        for piece in llm.stream_chat(messages, task="chat", prompt_version=PROMPT_VERSIONS["chat"]):
            if first_token_s is None:
                first_token_s = time.perf_counter() - started
            parts.append(piece)
    except LlmUnavailable as exc:
        return [str(exc)], first_token_s
    return chat_problems("".join(parts), len(fragments)), first_token_s


def _evaluate_case(llm: LlmGenerator, case: Mapping[str, Any]) -> CaseResult:
    started = time.perf_counter()
    first_token_s: float | None = None
    task = str(case["task"])
    try:
        if task == "cards":
            problems = _eval_cards(llm, case)
        elif task == "sheet":
            problems = _eval_sheet(llm, case)
        elif task == "topics":
            problems = _eval_topics(llm, case)
        elif task == "quiz":
            problems = _eval_quiz(llm, case)
        elif task == "plan_why":
            problems = _eval_plan_why(llm, case)
        elif task == "chat":
            problems, first_token_s = _eval_chat(llm, case)
        else:
            problems = [f"tarea desconocida: {task}"]
    except ValidationError as exc:
        problems = _schema_problems(exc)
    except LlmUnavailable as exc:
        problems = [str(exc)]
    except Exception as exc:  # un caso roto no debe tumbar la corrida
        problems = [f"error inesperado: {type(exc).__name__}"]
    return CaseResult(
        case_id=str(case["case_id"]),
        ok=not problems,
        problems=problems,
        latency_s=time.perf_counter() - started,
        first_token_s=first_token_s,
    )


def _percentile(values: Sequence[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(math.ceil(pct / 100 * len(ordered)) - 1, 0)
    return round(ordered[index], 3)


def _prompt_version(task: str) -> str:
    return CARDS_PROMPT_VERSION if task == "cards" else PROMPT_VERSIONS[task]


def evaluate_task(llm: LlmGenerator, task: str, *, max_cases: int | None = None) -> dict[str, Any]:
    """Corre los casos de una tarea y arma el reporte sin texto generado."""
    results = [_evaluate_case(llm, case) for case in load_cases(task, max_cases=max_cases)]
    total = len(results)
    passed = sum(result.ok for result in results)
    report: dict[str, Any] = {
        "task": task,
        "model": llm.model,
        "prompt_version": _prompt_version(task),
        "total": total,
        "passed": passed,
        "pass_rate": round(passed / total, 4) if total else 0.0,
        "threshold": PASS_RATE,
        "p50_s": _percentile([result.latency_s for result in results], 50),
        "p95_s": _percentile([result.latency_s for result in results], 95),
        "cases": [result.to_json() for result in results],
    }
    if task == "chat":
        first_tokens = [
            result.first_token_s for result in results if result.first_token_s is not None
        ]
        complete = total > 0 and len(first_tokens) == total
        report["first_token_p50_s"] = _percentile(first_tokens, 50) if complete else None
        report["first_token_p95_s"] = _percentile(first_tokens, 95) if complete else None
    return report


def write_report(out_dir: Path, report: Mapping[str, Any]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{report['task']}.json"
    path.write_text(
        json.dumps(dict(report), indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _meets_threshold(report: Mapping[str, Any]) -> bool:
    total = int(report["total"])
    passed = int(report["passed"])
    return total > 0 and passed * 5 >= total * 4


def _summary(report: Mapping[str, Any]) -> str:
    line = (
        f"{report['task']}: {report['passed']}/{report['total']} aprobados "
        f"({float(report['pass_rate']) * 100:.1f} %), "
        f"p50 {float(report['p50_s']):.1f} s, p95 {float(report['p95_s']):.1f} s"
    )
    first_token_p95 = report.get("first_token_p95_s")
    if report["task"] == "chat":
        if first_token_p95 is None:
            line += ", primer token p95 sin datos"
        else:
            line += f", primer token p95 {float(first_token_p95):.1f} s"
    return line


def main(argv: Sequence[str] | None = None, *, env: Mapping[str, str] | None = None) -> int:
    """Corre la evaluación; 0 si pasa el umbral, 1 si no, 2 si falta el entorno."""
    args = _parse_args(argv)
    if args.task in RULES_TASKS:
        print(
            f"{args.task}: se evalúa con reglas (sin LLM); "
            "ver tests/cards y tests/study/test_quiz_rules.py"
        )
        return 0
    effective_env = dict(process_env() if env is None else env)
    try:
        settings = load_settings(Path("frances.toml"), effective_env)
    except ConfigError as exc:
        print(f"config inválida: {exc}", file=sys.stderr)
        return 2

    missing = [name for name in REQUIRED_ENV if not settings.optional_secret(name)]
    if missing:
        print("faltan variables de entorno: " + ", ".join(missing), file=sys.stderr)
        return 2
    llm = llm_from_env(effective_env, timeout_s=float(settings.llm.timeout_s))
    if llm is None:
        print("faltan variables de entorno del LLM", file=sys.stderr)
        return 2

    tasks = TASKS if args.task == "all" else (args.task,)
    reports = []
    for task in tasks:
        report = evaluate_task(llm, task, max_cases=args.max_cases)
        write_report(args.out, report)
        print(_summary(report))
        reports.append(report)
    return 0 if all(_meets_threshold(report) for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
