"""CLI del worker y de la cola: `frances worker` y `frances jobs` (SRV-06)."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

from frances.jobs.cli import register
from frances.jobs.queue import claim, enqueue, fail, get_job
from frances.jobs.worker import write_heartbeat
from frances.stage import make_context
from frances.timeutil import now_utc

T0 = datetime(2026, 11, 2, 10, 17, tzinfo=UTC)


@pytest.fixture
def app() -> typer.Typer:
    cli_app = typer.Typer()
    register(cli_app)
    return cli_app


@pytest.fixture
def data_dir(tmp_path: Path) -> Iterator[Path]:
    """Repo de datos con la base migrada; la conexión se cierra antes de invocar la CLI."""
    ctx = make_context(tmp_path, {})
    ctx.store.close()
    yield tmp_path


def test_worker_check_without_heartbeat_exits_1(app: typer.Typer, data_dir: Path) -> None:
    result = CliRunner().invoke(app, ["worker", "--check", "--data", str(data_dir)])
    assert result.exit_code == 1


def test_worker_check_with_fresh_heartbeat_exits_0(app: typer.Typer, data_dir: Path) -> None:
    ctx = make_context(data_dir, {})
    write_heartbeat(ctx.store.conn, "w1", now_utc(), None)
    ctx.store.close()

    result = CliRunner().invoke(app, ["worker", "--check", "--data", str(data_dir)])
    assert result.exit_code == 0


def test_worker_check_with_stale_heartbeat_exits_1(app: typer.Typer, data_dir: Path) -> None:
    ctx = make_context(data_dir, {})
    write_heartbeat(ctx.store.conn, "w1", now_utc() - timedelta(hours=1), None)
    ctx.store.close()

    result = CliRunner().invoke(app, ["worker", "--check", "--data", str(data_dir)])
    assert result.exit_code == 1


def test_worker_once_exits_0_without_jobs(app: typer.Typer, data_dir: Path) -> None:
    result = CliRunner().invoke(app, ["worker", "--once", "--data", str(data_dir)])
    assert result.exit_code == 0


def test_jobs_enqueue_and_list_print_ids_not_payloads(app: typer.Typer, data_dir: Path) -> None:
    runner = CliRunner()
    secret_marker = "PAYLOAD-MARKER-123"
    enqueued = runner.invoke(
        app,
        [
            "jobs",
            "enqueue",
            "auth.check",
            "--payload",
            f'{{"note": "{secret_marker}"}}',
            "--data",
            str(data_dir),
        ],
    )
    assert enqueued.exit_code == 0
    job_id = enqueued.output.strip()
    assert job_id.isdigit()
    assert secret_marker not in enqueued.output

    listed = runner.invoke(app, ["jobs", "list", "--data", str(data_dir)])
    assert listed.exit_code == 0
    assert job_id in listed.output
    assert "auth.check" in listed.output
    assert secret_marker not in listed.output


def test_jobs_enqueue_rejects_unknown_kind(app: typer.Typer, data_dir: Path) -> None:
    result = CliRunner().invoke(app, ["jobs", "enqueue", "no.existe", "--data", str(data_dir)])
    assert result.exit_code != 0


def test_jobs_enqueue_rejects_payload_that_is_not_an_object(
    app: typer.Typer, data_dir: Path
) -> None:
    result = CliRunner().invoke(
        app,
        ["jobs", "enqueue", "auth.check", "--payload", "[1, 2]", "--data", str(data_dir)],
    )
    assert result.exit_code != 0


def test_jobs_list_filters_by_state(app: typer.Typer, data_dir: Path) -> None:
    ctx = make_context(data_dir, {})
    conn = ctx.store.conn
    failed_id = enqueue(conn, "auth.check", now=T0)
    queued_id = enqueue(conn, "auth.check", now=T0)
    claimed = claim(conn, "w1", T0)  # toma el primero (menor id)
    assert claimed is not None and claimed.id == failed_id
    fail(conn, failed_id, "boom", T0, retryable=False)
    ctx.store.close()

    result = CliRunner().invoke(app, ["jobs", "list", "--state", "failed", "--data", str(data_dir)])

    assert result.exit_code == 0
    ids = [line.split("\t")[0] for line in result.output.splitlines()]
    assert ids == [str(failed_id)]
    assert str(queued_id) not in ids


def test_jobs_retry_requeues_failed_job(app: typer.Typer, data_dir: Path) -> None:
    ctx = make_context(data_dir, {})
    conn = ctx.store.conn
    jid = enqueue(conn, "auth.check", now=T0)
    claim(conn, "w1", T0)
    fail(conn, jid, "AuthError", T0, retryable=False)
    ctx.store.close()

    result = CliRunner().invoke(app, ["jobs", "retry", str(jid), "--data", str(data_dir)])

    assert result.exit_code == 0
    ctx = make_context(data_dir, {})
    job = get_job(ctx.store.conn, jid)
    ctx.store.close()
    assert job is not None
    assert job.state == "queued"
    assert job.attempts == 0


def test_jobs_retry_refuses_job_not_failed(app: typer.Typer, data_dir: Path) -> None:
    ctx = make_context(data_dir, {})
    jid = enqueue(ctx.store.conn, "auth.check", now=T0)
    ctx.store.close()

    result = CliRunner().invoke(app, ["jobs", "retry", str(jid), "--data", str(data_dir)])

    assert result.exit_code == 1
