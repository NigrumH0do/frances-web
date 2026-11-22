"""GET /api/health y el mapeo de errores de base de datos."""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from frances import __version__
from frances.api import deps
from frances.api.app import ApiContext, create_app
from frances.api.routes import health as health_mod
from frances.config import Settings
from frances.db.store import LATEST_SCHEMA, Store
from frances.paths import DataPaths
from frances.timeutil import format_ts
from tests.api.conftest import NOW


def _heartbeat(ctx: ApiContext, seen_at: datetime) -> None:
    """Registra un latido del worker cerrando el `Store` (nada de conexiones sueltas)."""
    store = Store.connect(ctx.db_path)
    try:
        with store.tx() as c:
            c.execute("INSERT INTO worker_heartbeat VALUES ('w1', ?, NULL)", (format_ts(seen_at),))
    finally:
        store.close()


def test_health_degraded_without_worker(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    r = client.get("/api/health")
    body = r.json()
    assert r.status_code == 200
    assert body["status"] == "degraded"
    assert body["db_ok"] is True
    assert body["schema_version"] == LATEST_SCHEMA
    assert body["worker_seen_at"] is None
    assert body["version"] == __version__
    assert r.headers["cache-control"] == "no-store"


def test_health_ok_with_recent_heartbeat(api: tuple[TestClient, ApiContext]) -> None:
    client, ctx = api
    _heartbeat(ctx, NOW - timedelta(minutes=2))
    assert client.get("/api/health").json()["status"] == "ok"


def test_health_degraded_with_stale_heartbeat(api: tuple[TestClient, ApiContext]) -> None:
    client, ctx = api
    _heartbeat(ctx, NOW - timedelta(minutes=11))
    body = client.get("/api/health").json()
    assert body["status"] == "degraded"
    assert body["worker_seen_at"] is not None


def test_db_locked_maps_to_503(
    api: tuple[TestClient, ApiContext], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = api

    def locked(conn: sqlite3.Connection) -> int:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(health_mod, "_q_schema_version", locked)
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["code"] == "busy"


def test_outdated_schema_maps_to_503_without_leaking_path(tmp_path: Path) -> None:
    db_path = tmp_path / "vieja.db"
    db_path.touch()
    ctx = ApiContext(
        settings=Settings(),
        paths=DataPaths(tmp_path),
        db_path=db_path,
        env={},
        now=lambda: NOW,
    )
    client = TestClient(create_app(lambda: ctx), base_url="https://testserver")
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["code"] == "busy"
    assert str(tmp_path) not in r.text


def test_get_conn_closes_connection_after_request(
    api: tuple[TestClient, ApiContext], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = api
    opened: list[sqlite3.Connection] = []
    real_connect = Store.connect

    def spy(db_path: Path) -> Store:
        store = real_connect(db_path)
        opened.append(store.conn)
        return store

    monkeypatch.setattr(deps.Store, "connect", staticmethod(spy))
    assert client.get("/api/health").status_code == 200
    assert len(opened) == 1
    with pytest.raises(sqlite3.ProgrammingError):
        opened[0].execute("SELECT 1")


class _BrokenConn:
    """Conexión que falla en cualquier consulta; cuenta cuántas se intentan."""

    def __init__(self) -> None:
        self.calls = 0

    def execute(self, sql: str, *args: object) -> None:
        self.calls += 1
        raise sqlite3.OperationalError("disk I/O error")


def test_db_error_on_ping_returns_200_with_db_ok_false(
    api: tuple[TestClient, ApiContext], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = api
    broken = _BrokenConn()
    fake_store = SimpleNamespace(conn=broken, close=lambda: None)
    monkeypatch.setattr(deps.Store, "connect", staticmethod(lambda _p: fake_store))
    r = client.get("/api/health")
    body = r.json()
    assert r.status_code == 200
    assert body["db_ok"] is False
    assert body["status"] == "degraded"
    assert body["schema_version"] == 0
    assert body["worker_seen_at"] is None
    assert broken.calls == 1, "tras fallar el ping no deben lanzarse más consultas"


def test_corrupt_db_file_answers_200_with_db_ok_false(tmp_path: Path) -> None:
    db_path = tmp_path / "state.db"
    db_path.write_bytes(b"basura-srv02" * 410 + b"x" * 80)  # 5000 bytes, sin cabecera SQLite
    assert db_path.stat().st_size == 5000
    ctx = ApiContext(
        settings=Settings(),
        paths=DataPaths(tmp_path),
        db_path=db_path,
        env={},
        now=lambda: NOW,
    )
    client = TestClient(create_app(lambda: ctx), base_url="https://testserver")
    r = client.get("/api/health")
    body = r.json()
    assert r.status_code == 200
    assert body["db_ok"] is False
    assert body["status"] == "degraded"
    assert body["schema_version"] == 0
    assert body["worker_seen_at"] is None


class _LockedConn:
    """Conexión cuya primera consulta responde 'database is locked'."""

    def execute(self, sql: str, *args: object) -> None:
        raise sqlite3.OperationalError("database is locked")


_SECRET_A = "secreto-srv02-token-AAA"
_SECRET_B = "secreto-srv02-clave-BBB"


def _corrupt_ctx(tmp_path: Path) -> ApiContext:
    db_path = tmp_path / "state.db"
    db_path.write_bytes(b"basura-srv02" * 410 + b"x" * 80)
    return _ctx(tmp_path, db_path)


def _healthy_ctx(tmp_path: Path) -> ApiContext:
    db_path = tmp_path / "state.db"
    Store.open(db_path).close()
    return _ctx(tmp_path, db_path)


def _ctx(tmp_path: Path, db_path: Path) -> ApiContext:
    return ApiContext(
        settings=Settings(),
        paths=DataPaths(tmp_path),
        db_path=db_path,
        env={"FRANCES_TOKEN": _SECRET_A, "FRANCES_KEY": _SECRET_B},
        now=lambda: NOW,
    )


@pytest.mark.parametrize("scenario", ["ok", "corrupt_db", "db_ok_false", "busy_locked"])
def test_health_never_exposes_env_values(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    ctx = _corrupt_ctx(tmp_path) if scenario == "corrupt_db" else _healthy_ctx(tmp_path)
    if scenario == "db_ok_false":
        broken = _BrokenConn()
        monkeypatch.setattr(
            deps.Store,
            "connect",
            staticmethod(lambda _p: SimpleNamespace(conn=broken, close=lambda: None)),
        )
    if scenario == "busy_locked":
        locked = _LockedConn()
        monkeypatch.setattr(
            deps.Store,
            "connect",
            staticmethod(lambda _p: SimpleNamespace(conn=locked, close=lambda: None)),
        )
    client = TestClient(create_app(lambda: ctx), base_url="https://testserver")
    r = client.get("/api/health")
    expected = 503 if scenario == "busy_locked" else 200
    assert r.status_code == expected
    if scenario == "ok":
        assert r.json()["db_ok"] is True
    if expected == 200:
        assert r.json()["db_ok"] is (scenario == "ok")
    assert _SECRET_A not in r.text
    assert _SECRET_B not in r.text
    assert "FRANCES_TOKEN" not in r.text
