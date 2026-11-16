"""Persistencia de hilos y mensajes del chat (AI-12)."""

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from frances.db.store import Store
from frances.models.study import Citation
from frances.study.chat_repo import (
    DEFAULT_TITLE,
    add_message,
    create_thread,
    get_thread,
    get_thread_detail,
    list_threads,
    recent_history,
    soft_delete_thread,
    title_if_default,
)
from frances.timeutil import format_ts

_NOW = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)
_T0 = format_ts(_NOW)
_T1 = format_ts(_NOW.replace(minute=10))
_T2 = format_ts(_NOW.replace(minute=20))


def _user(conn: Any, user_id: str = "u_1") -> None:
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES (?, ?, 'Prueba', 'hash-sintetico', 'user', ?)",
        (user_id, f"{user_id}@example.test", _T0),
    )


def _citation(block_id: int = 1) -> Citation:
    return Citation(
        item_id="cw_1",
        source="item",
        page=None,
        block_id=block_id,
        snippet="La pomme est un fruit.",
    )


def _message(
    conn: Any,
    thread_id: str,
    role: str,
    content: str,
    *,
    status: str = "ok",
    citations: list[Citation] | None = None,
    now: str = _T0,
) -> int:
    return add_message(
        conn,
        thread_id,
        role=role,  # type: ignore[arg-type]
        content=content,
        citations=citations or [],
        status=status,  # type: ignore[arg-type]
        model="m" if role == "assistant" else None,
        prompt_version="chat-1" if role == "assistant" else None,
        now=now,
    )


def test_create_thread_uses_default_title_and_distinct_ids(store: Store) -> None:
    _user(store.conn)
    first = create_thread(store.conn, "u_1", _NOW)
    second = create_thread(store.conn, "u_1", _NOW)

    assert first.title == DEFAULT_TITLE and second.title == DEFAULT_TITLE
    assert first.id.startswith("th_") and second.id.startswith("th_")
    assert first.id != second.id
    assert (first.created_at, first.updated_at) == (_T0, _T0)


def test_list_threads_is_per_user_and_updated_at_desc(store: Store) -> None:
    _user(store.conn)
    _user(store.conn, "u_2")
    old = create_thread(store.conn, "u_1", _NOW)
    new = create_thread(store.conn, "u_1", _NOW)
    other = create_thread(store.conn, "u_2", _NOW)
    _message(store.conn, old.id, "user", "primera", now=_T2)

    assert [thread.id for thread in list_threads(store.conn, "u_1")] == [old.id, new.id]
    assert [thread.id for thread in list_threads(store.conn, "u_2")] == [other.id]
    assert list_threads(store.conn, "u_3") == []


def test_get_thread_hides_other_users_and_deleted_threads(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)

    assert get_thread(store.conn, "u_1", thread.id) == thread
    assert get_thread(store.conn, "u_2", thread.id) is None
    assert soft_delete_thread(store.conn, "u_2", thread.id, _NOW) is False
    assert soft_delete_thread(store.conn, "u_1", thread.id, _NOW) is True
    assert get_thread(store.conn, "u_1", thread.id) is None
    assert soft_delete_thread(store.conn, "u_1", thread.id, _NOW) is False
    row = store.conn.execute(
        "SELECT deleted_at FROM chat_threads WHERE id = ?", (thread.id,)
    ).fetchone()
    assert row == (_T0,)


def test_get_thread_detail_keeps_message_order_and_citations(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    user_id = _message(store.conn, thread.id, "user", "¿Qué es la pomme?")
    assistant_id = _message(
        store.conn,
        thread.id,
        "assistant",
        "Es la manzana [1].",
        citations=[_citation(7), _citation(9)],
    )

    detail = get_thread_detail(store.conn, "u_1", thread.id)

    assert detail is not None and detail.thread == thread
    assert [message.id for message in detail.messages] == [user_id, assistant_id]
    assert [message.role for message in detail.messages] == ["user", "assistant"]
    assert detail.messages[1].citations == [_citation(7), _citation(9)]
    assert get_thread_detail(store.conn, "u_2", thread.id) is None


def test_add_message_updates_the_thread_timestamp(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    _message(store.conn, thread.id, "user", "hola", now=_T1)

    row = store.conn.execute(
        "SELECT updated_at FROM chat_threads WHERE id = ?", (thread.id,)
    ).fetchone()
    assert row == (_T1,)


def test_title_if_default_uses_the_first_question(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    question = "¿Qué diferencia hay entre la pomme y la poire en esta lección?"
    title_if_default(store.conn, thread.id, question)
    title_if_default(store.conn, thread.id, "Otra pregunta distinta")

    row = store.conn.execute("SELECT title FROM chat_threads WHERE id = ?", (thread.id,)).fetchone()
    assert row == (question[:60],)


def test_recent_history_returns_last_complete_ok_or_partial_turns(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    _message(store.conn, thread.id, "user", "q1", citations=[])
    _message(store.conn, thread.id, "assistant", "a1", citations=[_citation()])
    _message(store.conn, thread.id, "user", "q2")
    _message(store.conn, thread.id, "assistant", "a2", status="no_material")
    _message(store.conn, thread.id, "user", "q3")
    _message(store.conn, thread.id, "assistant", "a3", status="partial", citations=[_citation(3)])
    _message(store.conn, thread.id, "user", "q4")

    assert recent_history(store.conn, thread.id, 2) == [
        ("user", "q1"),
        ("assistant", "a1"),
        ("user", "q3"),
        ("assistant", "a3"),
    ]
    assert recent_history(store.conn, thread.id, 1) == [("user", "q3"), ("assistant", "a3")]
    assert recent_history(store.conn, thread.id, 0) == []


def test_citations_are_stored_as_json_objects(store: Store) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    _message(store.conn, thread.id, "assistant", "Es la manzana [1].", citations=[_citation(7)])

    row = store.conn.execute("SELECT citations_json FROM chat_messages").fetchone()
    assert row is not None
    assert json.loads(row[0]) == [_citation(7).model_dump(mode="json")]


@pytest.mark.parametrize("turns", [0, 1, 3])
def test_recent_history_with_empty_thread(store: Store, turns: int) -> None:
    _user(store.conn)
    thread = create_thread(store.conn, "u_1", _NOW)
    assert recent_history(store.conn, thread.id, turns) == []
