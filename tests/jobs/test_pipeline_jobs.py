"""Handlers del pipeline v1 como trabajos de la cola (SRV-07)."""

import dataclasses
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.errors import AuthError
from frances.jobs import pipeline
from frances.jobs.pipeline import (
    handle_auth_check,
    handle_daily,
    handle_reconcile,
    register_handlers,
)
from frances.jobs.queue import Job, PermanentJobError
from frances.jobs.registry import HandlerRegistry
from frances.stage import StageContext, StageReport, make_context

T0 = datetime(2026, 11, 2, 10, 17, tzinfo=UTC)


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    base = make_context(tmp_path, {})
    fixed = dataclasses.replace(base, now=lambda: T0)
    try:
        yield fixed
    finally:
        base.store.close()


def fake_job(kind: str, payload: dict[str, Any] | None = None) -> Job:
    return Job(
        id=1,
        kind=kind,  # type: ignore[arg-type]
        payload=payload or {},
        state="running",
        priority=0,
        attempts=1,
        max_attempts=5,
        run_after="2026-11-02T10:17:00Z",
        dedupe_key=None,
        locked_by="test",
        last_error=None,
        created_at="2026-11-02T10:17:00Z",
        updated_at="2026-11-02T10:17:00Z",
    )


def queued_kinds(ctx: StageContext) -> list[str]:
    rows = ctx.store.conn.execute("SELECT kind FROM jobs ORDER BY id").fetchall()
    return [str(row[0]) for row in rows]


def test_daily_handler_ok_returns_summary_without_errors(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        pipeline,
        "run_daily",
        lambda c: [StageReport("sync", "partial", {"items_upserted": 2}, ["Leçon"])],
    )
    out = handle_daily(ctx, fake_job("pipeline.daily"))
    assert out["changed"] is True and "Leçon" not in json.dumps(out)
    assert (ctx.paths.cache / "daily_summary.json").is_file()


def test_partial_pipeline_completes(ctx: StageContext, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "run_daily", lambda c: [StageReport("fetch", "partial")])
    assert handle_daily(ctx, fake_job("pipeline.daily"))["changed"] is False


def test_auth_failure_is_permanent(ctx: StageContext, monkeypatch: pytest.MonkeyPatch) -> None:
    # REVIEW FOCUS 10 (subsistema servidor)
    monkeypatch.setattr(
        pipeline,
        "run_daily",
        lambda c: [StageReport("sync", "failed", {"auth_failed": 1}, ["AuthError"])],
    )
    with pytest.raises(PermanentJobError, match="Google"):
        handle_daily(ctx, fake_job("pipeline.daily"))


def test_failed_pipeline_is_retryable(ctx: StageContext, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "run_daily", lambda c: [StageReport("fetch", "failed")])
    with pytest.raises(RuntimeError):
        handle_daily(ctx, fake_job("pipeline.daily"))


def test_follow_ups_enqueued_only_when_changed_and_handled(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = fake_job("pipeline.daily", {"slot": "2026-11-02"})
    monkeypatch.setattr(
        pipeline, "run_daily", lambda c: [StageReport("sync", "ok", {"items_upserted": 1})]
    )
    handle_daily(ctx, job, frozenset({"llm.sheet"}))
    assert queued_kinds(ctx) == ["llm.sheet"]


def test_follow_ups_not_enqueued_without_changes(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pipeline, "run_daily", lambda c: [StageReport("sync", "ok", {})])
    handle_daily(ctx, fake_job("pipeline.daily", {"slot": "2026-11-02"}), frozenset({"llm.sheet"}))
    assert queued_kinds(ctx) == []


def test_follow_ups_dedupe_per_slot(ctx: StageContext, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pipeline, "run_daily", lambda c: [StageReport("sync", "ok", {"items_upserted": 1})]
    )
    job = fake_job("pipeline.daily", {"slot": "2026-11-02"})
    handle_daily(ctx, job, frozenset({"llm.sheet"}))
    handle_daily(ctx, job, frozenset({"llm.sheet"}))
    assert queued_kinds(ctx) == ["llm.sheet"]


def test_reconcile_and_auth_check_handlers(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        pipeline,
        "run_reconcile",
        lambda c: StageReport("reconcile", "ok", {"reconcile.deleted": 0}),
    )
    assert handle_reconcile(ctx, fake_job("pipeline.reconcile"))["status"] == "ok"

    def reconcile_auth(c: StageContext) -> StageReport:
        raise AuthError("sin acceso")

    monkeypatch.setattr(pipeline, "run_reconcile", reconcile_auth)
    with pytest.raises(PermanentJobError, match="Re-autoriza"):
        handle_reconcile(ctx, fake_job("pipeline.reconcile"))

    seen: dict[str, Any] = {}

    class FakeApi:
        def __init__(self, credentials: object, base_url: str) -> None:
            seen["base_url"] = base_url

        def refresh(self) -> None:
            return None

        def get_json(self, path: str, params: dict[str, object]) -> dict[str, Any]:
            seen["path"] = path
            return {"courses": []}

    monkeypatch.setattr(pipeline, "build_credentials", lambda env: ("creds", dict(env)))
    monkeypatch.setattr(pipeline, "GoogleApi", FakeApi)
    assert handle_auth_check(ctx, fake_job("auth.check")) == {"ok": 1}
    assert seen["path"] == "courses"


def test_auth_check_uses_context_env_and_fails_permanently(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    received: list[dict[str, str]] = []

    class RevokedApi:
        def __init__(self, credentials: object, base_url: str) -> None:
            pass

        def refresh(self) -> None:
            raise AuthError("token revocado")

    def fake_build(env: Any) -> str:
        received.append(dict(env))
        return "creds"

    monkeypatch.setattr(pipeline, "build_credentials", fake_build)
    monkeypatch.setattr(pipeline, "GoogleApi", RevokedApi)
    with pytest.raises(PermanentJobError, match="Re-autoriza"):
        handle_auth_check(ctx, fake_job("auth.check"))
    assert received == [dict(ctx.env)]


def test_register_handlers_reads_kinds_when_the_job_runs(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    reg = HandlerRegistry()
    register_handlers(reg)
    reg.add("llm.sheet", lambda c, j: None)  # se registra después de pipeline.daily
    monkeypatch.setattr(
        pipeline, "run_daily", lambda c: [StageReport("sync", "ok", {"items_upserted": 1})]
    )
    handler = reg.get("pipeline.daily")
    assert handler is not None
    handler(ctx, fake_job("pipeline.daily", {"slot": "2026-11-02"}))
    assert queued_kinds(ctx) == ["llm.sheet"]
