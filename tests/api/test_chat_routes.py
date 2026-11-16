"""API del chat (AI-15): hilos por usuario y SSE por POST con una pregunta en curso."""

import json
import sqlite3
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.db.store import Store
from frances.study.prompts import NO_MATERIAL_TEXT
from tests.testkit.api import create_user, login, make_api, second_user_client

_NOW = "2026-11-03T01:00:00Z"


@dataclass
class ChatSeed:
    """App migrada, material indexado y dos cuentas sintéticas."""

    client: TestClient
    ctx: ApiContext


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
        (_NOW,),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES ('cw_1', 'c_1', 'coursework', 'cw_1', 'Leçon 1',"
        " 'La pomme est un fruit.', 'PUBLISHED', ?, ?, 'cw_1-h', '{}', ?, ?)",
        (_NOW, _NOW, _NOW, _NOW),
    )
    conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at) VALUES ('cw_1', 'item', 1, 0, 'fr',"
        " 'La pomme est un fruit. «La pomme» se mange crue.', 'item-1', ?)",
        (_NOW,),
    )
    create_user(conn, "ana@ex.org")
    create_user(conn, "leo@ex.org")


@pytest.fixture
def chat_seed(tmp_path: Path) -> Iterator[ChatSeed]:
    client, ctx = make_api(tmp_path)
    store = Store.connect(ctx.db_path)
    try:
        _seed(store.conn)
    finally:
        store.close()
    login(client, "ana@ex.org")
    yield ChatSeed(client=client, ctx=ctx)
    client.close()


@pytest.fixture
def user_client(chat_seed: ChatSeed) -> TestClient:
    return chat_seed.client


@pytest.fixture
def two_users(chat_seed: ChatSeed) -> Iterator[tuple[TestClient, TestClient]]:
    leo = second_user_client(chat_seed.client, "leo@ex.org")
    try:
        yield chat_seed.client, leo
    finally:
        leo.close()


@pytest.fixture
def user_client_llm_off(chat_seed: ChatSeed, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(chat_seed.ctx.settings.llm, "mode", "off")
    return chat_seed.client


class FakeChatLlm:
    """`stream_chat` emite los trozos de una respuesta y avisa cuando se cierra."""

    model = "fake-chat"

    def __init__(self, tokens: list[str]) -> None:
        self.tokens = list(tokens)
        self.calls = 0
        self.closed = threading.Event()

    def stream_chat(self, messages: list[dict[str, str]], **_: Any) -> Iterator[str]:
        self.calls += 1
        try:
            yield from self.tokens
        finally:
            self.closed.set()


class SlowChatLlm(FakeChatLlm):
    """Espera un `threading.Event` antes del primer token (sin bucles de espera)."""

    model = "slow-chat"

    def __init__(self, tokens: list[str] | None = None) -> None:
        super().__init__(tokens if tokens is not None else ["La pomme est un fruit [1]."])
        self.gate = threading.Event()
        self.started = threading.Event()

    def release(self) -> None:
        self.gate.set()

    def stream_chat(self, messages: list[dict[str, str]], **kwargs: Any) -> Iterator[str]:
        self.calls += 1
        self.started.set()
        try:
            if not self.gate.wait(timeout=10):
                raise AssertionError("el test no liberó el LLM lento")
            yield from self.tokens
        finally:
            self.closed.set()


@pytest.fixture
def fake_chat_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[list[str]], FakeChatLlm]:
    def install(tokens: list[str]) -> FakeChatLlm:
        from frances.api.routes import chat as chat_routes

        fake = FakeChatLlm(tokens)
        monkeypatch.setattr(chat_routes, "study_llm_for", lambda *args, **kwargs: fake)
        return fake

    return install


@pytest.fixture
def slow_chat_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[SlowChatLlm]:
    from frances.api.routes import chat as chat_routes

    fake = SlowChatLlm()
    monkeypatch.setattr(chat_routes, "study_llm_for", lambda *args, **kwargs: fake)
    try:
        yield fake
    finally:
        fake.release()


def read_sse(response: httpx.Response) -> list[tuple[str, dict[str, Any]]]:
    """Pares `(event, data)`; ignora comentarios `: ping`."""
    out: list[tuple[str, dict[str, Any]]] = []
    event: str | None = None
    for line in response.iter_lines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            out.append((event or "message", json.loads(line[6:])))
    return out


def _new_thread(client: TestClient) -> str:
    response = client.post("/api/chat/threads")
    assert response.status_code == 201
    return str(response.json()["id"])


