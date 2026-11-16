"""«Por qué» opcional del plan diario, redactado por el LLM (AI-11).

El plan se arma y se guarda primero con reglas (AI-10); este módulo solo decora
sus entradas. La entrada del LLM lleva exclusivamente posición, tipo, título y
motivo de las tareas de hoy: ni id, ni nombre, ni email del usuario. Si falta
cupo (se reservan :data:`WHY_RESERVE` llamadas para el chat) o el LLM falla, el
plan sigue visible sin «por qué».
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from frances.cards.llm import LlmUnavailable
from frances.config import Settings
from frances.db.store import Store
from frances.db.usage import bogota_day
from frances.stage import StageContext
from frances.study.client import llm_budget_left
from frances.study.llm_cache import JsonLlm, cached_json
from frances.study.plan import plan_day_view
from frances.study.prompts import PROMPT_VERSIONS, SYSTEM_PROMPTS, render_plan_why_input
from frances.study.quality import plan_why_problems
from frances.study.schemas import PlanWhyLlmOut, PromptPlanEntry

_WhyResult = Literal["written", "cached", "skipped_budget", "skipped_llm", "empty"]

#: Llamadas del día que no se gastan en el «por qué»: quedan para el chat.
WHY_RESERVE = 60

_WHY_RESULTS: tuple[_WhyResult, ...] = (
    "written",
    "cached",
    "skipped_budget",
    "skipped_llm",
    "empty",
)


def why_for_today(
    store: Store,
    llm: JsonLlm | None,
    settings: Settings,
    user_id: str,
    now: datetime,
) -> _WhyResult:
    """Escribe el «por qué» de las entradas de hoy; nunca lanza por fallo del LLM.

    Devuelve ``written`` si el LLM redactó una salida nueva, ``cached`` si la
    misma entrada ya estaba en caché, ``skipped_budget`` si quedan menos de
    :data:`WHY_RESERVE` llamadas, ``skipped_llm`` si no hay cliente o el LLM
    falla, y ``empty`` si el usuario no tiene plan para hoy.
    """
    day = bogota_day(now)
    entries = plan_day_view(store.conn, user_id, day).entries
    if not entries:
        return "empty"
    if llm is None or settings.llm.mode == "off":
        return "skipped_llm"
    if llm_budget_left(store.conn, settings, now) < WHY_RESERVE:
        return "skipped_budget"

    prompt_entries = tuple(
        PromptPlanEntry(
            position=entry.position,
            kind=entry.kind,
            title_es=entry.title_es,
            reason_es=entry.reason_es,
        )
        for entry in entries
    )
    positions = frozenset(entry.position for entry in entries)
    try:
        result = cached_json(
            store,
            llm,
            task="plan_why",
            system=SYSTEM_PROMPTS["plan_why"],
            user=render_plan_why_input(prompt_entries),
            schema=PlanWhyLlmOut,
            prompt_version=PROMPT_VERSIONS["plan_why"],
            now=lambda: now,
            accept=lambda data: plan_why_problems(PlanWhyLlmOut.model_validate(data), positions),
        )
    except LlmUnavailable:
        return "skipped_llm"

    lines = PlanWhyLlmOut.model_validate(result.data).lines
    with store.tx() as conn:
        for line in lines:
            conn.execute(
                "UPDATE study_plan SET why_llm_es = ?"
                " WHERE user_id = ? AND day = ? AND position = ?",
                (line.why_es, user_id, day, line.position),
            )
    return "cached" if result.hit else "written"


def run_why(
    ctx: StageContext,
    llm: JsonLlm | None,
    *,
    user_ids: Sequence[str] | None = None,
) -> dict[str, int]:
    """Agrega el «por qué» al plan de hoy de cada usuario activo.

    Devuelve el conteo por resultado (las cinco claves de :data:`_WHY_RESULTS`).
    Un fallo del LLM queda como ``skipped_llm``: el plan ya está guardado y se
    muestra sin «por qué».
    """
    counts: dict[str, int] = {result: 0 for result in _WHY_RESULTS}
    now = ctx.now()
    for (user_id,) in ctx.store.conn.execute(
        "SELECT id FROM users WHERE disabled_at IS NULL ORDER BY id"
    ).fetchall():
        if user_ids is not None and user_id not in user_ids:
            continue
        counts[why_for_today(ctx.store, llm, ctx.settings, user_id, now)] += 1
    return counts
