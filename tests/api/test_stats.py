"""Estadísticas del usuario (UI-06): racha, semana, retención, tarjetas y quizzes.

Todas las agregaciones se filtran por el usuario de la sesión y usan el día
Bogotá (``America/Bogota``); ninguna lee datos de otra cuenta.
"""

import sqlite3
import time
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from frances.timeutil import format_ts
from tests.api._helpers_ui05 import (
    NOW,
    Actor,
    Clock,
    put_prefs,
    put_state,
)

pytest_plugins = ("tests.api._helpers_ui05",)

DEMO_COURSE = "demo-course"


def add_review(
    conn: sqlite3.Connection,
    user_id: str,
    card_id: str,
    *,
    at: datetime,
    prev_state: int = 2,
    rating: int = 3,
) -> None:
    """Fila de ``review_log`` con el estado previo y la nota indicados."""
    ts = format_ts(at)
    conn.execute(
        "INSERT INTO review_log (user_id, card_id, rating, state, due, stability,"
        " difficulty, elapsed_days, scheduled_days, review_at)"
        " VALUES (?, ?, ?, ?, ?, 1.0, 5.0, 0, 1, ?)",
        (user_id, card_id, rating, prev_state, ts, ts),
    )


def _insert_quiz(conn: sqlite3.Connection, quiz_id: str) -> None:
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash,"
        " prompt_version, model, stale, created_at) VALUES (?, 'topic', 'tp_stats',"
        " ?, 'stats', 'v1', 'model', 0, ?)",
        (quiz_id, f"Quiz {quiz_id}", format_ts(NOW)),
    )


def add_attempt(
    conn: sqlite3.Connection,
    user_id: str,
    quiz_id: str,
    *,
    score: float,
    finished_at: datetime,
) -> None:
    ts = format_ts(finished_at)
    conn.execute(
        "INSERT INTO quiz_attempts (user_id, quiz_id, answers_json, score, started_at,"
        " finished_at) VALUES (?, ?, '[]', ?, ?, ?)",
        (user_id, quiz_id, score, ts, ts),
    )


def test_streak_week_and_retention(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    db: sqlite3.Connection,
    clock: Clock,
) -> None:
    for days_ago in (0, 1, 2, 4):
        add_review(
            db,
            user_id,
            seeded_cards[0],
            at=clock.now - timedelta(days=days_ago),
            prev_state=2,
            rating=3,
        )

    response = user_client.get("/api/me/stats")
    assert response.status_code == 200, response.text
    stats = response.json()
    assert stats["streak_days"] == 3
    assert len(stats["week"]) == 7
    assert [day["day"] for day in stats["week"]] == [
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
        "2026-11-08",
    ]
    assert [day["reviews"] for day in stats["week"]] == [1, 0, 0, 0, 0, 0, 0]
    assert [day["quiz_attempts"] for day in stats["week"]] == [0, 0, 0, 0, 0, 0, 0]
    assert stats["reviews_today"] == 1
    assert stats["retention_30d"] is None  # solo 4 reseñas con estado previo 2
    assert stats["cards_learned"] == 0
    assert stats["due_now"] == 10  # la cola de nuevas se corta en daily_new_cards
    assert stats["quiz_best"] == []


def test_stats_are_per_user(
    two_users: tuple[Actor, Actor], seeded_cards: list[str], db: sqlite3.Connection
) -> None:
    """REVIEW FOCUS P09-10: las estadísticas son solo del usuario de la sesión."""
    ana, leo = two_users
    add_review(db, ana.user_id, seeded_cards[0], at=NOW, prev_state=0, rating=3)

    ana_stats = ana.get("/api/me/stats").json()
    leo_stats = leo.get("/api/me/stats").json()
    assert ana_stats["reviews_today"] == 1
    assert leo_stats["reviews_today"] == 0
    assert leo_stats["streak_days"] == 0


def test_retention_30d_needs_ten_reviews_with_previous_state(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    db: sqlite3.Connection,
) -> None:
    for index in range(9):
        add_review(
            db,
            user_id,
            seeded_cards[index % len(seeded_cards)],
            at=NOW - timedelta(days=index + 1),
            prev_state=2,
            rating=3,
        )
    assert user_client.get("/api/me/stats").json()["retention_30d"] is None

    add_review(db, user_id, seeded_cards[0], at=NOW, prev_state=2, rating=1)
    stats = user_client.get("/api/me/stats").json()
    assert stats["retention_30d"] == pytest.approx(0.9)

    # Estado previo distinto de 2 o fuera de los 30 días: no cuentan.
    add_review(db, user_id, seeded_cards[1], at=NOW, prev_state=1, rating=1)
    add_review(
        db,
        user_id,
        seeded_cards[2],
        at=NOW - timedelta(days=31),
        prev_state=2,
        rating=1,
    )
    assert user_client.get("/api/me/stats").json()["retention_30d"] == pytest.approx(0.9)


