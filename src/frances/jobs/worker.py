"""Bucle del worker: heartbeat, un trabajo por ciclo y parada limpia (plan maestro v2, SRV-06).

Un ciclo escribe el heartbeat, deja correr al programador si lo hay, y toma y ejecuta como
mucho un trabajo. El handler corre fuera de toda transacción: `claim`, `complete` y `fail`
abren y cierran cada una la suya.
"""

import logging
import os
import socket
import sqlite3
import threading
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from frances.db.store import Store
from frances.jobs.queue import PermanentJobError, claim, complete, fail, requeue_orphans
from frances.jobs.registry import HandlerRegistry
from frances.log import redact
from frances.stage import StageContext
from frances.timeutil import format_ts

logger = logging.getLogger(__name__)

HEARTBEAT_THREAD = "frances-heartbeat"

# Tope de un trabajo: 8 h, por encima del tope v1 de 400 min del pipeline. Pasado el tope,
# el heartbeat deja de escribir y `frances worker --check` marca el worker como no sano.
DEFAULT_MAX_JOB_S = 8 * 3600.0


class SchedulerLike(Protocol):
    """Lo que el bucle necesita del programador (SRV-07)."""

    def tick(self, conn: sqlite3.Connection, now: datetime) -> list[int]: ...


def default_worker_id() -> str:
    """Identidad del worker en `claim` y en `worker_heartbeat`: host y PID."""
    return f"{socket.gethostname()}-{os.getpid()}"


def write_heartbeat(
    conn: sqlite3.Connection, worker_id: str, now: datetime, current_job_id: int | None
) -> None:
    """Upsert de la fila del worker en `worker_heartbeat`."""
    conn.execute(
        "INSERT INTO worker_heartbeat (worker_id, seen_at, current_job_id) VALUES (?, ?, ?) "
        "ON CONFLICT(worker_id) DO UPDATE SET seen_at = excluded.seen_at, "
        "current_job_id = excluded.current_job_id",
        (worker_id, format_ts(now), current_job_id),
    )


def _describe(exc: Exception) -> str:
    """`Tipo: mensaje`; `fail` redacta el texto completo."""
    return f"{type(exc).__name__}: {exc}"


def _db_file(conn: sqlite3.Connection) -> Path:
    """Ruta del archivo de la conexión principal, para que el hilo abra la suya."""
    row = conn.execute("PRAGMA database_list").fetchone()
    return Path(str(row[2]))


def _beat_loop(
    db_path: Path,
    worker_id: str,
    job_id: int,
    now: Callable[[], datetime],
    every_s: float,
    done: threading.Event,
    started: datetime,
    max_job_s: float,
) -> None:
    """Hilo de heartbeat: escribe cada `every_s` hasta que termina el trabajo.

    Sale en cuanto `done` se activa (el handler volvió) o cuando el trabajo supera
    `max_job_s`. En ese caso registra una sola advertencia con el id del trabajo (sin su
    contenido) y deja de escribir, para que `frances worker --check` vea al worker colgado
    como no sano. La parada del worker NO lo detiene: durante una parada ordenada el
    trabajo en curso sigue y debe seguir latiendo hasta terminar.
    Usa su propia conexión (SQLite no comparte conexiones entre hilos). Sus errores se
    registran con `redact` y no detienen el trabajo.
    """
    try:
        store = Store.connect(db_path)
    except Exception as exc:
        logger.warning("heartbeat: no abre la base: %s", redact(str(exc)))
        return
    try:
        while not done.wait(every_s):
            if (now() - started).total_seconds() > max_job_s:
                logger.warning(
                    "heartbeat detenido: el trabajo %s supera max_job_s=%s s", job_id, max_job_s
                )
                return
            try:
                write_heartbeat(store.conn, worker_id, now(), job_id)
            except Exception as exc:
                logger.warning("heartbeat trabajo %s: %s", job_id, redact(str(exc)))
    finally:
        store.close()


