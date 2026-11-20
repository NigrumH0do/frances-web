"""Lectura de tarjetas, fichas, voces y taladros (SRV-09).

La base sale del demo sintético ya versionado (``tests/fixtures/demo_state.sql``)
y las tarjetas propias/ediciones de usuario se insertan dentro del test.
"""

import base64
import json
import sqlite3
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from frances.api.app import ApiContext
from frances.db.dump import restore_sql
from frances.paths import DataPaths
from tests.testkit.api import (
    BASE_URL,
    create_user,
    login,
    make_api,
    second_user_client,
)
from tests.testkit.demo import blob_sources, demo_sql

NOW = "2026-11-03T00:00:00.000000Z"
CARD_ID = "c_fc43341b9ea63489"
REMOVED_CARD = "c_21e0214a1451ec55"
STALE_CARD = "c_329f4d78c7ac86a5"


@dataclass(frozen=True)
class Seeded:
    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection
    user_id: str


@dataclass(frozen=True)
class Actor:
    """Cliente de un usuario con su id, para comparar visibilidad entre cuentas."""

    client: TestClient
    user_id: str

    def get(self, url: str, params: Mapping[str, Any] | None = None) -> Response:
        return self.client.get(url, params=params)


@pytest.fixture
def seeded(tmp_path: Path) -> Iterator[Seeded]:
    """Demo sintético restaurado, migrado a v2 y con una sesión de Ana."""
    paths = DataPaths(tmp_path)
    paths.ensure_dirs()
    store = restore_sql(demo_sql(blob_sources()), tmp_path / "state.db")
    store.close()

    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org")
    login(client, "ana@ex.org")
    row = conn.execute("SELECT id FROM users WHERE email = ?", ("ana@ex.org",)).fetchone()
    assert row is not None
    try:
        yield Seeded(client=client, ctx=ctx, conn=conn, user_id=str(row[0]))
    finally:
        conn.close()
        client.close()


@pytest.fixture
def two_users(seeded: Seeded) -> Iterator[tuple[Actor, Actor]]:
    """Ana (dueña del cliente de ``seeded``) y Leo, cada uno con su sesión."""
    leo_id = create_user(seeded.conn, "leo@ex.org")
    leo = second_user_client(seeded.client, "leo@ex.org")
    try:
        yield Actor(seeded.client, seeded.user_id), Actor(leo, leo_id)
    finally:
        leo.close()


@pytest.fixture
def anon_client(seeded: Seeded) -> Iterator[TestClient]:
    client = TestClient(seeded.client.app, base_url=BASE_URL)
    try:
        yield client
    finally:
        client.close()


def insert_user_card(conn: sqlite3.Connection, owner: str, card_id: str) -> None:
    """Tarjeta propia (``owner_user_id``) con un frente único y reconocible."""
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'Secret de Ana', 'Secreto de Ana', 'user', '1', 0, ?, ?, ?)",
        (card_id, NOW, NOW, owner),
    )


def insert_card_with_phonemes(
    conn: sqlite3.Connection,
    card_id: str,
    *,
    front_fr: str,
    phonemes: list[str],
    owner: str | None = None,
    removed_at: str | None = None,
) -> None:
    """Tarjeta con etiquetas de fonema; permite dueño privado y borrado lógico."""
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, phonemes, tags, generator,"
        " generator_version, stale, created_at, updated_at, owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, 'synthétique', ?, '[]', ?, '1', 0, ?, ?, ?, ?)",
        (
            card_id,
            front_fr,
            json.dumps(phonemes),
            "user" if owner is not None else "demo",
            NOW,
            NOW,
            owner,
            removed_at,
        ),
    )


def insert_state(
    conn: sqlite3.Connection,
    user_id: str,
    card_id: str,
    *,
    flagged_hard: int = 0,
) -> None:
    """Estado FSRS del usuario para una tarjeta compartida."""
    conn.execute(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
        " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
        " suspended, flagged_hard, updated_at)"
        " VALUES (?, ?, ?, 1.0, 5.0, 0, 0, 0, 1, 0, 0, NULL, 0, ?, ?)",
        (user_id, card_id, NOW, flagged_hard, NOW),
    )


def insert_override(conn: sqlite3.Connection, user_id: str, card_id: str) -> None:
    """Copia personal de una tarjeta compartida."""
    conn.execute(
        "INSERT INTO card_overrides (user_id, card_id, front_fr, back_es, example_fr,"
        " example_es, notes, base_updated_at, updated_at)"
        " VALUES (?, ?, 'la pomme (mía)', 'la manzana (mía)', NULL, NULL, NULL, ?, ?)",
        (user_id, card_id, NOW, NOW),
    )


