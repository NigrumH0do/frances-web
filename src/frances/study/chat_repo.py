"""SQL de los hilos y mensajes del chat (AI-12).

Todo el SQL de ``chat_threads`` y ``chat_messages`` vive aquí. Los mensajes
guardan las citas como JSON y cada escritura actualiza ``updated_at`` del hilo.
"""

import json
import sqlite3
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal, cast

from frances.models.ids import new_thread_id
from frances.models.study import ChatMessageOut, ChatThreadDetail, ChatThreadOut, Citation
from frances.timeutil import format_ts

DEFAULT_TITLE = "Nueva conversación"

MessageRole = Literal["user", "assistant"]
MessageStatus = Literal["ok", "no_material", "error", "partial"]


def _thread_out(row: tuple[Any, ...]) -> ChatThreadOut:
    return ChatThreadOut(
        id=str(row[0]),
        title=str(row[1]),
        created_at=str(row[2]),
        updated_at=str(row[3]),
    )


def create_thread(conn: sqlite3.Connection, user_id: str, now: datetime) -> ChatThreadOut:
    """Crea un hilo vacío con el título por defecto."""
    thread_id = new_thread_id()
    stamp = format_ts(now)
    conn.execute(
        "INSERT INTO chat_threads (id, user_id, title, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (thread_id, user_id, DEFAULT_TITLE, stamp, stamp),
    )
    return ChatThreadOut(id=thread_id, title=DEFAULT_TITLE, created_at=stamp, updated_at=stamp)


def list_threads(conn: sqlite3.Connection, user_id: str) -> list[ChatThreadOut]:
    """Hilos vivos del usuario, el más reciente primero."""
    rows = conn.execute(
        "SELECT id, title, created_at, updated_at FROM chat_threads"
        " WHERE user_id = ? AND deleted_at IS NULL"
        " ORDER BY updated_at DESC, id DESC",
        (user_id,),
    ).fetchall()
    return [_thread_out(row) for row in rows]


def get_thread(conn: sqlite3.Connection, user_id: str, thread_id: str) -> ChatThreadOut | None:
    """Hilo del usuario, o ``None`` si no existe, es ajeno o está borrado."""
    row = conn.execute(
        "SELECT id, title, created_at, updated_at FROM chat_threads"
        " WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        (thread_id, user_id),
    ).fetchone()
    return None if row is None else _thread_out(row)


def get_thread_detail(
    conn: sqlite3.Connection, user_id: str, thread_id: str
) -> ChatThreadDetail | None:
    """Hilo y sus mensajes en orden; ``None`` si no es del usuario."""
    thread = get_thread(conn, user_id, thread_id)
    if thread is None:
        return None
    rows = conn.execute(
        "SELECT id, role, content, citations_json, status, created_at"
        " FROM chat_messages WHERE thread_id = ? ORDER BY id",
        (thread_id,),
    ).fetchall()
    messages = [
        ChatMessageOut(
            id=int(row[0]),
            role=cast(MessageRole, str(row[1])),
            content=str(row[2]),
            citations=[Citation.model_validate(item) for item in json.loads(str(row[3]))],
            status=cast(MessageStatus, str(row[4])),
            created_at=str(row[5]),
        )
        for row in rows
    ]
    return ChatThreadDetail(thread=thread, messages=messages)


def soft_delete_thread(
    conn: sqlite3.Connection, user_id: str, thread_id: str, now: datetime
) -> bool:
    """Marca ``deleted_at``; ``False`` si no era un hilo vivo del usuario."""
    cursor = conn.execute(
        "UPDATE chat_threads SET deleted_at = ?"
        " WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        (format_ts(now), thread_id, user_id),
    )
    return cursor.rowcount > 0


def add_message(
    conn: sqlite3.Connection,
    thread_id: str,
    *,
    role: MessageRole,
    content: str,
    citations: Sequence[Citation],
    status: MessageStatus,
    model: str | None,
    prompt_version: str | None,
    now: str,
) -> int:
    """Guarda un mensaje, actualiza el hilo y devuelve el id del mensaje."""
    citations_json = json.dumps(
        [citation.model_dump(mode="json") for citation in citations],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    cursor = conn.execute(
        "INSERT INTO chat_messages (thread_id, role, content, citations_json, status,"
        " model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (thread_id, role, content, citations_json, status, model, prompt_version, now),
    )
    conn.execute("UPDATE chat_threads SET updated_at = ? WHERE id = ?", (now, thread_id))
    if cursor.lastrowid is None:  # pragma: no cover - SQLite siempre lo devuelve
        raise RuntimeError("SQLite no devolvió el id del mensaje")
    return int(cursor.lastrowid)


def recent_history(conn: sqlite3.Connection, thread_id: str, turns: int) -> list[tuple[str, str]]:
    """Pares ``(pregunta, respuesta)`` de los últimos ``turns`` turnos completos.

    Solo cuentan las respuestas ``ok`` y ``partial``; una pregunta sin respuesta
    (el turno en curso) no entra. Se devuelven en orden cronológico.
    """
    if turns <= 0:
        return []
    rows = conn.execute(
        "SELECT role, content, status FROM chat_messages WHERE thread_id = ? ORDER BY id",
        (thread_id,),
    ).fetchall()
    pairs: list[tuple[str, str]] = []
    pending: str | None = None
    for role, content, status in rows:
        role_s, content_s, status_s = str(role), str(content), str(status)
        if role_s == "user":
            pending = content_s
            continue
        if pending is not None and status_s in ("ok", "partial"):
            pairs.append((pending, content_s))
        pending = None
    history: list[tuple[str, str]] = []
    for question, answer in pairs[-turns:]:
        history.append(("user", question))
        history.append(("assistant", answer))
    return history


def title_if_default(conn: sqlite3.Connection, thread_id: str, question: str) -> None:
    """Pone los primeros 60 caracteres de la primera pregunta como título."""
    clean = question.strip()
    if not clean:
        return
    conn.execute(
        "UPDATE chat_threads SET title = ? WHERE id = ? AND title = ?",
        (clean[:60], thread_id, DEFAULT_TITLE),
    )
