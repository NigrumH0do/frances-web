"""Respaldo diario y restauración de `state.db`, `blobs/` y la configuración (SRV-12, R-44).

- `state.db` se copia con la API de backup en línea de SQLite, nunca como archivo: con WAL
  un copia de archivo puede quedar inconsistente. La copia se verifica con
  `PRAGMA integrity_check` antes de subirla.
- `blobs/` es incremental: se sube lo que no está ya en el bucket (nombre = sha256).
- `audio/` y `extractions/` no se respaldan: se regeneran.
- Retención en días de Bogotá: se conservan hoy y los `retention_days - 1` anteriores.
  Nunca se borra la copia más nueva, aunque sea antigua.
"""

import gzip
import re
import shutil
import sqlite3
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from frances.backup.store import BackupStore
from frances.config import resolve_state_db
from frances.db.usage import record_run
from frances.errors import ConfigError
from frances.log import redact
from frances.paths import DataPaths
from frances.stage import StageContext, StageReport
from frances.timeutil import format_ts, to_bogota

BACKUP_STAGE = "backup"
_STAMP = "%Y%m%dT%H%M%SZ"
_DB_NAME = re.compile(r"state-(\d{8}T\d{6}Z)\.db\.gz")
_CONFIG_FILES = ("frances.toml", "voices.yaml")


def _integrity(conn: sqlite3.Connection) -> str:
    row = conn.execute("PRAGMA integrity_check").fetchone()
    return str(row[0]) if row is not None else "sin resultado"


