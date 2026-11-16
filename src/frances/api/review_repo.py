"""Cola de repaso, reseñas FSRS y banderas por usuario (plan UI-05).

La lectura del estado previo, la comprobación de idempotencia/conflicto y la
escritura de la reseña van en la misma transacción ``BEGIN IMMEDIATE``: dos
dispositivos que mandan la misma reseña no duplican ``review_log`` ni pisan el
estado con una reseña más vieja. Ningún texto del curso sale de este módulo.
"""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any, Literal, cast

from pydantic import ValidationError

from frances.db.usage import bogota_day
from frances.models.study import (
    CardFlagsIn,
    FsrsCard,
    FsrsStateCode,
    ReviewIn,
    UserCardStateOut,
    UserPrefs,
)
from frances.timeutil import BOGOTA, format_ts, parse_ts

ReviewCode = Literal["bad_request", "conflict"]

_BAD_REQUEST = "Datos no válidos."
_CONFLICT = "La reseña es más antigua que la última guardada."
_WINDOW_PAST = timedelta(days=30)
_WINDOW_FUTURE = timedelta(minutes=5)
_STATE_COLUMNS = (
    "due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,"
    " reps, lapses, state, last_review, suspended, flagged_hard, updated_at"
)


class ReviewRejected(Exception):
    """Reseña rechazada con un código estable para la API (400 o 409)."""

    def __init__(self, code: ReviewCode, message_es: str) -> None:
        super().__init__(message_es)
        self.code: ReviewCode = code
        self.message_es = message_es


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


def _q_prefs(conn: sqlite3.Connection, user_id: str) -> list[tuple[str, str]]:
    rows = conn.execute(
        "SELECT key, value_json FROM user_prefs WHERE user_id = ? ORDER BY key",
        (user_id,),
    ).fetchall()
    return [(str(row[0]), str(row[1])) for row in rows]


def get_prefs_row(conn: sqlite3.Connection, user_id: str) -> UserPrefs:
    """Preferencias guardadas sobre los valores por defecto de ``UserPrefs``.

    Una fila corrupta (JSON inválido o valor fuera de rango) se ignora y deja
    el valor por defecto; nunca rompe la lectura.
    """
    merged = UserPrefs().model_dump()
    for key, raw in _q_prefs(conn, user_id):
        if key not in merged:
            continue
        try:
            value = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        try:
            merged = UserPrefs.model_validate({**merged, key: value}).model_dump()
        except ValidationError:
            continue
    return UserPrefs.model_validate(merged)


def _q_new_introduced_today(conn: sqlite3.Connection, user_id: str, start: str, end: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM review_log"
        " WHERE user_id = ? AND state = 0 AND review_at >= ? AND review_at < ?",
        (user_id, start, end),
    ).fetchone()
    return 0 if row is None else int(row[0])


def _bogota_day_bounds(now: datetime) -> tuple[str, str]:
    day = date.fromisoformat(bogota_day(now))
    start = datetime(day.year, day.month, day.day, tzinfo=BOGOTA)
    return format_ts(start), format_ts(start + timedelta(days=1))


def new_introduced_today(conn: sqlite3.Connection, user_id: str, now: datetime) -> int:
    """Nuevas ya repasadas hoy (``review_log.state = 0``) en el día Bogotá."""
    start, end = _bogota_day_bounds(now)
    return _q_new_introduced_today(conn, user_id, start, end)


def _q_due_ids(conn: sqlite3.Connection, user_id: str, now_ts: str, limit: int) -> list[str]:
    rows = conn.execute(
        "SELECT c.id FROM cards c"
        " JOIN user_card_state s ON s.card_id = c.id AND s.user_id = ?"
        " WHERE (c.owner_user_id IS NULL OR c.owner_user_id = ?)"
        " AND c.removed_at IS NULL AND c.stale = 0 AND s.suspended = 0"
        " AND s.due <= ?"
        " ORDER BY s.due, c.id LIMIT ?",
        (user_id, user_id, now_ts, limit),
    ).fetchall()
    return [str(row[0]) for row in rows]


def _q_new_ids(conn: sqlite3.Connection, user_id: str, now_ts: str, limit: int) -> list[str]:
    rows = conn.execute(
        "SELECT c.id FROM cards c"
        " LEFT JOIN user_card_state s ON s.card_id = c.id AND s.user_id = ?"
        " WHERE (c.owner_user_id IS NULL OR c.owner_user_id = ?)"
        " AND c.removed_at IS NULL AND c.stale = 0"
        " AND (s.user_id IS NULL OR (s.reps = 0 AND s.suspended = 0 AND s.due > ?))"
        " ORDER BY COALESCE("
        "   (SELECT MIN(i.creation_time) FROM card_sources cs"
        "      JOIN items i ON i.id = cs.item_id WHERE cs.card_id = c.id),"
        "   c.created_at), c.id"
        " LIMIT ?",
        (user_id, user_id, now_ts, limit),
    ).fetchall()
    return [str(row[0]) for row in rows]


