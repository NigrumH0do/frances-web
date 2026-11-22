"""Plan de estudio diario por usuario, por reglas (AI-10).

Cada día tiene hasta ``MAX_ENTRIES_PER_DAY`` entradas, en este orden: entregas
próximas, repaso de tarjetas, quizzes y lecturas de publicaciones nuevas. Nada de
esto llama al LLM. El tipo ``drill`` existe en el esquema pero este módulo nunca lo
emite: las estadísticas de fonemas viven en el navegador (R-42).

Los días se cuentan en America/Bogota. ``today`` ancla las ventanas «últimos N
días»; ``day`` es el día del plan que se arma.
"""

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from frances.db.store import Store
from frances.db.usage import bogota_day
from frances.log import get_logger
from frances.models.study import PlanEntry, PlanKind, StudyPlanDay, UserPrefs
from frances.stage import StageContext
from frances.timeutil import BOGOTA, format_ts, parse_ts, to_bogota

MAX_ENTRIES_PER_DAY = 6
DUE_SOON_DAYS = 3
WEEK_DAYS = 7
QUIZ_PASS = 0.7
NEW_ITEM_DAYS = 3
MAX_QUIZ_ENTRIES = 2
MAX_READ_ENTRIES = 2

_logger = get_logger(__name__)

# Tarjeta visible para el usuario: compartida o propia, viva y no borrada.
_VISIBLE_CARD = (
    "(c.owner_user_id IS NULL OR c.owner_user_id = ?) AND c.stale = 0 AND c.removed_at IS NULL"
)


@dataclass(frozen=True)
class PlannedEntry:
    kind: PlanKind
    ref_id: str | None
    title_es: str
    reason_es: str


def _midnight_utc(day: date) -> str:
    """Inicio del día ``day`` en Bogotá, en el formato de timestamps de la base."""
    return format_ts(datetime.combine(day, time(0), tzinfo=BOGOTA))


def _local_day(raw: str) -> date:
    return to_bogota(parse_ts(raw)).date()


def _short(day: date) -> str:
    return f"{day.day}/{day.month}"


def _daily_new_cards(conn: sqlite3.Connection, user_id: str) -> int:
    row = conn.execute(
        "SELECT value_json FROM user_prefs WHERE user_id = ? AND key = 'daily_new_cards'",
        (user_id,),
    ).fetchone()
    if row is None:
        return UserPrefs().daily_new_cards
    return int(json.loads(row[0]))


def _deadlines(conn: sqlite3.Connection, day: date) -> list[tuple[str, str | None, str]]:
    start = _midnight_utc(day)
    end = _midnight_utc(day + timedelta(days=DUE_SOON_DAYS))
    return [
        (row[0], row[1], row[2])
        for row in conn.execute(
            "SELECT id, title, due_at FROM items WHERE kind = 'coursework'"
            " AND deleted_at IS NULL AND due_at >= ? AND due_at < ? ORDER BY due_at, id",
            (start, end),
        )
    ]


def _review_entry(
    conn: sqlite3.Connection, user_id: str, day: date, daily_new_cards: int, skip: frozenset[str]
) -> tuple[PlannedEntry | None, list[str]]:
    end = _midnight_utc(day + timedelta(days=1))
    due = int(
        conn.execute(
            "SELECT COUNT(*) FROM user_card_state s JOIN cards c ON c.id = s.card_id"
            f" WHERE s.user_id = ? AND s.suspended = 0 AND s.due < ? AND {_VISIBLE_CARD}",
            (user_id, end, user_id),
        ).fetchone()[0]
    )
    unseen = [
        row[0]
        for row in conn.execute(
            f"SELECT c.id FROM cards c WHERE {_VISIBLE_CARD} AND NOT EXISTS"
            " (SELECT 1 FROM user_card_state s WHERE s.user_id = ? AND s.card_id = c.id)"
            " ORDER BY c.created_at, c.id",
            (user_id, user_id),
        )
        if row[0] not in skip
    ][:daily_new_cards]
    new = len(unseen)
    if due + new == 0:
        return None, []
    if due and new:
        reason = f"{due} vencen y {new} son nuevas."
    elif due:
        reason = f"{due} vencen."
    else:
        reason = f"{new} son nuevas."
    entry = PlannedEntry("review", None, f"Repasar {due + new} tarjetas", reason)
    return entry, unseen


