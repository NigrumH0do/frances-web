"""Fábrica del cliente LLM de estudio y presupuesto diario (AI-01)."""

from collections.abc import Callable
from datetime import datetime

from frances.cards.llm import DailyCallMeter, LlmGenerator
from frances.config import Settings
from frances.db.store import Store
from frances.stage import StageContext
from frances.study.client import llm_budget_left, llm_calls_today, study_llm, study_llm_for

from .conftest import LLM_ENV


def test_study_llm_respects_mode_off_and_env(
    ctx_factory: Callable[..., StageContext],
) -> None:
    assert study_llm(ctx_factory(toml='[llm]\nmode = "off"', env=LLM_ENV)) is None
    assert study_llm(ctx_factory(env={})) is None

    gen = study_llm(ctx_factory(toml="[llm]\ntimeout_s = 90", env=LLM_ENV))
    assert isinstance(gen, LlmGenerator)
    assert gen.model == LLM_ENV["LLM_MODEL"]


def test_study_llm_for_follows_the_same_rule(store: Store, clock: Callable[[], datetime]) -> None:
    settings = Settings()
    assert study_llm_for(settings, {}, store, clock) is None
    assert study_llm_for(settings, LLM_ENV, store, clock) is not None

    off = Settings.model_validate({"llm": {"mode": "off"}})
    assert study_llm_for(off, LLM_ENV, store, clock) is None


def test_budget_counts_reserved_calls_per_bogota_day(
    ctx_factory: Callable[..., StageContext],
) -> None:
    ctx = ctx_factory(toml="[llm]\nmax_calls_per_day = 3", env=LLM_ENV)
    meter = DailyCallMeter(ctx.store, ctx.now, ctx.settings.llm.max_calls_per_day)
    assert llm_calls_today(ctx.store.conn, ctx.now()) == 0
    assert llm_budget_left(ctx.store.conn, ctx.settings, ctx.now()) == 3

    meter.reserve()
    meter.reserve()

    assert llm_calls_today(ctx.store.conn, ctx.now()) == 2
    assert llm_budget_left(ctx.store.conn, ctx.settings, ctx.now()) == 1