def queue_card_ids(conn: sqlite3.Connection, user_id: str, now: datetime, limit: int) -> list[str]:
    """Ids de la cola del usuario: vencidas primero y luego nuevas hasta el tope diario.

    Excluye suspendidas, ``stale``, ``removed_at`` y tarjetas que no ve el usuario.
    El tope de nuevas descuenta las ya introducidas hoy (día Bogotá).
    """
    if limit <= 0:
        return []
    now_ts = format_ts(now)
    due_ids = _q_due_ids(conn, user_id, now_ts, limit)
    remaining = limit - len(due_ids)
    if remaining <= 0:
        return due_ids
    prefs = get_prefs_row(conn, user_id)
    new_available = max(0, prefs.daily_new_cards - new_introduced_today(conn, user_id, now))
    new_limit = min(remaining, new_available)
    if new_limit <= 0:
        return due_ids
    return due_ids + _q_new_ids(conn, user_id, now_ts, new_limit)


def _q_state(conn: sqlite3.Connection, user_id: str, card_id: str) -> tuple[Any, ...] | None:
    row = conn.execute(
        f"SELECT {_STATE_COLUMNS} FROM user_card_state WHERE user_id = ? AND card_id = ?",
        (user_id, card_id),
    ).fetchone()
    return None if row is None else cast("tuple[Any, ...]", row)


def _state_out(card_id: str, row: tuple[Any, ...]) -> UserCardStateOut:
    return UserCardStateOut(
        card_id=card_id,
        fsrs=FsrsCard(
            due=str(row[0]),
            stability=float(row[1]),
            difficulty=float(row[2]),
            elapsed_days=int(row[3]),
            scheduled_days=int(row[4]),
            learning_steps=int(row[5]),
            reps=int(row[6]),
            lapses=int(row[7]),
            state=cast("FsrsStateCode", int(row[8])),
            last_review=None if row[9] is None else str(row[9]),
        ),
        suspended=bool(row[10]),
        flagged_hard=bool(row[11]),
        updated_at=str(row[12]),
    )


def get_state(conn: sqlite3.Connection, user_id: str, card_id: str) -> UserCardStateOut | None:
    """Estado FSRS del usuario para la tarjeta; ``None`` si nunca la ha tocado."""
    row = _q_state(conn, user_id, card_id)
    return None if row is None else _state_out(card_id, row)


def _q_has_review_at(conn: sqlite3.Connection, user_id: str, card_id: str, review_at: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM review_log WHERE user_id = ? AND card_id = ? AND review_at = ? LIMIT 1",
        (user_id, card_id, review_at),
    ).fetchone()
    return row is not None


def _validated_times(rv: ReviewIn, now: datetime) -> tuple[str, str, str]:
    """Valida R-38 y la ventana temporal; devuelve ``(reviewed_at, due, last_review)``."""
    try:
        reviewed_at = parse_ts(rv.reviewed_at)
        due = parse_ts(rv.next.due)
        last_review = rv.next.last_review
        if last_review is None:
            raise ValueError("falta next.last_review")
        last_review_at = parse_ts(last_review)
    except ValueError:
        raise ReviewRejected("bad_request", _BAD_REQUEST) from None
    if reviewed_at < now - _WINDOW_PAST or reviewed_at > now + _WINDOW_FUTURE:
        raise ReviewRejected("bad_request", _BAD_REQUEST)
    if not rv.next.stability > 0 or not 1 <= rv.next.difficulty <= 10:
        raise ReviewRejected("bad_request", _BAD_REQUEST)
    if due < reviewed_at or last_review_at != reviewed_at:
        raise ReviewRejected("bad_request", _BAD_REQUEST)
    return format_ts(reviewed_at), format_ts(due), format_ts(last_review_at)


