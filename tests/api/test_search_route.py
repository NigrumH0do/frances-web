"""`GET /api/search`: sesión, límites de consulta y resultados BM25 (AI-05)."""

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.db.store import Store
from tests.testkit.api import BASE_URL, create_user, login, make_api

_NOW = "2026-11-02T10:00:00Z"


def _course(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (_NOW,),
    )


def _item(conn: sqlite3.Connection, item_id: str, title: str, *, deleted: bool = False) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at,"
        " deleted_at) VALUES (?, 'c_1', 'coursework', ?, ?, '', 'PUBLISHED', ?, ?, ?,"
        " '{}', ?, ?, ?)",
        (
            item_id,
            item_id,
            title,
            _NOW,
            _NOW,
            f"{item_id}-h",
            _NOW,
            _NOW,
            _NOW if deleted else None,
        ),
    )


def _block(
    conn: sqlite3.Connection, item_id: str, position: int, text: str, page: int | None = None
) -> None:
    conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at) VALUES (?, 'item', ?, ?, 'fr', ?, 'item-1', ?)",
        (item_id, page, position, text, _NOW),
    )


def _seed(conn: sqlite3.Connection) -> None:
    _course(conn)
    _item(conn, "cw_1", "Leçon 1")
    _block(conn, "cw_1", 0, "Je vais à l'école.")
    _block(conn, "cw_1", 1, "La maison est grande.")
    _item(conn, "cw_2", "Leçon 2")
    _block(conn, "cw_2", 0, "La maison est petite.", page=2)
    _item(conn, "cw_deleted", "Leçon 3", deleted=True)
    _block(conn, "cw_deleted", 0, "Une école secrète.")


@pytest.fixture
def api_with_index(tmp_path: Path) -> Iterator[tuple[TestClient, TestClient]]:
    client, ctx = make_api(tmp_path)
    store = Store.connect(ctx.db_path)
    try:
        _seed(store.conn)
        create_user(store.conn, "ana@ex.org")
    finally:
        store.close()
    login(client, "ana@ex.org")
    anon = TestClient(client.app, base_url=BASE_URL)
    yield client, anon
    anon.close()
    client.close()


@pytest.fixture
def api_with_big_index(tmp_path: Path) -> Iterator[TestClient]:
    client, ctx = make_api(tmp_path)
    store = Store.connect(ctx.db_path)
    try:
        conn = store.conn
        _course(conn)
        with store.tx():
            for i in range(2000):
                _item(conn, f"mt_{i}", f"Leçon {i}")
                _block(
                    conn,
                    f"mt_{i}",
                    0,
                    f"Je vais à l'école numéro {i} et la maison est grande.",
                )
        create_user(conn, "ana@ex.org")
    finally:
        store.close()
    login(client, "ana@ex.org")
    yield client
    client.close()


def test_search_route_requires_session_and_bounds(
    api_with_index: tuple[TestClient, TestClient],
) -> None:
    client, anon = api_with_index
    assert anon.get("/api/search", params={"q": "école"}).status_code == 401

    one = client.get("/api/search", params={"q": "école", "limit": 1})
    assert one.status_code == 200
    body = one.json()
    assert len(body) == 1 and body[0]["page"] in (None, 1, 2)

    too_long = client.get("/api/search", params={"q": "x" * 201})
    assert too_long.status_code == 400 and too_long.json()["code"] == "bad_request"
    assert client.get("/api/search", params={"q": "x" * 200}).status_code == 200

    for limit in (0, 51):
        invalid = client.get("/api/search", params={"q": "école", "limit": limit})
        assert invalid.status_code == 400 and invalid.json()["code"] == "bad_request"

    empty = client.get("/api/search", params={"q": ""})
    assert empty.status_code == 400 and empty.json()["code"] == "bad_request"


def test_search_route_returns_search_hits(
    api_with_index: tuple[TestClient, TestClient],
) -> None:
    client, _ = api_with_index
    response = client.get("/api/search", params={"q": "maison"})
    assert response.status_code == 200
    hits = response.json()
    assert hits
    assert set(hits[0]) == {"block_id", "item_id", "source", "page", "snippet", "score"}
    assert {hit["item_id"] for hit in hits} <= {"cw_1", "cw_2"}
    assert all(hit["score"] >= 0 for hit in hits)


def test_search_route_never_returns_deleted_items(
    api_with_index: tuple[TestClient, TestClient],
) -> None:
    client, _ = api_with_index
    hits = client.get("/api/search", params={"q": "école"}).json()
    assert hits and all(hit["item_id"] != "cw_deleted" for hit in hits)


def test_search_route_stopwords_return_empty(
    api_with_index: tuple[TestClient, TestClient],
) -> None:
    client, _ = api_with_index
    response = client.get("/api/search", params={"q": "le la de que"})
    assert response.status_code == 200 and response.json() == []


@pytest.mark.parametrize("q", ['"', "*", "NEAR(a b)", "col:école", "-école", "AND", "("])
def test_search_route_neutralizes_fts_syntax(
    api_with_index: tuple[TestClient, TestClient], q: str
) -> None:
    client, _ = api_with_index
    response = client.get("/api/search", params={"q": q})
    assert response.status_code == 200


def test_search_under_300ms(api_with_big_index: TestClient) -> None:
    started = time.perf_counter()
    response = api_with_big_index.get("/api/search", params={"q": "école maison"})
    elapsed = time.perf_counter() - started
    assert response.status_code == 200
    assert response.json()
    assert elapsed < 0.3
