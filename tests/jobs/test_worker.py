"""Worker de la cola: un ciclo, bucle, heartbeat y parada limpia (SRV-06)."""

import dataclasses
import logging
import os
import socket
import sqlite3
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from frances.jobs import worker as worker_mod
from frances.jobs.queue import PermanentJobError, claim, enqueue, get_job
from frances.jobs.registry import HandlerRegistry
from frances.jobs.worker import (
    HEARTBEAT_THREAD,
    default_worker_id,
    run_one,
    run_worker,
    write_heartbeat,
)
from frances.stage import StageContext, make_context

T0 = datetime(2026, 11, 2, 10, 17, tzinfo=UTC)


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    base = make_context(tmp_path, {})
    fixed = dataclasses.replace(base, now=lambda: T0)
    try:
        yield fixed
    finally:
        base.store.close()


def _conn(ctx: StageContext) -> sqlite3.Connection:
    return ctx.store.conn


def test_run_one_completes_job(ctx: StageContext) -> None:
    reg = HandlerRegistry()
    reg.add("auth.check", lambda c, j: {"ok": 1})
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    assert run_one(ctx, reg, "w1") == jid
    assert get_job(_conn(ctx), jid).state == "done"  # type: ignore[union-attr]


def test_run_one_returns_none_when_queue_is_empty(ctx: StageContext) -> None:
    assert run_one(ctx, HandlerRegistry(), "w1") is None


def test_run_one_without_handler_fails_permanently(ctx: StageContext) -> None:
    jid = enqueue(_conn(ctx), "llm.quiz", now=T0)

    run_one(ctx, HandlerRegistry(), "w1")

    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert (job.state, job.last_error) == ("failed", "sin handler")


def test_permanent_error_fails_without_retry(ctx: StageContext) -> None:
    def handler(c: StageContext, j: object) -> None:
        raise PermanentJobError("AuthError: token revocado")

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    run_one(ctx, reg, "w1")

    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "failed"
    assert job.attempts == 1


def test_generic_exception_is_retryable_and_redacted(ctx: StageContext) -> None:
    def handler(c: StageContext, j: object) -> None:
        raise RuntimeError("Bearer zzz.yyy")

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    run_one(ctx, reg, "w1")

    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "queued"
    assert job.last_error is not None
    assert "zzz.yyy" not in job.last_error
    assert job.last_error.startswith("RuntimeError: ")


def test_keyboard_interrupt_leaves_job_running_for_recovery(ctx: StageContext) -> None:
    def handler(c: StageContext, j: object) -> None:
        raise KeyboardInterrupt

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    with pytest.raises(KeyboardInterrupt):
        run_one(ctx, reg, "w1")

    assert get_job(_conn(ctx), jid).state == "running"  # type: ignore[union-attr]


def test_handler_runs_outside_any_transaction(ctx: StageContext) -> None:
    seen: list[bool] = []

    def handler(c: StageContext, j: object) -> None:
        seen.append(_conn(c).in_transaction)
        raise RuntimeError("fallo a propósito")

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    enqueue(_conn(ctx), "auth.check", now=T0)

    run_one(ctx, reg, "w1")

    assert seen == [False]
    assert _conn(ctx).in_transaction is False


def test_run_one_writes_heartbeat_with_current_job(ctx: StageContext) -> None:
    seen: list[object] = []

    def handler(c: StageContext, j: object) -> None:
        seen.append(_conn(c).execute("SELECT current_job_id FROM worker_heartbeat").fetchone()[0])

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    run_one(ctx, reg, "w1")

    assert seen == [jid]


def test_run_worker_requeues_orphans_ticks_scheduler_and_stops(ctx: StageContext) -> None:
    stop = threading.Event()
    ticks: list[datetime] = []

    class Sched:
        def tick(self, conn: sqlite3.Connection, now: datetime) -> list[int]:
            ticks.append(now)
            stop.set()
            return []

    jid = enqueue(_conn(ctx), "auth.check", now=T0)
    claim(_conn(ctx), "old", T0)

    run_worker(ctx, HandlerRegistry(), worker_id="w1", stop=stop, poll_s=0.001, scheduler=Sched())

    assert ticks == [T0]
    job = get_job(_conn(ctx), jid)
    assert job is not None
    # El huérfano vuelve a `queued` y el ciclo siguiente lo toma otra vez (attempts 1 → 2).
    # Sin handler falla de forma permanente.
    assert (job.state, job.attempts, job.last_error) == ("failed", 2, "sin handler")
    assert _conn(ctx).execute("SELECT worker_id FROM worker_heartbeat").fetchone()[0] == "w1"


