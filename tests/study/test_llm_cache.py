"""Caché del LLM por sha256 de (tarea, entrada, versión de prompt, modelo) (AI-01)."""

from collections.abc import Callable
from datetime import datetime

import pytest
from pydantic import BaseModel, ConfigDict

from frances.cards.llm import LlmUnavailable
from frances.db.store import Store
from frances.models import llm_cache_key
from frances.study.llm_cache import LlmRejected, cache_put, cached_json

from .conftest import FakeLlm


class Out(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    summary_es: str


def test_same_input_does_not_call_llm_twice(store: Store, clock: Callable[[], datetime]) -> None:
    llm = FakeLlm(model="m1", replies=[{"summary_es": "uno"}])
    a = cached_json(
        store,
        llm,
        task="sheet",
        system="s",
        user="texto",
        schema=Out,
        prompt_version="sheet-1",
        now=clock,
    )
    b = cached_json(
        store,
        llm,
        task="sheet",
        system="s",
        user="texto",
        schema=Out,
        prompt_version="sheet-1",
        now=clock,
    )
    assert (a.hit, b.hit, b.data, llm.calls) == (False, True, {"summary_es": "uno"}, 1)
    assert store.conn.execute("SELECT hits FROM llm_cache").fetchone()[0] == 1


def test_cache_key_is_the_sha256_of_the_inputs(store: Store, clock: Callable[[], datetime]) -> None:
    llm = FakeLlm(model="m1", replies=[{"summary_es": "x"}])
    result = cached_json(
        store,
        llm,
        task="sheet",
        system="s",
        user="texto",
        schema=Out,
        prompt_version="sheet-1",
        now=clock,
    )
    assert result.key == llm_cache_key("sheet", "texto", "sheet-1", "m1")
    assert result.hit is False


@pytest.mark.parametrize(
    "change",
    [
        {"prompt_version": "sheet-2"},
        {"model": "m2"},
        {"user": "otro"},
        {"task": "quiz"},
    ],
)
def test_key_changes_force_a_new_call(
    store: Store, clock: Callable[[], datetime], change: dict[str, str]
) -> None:
    base = {"task": "sheet", "user": "texto", "prompt_version": "sheet-1", "model": "m1"}
    llm = FakeLlm(model="m1", replies=[{"summary_es": "x"}, {"summary_es": "y"}])
    cached_json(
        store,
        llm,
        system="s",
        schema=Out,
        now=clock,
        task=base["task"],
        user=base["user"],
        prompt_version=base["prompt_version"],
    )
    params = base | change
    llm.model = params.pop("model")
    again = cached_json(store, llm, system="s", schema=Out, now=clock, **params)
    assert again.hit is False
    assert llm.calls == 2


def test_rejected_output_is_not_cached(store: Store, clock: Callable[[], datetime]) -> None:
    llm = FakeLlm(model="m", replies=[{"summary_es": ""}, {"summary_es": "bien"}])

    def accept(data: dict[str, str]) -> list[str]:
        return [] if data["summary_es"] else ["resumen vacío"]

    with pytest.raises(LlmRejected) as rejected:
        cached_json(
            store,
            llm,
            task="sheet",
            system="s",
            user="u",
            schema=Out,
            prompt_version="v",
            now=clock,
            accept=accept,
        )
    assert rejected.value.problems == ["resumen vacío"]
    assert isinstance(rejected.value, LlmUnavailable)

    retry = cached_json(
        store,
        llm,
        task="sheet",
        system="s",
        user="u",
        schema=Out,
        prompt_version="v",
        now=clock,
        accept=accept,
    )
    assert retry.hit is False
    assert retry.data == {"summary_es": "bien"}
    assert llm.calls == 2


def test_no_transaction_open_during_llm_call(store: Store, clock: Callable[[], datetime]) -> None:
    seen: list[bool] = []
    llm = FakeLlm(
        model="m",
        replies=[{"summary_es": "x"}],
        on_call=lambda: seen.append(store.conn.in_transaction),
    )
    cached_json(
        store,
        llm,
        task="t",
        system="s",
        user="u",
        schema=Out,
        prompt_version="v",
        now=clock,
    )
    assert seen == [False]


def test_corrupt_cache_entry_is_replaced(store: Store, clock: Callable[[], datetime]) -> None:
    key = llm_cache_key("sheet", "u", "v", "m")
    with store.tx() as conn:
        cache_put(
            conn,
            key=key,
            task="sheet",
            prompt_version="v",
            model="m",
            user_text="u",
            output={"otro_campo": 1},
            now="2026-11-03T01:00:00Z",
        )
    llm = FakeLlm(model="m", replies=[{"summary_es": "nuevo"}])
    result = cached_json(
        store,
        llm,
        task="sheet",
        system="s",
        user="u",
        schema=Out,
        prompt_version="v",
        now=clock,
    )
    assert result.hit is False
    assert result.data == {"summary_es": "nuevo"}
    assert llm.calls == 1
