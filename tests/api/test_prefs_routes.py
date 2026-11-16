"""API de preferencias, progreso por tema y entregas próximas (UI-06).

Todo se lee y se escribe con el usuario de la sesión. ``/api/me/upcoming`` solo
devuelve publicaciones vivas de cursos incluidos (REVIEW FOCUS de UI-06).
"""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from frances.api.cards_repo import enabled_voices
from frances.timeutil import format_ts
from tests.api._helpers_ui05 import Actor, ReviewSeed, put_state

pytest_plugins = ("tests.api._helpers_ui05",)

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
DEMO_COURSE = "demo-course"
DEFAULTS = {"preferred_voice_ids": [], "daily_new_cards": 10, "theme": "system"}


def _ts(delta: timedelta = timedelta()) -> str:
    return format_ts(NOW + delta)


def _insert_topic(
    conn: sqlite3.Connection,
    topic_id: str,
    position: int,
    *,
    removed_at: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, edited_input_hash,"
        " created_at, updated_at, removed_at) VALUES (?, ?, ?, '', 'A2', ?, 'rules', '1',"
        " 'ui06', 0, NULL, ?, ?, ?)",
        (topic_id, DEMO_COURSE, f"Tema {topic_id}", position, _ts(), _ts(), removed_at),
    )


def _insert_quiz(
    conn: sqlite3.Connection,
    quiz_id: str,
    scope_kind: str,
    scope_id: str,
    title_es: str,
) -> None:
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash,"
        " prompt_version, model, stale, created_at) VALUES (?, ?, ?, ?, 'ui06', 'v1',"
        " 'model', 0, ?)",
        (quiz_id, scope_kind, scope_id, title_es, _ts()),
    )


def _add_attempt(
    conn: sqlite3.Connection,
    user_id: str,
    quiz_id: str,
    *,
    score: float,
    finished_at: str,
) -> None:
    conn.execute(
        "INSERT INTO quiz_attempts (user_id, quiz_id, answers_json, score, started_at,"
        " finished_at) VALUES (?, ?, '[]', ?, ?, ?)",
        (user_id, quiz_id, score, finished_at, finished_at),
    )


@pytest.fixture
def voices_enabled(review_seed: ReviewSeed) -> list[str]:
    """Ids de las voces habilitadas que publica ``GET /api/voices``."""
    return [voice.id for voice in enabled_voices(review_seed.ctx.paths)]


@pytest.fixture
def seeded_topics(review_seed: ReviewSeed) -> list[str]:
    """Dos temas vigentes (uno con la publicación de las tarjetas) y uno borrado."""
    conn = review_seed.conn
    row = conn.execute(
        "SELECT item_id FROM card_sources WHERE card_id = ?", (review_seed.cards[0],)
    ).fetchone()
    assert row is not None
    item_id = str(row[0])
    _insert_topic(conn, "tp_ui06_a", 0)
    _insert_topic(conn, "tp_ui06_b", 1)
    _insert_topic(conn, "tp_ui06_gone", 2, removed_at=_ts())
    conn.execute(
        "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
        " VALUES ('tp_ui06_a', ?, 0, 0)",
        (item_id,),
    )
    _insert_quiz(conn, "qz_ui06_topic", "topic", "tp_ui06_a", "Quiz del tema")
    _insert_quiz(conn, "qz_ui06_item", "item", item_id, "Quiz de la clase")
    _add_attempt(
        conn,
        review_seed.user_id,
        "qz_ui06_topic",
        score=0.5,
        finished_at=_ts(-timedelta(days=2)),
    )
    _add_attempt(
        conn,
        review_seed.user_id,
        "qz_ui06_topic",
        score=0.8,
        finished_at=_ts(-timedelta(days=1)),
    )
    return ["tp_ui06_a", "tp_ui06_b"]


