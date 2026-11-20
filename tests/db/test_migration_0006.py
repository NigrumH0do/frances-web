"""Migración 0006: tablas ``azure_accounts`` y ``azure_usage_monthly``."""

import sqlite3
from pathlib import Path

import pytest

from frances.db.store import LATEST_SCHEMA, Store


def test_0006_tables_and_constraints(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        names = {
            row[0]
            for row in store.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {"azure_accounts", "azure_usage_monthly"} <= names
        assert LATEST_SCHEMA >= 6
        assert store.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] >= 6

        with pytest.raises(sqlite3.IntegrityError):
            store.conn.execute(
                "INSERT INTO azure_accounts (id, label, kind, region, key_ciphertext, key_hint,"
                " created_at, updated_at) VALUES ('a1', 'bad', 'other', 'eastus', 'c', 'h',"
                " 't', 't')"
            )
    finally:
        store.close()