def apply_review(
    conn: sqlite3.Connection, user_id: str, rv: ReviewIn, now: datetime
) -> UserCardStateOut:
    """Guarda una reseña calculada en el cliente con idempotencia y conflicto.

    ``review_log.state`` guarda el estado **anterior** (0 si no había fila).
    Repetir la misma ``reviewed_at`` devuelve el estado actual sin insertar; una
    reseña más vieja que ``last_review`` lanza ``ReviewRejected('conflict')``.
    """
    reviewed_ts, due_ts, last_review_ts = _validated_times(rv, now)
    updated_ts = format_ts(now)

    with _write(conn):
        if _q_has_review_at(conn, user_id, rv.card_id, reviewed_ts):
            current = _q_state(conn, user_id, rv.card_id)
            if current is None:  # pragma: no cover - fila de log sin estado: base corrupta
                raise ReviewRejected("conflict", _CONFLICT)
            return _state_out(rv.card_id, current)

        previous = _q_state(conn, user_id, rv.card_id)
        if (
            previous is not None
            and previous[9] is not None
            and parse_ts(str(previous[9])) > parse_ts(reviewed_ts)
        ):
            raise ReviewRejected("conflict", _CONFLICT)

        previous_state = 0 if previous is None else int(previous[8])
        suspended = False if previous is None else bool(previous[10])
        flagged_hard = False if previous is None else bool(previous[11])
        conn.execute(
            "INSERT INTO review_log (user_id, card_id, rating, state, due, stability,"
            " difficulty, elapsed_days, scheduled_days, review_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                rv.card_id,
                int(rv.rating),
                previous_state,
                due_ts,
                rv.next.stability,
                rv.next.difficulty,
                rv.next.elapsed_days,
                rv.next.scheduled_days,
                reviewed_ts,
            ),
        )
        conn.execute(
            "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
            " elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review,"
            " suspended, flagged_hard, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(user_id, card_id) DO UPDATE SET due = excluded.due,"
            " stability = excluded.stability, difficulty = excluded.difficulty,"
            " elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,"
            " learning_steps = excluded.learning_steps, reps = excluded.reps,"
            " lapses = excluded.lapses, state = excluded.state,"
            " last_review = excluded.last_review, updated_at = excluded.updated_at",
            (
                user_id,
                rv.card_id,
                due_ts,
                rv.next.stability,
                rv.next.difficulty,
                rv.next.elapsed_days,
                rv.next.scheduled_days,
                rv.next.learning_steps,
                rv.next.reps,
                rv.next.lapses,
                int(rv.next.state),
                last_review_ts,
                int(suspended),
                int(flagged_hard),
                updated_ts,
            ),
        )

    return UserCardStateOut(
        card_id=rv.card_id,
        fsrs=rv.next.model_copy(update={"due": due_ts, "last_review": last_review_ts}),
        suspended=suspended,
        flagged_hard=flagged_hard,
        updated_at=updated_ts,
    )


def set_flags(
    conn: sqlite3.Connection,
    user_id: str,
    card_id: str,
    flags: CardFlagsIn,
    now: datetime,
) -> UserCardStateOut:
    """Suspende o marca «difícil» sin perder el estado FSRS ni la otra bandera.

    Si no había fila, crea una tarjeta vacía de ts-fsrs (``state = 0``, ``due = now``,
    ``stability = difficulty = 0``, contadores en 0, ``last_review = NULL``).
    """
    updated_ts = format_ts(now)
    with _write(conn):
        row = _q_state(conn, user_id, card_id)
        if row is None:
            suspended = bool(flags.suspended)
            flagged_hard = bool(flags.flagged_hard)
            fsrs = FsrsCard(
                due=updated_ts,
                stability=0.0,
                difficulty=0.0,
                elapsed_days=0,
                scheduled_days=0,
                learning_steps=0,
                reps=0,
                lapses=0,
                state=0,
                last_review=None,
            )
            conn.execute(
                "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty,"
                " elapsed_days, scheduled_days, learning_steps, reps, lapses, state,"
                " last_review, suspended, flagged_hard, updated_at)"
                " VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?, ?, ?)",
                (user_id, card_id, updated_ts, int(suspended), int(flagged_hard), updated_ts),
            )
        else:
            current = _state_out(card_id, row)
            suspended = current.suspended if flags.suspended is None else bool(flags.suspended)
            flagged_hard = (
                current.flagged_hard if flags.flagged_hard is None else bool(flags.flagged_hard)
            )
            fsrs = current.fsrs
            conn.execute(
                "UPDATE user_card_state SET suspended = ?, flagged_hard = ?, updated_at = ?"
                " WHERE user_id = ? AND card_id = ?",
                (int(suspended), int(flagged_hard), updated_ts, user_id, card_id),
            )
    return UserCardStateOut(
        card_id=card_id,
        fsrs=fsrs,
        suspended=suspended,
        flagged_hard=flagged_hard,
        updated_at=updated_ts,
    )
