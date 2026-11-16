"""Edición humana de temas de estudio: renombrar, unir, dividir y mover (MGT-03).

Cada función escribe en la transacción del llamador o abre una ``BEGIN IMMEDIATE``
propia (mismo patrón que ``frances.jobs.queue``). Toda edición marca la fila con
``edited_by_human = 1`` y actualiza ``edited_input_hash`` con
:func:`frances.study.topics_repo.topic_input_hash`, la huella vigente de las
publicaciones del tema. Así el reagrupado de AI-07 conserva lo que hizo el admin
y ``source_changed`` no se queda encendido por la propia edición.

Los temas absorbidos por una unión se marcan ``removed_at`` y
``edited_by_human = 0``: no vuelven a aparecer en el siguiente reagrupado. El
tema dividido y los enlaces movidos/creados quedan bloqueados para que el
reagrupado no los deshaga.
"""

import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass

from frances.models.ids import new_topic_id
from frances.models.manage import (
    TopicItemsIn,
    TopicsMergeIn,
    TopicSplitIn,
    TopicUpdateIn,
)
from frances.models.study import Cefr, StudyTopic
from frances.study.topics_repo import get_study_topic, topic_input_hash


@dataclass(frozen=True)
class _TopicRow:
    id: str
    course_id: str
    title: str
    description_es: str
    cefr: Cefr | None
    position: int
    generator: str
    generator_version: str


@contextmanager
def _tx(conn: sqlite3.Connection) -> Iterator[None]:
    """``BEGIN IMMEDIATE`` propio, salvo que la conexión ya esté en una transacción."""
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


def _require_topic(conn: sqlite3.Connection, topic_id: str) -> _TopicRow:
    """Tema vivo por id; ``LookupError`` si no existe o está borrado."""
    row = conn.execute(
        "SELECT id, course_id, title, description_es, cefr, position, generator,"
        " generator_version FROM study_topics WHERE id = ? AND removed_at IS NULL",
        (topic_id,),
    ).fetchone()
    if row is None:
        raise LookupError(topic_id)
    return _TopicRow(
        id=str(row[0]),
        course_id=str(row[1]),
        title=str(row[2]),
        description_es=str(row[3]),
        cefr=row[4],
        position=int(row[5]),
        generator=str(row[6]),
        generator_version=str(row[7]),
    )


def _topic_item_ids(conn: sqlite3.Connection, topic_id: str) -> list[str]:
    """Publicaciones vivas del tema, en el orden guardado."""
    return [
        str(row[0])
        for row in conn.execute(
            "SELECT sti.item_id FROM study_topic_items sti"
            " JOIN items i ON i.id = sti.item_id"
            " WHERE sti.topic_id = ? AND i.deleted_at IS NULL"
            " ORDER BY sti.position, sti.item_id",
            (topic_id,),
        )
    ]


def _topic_out(conn: sqlite3.Connection, topic_id: str) -> StudyTopic:
    topic = get_study_topic(conn, topic_id)
    if topic is None:  # pragma: no cover - las funciones acaban de escribir la fila
        raise LookupError(topic_id)
    return topic


def _insert_links(conn: sqlite3.Connection, topic_id: str, item_ids: Sequence[str]) -> None:
    """Reinserta enlaces bloqueados con posiciones consecutivas."""
    for position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
            " VALUES (?, ?, ?, 1)",
            (topic_id, item_id, position),
        )


def _mark_edited(
    conn: sqlite3.Connection, topic_id: str, item_ids: Sequence[str], now: str
) -> None:
    """Marca el tema como editado y fija su huella vigente."""
    stamp = topic_input_hash(conn, item_ids)
    conn.execute(
        "UPDATE study_topics SET edited_by_human = 1, input_hash = ?, edited_input_hash = ?,"
        " updated_at = ? WHERE id = ?",
        (stamp, stamp, now, topic_id),
    )


def update_topic(
    conn: sqlite3.Connection, topic_id: str, body: TopicUpdateIn, now: str
) -> StudyTopic:
    """Renombra o cambia la descripción de un tema sin tocar su posición ni su CEFR."""
    with _tx(conn):
        current = _require_topic(conn, topic_id)
        item_ids = _topic_item_ids(conn, topic_id)
        title = body.title if body.title is not None else current.title
        description = (
            body.description_es if body.description_es is not None else current.description_es
        )
        conn.execute(
            "UPDATE study_topics SET title = ?, description_es = ?, updated_at = ? WHERE id = ?",
            (title, description, now, topic_id),
        )
        _mark_edited(conn, topic_id, item_ids, now)
        return _topic_out(conn, topic_id)


