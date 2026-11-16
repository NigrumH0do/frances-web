"""Repositorio de temas de estudio (AI-07): lectura, plan y escritura transaccional."""

import json
import sqlite3
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.db import store as _store  # noqa: F401
from frances.models.content import StudySheet
from frances.models.ids import content_hash
from frances.stage import StageContext, make_context
from frances.study.topics_repo import (
    PlannedTopic,
    TopicPlan,
    apply_plan,
    get_study_topic,
    list_study_topics,
    load_items,
    load_topics,
    topic_input_hash,
)

_NOW = "2026-11-02T10:00:00Z"


def _course(conn: sqlite3.Connection, course_id: str = "c_1") -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json)"
        " VALUES (?, ?, 'ACTIVE', ?, '{}')",
        (course_id, f"Cours {course_id}", _NOW),
    )


def _classroom_topic(conn: sqlite3.Connection, topic_id: str, name: str) -> None:
    conn.execute(
        "INSERT INTO topics (id, course_id, name, update_time) VALUES (?, 'c_1', ?, ?)",
        (topic_id, name, _NOW),
    )


def _item(
    conn: sqlite3.Connection,
    item_id: str,
    *,
    title: str = "Leçon",
    text: str = "",
    classroom_topic_id: str | None = None,
    first_seen: str = _NOW,
    deleted_at: str | None = None,
    course_id: str = "c_1",
) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, topic_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at,"
        " deleted_at) VALUES (?, ?, 'coursework', ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?, ?)",
        (
            item_id,
            course_id,
            item_id,
            classroom_topic_id,
            title,
            text,
            _NOW,
            _NOW,
            f"{item_id}-hash",
            first_seen,
            _NOW,
            deleted_at,
        ),
    )


def _generation(conn: sqlite3.Connection, item_id: str, input_hash: str) -> None:
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES (?, ?, 'cards', 'cards-1', ?)",
        (item_id, input_hash, _NOW),
    )


def _study_topic(
    conn: sqlite3.Connection,
    topic_id: str,
    *,
    title: str = "Tema",
    description: str = "",
    cefr: str | None = None,
    position: int = 0,
    locked: bool = False,
    input_hash: str = "entrada-anterior",
    edited_input_hash: str | None = None,
    removed_at: str | None = None,
    item_ids: Sequence[str] = (),
    locked_items: Sequence[str] = (),
    course_id: str = "c_1",
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, edited_input_hash,"
        " created_at, updated_at, removed_at)"
        " VALUES (?, ?, ?, ?, ?, ?, 'rules', 'rules-1', ?, ?, ?, ?, ?, ?)",
        (
            topic_id,
            course_id,
            title,
            description,
            cefr,
            position,
            input_hash,
            int(locked),
            edited_input_hash,
            _NOW,
            _NOW,
            removed_at,
        ),
    )
    for item_position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position, edited_by_human)"
            " VALUES (?, ?, ?, ?)",
            (topic_id, item_id, item_position, int(item_id in locked_items)),
        )


def _card(
    conn: sqlite3.Connection,
    card_id: str,
    *,
    tags: Sequence[str] = (),
    owner: str | None = None,
    stale: int = 0,
    removed_at: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, tags, generator, generator_version,"
        " stale, created_at, updated_at, owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, 'palabra', ?, 'rules', 'rules-1', ?, ?, ?, ?, ?)",
        (card_id, card_id, json.dumps(list(tags)), stale, _NOW, _NOW, owner, removed_at),
    )


def _card_source(conn: sqlite3.Connection, card_id: str, item_id: str) -> None:
    conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (card_id, item_id))


def _sheet(conn: sqlite3.Connection, item_id: str, summary: str) -> None:
    sheet = StudySheet(
        item_id=item_id,
        summary_es=summary,
        vocab_card_ids=[],
        grammar=[],
        key_phrases=[],
    )
    conn.execute(
        "INSERT INTO sheets (item_id, json, generator, generator_version, updated_at)"
        " VALUES (?, ?, 'study', 'sheet-1', ?)",
        (item_id, sheet.model_dump_json(), _NOW),
    )


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = make_context(tmp_path, {})
    try:
        _course(context.store.conn)
        yield context
    finally:
        context.store.close()