def test_thread_crud_lists_only_live_threads(user_client: TestClient) -> None:
    assert user_client.get("/api/chat/threads").json() == []

    thread = user_client.post("/api/chat/threads")
    assert thread.status_code == 201
    created = thread.json()
    assert set(created) == {"id", "title", "created_at", "updated_at"}

    assert user_client.get("/api/chat/threads").json() == [created]
    detail = user_client.get(f"/api/chat/threads/{created['id']}")
    assert detail.status_code == 200
    assert detail.json() == {"thread": created, "messages": []}

    assert user_client.delete(f"/api/chat/threads/{created['id']}").status_code == 204
    assert user_client.get("/api/chat/threads").json() == []
    assert user_client.get(f"/api/chat/threads/{created['id']}").status_code == 404
    assert user_client.delete(f"/api/chat/threads/{created['id']}").status_code == 404


def test_sse_stream_order_headers_and_persisted(
    user_client: TestClient, chat_seed: ChatSeed, fake_chat_llm: Callable[[list[str]], FakeChatLlm]
) -> None:
    fake_chat_llm(["«La pomme» es la manzana [1]."])
    thread_id = _new_thread(user_client)

    with user_client.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "¿Qué es la pomme?"},
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-accel-buffering"] == "no"
        events = read_sse(response)

    assert [kind for kind, _ in events] == ["meta", "token", "citation", "done"]
    assert events[0][1]["message_id"] > 0
    assert events[-1][1]["message_id"] > events[0][1]["message_id"]
    assert events[2][1]["citation"]["item_id"] == "cw_1"

    detail = user_client.get(f"/api/chat/threads/{thread_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][0]["content"] == "¿Qué es la pomme?"
    assert detail["messages"][1]["content"] == "«La pomme» es la manzana [1]."
    assert detail["messages"][1]["citations"]


def test_other_user_thread_is_404(
    two_users: tuple[TestClient, TestClient], chat_seed: ChatSeed
) -> None:
    ana, leo = two_users
    thread_id = _new_thread(ana)

    assert leo.get("/api/chat/threads").json() == []
    assert leo.get(f"/api/chat/threads/{thread_id}").status_code == 404
    assert (
        leo.post(f"/api/chat/threads/{thread_id}/messages", json={"question": "hola"}).status_code
        == 404
    )
    assert leo.delete(f"/api/chat/threads/{thread_id}").status_code == 404
    assert ana.get(f"/api/chat/threads/{thread_id}").json()["messages"] == []


def test_post_requires_valid_csrf(user_client: TestClient) -> None:
    thread_id = _new_thread(user_client)
    response = user_client.post(
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "x"},
        headers={"X-CSRF-Token": "mal"},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf"


def test_second_question_in_flight_is_429(
    user_client: TestClient, chat_seed: ChatSeed, slow_chat_llm: SlowChatLlm
) -> None:
    thread_id = _new_thread(user_client)
    other = second_user_client(user_client, "ana@ex.org")
    try:
        with user_client.stream(
            "POST",
            f"/api/chat/threads/{thread_id}/messages",
            json={"question": "la pomme"},
        ) as response:
            assert response.status_code == 200
            lines = response.iter_lines()
            assert next(lines) == "event: meta"
            assert next(lines).startswith("data: ")

            second = other.post(
                f"/api/chat/threads/{thread_id}/messages", json={"question": "otra"}
            )
            assert second.status_code == 429
            assert second.json()["code"] == "rate_limited"
    finally:
        slow_chat_llm.release()
        other.close()


def test_ping_comment_while_waiting(
    user_client: TestClient,
    chat_seed: ChatSeed,
    slow_chat_llm: SlowChatLlm,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from frances.api.routes import chat as chat_routes

    monkeypatch.setattr(chat_routes, "PING_S", 0.01)
    thread_id = _new_thread(user_client)
    try:
        with user_client.stream(
            "POST",
            f"/api/chat/threads/{thread_id}/messages",
            json={"question": "la pomme"},
        ) as response:
            assert response.status_code == 200
            assert any(line.startswith(": ping") for line in response.iter_lines())
    finally:
        slow_chat_llm.release()


def test_no_material_and_llm_off(user_client_llm_off: TestClient, chat_seed: ChatSeed) -> None:
    thread_id = _new_thread(user_client_llm_off)

    with user_client_llm_off.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "¿Quién ganó el mundial?"},
    ) as response:
        no_material = read_sse(response)
    assert [kind for kind, _ in no_material] == ["meta", "token", "done"]
    assert no_material[1][1]["text"] == NO_MATERIAL_TEXT
    assert no_material[2][1]["code"] == "no_material"

    with user_client_llm_off.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "la pomme"},
    ) as response:
        unavailable = read_sse(response)
    assert [kind for kind, _ in unavailable] == ["meta", "error"]
    assert unavailable[-1][1]["code"] == "llm_unavailable"


