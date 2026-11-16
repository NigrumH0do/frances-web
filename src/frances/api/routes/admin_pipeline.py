"""Admin del pipeline: estado, ejecución manual, trabajos fallidos, reintentos y uso.

Todas las rutas exigen ``role == "admin"`` (``require_admin``, R-33). Las vistas se
arman con ``to_out`` y ``RunOut``; ``runs.stats.errors`` puede traer texto del curso
y nunca sale por la API (Review Focus de SRV-11).
"""

import json
import sqlite3
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import require_admin
from frances.config import Settings
from frances.db.usage import bogota_day, current_month, usage_daily_get, usage_get
from frances.jobs.queue import (
    counts_by_state,
    enqueue,
    get_job,
    list_jobs,
    retry,
    to_out,
)
from frances.jobs.scheduler import next_fire, schedules_from
from frances.models.jobs import (
    JobKind,
    JobOut,
    JobState,
    PipelineRunRequest,
    PipelineStatus,
    RunOut,
    UsageLineOut,
)
from frances.timeutil import format_ts

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

RECENT_RUNS = 20
RECENT_FAILED_JOBS = 10
DEFAULT_JOBS_LIMIT = 50
MAX_JOBS_LIMIT = 200


def _q_runs(conn: sqlite3.Connection, *, limit: int, stage: str | None = None) -> list[RunOut]:
    """Últimas filas de ``runs`` (más nuevas primero), con o sin filtro de etapa."""
    columns = "id, stage, started_at, finished_at, status, stats"
    if stage is None:
        rows = conn.execute(
            f"SELECT {columns} FROM runs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {columns} FROM runs WHERE stage = ? ORDER BY id DESC LIMIT ?",
            (stage, limit),
        ).fetchall()
    return [_run_out(row) for row in rows]


def _q_last_backup(conn: sqlite3.Connection) -> RunOut | None:
    rows = _q_runs(conn, limit=1, stage="backup")
    return rows[0] if rows else None


def _q_worker_seen_at(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(seen_at) FROM worker_heartbeat").fetchone()
    return str(row[0]) if row is not None and row[0] is not None else None


def _counts_from_stats(raw: str | None) -> dict[str, int]:
    """Solo ``stats.counts``: ``stats.errors`` nunca se lee para la respuesta."""
    if not raw:
        return {}
    try:
        stats = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(stats, dict):
        return {}
    counts = stats.get("counts")
    if not isinstance(counts, dict):
        return {}
    return {
        key: value
        for key, value in counts.items()
        if isinstance(key, str) and isinstance(value, int) and not isinstance(value, bool)
    }


def _run_out(row: tuple[object, ...]) -> RunOut:
    run_id, stage, started_at, finished_at, status, stats = row
    return RunOut(
        id=int(str(run_id)),
        stage=str(stage),
        started_at=str(started_at),
        finished_at=None if finished_at is None else str(finished_at),
        status=None if status is None else str(status),
        counts=_counts_from_stats(stats if isinstance(stats, str) else None),
    )


def _next_fire_at(settings: Settings, name: str, now: datetime) -> str:
    tz = ZoneInfo(settings.scheduler.timezone)
    schedule = next(s for s in schedules_from(settings) if s.name == name)
    return format_ts(next_fire(schedule, now, tz))


@router.get("/pipeline", response_model=PipelineStatus)
def pipeline_status(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> PipelineStatus:
    now = ctx.now()
    return PipelineStatus(
        last_runs=_q_runs(conn, limit=RECENT_RUNS),
        jobs=counts_by_state(conn),
        recent_failed=[
            to_out(job) for job in list_jobs(conn, state="failed", limit=RECENT_FAILED_JOBS)
        ],
        next_daily_at=_next_fire_at(ctx.settings, "pipeline.daily", now),
        next_reconcile_at=_next_fire_at(ctx.settings, "pipeline.reconcile", now),
        last_backup=_q_last_backup(conn),
        worker_seen_at=_q_worker_seen_at(conn),
    )


@router.post("/pipeline/run", response_model=JobOut, status_code=202)
def run_pipeline(
    body: PipelineRunRequest,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> JobOut:
    job_id = enqueue(
        conn,
        body.kind,
        {"slot": "manual"},
        now=ctx.now(),
        dedupe_key=f"{body.kind}:manual",
        priority=10,
    )
    job = get_job(conn, job_id)
    assert job is not None  # enqueue siempre deja una fila
    return to_out(job)


@router.get("/jobs", response_model=list[JobOut])
def list_admin_jobs(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    state: JobState | None = None,
    kind: JobKind | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_JOBS_LIMIT)] = DEFAULT_JOBS_LIMIT,
) -> list[JobOut]:
    return [to_out(job) for job in list_jobs(conn, state=state, kind=kind, limit=limit)]


@router.post("/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(
    job_id: int,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> JobOut:
    try:
        job = retry(conn, job_id, ctx.now())
    except ValueError:
        raise ApiErrorResponse(409, "conflict", "Solo se reintentan trabajos fallidos.") from None
    return to_out(job)


@router.get("/usage", response_model=list[UsageLineOut])
def usage_lines(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[UsageLineOut]:
    now = ctx.now()
    day = bogota_day(now)
    month = current_month(now)
    settings = ctx.settings
    return [
        UsageLineOut(
            meter="llm_calls",
            period="day",
            used=usage_daily_get(conn, day, "llm_calls"),
            cap=settings.llm.max_calls_per_day,
        ),
        UsageLineOut(
            meter="llm_calls",
            period="month",
            used=usage_get(conn, month, "llm_calls"),
            cap=None,
        ),
        UsageLineOut(
            meter="azure_tts_chars",
            period="month",
            used=usage_get(conn, month, "azure_tts_chars"),
            cap=settings.audio.azure_tts_monthly_char_cap,
        ),
        UsageLineOut(
            meter="azure_translator_chars",
            period="month",
            used=usage_get(conn, month, "azure_translator_chars"),
            cap=settings.translator.monthly_char_cap,
        ),
        UsageLineOut(
            meter="llm_items",
            period="month",
            used=usage_get(conn, month, "llm_items"),
            cap=None,
        ),
    ]
