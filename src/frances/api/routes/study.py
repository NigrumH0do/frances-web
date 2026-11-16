"""API de estudio (AI-14): temas, quizzes, intentos, plan y estado.

Todas las rutas exigen sesión (``require_user``) salvo que la ruta sea de admin, que
además exige ``require_admin``. El usuario de la sesión es el único dueño de sus
intentos y de su plan: ninguna consulta recibe un ``user_id`` del cliente.

Las escrituras de intentos y de «hecho» abren ``BEGIN IMMEDIATE`` explícito sobre
la conexión de ``get_conn``; ``ensure_today`` usa su propio ``Store.connect``.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query

from frances.api.app import ApiContext
from frances.api.cards_repo import get_card_view
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import CurrentUser, require_admin, require_user
from frances.api.study_repo import (
    list_attempts,
    list_quizzes,
    quiz_view,
    study_status,
    topic_card_ids,
)
from frances.db.store import Store
from frances.db.usage import bogota_day
from frances.jobs.queue import enqueue, get_job, to_out
from frances.models.api import CardPage
from frances.models.jobs import JobOut
from frances.models.study import (
    PlanEntry,
    Quiz,
    QuizAttemptIn,
    QuizAttemptOut,
    QuizAttemptResult,
    StudyPlanDay,
    StudyRunRequest,
    StudyStatus,
    StudyTopic,
)
from frances.study.grading import grade_attempt
from frances.study.plan import WEEK_DAYS, ensure_today, plan_day_view, set_done
from frances.study.topics_repo import get_study_topic, list_study_topics
from frances.timeutil import format_ts

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_NOT_FOUND = "No existe."
_BAD_REQUEST = "Datos no válidos."
_DAY_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
_MAX_TOPIC_CARDS = 50


@contextmanager
def _write_immediate(conn: sqlite3.Connection) -> Iterator[None]:
    """Transacción de escritura explícita para intentos y «hecho»."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _ensure_today(ctx: ApiContext, user_id: str, now: datetime) -> None:
    """``ensure_today`` con una conexión propia (no la de la petición)."""
    store = Store.connect(ctx.db_path)
    try:
        ensure_today(store, user_id, now)
    finally:
        store.close()


@router.get("/topics", response_model=list[StudyTopic])
def get_topics(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    course_id: str | None = None,
) -> list[StudyTopic]:
    return list_study_topics(conn, course_id)


@router.get("/topics/{topic_id}", response_model=StudyTopic)
def get_topic(
    topic_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudyTopic:
    topic = get_study_topic(conn, topic_id)
    if topic is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return topic


@router.get("/topics/{topic_id}/cards", response_model=CardPage)
def get_topic_cards(
    topic_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=_MAX_TOPIC_CARDS)] = _MAX_TOPIC_CARDS,
) -> CardPage:
    if get_study_topic(conn, topic_id) is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    try:
        card_ids, next_cursor = topic_card_ids(conn, user.id, topic_id, cursor, limit)
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None
    cards = []
    for card_id in card_ids:
        card = get_card_view(conn, user.id, card_id)
        if card is not None:
            cards.append(card)
    return CardPage(cards=cards, next_cursor=next_cursor)


@router.get("/quizzes", response_model=list[Quiz])
def get_quizzes(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    scope_kind: Annotated[Literal["topic", "item"], Query()],
    scope_id: Annotated[str, Query(min_length=1)],
) -> list[Quiz]:
    return list_quizzes(conn, scope_kind, scope_id)


@router.get("/quizzes/{quiz_id}", response_model=Quiz)
def get_quiz(
    quiz_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Quiz:
    quiz = quiz_view(conn, quiz_id)
    if quiz is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return quiz


@router.post("/quizzes/{quiz_id}/attempts", response_model=QuizAttemptResult, status_code=201)
def create_attempt(
    quiz_id: str,
    body: QuizAttemptIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> QuizAttemptResult:
    now = format_ts(ctx.now())
    try:
        with _write_immediate(conn):
            return grade_attempt(conn, user.id, quiz_id, body, now)
    except KeyError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None


@router.get("/quizzes/{quiz_id}/attempts", response_model=list[QuizAttemptOut])
def get_attempts(
    quiz_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> list[QuizAttemptOut]:
    return list_attempts(conn, user.id, quiz_id)


@router.get("/plan/today", response_model=StudyPlanDay)
def get_plan_today(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> StudyPlanDay:
    now = ctx.now()
    _ensure_today(ctx, user.id, now)
    return plan_day_view(conn, user.id, bogota_day(now))


@router.get("/plan/week", response_model=list[StudyPlanDay])
def get_plan_week(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> list[StudyPlanDay]:
    now = ctx.now()
    _ensure_today(ctx, user.id, now)
    today = date.fromisoformat(bogota_day(now))
    return [
        plan_day_view(conn, user.id, (today + timedelta(days=offset)).isoformat())
        for offset in range(WEEK_DAYS)
    ]


def _apply_done(
    conn: sqlite3.Connection,
    user_id: str,
    day: str,
    position: int,
    done: bool,
    now: str,
) -> PlanEntry:
    with _write_immediate(conn):
        entry = set_done(conn, user_id, day, position, done, now)
        if entry is None:
            raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
        return entry


@router.post("/plan/{day}/{position}/done", response_model=PlanEntry)
def mark_plan_entry_done(
    day: Annotated[str, Path(pattern=_DAY_PATTERN)],
    position: Annotated[int, Path(ge=0)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> PlanEntry:
    return _apply_done(conn, user.id, day, position, True, format_ts(ctx.now()))


@router.delete("/plan/{day}/{position}/done", response_model=PlanEntry)
def unmark_plan_entry_done(
    day: Annotated[str, Path(pattern=_DAY_PATTERN)],
    position: Annotated[int, Path(ge=0)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> PlanEntry:
    return _apply_done(conn, user.id, day, position, False, format_ts(ctx.now()))


@router.get("/study/status", response_model=StudyStatus)
def get_study_status(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudyStatus:
    return study_status(conn, ctx.settings, ctx.now())


@router.post(
    "/admin/study/run",
    response_model=JobOut,
    status_code=202,
    dependencies=[Depends(require_admin)],
)
def run_study_job(
    body: StudyRunRequest,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> JobOut:
    payload: dict[str, str] = {}
    dedupe_key = f"{body.kind}:admin"
    if body.scope_kind is not None and body.scope_id is not None:
        if body.scope_kind == "topic":
            exists = get_study_topic(conn, body.scope_id) is not None
        else:
            exists = (
                conn.execute(
                    "SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL",
                    (body.scope_id,),
                ).fetchone()
                is not None
            )
        if not exists:
            raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
        payload = {"scope_kind": body.scope_kind, "scope_id": body.scope_id}
        dedupe_key = f"llm.quiz:{body.scope_kind}:{body.scope_id}"
    job_id = enqueue(
        conn,
        body.kind,
        payload,
        now=ctx.now(),
        dedupe_key=dedupe_key,
        priority=10,
    )
    job = get_job(conn, job_id)
    assert job is not None
    return to_out(job)