def _insert_course(conn: sqlite3.Connection, course_id: str, *, included: int) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, section, state, update_time, included, raw_json)"
        " VALUES (?, ?, NULL, 'ACTIVE', ?, ?, '{}')",
        (course_id, course_id, _ts(), included),
    )


def _insert_item(
    conn: sqlite3.Connection,
    item_id: str,
    *,
    course_id: str = DEMO_COURSE,
    due_at: str | None = None,
    deleted_at: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, due_at, content_hash, raw_json, first_seen_at,"
        " last_seen_at, deleted_at) VALUES (?, ?, 'coursework', ?, ?, '', 'PUBLISHED',"
        " ?, ?, ?, 'ui06', '{}', ?, ?, ?)",
        (
            item_id,
            course_id,
            item_id,
            f"Entrega {item_id}",
            _ts(),
            _ts(),
            due_at,
            _ts(),
            _ts(),
            deleted_at,
        ),
    )


@pytest.fixture
def seeded_items_with_due(review_seed: ReviewSeed) -> list[str]:
    """Dos entregas futuras válidas y señuelos borrados, pasados o de otro curso."""
    conn = review_seed.conn
    _insert_course(conn, "ui06-excluded", included=0)
    _insert_item(conn, "cw_due_deleted", due_at=_ts(timedelta(hours=1)), deleted_at=_ts())
    _insert_item(
        conn,
        "cw_due_excluded",
        course_id="ui06-excluded",
        due_at=_ts(timedelta(minutes=30)),
    )
    _insert_item(conn, "cw_due_past", due_at=_ts(-timedelta(days=1)))
    _insert_item(conn, "cw_no_due")
    _insert_item(conn, "cw_due_tomorrow", due_at=_ts(timedelta(days=1)))
    _insert_item(conn, "cw_due_in_3_days", due_at=_ts(timedelta(days=3)))
    return ["cw_due_tomorrow", "cw_due_in_3_days"]