def merge_topics(conn: sqlite3.Connection, body: TopicsMergeIn, now: str) -> StudyTopic:
    """Une varios temas; el primero de ``topic_ids`` es el superviviente."""
    with _tx(conn):
        rows = [_require_topic(conn, topic_id) for topic_id in body.topic_ids]
        if len({row.course_id for row in rows}) != 1:
            raise ValueError("los temas pertenecen a cursos distintos")

        item_ids: list[str] = []
        for topic_id in body.topic_ids:
            for item_id in _topic_item_ids(conn, topic_id):
                if item_id not in item_ids:
                    item_ids.append(item_id)

        marks = ",".join("?" * len(body.topic_ids))
        conn.execute(
            f"DELETE FROM study_topic_items WHERE topic_id IN ({marks})",
            tuple(body.topic_ids),
        )
        conn.execute(
            "UPDATE study_topics SET title = ?, updated_at = ? WHERE id = ?",
            (body.title, now, body.topic_ids[0]),
        )
        absorbed = body.topic_ids[1:]
        absorbed_marks = ",".join("?" * len(absorbed))
        conn.execute(
            "UPDATE study_topics SET removed_at = ?, edited_by_human = 0, updated_at = ?"
            f" WHERE id IN ({absorbed_marks})",
            (now, now, *absorbed),
        )
        _insert_links(conn, body.topic_ids[0], item_ids)
        _mark_edited(conn, body.topic_ids[0], item_ids, now)
        return _topic_out(conn, body.topic_ids[0])


def split_topic(
    conn: sqlite3.Connection, topic_id: str, body: TopicSplitIn, now: str
) -> list[StudyTopic]:
    """Crea un tema nuevo con ``item_ids`` justo después del original."""
    with _tx(conn):
        original = _require_topic(conn, topic_id)
        current_items = _topic_item_ids(conn, topic_id)
        moved = list(body.item_ids)
        if any(item_id not in current_items for item_id in moved):
            raise ValueError("hay publicaciones que no pertenecen al tema")
        remaining = [item_id for item_id in current_items if item_id not in set(moved)]
        if not remaining:
            raise ValueError("el tema original no puede quedarse sin publicaciones")

        new_id = new_topic_id()
        new_position = original.position + 1
        conn.execute(
            "UPDATE study_topics SET position = position + 1"
            " WHERE course_id = ? AND removed_at IS NULL AND position >= ?",
            (original.course_id, new_position),
        )
        new_hash = topic_input_hash(conn, moved)
        conn.execute(
            "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
            " generator, generator_version, input_hash, edited_by_human, edited_input_hash,"
            " created_at, updated_at)"
            " VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 1, ?, ?, ?)",
            (
                new_id,
                original.course_id,
                body.title,
                original.cefr,
                new_position,
                original.generator,
                original.generator_version,
                new_hash,
                new_hash,
                now,
                now,
            ),
        )
        conn.execute(
            "DELETE FROM study_topic_items WHERE topic_id = ?",
            (topic_id,),
        )
        _insert_links(conn, topic_id, remaining)
        _insert_links(conn, new_id, moved)
        _mark_edited(conn, topic_id, remaining, now)
        return [_topic_out(conn, topic_id), _topic_out(conn, new_id)]


def move_items(conn: sqlite3.Connection, topic_id: str, body: TopicItemsIn, now: str) -> StudyTopic:
    """Mueve publicaciones al tema destino y deja vivo el tema origen."""
    with _tx(conn):
        destination = _require_topic(conn, topic_id)
        moved = list(body.item_ids)
        sources: dict[str, list[str]] = {}
        for item_id in moved:
            row = conn.execute(
                "SELECT sti.topic_id, t.course_id FROM study_topic_items sti"
                " JOIN study_topics t ON t.id = sti.topic_id"
                " JOIN items i ON i.id = sti.item_id"
                " WHERE sti.item_id = ? AND t.removed_at IS NULL AND i.deleted_at IS NULL",
                (item_id,),
            ).fetchone()
            if row is None or str(row[1]) != destination.course_id:
                raise ValueError("hay publicaciones que no se pueden mover")
            sources.setdefault(str(row[0]), []).append(item_id)

        moved_set = set(moved)
        destination_items = [
            item_id for item_id in _topic_item_ids(conn, topic_id) if item_id not in moved_set
        ]
        flags = {
            str(item_id): int(edited)
            for item_id, edited in conn.execute(
                "SELECT item_id, edited_by_human FROM study_topic_items WHERE topic_id = ?",
                (topic_id,),
            )
        }
        marks = ",".join("?" * len(moved))
        conn.execute(
            f"DELETE FROM study_topic_items WHERE item_id IN ({marks})",
            tuple(moved),
        )
        conn.execute("DELETE FROM study_topic_items WHERE topic_id = ?", (topic_id,))
        for position, item_id in enumerate(destination_items + moved):
            edited = 1 if item_id in moved_set else flags.get(item_id, 0)
            conn.execute(
                "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
                " VALUES (?, ?, ?, ?)",
                (topic_id, item_id, position, edited),
            )

        for source_id in sorted(sources):
            if source_id == topic_id:
                continue
            _mark_edited(conn, source_id, _topic_item_ids(conn, source_id), now)
        _mark_edited(conn, topic_id, _topic_item_ids(conn, topic_id), now)
        return _topic_out(conn, topic_id)
