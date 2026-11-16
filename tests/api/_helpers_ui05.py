"""Fixtures compartidas de UI-05: cola y reseñas FSRS (R-02, R-35).

La base parte del demo sintético versionado (``tests/fixtures/demo_state.sql``)
y se le agregan seis tarjetas con una publicación más antigua, para que la cola
de nuevas tenga un orden estable. El reloj es fijo (UTC), igual que el testkit.
"""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from frances.api.app import ApiContext
from frances.db.dump import restore_sql
from frances.models.study import ReviewIn
from frances.paths import DataPaths
from frances.timeutil import format_ts
from tests.testkit.api import create_user, login, make_api, second_user_client
from tests.testkit.demo import blob_sources, demo_sql

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
T_REVIEW = "2026-11-03T00:00:00.000Z"
T_EARLIER = "2026-11-02T23:00:00.000Z"
USER_EMAIL = "ana@ui05.test"
OTHER_EMAIL = "leo@ui05.test"

CARD_COUNT = 6
_ITEM_ID = "mt_ui05"
_ITEM_CREATED = "2026-09-01T13:00:00.000000Z"
_NOW_TS = format_ts(NOW)


@dataclass(frozen=True)
class Clock:
    """Reloj inyectado de las pruebas; ``minus``/``plus`` devuelven ``norm_ts``."""

    now: datetime = NOW

    def minus(self, *, hours: float = 0, minutes: float = 0) -> str:
        return format_ts(self.now - timedelta(hours=hours, minutes=minutes))

    def plus(self, *, hours: float = 0, minutes: float = 0) -> str:
        return format_ts(self.now + timedelta(hours=hours, minutes=minutes))


@dataclass(frozen=True)
class ReviewSeed:
    """App migrada, sesión de Ana y seis tarjetas sintéticas compartidas."""

    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection
    user_id: str
    cards: list[str]


