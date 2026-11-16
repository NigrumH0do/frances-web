"""Migración 0003: text_blocks + FTS5, llm_cache y usage_daily (CHG-03)."""

import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest

from frances.db.store import Store
from frances.db.usage import bogota_day, usage_daily_add, usage_daily_get


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    s = Store.open(tmp_path / "s.db")
    yield s
    s.close()


@pytest.fixture
def store_with_item(store: Store) -> Store:
    store.conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', 't', '{}')"
    )
    store.conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES ('cw_1', 'c_1', 'material', 'a-1', 'Leçon', '', 'PUBLISHED',"
        " 't', 't', 'h', '{}', 't', 't')"
    )
    return store


def test_fts_ignores_diacritics_and_case(store_with_item: Store) -> None:
    c = store_with_item.conn
    c.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at)"
        " VALUES ('cw_1', 'item', NULL, 0, 'fr', 'Je vais à l''École le matin', 'v1', 't')"
    )
    hits = c.execute(
        "SELECT rowid FROM text_blocks_fts WHERE text_blocks_fts MATCH 'ecole'"
    ).fetchall()
    assert len(hits) == 1
    c.execute("UPDATE text_blocks SET text = 'la maison' WHERE item_id = 'cw_1'")
    gone = c.execute(
        "SELECT COUNT(*) FROM text_blocks_fts WHERE text_blocks_fts MATCH 'ecole'"
    ).fetchone()[0]
    assert gone == 0
    assert (
        c.execute(
            "SELECT COUNT(*) FROM text_blocks_fts WHERE text_blocks_fts MATCH 'maison'"
        ).fetchone()[0]
        == 1
    )
    c.execute("DELETE FROM text_blocks")
    assert (
        c.execute(
            "SELECT COUNT(*) FROM text_blocks_fts WHERE text_blocks_fts MATCH 'maison'"
        ).fetchone()[0]
        == 0
    )


def test_fts_tokenizer_options(store: Store) -> None:
    row = store.conn.execute(
        "SELECT sql FROM sqlite_master WHERE name='text_blocks_fts'"
    ).fetchone()
    sql = str(row[0])
    assert "unicode61 remove_diacritics 2" in sql


def test_usage_daily_by_bogota_day(store: Store) -> None:
    # 2026-11-03 03:00 UTC es 2026-11-02 22:00 en Bogotá (UTC-5, sin horario de verano).
    assert bogota_day(datetime(2026, 11, 3, 3, 0, tzinfo=UTC)) == "2026-11-02"
    assert usage_daily_add(store.conn, "2026-11-02", "llm_calls", 2) == 2
    assert usage_daily_add(store.conn, "2026-11-02", "llm_calls", 1) == 3
    assert usage_daily_get(store.conn, "2026-11-03", "llm_calls") == 0


def test_llm_cache_and_usage_tables_exist(store: Store) -> None:
    names = {r[0] for r in store.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"text_blocks", "text_blocks_fts", "llm_cache", "usage_daily"} <= names
    with pytest.raises(sqlite3.IntegrityError):
        store.conn.execute(
            "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
            " extractor_version, created_at) VALUES ('nope', 'item', NULL, 0, 'fr', 'x', 'v1', 't')"
        )
