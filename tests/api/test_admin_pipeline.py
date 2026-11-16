"""Admin del pipeline (SRV-11): estado, lanzar, fallidos, reintentar y uso."""

import json
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Literal

import pytest
from fastapi.testclient import TestClient

from frances.db.usage import bogota_day, record_run, usage_daily_add
from frances.jobs.queue import claim, enqueue, fail, get_job
from frances.models.jobs import JobKind
from frances.stage import StageReport
from frances.timeutil import BOGOTA, format_ts, parse_ts
from tests.testkit.api import create_user, login, make_api, second_user_client

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
BOG = BOGOTA


@pytest.fixture
def api_client(tmp_path: Path) -> Iterator[tuple[TestClient, sqlite3.Connection]]:
    """App migrada con un admin y un usuario normal, cada uno con su sesión."""
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org", role="admin")
    create_user(conn, "leo@ex.org", role="user")
    login(client, "ana@ex.org")
    yield client, conn
    conn.close()
    client.close()


@pytest.fixture
def admin_client(
    api_client: tuple[TestClient, sqlite3.Connection],
) -> TestClient:
    return api_client[0]


@pytest.fixture
def db(api_client: tuple[TestClient, sqlite3.Connection]) -> sqlite3.Connection:
    return api_client[1]


@pytest.fixture
def user_client(admin_client: TestClient) -> Iterator[TestClient]:
    leo = second_user_client(admin_client, "leo@ex.org")
    yield leo
    leo.close()


def failed_job(conn: sqlite3.Connection, kind: JobKind, attempts: int = 5) -> int:
    """Deja un trabajo `failed` tras `attempts` fallos, usando la cola real."""
    now = NOW
    job_id = enqueue(conn, kind, {"slot": "test"}, now=now)
    for _ in range(attempts):
        claimed = claim(conn, "worker-test", now)
        assert claimed is not None and claimed.id == job_id
        fail(conn, job_id, "fallo sintético", now)
        now += timedelta(seconds=3600)
    job = get_job(conn, job_id)
    assert job is not None and job.state == "failed"
    return job_id


def insert_run(
    conn: sqlite3.Connection,
    stage: str,
    status: Literal["ok", "partial", "failed"],
    *,
    counts: dict[str, int],
    errors: list[str],
) -> None:
    record_run(conn, StageReport(stage, status, counts, errors), format_ts(NOW), format_ts(NOW))


def test_run_pipeline_is_idempotent_while_active(admin_client: TestClient) -> None:
    a = admin_client.post("/api/admin/pipeline/run", json={"kind": "pipeline.daily"})
    b = admin_client.post("/api/admin/pipeline/run", json={"kind": "pipeline.daily"})
    assert (
        a.status_code == 202 and a.json()["id"] == b.json()["id"] and a.json()["state"] == "queued"
    )


def test_retry_failed_job_from_admin(admin_client: TestClient, db: sqlite3.Connection) -> None:
    jid = failed_job(db, "pipeline.daily", attempts=5)
    r = admin_client.post(f"/api/admin/jobs/{jid}/retry")
    assert r.status_code == 200 and (r.json()["state"], r.json()["attempts"]) == ("queued", 0)
    assert admin_client.post(f"/api/admin/jobs/{jid}/retry").status_code == 409


def test_pipeline_status_shape_and_no_errors_text(
    admin_client: TestClient, db: sqlite3.Connection
) -> None:
    insert_run(db, "fetch", "partial", counts={"downloaded": 3}, errors=["Leçon 3 — Mme X"])
    body = admin_client.get("/api/admin/pipeline").json()
    assert body["last_runs"][0]["counts"] == {"downloaded": 3}
    assert "Leçon" not in json.dumps(body)
    assert parse_ts(body["next_daily_at"]).astimezone(BOG).time() == time(5, 17)


def test_usage_lines(admin_client: TestClient, db: sqlite3.Connection) -> None:
    usage_daily_add(db, bogota_day(NOW), "llm_calls", 12)
    lines = {(u["meter"], u["period"]): u for u in admin_client.get("/api/admin/usage").json()}
    assert lines[("llm_calls", "day")] == {
        "meter": "llm_calls",
        "period": "day",
        "used": 12,
        "cap": 300,
    }


def test_user_gets_403(user_client: TestClient) -> None:
    assert user_client.get("/api/admin/pipeline").status_code == 403
