"""Edición humana de temas de estudio: renombrar, unir, dividir y mover (MGT-03).

Todo es sintético y sin red. El reagrupado se prueba con el respaldo por reglas
de AI-07 (``llm=None``), que es el camino que corre con la IA apagada, y con el
mismo ``regroup_course`` que usa el pipeline.
"""

import sqlite3
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage).
from frances.db import store as _store  # noqa: F401
from frances.manage.topics import merge_topics, move_items, split_topic, update_topic
from frances.models.manage import TopicItemsIn, TopicsMergeIn, TopicSplitIn, TopicUpdateIn
from frances.stage import StageContext, make_context
from frances.study.topics import regroup_course
from frances.study.topics_repo import get_study_topic, list_study_topics, topic_input_hash

NOW = "2026-11-03T00:00:00.000000Z"
T0 = "2026-11-02T10:00:00Z"


class _FakeLlm:
    """Cliente mínimo de AI-07: devuelve siempre la misma salida JSON."""

    def __init__(self, reply: dict[str, Any]) -> None:
        self.model = "modelo-de-prueba"
        self._reply = reply

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type,
        prompt_version: str,
        **_: Any,
    ) -> dict[str, Any]:
        return dict(self._reply)


def _course(conn: sqlite3.Connection, course_id: str = "c_1") -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES (?, 'Cours synthétique', 'ACTIVE', ?, '{}')",
        (course_id, T0),
    )


def _item(conn: sqlite3.Connection, item_id: str, *, course_id: str = "c_1") -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, ?, 'coursework', ?, ?, 'Texte de prueba.', 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, course_id, item_id, f"Leçon {item_id}", T0, T0, f"{item_id}-hash", T0, T0),
    )


def _generation(conn: sqlite3.Connection, item_id: str) -> None:
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, ?, 'cards', 'cards-1', ?)",
        (item_id, f"in-{item_id}", T0),
    )


def _study_topic(
    conn: sqlite3.Connection,
    topic_id: str,
    title: str,
    item_ids: Sequence[str],
    *,
    position: int = 0,
    locked: bool = False,
    edited_input_hash: str | None = None,
    course_id: str = "c_1",
) -> None:
    input_hash = topic_input_hash(conn, item_ids)
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, edited_input_hash,"
        " created_at, updated_at)"
        " VALUES (?, ?, ?, '', NULL, ?, 'rules', 'rules-1', ?, ?, ?, ?, ?)",
        (
            topic_id,
            course_id,
            title,
            position,
            input_hash,
            int(locked),
            edited_input_hash,
            T0,
            T0,
        ),
    )
    for item_position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, item_position),
        )


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = make_context(tmp_path, {})
    try:
        _course(context.store.conn)
        for item_id in ("cw_1", "cw_2", "cw_3"):
            _item(context.store.conn, item_id)
            _generation(context.store.conn, item_id)
        yield context
    finally:
        context.store.close()


@pytest.fixture
def conn(ctx: StageContext) -> sqlite3.Connection:
    return ctx.store.conn


@pytest.fixture
def topic(ctx: StageContext) -> str:
    """Un tema bloqueado con tres publicaciones y la huella desfasada."""
    _study_topic(
        ctx.store.conn,
        "tp_1",
        "Tout",
        ["cw_1", "cw_2", "cw_3"],
        locked=True,
        edited_input_hash="viejo",
    )
    return "tp_1"


@pytest.fixture
def topics(ctx: StageContext) -> None:
    """Dos temas: tp_1 con cw_1/cw_2 y tp_2 con cw_3."""
    _study_topic(ctx.store.conn, "tp_1", "Tout", ["cw_1", "cw_2"], position=0)
    _study_topic(ctx.store.conn, "tp_2", "Nombres", ["cw_3"], position=1)


def test_update_topic_keeps_id_and_clears_source_changed(
    conn: sqlite3.Connection, topic: str
) -> None:
    before = get_study_topic(conn, "tp_1")
    assert before is not None and before.source_changed is True
    out = update_topic(conn, "tp_1", TopicUpdateIn(title="Salutations"), NOW)
    assert out.id == "tp_1" and out.title == "Salutations"
    assert out.edited_by_human is True and out.source_changed is False
    assert out.item_ids == before.item_ids


def test_merge_moves_items_and_removes_absorbed_topics(
    conn: sqlite3.Connection, topics: None
) -> None:
    out = merge_topics(conn, TopicsMergeIn(topic_ids=["tp_1", "tp_2"], title="Tout"), NOW)
    assert out.id == "tp_1" and set(out.item_ids) == {"cw_1", "cw_2", "cw_3"}
    absorbed = conn.execute(
        "SELECT removed_at, edited_by_human FROM study_topics WHERE id = 'tp_2'"
    ).fetchone()
    assert absorbed is not None and absorbed[0] is not None and absorbed[1] == 0
    assert out.edited_by_human is True
    edited_links = conn.execute(
        "SELECT COUNT(*) FROM study_topic_items WHERE topic_id = 'tp_1' AND edited_by_human = 1"
    ).fetchone()
    assert edited_links is not None and edited_links[0] == 3


