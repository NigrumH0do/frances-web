"""Migración 0005: columnas Google OIDC/estado de cuenta y tabla ``oauth_states``."""

import sqlite3
from pathlib import Path

import pytest

from frances.db.store import LATEST_SCHEMA, Store


def test_0005_columns_and_oauth_states(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        cols = {row[1] for row in store.conn.execute("PRAGMA table_info(users)")}
        assert {"status", "auth_provider", "google_sub", "avatar_url"} <= cols
        names = {
            row[0]
            for row in store.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "oauth_states" in names
        assert LATEST_SCHEMA >= 5
        assert store.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] >= 5
    finally:
        store.close()


def test_0005_google_sub_is_unique_when_present(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        ins = (
            "INSERT INTO users (id, email, display_name, password_hash, role,"
            " created_at, google_sub) VALUES (?, ?, 'U', '!oauth-only', 'user', 't', ?)"
        )
        store.conn.execute(ins, ("u_1", "a@example.test", "sub-1"))
        store.conn.execute(ins, ("u_2", "b@example.test", None))
        store.conn.execute(ins, ("u_3", "c@example.test", None))
        with pytest.raises(sqlite3.IntegrityError):
            store.conn.execute(ins, ("u_4", "d@example.test", "sub-1"))
    finally:
        store.close()
