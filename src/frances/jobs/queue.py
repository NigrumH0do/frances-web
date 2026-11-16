"""Cola de trabajos en SQLite: enqueue, claim, complete, fail y backoff (plan maestro v2).

Cada operación recibe una conexión. Si la conexión no tiene una transacción abierta,
la operación abre una `BEGIN IMMEDIATE` propia; si ya hay una, participa en ella.
El tiempo entra como argumento `now`; nada lee el reloj.
"""

import json
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

from frances.errors import FrancesError
from frances.log import redact
from frances.models.jobs import JobKind, JobOut, JobState
from frances.timeutil import format_ts

_MAX_ERROR_CHARS = 500
_COLUMNS = (
    "id, kind, payload, state, priority, attempts, max_attempts, run_after, "
    "dedupe_key, locked_by, last_error, created_at, updated_at, finished_at"
)


class PermanentJobError(FrancesError):
    """El handler la lanza: el trabajo falla sin reintentos (p. ej. un AuthError del pipeline)."""


@dataclass(frozen=True)
class Job:
    id: int
    kind: JobKind
    payload: dict[str, Any]
    state: JobState
    priority: int
    attempts: int
    max_attempts: int
    run_after: str
    dedupe_key: str | None
    locked_by: str | None
    last_error: str | None
    created_at: str
    updated_at: str
    # No está en el bloque «Cola de trabajos» del plan maestro, pero JobOut lo
    # exige; se agrega al final con default para que `to_out` sea pura (SRV-05).
    finished_at: str | None = None


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


def _dumps(value: Mapping[str, Any]) -> str:
    return json.dumps(dict(value), sort_keys=True, separators=(",", ":"))


def _row_to_job(row: tuple[Any, ...]) -> Job:
    (
        job_id,
        kind,
        payload,
        state,
        priority,
        attempts,
        max_attempts,
        run_after,
        dedupe_key,
        locked_by,
        last_error,
        created_at,
        updated_at,
        finished_at,
    ) = row
    return Job(
        id=int(job_id),
        kind=cast(JobKind, kind),
        payload=json.loads(payload),
        state=cast(JobState, state),
        priority=int(priority),
        attempts=int(attempts),
        max_attempts=int(max_attempts),
        run_after=str(run_after),
        dedupe_key=dedupe_key,
        locked_by=locked_by,
        last_error=last_error,
        created_at=str(created_at),
        updated_at=str(updated_at),
        finished_at=None if finished_at is None else str(finished_at),
    )


def to_out(job: Job) -> JobOut:
    """Vista pública del trabajo: sin payload, resultado, dueño del lock ni dedupe_key."""
    return JobOut(
        id=job.id,
        kind=job.kind,
        state=job.state,
        attempts=job.attempts,
        max_attempts=job.max_attempts,
        run_after=job.run_after,
        last_error=job.last_error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finished_at=job.finished_at,
    )


def backoff_seconds(attempts: int, base_s: int = 60, cap_s: int = 3600) -> int:
    """Espera tras el fallo número `attempts`: `base_s * 2 ** (attempts - 1)`, con tope `cap_s`."""
    if attempts < 1:
        raise ValueError("attempts debe ser >= 1")
    return int(min(cap_s, base_s * 2 ** (attempts - 1)))


def enqueue(
    conn: sqlite3.Connection,
    kind: JobKind,
    payload: Mapping[str, Any] | None = None,
    *,
    now: datetime,
    run_after: datetime | None = None,
    dedupe_key: str | None = None,
    priority: int = 0,
    max_attempts: int = 5,
) -> int:
    """Encola un trabajo y devuelve su id.

    Con `dedupe_key` de un trabajo `queued` o `running`, devuelve el id de ese trabajo
    y no inserta nada (índice único parcial `jobs_dedupe_active`).
    """
    if max_attempts < 1:
        raise ValueError("max_attempts debe ser >= 1")
    body = _dumps(payload or {})
    when = format_ts(run_after or now)
    stamp = format_ts(now)
    with _tx(conn):
        row = conn.execute(
            "INSERT INTO jobs (kind, payload, state, priority, attempts, max_attempts, "
            "run_after, dedupe_key, created_at, updated_at) "
            "VALUES (?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?) "
            "ON CONFLICT DO NOTHING RETURNING id",
            (kind, body, priority, max_attempts, when, dedupe_key, stamp, stamp),
        ).fetchone()
        if row is not None:
            return int(row[0])
        active = conn.execute(
            "SELECT id FROM jobs WHERE dedupe_key = ? AND state IN ('queued', 'running')",
            (dedupe_key,),
        ).fetchone()
    if active is None:
        raise RuntimeError(f"dedupe_key {dedupe_key!r} sin trabajo activo tras un conflicto")
    return int(active[0])


def claim(conn: sqlite3.Connection, worker_id: str, now: datetime) -> Job | None:
    """Toma el trabajo `queued` listo de mayor prioridad (luego `run_after`, luego `id`).

    Un único `UPDATE ... RETURNING` dentro de `BEGIN IMMEDIATE`: dos conexiones nunca
    reciben el mismo trabajo.
    """
    stamp = format_ts(now)
    with _tx(conn):
        row = conn.execute(
            "UPDATE jobs SET state = 'running', attempts = attempts + 1, locked_by = ?, "
            "locked_at = ?, updated_at = ? "
            "WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND run_after <= ? "
            "ORDER BY priority DESC, run_after, id LIMIT 1) "
            f"RETURNING {_COLUMNS}",
            (worker_id, stamp, stamp, stamp),
        ).fetchone()
    return None if row is None else _row_to_job(row)