def test_split_creates_new_topic_and_keeps_original(conn: sqlite3.Connection, topic: str) -> None:
    out = split_topic(conn, "tp_1", TopicSplitIn(item_ids=["cw_3"], title="Nombres"), NOW)
    assert {t.title: set(t.item_ids) for t in out} == {
        "Tout": {"cw_1", "cw_2"},
        "Nombres": {"cw_3"},
    }
    assert out[0].id == "tp_1" and out[1].id != "tp_1"
    assert out[1].position == out[0].position + 1


def test_move_items_between_topics(conn: sqlite3.Connection, topics: None) -> None:
    out = move_items(conn, "tp_2", TopicItemsIn(item_ids=["cw_1"]), NOW)
    assert set(out.item_ids) == {"cw_1", "cw_3"}
    edited = conn.execute(
        "SELECT edited_by_human FROM study_topic_items WHERE item_id = 'cw_1'"
    ).fetchone()
    assert edited is not None and edited[0] == 1
    source = get_study_topic(conn, "tp_1")
    assert source is not None and set(source.item_ids) == {"cw_2"}
    assert source.edited_by_human is True


def test_admin_topic_edits_survive_regroup(
    ctx: StageContext, topics: None
) -> None:  # REVIEW FOCUS 4
    merge_topics(ctx.store.conn, TopicsMergeIn(topic_ids=["tp_1", "tp_2"], title="Tout"), NOW)
    regroup_course(ctx, None, "c_1", allow_rules=True)
    merged = [t for t in list_study_topics(ctx.store.conn, "c_1") if t.title == "Tout"]
    assert len(merged) == 1 and set(merged[0].item_ids) == {"cw_1", "cw_2", "cw_3"}
    assert all(t.id != "tp_2" for t in list_study_topics(ctx.store.conn, "c_1"))


def test_merged_topic_survives_llm_regroup_and_keeps_its_title(
    ctx: StageContext, topics: None
) -> None:
    merge_topics(ctx.store.conn, TopicsMergeIn(topic_ids=["tp_1", "tp_2"], title="Tout"), NOW)
    reply = {
        "topics": [
            {
                "key": "todo",
                "existing_topic_id": None,
                "title": "Todo junto",
                "description_es": "",
                "cefr": None,
                "item_ids": ["cw_1", "cw_2", "cw_3"],
            }
        ]
    }
    regroup_course(ctx, _FakeLlm(reply), "c_1", allow_rules=False)
    after = list_study_topics(ctx.store.conn, "c_1")
    assert [(topic.id, topic.title) for topic in after] == [("tp_1", "Tout")]
    assert set(after[0].item_ids) == {"cw_1", "cw_2", "cw_3"}


def test_renamed_topic_survives_regroup(ctx: StageContext, topics: None) -> None:
    update_topic(ctx.store.conn, "tp_1", TopicUpdateIn(title="Salutations"), NOW)
    regroup_course(ctx, None, "c_1", allow_rules=True)
    renamed = get_study_topic(ctx.store.conn, "tp_1")
    assert renamed is not None
    assert renamed.title == "Salutations" and set(renamed.item_ids) == {"cw_1", "cw_2"}


def test_split_topic_survives_regroup(ctx: StageContext, topics: None) -> None:
    first, second = split_topic(
        ctx.store.conn, "tp_1", TopicSplitIn(item_ids=["cw_2"], title="Division"), NOW
    )
    regroup_course(ctx, None, "c_1", allow_rules=True)
    after = {t.title: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert set(after["Tout"].item_ids) == {"cw_1"}
    assert set(after["Division"].item_ids) == {"cw_2"}
    assert after["Division"].id == second.id and after["Tout"].id == first.id


def test_moved_items_survive_regroup(ctx: StageContext, topics: None) -> None:
    move_items(ctx.store.conn, "tp_2", TopicItemsIn(item_ids=["cw_1"]), NOW)
    regroup_course(ctx, None, "c_1", allow_rules=True)
    destination = get_study_topic(ctx.store.conn, "tp_2")
    source = get_study_topic(ctx.store.conn, "tp_1")
    assert destination is not None and set(destination.item_ids) == {"cw_1", "cw_3"}
    assert source is not None and set(source.item_ids) == {"cw_2"}
    assert source.edited_by_human is True


def test_split_rejects_all_items(conn: sqlite3.Connection, topic: str) -> None:
    with pytest.raises(ValueError):
        split_topic(
            conn, "tp_1", TopicSplitIn(item_ids=["cw_1", "cw_2", "cw_3"], title="Todo"), NOW
        )


def test_update_unknown_topic_raises_lookup(conn: sqlite3.Connection) -> None:
    with pytest.raises(LookupError):
        update_topic(conn, "tp_inexistente", TopicUpdateIn(title="Nada"), NOW)


def test_move_rejects_item_from_another_course(conn: sqlite3.Connection, topics: None) -> None:
    _course(conn, "c_2")
    _item(conn, "cw_x", course_id="c_2")
    _generation(conn, "cw_x")
    _study_topic(conn, "tp_x", "Otro curso", ["cw_x"], position=0, course_id="c_2")
    with pytest.raises(ValueError):
        move_items(conn, "tp_1", TopicItemsIn(item_ids=["cw_x"]), NOW)
