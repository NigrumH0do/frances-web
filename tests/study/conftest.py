"""Fixtures de la capa de estudio: LLM falso, almacén, reloj y contexto de etapa (AI-01)."""

from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.db.store import Store
from frances.paths import DataPaths
from frances.stage import StageContext, make_context

LLM_ENV = {
    "LLM_BASE_URL": "https://llm.test/v1",
    "LLM_API_KEY": "clave-de-prueba",
    "LLM_MODEL": "modelo-de-prueba",
}


class FakeLlm:
    """Cumple `JsonLlm`: sirve `replies` en orden; una excepción en la lista se lanza."""

    def __init__(
        self,
        model: str,
        replies: list[Any],
        on_call: Callable[[], None] | None = None,
    ) -> None:
        self.model = model
        self.calls = 0
        self._replies = list(replies)
        self._on_call = on_call

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type,
        prompt_version: str,
        **_: Any,
    ) -> dict[str, Any]:
        self.calls += 1
        if self._on_call is not None:
            self._on_call()
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return dict(reply)


@pytest.fixture
def clock() -> Callable[[], datetime]:
    fixed = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)
    return lambda: fixed


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = Store.open(tmp_path / "state.db")
    yield opened
    opened.close()


@pytest.fixture
def ctx_factory(tmp_path: Path) -> Iterator[Callable[..., StageContext]]:
    contexts: list[StageContext] = []
    counter = [0]

    def build(toml: str = "", env: Mapping[str, str] | None = None) -> StageContext:
        counter[0] += 1
        data_dir = tmp_path / f"datos-{counter[0]}"
        paths = DataPaths(data_dir)
        paths.ensure_dirs()
        if toml:
            paths.config.write_text(toml, encoding="utf-8")
        context = make_context(data_dir, dict(env or {}))
        contexts.append(context)
        return context

    yield build
    for context in contexts:
        context.store.close()
