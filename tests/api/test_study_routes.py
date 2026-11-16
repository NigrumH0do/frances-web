"""API de estudio: temas, estado y admin de trabajos (AI-14).

Fixtures sintéticas construidas dentro del test (como AI-04): nada del Classroom.
La base se migra con ``make_api`` y las sesiones salen de ``tests.testkit.api``.
"""

import sqlite3
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.api.cards_repo import encode_cursor
from frances.db.store import Store
from frances.models.study import StudyJobKind
from frances.study.plan import ensure_today
from tests.testkit.api import create_user, login, make_api, session_client

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)
T0 = "2026-11-02T10:00:00Z"
STUDY_KINDS: tuple[StudyJobKind, ...] = (
    "index.text_blocks",
    "llm.sheet",
    "llm.topics",
    "llm.quiz",
    "plan.daily",
)


@dataclass(frozen=True)
class SeededApi:
    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection
    user_id: str


def _course(conn: sqlite3.Connection, course_id: str = "c_1") -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES (?, 'Français 1', 'ACTIVE', ?, '{}')",
        (course_id, T0),
    )


def _item(conn: sqlite3.Connection, item_id: str, *, course_id: str = "c_1") -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, ?, 'coursework', ?, ?, '', 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, course_id, item_id, f"Leçon {item_id}", T0, T0, f"{item_id}-h", T0, T0),
    )


def _card(
    conn: sqlite3.Connection,
    card_id: str,
    front_fr: str,
    *,
    owner: str | None = None,
    stale: int = 0,
    removed_at: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at, owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, 'palabra', 'rules', '1', ?, ?, ?, ?, ?)",
        (card_id, front_fr, stale, T0, T0, owner, removed_at),
    )


def _card_source(conn: sqlite3.Connection, card_id: str, item_id: str) -> None:
    conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (card_id, item_id))


def _topic(
    conn: sqlite3.Connection,
    topic_id: str,
    item_ids: Sequence[str],
    *,
    position: int,
    title: str = "Tema",
    removed_at: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, created_at, updated_at, removed_at)"
        " VALUES (?, 'c_1', ?, '', NULL, ?, 'rules', '1', 'h', ?, ?, ?)",
        (topic_id, title, position, T0, T0, removed_at),
    )
    for item_position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, item_position),
        )


def _job(conn: sqlite3.Connection, kind: str, state: str) -> None:
    conn.execute(
        "INSERT INTO jobs (kind, payload, state, attempts, max_attempts, run_after,"
        " created_at, updated_at) VALUES (?, '{}', ?, 0, 5, ?, ?, ?)",
        (kind, state, T0, T0, T0),
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
def admin_client(seeded_api: SeededApi) -> Iterator[TestClient]:
    create_user(seeded_api.conn, "admin@ex.org", role="admin")
    admin = session_client(seeded_api.client, "admin@ex.org")
    try:
        yield admin
    finally:
        admin.close()


@pytest.fixture
def seeded_topics(seeded_api: SeededApi) -> SeededApi:
    conn = seeded_api.conn
    for item_id in ("cw_1", "cw_2", "cw_3"):
        _item(conn, item_id)
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES ('u_other', 'other@example.test', 'Otra', 'x', 'user', ?)",
        (T0,),
    )
    _card(conn, "c_b", "b")
    _card(conn, "c_a", "a")
    _card(conn, "c_c", "c")
    _card(conn, "c_stale", "stale", stale=1)
    _card(conn, "c_removed", "removed", removed_at=T0)
    _card(conn, "c_private", "private", owner="u_other")
    for card_id in ("c_b", "c_a", "c_stale", "c_removed", "c_private"):
        _card_source(conn, card_id, "cw_1")
    _card_source(conn, "c_c", "cw_2")
    _topic(conn, "tp_1", ("cw_1", "cw_2"), position=0, title="Les bases")
    _topic(conn, "tp_2", ("cw_3",), position=1, title="Le voyage")
    _item(conn, "cw_removed")
    _topic(conn, "tp_removed", ("cw_removed",), position=2, title="Borrado", removed_at=T0)
    return seeded_api


@pytest.fixture
def queued_study_jobs(seeded_api: SeededApi) -> SeededApi:
    conn = seeded_api.conn
    _item(conn, "cw_status")
    _topic(conn, "tp_status", ("cw_status",), position=0, title="Estado")
    conn.execute(
        "INSERT INTO study_plan (user_id, day, position, kind, ref_id, title_es, reason_es,"
        " done_at, generated_at) VALUES (?, '2026-11-02', 0, 'read', 'cw_status',"
        " 'Leer', 'Sintético.', NULL, ?)",
        (seeded_api.user_id, T0),
    )
    conn.execute(
        "INSERT INTO usage_daily (day, meter, amount) VALUES ('2026-11-02', 'llm_calls', 7)"
    )
    _job(conn, "llm.topics", "queued")
    _job(conn, "llm.sheet", "running")
    _job(conn, "llm.quiz", "done")
    _job(conn, "plan.daily", "queued")
    _job(conn, "index.text_blocks", "failed")
    _job(conn, "pipeline.daily", "queued")
    return seeded_api