def _quiz_entries(
    conn: sqlite3.Connection,
    user_id: str,
    deadline_ids: Sequence[str],
    today: date,
) -> list[PlannedEntry]:
    candidates: list[PlannedEntry] = []
    if deadline_ids:
        marks = ",".join("?" * len(deadline_ids))
        for quiz_id, title in conn.execute(
            "SELECT q.id, q.title_es FROM quizzes q WHERE q.scope_kind = 'topic'"
            " AND q.stale = 0 AND q.scope_id IN (SELECT sti.topic_id FROM study_topic_items sti"
            " JOIN study_topics t ON t.id = sti.topic_id"
            f" WHERE sti.item_id IN ({marks}) AND t.removed_at IS NULL)"
            " ORDER BY q.created_at, q.id",
            tuple(deadline_ids),
        ):
            candidates.append(
                PlannedEntry("quiz", quiz_id, f"Quiz: {title}", "Del tema de una entrega próxima.")
            )
    failed = conn.execute(
        "SELECT q.id, q.title_es, a.score FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id"
        " WHERE a.user_id = ? AND q.stale = 0 AND a.score < ?"
        " AND a.id = (SELECT MAX(b.id) FROM quiz_attempts b"
        "   WHERE b.user_id = a.user_id AND b.quiz_id = a.quiz_id)"
        " ORDER BY a.finished_at, q.id",
        (user_id, QUIZ_PASS),
    ).fetchall()
    for quiz_id, title, score in failed:
        reason = f"Tu último resultado fue {round(score * 100)} %."
        candidates.append(PlannedEntry("quiz", quiz_id, f"Quiz: {title}", reason))
    window = _midnight_utc(today - timedelta(days=NEW_ITEM_DAYS))
    untried = conn.execute(
        "SELECT q.id, q.title_es FROM quizzes q WHERE q.scope_kind = 'topic' AND q.stale = 0"
        " AND q.scope_id IN (SELECT sti.topic_id FROM study_topic_items sti"
        "   JOIN items i ON i.id = sti.item_id JOIN study_topics t ON t.id = sti.topic_id"
        "   WHERE i.first_seen_at >= ? AND i.deleted_at IS NULL AND t.removed_at IS NULL)"
        " AND NOT EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.user_id = ? AND a.quiz_id = q.id)"
        " ORDER BY q.created_at, q.id",
        (window, user_id),
    ).fetchall()
    for quiz_id, title in untried:
        candidates.append(
            PlannedEntry("quiz", quiz_id, f"Quiz: {title}", "Tema nuevo: aún no lo practicas.")
        )
    return candidates


def _read_entries(
    conn: sqlite3.Connection, today: date, exclude: frozenset[str]
) -> list[PlannedEntry]:
    window = _midnight_utc(today - timedelta(days=NEW_ITEM_DAYS))
    out: list[PlannedEntry] = []
    for item_id, title, first_seen in conn.execute(
        "SELECT id, title, first_seen_at FROM items WHERE first_seen_at >= ?"
        " AND deleted_at IS NULL ORDER BY first_seen_at DESC, id",
        (window,),
    ):
        if item_id in exclude:
            continue
        reason = f"Publicación nueva del {_short(_local_day(first_seen))}."
        out.append(PlannedEntry("read", item_id, f"Leer «{title or 'Sin título'}»", reason))
    return out


def _plan_day(
    conn: sqlite3.Connection,
    user_id: str,
    day: date,
    today: date,
    daily_new_cards: int,
    skip_new: frozenset[str],
) -> tuple[list[PlannedEntry], list[str]]:
    """Entradas del día y las tarjetas nuevas que proyectó (para el día siguiente)."""
    entries: list[PlannedEntry] = []
    deadlines = _deadlines(conn, day)
    deadline_ids = [row[0] for row in deadlines]
    for item_id, title, due_at in deadlines:
        due_day = _local_day(due_at)
        reason = "Se entrega hoy." if due_day == day else f"Se entrega el {_short(due_day)}."
        entries.append(PlannedEntry("read", item_id, f"Preparar «{title or 'Sin título'}»", reason))

    review, new_ids = _review_entry(conn, user_id, day, daily_new_cards, skip_new)
    if review is not None:
        entries.append(review)

    seen_quizzes: set[str] = set()
    quiz_count = 0
    for entry in _quiz_entries(conn, user_id, deadline_ids, today):
        if quiz_count == MAX_QUIZ_ENTRIES:
            break
        if entry.ref_id in seen_quizzes:
            continue
        seen_quizzes.add(entry.ref_id or "")
        entries.append(entry)
        quiz_count += 1

    reads = _read_entries(conn, today, frozenset(deadline_ids))[:MAX_READ_ENTRIES]
    entries.extend(reads)

    unique: list[PlannedEntry] = []
    refs: set[str] = set()
    for entry in entries:
        if entry.ref_id is not None:
            if entry.ref_id in refs:
                continue
            refs.add(entry.ref_id)
        unique.append(entry)
    return unique[:MAX_ENTRIES_PER_DAY], new_ids


def plan_for_day(
    conn: sqlite3.Connection,
    user_id: str,
    day: date,
    *,
    today: date,
    daily_new_cards: int,
) -> list[PlannedEntry]:
    """Plan de un día, sin tener en cuenta lo proyectado en otros días."""
    entries, _ = _plan_day(conn, user_id, day, today, daily_new_cards, frozenset())
    return entries