def run_one(
    ctx: StageContext,
    reg: HandlerRegistry,
    worker_id: str,
    *,
    heartbeat_s: float = 30.0,
    stop: threading.Event | None = None,
    max_job_s: float = DEFAULT_MAX_JOB_S,
) -> int | None:
    """Toma y ejecuta un trabajo. Devuelve su id, o `None` si no había ninguno listo.

    Mientras corre el handler, un hilo daemon escribe el heartbeat cada `heartbeat_s`.
    El hilo sale cuando el handler termina, cuando `stop` (evento de parada del worker)
    se activa, o cuando el trabajo supera `max_job_s`; en los dos últimos casos el handler
    sigue corriendo, pero el heartbeat ya no lo marca como sano. El hilo se une antes de
    escribir el resultado. Al final el heartbeat deja de marcar el trabajo como en curso.

    Sin handler → fallo permanente con `sin handler`. `PermanentJobError` → fallo sin
    reintento. Otra `Exception` → fallo reintentable con backoff. `BaseException`
    (p. ej. `KeyboardInterrupt`) deja el trabajo `running`; `requeue_orphans` lo recupera
    al arrancar y se relanza.
    """
    conn = ctx.store.conn
    started = ctx.now()
    job = claim(conn, worker_id, started)
    if job is None:
        return None
    write_heartbeat(conn, worker_id, ctx.now(), job.id)
    handler = reg.get(job.kind)
    if handler is None:
        fail(conn, job.id, "sin handler", ctx.now(), retryable=False)
        write_heartbeat(conn, worker_id, ctx.now(), None)
        return job.id
    done = threading.Event()
    beater = threading.Thread(
        target=_beat_loop,
        args=(
            _db_file(conn),
            worker_id,
            job.id,
            ctx.now,
            heartbeat_s,
            done,
            started,
            max_job_s,
        ),
        name=HEARTBEAT_THREAD,
        daemon=True,
    )
    beater.start()
    result: Mapping[str, Any] | None = None
    error: Exception | None = None
    try:
        result = handler(ctx, job)
    except Exception as exc:
        error = exc
    finally:
        done.set()
        beater.join()
    if error is None:
        complete(conn, job.id, ctx.now(), result)
    else:
        retryable = not isinstance(error, PermanentJobError)
        fail(conn, job.id, _describe(error), ctx.now(), retryable=retryable)
    write_heartbeat(conn, worker_id, ctx.now(), None)
    return job.id


def run_cycle(
    ctx: StageContext,
    reg: HandlerRegistry,
    worker_id: str,
    scheduler: SchedulerLike | None = None,
    *,
    heartbeat_s: float = 30.0,
    stop: threading.Event | None = None,
    max_job_s: float = DEFAULT_MAX_JOB_S,
) -> int | None:
    """Un ciclo: heartbeat, programador si lo hay y, como mucho, un trabajo."""
    conn = ctx.store.conn
    now = ctx.now()
    write_heartbeat(conn, worker_id, now, None)
    if scheduler is not None:
        scheduler.tick(conn, now)
    return run_one(ctx, reg, worker_id, heartbeat_s=heartbeat_s, stop=stop, max_job_s=max_job_s)


def run_worker(
    ctx: StageContext,
    reg: HandlerRegistry,
    *,
    worker_id: str,
    stop: threading.Event,
    poll_s: float,
    scheduler: SchedulerLike | None = None,
    max_job_s: float = DEFAULT_MAX_JOB_S,
) -> None:
    """Bucle hasta `stop`: primero recupera huérfanos; luego ciclos. Sin trabajo, espera `poll_s`.

    `poll_s` debe ser mayor que cero: con cero el bucle no espera y gira sin pausa.
    `stop` se revisa entre ciclos, así que el trabajo en curso termina antes de salir.
    La espera es `stop.wait(poll_s)`: el reloj y la espera salen del `Event` y de `ctx.now`,
    y los tests las sustituyen sin dormir de verdad.
    """
    if poll_s <= 0:
        raise ValueError(f"poll_s debe ser mayor que cero, no {poll_s}")
    requeue_orphans(ctx.store.conn, ctx.now())
    while not stop.is_set():
        if (
            run_cycle(
                ctx,
                reg,
                worker_id,
                scheduler,
                heartbeat_s=poll_s,
                stop=stop,
                max_job_s=max_job_s,
            )
            is None
        ):
            stop.wait(poll_s)
