"""API del plan de estudio: construir hoy por reglas y «hecho» por usuario (AI-14).

El plan se arma con ``ensure_today`` (AI-10) y el reloj fijo de ``make_api``; los
días son de America/Bogota.
"""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from tests.testkit.api import create_user, login, make_api, second_user_client

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
T0 = "2026-11-02T10:00:00Z"
DAY = "2026-11-02"


@dataclass(frozen=True)
class SeededApi:
    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection
    user_id: str


def _course(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (T0,),
    )


def _card(conn: sqlite3.Connection, card_id: str, front_fr: str) -> None:
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at) VALUES (?, 'vocab', ?, 'palabra', 'rules', '1', 0, ?, ?)",
        (card_id, front_fr, T0, T0),
    )


@pytest.fixture
def seeded_api(tmp_path: Path) -> Iterator[SeededApi]:
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    conn.execute("PRAGMA foreign_keys=ON")
    _course(conn)
    user_id = create_user(conn, "ana@ex.org")
    login(client, "ana@ex.org")
    try:
        yield SeededApi(client=client, ctx=ctx, conn=conn, user_id=user_id)
    finally:
        conn.close()
        client.close()


@pytest.fixture
def user_client(seeded_api: SeededApi) -> TestClient:
    return seeded_api.client


@pytest.fixture
def seeded_cards_due(seeded_api: SeededApi) -> SeededApi:
    for n in range(3):
        _card(seeded_api.conn, f"c_{n}", f"mot {n}")
    return seeded_api


@pytest.fixture
def two_users(seeded_api: SeededApi) -> Iterator[tuple[TestClient, TestClient]]:
    create_user(seeded_api.conn, "leo@ex.org")
    leo = second_user_client(seeded_api.client, "leo@ex.org")
    try:
        yield seeded_api.client, leo
    finally:
        leo.close()


def test_plan_today_is_built_if_missing_and_done_roundtrip(
    user_client: TestClient, seeded_cards_due: SeededApi
) -> None:
    day = user_client.get("/api/plan/today").json()
    assert day["day"] == DAY
    assert day["generated_at"]
    assert day["entries"]
    position = day["entries"][0]["position"]

    marked = user_client.post(f"/api/plan/{day['day']}/{position}/done")
    assert marked.status_code == 200 and marked.json()["done"] is True
    unmarked = user_client.delete(f"/api/plan/{day['day']}/{position}/done")
    assert unmarked.status_code == 200 and unmarked.json()["done"] is False
    assert len(user_client.get("/api/plan/week").json()) == 7


def test_plan_is_private(
    two_users: tuple[TestClient, TestClient], seeded_cards_due: SeededApi
) -> None:
    ana, leo = two_users
    ana_day = ana.get("/api/plan/today").json()
    position = ana_day["entries"][0]["position"]
    assert ana.post(f"/api/plan/{DAY}/{position}/done").json()["done"] is True

    leo_day = leo.get("/api/plan/today").json()
    assert leo_day["entries"][0]["done"] is False
    assert leo.post(f"/api/plan/{DAY}/{position}/done").json()["done"] is True

    still_done = ana.get("/api/plan/today").json()["entries"][0]["done"]
    assert still_done is True


def test_plan_done_missing_row_is_404(user_client: TestClient, seeded_cards_due: SeededApi) -> None:
    user_client.get("/api/plan/today")
    present = user_client.get("/api/plan/today").json()["entries"][0]["position"]
    missing = present + 99
    assert user_client.post(f"/api/plan/{DAY}/{missing}/done").status_code == 404
    assert user_client.delete(f"/api/plan/{DAY}/{missing}/done").status_code == 404


def test_plan_bad_day_and_week_are_validated(
    user_client: TestClient, seeded_cards_due: SeededApi
) -> None:
    assert user_client.post("/api/plan/2026-11-2/0/done").status_code == 400
    week = user_client.get("/api/plan/week")
    assert week.status_code == 200 and len(week.json()) == 7
    assert [day["day"] for day in week.json()] == [
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
        "2026-11-08",
    ]


def test_plan_requires_session(seeded_api: SeededApi) -> None:
    anon = TestClient(seeded_api.client.app, base_url="https://testserver")
    try:
        assert anon.get("/api/plan/today").status_code == 401
        assert anon.get("/api/plan/week").status_code == 401
        assert anon.post(f"/api/plan/{DAY}/0/done").status_code == 401
    finally:
        anon.close()