def build_week(
    conn: sqlite3.Connection, user_id: str, now: datetime
) -> dict[str, list[PlannedEntry]]:
    """Siete días desde hoy en Bogotá. Cada tarjeta nueva aparece en un solo día."""
    today = date.fromisoformat(bogota_day(now))
    daily_new = _daily_new_cards(conn, user_id)
    projected: set[str] = set()
    week: dict[str, list[PlannedEntry]] = {}
    for offset in range(WEEK_DAYS):
        day = today + timedelta(days=offset)
        entries, new_ids = _plan_day(conn, user_id, day, today, daily_new, frozenset(projected))
        projected.update(new_ids)
        week[day.isoformat()] = entries
    return week


def save_week(
    conn: sqlite3.Connection,
    user_id: str,
    week: dict[str, list[PlannedEntry]],
    now: str,
) -> None:
    """Reemplaza las filas de cada día. Conserva ``done_at`` y ``why_llm_es`` de las
    entradas que siguen iguales (mismo tipo, referencia y texto de motivo).
    """
    for day, entries in week.items():
        kept: dict[tuple[str, str | None, str], tuple[str | None, str | None]] = {}
        for kind, ref_id, reason, done_at, why in conn.execute(
            "SELECT kind, ref_id, reason_es, done_at, why_llm_es FROM study_plan"
            " WHERE user_id = ? AND day = ?",
            (user_id, day),
        ).fetchall():
            kept[(kind, ref_id, reason)] = (done_at, why)
        conn.execute("DELETE FROM study_plan WHERE user_id = ? AND day = ?", (user_id, day))
        for position, entry in enumerate(entries):
            done_at, why = kept.get((entry.kind, entry.ref_id, entry.reason_es), (None, None))
            conn.execute(
                "INSERT INTO study_plan (user_id, day, position, kind, ref_id, title_es,"
                " reason_es, why_llm_es, done_at, generated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    day,
                    position,
                    entry.kind,
                    entry.ref_id,
                    entry.title_es,
                    entry.reason_es,
                    why,
                    done_at,
                    now,
                ),
            )


def run_plans(ctx: StageContext, *, user_ids: Sequence[str] | None = None) -> dict[str, int]:
    """Arma la semana de cada usuario activo. Un usuario con error no corta a los demás."""
    store = ctx.store
    now = ctx.now()
    counts = {"users": 0, "entries": 0, "errors": 0}
    rows = store.conn.execute(
        "SELECT id FROM users WHERE status = 'active' AND disabled_at IS NULL ORDER BY id"
    ).fetchall()
    for (user_id,) in rows:
        if user_ids is not None and user_id not in user_ids:
            continue
        try:
            with store.tx() as tx:
                week = build_week(tx, user_id, now)
                save_week(tx, user_id, week, format_ts(now))
        except sqlite3.Error:
            counts["errors"] += 1
            _logger.warning("no se pudo generar el plan del usuario %s", user_id)
            continue
        counts["users"] += 1
        counts["entries"] += sum(len(entries) for entries in week.values())
    return counts


def ensure_today(store: Store, user_id: str, now: datetime) -> None:
    """Arma la semana si el usuario no tiene plan para hoy. No llama al LLM."""
    today = bogota_day(now)
    query = "SELECT 1 FROM study_plan WHERE user_id = ? AND day = ? LIMIT 1"
    if store.conn.execute(query, (user_id, today)).fetchone() is not None:
        return
    with store.tx() as tx:
        if tx.execute(query, (user_id, today)).fetchone() is not None:
            return
        week = build_week(tx, user_id, now)
        save_week(tx, user_id, week, format_ts(now))


def plan_day_view(conn: sqlite3.Connection, user_id: str, day: str) -> StudyPlanDay:
    """Plan guardado de un día. ``generated_at`` queda vacío si el día no tiene filas."""
    rows = conn.execute(
        "SELECT position, kind, ref_id, title_es, reason_es, why_llm_es, done_at, generated_at"
        " FROM study_plan WHERE user_id = ? AND day = ? ORDER BY position",
        (user_id, day),
    ).fetchall()
    entries = [
        PlanEntry(
            position=row[0],
            kind=row[1],
            ref_id=row[2],
            title_es=row[3],
            reason_es=row[4],
            why_llm_es=row[5],
            done=row[6] is not None,
        )
        for row in rows
    ]
    generated_at = rows[0][7] if rows else ""
    return StudyPlanDay(day=day, entries=entries, generated_at=generated_at)


def set_done(
    conn: sqlite3.Connection,
    user_id: str,
    day: str,
    position: int,
    done: bool,
    now: str,
) -> PlanEntry | None:
    """Marca o desmarca una entrada. ``None`` si la fila no existe."""
    if done:
        cursor = conn.execute(
            "UPDATE study_plan SET done_at = COALESCE(done_at, ?)"
            " WHERE user_id = ? AND day = ? AND position = ?",
            (now, user_id, day, position),
        )
    else:
        cursor = conn.execute(
            "UPDATE study_plan SET done_at = NULL WHERE user_id = ? AND day = ? AND position = ?",
            (user_id, day, position),
        )
    if cursor.rowcount == 0:
        return None
    return next(
        entry for entry in plan_day_view(conn, user_id, day).entries if entry.position == position
    )