def test_cards_learned_excludes_suspended_foreign_and_removed_cards(
    two_users: tuple[Actor, Actor], seeded_cards: list[str], db: sqlite3.Connection
) -> None:
    ana, leo = two_users
    put_state(db, ana.user_id, seeded_cards[0], state=2)
    put_state(db, ana.user_id, seeded_cards[1], state=2)
    put_state(db, ana.user_id, seeded_cards[2], state=2, suspended=1)
    put_state(db, ana.user_id, seeded_cards[3], state=2)
    db.execute(
        "UPDATE cards SET removed_at = ? WHERE id = ?",
        (format_ts(NOW), seeded_cards[3]),
    )

    private_id = "uc_" + "a" * 16
    db.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id)"
        " VALUES (?, 'vocab', 'privé', 'privado', 'user', '1', 0, ?, ?, ?)",
        (private_id, format_ts(NOW), format_ts(NOW), leo.user_id),
    )
    put_state(db, ana.user_id, private_id, state=2)

    assert ana.get("/api/me/stats").json()["cards_learned"] == 2


def test_due_now_counts_due_plus_new_cards_allowed_today(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    db: sqlite3.Connection,
    clock: Clock,
) -> None:
    put_state(db, user_id, seeded_cards[0], due=clock.minus(hours=2))
    put_state(db, user_id, seeded_cards[1], due=clock.minus(hours=1))
    put_prefs(db, user_id, daily_new_cards=3)
    assert user_client.get("/api/me/stats").json()["due_now"] == 5


def test_quiz_best_returns_top_five_by_last_attempt(
    two_users: tuple[Actor, Actor], db: sqlite3.Connection
) -> None:
    ana, leo = two_users
    for index in range(6):
        _insert_quiz(db, f"qz_stats_{index}")

    add_attempt(db, ana.user_id, "qz_stats_0", score=0.5, finished_at=NOW - timedelta(days=6))
    add_attempt(db, ana.user_id, "qz_stats_0", score=0.9, finished_at=NOW - timedelta(days=5))
    add_attempt(db, ana.user_id, "qz_stats_1", score=0.6, finished_at=NOW - timedelta(days=4))
    add_attempt(db, ana.user_id, "qz_stats_2", score=0.7, finished_at=NOW - timedelta(days=3))
    add_attempt(db, ana.user_id, "qz_stats_3", score=0.8, finished_at=NOW - timedelta(days=2))
    add_attempt(db, ana.user_id, "qz_stats_4", score=0.95, finished_at=NOW - timedelta(days=1))
    add_attempt(db, ana.user_id, "qz_stats_5", score=1.0, finished_at=NOW)
    # El intento de Leo no puede cambiar la mejor nota ni el conteo de Ana.
    add_attempt(db, leo.user_id, "qz_stats_4", score=0.1, finished_at=NOW + timedelta(hours=1))

    quiz_best = ana.get("/api/me/stats").json()["quiz_best"]
    assert [entry["quiz_id"] for entry in quiz_best] == [
        "qz_stats_5",
        "qz_stats_4",
        "qz_stats_3",
        "qz_stats_2",
        "qz_stats_1",
    ]
    assert quiz_best[0] == {
        "quiz_id": "qz_stats_5",
        "title_es": "Quiz qz_stats_5",
        "best_score": 1.0,
        "attempts": 1,
        "last_at": format_ts(NOW),
    }
    assert quiz_best[1]["attempts"] == 1
    assert quiz_best[1]["best_score"] == pytest.approx(0.95)


def test_stats_routes_under_300ms(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    db: sqlite3.Connection,
) -> None:
    rows = []
    for index in range(5000):
        at = format_ts(NOW - timedelta(hours=index))
        rows.append(
            (user_id, seeded_cards[index % len(seeded_cards)], 3, 2 if index % 2 else 0, at)
        )
    db.executemany(
        "INSERT INTO review_log (user_id, card_id, rating, state, due, stability,"
        " difficulty, elapsed_days, scheduled_days, review_at)"
        " VALUES (?, ?, ?, ?, ?, 1.0, 5.0, 0, 1, ?)",
        [(uid, card_id, rating, state, ts, ts) for uid, card_id, rating, state, ts in rows],
    )
    row = db.execute(
        "SELECT item_id FROM card_sources WHERE card_id = ?", (seeded_cards[0],)
    ).fetchone()
    assert row is not None
    db.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, edited_input_hash,"
        " created_at, updated_at, removed_at) VALUES ('tp_perf', ?, 'Tema', '', NULL, 0,"
        " 'rules', '1', 'perf', 0, NULL, ?, ?, NULL)",
        (DEMO_COURSE, format_ts(NOW), format_ts(NOW)),
    )
    db.execute(
        "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
        " VALUES ('tp_perf', ?, 0, 0)",
        (str(row[0]),),
    )

    checks = (
        ("/api/me/prefs", None),
        ("/api/me/stats", None),
        ("/api/me/topic-progress", {"course_id": DEMO_COURSE}),
        ("/api/me/upcoming", {"limit": 3}),
    )
    # Primera petición de cada ruta: arranque del portal y de la conexión SQLite.
    for url, params in checks:
        assert user_client.get(url, params=params).status_code == 200, url
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    for url, params in checks:
        samples = []
        for _ in range(3):
            started = time.perf_counter()
            response = user_client.get(url, params=params)
            samples.append(time.perf_counter() - started)
            assert response.status_code == 200, (url, response.text)
        assert min(samples) < 0.3, (url, samples)
