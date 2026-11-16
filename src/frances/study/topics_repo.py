"""Lectura y escritura de los temas de estudio generados (AI-07).

Las tablas son ``study_topics``/``study_topic_items`` (R-40), no los ``topics``
de Classroom. Las consultas de lectura están agregadas para que
:func:`list_study_topics` no haga N+1; la escritura de :func:`apply_plan` se
ejecuta dentro de la transacción que abre el llamador.
"""

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from frances.models.ids import content_hash, new_topic_id
from frances.models.study import Cefr, StudyTopic


@dataclass(frozen=True)
class CurrentTopic:
    """Tema vigente con sus publicaciones y las que están bloqueadas."""

    id: str
    title: str
    description_es: str
    cefr: Cefr | None
    position: int
    edited_by_human: bool
    item_ids: tuple[str, ...]
    locked_item_ids: frozenset[str]


@dataclass(frozen=True)
class TopicItemInfo:
    """Publicación viva con el resumen y las etiquetas que ve el LLM."""

    item_id: str
    title: str
    classroom_topic: str | None
    summary_es: str
    tags: tuple[str, ...]
    first_seen_at: str


@dataclass(frozen=True)
class PlannedTopic:
    """Tema que un plan (LLM o reglas) quiere dejar en la base."""

    id: str | None
    title: str
    description_es: str
    cefr: Cefr | None
    item_ids: list[str]
    edited_by_human: bool


@dataclass(frozen=True)
class TopicPlan:
    topics: list[PlannedTopic]


@dataclass(frozen=True)
class _ExistingTopic:
    title: str
    description_es: str
    cefr: Cefr | None
    position: int
    edited_by_human: bool
    input_hash: str
    removed_at: str | None


@dataclass
class _PlannedState:
    """Tema en construcción dentro de :func:`apply_plan`."""

    id: str
    title: str
    description_es: str
    cefr: Cefr | None
    edited_by_human: bool
    item_ids: list[str] = field(default_factory=list)
    requested: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- lectura


def load_items(conn: sqlite3.Connection, course_id: str) -> list[TopicItemInfo]:
    """Publicaciones vivas del curso, con resumen, tema de Classroom y etiquetas."""
    tags_by_item = _q_item_tags(conn, course_id)
    return [
        TopicItemInfo(
            item_id=item_id,
            title=title,
            classroom_topic=classroom_topic,
            summary_es=_summary(sheet_json, text),
            tags=tuple(sorted(set(tags_by_item.get(item_id, ())))[:5]),
            first_seen_at=first_seen_at,
        )
        for item_id, title, classroom_topic, sheet_json, text, first_seen_at in _q_items(
            conn, course_id
        )
    ]


def load_topics(conn: sqlite3.Connection, course_id: str) -> list[CurrentTopic]:
    """Temas vigentes del curso en orden de posición, con sus publicaciones vivas."""
    items_by_topic: dict[str, list[str]] = {}
    locked_by_topic: dict[str, set[str]] = {}
    for topic_id, item_id, edited in _q_topic_item_rows(conn, course_id):
        items_by_topic.setdefault(topic_id, []).append(item_id)
        if edited:
            locked_by_topic.setdefault(topic_id, set()).add(item_id)
    return [
        CurrentTopic(
            id=topic_id,
            title=title,
            description_es=description_es,
            cefr=cefr,
            position=position,
            edited_by_human=bool(edited_by_human),
            item_ids=tuple(items_by_topic.get(topic_id, ())),
            locked_item_ids=frozenset(locked_by_topic.get(topic_id, ())),
        )
        for topic_id, title, description_es, cefr, position, edited_by_human in _q_topics(
            conn, course_id
        )
    ]


def topic_input_hash(conn: sqlite3.Connection, item_ids: Sequence[str]) -> str:
    """Huella de las publicaciones del tema y su ``generations.input_hash`` actual."""
    ordered = sorted(item_ids)
    if not ordered:
        return content_hash()
    marks = ",".join("?" * len(ordered))
    rows = dict(
        conn.execute(
            f"SELECT item_id, input_hash FROM generations WHERE item_id IN ({marks})", ordered
        ).fetchall()
    )
    return content_hash(*(f"{item_id}:{rows.get(item_id, '')}" for item_id in ordered))


def list_study_topics(conn: sqlite3.Connection, course_id: str | None) -> list[StudyTopic]:
    """Temas vigentes, con ``item_ids`` y ``card_count``, en una sola consulta."""
    return _q_study_topics(conn, course_id=course_id)