def test_run_worker_finishes_current_job_before_stopping(ctx: StageContext) -> None:
    stop = threading.Event()

    def handler(c: StageContext, j: object) -> None:
        stop.set()  # llega SIGTERM mientras el trabajo corre

    reg = HandlerRegistry()
    reg.add("auth.check", handler)
    first = enqueue(_conn(ctx), "auth.check", now=T0)
    second = enqueue(_conn(ctx), "auth.check", now=T0)

    run_worker(ctx, reg, worker_id="w1", stop=stop, poll_s=0.001)

    assert get_job(_conn(ctx), first).state == "done"  # type: ignore[union-attr]
    assert get_job(_conn(ctx), second).state == "queued"  # type: ignore[union-attr]


@pytest.mark.parametrize("poll_s", [0, -1.0])
def test_run_worker_rejects_non_positive_poll(ctx: StageContext, poll_s: float) -> None:
    with pytest.raises(ValueError):
        run_worker(ctx, HandlerRegistry(), worker_id="w1", stop=threading.Event(), poll_s=poll_s)


_MAX_SPINS = 5000


def test_heartbeat_thread_beats_during_long_job_then_stops(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = worker_mod.write_heartbeat
    beats: list[tuple[str, int | None]] = []
    two_beats = threading.Event()

    def recording(
        conn: sqlite3.Connection, worker_id: str, now: datetime, current_job_id: int | None
    ) -> None:
        real(conn, worker_id, now, current_job_id)
        beats.append((threading.current_thread().name, current_job_id))
        if sum(1 for name, _ in beats if name == HEARTBEAT_THREAD) >= 2:
            two_beats.set()

    monkeypatch.setattr(worker_mod, "write_heartbeat", recording)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    def handler(c: StageContext, j: object) -> dict[str, int]:
        # El trabajo sigue corriendo hasta que el hilo de heartbeat escribe dos veces.
        assert two_beats.wait(timeout=5.0)
        return {"ok": 1}

    reg = HandlerRegistry()
    reg.add("auth.check", handler)

    assert run_one(ctx, reg, "w1", heartbeat_s=0.001) == jid

    assert sum(1 for name, _ in beats if name == HEARTBEAT_THREAD) >= 2
    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "done"
    assert not any(t.name == HEARTBEAT_THREAD for t in threading.enumerate())
    # Tras complete, el heartbeat ya no marca ningún trabajo como en curso.
    row = _conn(ctx).execute("SELECT current_job_id FROM worker_heartbeat").fetchone()
    assert row == (None,)


def test_heartbeat_errors_are_logged_and_job_still_completes(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    real = worker_mod.write_heartbeat
    attempted = threading.Event()

    def broken(
        conn: sqlite3.Connection, worker_id: str, now: datetime, current_job_id: int | None
    ) -> None:
        if threading.current_thread().name == HEARTBEAT_THREAD:
            attempted.set()
            raise sqlite3.OperationalError("database is locked")
        real(conn, worker_id, now, current_job_id)

    monkeypatch.setattr(worker_mod, "write_heartbeat", broken)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    def handler(c: StageContext, j: object) -> dict[str, int]:
        assert attempted.wait(timeout=5.0)
        return {"ok": 1}

    reg = HandlerRegistry()
    reg.add("auth.check", handler)

    with caplog.at_level(logging.WARNING, logger="frances.jobs.worker"):
        assert run_one(ctx, reg, "w1", heartbeat_s=0.001) == jid

    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "done"
    assert "database is locked" in caplog.text


def test_heartbeat_stops_writing_once_job_exceeds_max_job_s(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    max_job_s = 60.0
    limit = T0 + timedelta(seconds=max_job_s)
    clock = {"t": T0}
    timed = dataclasses.replace(ctx, now=lambda: clock["t"])
    real = worker_mod.write_heartbeat
    beat_times: list[datetime] = []
    first_beat = threading.Event()
    release = threading.Event()

    def recording(
        conn: sqlite3.Connection, worker_id: str, now: datetime, current_job_id: int | None
    ) -> None:
        real(conn, worker_id, now, current_job_id)
        if threading.current_thread().name == HEARTBEAT_THREAD:
            beat_times.append(now)
            first_beat.set()

    monkeypatch.setattr(worker_mod, "write_heartbeat", recording)
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    def handler(c: StageContext, j: object) -> dict[str, int]:
        assert first_beat.wait(timeout=5.0)  # un latido dentro del límite
        clock["t"] = limit + timedelta(seconds=1)  # el trabajo cuelga más allá de max_job_s
        for _ in range(200):  # margen para que el hilo habría escrito si siguiera vivo
            release.wait(0.001)
        return {"ok": 1}

    reg = HandlerRegistry()
    reg.add("auth.check", handler)

    with caplog.at_level(logging.WARNING, logger="frances.jobs.worker"):
        assert run_one(timed, reg, "w1", heartbeat_s=0.001, max_job_s=max_job_s) == jid

    assert beat_times and all(t <= limit for t in beat_times)
    assert not any(t.name == HEARTBEAT_THREAD for t in threading.enumerate())
    assert "auth.check" not in caplog.text  # la advertencia no lleva datos del trabajo
    assert sum("max_job_s" in r.getMessage() for r in caplog.records) == 1
    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "done"


def test_heartbeat_keeps_beating_during_graceful_stop(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Parada ordenada (SIGTERM): el trabajo en curso sigue y el heartbeat no se apaga,
    # para que el healthcheck no marque no sano a un worker que solo está terminando.
    stop = threading.Event()
    release = threading.Event()
    alive_after_stop = False
    jid = enqueue(_conn(ctx), "auth.check", now=T0)

    def handler(c: StageContext, j: object) -> dict[str, int]:
        stop.set()
        nonlocal alive_after_stop
        release.wait(0.05)  # deja correr varios ciclos de 1 ms con stop activo
        alive_after_stop = any(t.name == HEARTBEAT_THREAD for t in threading.enumerate())
        return {"ok": 1}

    reg = HandlerRegistry()
    reg.add("auth.check", handler)

    assert run_one(ctx, reg, "w1", stop=stop, heartbeat_s=0.001) == jid

    assert alive_after_stop is True
    assert not any(t.name == HEARTBEAT_THREAD for t in threading.enumerate())
    job = get_job(_conn(ctx), jid)
    assert job is not None
    assert job.state == "done"


def test_finished_job_clears_current_job_id(ctx: StageContext) -> None:
    reg = HandlerRegistry()
    reg.add("auth.check", lambda c, j: {"ok": 1})
    enqueue(_conn(ctx), "auth.check", now=T0)

    run_one(ctx, reg, "w1")

    row = _conn(ctx).execute("SELECT current_job_id FROM worker_heartbeat").fetchone()
    assert row == (None,)


def test_run_worker_idles_with_injected_wait(ctx: StageContext) -> None:
    waits: list[float] = []

    class RecordingEvent(threading.Event):
        """Espera inyectada: registra el intervalo y termina el bucle sin dormir de verdad."""

        def wait(self, timeout: float | None = None) -> bool:
            waits.append(timeout or 0.0)
            self.set()
            return True

    run_worker(ctx, HandlerRegistry(), worker_id="w1", stop=RecordingEvent(), poll_s=7)

    assert waits == [7]


def test_write_heartbeat_upserts_one_row_per_worker(ctx: StageContext) -> None:
    conn = _conn(ctx)
    write_heartbeat(conn, "w1", T0, None)
    later = datetime(2026, 11, 2, 10, 18, tzinfo=UTC)
    write_heartbeat(conn, "w1", later, 9)

    rows = conn.execute(
        "SELECT worker_id, seen_at, current_job_id FROM worker_heartbeat"
    ).fetchall()
    assert rows == [("w1", "2026-11-02T10:18:00.000000Z", 9)]


def test_default_worker_id_has_host_and_pid() -> None:
    assert default_worker_id() == f"{socket.gethostname()}-{os.getpid()}"
