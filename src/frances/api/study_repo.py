"""Consultas de la API de estudio: quizzes, tarjetas por tema, intentos y estado (AI-14).

Las respuestas nunca incluyen ``answer_json``: ``Question`` no tiene campo para la
respuesta y solo ``grade_attempt`` (AI-09) lee las respuestas en el servidor. Las
tarjetas de un tema siguen las mismas reglas de visibilidad que ``/api/cards``.
"""

import sqlite3
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal, cast

from frances.api.cards_repo import decode_cursor, encode_cursor
from frances.config import Settings
from frances.models.api import AudioClip
from frances.models.study import (
    Question,
    Quiz,
    QuizAttemptOut,
    StudyJobKind,
    StudyStatus,
)
from frances.study.client import llm_calls_today
from frances.study.grading import visible_questions
from frances.textnorm import norm_key

QuizScopeKind = Literal["topic", "item"]

#: Las cinco claves de ``StudyStatus.pending``; siempre presentes, también en cero.
STUDY_JOB_KINDS: tuple[StudyJobKind, ...] = (
    "index.text_blocks",
    "llm.sheet",
    "llm.topics",
    "llm.quiz",
    "plan.daily",
)


def quiz_view(conn: sqlite3.Connection, quiz_id: str) -> Quiz | None:
    """Quiz con sus preguntas visibles (sin respuestas), o ``None`` si no existe."""
    row = conn.execute(
        "SELECT id, scope_kind, scope_id, title_es, stale FROM quizzes WHERE id = ?",
        (quiz_id,),
    ).fetchone()
    if row is None:
        return None
    return _quiz_from_row(conn, cast("tuple[Any, ...]", row))


def list_quizzes(conn: sqlite3.Connection, scope_kind: QuizScopeKind, scope_id: str) -> list[Quiz]:
    """Quizzes vigentes del alcance, el más nuevo primero."""
    rows = conn.execute(
        "SELECT id, scope_kind, scope_id, title_es, stale FROM quizzes"
        " WHERE scope_kind = ? AND scope_id = ? AND stale = 0"
        " ORDER BY created_at DESC, id DESC",
        (scope_kind, scope_id),
    ).fetchall()
    return [_quiz_from_row(conn, cast("tuple[Any, ...]", row)) for row in rows]


def topic_card_ids(
    conn: sqlite3.Connection,
    user_id: str,
    topic_id: str,
    cursor: str | None,
    limit: int,
) -> tuple[list[str], str | None]:
    """Ids de tarjetas visibles del tema, orden ``(front_fr normalizado, id)``.

    El cursor opaco lleva el id de la última tarjeta; su posición se reconstruye
    con la misma clave normalizada que usa el orden. Cursor inválido → ``ValueError``.
    """
    if limit < 1:
        raise ValueError("limit debe ser >= 1")
    conn.create_function("frances_norm_key", 1, norm_key)
    where = [
        "sti.topic_id = ?",
        "i.deleted_at IS NULL",
        "(c.owner_user_id IS NULL OR c.owner_user_id = ?)",
        "c.removed_at IS NULL",
        "c.stale = 0",
    ]
    params: list[object] = [topic_id, user_id]
    if cursor is not None:
        anchor = decode_cursor(cursor)
        row = conn.execute(
            "SELECT frances_norm_key(front_fr) FROM cards WHERE id = ?", (anchor,)
        ).fetchone()
        if row is None:
            raise ValueError("cursor inválido")
        anchor_key = str(row[0])
        where.append(
            "(frances_norm_key(c.front_fr) > ? OR (frances_norm_key(c.front_fr) = ? AND c.id > ?))"
        )
        params.extend((anchor_key, anchor_key, anchor))
    sql = (
        "SELECT DISTINCT c.id, frances_norm_key(c.front_fr) AS front_key"
        " FROM cards c"
        " JOIN card_sources cs ON cs.card_id = c.id"
        " JOIN study_topic_items sti ON sti.item_id = cs.item_id"
        " JOIN items i ON i.id = sti.item_id"
        f" WHERE {' AND '.join(where)}"
        " ORDER BY front_key, c.id LIMIT ?"
    )
    rows = conn.execute(sql, [*params, limit + 1]).fetchall()
    ids = [str(row[0]) for row in rows[:limit]]
    next_cursor = encode_cursor(ids[-1]) if len(rows) > limit and ids else None
    return ids, next_cursor