def test_load_items_uses_sheet_summary_classroom_topic_and_tags(ctx: StageContext) -> None:
    conn = ctx.store.conn
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES ('u_1', 'u_1@example.test', 'u_1', 'x', 'user', ?)",
        (_NOW,),
    )
    _classroom_topic(conn, "ct_u1", "Unité 1")
    _item(conn, "cw_1", text="Texte de la leçon.", classroom_topic_id="ct_u1")
    _item(conn, "cw_borrada", text="Otra lección.", deleted_at=_NOW)
    _sheet(conn, "cw_1", "Resumen de la ficha.")
    _card(conn, "c_1", tags=["saludos", "famille"])
    _card(conn, "c_2", tags=["saludos", "verbes"])
    _card(conn, "c_3", tags=["a", "b", "c"])
    _card(conn, "c_suelta", tags=["no-cuenta"])
    _card(conn, "c_privada", tags=["privado"], owner="u_1")
    _card(conn, "c_vieja", tags=["viejo"], stale=1)
    for card_id in ("c_1", "c_2", "c_3", "c_privada", "c_vieja"):
        _card_source(conn, card_id, "cw_1")
    _card_source(conn, "c_3", "cw_borrada")

    items = load_items(conn, "c_1")

    assert [item.item_id for item in items] == ["cw_1"]
    assert items[0].summary_es == "Resumen de la ficha."
    assert items[0].classroom_topic == "Unité 1"
    assert items[0].tags == ("a", "b", "c", "famille", "saludos")


def test_load_items_falls_back_to_first_200_chars_without_sheet(ctx: StageContext) -> None:
    text = "x" * 250
    _item(ctx.store.conn, "cw_1", text=text)
    info = load_items(ctx.store.conn, "c_1")[0]
    assert info.summary_es == text[:200]
    assert info.classroom_topic is None and info.tags == ()


