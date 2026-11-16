"""Fixtures compartidas de cuentas: base migrada en tmp_path y usuarios de prueba."""

import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from typer.testing import CliRunner

from frances.accounts.repo import create_user
from frances.db.store import Store

NOW = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "state.db"


@pytest.fixture
def conn(db_path: Path) -> Iterator[sqlite3.Connection]:
    store = Store.open(db_path)
    yield store.conn
    store.close()


@pytest.fixture
def admin_id(conn: sqlite3.Connection) -> str:
    return create_user(conn, "admin@ex.org", "Admin", "clave muy larga 0", "admin", NOW).id


@pytest.fixture
def user_id(conn: sqlite3.Connection, admin_id: str) -> str:
    return create_user(
        conn, "user@ex.org", "Usuaria", "clave muy larga 9", "user", NOW, invited_by=admin_id
    ).id


@pytest.fixture
def cli_runner() -> CliRunner:
    return CliRunner()
