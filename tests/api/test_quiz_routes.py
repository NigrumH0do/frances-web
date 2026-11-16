"""API de quizzes: vista sin respuestas, intentos y privacidad (AI-14).

Las preguntas se siembran directamente con ``answer_json`` canario para probar que
ninguna vista previa lo filtra. Todo el material es sintético.
"""

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from tests.testkit.api import (
    create_user,
    login,
    make_api,
    second_user_client,
)

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
T0 = "2026-11-02T10:00:00Z"
CANARY = "réponse-canari-7f3a"


@dataclass(frozen=True)
class SeededApi:
    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection
    user_id: str


@dataclass(frozen=True)
class SeededQuiz:
    id: str
    topic_id: str
    q_mcq: str
    mcq_right: str


@dataclass(frozen=True)
class SeededPendingQuiz:
    id: str
    q_dictation: str


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
        " VALUES (?, 'c_1', 'coursework', ?, 'Leçon', '', 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, T0, T0, f"{item_id}-h", T0, T0),
    )


def _topic(conn: sqlite3.Connection, topic_id: str, item_ids: list[str]) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, created_at, updated_at)"
        " VALUES (?, 'c_1', 'Tema', '', NULL, 0, 'rules', '1', 'h', ?, ?)",
        (topic_id, T0, T0),
    )
    for position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, position),
        )


def _quiz(
    conn: sqlite3.Connection,
    quiz_id: str,
    *,
    scope_kind: str,
    scope_id: str,
    stale: int = 0,
) -> None:
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash, prompt_version,"
        " model, stale, created_at) VALUES (?, ?, ?, 'Quiz de prueba', 'h', '1', 'm', ?, ?)",
        (quiz_id, scope_kind, scope_id, stale, T0),
    )


def _question(
    conn: sqlite3.Connection,
    question_id: str,
    quiz_id: str,
    position: int,
    *,
    kind: str = "mcq",
    options: list[str] | None = None,
    answers: list[str] | None = None,
    audio_key: str | None = None,
    block_id: int | None = None,
) -> None:
    conn.execute(
        "INSERT INTO questions (id, quiz_id, position, kind, prompt_es, prompt_fr,"
        " options_json, answer_json, explanation_es, audio_cache_key, source_block_id)"
        " VALUES (?, ?, ?, ?, 'Pregunta sintética', NULL, ?, ?, 'Explicación.', ?, ?)",
        (
            question_id,
            quiz_id,
            position,
            kind,
            json.dumps(options or [], ensure_ascii=False),
            json.dumps(answers or [CANARY], ensure_ascii=False),
            audio_key,
            block_id,
        ),
    )


def _audio(conn: sqlite3.Connection, key: str, status: str, *, duration_ms: int = 1200) -> None:
    conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, duration_ms, updated_at) VALUES (?, 'Il fait beau.', 'Il fait beau.',"
        " 'v_test', 'f', '1', ?, ?, ?)",
        (key, status, duration_ms, T0),
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
def seeded_quiz(seeded_api: SeededApi) -> SeededQuiz:
    conn = seeded_api.conn
    _item(conn, "cw_1")
    _topic(conn, "tp_1", ["cw_1"])
    conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at) VALUES ('cw_1', 'item', 1, 0, 'fr',"
        " 'Je mange une pomme.', 'item-1', ?)",
        (T0,),
    )
    block_id = conn.execute("SELECT id FROM text_blocks LIMIT 1").fetchone()[0]
    _quiz(conn, "qz_main", scope_kind="topic", scope_id="tp_1")
    _quiz(conn, "qz_stale", scope_kind="topic", scope_id="tp_1", stale=1)
    _question(
        conn,
        "q_mcq",
        "qz_main",
        0,
        options=["la manzana", "la pera", "la uva", "el kiwi"],
        answers=["la manzana", CANARY],
        block_id=block_id,
    )
    _question(
        conn,
        "q_cloze",
        "qz_main",
        1,
        kind="cloze",
        answers=["vais", CANARY],
        block_id=block_id,
    )
    return SeededQuiz(id="qz_main", topic_id="tp_1", q_mcq="q_mcq", mcq_right="la manzana")


@pytest.fixture
def seeded_quiz_pending_audio(seeded_api: SeededApi) -> SeededPendingQuiz:
    conn = seeded_api.conn
    _item(conn, "cw_audio")
    _audio(conn, "aud_pending", "pending")
    _quiz(conn, "qz_audio", scope_kind="item", scope_id="cw_audio")
    _question(
        conn,
        "q_mcq_audio",
        "qz_audio",
        0,
        options=["la manzana", "la pera"],
        answers=["la manzana", CANARY],
    )
    _question(
        conn,
        "q_dict",
        "qz_audio",
        1,
        kind="dictation",
        answers=["Il fait beau.", CANARY],
        audio_key="aud_pending",
    )
    return SeededPendingQuiz(id="qz_audio", q_dictation="q_dict")


@pytest.fixture
def two_users(seeded_api: SeededApi) -> Iterator[tuple[TestClient, TestClient]]:
    create_user(seeded_api.conn, "leo@ex.org")
    leo = second_user_client(seeded_api.client, "leo@ex.org")
    try:
        yield seeded_api.client, leo
    finally:
        leo.close()


def test_quiz_view_never_contains_answers(user_client: TestClient, seeded_quiz: SeededQuiz) -> None:
    for url in (
        f"/api/quizzes/{seeded_quiz.id}",
        f"/api/quizzes?scope_kind=topic&scope_id={seeded_quiz.topic_id}",
    ):
        response = user_client.get(url)
        assert response.status_code == 200, url
        body = response.text
        assert CANARY not in body
        assert "answer" not in json.dumps(json.loads(body)).replace("answers", "")