def test_load_topics_orders_by_position_and_collects_item_locks(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _item(conn, "cw_2")
    _study_topic(conn, "t_b", position=1, item_ids=["cw_2"], locked_items=["cw_2"])
    _study_topic(conn, "t_a", position=0, item_ids=["cw_1"])
    _study_topic(conn, "t_borrado", position=2, item_ids=[], removed_at=_NOW)

    topics = load_topics(conn, "c_1")

    assert [topic.id for topic in topics] == ["t_a", "t_b"]
    assert topics[0].item_ids == ("cw_1",)
    assert topics[0].locked_item_ids == frozenset()
    assert topics[1].item_ids == ("cw_2",)
    assert topics[1].locked_item_ids == frozenset({"cw_2"})


def test_topic_input_hash_sorts_ids_and_uses_current_generations(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_b")
    _item(conn, "cw_a")
    _item(conn, "cw_sin_generacion")
    _generation(conn, "cw_b", "h-b")
    _generation(conn, "cw_a", "h-a")

    assert topic_input_hash(conn, ["cw_b", "cw_a"]) == content_hash("cw_a:h-a", "cw_b:h-b")
    assert topic_input_hash(conn, ["cw_sin_generacion"]) == content_hash("cw_sin_generacion:")


def test_apply_plan_creates_updates_removes_and_keeps_locked_empty(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _item(conn, "cw_2")
    _item(conn, "cw_3")
    _item(conn, "cw_4")
    _item(conn, "cw_borrada", deleted_at=_NOW)
    _study_topic(conn, "t_live", title="Viejo", item_ids=["cw_1"])
    _study_topic(conn, "t_locked", title="Fijo", cefr="B1", item_ids=["cw_2"], locked=True)
    _study_topic(conn, "t_empty", item_ids=[])
    _study_topic(conn, "t_locked_empty", title="Fijo vacío", item_ids=[], locked=True)

    plan = TopicPlan(
        topics=[
            PlannedTopic(
                id="t_live",
                title="Nuevo",
                description_es="Descripción nueva",
                cefr="A2",
                item_ids=["cw_3", "cw_borrada", "cw_1"],
                edited_by_human=False,
            ),
            PlannedTopic(
                id=None,
                title="Creado",
                description_es="Tema nuevo",
                cefr=None,
                item_ids=["cw_4"],
                edited_by_human=False,
            ),
            PlannedTopic(
                id=None,
                title="Vacío",
                description_es="No debe crearse",
                cefr=None,
                item_ids=[],
                edited_by_human=False,
            ),
        ]
    )
    changed = apply_plan(
        conn,
        "c_1",
        plan,
        generator="rules",
        generator_version="rules-1",
        now=_NOW,
    )

    rows = {
        row[0]: row
        for row in conn.execute("SELECT id, title, cefr, input_hash, removed_at FROM study_topics")
    }
    created = next(topic_id for (topic_id, row) in rows.items() if row[1] == "Creado")
    assert rows["t_live"][1:3] == ("Nuevo", "A2")
    assert rows["t_live"][3] == topic_input_hash(conn, ["cw_1", "cw_3"])
    assert rows["t_locked"][1:3] == ("Fijo", "B1") and rows["t_locked"][4] is None
    assert rows["t_empty"][4] == _NOW and rows["t_locked_empty"][4] is None
    assert _topic_items(conn, "t_live") == ["cw_3", "cw_1"]
    assert _topic_items(conn, "t_locked") == ["cw_2"]
    assert _topic_items(conn, "t_locked_empty") == []
    assert _topic_items(conn, created) == ["cw_4"]
    assert "Vacío" not in {row[1] for row in rows.values()}
    assert {"t_live", created} <= set(changed) and "t_empty" not in changed


def test_apply_plan_restores_locked_item_to_its_topic_and_keeps_the_flag(
    ctx: StageContext,
) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _item(conn, "cw_2")
    _study_topic(conn, "t_a", item_ids=["cw_1"])
    _study_topic(conn, "t_b", item_ids=["cw_2"], locked_items=["cw_2"])

    apply_plan(
        conn,
        "c_1",
        TopicPlan(
            topics=[
                PlannedTopic(
                    id="t_a",
                    title="Tema A",
                    description_es="",
                    cefr=None,
                    item_ids=["cw_1", "cw_2"],
                    edited_by_human=False,
                )
            ]
        ),
        generator="llm",
        generator_version="topics-1",
        now=_NOW,
    )

    assert _topic_items(conn, "t_a") == ["cw_1"]
    assert _topic_items(conn, "t_b") == ["cw_2"]
    assert (
        conn.execute(
            "SELECT edited_by_human FROM study_topic_items WHERE topic_id = 't_b'"
            " AND item_id = 'cw_2'"
        ).fetchone()[0]
        == 1
    )


def test_apply_plan_keeps_foreign_items_out_of_locked_topic(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _item(conn, "cw_2")
    _study_topic(conn, "t_a", item_ids=["cw_1"], locked=True)
    _study_topic(conn, "t_b", item_ids=["cw_2"])
    apply_plan(
        conn,
        "c_1",
        TopicPlan(
            topics=[
                PlannedTopic(
                    id="t_a",
                    title="Tema A",
                    description_es="",
                    cefr=None,
                    item_ids=["cw_1", "cw_2"],
                    edited_by_human=True,
                ),
                PlannedTopic(
                    id="t_b",
                    title="Tema B",
                    description_es="",
                    cefr=None,
                    item_ids=["cw_2"],
                    edited_by_human=False,
                ),
            ]
        ),
        generator="llm",
        generator_version="topics-1",
        now=_NOW,
    )
    assert _topic_items(conn, "t_a") == ["cw_1"]
    assert _topic_items(conn, "t_b") == ["cw_2"]


def test_apply_plan_does_not_rename_locked_topic(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _study_topic(
        conn,
        "t_fijo",
        title="Título fijo",
        description="Descripción fija",
        cefr="A2",
        item_ids=["cw_1"],
        locked=True,
    )
    apply_plan(
        conn,
        "c_1",
        TopicPlan(
            topics=[
                PlannedTopic(
                    id="t_fijo",
                    title="Otro título",
                    description_es="Otra descripción",
                    cefr="C1",
                    item_ids=["cw_1"],
                    edited_by_human=True,
                )
            ]
        ),
        generator="llm",
        generator_version="topics-1",
        now=_NOW,
    )
    row = conn.execute(
        "SELECT title, description_es, cefr, edited_by_human FROM study_topics WHERE id = 't_fijo'"
    ).fetchone()
    assert row == ("Título fijo", "Descripción fija", "A2", 1)
    item_flag = conn.execute(
        "SELECT edited_by_human FROM study_topic_items"
        " WHERE topic_id = 't_fijo' AND item_id = 'cw_1'"
    ).fetchone()[0]
    assert item_flag == 0


def test_apply_plan_is_idempotent_and_reports_only_real_changes(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _study_topic(conn, "t_1", title="Tema", item_ids=["cw_1"])
    plan = TopicPlan(
        topics=[
            PlannedTopic(
                id="t_1",
                title="Tema",
                description_es="",
                cefr=None,
                item_ids=["cw_1"],
                edited_by_human=False,
            )
        ]
    )
    assert apply_plan(
        conn, "c_1", plan, generator="rules", generator_version="rules-1", now=_NOW
    ) == ["t_1"]
    assert (
        apply_plan(conn, "c_1", plan, generator="rules", generator_version="rules-1", now=_NOW)
        == []
    )
    renamed = TopicPlan(
        topics=[
            PlannedTopic(
                id="t_1",
                title="Otro",
                description_es="",
                cefr=None,
                item_ids=["cw_1"],
                edited_by_human=False,
            )
        ]
    )
    assert apply_plan(
        conn, "c_1", renamed, generator="rules", generator_version="rules-1", now=_NOW
    ) == ["t_1"]


def test_list_study_topics_counts_only_shared_live_cards(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1")
    _item(conn, "cw_2")
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES ('u_1', 'u_1@example.test', 'u_1', 'x', 'user', ?)",
        (_NOW,),
    )
    _study_topic(conn, "t_1", title="Tema", item_ids=["cw_1", "cw_2"])
    _card(conn, "c_shared")
    _card(conn, "c_shared2")
    _card(conn, "c_stale", stale=1)
    _card(conn, "c_removed", removed_at=_NOW)
    _card(conn, "c_owned", owner="u_1")
    _card_source(conn, "c_shared", "cw_1")
    _card_source(conn, "c_shared2", "cw_2")
    _card_source(conn, "c_stale", "cw_1")
    _card_source(conn, "c_removed", "cw_2")
    _card_source(conn, "c_owned", "cw_1")

    topic = get_study_topic(conn, "t_1")

    assert topic is not None and topic.card_count == 2 and topic.item_ids == ["cw_1", "cw_2"]
    assert get_study_topic(conn, "t_inexistente") is None


def test_list_study_topics_source_changed_needs_human_edit(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _study_topic(
        conn,
        "t_cambiada",
        input_hash="ahora",
        edited_input_hash="viejo",
        locked=True,
    )
    _study_topic(
        conn,
        "t_sin_bloqueo",
        input_hash="ahora",
        edited_input_hash="viejo",
        locked=False,
    )
    _study_topic(conn, "t_igual", input_hash="ahora", edited_input_hash="ahora", locked=True)
    _study_topic(conn, "t_sin_hash", input_hash="ahora", edited_input_hash=None, locked=True)

    topics = {topic.id: topic for topic in list_study_topics(conn, "c_1")}

    assert topics["t_cambiada"].source_changed is True
    assert topics["t_sin_bloqueo"].source_changed is False
    assert topics["t_igual"].source_changed is False
    assert topics["t_sin_hash"].source_changed is False


def test_list_study_topics_filters_course_and_removed(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _course(conn, "c_2")
    _study_topic(conn, "t_viva")
    _study_topic(conn, "t_borrada", removed_at=_NOW)
    _study_topic(conn, "t_otro_curso", course_id="c_2")

    assert [topic.id for topic in list_study_topics(conn, "c_1")] == ["t_viva"]
    assert {topic.id for topic in list_study_topics(conn, None)} == {"t_viva", "t_otro_curso"}


def _topic_items(conn: sqlite3.Connection, topic_id: str) -> list[str]:
    return [
        str(row[0])
        for row in conn.execute(
            "SELECT item_id FROM study_topic_items WHERE topic_id = ? ORDER BY position, item_id",
            (topic_id,),
        )
    ]