def mark_edited(
    conn: sqlite3.Connection,
    card_id: str,
    *,
    edited_input_hash: str,
) -> None:
    """Marca la tarjeta como editada por el admin y publica otro input_hash."""
    row = conn.execute(
        "SELECT item_id FROM card_sources WHERE card_id = ? ORDER BY item_id LIMIT 1",
        (card_id,),
    ).fetchone()
    assert row is not None
    conn.execute(
        "INSERT OR REPLACE INTO generations (item_id, input_hash, generator,"
        " generator_version, created_at) VALUES (?, 'nuevo', 'llm', '1', ?)",
        (str(row[0]), NOW),
    )
    conn.execute(
        "UPDATE cards SET edited_by_human = 1, edited_input_hash = ? WHERE id = ?",
        (edited_input_hash, card_id),
    )


def ids(actor: Actor, params: Mapping[str, Any] | None = None) -> list[str]:
    """Ids de la primera página de ``/api/cards`` (límite máximo)."""
    query: dict[str, Any] = {"limit": 200}
    query.update(params or {})
    response = actor.get("/api/cards", params=query)
    assert response.status_code == 200, response.text
    return [str(card["id"]) for card in response.json()["cards"]]


def drill_card_ids(client: TestClient) -> set[str]:
    """Todos los ids de tarjeta que aparecen en cualquier mazo de ``/api/drills``."""
    response = client.get("/api/drills")
    assert response.status_code == 200, response.text
    return {str(card_id) for deck in response.json() for card_id in deck["card_ids"]}


def test_own_cards_are_private(two_users: tuple[Actor, Actor], seeded: Seeded) -> None:
    """REVIEW FOCUS: una tarjeta propia de otro usuario no sale en lista ni búsqueda."""
    ana, leo = two_users
    private_id = "uc_" + "a" * 16
    insert_user_card(seeded.conn, ana.user_id, private_id)

    assert private_id in ids(ana)
    assert private_id not in ids(leo)
    assert private_id not in ids(leo, {"q": "secret"})
    assert private_id in ids(ana, {"q": "secret"})
    assert leo.get(f"/api/cards/{private_id}").status_code == 404
    assert ana.get(f"/api/cards/{private_id}").status_code == 200


def test_card_view_merges_user_state_and_override(
    two_users: tuple[Actor, Actor], seeded: Seeded
) -> None:
    """La copia personal reemplaza la compartida solo para su dueño."""
    ana, leo = two_users
    insert_state(seeded.conn, ana.user_id, CARD_ID, flagged_hard=1)
    insert_override(seeded.conn, ana.user_id, CARD_ID)

    view = ana.get(f"/api/cards/{CARD_ID}").json()
    assert view["state"]["flagged_hard"] is True
    assert view["mine"]["front_fr"] == "la pomme (mía)"
    assert view["owner"] == "shared"
    assert view["front_fr"] == "la pomme (mía)"
    assert view["back_es"] == "la manzana (mía)"

    other = leo.get(f"/api/cards/{CARD_ID}").json()
    assert other["mine"] is None
    assert other["state"] is None
    assert other["front_fr"] == "Bonjour"


def test_removed_and_stale_cards(seeded: Seeded) -> None:
    seeded.conn.execute("UPDATE cards SET removed_at = ? WHERE id = ?", (NOW, REMOVED_CARD))
    seeded.conn.execute("UPDATE cards SET stale = 1 WHERE id = ?", (STALE_CARD,))

    listed = ids(seeded.client)
    assert REMOVED_CARD not in listed
    assert STALE_CARD not in listed
    assert STALE_CARD in ids(seeded.client, {"include_stale": True})
    assert seeded.client.get(f"/api/cards/{REMOVED_CARD}").status_code == 404


def test_source_changed_flag(seeded: Seeded) -> None:
    mark_edited(seeded.conn, CARD_ID, edited_input_hash="viejo")
    view = seeded.client.get(f"/api/cards/{CARD_ID}").json()
    assert view["edited_by_human"] is True
    assert view["source_changed"] is True


def test_search_escapes_like_wildcards(seeded: Seeded) -> None:
    assert ids(seeded.client, {"q": "%"}) == []
    assert ids(seeded.client, {"q": "_"}) == []
    assert ids(seeded.client, {"q": "bon%jour"}) == []
    assert CARD_ID in ids(seeded.client, {"q": "bonjour"})


def test_cards_paginate_by_cursor(seeded: Seeded) -> None:
    first = seeded.client.get("/api/cards", params={"limit": 5}).json()
    assert first["next_cursor"] is not None
    second = seeded.client.get(
        "/api/cards", params={"limit": 5, "cursor": first["next_cursor"]}
    ).json()
    first_ids = [card["id"] for card in first["cards"]]
    second_ids = [card["id"] for card in second["cards"]]
    assert len(first_ids) == len(second_ids) == 5
    assert not set(first_ids) & set(second_ids)


