"""Migración 0002: cuentas, invitaciones, sesiones, jobs, programador y heartbeat (CHG-02)."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from frances.db.store import Store


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    s = Store.open(tmp_path / "s.db")
    yield s
    s.close()


def test_0002_tables_and_version(tmp_path: Path) -> None:
    s = Store.open(tmp_path / "s.db")
    names = {r[0] for r in s.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"users", "invites", "sessions", "jobs", "schedule_slots", "worker_heartbeat"} <= names
    assert s.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] >= 2
    s.close()


def test_email_unique_case_insensitive(store: Store) -> None:
    ins = "INSERT INTO users VALUES (?, ?, 'N', 'h', 'user', NULL, 't', NULL, NULL)"
    store.conn.execute(ins, ("u_1", "Ana@Ex.org"))
    with pytest.raises(sqlite3.IntegrityError):
        store.conn.execute(ins, ("u_2", "ana@ex.org"))


def test_dedupe_index_only_for_active_jobs(store: Store) -> None:
    q = (
        "INSERT INTO jobs (kind, state, run_after, dedupe_key, created_at, updated_at) "
        "VALUES ('pipeline.daily', ?, 't', 'pipeline.daily:2026-11-02', 't', 't')"
    )
    store.conn.execute(q, ("done",))
    store.conn.execute(q, ("queued",))
    with pytest.raises(sqlite3.IntegrityError):
        store.conn.execute(q, ("running",))


def test_role_and_state_checks(store: Store) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        store.conn.execute(
            "INSERT INTO jobs (kind, state, run_after, created_at, updated_at)"
            " VALUES ('x', 'paused', 't', 't', 't')"
        )
