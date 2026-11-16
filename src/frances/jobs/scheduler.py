"""Programador del worker: disparos diarios y semanales en la hora de Bogotá (R-41, SRV-07).

Cada disparo deja su `(name, slot)` en `schedule_slots` en la misma transacción que el
`enqueue`. Un reinicio del worker después de la hora no encola el mismo slot otra vez.
El reloj entra como argumento `now`; nada lee la hora del sistema.
"""

import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo

from frances.config import Settings
from frances.jobs.queue import enqueue
from frances.models.jobs import JobKind
from frances.timeutil import format_ts

# Lo que cada trabajo encola al terminar con cambios (plan maestro v2, R-41).
FOLLOW_UPS: Mapping[JobKind, tuple[JobKind, ...]] = {
    "pipeline.daily": ("index.text_blocks", "llm.sheet", "llm.topics"),
}

_MAX_DAYS_SCANNED = 8


@dataclass(frozen=True)
class Schedule:
    name: str
    kind: JobKind
    at: time
    weekday: int | None  # 0 = lunes … 6 = domingo; None = diario


def schedules_from(settings: Settings) -> tuple[Schedule, ...]:
    """Los cuatro disparos del día y de la semana, con las horas de `[scheduler]`."""
    s = settings.scheduler
    return (
        Schedule("pipeline.daily", "pipeline.daily", time.fromisoformat(s.daily_at), None),
        Schedule(
            "pipeline.reconcile",
            "pipeline.reconcile",
            time.fromisoformat(s.reconcile_at),
            s.reconcile_weekday,
        ),
        Schedule("auth.check", "auth.check", time.fromisoformat(s.auth_check_at), None),
        Schedule("plan.daily", "plan.daily", time.fromisoformat(s.plan_at), None),
    )


def _occurrence(s: Schedule, day: date, tz: tzinfo) -> datetime:
    return datetime.combine(day, s.at, tzinfo=tz).astimezone(UTC)


def _matches_day(s: Schedule, day: date) -> bool:
    return s.weekday is None or day.weekday() == s.weekday


def next_fire(s: Schedule, now: datetime, tz: tzinfo) -> datetime:
    """Primer disparo estrictamente posterior a `now`, en UTC."""
    day = now.astimezone(tz).date()
    for offset in range(_MAX_DAYS_SCANNED * 2):
        candidate_day = day + timedelta(days=offset)
        if not _matches_day(s, candidate_day):
            continue
        candidate = _occurrence(s, candidate_day, tz)
        if candidate > now:
            return candidate
    raise RuntimeError(f"sin próximo disparo para {s.name}")


def last_fire(s: Schedule, now: datetime, tz: tzinfo) -> datetime:
    """Disparo más reciente con `fecha <= now`, en UTC."""
    day = now.astimezone(tz).date()
    for offset in range(_MAX_DAYS_SCANNED):
        candidate_day = day - timedelta(days=offset)
        if not _matches_day(s, candidate_day):
            continue
        candidate = _occurrence(s, candidate_day, tz)
        if candidate <= now:
            return candidate
    raise RuntimeError(f"sin disparo previo para {s.name}")


def slot_of(s: Schedule, fire: datetime, tz: tzinfo) -> str:
    """Fecha local del disparo, `YYYY-MM-DD` (el domingo, en el caso semanal)."""
    del s  # el slot depende solo del día local del disparo
    return fire.astimezone(tz).date().isoformat()


@contextmanager
def _tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """`BEGIN IMMEDIATE` propio, salvo que la conexión ya esté en una transacción."""
    if conn.in_transaction:
        yield conn
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


class Scheduler:
    """Encola los disparos vencidos de los schedules cuyo `kind` tiene handler."""

    def __init__(self, settings: Settings, kinds: frozenset[JobKind]) -> None:
        self._tz: tzinfo = ZoneInfo(settings.scheduler.timezone)
        self._catchup = timedelta(hours=settings.scheduler.catchup_hours)
        self._schedules = tuple(s for s in schedules_from(settings) if s.kind in kinds)

    def tick(self, conn: sqlite3.Connection, now: datetime) -> list[int]:
        """Encola el último disparo de cada schedule si cae dentro de `catchup_hours`.

        Devuelve los ids de los trabajos nuevos. Un slot ya registrado no se vuelve a encolar.
        """
        created: list[int] = []
        with _tx(conn):
            for s in self._schedules:
                fire = last_fire(s, now, self._tz)
                if now - fire > self._catchup:
                    continue
                slot = slot_of(s, fire, self._tz)
                seen = conn.execute(
                    "SELECT 1 FROM schedule_slots WHERE name = ? AND slot = ?", (s.name, slot)
                ).fetchone()
                if seen is not None:
                    continue
                job_id = enqueue(
                    conn, s.kind, {"slot": slot}, now=now, dedupe_key=f"{s.name}:{slot}"
                )
                conn.execute(
                    "INSERT INTO schedule_slots (name, slot, job_id, enqueued_at) "
                    "VALUES (?, ?, ?, ?)",
                    (s.name, slot, job_id, format_ts(now)),
                )
                created.append(job_id)
        return created