def test_bad_cursor_is_400(seeded: Seeded) -> None:
    response = seeded.client.get("/api/cards", params={"cursor": "%%%"})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"

    deep = base64.urlsafe_b64encode(b"[" * 10_000 + b"0" + b"]" * 10_000)
    response = seeded.client.get("/api/cards", params={"cursor": deep.decode("ascii").rstrip("=")})
    assert response.status_code == 400


def test_cards_filter_by_item_and_kind(seeded: Seeded) -> None:
    by_item = seeded.client.get("/api/cards", params={"item_id": "mt_demo1", "limit": 200})
    assert by_item.status_code == 200
    cards = by_item.json()["cards"]
    assert cards
    assert all("mt_demo1" in card["source_item_ids"] for card in cards)

    by_kind = seeded.client.get("/api/cards", params={"kind": "drill", "limit": 200})
    assert by_kind.status_code == 200
    assert by_kind.json()["cards"]
    assert all(card["kind"] == "drill" for card in by_kind.json()["cards"])


def test_sheet_route(seeded: Seeded) -> None:
    response = seeded.client.get("/api/sheets/mt_demo1")
    assert response.status_code == 200
    assert response.json()["item_id"] == "mt_demo1"
    assert seeded.client.get("/api/sheets/no-existe").status_code == 404


def test_voices_and_drills(seeded: Seeded) -> None:
    voices = seeded.client.get("/api/voices").json()
    assert voices and all(voice["id"] for voice in voices)
    assert all(set(voice) == {"id", "label", "age", "gender", "accent"} for voice in voices)

    drills = seeded.client.get("/api/drills").json()
    assert isinstance(drills, list) and drills
    assert all(deck["id"] and deck["title_es"] for deck in drills)


def test_drills_hide_private_cards_of_other_users(
    two_users: tuple[Actor, Actor], seeded: Seeded
) -> None:
    """REVIEW FOCUS: una tarjeta privada con fonemas no sale en los mazos de otro."""
    ana, leo = two_users
    label = "srv09priv"
    for index in range(4):
        insert_card_with_phonemes(
            seeded.conn,
            f"dr_shared_priv_{index}",
            front_fr=f"a{index}",
            phonemes=[label],
        )
    private_id = "uc_" + "d" * 16
    insert_card_with_phonemes(
        seeded.conn,
        private_id,
        front_fr="d",
        phonemes=[label],
        owner=ana.user_id,
    )

    # El mazo automático se forma (5 tarjetas) y Ana, dueña, sí ve la suya.
    assert private_id in drill_card_ids(ana.client)
    assert private_id not in drill_card_ids(leo.client)


def test_drills_hide_removed_shared_cards(seeded: Seeded) -> None:
    """Una tarjeta compartida con ``removed_at`` no queda en ningún mazo."""
    label = "srv09rem"
    visible = [f"dr_shared_rem_{index}" for index in range(5)]
    for index, card_id in enumerate(visible):
        insert_card_with_phonemes(
            seeded.conn,
            card_id,
            front_fr=f"r{index}",
            phonemes=[label],
        )
    removed_id = "dr_removed_srv09"
    insert_card_with_phonemes(
        seeded.conn,
        removed_id,
        front_fr="r",
        phonemes=[label],
        removed_at=NOW,
    )

    shown = drill_card_ids(seeded.client)
    assert removed_id not in shown
    assert visible[0] in shown  # el mazo existe y solo se filtró la tarjeta borrada


def test_cards_require_session(anon_client: TestClient, seeded: Seeded) -> None:
    assert anon_client.get("/api/cards").status_code == 401
    assert anon_client.get(f"/api/cards/{CARD_ID}").status_code == 401
    assert anon_client.get("/api/voices").status_code == 401
    assert anon_client.get("/api/drills").status_code == 401
    assert anon_client.get("/api/sheets/mt_demo1").status_code == 401


def test_cards_list_under_300ms(seeded: Seeded) -> None:
    """DoD: ``GET /api/cards?limit=200`` < 300 ms con 5 000 tarjetas."""
    rows = [
        (
            f"perf_{i:05d}",
            f"front synthétique {i}",
            f"detrás sintético {i}",
            NOW,
            NOW,
        )
        for i in range(5000)
    ]
    seeded.conn.executemany(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at)"
        " VALUES (?, 'vocab', ?, ?, 'demo', '1', 0, ?, ?)",
        rows,
    )

    started = time.perf_counter()
    response = seeded.client.get("/api/cards", params={"limit": 200})
    elapsed = time.perf_counter() - started
    assert response.status_code == 200
    assert len(response.json()["cards"]) == 200
    assert elapsed < 0.3


def test_card_view_includes_human_source_titles(seeded: Seeded) -> None:
    view = seeded.client.get(f"/api/cards/{CARD_ID}").json()
    src_ids = view["source_item_ids"]
    assert src_ids
    assert view["source_titles"]
    for iid in src_ids:
        assert iid in view["source_titles"] and view["source_titles"][iid]
