"""Handlers de los trabajos de estudio encadenados tras el pipeline (AI-13).

Los cinco `kind` de P10 comparten tres reglas:

- un fallo reintentable del LLM lanza :class:`StudyRetry` y la cola aplica el
  backoff de SRV-05; en el último intento se usa el respaldo por reglas para no
  dejar una pantalla vacía;
- el presupuesto diario agotado difiere el trabajo a las 00:05 de Bogotá del
  día siguiente;
- lo que se guarda en `jobs.result` o `jobs.last_error` son ids, conteos y
  nombres de excepción: nunca texto del curso.

Los handlers no abren transacciones propias alrededor de las funciones de
estudio: cada una maneja las suyas, y la llamada al LLM siempre ocurre fuera de
cualquier transacción.
"""

import sqlite3
from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timedelta
from functools import wraps
from typing import Any, Literal, cast

from frances.cards.llm import LlmBudgetExceeded, LlmUnavailable
from frances.db.usage import bogota_day
from frances.errors import AuthError, FrancesError
from frances.jobs.queue import Job, PermanentJobError, enqueue
from frances.jobs.registry import HandlerRegistry, JobHandler
from frances.models.jobs import JobKind
from frances.stage import StageContext
from frances.study.client import study_llm
from frances.study.index import run_index
from frances.study.plan import run_plans
from frances.study.plan_why import run_why
from frances.study.quiz import QuizScope, generate_quiz, scopes_needing_quiz
from frances.study.sheet import MAX_SHEETS_PER_RUN, run_sheets
from frances.study.topics import regroup_all, regroup_course
from frances.timeutil import BOGOTA

#: Claves de deduplicación de los encadenados internos.
TOPICS_AFTER_SHEET = "llm.topics:after-sheet"
SHEET_MORE = "llm.sheet:more"
QUIZ_SWEEP = "llm.quiz:sweep"

#: Tope de alcances que procesa un solo barrido de quizzes.
MAX_QUIZ_SCOPES = 20


class StudyRetry(FrancesError):
    """Fallo reintentable del LLM: la cola aplica la espera de SRV-05."""


def is_last_attempt(job: Job) -> bool:
    """True si el intento en curso (`attempts`) es el último permitido."""
    return job.attempts >= job.max_attempts


def defer_to_tomorrow(
    conn: sqlite3.Connection,
    kind: JobKind,
    payload: Mapping[str, Any],
    now: datetime,
) -> int:
    """Encola `kind` para las 00:05 de Bogotá del día siguiente y devuelve su id."""
    next_day = date.fromisoformat(bogota_day(now)) + timedelta(days=1)
    run_after = datetime.combine(next_day, time(0, 5), tzinfo=BOGOTA)
    return enqueue(
        conn,
        kind,
        payload,
        now=now,
        run_after=run_after,
        dedupe_key=f"{kind}:deferred:{next_day.isoformat()}",
    )


def has_quiz(conn: sqlite3.Connection, scope: QuizScope) -> bool:
    """True si el alcance ya tiene un quiz vigente (del LLM o del respaldo)."""
    row = conn.execute(
        "SELECT 1 FROM quizzes WHERE scope_kind = ? AND scope_id = ? AND stale = 0 LIMIT 1",
        (scope.kind, scope.id),
    ).fetchone()
    return row is not None


def handle_index(ctx: StageContext, job: Job) -> dict[str, int]:
    """Reindexa las publicaciones del payload (o todas si no viene `item_ids`)."""
    return run_index(ctx, _optional_item_ids(job.payload))


