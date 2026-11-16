"""Preferencias, estadísticas, progreso por tema y entregas (plan UI-06).

Todo se agrega en SQL y se filtra por el usuario de la sesión; los días y las
rachas se calculan con ``bogota_day`` (``America/Bogota``). ``upcoming_item_ids``
solo mira publicaciones vivas de cursos incluidos: no hay datos de otra cuenta
que exponer porque las publicaciones son del curso compartido.
"""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta

from frances.api.review_repo import queue_card_ids
from frances.db.usage import bogota_day
from frances.models.study import DayCount, QuizBest, TopicProgress, UserPrefs, UserStats
from frances.timeutil import BOGOTA, format_ts, parse_ts

_DAYS_IN_WEEK = 7
_QUIZ_BEST_LIMIT = 5
_RETENTION_DAYS = 30
_RETENTION_MIN_REVIEWS = 10
_DUE_NOW_LIMIT = 10_000


@contextmanager
def _write(conn: sqlite3.Connection) -> Iterator[None]:
    """``BEGIN IMMEDIATE`` propio, salvo que la conexión ya traiga una transacción."""
    if conn.in_transaction:
        yield
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def save_prefs(
    conn: sqlite3.Connection, user_id: str, prefs: UserPrefs, now: datetime
) -> UserPrefs:
    """Guarda una fila por campo en ``user_prefs`` (``value_json``) y devuelve lo guardado."""
    updated_at = format_ts(now)
    with _write(conn):
        for key, value in prefs.model_dump().items():
            conn.execute(
                "INSERT INTO user_prefs (user_id, key, value_json, updated_at)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json,"
                " updated_at = excluded.updated_at",
                (user_id, key, json.dumps(value, separators=(",", ":")), updated_at),
            )
    return prefs


def course_included(conn: sqlite3.Connection, course_id: str) -> bool:
    """True solo si el curso existe y el pipeline lo incluye."""
    row = conn.execute(
        "SELECT 1 FROM courses WHERE id = ? AND included = 1", (course_id,)
    ).fetchone()
    return row is not None


def upcoming_item_ids(conn: sqlite3.Connection, now: datetime, limit: int) -> list[str]:
    """Ids con ``due_at >= ahora`` de publicaciones vivas de cursos incluidos."""
    if limit <= 0:
        return []
    rows = conn.execute(
        "SELECT i.id FROM items i JOIN courses c ON c.id = i.course_id"
        " WHERE i.deleted_at IS NULL AND c.included = 1"
        " AND i.due_at IS NOT NULL AND i.due_at >= ?"
        " ORDER BY i.due_at, i.id LIMIT ?",
        (format_ts(now), limit),
    ).fetchall()
    return [str(row[0]) for row in rows]


def _day_start(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=BOGOTA)


def _day_bounds(day: date) -> tuple[str, str]:
    start = _day_start(day)
    return format_ts(start), format_ts(start + timedelta(days=1))


def _count_reviews_between(conn: sqlite3.Connection, user_id: str, start: str, end: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM review_log WHERE user_id = ? AND review_at >= ? AND review_at < ?",
        (user_id, start, end),
    ).fetchone()
    return 0 if row is None else int(row[0])


def _retention_30d(conn: sqlite3.Connection, user_id: str, now: datetime) -> float | None:
    """Fracción con nota > 1 entre reseñas con estado previo 2; None con menos de 10."""
    row = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN rating > 1 THEN 1 ELSE 0 END), 0)"
        " FROM review_log WHERE user_id = ? AND state = 2 AND review_at >= ?",
        (user_id, format_ts(now - timedelta(days=_RETENTION_DAYS))),
    ).fetchone()
    total = 0 if row is None else int(row[0])
    good = 0 if row is None else int(row[1])
    if total < _RETENTION_MIN_REVIEWS:
        return None
    return good / total


def _activity_days(conn: sqlite3.Connection, user_id: str) -> set[str]:
    """Días Bogotá con al menos una reseña o un intento de quiz del usuario."""
    rows = conn.execute(
        "SELECT review_at AS at FROM review_log WHERE user_id = ?"
        " UNION SELECT finished_at AS at FROM quiz_attempts WHERE user_id = ?",
        (user_id, user_id),
    ).fetchall()
    return {bogota_day(parse_ts(str(row[0]))) for row in rows if row[0] is not None}


def _streak_days(conn: sqlite3.Connection, user_id: str, today: date) -> int:
    """Días seguidos con actividad, terminando hoy o ayer (regla CHG-12)."""
    days = _activity_days(conn, user_id)
    cursor = today
    if cursor.isoformat() not in days:
        cursor -= timedelta(days=1)
        if cursor.isoformat() not in days:
            return 0
    streak = 0
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _week(conn: sqlite3.Connection, user_id: str, today: date) -> list[DayCount]:
    """Siete días de lunes a domingo de la semana Bogotá que contiene ``today``."""
    monday = today - timedelta(days=today.weekday())
    days = [monday + timedelta(days=offset) for offset in range(_DAYS_IN_WEEK)]
    start = format_ts(_day_start(days[0]))
    end = format_ts(_day_start(days[-1] + timedelta(days=1)))
    reviews = {day.isoformat(): 0 for day in days}
    quiz_attempts = {day.isoformat(): 0 for day in days}
    for raw in conn.execute(
        "SELECT review_at FROM review_log WHERE user_id = ? AND review_at >= ? AND review_at < ?",
        (user_id, start, end),
    ).fetchall():
        key = bogota_day(parse_ts(str(raw[0])))
        if key in reviews:
            reviews[key] += 1
    for raw in conn.execute(
        "SELECT finished_at FROM quiz_attempts"
        " WHERE user_id = ? AND finished_at >= ? AND finished_at < ?",
        (user_id, start, end),
    ).fetchall():
        key = bogota_day(parse_ts(str(raw[0])))
        if key in quiz_attempts:
            quiz_attempts[key] += 1
    return [
        DayCount(
            day=day.isoformat(),
            reviews=reviews[day.isoformat()],
            quiz_attempts=quiz_attempts[day.isoformat()],
        )
        for day in days
    ]


