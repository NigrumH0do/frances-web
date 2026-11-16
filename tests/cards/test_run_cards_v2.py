"""Etapa cards v2: --llm con mode, tope diario y LlmBudgetExceeded [CHG-08]."""

import dataclasses

import httpx
import pytest
import respx

from frances.cards.llm import DailyCallMeter, LlmGenerator
from frances.cards.rules import RulesGenerator
from frances.cards.run import _resolve_llm, run_cards_with
from frances.errors import ConfigError
from frances.stage import StageContext
from tests.cards.test_run import FakeTranslator

BASE = "https://llm.test/v1"
URL = f"{BASE}/chat/completions"
LLM_ENV = {"LLM_BASE_URL": BASE, "LLM_API_KEY": "k", "LLM_MODEL": "m"}


def _with_env(ctx: StageContext, env: dict[str, str]) -> StageContext:
    return dataclasses.replace(ctx, env=env)


def _llm_with_meter(ctx: StageContext) -> LlmGenerator:
    meter = DailyCallMeter(ctx.store, ctx.now, ctx.settings.llm.max_calls_per_day)
    return LlmGenerator(BASE, "k", "m", meter=meter)


def test_resolve_llm_auto_needs_mode_auto_and_env(ctx: StageContext) -> None:
    env_ctx = _with_env(ctx, LLM_ENV)
    assert _resolve_llm(env_ctx, None) is True
    env_ctx.settings.llm.mode = "off"
    assert _resolve_llm(env_ctx, None) is False


def test_llm_mode_off_disables_cards_llm(ctx: StageContext) -> None:
    off_ctx = _with_env(ctx, LLM_ENV)
    off_ctx.settings.llm.mode = "off"
    assert _resolve_llm(off_ctx, None) is False
    with pytest.raises(ConfigError, match=r"llm\.mode"):
        _resolve_llm(off_ctx, True)


def test_budget_exhausted_falls_back_to_rules(ctx: StageContext, respx_mock: respx.Router) -> None:
    ctx = _with_env(ctx, LLM_ENV)
    ctx.settings.llm.max_calls_per_day = 0
    report = run_cards_with(
        ctx, RulesGenerator(FakeTranslator()), _llm_with_meter(ctx), FakeTranslator()
    )
    assert report.counts["cards.rules"] == 2
    assert report.counts["cards.llm"] == 0
    assert report.counts["cards.llm_budget"] == 1
    assert report.status == "ok"
    assert respx_mock.calls.call_count == 0


def test_budget_is_not_counted_as_llm_fallback(ctx: StageContext, respx_mock: respx.Router) -> None:
    ctx = _with_env(ctx, LLM_ENV)
    ctx.settings.llm.max_calls_per_day = 0
    report = run_cards_with(
        ctx, RulesGenerator(FakeTranslator()), _llm_with_meter(ctx), FakeTranslator()
    )
    assert report.counts["cards.llm_fallback"] == 0


def test_counter_keys_include_llm_budget(ctx: StageContext) -> None:
    report = run_cards_with(ctx, RulesGenerator(FakeTranslator()), None, FakeTranslator())
    assert report.counts["cards.llm_budget"] == 0


def test_rules_only_run_does_not_call_http(ctx: StageContext, respx_mock: respx.Router) -> None:
    respx_mock.post(URL).mock(side_effect=httpx.ConnectError("sin red"))
    report = run_cards_with(ctx, RulesGenerator(FakeTranslator()), None, FakeTranslator())
    assert report.status == "ok"
    assert respx_mock.calls.call_count == 0