def test_prefs_defaults_roundtrip_and_validation(
    user_client: TestClient, voices_enabled: list[str]
) -> None:
    assert user_client.get("/api/me/prefs").json() == DEFAULTS

    body = {
        "preferred_voice_ids": [voices_enabled[0]],
        "daily_new_cards": 20,
        "theme": "dark",
    }
    saved = user_client.put("/api/me/prefs", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json() == body
    assert user_client.get("/api/me/prefs").json() == body

    for bad in (
        {**body, "daily_new_cards": 101},
        {**body, "daily_new_cards": -1},
        {**body, "daily_new_cards": 10**9},
        {**body, "preferred_voice_ids": ["fr-FR-NoExiste"]},
        {**body, "preferred_voice_ids": ["v" * 100_000]},
        {**body, "extra": 1},
    ):
        response = user_client.put("/api/me/prefs", json=bad)
        assert response.status_code == 400, bad
        assert response.json()["code"] == "bad_request"
    assert user_client.get("/api/me/prefs").json() == body

    for value in (0, 100):
        body["daily_new_cards"] = value
        assert user_client.put("/api/me/prefs", json=body).status_code == 200


def test_prefs_put_requires_csrf(user_client: TestClient) -> None:
    response = user_client.put("/api/me/prefs", json=DEFAULTS, headers={"X-CSRF-Token": ""})
    assert response.status_code == 403
    assert response.json()["code"] == "csrf"
    assert user_client.get("/api/me/prefs").json() == DEFAULTS


def test_prefs_are_per_user(two_users: tuple[Actor, Actor], voices_enabled: list[str]) -> None:
    """REVIEW FOCUS P09-10: las preferencias de un usuario no se ven desde otra cuenta."""
    ana, leo = two_users
    body = {
        "preferred_voice_ids": [voices_enabled[0]],
        "daily_new_cards": 30,
        "theme": "light",
    }
    assert ana.client.put("/api/me/prefs", json=body).status_code == 200
    assert ana.get("/api/me/prefs").json() == body
    assert leo.get("/api/me/prefs").json() == DEFAULTS


def test_topic_progress_counts_learned_cards_and_last_quiz(
    user_client: TestClient,
    user_id: str,
    seeded_cards: list[str],
    seeded_topics: list[str],
    db: sqlite3.Connection,
) -> None:
    put_state(db, user_id, seeded_cards[0], state=2)
    put_state(db, user_id, seeded_cards[1], state=2)
    put_state(db, user_id, seeded_cards[2], state=2, suspended=1)
    put_state(db, user_id, seeded_cards[3], state=1)

    response = user_client.get("/api/me/topic-progress", params={"course_id": DEMO_COURSE})
    assert response.status_code == 200, response.text
    progress = {entry["topic_id"]: entry for entry in response.json()}
    assert list(progress) == seeded_topics
    assert progress["tp_ui06_a"] == {
        "topic_id": "tp_ui06_a",
        "cards_total": 6,
        "cards_learned": 2,
        "last_quiz_score": 0.8,
    }
    assert progress["tp_ui06_b"] == {
        "topic_id": "tp_ui06_b",
        "cards_total": 0,
        "cards_learned": 0,
        "last_quiz_score": None,
    }


def test_topic_progress_is_per_user(
    two_users: tuple[Actor, Actor],
    seeded_cards: list[str],
    seeded_topics: list[str],
    db: sqlite3.Connection,
) -> None:
    """REVIEW FOCUS P09-10: el progreso por tema es el estado del usuario de la sesión."""
    ana, leo = two_users
    put_state(db, ana.user_id, seeded_cards[0], state=2)

    ana_progress = ana.get("/api/me/topic-progress", params={"course_id": DEMO_COURSE}).json()
    leo_progress = leo.get("/api/me/topic-progress", params={"course_id": DEMO_COURSE}).json()
    assert ana_progress[0]["cards_learned"] == 1
    assert leo_progress[0]["cards_learned"] == 0
    assert leo_progress[0]["last_quiz_score"] is None


def test_topic_progress_unknown_or_excluded_course_is_404(
    user_client: TestClient, db: sqlite3.Connection
) -> None:
    assert (
        user_client.get("/api/me/topic-progress", params={"course_id": "no-existe"}).status_code
        == 404
    )
    _insert_course(db, "ui06-not-included", included=0)
    response = user_client.get("/api/me/topic-progress", params={"course_id": "ui06-not-included"})
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert user_client.get("/api/me/topic-progress").status_code == 400


def test_upcoming_only_future_due_and_not_deleted(
    user_client: TestClient, seeded_items_with_due: list[str]
) -> None:
    response = user_client.get("/api/me/upcoming", params={"limit": 10})
    assert response.status_code == 200, response.text
    got = response.json()
    assert [item["id"] for item in got] == seeded_items_with_due
    assert [item["due_at"] for item in got] == [
        _ts(timedelta(days=1)),
        _ts(timedelta(days=3)),
    ]

    limited = user_client.get("/api/me/upcoming", params={"limit": 2})
    assert [item["id"] for item in limited.json()] == seeded_items_with_due


def test_upcoming_excludes_deleted_and_courses_not_included(
    user_client: TestClient, seeded_items_with_due: list[str]
) -> None:
    """REVIEW FOCUS de UI-06: ni ``deleted_at`` ni cursos con ``included = 0``."""
    ids = [item["id"] for item in user_client.get("/api/me/upcoming").json()]
    assert "cw_due_deleted" not in ids
    assert "cw_due_excluded" not in ids
    assert "cw_due_past" not in ids
    assert "cw_no_due" not in ids
    assert ids == seeded_items_with_due


def test_upcoming_limit_is_between_one_and_ten(user_client: TestClient) -> None:
    for limit in (0, 11):
        response = user_client.get("/api/me/upcoming", params={"limit": limit})
        assert response.status_code == 400
        assert response.json()["code"] == "bad_request"