def list_attempts(conn: sqlite3.Connection, user_id: str, quiz_id: str) -> list[QuizAttemptOut]:
    """Intentos del usuario en ese quiz, el más nuevo primero. Nunca los de otro."""
    rows = conn.execute(
        "SELECT id, quiz_id, score, started_at, finished_at FROM quiz_attempts"
        " WHERE user_id = ? AND quiz_id = ? ORDER BY id DESC",
        (user_id, quiz_id),
    ).fetchall()
    return [
        QuizAttemptOut(
            attempt_id=int(row[0]),
            quiz_id=str(row[1]),
            score=float(row[2]),
            started_at=str(row[3]),
            finished_at=str(row[4]),
        )
        for row in rows
    ]


def study_status(conn: sqlite3.Connection, settings: Settings, now: datetime) -> StudyStatus:
    """Estado global de la capa de estudio: presupuesto, trabajos pendientes y fechas."""
    pending: dict[StudyJobKind, int] = {kind: 0 for kind in STUDY_JOB_KINDS}
    marks = ",".join("?" for _ in STUDY_JOB_KINDS)
    for kind, total in conn.execute(
        "SELECT kind, COUNT(*) FROM jobs WHERE state IN ('queued', 'running')"
        f" AND kind IN ({marks}) GROUP BY kind",
        STUDY_JOB_KINDS,
    ):
        key = cast("StudyJobKind", str(kind))
        if key in pending:
            pending[key] = int(total)
    last_topics_at = conn.execute("SELECT MAX(created_at) FROM study_topics").fetchone()[0]
    last_plan_at = conn.execute("SELECT MAX(generated_at) FROM study_plan").fetchone()[0]
    return StudyStatus(
        llm_enabled=settings.llm.mode != "off",
        llm_calls_today=llm_calls_today(conn, now),
        llm_calls_cap=settings.llm.max_calls_per_day,
        pending=pending,
        last_topics_at=None if last_topics_at is None else str(last_topics_at),
        last_plan_at=None if last_plan_at is None else str(last_plan_at),
    )


def _quiz_from_row(conn: sqlite3.Connection, row: tuple[Any, ...]) -> Quiz:
    quiz_id = str(row[0])
    return Quiz(
        id=quiz_id,
        scope_kind=cast("QuizScopeKind", str(row[1])),
        scope_id=str(row[2]),
        title_es=str(row[3]),
        questions=_questions_for_quiz(conn, quiz_id),
        stale=bool(row[4]),
    )


def _questions_for_quiz(conn: sqlite3.Connection, quiz_id: str) -> list[Question]:
    """Preguntas visibles sin respuestas; los dictados llevan su clip ``front``."""
    rows = visible_questions(conn, quiz_id)
    audio_keys = [
        row.audio_cache_key
        for row in rows
        if row.kind == "dictation" and row.audio_cache_key is not None
    ]
    clips = _audio_clips(conn, audio_keys)
    block_ids = [row.source_block_id for row in rows if row.source_block_id is not None]
    block_items = _block_items(conn, block_ids)
    questions: list[Question] = []
    for row in rows:
        clip = (
            clips.get(row.audio_cache_key)
            if row.kind == "dictation" and row.audio_cache_key is not None
            else None
        )
        source_item_id = (
            block_items.get(row.source_block_id) if row.source_block_id is not None else None
        )
        questions.append(
            Question(
                id=row.id,
                kind=row.kind,
                prompt_es=row.prompt_es,
                prompt_fr=row.prompt_fr,
                options=list(row.options),
                audio=clip,
                source_item_id=source_item_id,
            )
        )
    return questions


def _audio_clips(conn: sqlite3.Connection, cache_keys: Sequence[str]) -> dict[str, AudioClip]:
    """Clips ``done`` indexados por ``cache_key``; una clave repetida se consulta una vez."""
    unique = list(dict.fromkeys(cache_keys))
    if not unique:
        return {}
    marks = ",".join("?" for _ in unique)
    clips: dict[str, AudioClip] = {}
    for cache_key, voice_id, duration_ms in conn.execute(
        f"SELECT cache_key, voice_id, duration_ms FROM audio WHERE status = 'done'"
        f" AND cache_key IN ({marks})",
        unique,
    ):
        key = str(cache_key)
        clips[key] = AudioClip(
            field="front",
            voice_id=str(voice_id),
            url=f"/api/audio/{key}",
            duration_ms=None if duration_ms is None else int(duration_ms),
        )
    return clips


def _block_items(conn: sqlite3.Connection, block_ids: Sequence[int]) -> dict[int, str]:
    """``text_blocks.id`` → ``item_id`` para ``source_item_id`` de las preguntas."""
    unique = list(dict.fromkeys(block_ids))
    if not unique:
        return {}
    marks = ",".join("?" for _ in unique)
    return {
        int(block_id): str(item_id)
        for block_id, item_id in conn.execute(
            f"SELECT id, item_id FROM text_blocks WHERE id IN ({marks})", unique
        )
    }