def _quiz_best(conn: sqlite3.Connection, user_id: str) -> list[QuizBest]:
    rows = conn.execute(
        "SELECT a.quiz_id, q.title_es, MAX(a.score), COUNT(*), MAX(a.finished_at)"
        " FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id"
        " WHERE a.user_id = ?"
        " GROUP BY a.quiz_id, q.title_es"
        " ORDER BY MAX(a.finished_at) DESC, a.quiz_id ASC LIMIT ?",
        (user_id, _QUIZ_BEST_LIMIT),
    ).fetchall()
    return [
        QuizBest(
            quiz_id=str(row[0]),
            title_es=str(row[1]),
            best_score=float(row[2]),
            attempts=int(row[3]),
            last_at=str(row[4]),
        )
        for row in rows
    ]


def _cards_learned(conn: sqlite3.Connection, user_id: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM user_card_state s JOIN cards c ON c.id = s.card_id"
        " WHERE s.user_id = ? AND s.state = 2 AND s.suspended = 0"
        " AND c.removed_at IS NULL AND (c.owner_user_id IS NULL OR c.owner_user_id = ?)",
        (user_id, user_id),
    ).fetchone()
    return 0 if row is None else int(row[0])


def user_stats(conn: sqlite3.Connection, user_id: str, now: datetime) -> UserStats:
    """Agregados del usuario de la sesión; ``week`` y ``streak`` en días Bogotá."""
    today = date.fromisoformat(bogota_day(now))
    start, end = _day_bounds(today)
    return UserStats(
        cards_learned=_cards_learned(conn, user_id),
        due_now=len(queue_card_ids(conn, user_id, now, _DUE_NOW_LIMIT)),
        reviews_today=_count_reviews_between(conn, user_id, start, end),
        retention_30d=_retention_30d(conn, user_id, now),
        streak_days=_streak_days(conn, user_id, today),
        week=_week(conn, user_id, today),
        quiz_best=_quiz_best(conn, user_id),
    )


def topic_progress(conn: sqlite3.Connection, user_id: str, course_id: str) -> list[TopicProgress]:
    """Un elemento por ``study_topics`` vigente del curso, en orden de posición.

    ``last_quiz_score`` es la nota del intento más reciente del usuario en el
    quiz del tema (``scope_kind = 'topic'``), que es el que lista su pestaña.
    """
    topics = [
        str(row[0])
        for row in conn.execute(
            "SELECT id FROM study_topics"
            " WHERE course_id = ? AND removed_at IS NULL ORDER BY position, id",
            (course_id,),
        ).fetchall()
    ]
    if not topics:
        return []
    placeholders = ",".join("?" for _ in topics)
    counts: dict[str, tuple[int, int]] = {}
    for row in conn.execute(
        "SELECT sti.topic_id, COUNT(DISTINCT c.id),"
        " COUNT(DISTINCT CASE WHEN s.user_id IS NOT NULL THEN c.id END)"
        " FROM study_topic_items sti"
        " JOIN items i ON i.id = sti.item_id AND i.deleted_at IS NULL"
        " JOIN card_sources cs ON cs.item_id = sti.item_id"
        " JOIN cards c ON c.id = cs.card_id"
        " LEFT JOIN user_card_state s ON s.card_id = c.id AND s.user_id = ?"
        "   AND s.state = 2 AND s.suspended = 0"
        f" WHERE sti.topic_id IN ({placeholders}) AND c.removed_at IS NULL"
        " AND (c.owner_user_id IS NULL OR c.owner_user_id = ?)"
        " GROUP BY sti.topic_id",
        (user_id, *topics, user_id),
    ).fetchall():
        counts[str(row[0])] = (int(row[1]), int(row[2]))
    last_scores: dict[str, float] = {}
    for row in conn.execute(
        "SELECT q.scope_id, a.score FROM quiz_attempts a"
        " JOIN quizzes q ON q.id = a.quiz_id"
        f" WHERE a.user_id = ? AND q.scope_kind = 'topic' AND q.scope_id IN ({placeholders})"
        " ORDER BY a.finished_at DESC, a.id DESC",
        (user_id, *topics),
    ).fetchall():
        last_scores.setdefault(str(row[0]), float(row[1]))
    return [
        TopicProgress(
            topic_id=topic_id,
            cards_total=counts.get(topic_id, (0, 0))[0],
            cards_learned=counts.get(topic_id, (0, 0))[1],
            last_quiz_score=last_scores.get(topic_id),
        )
        for topic_id in topics
    ]
