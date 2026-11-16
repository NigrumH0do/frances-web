"""Gestión de tarjetas (MGT-01): copia personal, tarjetas propias y admin.

Los datos son sintéticos y se insertan en una base migrada vacía. Cada caso
comprueba el aislamiento entre usuarios, el borrado lógico del admin o que las
escrituras no tocan el estado FSRS.
"""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.db.store import Store
from frances.models.ids import user_card_id
from frances.timeutil import format_ts
from tests.testkit.api import create_user, login, make_api, second_user_client

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
NOW_TS = format_ts(NOW)
ITEM = "cw_1"
SHARED = "c_shared_mgt01"
AUDIO_KEY = "a" * 32


@dataclass(frozen=True)
class Api:
    """Tres sesiones en la misma app y una conexión directa para comprobar filas."""

    ana: TestClient
    leo: TestClient
    admin: TestClient
    conn: sqlite3.Connection
    ctx: ApiContext
    ana_id: str
    leo_id: str
    admin_id: str


def insert_item(conn: sqlite3.Connection, item_id: str = ITEM) -> None:
    """Publicación viva con texto francés suficiente para regenerar."""
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (NOW_TS,),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', '1', 'Leçon 1', 'Bonjour à tous.', 'PUBLISHED',"
        " ?, ?, 'item-hash', '{}', ?, ?)",
        (item_id, NOW_TS, NOW_TS, NOW_TS, NOW_TS),
    )


def insert_shared_card(
    conn: sqlite3.Connection,
    card_id: str = SHARED,
    *,
    front_fr: str = "Bonjour",
    back_es: str = "Buenos días",
) -> None:
    """Tarjeta compartida (``owner_user_id`` NULL) con su origen y generación."""
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
        " phonemes, tags, generator, generator_version, stale, created_at, updated_at)"
        " VALUES (?, 'vocab', ?, ?, NULL, NULL, NULL, '[]', '[]', 'demo', '1', 0, ?, ?)",
        (card_id, front_fr, back_es, NOW_TS, NOW_TS),
    )
    conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (card_id, ITEM))
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, 'gen-hash', 'llm', '1', ?)",
        (ITEM, NOW_TS),
    )


def insert_own_card(
    conn: sqlite3.Connection,
    owner: str,
    *,
    front_fr: str = "Secret d'Ana",
    back_es: str = "Secreto de Ana",
    card_id: str | None = None,
    removed_at: str | None = None,
) -> str:
    """Tarjeta propia de ``owner`` (id estable ``user_card_id`` salvo que se fije)."""
    cid = card_id or user_card_id(owner, front_fr, "vocab")
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
        " phonemes, tags, generator, generator_version, stale, created_at, updated_at,"
        " owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, ?, NULL, NULL, NULL, '[]', '[]', 'user', '1', 0, ?, ?, ?, ?)",
        (cid, front_fr, back_es, NOW_TS, NOW_TS, owner, removed_at),
    )
    return cid


def insert_state(conn: sqlite3.Connection, user_id: str, card_id: str, *, reps: int = 4) -> None:
    """Estado FSRS del usuario con ``reps`` reconocible."""
    conn.execute(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
        " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
        " suspended, flagged_hard, updated_at)"
        " VALUES (?, ?, ?, 1.0, 5.0, 0, 0, 0, ?, 0, 0, NULL, 0, 0, ?)",
        (user_id, card_id, NOW_TS, reps, NOW_TS),
    )


def insert_review_log(conn: sqlite3.Connection, user_id: str, card_id: str) -> None:
    """Una reseña histórica que el borrado propio debe limpiar."""
    conn.execute(
        "INSERT INTO review_log (user_id, card_id, rating, state, due, stability, difficulty,"
        " elapsed_days, scheduled_days, review_at)"
        " VALUES (?, ?, 3, 0, ?, 1.0, 5.0, 0, 0, ?)",
        (user_id, card_id, NOW_TS, NOW_TS),
    )


def card_ids(client: TestClient) -> set[str]:
    """Ids visibles en la primera página completa de ``/api/cards``."""
    response = client.get("/api/cards", params={"limit": 200})
    assert response.status_code == 200, response.text
    return {str(card["id"]) for card in response.json()["cards"]}


def job_rows(conn: sqlite3.Connection, kind: str) -> list[tuple[Any, ...]]:
    """Filas ``(payload, dedupe_key, priority)`` de los trabajos de ``kind``."""
    return list(
        conn.execute(
            "SELECT payload, dedupe_key, priority FROM jobs WHERE kind = ? ORDER BY id", (kind,)
        ).fetchall()
    )


