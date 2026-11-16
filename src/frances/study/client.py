"""Fábrica del cliente LLM de estudio y lectura del presupuesto diario (AI-01).

Ningún módulo nuevo lee `os.environ`: el entorno llega inyectado (`ctx.env`).
"""

import sqlite3
from collections.abc import Callable, Mapping
from datetime import datetime

from frances.cards.llm import DailyCallMeter, LlmGenerator, llm_from_env
from frances.config import Settings
from frances.db.store import Store
from frances.db.usage import bogota_day, usage_daily_get
from frances.stage import StageContext

# Mismo nombre de medidor que usa `frances.cards.llm` (`_METER_LLM_CALLS`).
LLM_CALLS_METER = "llm_calls"


def study_llm(ctx: StageContext) -> LlmGenerator | None:
    """Cliente LLM de estudio, o `None` si `llm.mode` es `off` o falta el entorno."""
    return study_llm_for(ctx.settings, ctx.env, ctx.store, ctx.now)


def study_llm_for(
    settings: Settings,
    env: Mapping[str, str],
    store: Store,
    now: Callable[[], datetime],
) -> LlmGenerator | None:
    """Misma regla que `study_llm`, para la API y otros llamadores sin `StageContext`."""
    if settings.llm.mode == "off":
        return None
    meter = DailyCallMeter(store, now, settings.llm.max_calls_per_day)
    return llm_from_env(env, timeout_s=settings.llm.timeout_s, meter=meter)


def llm_calls_today(conn: sqlite3.Connection, now: datetime) -> int:
    """Llamadas al LLM registradas hoy (día de Bogotá)."""
    return usage_daily_get(conn, bogota_day(now), LLM_CALLS_METER)


def llm_budget_left(conn: sqlite3.Connection, settings: Settings, now: datetime) -> int:
    """Llamadas que quedan hoy frente a `llm.max_calls_per_day`."""
    used = llm_calls_today(conn, now)
    return max(settings.llm.max_calls_per_day - used, 0)