@pytest.fixture
def big_study_seed(seeded_api: SeededApi) -> str:
    conn = seeded_api.conn
    with conn:
        for n in range(40):
            _item(conn, f"big_i_{n}")
        for n in range(20):
            _topic(
                conn,
                f"big_t_{n}",
                (f"big_i_{2 * n}", f"big_i_{2 * n + 1}"),
                position=n,
                title=f"Tema {n}",
            )
        for n in range(1200):
            _card(conn, f"big_c_{n}", f"mot {n:04d}")
            _card_source(conn, f"big_c_{n}", f"big_i_{n % 40}")
        conn.execute(
            "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash,"
            " prompt_version, model, stale, created_at)"
            " VALUES ('qz_big', 'topic', 'big_t_0', 'Quiz grande', 'h', '1', 'm', 0, ?)",
            (T0,),
        )
        for position in range(4):
            conn.execute(
                "INSERT INTO questions (id, quiz_id, position, kind, prompt_es, prompt_fr,"
                " options_json, answer_json, explanation_es)"
                " VALUES (?, 'qz_big', ?, 'translate', 'Traduce', NULL, '[]', ?, NULL)",
                (f"q_big_{position}", position, '["mot"]'),
            )
    store = Store.connect(seeded_api.ctx.db_path)
    try:
        ensure_today(store, seeded_api.user_id, NOW)
    finally:
        store.close()
    return "qz_big"


def test_topics_and_topic_cards(user_client: TestClient, seeded_topics: SeededApi) -> None:
    topics = user_client.get("/api/topics", params={"course_id": "c_1"}).json()
    assert [topic["id"] for topic in topics] == ["tp_1", "tp_2"]
    assert topics[0]["card_count"] >= 2
    assert user_client.get("/api/topics/tp_removed").status_code == 404

    page = user_client.get("/api/topics/tp_1/cards", params={"limit": 2}).json()
    assert [card["id"] for card in page["cards"]] == ["c_a", "c_b"]
    assert page["next_cursor"]
    second = user_client.get(
        "/api/topics/tp_1/cards", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    assert [card["id"] for card in second["cards"]] == ["c_c"]
    assert second["next_cursor"] is None

    detail = user_client.get("/api/topics/tp_1")
    assert detail.status_code == 200 and detail.json()["title"] == "Les bases"
    assert user_client.get("/api/topics/tp_nope").status_code == 404
    assert user_client.get("/api/topics/tp_nope/cards").status_code == 404


def test_topic_cards_bad_cursor_is_400(user_client: TestClient, seeded_topics: SeededApi) -> None:
    response = user_client.get("/api/topics/tp_1/cards", params={"cursor": "%%%"})
    assert response.status_code == 400 and response.json()["code"] == "bad_request"
    missing = user_client.get("/api/topics/tp_1/cards", params={"cursor": encode_cursor("c_nope")})
    assert missing.status_code == 400


def test_study_status_counts_pending(user_client: TestClient, queued_study_jobs: SeededApi) -> None:
    response = user_client.get("/api/study/status")
    assert response.status_code == 200
    body = response.json()
    assert body["pending"] == {
        "index.text_blocks": 0,
        "llm.sheet": 1,
        "llm.topics": 1,
        "llm.quiz": 0,
        "plan.daily": 1,
    }
    assert set(body["pending"]) == set(STUDY_KINDS)
    assert body["llm_enabled"] is True
    assert body["llm_calls_today"] == 7
    assert body["llm_calls_cap"] == 300
    assert body["last_topics_at"] == T0
    assert body["last_plan_at"] == T0


def test_admin_study_run_dedupes_and_needs_admin(
    admin_client: TestClient, user_client: TestClient
) -> None:
    first = admin_client.post("/api/admin/study/run", json={"kind": "llm.topics"})
    second = admin_client.post("/api/admin/study/run", json={"kind": "llm.topics"})
    assert first.status_code == 202 and first.json()["id"] == second.json()["id"]
    assert first.json()["kind"] == "llm.topics" and first.json()["state"] == "queued"

    missing = admin_client.post(
        "/api/admin/study/run",
        json={"kind": "llm.quiz", "scope_kind": "topic", "scope_id": "tp_nope"},
    )
    assert missing.status_code == 404

    conn = sqlite3.connect(user_client.app.state.ctx.db_path, isolation_level=None)
    try:
        _item(conn, "cw_admin")
    finally:
        conn.close()
    scoped = admin_client.post(
        "/api/admin/study/run",
        json={"kind": "llm.quiz", "scope_kind": "item", "scope_id": "cw_admin"},
    )
    same_scope = admin_client.post(
        "/api/admin/study/run",
        json={"kind": "llm.quiz", "scope_kind": "item", "scope_id": "cw_admin"},
    )
    assert scoped.status_code == 202 and scoped.json()["id"] == same_scope.json()["id"]

    assert user_client.post("/api/admin/study/run", json={"kind": "llm.topics"}).status_code == 403


def test_reads_under_300ms(user_client: TestClient, big_study_seed: str) -> None:
    urls = (
        "/api/topics?course_id=c_1",
        f"/api/quizzes/{big_study_seed}",
        "/api/plan/today",
    )
    for url in urls:
        assert user_client.get(url).status_code == 200, url
    for url in urls:
        started = time.perf_counter()
        response = user_client.get(url)
        elapsed = time.perf_counter() - started
        assert response.status_code == 200, url
        assert elapsed < 0.3, f"{url} tardó {elapsed:.3f} s"
