"""Cola de trabajos en SQLite: enqueue, claim, complete, fail, backoff y dedupe (SRV-05)."""

import sqlite3
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from frances.db.store import Store
from frances.jobs.queue import (
    backoff_seconds,
    claim,
    complete,
    counts_by_state,
    enqueue,
    fail,
    get_job,
    requeue_orphans,
    retry,
    to_out,
)
from frances.timeutil import parse_ts

T0 = datetime(2026, 11, 2, 10, 17, tzinfo=UTC)


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    store = Store.open(tmp_path / "state.db")
    yield store.conn
    store.close()


def test_backoff_sequence() -> None:
    assert [backoff_seconds(a) for a in (1, 2, 3, 4)] == [60, 120, 240, 480]
    assert backoff_seconds(20) == 3600


def test_fifth_failure_marks_failed(conn: sqlite3.Connection) -> None:
    # REVIEW FOCUS 5 (plan maestro v2)
    jid = enqueue(conn, "pipeline.daily", now=T0)
    now, waits = T0, []
    for attempt in range(1, 6):
        job = claim(conn, "w1", now)
        assert job is not None and job.id == jid and job.attempts == attempt
        state = fail(conn, jid, f"boom {attempt}", now)
        if attempt < 5:
            nxt = parse_ts(get_job(conn, jid).run_after)  # type: ignore[union-attr]
            waits.append(int((nxt - now).total_seconds()))
            assert claim(conn, "w1", now) is None  # todavía no le toca
            now = nxt
    assert state == "failed" and waits == [60, 120, 240, 480]
    assert get_job(conn, jid).last_error == "boom 5"  # type: ignore[union-attr]


def test_permanent_failure_skips_retries(conn: sqlite3.Connection) -> None:
    jid = enqueue(conn, "auth.check", now=T0)
    claim(conn, "w1", T0)
    assert fail(conn, jid, "AuthError", T0, retryable=False) == "failed"


def test_dedupe_returns_active_job(conn: sqlite3.Connection) -> None:
    a = enqueue(conn, "pipeline.daily", now=T0, dedupe_key="pipeline.daily:2026-11-02")
    assert enqueue(conn, "pipeline.daily", now=T0, dedupe_key="pipeline.daily:2026-11-02") == a
    claim(conn, "w1", T0)
    complete(conn, a, T0)
    assert enqueue(conn, "pipeline.daily", now=T0, dedupe_key="pipeline.daily:2026-11-02") != a


def test_claim_order_priority_then_run_after(conn: sqlite3.Connection) -> None:
    low = enqueue(conn, "llm.sheet", now=T0)
    high = enqueue(conn, "pipeline.daily", now=T0, priority=10)
    enqueue(conn, "llm.topics", now=T0, run_after=T0 + timedelta(hours=1))
    first = claim(conn, "w", T0)
    second = claim(conn, "w", T0)
    assert first is not None and second is not None
    assert [first.id, second.id, claim(conn, "w", T0)] == [high, low, None]


def test_requeue_orphans_and_admin_retry(conn: sqlite3.Connection) -> None:
    jid = enqueue(conn, "pipeline.daily", now=T0)
    claim(conn, "w1", T0)
    assert requeue_orphans(conn, T0) == 1
    job = get_job(conn, jid)
    assert job is not None and job.state == "queued" and job.attempts == 1
    claim(conn, "w1", T0)
    fail(conn, jid, "x", T0, retryable=False)
    j = retry(conn, jid, T0)
    assert (j.state, j.attempts) == ("queued", 0)
    with pytest.raises(ValueError):
        retry(conn, jid, T0)  # solo desde failed


def test_error_text_is_redacted_and_truncated(conn: sqlite3.Connection) -> None:
    jid = enqueue(conn, "pipeline.daily", now=T0)
    claim(conn, "w1", T0)
    fail(conn, jid, "Bearer abc.def " + "x" * 900, T0)
    job = get_job(conn, jid)
    assert job is not None
    err = job.last_error
    assert err is not None and "abc.def" not in err and len(err) <= 500


def test_counts_by_state_has_all_keys(conn: sqlite3.Connection) -> None:
    assert counts_by_state(conn) == {"queued": 0, "running": 0, "done": 0, "failed": 0}


def test_concurrent_claims_never_deliver_the_same_job(tmp_path: Path) -> None:
    db = tmp_path / "state.db"
    Store.open(db).close()
    setup = Store.connect(db)
    ids = {enqueue(setup.conn, "llm.sheet", now=T0) for _ in range(40)}
    setup.close()

    claimed: list[int] = []
    lock = threading.Lock()
    barrier = threading.Barrier(4)

    def worker(name: str) -> None:
        store = Store.connect(db)
        try:
            barrier.wait()
            while (job := claim(store.conn, name, T0)) is not None:
                with lock:
                    claimed.append(job.id)
        finally:
            store.close()

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claimed) == sorted(ids)


def test_to_out_copies_finished_at_and_hides_internals(conn: sqlite3.Connection) -> None:
    jid = enqueue(conn, "pipeline.daily", now=T0, payload={"secret": "x"})
    pending = get_job(conn, jid)
    assert pending is not None and to_out(pending).finished_at is None
    claim(conn, "w1", T0)
    complete(conn, jid, T0)
    done = get_job(conn, jid)
    assert done is not None and done.finished_at is not None
    out = to_out(done)
    assert out.id == jid and out.state == "done" and out.finished_at == done.finished_at
    assert not {"payload", "result", "locked_by", "dedupe_key"} & set(type(out).model_fields)
