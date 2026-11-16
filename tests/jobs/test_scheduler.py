"""Programador del worker: disparos en hora de Bogotá, un solo encolado por slot (SRV-07)."""

import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from frances.config import Settings
from frances.db.store import Store
from frances.jobs.scheduler import (
    FOLLOW_UPS,
    Schedule,
    Scheduler,
    last_fire,
    next_fire,
    schedules_from,
    slot_of,
)

BOG = ZoneInfo("America/Bogota")
DAILY = Schedule("pipeline.daily", "pipeline.daily", time(5, 17), None)
SUNDAY = Schedule("pipeline.reconcile", "pipeline.reconcile", time(6, 0), 6)
DAILY_KINDS = frozenset({"pipeline.daily"})


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "state.db"
    Store.open(path).close()
    return path


@pytest.fixture
def conn(db_path: Path) -> Iterator[sqlite3.Connection]:
    store = Store.connect(db_path)
    yield store.conn
    store.close()


@pytest.fixture
def settings() -> Settings:
    return Settings()


def test_next_fire_daily_and_sunday() -> None:
    now = datetime(2026, 11, 2, 10, 16, tzinfo=UTC)  # lunes 05:16 Bogotá
    assert next_fire(DAILY, now, BOG) == datetime(2026, 11, 2, 10, 17, tzinfo=UTC)
    assert next_fire(DAILY, datetime(2026, 11, 2, 10, 17, tzinfo=UTC), BOG) == datetime(
        2026, 11, 3, 10, 17, tzinfo=UTC
    )
    assert next_fire(SUNDAY, now, BOG) == datetime(2026, 11, 8, 11, 0, tzinfo=UTC)  # domingo 06:00


def test_last_fire_is_most_recent_slot_not_after_now() -> None:
    assert last_fire(DAILY, datetime(2026, 11, 2, 10, 16, tzinfo=UTC), BOG) == datetime(
        2026, 11, 1, 10, 17, tzinfo=UTC
    )
    assert last_fire(DAILY, datetime(2026, 11, 2, 10, 17, 30, tzinfo=UTC), BOG) == datetime(
        2026, 11, 2, 10, 17, tzinfo=UTC
    )
    # lunes 2026-11-02: el domingo más reciente es el 1 de noviembre a las 06:00 Bogotá
    assert last_fire(SUNDAY, datetime(2026, 11, 2, 10, 16, tzinfo=UTC), BOG) == datetime(
        2026, 11, 1, 11, 0, tzinfo=UTC
    )


def test_slot_is_local_date_of_the_fire() -> None:
    assert slot_of(DAILY, datetime(2026, 11, 2, 10, 17, tzinfo=UTC), BOG) == "2026-11-02"


def test_schedules_from_settings_defaults(settings: Settings) -> None:
    names = {s.name: (s.at, s.weekday) for s in schedules_from(settings)}
    assert names["pipeline.daily"] == (time(5, 17), None)
    assert names["pipeline.reconcile"] == (time(6, 0), 6)


def test_tick_enqueues_once_per_slot(conn: sqlite3.Connection, settings: Settings) -> None:
    sch = Scheduler(settings, DAILY_KINDS)
    at = datetime(2026, 11, 2, 10, 17, 3, tzinfo=UTC)
    assert len(sch.tick(conn, at)) == 1
    assert sch.tick(conn, at + timedelta(minutes=5)) == []


def test_tick_records_slot_with_its_job(conn: sqlite3.Connection, settings: Settings) -> None:
    (job_id,) = Scheduler(settings, DAILY_KINDS).tick(
        conn, datetime(2026, 11, 2, 10, 17, 3, tzinfo=UTC)
    )
    row = conn.execute("SELECT name, slot, job_id FROM schedule_slots").fetchone()
    assert tuple(row) == ("pipeline.daily", "2026-11-02", job_id)


def test_restart_after_fire_does_not_enqueue_twice(db_path: Path, settings: Settings) -> None:
    # REVIEW FOCUS 4 (plan maestro v2)
    at = datetime(2026, 11, 2, 10, 17, 3, tzinfo=UTC)
    with Store.connect(db_path).tx() as c:
        Scheduler(settings, DAILY_KINDS).tick(c, at)
    with Store.connect(db_path).tx() as c:  # nuevo proceso, el trabajo ya terminó
        c.execute("UPDATE jobs SET state='done'")
        assert Scheduler(settings, DAILY_KINDS).tick(c, at + timedelta(hours=1)) == []


def test_missed_slot_catches_up_within_window(conn: sqlite3.Connection, settings: Settings) -> None:
    sch = Scheduler(settings, DAILY_KINDS)
    # 15:00 Bogotá, dentro de 12 h del disparo de las 05:17
    assert len(sch.tick(conn, datetime(2026, 11, 2, 20, 0, tzinfo=UTC))) == 1
    sch2 = Scheduler(settings, DAILY_KINDS)
    # 04:00 del día siguiente: el de ayer ya corrió
    assert sch2.tick(conn, datetime(2026, 11, 3, 9, 0, tzinfo=UTC)) == []


def test_missed_slot_outside_window_is_skipped(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    # 18:00 Bogotá: 12.7 h después del disparo de las 05:17, fuera de catchup_hours=12
    assert (
        Scheduler(settings, DAILY_KINDS).tick(conn, datetime(2026, 11, 2, 23, 0, tzinfo=UTC)) == []
    )


def test_schedule_without_handler_is_ignored(conn: sqlite3.Connection, settings: Settings) -> None:
    at = datetime(2026, 11, 2, 10, 17, 3, tzinfo=UTC)
    assert Scheduler(settings, frozenset()).tick(conn, at) == []


def test_follow_ups_are_declared_for_daily_pipeline() -> None:
    assert FOLLOW_UPS["pipeline.daily"] == ("index.text_blocks", "llm.sheet", "llm.topics")
