"""CLI `frances backup run|list|restore|loop` (SRV-12).

`loop` duerme hasta la hora de `[backup] at` en Bogotá, respalda y vuelve a dormir. Sin
configuración de Object Storage registra un `runs` `failed` con `not_configured` y sigue.
La salida nunca imprime valores de configuración ni claves.
"""

import contextlib
import signal
import threading
from collections.abc import Iterator
from datetime import time
from pathlib import Path
from types import FrameType
from typing import Annotated
from zoneinfo import ZoneInfo

import typer

from frances.backup.run import restore, run_backup
from frances.backup.store import BackupStore, S3BackupStore
from frances.cli import exit_with
from frances.config import Settings, load_settings, process_env, resolve_data_dir, resolve_state_db
from frances.db.usage import record_run
from frances.errors import ConfigError
from frances.jobs.scheduler import Schedule, next_fire
from frances.log import get_logger, redact
from frances.paths import DataPaths
from frances.stage import StageContext, StageReport, make_context
from frances.timeutil import format_ts

_DATA_HELP = "Raíz del repo de datos (por defecto FRANCES_DATA_DIR o el directorio actual)"
DataFlag = Annotated[Path | None, typer.Option("--data", help=_DATA_HELP)]
KeyOpt = Annotated[str | None, typer.Option("--key", help="Clave de una copia db/ concreta.")]
ForceFlag = Annotated[bool, typer.Option("--force", help="Reemplaza state.db si ya existe.")]

_logger = get_logger("frances.backup")


def _data_dir(data: Path | None) -> Path:
    return resolve_data_dir(process_env(), Path(".")) if data is None else data


def _store_for(settings: Settings) -> BackupStore:
    """Cliente S3 con la configuración de `frances.config`; falta una variable → `ConfigError`."""
    return S3BackupStore.from_settings(settings)


@contextlib.contextmanager
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


def _backup_once(ctx: StageContext) -> None:
    """Un respaldo del bucle. Sin configuración queda registrado y el bucle sigue."""
    started = format_ts(ctx.now())
    try:
        store = _store_for(ctx.settings)
    except ConfigError as exc:
        report = StageReport(
            stage="backup",
            status="failed",
            counts={"not_configured": 1},
            errors=[redact(str(exc), ctx.env)],
        )
        with ctx.store.tx() as conn:
            record_run(conn, report, started, format_ts(ctx.now()))
        _logger.warning("respaldo sin configuración: %s", report.errors[0])
        return
    try:
        report = run_backup(ctx, store, ctx.now())
    except Exception as exc:
        _logger.error("respaldo fallido: %s", redact(str(exc), ctx.env))
        return
    _logger.info("respaldo %s %s", report.status, report.counts)


def run_loop(ctx: StageContext, stop: threading.Event) -> None:
    """Respalda a la hora de `[backup] at` (Bogotá) hasta que `stop` se active."""
    tz = ZoneInfo(ctx.settings.scheduler.timezone)
    schedule = Schedule(
        "backup", "pipeline.daily", time.fromisoformat(ctx.settings.backup.at), None
    )  # `next_fire` solo usa la hora; el `kind` no se encola.
    while True:
        now = ctx.now()
        fire = next_fire(schedule, now, tz)
        if stop.wait((fire - now).total_seconds()):
            return
        _backup_once(ctx)


def _run(data: Path) -> StageReport:
    ctx = make_context(data)
    try:
        return run_backup(ctx, _store_for(ctx.settings), ctx.now())
    finally:
        ctx.store.close()


def _list(data: Path) -> None:
    paths = DataPaths(data)
    settings = load_settings(paths.config, process_env())
    store = _store_for(settings)
    for key, size in sorted(store.list(f"{settings.backup.prefix}db/").items()):
        typer.echo(f"{key}\t{size}")


def _restore(data: Path, key: str | None, force: bool) -> None:
    env = process_env()
    paths = DataPaths(data)
    settings = load_settings(paths.config, env)
    store = _store_for(settings)
    chosen = restore(
        store,
        settings.backup.prefix,
        paths,
        resolve_state_db(paths, env),
        key=key,
        force=force,
    )
    typer.echo(f"restaurado {chosen}")


def _loop(data: Path) -> None:
    ctx = make_context(data)
    stop = threading.Event()
    try:
        with _stop_on_signals(stop):
            run_loop(ctx, stop)
    finally:
        ctx.store.close()


def register(app: typer.Typer) -> None:
    """Registra el grupo `frances backup` (R-05: cada comando lleva `--data`)."""
    backup_app = typer.Typer(help="Respaldo de state.db y blobs a Object Storage.")

    @backup_app.command("run")
    def run_cmd(data: DataFlag = None) -> None:
        """Hace un respaldo ahora."""
        exit_with(lambda: _run(_data_dir(data)))

    @backup_app.command("list")
    def list_cmd(data: DataFlag = None) -> None:
        """Lista las copias de state.db (clave y tamaño)."""
        exit_with(lambda: _list(_data_dir(data)))

    @backup_app.command("restore")
    def restore_cmd(key: KeyOpt = None, force: ForceFlag = False, data: DataFlag = None) -> None:
        """Restaura la copia más nueva, o la de --key, y baja los blobs que falten."""
        exit_with(lambda: _restore(_data_dir(data), key, force))

    @backup_app.command("loop")
    def loop_cmd(data: DataFlag = None) -> None:
        """Respalda cada día a la hora de backup.at (zona del programador) hasta SIGTERM."""
        exit_with(lambda: _loop(_data_dir(data)))

    app.add_typer(backup_app, name="backup")
