"""Evaluación de calidad con el LLM real (AI-17).

Los tests que llaman al LLM llevan ``@pytest.mark.heavy`` y se saltan si faltan
``LLM_BASE_URL``/``LLM_API_KEY``/``LLM_MODEL``. Los tests offline cubren el
Review Focus: sin entorno no se construye ningún cliente y ningún reporte
guarda texto generado.
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from frances.config import process_env

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "llm_eval.py"
_TASKS = ("cards", "sheet", "topics", "plan_why", "chat")
_REQUIRED_ENV = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")
_GENERATED_SENTINEL = "TEXTO-GENERADO-QUE-NO-DEBE-GUARDARSE"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("llm_eval", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["llm_eval"] = module
    spec.loader.exec_module(module)
    return module


llm_eval = _load_script()


@pytest.fixture
def llm_env() -> dict[str, str]:
    env = process_env()
    missing = [name for name in _REQUIRED_ENV if not env.get(name)]
    if missing:
        pytest.skip("faltan " + ", ".join(missing))
    return {name: env[name] for name in _REQUIRED_ENV}


@pytest.mark.heavy
@pytest.mark.parametrize("task", _TASKS)
def test_real_llm_meets_quality_bar(
    task: str, tmp_path: Path, llm_env: dict[str, str], socket_enabled: None
) -> None:
    # `socket_enabled` revierte el `--disable-socket` global solo para este test heavy.
    code = llm_eval.main(["--task", task, "--out", str(tmp_path)], env=llm_env)
    report = json.loads((tmp_path / f"{task}.json").read_text(encoding="utf-8"))
    assert code == 0, [case["problems"] for case in report["cases"] if not case["ok"]]


@pytest.mark.heavy
def test_chat_first_token_under_30s(
    tmp_path: Path, llm_env: dict[str, str], socket_enabled: None
) -> None:
    llm_eval.main(["--task", "chat", "--out", str(tmp_path)], env=llm_env)
    report = json.loads((tmp_path / "chat.json").read_text(encoding="utf-8"))
    first_token_p95 = report["first_token_p95_s"]
    assert first_token_p95 is not None
    assert first_token_p95 < 30


def test_quiz_is_rules_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def _no_client(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("quiz no debe construir el cliente del LLM")

    monkeypatch.setattr(llm_eval, "llm_from_env", _no_client)
    assert llm_eval.main(["--task", "quiz", "--out", str(tmp_path)], env={}) == 0
    assert "reglas" in capsys.readouterr().out
    assert not (tmp_path / "quiz.json").exists()


def test_missing_env_exits_2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def _no_client(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("sin entorno no se debe construir el cliente del LLM")

    monkeypatch.setattr(llm_eval, "llm_from_env", _no_client)
    assert llm_eval.main(["--task", "sheet", "--out", str(tmp_path)], env={}) == 2
    captured = capsys.readouterr()
    assert "LLM_BASE_URL" in captured.err
    assert not (tmp_path / "sheet.json").exists()
    for missing in _REQUIRED_ENV:
        partial = {name: "x" for name in _REQUIRED_ENV if name != missing}
        assert llm_eval.main(["--task", "sheet", "--out", str(tmp_path)], env=partial) == 2
    assert not (tmp_path / "sheet.json").exists()


class _InvalidOutputLlm:
    """Devuelve una salida con forma rota y un texto único, sin tocar la red."""

    model = "modelo-falso"

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type[Any],
        prompt_version: str,
    ) -> dict[str, Any]:
        return {"cards": _GENERATED_SENTINEL, "sheet": {}}


def test_reports_never_store_generated_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(llm_eval, "llm_from_env", lambda *args, **kwargs: _InvalidOutputLlm())
    env = {name: "x" for name in _REQUIRED_ENV}
    code = llm_eval.main(["--task", "sheet", "--max-cases", "1", "--out", str(tmp_path)], env=env)
    assert code == 1
    report = json.loads((tmp_path / "sheet.json").read_text(encoding="utf-8"))
    assert report["cases"]
    for case in report["cases"]:
        assert set(case) == {"case_id", "ok", "problems", "latency_s"}
        assert case["ok"] is False
        assert case["problems"]
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert _GENERATED_SENTINEL not in path.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert _GENERATED_SENTINEL not in captured.out
    assert _GENERATED_SENTINEL not in captured.err