def test_quiz_list_hides_stale_but_detail_serves_it(
    user_client: TestClient, seeded_quiz: SeededQuiz
) -> None:
    listed = user_client.get(
        "/api/quizzes", params={"scope_kind": "topic", "scope_id": seeded_quiz.topic_id}
    ).json()
    assert [quiz["id"] for quiz in listed] == [seeded_quiz.id]
    stale = user_client.get("/api/quizzes/qz_stale")
    assert stale.status_code == 200
    assert stale.json()["stale"] is True


def test_attempt_is_graded_on_server_and_requires_csrf(
    user_client: TestClient, seeded_quiz: SeededQuiz
) -> None:
    payload = {
        "started_at": T0,
        "answers": [{"question_id": seeded_quiz.q_mcq, "answer": seeded_quiz.mcq_right}],
    }
    rejected = user_client.post(
        f"/api/quizzes/{seeded_quiz.id}/attempts",
        json=payload,
        headers={"X-CSRF-Token": ""},
    )
    assert rejected.status_code == 403

    response = user_client.post(f"/api/quizzes/{seeded_quiz.id}/attempts", json=payload)
    assert response.status_code == 201
    body = response.json()
    assert body["results"][0]["correct"] is True
    assert body["results"][0]["expected"] == seeded_quiz.mcq_right
    assert [
        a["attempt_id"] for a in user_client.get(f"/api/quizzes/{seeded_quiz.id}/attempts").json()
    ] == [body["attempt_id"]]


def test_attempts_are_private(
    two_users: tuple[TestClient, TestClient], seeded_quiz: SeededQuiz
) -> None:
    ana, leo = two_users
    payload = {
        "started_at": T0,
        "answers": [{"question_id": seeded_quiz.q_mcq, "answer": seeded_quiz.mcq_right}],
    }
    ana_attempt = ana.post(f"/api/quizzes/{seeded_quiz.id}/attempts", json=payload).json()
    assert leo.get(f"/api/quizzes/{seeded_quiz.id}/attempts").json() == []

    leo_attempt = leo.post(f"/api/quizzes/{seeded_quiz.id}/attempts", json=payload).json()
    ana_ids = {
        row["attempt_id"] for row in ana.get(f"/api/quizzes/{seeded_quiz.id}/attempts").json()
    }
    leo_ids = {
        row["attempt_id"] for row in leo.get(f"/api/quizzes/{seeded_quiz.id}/attempts").json()
    }
    assert ana_ids == {ana_attempt["attempt_id"]}
    assert leo_ids == {leo_attempt["attempt_id"]}
    assert ana_ids.isdisjoint(leo_ids)


def test_dictation_without_done_audio_is_hidden(
    user_client: TestClient, seeded_quiz_pending_audio: SeededPendingQuiz
) -> None:
    quiz_id = seeded_quiz_pending_audio.id
    hidden = user_client.get(f"/api/quizzes/{quiz_id}")
    assert hidden.status_code == 200
    assert seeded_quiz_pending_audio.q_dictation not in {
        question["id"] for question in hidden.json()["questions"]
    }
    rejected = user_client.post(
        f"/api/quizzes/{quiz_id}/attempts",
        json={
            "started_at": T0,
            "answers": [{"question_id": seeded_quiz_pending_audio.q_dictation, "answer": "x"}],
        },
    )
    assert rejected.status_code == 400

    seeded_quiz_pending_audio_conn = user_client.app.state.ctx.db_path
    conn = sqlite3.connect(seeded_quiz_pending_audio_conn, isolation_level=None)
    try:
        conn.execute("UPDATE audio SET status = 'done' WHERE cache_key = 'aud_pending'")
    finally:
        conn.close()

    shown = user_client.get(f"/api/quizzes/{quiz_id}").json()
    dictation = next(
        question
        for question in shown["questions"]
        if question["id"] == seeded_quiz_pending_audio.q_dictation
    )
    assert dictation["audio"] == {
        "field": "front",
        "voice_id": "v_test",
        "url": "/api/audio/aud_pending",
        "duration_ms": 1200,
    }
    assert dictation["source_item_id"] is None


def test_quiz_routes_require_session(seeded_api: SeededApi) -> None:
    anon = TestClient(seeded_api.client.app, base_url="https://testserver")
    try:
        assert anon.get("/api/quizzes/qz_main").status_code == 401
        assert anon.post("/api/quizzes/qz_main/attempts", json={}).status_code == 401
    finally:
        anon.close()


def test_missing_quiz_and_scope_kind_are_handled(
    user_client: TestClient, seeded_quiz: SeededQuiz
) -> None:
    assert user_client.get("/api/quizzes/qz_nope").status_code == 404
    assert (
        user_client.post(
            "/api/quizzes/qz_nope/attempts",
            json={
                "started_at": T0,
                "answers": [{"question_id": "q_x", "answer": "x"}],
            },
        ).status_code
        == 404
    )
    bad_scope = user_client.get("/api/quizzes", params={"scope_kind": "otro", "scope_id": "x"})
    assert bad_scope.status_code == 400


def test_attempt_with_foreign_question_is_bad_request(
    user_client: TestClient, seeded_quiz: SeededQuiz
) -> None:
    response = user_client.post(
        f"/api/quizzes/{seeded_quiz.id}/attempts",
        json={
            "started_at": T0,
            "answers": [{"question_id": "q_foreign", "answer": "x"}],
        },
    )
    assert response.status_code == 400
    assert user_client.get(f"/api/quizzes/{seeded_quiz.id}/attempts").json() == []