def snapshot_db(db_path: Path, dest: Path) -> int:
    """Copia `db_path` a `dest` con la API de backup y verifica la copia; devuelve sus bytes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.unlink(missing_ok=True)
    source = sqlite3.connect(str(db_path))
    try:
        target = sqlite3.connect(str(dest))
        try:
            source.backup(target)
            verdict = _integrity(target)
        finally:
            target.close()
    finally:
        source.close()
    if verdict != "ok":
        raise RuntimeError("la copia de state.db no pasa PRAGMA integrity_check")
    return dest.stat().st_size


def _db_key(prefix: str, moment: datetime) -> str:
    return f"{prefix}db/state-{moment.astimezone(UTC).strftime(_STAMP)}.db.gz"


def _parse_db_key(key: str, prefix: str) -> datetime | None:
    """Fecha UTC de una copia `{prefix}db/state-…db.gz`; otra clave → `None`."""
    head = f"{prefix}db/"
    if not key.startswith(head) or "/" in key[len(head) :]:
        return None
    match = _DB_NAME.fullmatch(key[len(head) :])
    if match is None:
        return None
    return datetime.strptime(match.group(1), _STAMP).replace(tzinfo=UTC)


def _copies(keys: Iterable[str], prefix: str) -> list[tuple[datetime, str]]:
    found: list[tuple[datetime, str]] = []
    for key in keys:
        moment = _parse_db_key(key, prefix)
        if moment is not None:
            found.append((moment, key))
    found.sort()
    return found


def _gzip(src: Path, dest: Path) -> None:
    with src.open("rb") as reader, gzip.open(dest, "wb", compresslevel=6) as writer:
        shutil.copyfileobj(reader, writer)


def _gunzip(src: Path, dest: Path) -> None:
    with gzip.open(src, "rb") as reader, dest.open("wb") as writer:
        shutil.copyfileobj(reader, writer)


def _local_blobs(paths: DataPaths) -> list[Path]:
    return sorted(p for p in (paths.root / "blobs").glob("*/*") if p.is_file())


def prune(store: BackupStore, prefix: str, now: datetime, retention_days: int) -> int:
    """Borra copias `db/` fuera de la ventana de `retention_days` días de Bogotá.

    La copia más nueva nunca se borra. Devuelve cuántas se borraron.
    """
    if retention_days < 1:
        raise ValueError("retention_days debe ser ≥ 1")
    copies = _copies(store.list(f"{prefix}db/").keys(), prefix)
    if not copies:
        return 0
    newest_key = copies[-1][1]
    oldest_kept = to_bogota(now).date() - timedelta(days=retention_days - 1)
    deleted = 0
    for moment, key in copies:
        if key == newest_key:
            continue
        if to_bogota(moment).date() < oldest_kept:
            store.delete(key)
            deleted += 1
    return deleted


def _add_error(report: StageReport, where: str, exc: Exception) -> None:
    report.errors.append(redact(f"{where}: {exc}"))
    if report.status == "ok":
        report.status = "partial"


def _upload_blobs(ctx: StageContext, store: BackupStore, prefix: str, report: StageReport) -> None:
    try:
        remote = store.list(f"{prefix}blobs/")
    except Exception as exc:
        _add_error(report, "listado de blobs", exc)
        return
    uploaded = 0
    skipped = 0
    for blob in _local_blobs(ctx.paths):
        key = f"{prefix}blobs/{blob.parent.name}/{blob.name}"
        if key in remote:
            skipped += 1
            continue
        try:
            store.put_file(key, blob)
        except Exception as exc:
            _add_error(report, f"blob {blob.name}", exc)
            continue
        uploaded += 1
    report.counts["blobs_uploaded"] = uploaded
    report.counts["blobs_skipped"] = skipped


def _upload_config(ctx: StageContext, store: BackupStore, prefix: str, report: StageReport) -> None:
    sources = {"frances.toml": ctx.paths.config, "voices.yaml": ctx.paths.voices_yaml}
    for name in _CONFIG_FILES:
        path = sources[name]
        if not path.is_file():
            continue
        try:
            store.put_file(f"{prefix}config/{name}", path)
        except Exception as exc:
            _add_error(report, f"config {name}", exc)


def _backup_into(
    ctx: StageContext, store: BackupStore, now: datetime, report: StageReport, work: Path
) -> None:
    prefix = ctx.settings.backup.prefix
    raw = work / "state.db"
    gz = work / "state.db.gz"
    try:
        report.counts["db_bytes"] = snapshot_db(resolve_state_db(ctx.paths, ctx.env), raw)
        _gzip(raw, gz)
        store.put_file(_db_key(prefix, now), gz)
    except Exception as exc:
        # Sin copia de la base no se suben blobs ni configuración: el reporte queda `failed`.
        report.status = "failed"
        report.errors.append(redact(f"state.db: {exc}", ctx.env))
        return
    _upload_blobs(ctx, store, prefix, report)
    _upload_config(ctx, store, prefix, report)
    try:
        report.counts["snapshots_deleted"] = prune(
            store, prefix, now, ctx.settings.backup.retention_days
        )
    except Exception as exc:
        _add_error(report, "retención", exc)


def run_backup(ctx: StageContext, store: BackupStore, now: datetime) -> StageReport:
    """Hace una copia completa y la registra en `runs` (stage `backup`)."""
    started = format_ts(now)
    report = StageReport(stage=BACKUP_STAGE, status="ok")
    work = ctx.paths.cache / "backup"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    try:
        _backup_into(ctx, store, now, report, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        with ctx.store.tx() as conn:
            record_run(conn, report, started, format_ts(ctx.now()))
    return report


def restore(
    store: BackupStore,
    prefix: str,
    paths: DataPaths,
    state_db: Path,
    *,
    key: str | None = None,
    force: bool = False,
) -> str:
    """Restaura la copia más nueva (o `key`) en `state_db` y baja los blobs que falten.

    Si `state_db` existe y no hay `force`, no escribe nada y lanza `ConfigError`.
    Devuelve la clave restaurada.
    """
    if state_db.exists() and not force:
        raise ConfigError(f"ya existe {state_db}; usa --force para reemplazarla")
    copies = _copies(store.list(f"{prefix}db/").keys(), prefix)
    if key is None:
        if not copies:
            raise ConfigError("no hay copias en el bucket")
        chosen = copies[-1][1]
    else:
        if _parse_db_key(key, prefix) is None:
            raise ConfigError("la clave no es una copia de state.db")
        chosen = key
    paths.ensure_dirs()
    work = paths.cache / "restore"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    try:
        gz = work / "state.db.gz"
        store.get_file(chosen, gz)
        raw = work / "state.db"
        _gunzip(gz, raw)
        check = sqlite3.connect(str(raw))
        try:
            verdict = _integrity(check)
        finally:
            check.close()
        if verdict != "ok":
            raise ConfigError("la copia descargada no pasa PRAGMA integrity_check")
        state_db.parent.mkdir(parents=True, exist_ok=True)
        if force:
            for suffix in ("-wal", "-shm"):
                Path(f"{state_db}{suffix}").unlink(missing_ok=True)
        shutil.move(str(raw), str(state_db))
        for blob_key in store.list(f"{prefix}blobs/"):
            dest = paths.blob_path(blob_key.rsplit("/", 1)[-1])
            if not dest.exists():
                store.get_file(blob_key, dest)
        remote_config = store.list(f"{prefix}config/")
        targets = {"frances.toml": paths.config, "voices.yaml": paths.voices_yaml}
        for name in _CONFIG_FILES:
            dest = targets[name]
            if f"{prefix}config/{name}" in remote_config and (force or not dest.exists()):
                store.get_file(f"{prefix}config/{name}", dest)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return chosen