def get_study_topic(conn: sqlite3.Connection, topic_id: str) -> StudyTopic | None:
    topics = _q_study_topics(conn, course_id=None, topic_id=topic_id)
    return topics[0] if topics else None


# ---------------------------------------------------------------- escritura


def apply_plan(
    conn: sqlite3.Connection,
    course_id: str,
    plan: TopicPlan,
    *,
    generator: Literal["llm", "rules"],
    generator_version: str,
    now: str,
) -> list[str]:
    """Escribe el plan completo del curso y devuelve los ids de temas cambiados.

    El llamador debe estar dentro de una transacción (``Store.tx``). Se
    reescriben todos los enlaces de ``study_topic_items`` del curso para no
    chocar con ``UNIQUE (item_id)`` al mover publicaciones. Los temas e ítems
    con ``edited_by_human = 1`` conservan su identidad: un tema bloqueado no se
    renombra, no se divide y un ítem bloqueado no cambia de tema.
    """
    existing = _q_existing_topics(conn, course_id)
    links = _q_current_links(conn, course_id)
    live_items = set(_q_live_items(conn, course_id))
    item_topic: dict[str, str] = {}
    for topic_id, topic_links in links.items():
        for item_id, _position, _edited in topic_links:
            item_topic.setdefault(item_id, topic_id)

    locked_topics = {topic_id for topic_id, topic in existing.items() if topic.edited_by_human}
    locked_items = {
        item_id
        for topic_links in links.values()
        for item_id, _position, edited in topic_links
        if edited and item_id in live_items
    }
    fixed_items: dict[str, str] = {}
    for topic_id in locked_topics:
        for item_id, _position, _edited in links.get(topic_id, ()):
            if item_id in live_items:
                fixed_items[item_id] = topic_id
    for topic_id, topic_links in links.items():
        for item_id, _position, edited in topic_links:
            if edited and item_id in live_items:
                fixed_items.setdefault(item_id, topic_id)

    states: list[_PlannedState] = []
    used_ids: set[str] = set()
    for planned in plan.topics:
        planned_id: str | None = planned.id
        if planned_id is None or planned_id not in existing or planned_id in used_ids:
            planned_id = new_topic_id()
            while planned_id in used_ids or planned_id in existing:
                planned_id = new_topic_id()
        used_ids.add(planned_id)
        previous = existing.get(planned_id)
        locked = previous is not None and previous.edited_by_human
        state = _PlannedState(
            id=planned_id,
            title=previous.title if locked and previous is not None else planned.title,
            description_es=(
                previous.description_es
                if locked and previous is not None
                else planned.description_es
            ),
            cefr=previous.cefr if locked and previous is not None else planned.cefr,
            edited_by_human=locked or planned.edited_by_human,
            requested=list(planned.item_ids),
        )
        if locked and previous is not None:
            state.item_ids.extend(
                item_id
                for item_id, _position, _edited in links.get(planned_id, ())
                if item_id in live_items
            )
        states.append(state)

    # Los temas bloqueados que el plan omitió se conservan enteros, no vacíos.
    for topic_id in sorted(locked_topics - used_ids):
        previous = existing[topic_id]
        state = _PlannedState(
            id=topic_id,
            title=previous.title,
            description_es=previous.description_es,
            cefr=previous.cefr,
            edited_by_human=True,
        )
        state.item_ids.extend(
            item_id
            for item_id, _position, _edited in links.get(topic_id, ())
            if item_id in live_items
        )
        states.append(state)
        used_ids.add(topic_id)

    assigned: dict[str, int] = {}
    for index, state in enumerate(states):
        for item_id in state.item_ids:
            assigned.setdefault(item_id, index)
    for index, state in enumerate(states):
        for item_id in state.requested:
            if item_id not in live_items or item_id in fixed_items or item_id in assigned:
                continue
            current_topic = item_topic.get(item_id)
            if state.edited_by_human and current_topic not in (None, state.id):
                continue
            assigned[item_id] = index
            state.item_ids.append(item_id)

    state_by_id = {state.id: state for state in states}
    for item_id in sorted(fixed_items):
        fixed_topic_id = fixed_items[item_id]
        target_state = state_by_id.get(fixed_topic_id)
        if target_state is None:
            previous = existing.get(fixed_topic_id)
            if previous is None:
                continue
            target_state = _PlannedState(
                id=fixed_topic_id,
                title=previous.title,
                description_es=previous.description_es,
                cefr=previous.cefr,
                edited_by_human=previous.edited_by_human,
            )
            states.append(target_state)
            state_by_id[fixed_topic_id] = target_state
        if item_id not in assigned:
            assigned[item_id] = states.index(target_state)
            target_state.item_ids.append(item_id)

    # Un tema sin publicaciones y sin bloqueo no sobrevive al reagrupado.
    states = [state for state in states if state.item_ids or state.edited_by_human]

    changed: list[str] = []
    kept_ids: set[str] = set()
    for position, state in enumerate(states):
        input_hash = topic_input_hash(conn, state.item_ids)
        previous = existing.get(state.id)
        if previous is None:
            conn.execute(
                "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
                " generator, generator_version, input_hash, edited_by_human, created_at,"
                " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    state.id,
                    course_id,
                    state.title,
                    state.description_es,
                    state.cefr,
                    position,
                    generator,
                    generator_version,
                    input_hash,
                    int(state.edited_by_human),
                    now,
                    now,
                ),
            )
            changed.append(state.id)
        else:
            conn.execute(
                "UPDATE study_topics SET title = ?, description_es = ?, cefr = ?, position = ?,"
                " generator = ?, generator_version = ?, input_hash = ?, edited_by_human = ?,"
                " updated_at = ?, removed_at = NULL WHERE id = ?",
                (
                    state.title,
                    state.description_es,
                    state.cefr,
                    position,
                    generator,
                    generator_version,
                    input_hash,
                    int(state.edited_by_human),
                    now,
                    state.id,
                ),
            )
            old_items = {item_id for item_id, _position, _edited in links.get(state.id, ())}
            if (
                previous.removed_at is not None
                or old_items != set(state.item_ids)
                or previous.title != state.title
                or previous.input_hash != input_hash
            ):
                changed.append(state.id)
        kept_ids.add(state.id)

    for topic_id in sorted(set(existing) - kept_ids):
        conn.execute(
            "UPDATE study_topics SET removed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, topic_id),
        )

    conn.execute(
        "DELETE FROM study_topic_items WHERE topic_id IN"
        " (SELECT id FROM study_topics WHERE course_id = ?)",
        (course_id,),
    )
    for state in states:
        for position, item_id in enumerate(state.item_ids):
            conn.execute(
                "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
                " VALUES (?, ?, ?, ?)",
                (state.id, item_id, position, int(item_id in locked_items)),
            )
    return changed