@dataclass(frozen=True)
class Actor:
    """Cliente con su ``user_id``, para comparar datos entre dos cuentas."""

    client: TestClient
    user_id: str

    def get(self, url: str, **kwargs: Any) -> Response:
        return self.client.get(url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Response:
        return self.client.post(url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> Response:
        return self.client.patch(url, **kwargs)


def next_of(**overrides: Any) -> dict[str, Any]:
    """Estado FSRS que manda el cliente (valores de ejemplo compartidos con UI-10)."""
    base: dict[str, Any] = {
        "due": "2026-11-05T10:00:00.000Z",
        "stability": 3.1,
        "difficulty": 5.2,
        "elapsed_days": 0,
        "scheduled_days": 3,
        "learning_steps": 0,
        "reps": 1,
        "lapses": 0,
        "state": 2,
        "last_review": T_REVIEW,
    }
    return {**base, **overrides}


def review_body(
    card_id: str,
    *,
    rating: int = 3,
    reviewed_at: str = T_REVIEW,
    next_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "card_id": card_id,
        "rating": rating,
        "reviewed_at": reviewed_at,
        "next": next_of() if next_state is None else next_state,
    }


def review_in(
    card_id: str,
    *,
    rating: int = 3,
    reviewed_at: str = T_REVIEW,
    next_state: dict[str, Any] | None = None,
) -> ReviewIn:
    return ReviewIn.model_validate(
        review_body(card_id, rating=rating, reviewed_at=reviewed_at, next_state=next_state)
    )


def put_state(
    conn: sqlite3.Connection,
    user_id: str,
    card_id: str,
    *,
    due: str | None = None,
    stability: float = 1.0,
    difficulty: float = 5.0,
    state: int = 0,
    reps: int = 1,
    lapses: int = 0,
    last_review: str | None = None,
    suspended: int = 0,
    flagged_hard: int = 0,
) -> None:
    """Inserta o actualiza el estado FSRS del usuario para una tarjeta."""
    conn.execute(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
        " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
        " suspended, flagged_hard, updated_at)"
        " VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(user_id, card_id) DO UPDATE SET due = excluded.due,"
        " stability = excluded.stability, difficulty = excluded.difficulty,"
        " reps = excluded.reps, lapses = excluded.lapses, state = excluded.state,"
        " last_review = excluded.last_review, suspended = excluded.suspended,"
        " flagged_hard = excluded.flagged_hard, updated_at = excluded.updated_at",
        (
            user_id,
            card_id,
            due if due is not None else _NOW_TS,
            stability,
            difficulty,
            reps,
            lapses,
            state,
            last_review,
            suspended,
            flagged_hard,
            _NOW_TS,
        ),
    )


def put_prefs(conn: sqlite3.Connection, user_id: str, **values: Any) -> None:
    """Guarda preferencias del usuario como filas ``key``/``value_json``."""
    for key, value in values.items():
        conn.execute(
            "INSERT INTO user_prefs (user_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json,"
            " updated_at = excluded.updated_at",
            (user_id, key, json.dumps(value), _NOW_TS),
        )


def _seed_cards(conn: sqlite3.Connection) -> list[str]:
    """Seis tarjetas compartidas con una publicación anterior a todo el demo."""
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'demo-course', 'material', ?, 'Repaso UI-05', '', 'PUBLISHED',"
        " ?, ?, 'ui05', '{}', ?, ?)",
        (_ITEM_ID, _ITEM_ID, _ITEM_CREATED, _ITEM_CREATED, _ITEM_CREATED, _ITEM_CREATED),
    )
    cards = [f"ui05_c{index}" for index in range(CARD_COUNT)]
    for index, card_id in enumerate(cards):
        conn.execute(
            "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
            " stale, created_at, updated_at) VALUES (?, 'vocab', ?, 'sintético', 'demo',"
            " '1', 0, ?, ?)",
            (card_id, f"mot {index}", _ITEM_CREATED, _ITEM_CREATED),
        )
        conn.execute(
            "INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (card_id, _ITEM_ID)
        )
    return cards


@pytest.fixture
def review_seed(tmp_path: Path) -> Iterator[ReviewSeed]:
    """Demo sintético restaurado, migrado a v2 y con una sesión de Ana."""
    paths = DataPaths(tmp_path)
    paths.ensure_dirs()
    store = restore_sql(demo_sql(blob_sources()), tmp_path / "state.db")
    store.close()

    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    user_id = create_user(conn, USER_EMAIL)
    cards = _seed_cards(conn)
    login(client, USER_EMAIL)
    try:
        yield ReviewSeed(client=client, ctx=ctx, conn=conn, user_id=user_id, cards=cards)
    finally:
        conn.close()
        client.close()


@pytest.fixture
def user_client(review_seed: ReviewSeed) -> TestClient:
    return review_seed.client


@pytest.fixture
def user_id(review_seed: ReviewSeed) -> str:
    return review_seed.user_id


@pytest.fixture
def seeded_cards(review_seed: ReviewSeed) -> list[str]:
    return review_seed.cards


@pytest.fixture
def db(review_seed: ReviewSeed) -> sqlite3.Connection:
    return review_seed.conn


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def two_users(review_seed: ReviewSeed) -> Iterator[tuple[Actor, Actor]]:
    """Ana (la sesión principal) y Leo, cada uno con su cliente y su id."""
    other_id = create_user(review_seed.conn, OTHER_EMAIL)
    other = second_user_client(review_seed.client, OTHER_EMAIL)
    try:
        yield (
            Actor(review_seed.client, review_seed.user_id),
            Actor(other, other_id),
        )
    finally:
        other.close()


@pytest.fixture
def big_card_seed(review_seed: ReviewSeed) -> None:
    """2 000 tarjetas y 500 estados (100 vencidos) para el presupuesto de 300 ms."""
    cards = [(f"perf_ui05_{index:04d}", f"front {index}", f"back {index}") for index in range(2000)]
    review_seed.conn.executemany(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at) VALUES (?, 'vocab', ?, ?, 'demo', '1', 0, ?, ?)",
        [(card_id, front, back, _ITEM_CREATED, _ITEM_CREATED) for card_id, front, back in cards],
    )
    states = []
    for index, (card_id, _front, _back) in enumerate(cards[:500]):
        due = (
            format_ts(NOW - timedelta(minutes=index))
            if index < 100
            else format_ts(NOW + timedelta(days=index + 1))
        )
        states.append((review_seed.user_id, card_id, due, _NOW_TS))
    review_seed.conn.executemany(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
        " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
        " suspended, flagged_hard, updated_at) VALUES (?, ?, ?, 1.0, 5.0, 0, 1, 0, 1, 0, 2,"
        " NULL, 0, 0, ?)",
        states,
    )
