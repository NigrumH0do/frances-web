"""Rutas admin de temas (MGT-03): solo admin, CSRF, validación y contrato.

La base y las sesiones salen de ``tests.testkit.api`` (R-35). Todo sintético.
"""

import sqlite3
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.security import require_admin
from tests.testkit.api import create_user, login, make_api, second_user_client

T0 = "2026-11-02T10:00:00Z"


def _course(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (T0,),
    )


def _item(conn: sqlite3.Connection, item_id: str) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, '', 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, f"Leçon {item_id}", T0, T0, f"{item_id}-hash", T0, T0),
    )


def _generation(conn: sqlite3.Connection, item_id: str) -> None:
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, ?, 'cards', 'cards-1', ?)",
        (item_id, f"in-{item_id}", T0),
    )


def _study_topic(
    conn: sqlite3.Connection,
    topic_id: str,
    title: str,
    item_ids: Sequence[str],
    *,
    position: int,
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, created_at, updated_at)"
        " VALUES (?, 'c_1', ?, '', NULL, ?, 'rules', 'rules-1', 'h', 0, ?, ?)",
        (topic_id, title, position, T0, T0),
    )
    for item_position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, item_position),
        )


def _seed(conn: sqlite3.Connection) -> None:
    _course(conn)
    for item_id in ("cw_1", "cw_2", "cw_3"):
        _item(conn, item_id)
        _generation(conn, item_id)
    _study_topic(conn, "tp_1", "Tout", ["cw_1", "cw_2"], position=0)
    _study_topic(conn, "tp_2", "Nombres", ["cw_3"], position=1)


@pytest.fixture
def admin(tmp_path: Path) -> Iterator[tuple[TestClient, sqlite3.Connection]]:
    client, _ctx = make_api(tmp_path)
    conn = sqlite3.connect(_ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org", role="admin")
    create_user(conn, "leo@ex.org", role="user")
    _seed(conn)
    login(client, "ana@ex.org")
    try:
        yield client, conn
    finally:
        conn.close()


def test_user_cannot_manage_topics(admin: tuple[TestClient, sqlite3.Connection]) -> None:
    client, _conn = admin
    user = second_user_client(client, "leo@ex.org")
    assert user.patch("/api/admin/topics/tp_1", json={"title": "x"}).status_code == 403
    assert (
        user.post(
            "/api/admin/topics/merge", json={"topic_ids": ["tp_1", "tp_2"], "title": "x"}
        ).status_code
        == 403
    )
    assert (
        user.post(
            "/api/admin/topics/tp_1/split", json={"item_ids": ["cw_1"], "title": "x"}
        ).status_code
        == 403
    )
    assert user.post("/api/admin/topics/tp_2/items", json={"item_ids": ["cw_1"]}).status_code == 403


def test_admin_renames_topic_and_marks_it_edited(
    admin: tuple[TestClient, sqlite3.Connection],
) -> None:
    client, conn = admin
    response = client.patch("/api/admin/topics/tp_1", json={"title": "  Salutations  "})
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "tp_1" and body["title"] == "Salutations"
    assert body["edited_by_human"] is True and body["source_changed"] is False
    assert set(body["item_ids"]) == {"cw_1", "cw_2"}
    stored = conn.execute(
        "SELECT edited_by_human, input_hash, edited_input_hash FROM study_topics WHERE id = 'tp_1'"
    ).fetchone()
    assert stored is not None and stored[0] == 1 and stored[1] == stored[2]


def test_admin_merge_uses_first_id_as_survivor(
    admin: tuple[TestClient, sqlite3.Connection],
) -> None:
    client, conn = admin
    response = client.post(
        "/api/admin/topics/merge", json={"topic_ids": ["tp_1", "tp_2"], "title": "Tout"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "tp_1" and set(body["item_ids"]) == {"cw_1", "cw_2", "cw_3"}
    absorbed = conn.execute(
        "SELECT removed_at, edited_by_human FROM study_topics WHERE id = 'tp_2'"
    ).fetchone()
    assert absorbed is not None and absorbed[0] is not None and absorbed[1] == 0


def test_admin_split_creates_topic_after_original(
    admin: tuple[TestClient, sqlite3.Connection],
) -> None:
    client, _conn = admin
    response = client.post(
        "/api/admin/topics/tp_1/split", json={"item_ids": ["cw_2"], "title": "Nombres"}
    )
    assert response.status_code == 200
    body = response.json()
    assert {topic["title"]: set(topic["item_ids"]) for topic in body} == {
        "Tout": {"cw_1"},
        "Nombres": {"cw_2"},
    }
    assert body[0]["id"] == "tp_1" and body[1]["id"] != "tp_1"
    assert body[1]["position"] == body[0]["position"] + 1


def test_admin_move_keeps_source_alive_and_edited(
    admin: tuple[TestClient, sqlite3.Connection],
) -> None:
    client, conn = admin
    response = client.post("/api/admin/topics/tp_2/items", json={"item_ids": ["cw_1"]})
    assert response.status_code == 200
    assert set(response.json()["item_ids"]) == {"cw_1", "cw_3"}
    source = conn.execute(
        "SELECT removed_at, edited_by_human FROM study_topics WHERE id = 'tp_1'"
    ).fetchone()
    assert source is not None and source[0] is None and source[1] == 1
    remaining = conn.execute(
        "SELECT item_id FROM study_topic_items WHERE topic_id = 'tp_1'"
    ).fetchone()
    assert remaining is not None and remaining[0] == "cw_2"


def test_topic_write_without_csrf_is_403_and_writes_nothing(
    admin: tuple[TestClient, sqlite3.Connection],
) -> None:
    client, conn = admin
    client.headers.pop("X-CSRF-Token", None)
    response = client.patch("/api/admin/topics/tp_1", json={"title": "Intruso"})
    assert response.status_code == 403 and response.json()["code"] == "csrf"
    stored = conn.execute("SELECT title FROM study_topics WHERE id = 'tp_1'").fetchone()
    assert stored is not None and stored[0] == "Tout"


def test_unknown_topic_is_404(admin: tuple[TestClient, sqlite3.Connection]) -> None:
    client, _conn = admin
    assert client.patch("/api/admin/topics/tp_inexistente", json={"title": "x"}).status_code == 404
    assert (
        client.post(
            "/api/admin/topics/tp_inexistente/split",
            json={"item_ids": ["cw_1"], "title": "x"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/admin/topics/tp_inexistente/items", json={"item_ids": ["cw_1"]}
        ).status_code
        == 404
    )


def test_invalid_items_are_400(admin: tuple[TestClient, sqlite3.Connection]) -> None:
    client, _conn = admin
    assert (
        client.post(
            "/api/admin/topics/tp_1/split", json={"item_ids": ["cw_3"], "title": "x"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/admin/topics/tp_2/items", json={"item_ids": ["cw_inexistente"]}
        ).status_code
        == 400
    )


def test_new_manage_routes_are_in_route_policy() -> None:
    from frances.api.routes import manage_topics

    router = manage_topics.router
    assert any(dep.dependency is require_admin for dep in router.dependencies)
    routes = {(method, route.path) for route in router.routes for method in route.methods}
    assert routes == {
        ("PATCH", "/api/admin/topics/{topic_id}"),
        ("POST", "/api/admin/topics/merge"),
        ("POST", "/api/admin/topics/{topic_id}/split"),
        ("POST", "/api/admin/topics/{topic_id}/items"),
    }
