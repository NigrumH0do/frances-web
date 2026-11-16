"""CLI del worker y de la cola: `frances worker` y `frances jobs ...` (SRV-06).

`frances worker` corre el bucle hasta SIGTERM/SIGINT; `--once` hace un ciclo y sale;
`--check` sale 0 si el último heartbeat es reciente (lo usa el healthcheck de compose).
La salida de `jobs` imprime ids y estados, nunca payloads.
"""

import json
import os
import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from types import FrameType
from typing import Annotated, Any, cast, get_args

import typer

from frances.cli import exit_with
from frances.config import resolve_data_dir
from frances.errors import FrancesError
from frances.jobs.queue import enqueue, list_jobs, retry
from frances.jobs.registry import HandlerRegistry, import_optional, load_handlers
from frances.jobs.worker import SchedulerLike, default_worker_id, run_cycle, run_worker
from frances.models.jobs import JobKind, JobState
from frances.stage import StageContext, make_context
from frances.timeutil import parse_ts

_DATA_HELP = "Raíz del repo de datos (por defecto FRANCES_DATA_DIR o el directorio actual)"

DataFlag = Annotated[Path | None, typer.Option("--data", help=_DATA_HELP)]
OnceFlag = Annotated[bool, typer.Option("--once", help="Un ciclo y sale.")]
CheckFlag = Annotated[bool, typer.Option("--check", help="Sale 0 si el heartbeat es reciente.")]
PayloadOpt = Annotated[str, typer.Option("--payload", help="Objeto JSON del trabajo.")]
StateOpt = Annotated[str | None, typer.Option("--state", help="queued, running, done o failed.")]
LimitOpt = Annotated[int, typer.Option("--limit", min=1, max=500)]


def _data_dir(data: Path | None) -> Path:
    return resolve_data_dir(os.environ, Path(".")) if data is None else data


def _heartbeat_fresh(ctx: StageContext) -> bool:
    """¿El heartbeat más reciente tiene menos de 2 * poll_s + 60 s?"""
    row = ctx.store.conn.execute("SELECT MAX(seen_at) FROM worker_heartbeat").fetchone()
    if row is None or row[0] is None:
        return False
    window = timedelta(seconds=2 * ctx.settings.jobs.poll_s + 60)
    return ctx.now() - parse_ts(str(row[0])) < window


def _scheduler(ctx: StageContext, reg: HandlerRegistry) -> SchedulerLike | None:
    """El programador de SRV-07 si su módulo existe; si no, el worker corre sin él."""
    module = import_optional("frances.jobs.scheduler")
    if module is None:
        return None
    scheduler: SchedulerLike = module.Scheduler(ctx.settings, reg.kinds())
    return scheduler


@contextmanager
def _stop_on_signals(stop: threading.Event) -> Iterator[None]:
    """SIGTERM y SIGINT ponen `stop`; los manejadores anteriores vuelven al salir."""

    def on_signal(signum: int, frame: FrameType | None) -> None:
        stop.set()

    previous = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        yield
    finally:
        for sig, handler in previous.items():
            if handler is not None:
                signal.signal(sig, handler)


def _run_worker(data: Path, once: bool) -> None:
    ctx = make_context(data)
    try:
        reg = HandlerRegistry()
        load_handlers(reg)
        worker_id = default_worker_id()
        scheduler = _scheduler(ctx, reg)
        if once:
            run_cycle(ctx, reg, worker_id, scheduler)
            return
        stop = threading.Event()
        with _stop_on_signals(stop):
            run_worker(
                ctx,
                reg,
                worker_id=worker_id,
                stop=stop,
                poll_s=ctx.settings.jobs.poll_s,
                scheduler=scheduler,
            )
    finally:
        ctx.store.close()


def _check(data: Path) -> None:
    ctx = make_context(data)
    try:
        fresh = _heartbeat_fresh(ctx)
    finally:
        ctx.store.close()
    if not fresh:
        raise typer.Exit(1)


def _enqueue(data: Path, kind: str, payload: str) -> None:
    if kind not in get_args(JobKind):
        raise FrancesError(f"kind desconocido: {kind}")
    try:
        body: Any = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise FrancesError("--payload no es JSON válido") from exc
    if not isinstance(body, dict):
        raise FrancesError("--payload debe ser un objeto JSON")
    ctx = make_context(data)
    try:
        job_id = enqueue(ctx.store.conn, cast(JobKind, kind), body, now=ctx.now())
    finally:
        ctx.store.close()
    typer.echo(str(job_id))


def _list(data: Path, state: str | None, limit: int) -> None:
    if state is not None and state not in get_args(JobState):
        raise FrancesError(f"estado desconocido: {state}")
    ctx = make_context(data)
    try:
        jobs = list_jobs(ctx.store.conn, state=cast(JobState, state), limit=limit)
    finally:
        ctx.store.close()
    for job in jobs:
        typer.echo(
            "\t".join(
                [
                    str(job.id),
                    job.kind,
                    job.state,
                    f"{job.attempts}/{job.max_attempts}",
                    job.run_after,
                    job.last_error or "-",
                ]
            )
        )


def _retry(data: Path, job_id: int) -> None:
    ctx = make_context(data)
    try:
        job = retry(ctx.store.conn, job_id, ctx.now())
    except ValueError as exc:
        raise FrancesError(str(exc)) from exc
    finally:
        ctx.store.close()
    typer.echo(f"{job.id}\t{job.state}")


def register(app: typer.Typer) -> None:
    """Registra `frances worker` y el grupo `frances jobs` (R-05: cada comando lleva `--data`)."""

    @app.command("worker")
    def worker_cmd(
        data: DataFlag = None,
        once: OnceFlag = False,
        check: CheckFlag = False,
    ) -> None:
        """Corre el worker de la cola (o su chequeo de salud)."""
        root = _data_dir(data)
        if check:
            _check(root)
            return
        exit_with(lambda: _run_worker(root, once))

    jobs_app = typer.Typer(help="Cola de trabajos.")

    @jobs_app.command("enqueue")
    def enqueue_cmd(
        kind: str,
        payload: PayloadOpt = "{}",
        data: DataFlag = None,
    ) -> None:
        """Encola un trabajo y muestra su id."""
        exit_with(lambda: _enqueue(_data_dir(data), kind, payload))

    @jobs_app.command("list")
    def list_cmd(
        state: StateOpt = None,
        limit: LimitOpt = 50,
        data: DataFlag = None,
    ) -> None:
        """Lista trabajos recientes: id, kind, estado, intentos, run_after y último error."""
        exit_with(lambda: _list(_data_dir(data), state, limit))

    @jobs_app.command("retry")
    def retry_cmd(
        job_id: int,
        data: DataFlag = None,
    ) -> None:
        """Reintenta un trabajo `failed` desde cero (attempts = 0)."""
        exit_with(lambda: _retry(_data_dir(data), job_id))

    app.add_typer(jobs_app, name="jobs")
