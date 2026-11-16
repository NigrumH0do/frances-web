"""Búsqueda BM25 sobre FTS5: tokens, escape de sintaxis y ranking (AI-05)."""

import re
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

import frances.study.search as search

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver tests/cards.
from frances.db import store as _store  # noqa: F401
from frances.stage import StageContext, make_context
from frances.study.index import run_index
from frances.study.search import fts_query, query_tokens, search_blocks

_NOW = "2026-11-02T10:00:00Z"
_DENSE_BLOCK = "Le passé composé se forme avec avoir ou être. Passé composé : j'ai mangé."


@dataclass
class Indexed:
    """Base sintética ya indexada por AI-04, con ayudas para los tests."""

    ctx: StageContext

    @property
    def conn(self) -> sqlite3.Connection:
        return self.ctx.store.conn

    def block(self, text: str) -> int:
        row = self.conn.execute("SELECT id FROM text_blocks WHERE text = ?", (text,)).fetchone()
        assert row is not None, text
        return int(row[0])

    def delete_item(self, item_id: str) -> None:
        self.conn.execute("UPDATE items SET deleted_at = ? WHERE id = ?", (_NOW, item_id))


def _item(conn: sqlite3.Connection, item_id: str, title: str, text: str) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, title, text, _NOW, _NOW, f"{item_id}-h", _NOW, _NOW),
    )


@pytest.fixture
def indexed(tmp_path: Path) -> Iterator[Indexed]:
    context = make_context(tmp_path, {})
    try:
        conn = context.store.conn
        conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_NOW,),
        )
        _item(
            conn,
            "cw_1",
            "Leçon 1",
            "Bonjour Paul.\n\nJe vais à l'école.\n\n" + _DENSE_BLOCK,
        )
        _item(
            conn,
            "cw_2",
            "Leçon 2",
            "La maison est grande.\n\nLa maison est belle.\n\nLa maison est loin."
            "\n\nLa maison est chaude.\n\nLa maison est neuve.",
        )
        _item(conn, "cw_3", "Leçon 3", "Le passé est un temps.")
        run_index(context)
        yield Indexed(context)
    finally:
        context.store.close()


def test_search_ignores_accents_case_and_stopwords(indexed: Indexed) -> None:
    hits = search_blocks(indexed.conn, "¿Qué significa LA ÉCOLE?")
    assert hits and all("cole" in hit.snippet.lower() for hit in hits[:1])
    assert query_tokens("le la de que") == []


def test_bm25_ranks_denser_block_first(indexed: Indexed) -> None:
    hits = search_blocks(indexed.conn, "passé composé")
    assert hits[0].block_id == indexed.block(_DENSE_BLOCK)


def test_accent_insensitive_query_finds_accented_text(indexed: Indexed) -> None:
    hits = search_blocks(indexed.conn, "ecole")
    assert hits
    assert any("école" in hit.snippet for hit in hits)


def test_fts_syntax_is_neutralized(indexed: Indexed) -> None:
    for q in ['"', "*", "NEAR(a b)", "col:école", "-école", "AND", "(", ")", 'école" OR *']:
        search_blocks(indexed.conn, q)  # no lanza sqlite3.OperationalError


def test_fts_query_quotes_every_word_token() -> None:
    for q in ['"', "*", "NEAR(a b)", "col:école", "-école", "AND", "(", ")", 'école" OR *']:
        tokens = query_tokens(q)
        assert all(re.fullmatch(r"\w+", token) for token in tokens)
        built = fts_query(q)
        if built is not None:
            assert built == " OR ".join(f'"{token}"' for token in tokens)
            assert all(re.fullmatch(r'"[^"]+"', piece) for piece in built.split(" OR "))


def test_fts_query_doubles_quotes_inside_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search, "query_tokens", lambda _q: ['ab"cd'])
    assert search.fts_query("x") == '"ab""cd"'


def test_deleted_items_never_match(indexed: Indexed) -> None:
    assert search_blocks(indexed.conn, "maison")
    indexed.delete_item("cw_2")
    assert all(hit.item_id != "cw_2" for hit in search_blocks(indexed.conn, "maison"))


def test_query_tokens_dedupes_limits_and_accepts_numbers() -> None:
    assert query_tokens("chat chat CHAT") == ["chat"]
    assert query_tokens("a1 ab abc") == ["a1", "abc"]
    tokens = query_tokens(" ".join(f"mot{i}" for i in range(20)))
    assert len(tokens) == 12


def test_search_blocks_limits_results_and_filters_items(indexed: Indexed) -> None:
    assert len(search_blocks(indexed.conn, "maison", limit=2)) == 2
    assert search_blocks(indexed.conn, "maison", item_ids=[]) == []
    only = search_blocks(indexed.conn, "passé", item_ids=["cw_3"])
    assert only and all(hit.item_id == "cw_3" for hit in only)
    assert search_blocks(indexed.conn, "maison", item_ids=["cw_3"]) == []