# ---------------------------------------------------------------- consultas


def _q_items(
    conn: sqlite3.Connection, course_id: str
) -> list[tuple[str, str, str | None, str, str, str]]:
    return [
        (str(row[0]), str(row[1]), row[2], str(row[3]), str(row[4]), str(row[5]))
        for row in conn.execute(
            "SELECT i.id, COALESCE(i.title, ''), ct.name, COALESCE(s.json, ''), i.text,"
            " i.first_seen_at FROM items i"
            " LEFT JOIN topics ct ON ct.id = i.topic_id"
            " LEFT JOIN sheets s ON s.item_id = i.id"
            " WHERE i.course_id = ? AND i.deleted_at IS NULL"
            " ORDER BY i.first_seen_at, i.id",
            (course_id,),
        )
    ]


def _q_item_tags(conn: sqlite3.Connection, course_id: str) -> dict[str, list[str]]:
    tags: dict[str, list[str]] = {}
    for item_id, raw in conn.execute(
        "SELECT cs.item_id, c.tags FROM card_sources cs"
        " JOIN cards c ON c.id = cs.card_id"
        " JOIN items i ON i.id = cs.item_id"
        " WHERE i.course_id = ? AND i.deleted_at IS NULL"
        "   AND c.owner_user_id IS NULL AND c.removed_at IS NULL AND c.stale = 0"
        " ORDER BY cs.item_id, c.id",
        (course_id,),
    ):
        try:
            loaded = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(loaded, list):
            tags.setdefault(str(item_id), []).extend(
                str(tag) for tag in loaded if isinstance(tag, str)
            )
    return tags


def _q_topics(
    conn: sqlite3.Connection, course_id: str
) -> list[tuple[str, str, str, Cefr | None, int, int]]:
    return [
        (str(row[0]), str(row[1]), str(row[2]), row[3], int(row[4]), int(row[5]))
        for row in conn.execute(
            "SELECT id, title, description_es, cefr, position, edited_by_human"
            " FROM study_topics WHERE course_id = ? AND removed_at IS NULL"
            " ORDER BY position, id",
            (course_id,),
        )
    ]