def handle_sheet(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Amplía fichas; sin LLM deja las fichas base y no reintenta."""
    llm = study_llm(ctx)
    result = run_sheets(ctx, llm, item_ids=_optional_item_ids(job.payload))
    conn = ctx.store.conn

    # Las fichas ya escritas encadenan temas y quizzes aunque el resto falle.
    if result.written:
        enqueue(
            conn,
            "llm.topics",
            {},
            now=ctx.now(),
            dedupe_key=TOPICS_AFTER_SHEET,
        )
        for item_id in result.written:
            enqueue(
                conn,
                "llm.quiz",
                {"scope_kind": "item", "scope_id": item_id},
                now=ctx.now(),
                dedupe_key=f"llm.quiz:item:{item_id}",
            )

    if result.budget_exhausted:
        defer_to_tomorrow(conn, "llm.sheet", {}, ctx.now())
        return {"deferred": result.pending}

    if result.llm_down:
        raise StudyRetry("LLM no disponible")

    processed = len(result.written) + result.cached + len(result.failed)
    if (
        llm is not None
        and result.pending > 0
        and processed >= MAX_SHEETS_PER_RUN
        and not result.budget_exhausted
    ):
        enqueue(
            conn,
            "llm.sheet",
            {},
            now=ctx.now(),
            dedupe_key=_follow_up_key(SHEET_MORE, job),
        )

    return {
        "written": len(result.written),
        "cached": result.cached,
        "failed": len(result.failed),
        "pending": result.pending,
    }


def handle_topics(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Reagrupa cada curso; el respaldo por reglas entra en el último intento."""
    conn = ctx.store.conn
    last = is_last_attempt(job)
    try:
        results = regroup_all(ctx, study_llm(ctx), allow_rules=last)
    except LlmBudgetExceeded:
        _rules_for_courses_without_topics(ctx)
        _enqueue_missing_topic_quizzes(ctx)
        defer_to_tomorrow(conn, "llm.topics", {}, ctx.now())
        return {"deferred": 1, "fallback": "rules"}
    except LlmUnavailable:
        # El fallo aborta regroup_all en el primer curso; el resto también necesita
        # su respaldo por reglas ya, no dentro de 15 minutos.
        _rules_for_courses_without_topics(ctx)
        _enqueue_missing_topic_quizzes(ctx)
        if not last:
            raise StudyRetry("LLM no disponible") from None
        return {"fallback": "rules"}

    changed = [topic_id for result in results for topic_id in result.changed]
    for topic_id in changed:
        enqueue(
            conn,
            "llm.quiz",
            {"scope_kind": "topic", "scope_id": topic_id},
            now=ctx.now(),
            dedupe_key=f"llm.quiz:topic:{topic_id}",
        )
    _enqueue_missing_topic_quizzes(ctx)

    out: dict[str, Any] = {"courses": len(results), "changed": len(changed)}
    if any(result.source == "rules" for result in results):
        out["fallback"] = "rules"
    return out


def handle_quiz(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Genera el quiz del alcance o barre los que necesitan uno (máx. 20)."""
    conn = ctx.store.conn
    llm = study_llm(ctx)
    last = is_last_attempt(job)

    scope = _scope_from_payload(job.payload)
    pending = 0
    if scope is not None:
        scopes = [scope]
    else:
        needing = scopes_needing_quiz(conn)
        # Los alcances sin ningún quiz van primero: ninguna pantalla queda vacía.
        empty = [item for item in needing if not has_quiz(conn, item)]
        if llm is None:
            # Sin LLM, un quiz por reglas ya cubre el alcance: no se repite.
            needing = empty
        else:
            covered = [item for item in needing if has_quiz(conn, item)]
            needing = empty + covered
        scopes = needing[:MAX_QUIZ_SCOPES]
        pending = max(len(needing) - len(scopes), 0)

    generated = 0
    fallback = False
    for current in scopes:
        try:
            result = generate_quiz(
                ctx,
                llm,
                current,
                allow_rules=last or llm is None or not has_quiz(conn, current),
            )
        except LlmBudgetExceeded:
            defer_to_tomorrow(conn, "llm.quiz", job.payload, ctx.now())
            return {"deferred": 1, "scopes": len(scopes), "generated": generated}
        except LlmUnavailable:
            if not last:
                raise StudyRetry("LLM no disponible") from None
            result = generate_quiz(ctx, None, current, allow_rules=True)

        if result.quiz_id is not None:
            generated += 1
        if result.source == "rules":
            fallback = True

    if pending:
        enqueue(
            conn,
            "llm.quiz",
            {},
            now=ctx.now(),
            dedupe_key=_follow_up_key(QUIZ_SWEEP, job),
        )

    out: dict[str, Any] = {"scopes": len(scopes), "generated": generated}
    if pending:
        out["pending"] = pending
    if fallback:
        out["fallback"] = "rules"
    return out


def handle_plan(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Arma los planes por reglas y decora el «por qué» sin hacer fallar el trabajo."""
    del job  # el plan recorre todos los usuarios activos
    counts = run_plans(ctx)
    why: dict[str, Any]
    try:
        why = run_why(ctx, study_llm(ctx))
    except Exception as exc:  # el «por qué» es opcional: nunca tumba el plan
        why = {"error": type(exc).__name__}
    return {**counts, "why": why}


def register_handlers(reg: HandlerRegistry) -> None:
    """Registra los cinco `kind` de estudio de P10."""
    reg.add("index.text_blocks", _permanent_auth(handle_index))
    reg.add("llm.sheet", _permanent_auth(handle_sheet))
    reg.add("llm.topics", _permanent_auth(handle_topics))
    reg.add("llm.quiz", _permanent_auth(handle_quiz))
    reg.add("plan.daily", _permanent_auth(handle_plan))


# ---- privados ----


def _permanent_auth(handler: JobHandler) -> JobHandler:
    """Un `AuthError` nunca se reintenta: no tiene sentido insistir sin credenciales."""

    @wraps(handler)
    def wrapped(ctx: StageContext, job: Job) -> Mapping[str, Any] | None:
        try:
            return handler(ctx, job)
        except AuthError as exc:
            raise PermanentJobError("AuthError") from exc

    return wrapped


def _optional_item_ids(payload: Mapping[str, Any]) -> Sequence[str] | None:
    """Valida `item_ids`; ausente → `None`, cualquier otra forma → permanente."""
    value = payload.get("item_ids")
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise PermanentJobError("payload inválido: item_ids")
    return list(value)


def _scope_from_payload(payload: Mapping[str, Any]) -> QuizScope | None:
    """Alcance del quiz o `None` para el barrido; una forma parcial es permanente."""
    kind = payload.get("scope_kind")
    scope_id = payload.get("scope_id")
    if kind is None and scope_id is None:
        return None
    if kind not in ("topic", "item") or not isinstance(scope_id, str) or not scope_id:
        raise PermanentJobError("payload inválido: alcance del quiz")
    return QuizScope(cast("Literal['topic', 'item']", kind), scope_id)


def _follow_up_key(base: str, job: Job) -> str:
    """Evita que un encadenado choque con su propio `dedupe_key` mientras corre."""
    if job.dedupe_key == base:
        return f"{base}:{job.id}"
    return base


def _rules_for_courses_without_topics(ctx: StageContext) -> int:
    """Respaldo por reglas solo donde aún no hay temas (no pisa un plan del LLM)."""
    conn = ctx.store.conn
    rows = conn.execute(
        "SELECT c.id FROM courses c WHERE c.included = 1 AND NOT EXISTS"
        " (SELECT 1 FROM study_topics t WHERE t.course_id = c.id AND t.removed_at IS NULL)"
        " ORDER BY c.id"
    ).fetchall()
    for (course_id,) in rows:
        regroup_course(ctx, None, str(course_id), allow_rules=True)
    return len(rows)


def _enqueue_missing_topic_quizzes(ctx: StageContext) -> int:
    """Encola un quiz para cada tema vivo que aún no tiene ninguno vigente."""
    conn = ctx.store.conn
    rows = conn.execute(
        "SELECT t.id FROM study_topics t WHERE t.removed_at IS NULL AND NOT EXISTS"
        " (SELECT 1 FROM quizzes q WHERE q.scope_kind = 'topic' AND q.scope_id = t.id"
        " AND q.stale = 0) ORDER BY t.id"
    ).fetchall()
    for (topic_id,) in rows:
        enqueue(
            conn,
            "llm.quiz",
            {"scope_kind": "topic", "scope_id": str(topic_id)},
            now=ctx.now(),
            dedupe_key=f"llm.quiz:topic:{topic_id}",
        )
    return len(rows)