def test_inflight_lock_released_when_client_disconnects(
    user_client: TestClient,
    chat_seed: ChatSeed,
    slow_chat_llm: SlowChatLlm,
    fake_chat_llm: Callable[[list[str]], FakeChatLlm],
) -> None:
    """REVIEW FOCUS P10-8: el corte del cliente no deja la pregunta en curso colgada."""
    thread_id = _new_thread(user_client)

    with user_client.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "la pomme"},
    ) as response:
        assert response.status_code == 200
        lines = response.iter_lines()
        assert next(lines) == "event: meta"
        assert next(lines).startswith("data: ")
        # El worker ya está esperando el primer token del LLM.
        assert slow_chat_llm.started.wait(timeout=5)
        # Se sale sin consumir el resto: el cliente corta la conexión.

    # La cancelación no deja un assistant vacío con citas de respaldo.
    detail = user_client.get(f"/api/chat/threads/{thread_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user"]
    assert all(message["content"] for message in detail["messages"])

    # La segunda pregunta entra mientras el primer LLM sigue bloqueado.
    fake_chat_llm(["La pomme est un fruit [1]."])
    with user_client.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "la pomme"},
    ) as response:
        assert response.status_code == 200
        assert [kind for kind, _ in read_sse(response)] == [
            "meta",
            "token",
            "citation",
            "done",
        ]
    assert not slow_chat_llm.closed.is_set()

    slow_chat_llm.release()
    assert slow_chat_llm.closed.wait(timeout=5)

    detail = user_client.get(f"/api/chat/threads/{thread_id}").json()
    assert [message["role"] for message in detail["messages"]] == [
        "user",
        "user",
        "assistant",
    ]
    assert all(message["content"] for message in detail["messages"])


def _join_chat_workers(timeout: float = 5.0) -> None:
    """Espera a que terminen los hilos de trabajo del chat, si siguen vivos."""
    for worker in threading.enumerate():
        if worker.name == "frances-chat-sse" and worker.is_alive():
            worker.join(timeout)
            assert not worker.is_alive()


def test_cancelled_empty_llm_persists_only_user_message(
    user_client: TestClient,
    chat_seed: ChatSeed,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Un LLM que termina vacío tras el corte no deja un assistant fallback."""
    from frances.api.routes import chat as chat_routes

    fake = SlowChatLlm(tokens=[])
    monkeypatch.setattr(chat_routes, "study_llm_for", lambda *args, **kwargs: fake)
    thread_id = _new_thread(user_client)

    with user_client.stream(
        "POST",
        f"/api/chat/threads/{thread_id}/messages",
        json={"question": "la pomme"},
    ) as response:
        assert response.status_code == 200
        lines = response.iter_lines()
        assert next(lines) == "event: meta"
        assert next(lines).startswith("data: ")
        assert fake.started.wait(timeout=5)
        # Se sale sin consumir el resto: el cliente corta la conexión.

    fake.release()
    assert fake.closed.wait(timeout=5)
    _join_chat_workers()

    detail = user_client.get(f"/api/chat/threads/{thread_id}").json()
    assert [message["role"] for message in detail["messages"]] == ["user"]
    assert all(message["content"] for message in detail["messages"])


def test_old_request_release_does_not_clear_new_reservation() -> None:
    """El finally atrasado de una petición vieja no borra la reserva nueva."""
    from frances.api.routes import chat as chat_routes

    user_id = "u_reservation_race"
    first = chat_routes._reserve(user_id)
    assert first is not None
    chat_routes._release(first)
    second = chat_routes._reserve(user_id)
    assert second is not None

    chat_routes._release(first)
    try:
        assert chat_routes._reserve(user_id) is None
    finally:
        chat_routes._release(second)


def test_empty_or_too_long_question_is_400(user_client: TestClient, chat_seed: ChatSeed) -> None:
    thread_id = _new_thread(user_client)
    for question in ("", "   ", "x" * 2001):
        response = user_client.post(
            f"/api/chat/threads/{thread_id}/messages", json={"question": question}
        )
        assert response.status_code == 400
        assert response.json()["code"] == "bad_request"