def _q_topic_item_rows(conn: sqlite3.Connection, course_id: str) -> list[tuple[str, str, int]]:
    return [
        (str(row[0]), str(row[1]), int(row[2]))
        for row in conn.execute(
            "SELECT sti.topic_id, sti.item_id, sti.edited_by_human"
            " FROM study_topic_items sti"
            " JOIN study_topics t ON t.id = sti.topic_id"
            " JOIN items i ON i.id = sti.item_id"
            " WHERE t.course_id = ? AND t.removed_at IS NULL AND i.deleted_at IS NULL"
            " ORDER BY sti.topic_id, sti.position, sti.item_id",
            (course_id,),
        )
    ]


def _q_existing_topics(conn: sqlite3.Connection, course_id: str) -> dict[str, _ExistingTopic]:
    return {
        str(row[0]): _ExistingTopic(
            title=str(row[1]),
            description_es=str(row[2]),
            cefr=row[3],
            position=int(row[4]),
            edited_by_human=bool(row[5]),
            input_hash=str(row[6]),
            removed_at=row[7],
        )
        for row in conn.execute(
            "SELECT id, title, description_es, cefr, position, edited_by_human, input_hash,"
            " removed_at FROM study_topics WHERE course_id = ?",
            (course_id,),
        )
    }


def _q_current_links(
    conn: sqlite3.Connection, course_id: str
) -> dict[str, list[tuple[str, int, int]]]:
    linked: dict[str, list[tuple[str, int, int]]] = {}
    for topic_id, item_id, position, edited in conn.execute(
        "SELECT sti.topic_id, sti.item_id, sti.position, sti.edited_by_human"
        " FROM study_topic_items sti JOIN study_topics t ON t.id = sti.topic_id"
        " WHERE t.course_id = ? ORDER BY sti.topic_id, sti.position, sti.item_id",
        (course_id,),
    ):
        linked.setdefault(str(topic_id), []).append((str(item_id), int(position), int(edited)))
    return linked


def _q_live_items(conn: sqlite3.Connection, course_id: str) -> list[str]:
    return [
        str(row[0])
        for row in conn.execute(
            "SELECT id FROM items WHERE course_id = ? AND deleted_at IS NULL"
            " ORDER BY first_seen_at, id",
            (course_id,),
        )
    ]


def _q_study_topics(
    conn: sqlite3.Connection, *, course_id: str | None, topic_id: str | None = None
) -> list[StudyTopic]:
    query = (
        "SELECT t.id, t.course_id, t.title, t.description_es, t.cefr, t.position,"
        " t.edited_by_human, t.input_hash, t.edited_input_hash,"
        " COALESCE((SELECT json_group_array(item_id) FROM ("
        "   SELECT sti.item_id AS item_id FROM study_topic_items sti"
        "   JOIN items i ON i.id = sti.item_id"
        "   WHERE sti.topic_id = t.id AND i.deleted_at IS NULL"
        "   ORDER BY sti.position, sti.item_id)), '[]') AS item_ids,"
        " (SELECT COUNT(DISTINCT c.id) FROM study_topic_items sti"
        "   JOIN items i ON i.id = sti.item_id"
        "   JOIN card_sources cs ON cs.item_id = sti.item_id"
        "   JOIN cards c ON c.id = cs.card_id"
        "   WHERE sti.topic_id = t.id AND i.deleted_at IS NULL"
        "     AND c.owner_user_id IS NULL AND c.removed_at IS NULL AND c.stale = 0) AS card_count"
        " FROM study_topics t WHERE t.removed_at IS NULL"
    )
    params: list[object] = []
    if course_id is not None:
        query += " AND t.course_id = ?"
        params.append(course_id)
    if topic_id is not None:
        query += " AND t.id = ?"
        params.append(topic_id)
    query += " ORDER BY t.course_id, t.position, t.id"
    return [
        StudyTopic(
            id=str(row[0]),
            course_id=str(row[1]),
            title=str(row[2]),
            description_es=str(row[3]),
            cefr=row[4],
            position=int(row[5]),
            item_ids=[str(item_id) for item_id in json.loads(row[9])],
            card_count=int(row[10]),
            edited_by_human=bool(row[6]),
            source_changed=bool(row[6]) and row[8] is not None and row[8] != row[7],
        )
        for row in conn.execute(query, tuple(params))
    ]


def _summary(sheet_json: str, text: str) -> str:
    if sheet_json:
        try:
            parsed = json.loads(sheet_json)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            summary = parsed.get("summary_es")
            if isinstance(summary, str) and summary:
                return summary
    return text[:200]