@pytest.fixture
def api(tmp_path: Path) -> Iterator[Api]:
    """Base migrada con admin, Ana y Leo, y una tarjeta compartida de partida."""
    db_path = tmp_path / "state.db"
    Store.open(db_path).close()
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    admin_id = create_user(conn, "admin@ex.org", role="admin")
    ana_id = create_user(conn, "ana@ex.org")
    leo_id = create_user(conn, "leo@ex.org")
    insert_item(conn)
    insert_shared_card(conn)

    ana, ctx = make_api(tmp_path)
    login(ana, "ana@ex.org")
    admin = second_user_client(ana, "admin@ex.org")
    leo = second_user_client(ana, "leo@ex.org")
    try:
        yield Api(
            ana=ana,
            leo=leo,
            admin=admin,
            conn=conn,
            ctx=ctx,
            ana_id=ana_id,
            leo_id=leo_id,
            admin_id=admin_id,
        )
    finally:
        leo.close()
        admin.close()
        ana.close()
        conn.close()


def test_user_cannot_edit_or_delete_another_users_card(api: Api) -> None:
    """REVIEW FOCUS 1: la tarjeta propia de otro no se toca ni se revela."""
    own = insert_own_card(api.conn, api.ana_id)
    body = {"front_fr": "le chat (mío)", "back_es": "el gato (mío)"}

    assert api.leo.put(f"/api/cards/{own}/mine", json=body).status_code == 404
    assert api.leo.delete(f"/api/cards/{own}").status_code == 404
    assert api.leo.delete(f"/api/cards/{SHARED}").status_code == 403

    allowed = api.ana.put(f"/api/cards/{SHARED}/mine", json=body)
    assert allowed.status_code == 200
    assert allowed.json()["mine"]["front_fr"] == "le chat (mío)"

    row = api.conn.execute(
        "SELECT front_fr, owner_user_id FROM cards WHERE id = ?", (own,)
    ).fetchone()
    assert row == ("Secret d'Ana", api.ana_id)
    assert api.conn.execute(
        "SELECT COUNT(*) FROM card_overrides WHERE user_id = ? AND card_id = ?",
        (api.leo_id, own),
    ).fetchone() == (0,)


def test_create_own_card_is_201_and_private(api: Api) -> None:
    response = api.ana.post(
        "/api/cards",
        json={"kind": "vocab", "front_fr": "  le chien  ", "back_es": "el perro"},
    )
    assert response.status_code == 201, response.text
    view = response.json()
    assert view["id"] == user_card_id(api.ana_id, "le chien", "vocab")
    assert view["id"].startswith("uc_")
    assert view["owner"] == "mine"
    assert view["front_fr"] == "le chien"

    assert api.leo.get(f"/api/cards/{view['id']}").status_code == 404
    assert view["id"] not in card_ids(api.leo)
    assert view["id"] in card_ids(api.ana)

    row = api.conn.execute(
        "SELECT owner_user_id, generator, generator_version FROM cards WHERE id = ?",
        (view["id"],),
    ).fetchone()
    assert row == (api.ana_id, "user", "1")