def complete(
    conn: sqlite3.Connection,
    job_id: int,
    now: datetime,
    result: Mapping[str, Any] | None = None,
) -> None:
    """Marca un trabajo `running` como `done`. `ValueError` si no está en `running`."""
    body = None if result is None else _dumps(result)
    stamp = format_ts(now)
    with _tx(conn):
        cursor = conn.execute(
            "UPDATE jobs SET state = 'done', result = ?, finished_at = ?, updated_at = ? "
            "WHERE id = ? AND state = 'running'",
            (body, stamp, stamp, job_id),
        )
        if cursor.rowcount != 1:
            raise ValueError(f"el trabajo {job_id} no está running")


def fail(
    conn: sqlite3.Connection,
    job_id: int,
    error: str,
    now: datetime,
    *,
    retryable: bool = True,
    backoff_base_s: int = 60,
    backoff_cap_s: int = 3600,
) -> JobState:
    """Registra un fallo de un trabajo `running`.

    Vuelve a `queued` con `run_after = now + backoff` si quedan intentos y el fallo es
    reintentable; si no, pasa a `failed`. El error pasa por `redact` y se corta a 500 caracteres.
    """
    text = redact(error)[:_MAX_ERROR_CHARS]
    stamp = format_ts(now)
    with _tx(conn):
        row = conn.execute(
            "SELECT attempts, max_attempts, state FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None or row[2] != "running":
            raise ValueError(f"el trabajo {job_id} no está running")
        attempts, max_attempts = int(row[0]), int(row[1])
        if not retryable or attempts >= max_attempts:
            conn.execute(
                "UPDATE jobs SET state = 'failed', last_error = ?, finished_at = ?, "
                "updated_at = ? WHERE id = ?",
                (text, stamp, stamp, job_id),
            )
            return "failed"
        wait = backoff_seconds(attempts, backoff_base_s, backoff_cap_s)
        retry_at = format_ts(now + timedelta(seconds=wait))
        conn.execute(
            "UPDATE jobs SET state = 'queued', last_error = ?, run_after = ?, updated_at = ?, "
            "locked_by = NULL, locked_at = NULL WHERE id = ?",
            (text, retry_at, stamp, job_id),
        )
        return "queued"


def requeue_orphans(conn: sqlite3.Connection, now: datetime) -> int:
    """Al arrancar el worker: todo `running` vuelve a `queued`. Devuelve cuántos.

    El intento ya contado no se devuelve. Hay un solo worker, así que un `running`
    al arrancar es huérfano.
    """
    stamp = format_ts(now)
    with _tx(conn):
        cursor = conn.execute(
            "UPDATE jobs SET state = 'queued', locked_by = NULL, locked_at = NULL, "
            "run_after = ?, updated_at = ? WHERE state = 'running'",
            (stamp, stamp),
        )
        return int(cursor.rowcount)


def retry(conn: sqlite3.Connection, job_id: int, now: datetime) -> Job:
    """Reintento manual: un trabajo `failed` vuelve a `queued` con `attempts = 0`.

    `ValueError` si el trabajo no existe o no está en `failed`.
    """
    stamp = format_ts(now)
    with _tx(conn):
        row = conn.execute("SELECT state FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None or row[0] != "failed":
            raise ValueError(f"el trabajo {job_id} no está failed")
        conn.execute(
            "UPDATE jobs SET state = 'queued', attempts = 0, run_after = ?, finished_at = NULL, "
            "locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
            (stamp, stamp, job_id),
        )
        fresh = conn.execute(f"SELECT {_COLUMNS} FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_job(fresh)


def get_job(conn: sqlite3.Connection, job_id: int) -> Job | None:
    row = conn.execute(f"SELECT {_COLUMNS} FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return None if row is None else _row_to_job(row)


def list_jobs(
    conn: sqlite3.Connection,
    *,
    state: JobState | None = None,
    kind: JobKind | None = None,
    limit: int = 50,
) -> list[Job]:
    """Trabajos más recientes primero, con filtros opcionales por estado y kind."""
    clauses: list[str] = []
    params: list[Any] = []
    if state is not None:
        clauses.append("state = ?")
        params.append(state)
    if kind is not None:
        clauses.append("kind = ?")
        params.append(kind)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    rows = conn.execute(
        f"SELECT {_COLUMNS} FROM jobs{where} ORDER BY id DESC LIMIT ?", params
    ).fetchall()
    return [_row_to_job(row) for row in rows]


def counts_by_state(conn: sqlite3.Connection) -> dict[JobState, int]:
    """Cuenta los trabajos por estado. Siempre devuelve las cuatro claves."""
    counts: dict[JobState, int] = {"queued": 0, "running": 0, "done": 0, "failed": 0}
    for state, total in conn.execute("SELECT state, COUNT(*) FROM jobs GROUP BY state"):
        counts[cast(JobState, state)] = int(total)
    return counts
