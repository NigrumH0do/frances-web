"""``GET /api/health``: estado de la base y del worker. Pública (PUBLIC_ROUTES)."""

import sqlite3
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends

from frances import __version__
from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_ctx
from frances.db.store import Store
from frances.errors import ConfigError
from frances.models.jobs import Health
from frances.timeutil import parse_ts

router = APIRouter(prefix="/api")

WORKER_STALE_AFTER = timedelta(minutes=10)


def _is_locked(exc: sqlite3.DatabaseError) -> bool:
    return "locked" in str(exc)


def _q_ping(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT 1").fetchone()
    except sqlite3.DatabaseError as exc:
        if _is_locked(exc):
            raise
        return False
    return True


def _q_schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return int(row[0]) if row is not None and row[0] is not None else 0


def _q_worker_seen_at(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(seen_at) FROM worker_heartbeat").fetchone()
    return str(row[0]) if row is not None and row[0] is not None else None


def _worker_stale(seen_at: str | None, now: datetime) -> bool:
    if seen_at is None:
        return True
    return now - parse_ts(seen_at) > WORKER_STALE_AFTER


def _degraded_without_db() -> Health:
    return Health(
        status="degraded",
        version=__version__,
        schema_version=0,
        db_ok=False,
        worker_seen_at=None,
    )


@router.get("/health", response_model=Health)
def health(ctx: Annotated[ApiContext, Depends(get_ctx)]) -> Health:
    # Se abre aquí y no con ``get_conn``: una base dañada puede fallar ya al abrirla, y ese
    # caso también debe responder 200 con ``db_ok`` false (los "locked" siguen → 503 busy).
    try:
        store = Store.connect(ctx.db_path)
    except ConfigError as exc:
        raise ApiErrorResponse(503, "busy", "La base de datos no está lista.") from exc
    except sqlite3.DatabaseError as exc:
        if _is_locked(exc):
            raise
        return _degraded_without_db()
    try:
        return _report(ctx, store.conn)
    finally:
        store.close()


def _report(ctx: ApiContext, conn: sqlite3.Connection) -> Health:
    db_ok = _q_ping(conn)
    if not db_ok:
        # La conexión ya falló: no se lanzan más consultas sobre ella.
        return _degraded_without_db()
    schema_version = _q_schema_version(conn)
    worker_seen_at = _q_worker_seen_at(conn)
    degraded = _worker_stale(worker_seen_at, ctx.now())
    return Health(
        status="degraded" if degraded else "ok",
        version=__version__,
        schema_version=schema_version,
        db_ok=db_ok,
        worker_seen_at=worker_seen_at,
    )
