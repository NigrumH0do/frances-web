"""Tests del Store v2: WAL, busy_timeout, connect sin migrar, triggers y dump sin FTS."""

import gc
import sqlite3
import warnings
from pathlib import Path

import pytest

from frances.db.dump import dump_sql, restore_sql
from frances.db.store import LATEST_SCHEMA, Store, _split_statements
from frances.errors import ConfigError
from frances.stage import make_context
from tests.testkit.demo import blob_sources, demo_sql


@pytest.fixture
def demo_state_sql() -> str:
    """`tests/fixtures/demo_state.sql` con sus marcadores `{{…}}` resueltos (R-20)."""
    return demo_sql(blob_sources())


def test_open_sets_wal_and_busy_timeout(tmp_path: Path) -> None:
    s = Store.open(tmp_path / "s.db")
    assert s.conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert s.conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    assert s.conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    s.close()


def test_migration_with_trigger_body_applies() -> None:  # REVIEW FOCUS 8 (plan maestro v2)
    sql = (
        "CREATE TABLE a (x TEXT);\nCREATE TABLE b (x TEXT);\n"
        "CREATE TRIGGER a_ai AFTER INSERT ON a BEGIN\n  INSERT INTO b VALUES (new.x);\nEND;\n"
        "INSERT INTO a VALUES ('uno; dos');\n"
    )
    statements = _split_statements(sql)
    assert len(statements) == 4
    conn = sqlite3.connect(":memory:")
    for statement in statements:
        conn.execute(statement)
    assert conn.execute("SELECT x FROM b").fetchall() == [("uno; dos",)]
    conn.close()


def test_connect_does_not_migrate_and_rejects_old_schema(tmp_path: Path) -> None:
    # Base sin migrar (versión 0 < LATEST_SCHEMA): con solo 0001 empaquetada no hay
    # una versión intermedia válida, así que la base "vieja" es un archivo vacío.
    db = tmp_path / "s.db"
    sqlite3.connect(db).close()
    with pytest.raises(ConfigError, match="schema"):
        Store.connect(db)
    raw = sqlite3.connect(db)
    assert raw.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0] == 0  # no migró
    raw.close()
    Store.open(db).close()
    # Base migrada pero con una versión menor que LATEST_SCHEMA: connect debe rechazarla.
    old = sqlite3.connect(db)
    old.execute("UPDATE schema_version SET version = version - 1")
    old.commit()
    old.close()
    with pytest.raises(ConfigError, match="schema"):
        Store.connect(db)
    restored = sqlite3.connect(db)
    restored.execute("UPDATE schema_version SET version = version + 1")  # deshace la bajada
    restored.commit()
    restored.close()
    s = Store.connect(db)
    assert s.conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] == LATEST_SCHEMA
    assert s.conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert s.conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    s.close()


def test_connect_corrupt_file_does_not_leak(tmp_path: Path) -> None:
    db = tmp_path / "s.db"
    db.write_bytes(b"basura-srv02" * 410 + b"x" * 80)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ResourceWarning)
        with pytest.raises(sqlite3.DatabaseError):
            Store.connect(db)
        gc.collect()
    assert [w for w in caught if issubclass(w.category, ResourceWarning)] == []


def test_connect_outdated_schema_still_closes(tmp_path: Path) -> None:
    db = tmp_path / "s.db"
    Store.open(db).close()
    raw = sqlite3.connect(db)
    raw.execute("UPDATE schema_version SET version = version - 1")
    raw.commit()
    raw.close()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ResourceWarning)
        with pytest.raises(ConfigError, match="schema"):
            Store.connect(db)
        gc.collect()
    assert [w for w in caught if issubclass(w.category, ResourceWarning)] == []


def test_make_context_honors_frances_state_db(tmp_path: Path) -> None:
    ctx = make_context(tmp_path / "data", env={"FRANCES_STATE_DB": str(tmp_path / "state.db")})
    ctx.store.close()
    assert (tmp_path / "state.db").exists()
    assert not (tmp_path / "data" / ".cache" / "state.db").exists()


# La base de estos tests sale de la migración real (`0003_search_llm.sql`, aplicada
# por `Store.open`), no de una copia del DDL. Un bloque de texto de `cw_1` basta para
# que el FTS tenga filas que dump y restore deben conservar.
def _fts_store(path: Path) -> Store:
    """Store migrado con un curso, un ítem `cw_1` y dos bloques de texto."""
    s = Store.open(path)
    s.conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', 't', '{}')"
    )
    s.conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES ('cw_1', 'c_1', 'material', 'a-1', 'Leçon', '', 'PUBLISHED',"
        " 't', 't', 'h', '{}', 't', 't')"
    )
    s.conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at)"
        " VALUES ('cw_1', 'pdf', 1, 1, 'fr', 'une école à Paris', 'v1', '2026-11-02T00:00:00Z')"
    )
    s.conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at)"
        " VALUES ('cw_1', 'pdf', 1, 2, 'es', 'texto sin acento', 'v1', '2026-11-02T00:00:00Z')"
    )
    return s


def test_dump_keeps_fts_ddl_and_drops_its_rows_and_shadows(tmp_path: Path) -> None:
    s = _fts_store(tmp_path / "src.db")
    text = dump_sql(s)
    s.close()
    assert "CREATE VIRTUAL TABLE text_blocks_fts" in text
    for shadow in ("_data", "_idx", "_content", "_docsize", "_config"):
        assert f"text_blocks_fts{shadow}" not in text
    assert not any(line.startswith("INSERT INTO text_blocks_fts ") for line in text.splitlines())
    assert "CREATE TRIGGER text_blocks_ai" in text
    assert "CREATE TRIGGER text_blocks_ad" in text
    assert "CREATE TRIGGER text_blocks_au" in text
    assert "CREATE INDEX text_blocks_item" in text


def test_fts_roundtrip_dump_restore_finds_accents_and_new_rows(tmp_path: Path) -> None:
    s = _fts_store(tmp_path / "src.db")
    text = dump_sql(s)
    s.close()
    r = restore_sql(text, tmp_path / "r.db")
    try:
        found = r.conn.execute(
            "SELECT rowid FROM text_blocks_fts WHERE text_blocks_fts MATCH 'ecole'"
        ).fetchall()
        assert found == [(1,)]
        # un INSERT posterior al restore tiene que indexarse: prueba que los triggers sobrevivieron
        r.conn.execute(
            "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
            " extractor_version, created_at)"
            " VALUES ('cw_1', 'pdf', 1, 3, 'es', 'nuevo fragmento indexable', 'v1',"
            " '2026-11-02T00:00:00Z')"
        )
        new = r.conn.execute(
            "SELECT rowid FROM text_blocks_fts WHERE text_blocks_fts MATCH 'indexable'"
        ).fetchall()
        assert new == [(3,)]
    finally:
        r.close()


def test_split_rejects_incomplete_trailing_statement() -> None:
    with pytest.raises(ValueError, match="incompleta"):
        _split_statements("INSERT INTO a VALUES ('oops);")


def test_v1_dump_roundtrip_unchanged(tmp_path: Path, demo_state_sql: str) -> None:  # R-20
    s = restore_sql(demo_state_sql, tmp_path / "r.db")
    first = dump_sql(s)
    r2 = restore_sql(first, tmp_path / "r2.db")
    assert r2.conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] > 0
    assert dump_sql(r2) == first
    s.close()
    r2.close()
