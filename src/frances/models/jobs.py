"""Contratos v2 de la cola de trabajos y del estado del pipeline (plan maestro v2, CHG-05)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

JobKind = Literal[
    # P08
    "pipeline.daily",
    "pipeline.reconcile",
    "auth.check",
    # P10
    "index.text_blocks",
    "llm.sheet",
    "llm.topics",
    "llm.quiz",
    "plan.daily",
    # P11
    "cards.regenerate_item",
    "audio.regenerate",
]
JobState = Literal["queued", "running", "done", "failed"]


class JobOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int
    kind: JobKind
    state: JobState
    attempts: int
    max_attempts: int
    run_after: str
    last_error: str | None
    created_at: str
    updated_at: str
    finished_at: str | None


class PipelineRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["pipeline.daily", "pipeline.reconcile"]


class RunOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int
    stage: str
    started_at: str
    finished_at: str | None
    status: str | None
    counts: dict[str, int]


class UsageLineOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    meter: str
    period: Literal["day", "month"]
    used: int
    cap: int | None


class PipelineStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    last_runs: list[RunOut]
    jobs: dict[JobState, int]
    recent_failed: list[JobOut]
    next_daily_at: str
    next_reconcile_at: str
    last_backup: RunOut | None
    worker_seen_at: str | None


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["ok", "degraded"]
    version: str
    schema_version: int
    db_ok: bool
    worker_seen_at: str | None