def test_create_duplicate_own_card_is_409(api: Api) -> None:
    body = {"kind": "vocab", "front_fr": "le chien", "back_es": "el perro"}
    assert api.ana.post("/api/cards", json=body).status_code == 201
    duplicate = api.ana.post(
        "/api/cards",
        json={"kind": "vocab", "front_fr": "  le  chien ", "back_es": "otro perro"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "conflict"


def test_edit_my_copy_does_not_touch_fsrs_state(api: Api) -> None:
    """REVIEW FOCUS 9: la copia personal es de ``card_overrides``, no del estado FSRS."""
    insert_state(api.conn, api.ana_id, SHARED, reps=4)
    insert_review_log(api.conn, api.ana_id, SHARED)

    response = api.ana.put(
        f"/api/cards/{SHARED}/mine",
        json={"front_fr": "le chat (mío)", "back_es": "el gato (mío)"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["mine"]["front_fr"] == "le chat (mío)"
    assert response.json()["state"]["fsrs"]["reps"] == 4

    assert api.conn.execute(
        "SELECT reps FROM user_card_state WHERE user_id = ? AND card_id = ?",
        (api.ana_id, SHARED),
    ).fetchone() == (4,)
    assert api.conn.execute("SELECT COUNT(*) FROM review_log").fetchone() == (1,)


def test_delete_my_copy_returns_base_view_and_keeps_fsrs(api: Api) -> None:
    insert_state(api.conn, api.ana_id, SHARED, reps=3)
    assert (
        api.ana.put(
            f"/api/cards/{SHARED}/mine",
            json={"front_fr": "le chat (mío)", "back_es": "el gato (mío)"},
        ).status_code
        == 200
    )

    response = api.ana.delete(f"/api/cards/{SHARED}/mine")
    assert response.status_code == 200, response.text
    assert response.json()["mine"] is None
    assert response.json()["front_fr"] == "Bonjour"
    assert response.json()["state"]["fsrs"]["reps"] == 3
    assert api.conn.execute("SELECT COUNT(*) FROM card_overrides").fetchone() == (0,)


def test_admin_edits_shared_card_and_delete_keeps_history(api: Api) -> None:
    """REVIEW FOCUS 3: el borrado del admin es lógico y no borra la fila."""
    insert_state(api.conn, api.ana_id, SHARED, reps=4)
    api.conn.execute(
        "INSERT INTO card_overrides (user_id, card_id, front_fr, back_es, example_fr,"
        " example_es, notes, base_updated_at, updated_at)"
        " VALUES (?, ?, 'ma copie', 'mi copia', NULL, NULL, NULL, ?, ?)",
        (api.ana_id, SHARED, NOW_TS, NOW_TS),
    )
    edited = api.admin.patch(
        f"/api/admin/cards/{SHARED}",
        json={"front_fr": "le chat", "back_es": "el gato", "notes": "revisado"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["edited_by_human"] is True
    row = api.conn.execute(
        "SELECT front_fr, back_es, notes, edited_by_human, edited_input_hash"
        " FROM cards WHERE id = ?",
        (SHARED,),
    ).fetchone()
    assert row == ("le chat", "el gato", "revisado", 1, "gen-hash")
    assert api.conn.execute(
        "SELECT reps FROM user_card_state WHERE user_id = ? AND card_id = ?",
        (api.ana_id, SHARED),
    ).fetchone() == (4,)
    assert api.conn.execute(
        "SELECT front_fr FROM card_overrides WHERE user_id = ? AND card_id = ?",
        (api.ana_id, SHARED),
    ).fetchone() == ("ma copie",)

    assert api.admin.delete(f"/api/admin/cards/{SHARED}").status_code == 204
    removed = api.conn.execute(
        "SELECT removed_at, edited_by_human, front_fr FROM cards WHERE id = ?", (SHARED,)
    ).fetchone()
    assert removed is not None
    assert removed[0] is not None and removed[1] == 1 and removed[2] == "le chat"
    assert SHARED not in card_ids(api.ana)
    assert SHARED not in card_ids(api.leo)
    assert api.ana.get(f"/api/cards/{SHARED}").status_code == 404
    queue = api.ana.get("/api/review/queue").json()
    assert SHARED not in {str(card["id"]) for card in queue}
    assert api.conn.execute(
        "SELECT front_fr FROM card_overrides WHERE user_id = ? AND card_id = ?",
        (api.ana_id, SHARED),
    ).fetchone() == ("ma copie",)


def test_admin_cannot_edit_or_delete_user_owned_card(api: Api) -> None:
    """REVIEW FOCUS 2: ``/api/admin/cards`` solo toca tarjetas compartidas."""
    own = insert_own_card(api.conn, api.ana_id)
    body = {"front_fr": "x", "back_es": "y"}
    assert api.admin.patch(f"/api/admin/cards/{own}", json=body).status_code == 409
    assert api.admin.delete(f"/api/admin/cards/{own}").status_code == 409
    row = api.conn.execute(
        "SELECT front_fr, back_es, removed_at FROM cards WHERE id = ?", (own,)
    ).fetchone()
    assert row == ("Secret d'Ana", "Secreto de Ana", None)


def test_admin_edit_and_create_own_queue_audio_regeneration(api: Api) -> None:
    created = api.ana.post(
        "/api/cards",
        json={"kind": "vocab", "front_fr": "le chien", "back_es": "el perro"},
    )
    assert created.status_code == 201
    own_id = created.json()["id"]
    rows = job_rows(api.conn, "audio.regenerate")
    assert json.loads(rows[0][0]) == {"card_id": own_id}
    assert rows[0][1] == f"audio.regenerate:card:{own_id}"

    assert (
        api.admin.patch(
            f"/api/admin/cards/{SHARED}",
            json={"front_fr": "Bonjour", "back_es": "Hola"},
        ).status_code
        == 200
    )
    rows = job_rows(api.conn, "audio.regenerate")
    assert json.loads(rows[-1][0]) == {"card_id": SHARED}
    assert rows[-1][1] == f"audio.regenerate:card:{SHARED}"


def test_admin_patch_unknown_or_removed_card_is_404(api: Api) -> None:
    body = {"front_fr": "x", "back_es": "y"}
    assert api.admin.patch("/api/admin/cards/no-existe", json=body).status_code == 404
    assert api.admin.delete("/api/admin/cards/no-existe").status_code == 404

    api.conn.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (NOW_TS, SHARED))
    assert api.admin.patch(f"/api/admin/cards/{SHARED}", json=body).status_code == 404
    assert api.admin.delete(f"/api/admin/cards/{SHARED}").status_code == 404


def test_delete_own_card_removes_children(api: Api) -> None:
    own = insert_own_card(api.conn, api.ana_id)
    insert_state(api.conn, api.ana_id, own)
    insert_review_log(api.conn, api.ana_id, own)
    api.conn.execute(
        "INSERT INTO card_overrides (user_id, card_id, front_fr, back_es, example_fr,"
        " example_es, notes, base_updated_at, updated_at)"
        " VALUES (?, ?, 'x', 'y', NULL, NULL, NULL, ?, ?)",
        (api.ana_id, own, NOW_TS, NOW_TS),
    )
    api.conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (own, ITEM))
    api.conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, attempts, updated_at)"
        " VALUES (?, 'x', 'x', 'fr-FR-DeniseNeural', 'ms-neural', '1', 'done', 1, ?)",
        (AUDIO_KEY, NOW_TS),
    )
    api.conn.execute(
        "INSERT INTO card_audio (card_id, field, cache_key) VALUES (?, 'front', ?)",
        (own, AUDIO_KEY),
    )

    assert api.ana.delete(f"/api/cards/{own}").status_code == 204
    assert api.conn.execute("SELECT COUNT(*) FROM cards WHERE id = ?", (own,)).fetchone() == (0,)
    for table in ("user_card_state", "review_log", "card_overrides", "card_audio", "card_sources"):
        assert api.conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE card_id = ?", (own,)
        ).fetchone() == (0,), table
    # El clip de audio es compartido por clave: no se borra con la tarjeta.
    assert api.conn.execute(
        "SELECT COUNT(*) FROM audio WHERE cache_key = ?", (AUDIO_KEY,)
    ).fetchone() == (1,)


def test_regenerate_item_enqueues_deduped_job(api: Api) -> None:
    first = api.admin.post(f"/api/admin/items/{ITEM}/regenerate")
    second = api.admin.post(f"/api/admin/items/{ITEM}/regenerate")
    assert first.status_code == 202, first.text
    assert second.status_code == 202
    assert first.json()["kind"] == "cards.regenerate_item"
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["state"] == "queued"

    rows = job_rows(api.conn, "cards.regenerate_item")
    assert len(rows) == 1
    payload, dedupe_key, priority = rows[0]
    assert json.loads(payload) == {"item_id": ITEM}
    assert dedupe_key == f"cards.regenerate_item:{ITEM}"
    assert priority == 5


def test_regenerate_unknown_or_deleted_item_is_404(api: Api) -> None:
    assert api.admin.post("/api/admin/items/no-existe/regenerate").status_code == 404
    api.conn.execute("UPDATE items SET deleted_at = ? WHERE id = ?", (NOW_TS, ITEM))
    assert api.admin.post(f"/api/admin/items/{ITEM}/regenerate").status_code == 404


def test_new_manage_routes_are_in_route_policy(api: Api) -> None:
    """REVIEW FOCUS 12: sesión en las de usuario y ``require_admin`` en las de admin."""
    anonymous = TestClient(api.ana.app, base_url="https://testserver")
    body = {"front_fr": "x", "back_es": "y"}
    try:
        assert anonymous.put(f"/api/cards/{SHARED}/mine", json=body).status_code == 401
        assert anonymous.delete(f"/api/cards/{SHARED}/mine").status_code == 401
        assert anonymous.post("/api/cards", json={"kind": "vocab", **body}).status_code == 401
        assert anonymous.delete(f"/api/cards/{SHARED}").status_code == 401
    finally:
        anonymous.close()

    assert api.leo.patch(f"/api/admin/cards/{SHARED}", json=body).status_code == 403
    assert api.leo.delete(f"/api/admin/cards/{SHARED}").status_code == 403
    assert api.leo.post(f"/api/admin/items/{ITEM}/regenerate").status_code == 403


def test_manage_writes_require_csrf(api: Api) -> None:
    headers = {"X-CSRF-Token": ""}
    assert (
        api.ana.put(
            f"/api/cards/{SHARED}/mine",
            json={"front_fr": "x", "back_es": "y"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        api.ana.post(
            "/api/cards",
            json={"kind": "vocab", "front_fr": "x", "back_es": "y"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        api.admin.patch(
            f"/api/admin/cards/{SHARED}",
            json={"front_fr": "x", "back_es": "y"},
            headers=headers,
        ).status_code
        == 403
    )
    assert api.conn.execute("SELECT COUNT(*) FROM card_overrides").fetchone() == (0,)
    assert api.conn.execute("SELECT COUNT(*) FROM cards").fetchone() == (1,)
