"""Reagrupado de temas del curso y respaldo por reglas (AI-07).

Todo es sintético. El LLM se simula con ``FakeLlm``; ningún test abre la red.
"""

import json
import sqlite3
import time
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.cards.llm import LlmUnavailable
from frances.db import store as _store  # noqa: F401
from frances.stage import StageContext, make_context
from frances.study.topics import regroup_all, regroup_course
from frances.study.topics_repo import list_study_topics

from .conftest import FakeLlm

_NOW = "2026-11-02T10:00:00Z"
_EVAL_CASES = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval" / "cases"


def _course(conn: sqlite3.Connection, course_id: str = "c_1", included: int = 1) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json, included)"
        " VALUES (?, ?, 'ACTIVE', ?, '{}', ?)",
        (course_id, f"Cours {course_id}", _NOW, included),
    )


def _classroom_topic(conn: sqlite3.Connection, topic_id: str, name: str) -> None:
    conn.execute(
        "INSERT INTO topics (id, course_id, name, update_time) VALUES (?, 'c_1', ?, ?)",
        (topic_id, name, _NOW),
    )


def _item(
    conn: sqlite3.Connection,
    item_id: str,
    title: str,
    *,
    classroom_topic_id: str | None = None,
    first_seen: str = _NOW,
    text: str = "",
    course_id: str = "c_1",
) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, topic_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, ?, 'coursework', ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
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
    title: str,
    item_ids: Sequence[str],
    *,
    position: int = 0,
    locked: bool = False,
    input_hash: str = "entrada-anterior",
    cefr: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, edited_by_human, created_at, updated_at)"
        " VALUES (?, 'c_1', ?, '', ?, ?, 'rules', 'rules-1', ?, ?, ?, ?)",
        (topic_id, title, cefr, position, input_hash, int(locked), _NOW, _NOW),
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
        yield context
    finally:
        context.store.close()


@pytest.fixture
def course_with_items(ctx: StageContext) -> list[str]:
    """5 publicaciones: 3 en «Unité 1», 1 en «Unité 2» y 1 sin tema de Classroom."""
    conn = ctx.store.conn
    _classroom_topic(conn, "ct_u1", "Unité 1")
    _classroom_topic(conn, "ct_u2", "Unité 2")
    rows = [
        ("cw_1", "Les salutations", "ct_u1", "2026-10-01T10:00:00Z"),
        ("cw_2", "Les nombres", "ct_u1", "2026-10-02T10:00:00Z"),
        ("cw_3", "La famille", "ct_u1", "2026-10-03T10:00:00Z"),
        ("cw_4", "La routine", "ct_u2", "2026-10-04T10:00:00Z"),
        ("cw_5", "Le passé", None, "2026-10-05T10:00:00Z"),
    ]
    for item_id, title, topic_id, first_seen in rows:
        _item(conn, item_id, title, classroom_topic_id=topic_id, first_seen=first_seen)
        _generation(conn, item_id, f"in-{item_id}")
    return [row[0] for row in rows]


@pytest.fixture
def course_with_topics(ctx: StageContext, course_with_items: list[str]) -> None:
    """Temas previos de una entrada anterior (su ``input_hash`` está desfasado)."""
    conn = ctx.store.conn
    _study_topic(conn, "tp_saludos", "Saludos", ["cw_1"], position=0)
    _study_topic(conn, "tp_numeros", "Números", ["cw_2", "cw_3"], position=1)
    _study_topic(conn, "tp_rutina", "Rutina", ["cw_4"], position=2)
    _study_topic(conn, "tp_otros", "Otros temas", ["cw_5"], position=3)


@pytest.fixture
def course_from_eval_case(ctx: StageContext) -> dict[str, Any]:
    """Curso sintético con los ids del caso «topics/sin-bloqueos» de AI-03."""
    case = json.loads((_EVAL_CASES / "topics" / "sin-bloqueos.json").read_text(encoding="utf-8"))
    _classroom_topic(ctx.store.conn, "ct_unidad", "Unidad de prueba")
    for position, item in enumerate(case["input"]["items"]):
        _item(
            ctx.store.conn,
            item["id"],
            item["title"],
            classroom_topic_id="ct_unidad",
            first_seen=f"2026-10-{position + 1:02d}T10:00:00Z",
            text=item["summary_es"],
        )
        _generation(ctx.store.conn, item["id"], f"in-{item['id']}")
    return case


@pytest.fixture
def big_course(ctx: StageContext) -> None:
    """2 000 publicaciones repartidas en 30 temas."""
    with ctx.store.tx() as tx:
        tx.executemany(
            "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
            " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
            " VALUES (?, 'c_1', 'coursework', ?, ?, 'Texte.', 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
            [
                (f"cw_{n:04d}", f"cw_{n:04d}", f"Leçon {n}", _NOW, _NOW, f"h{n}", _NOW, _NOW)
                for n in range(2000)
            ],
        )
        for position in range(30):
            topic_id = f"tp_{position:02d}"
            tx.execute(
                "INSERT INTO study_topics (id, course_id, title, description_es, position,"
                " generator, generator_version, input_hash, created_at, updated_at)"
                " VALUES (?, 'c_1', ?, '', ?, 'rules', 'rules-1', 'h', ?, ?)",
                (topic_id, f"Tema {position}", position, _NOW, _NOW),
            )
            member_ids = [f"cw_{n:04d}" for n in range(position, 2000, 30)]
            tx.executemany(
                "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
                [(topic_id, item_id, index) for index, item_id in enumerate(member_ids)],
            )


def live_item_ids(ctx: StageContext, course_id: str = "c_1") -> list[str]:
    return [
        str(row[0])
        for row in ctx.store.conn.execute(
            "SELECT id FROM items WHERE course_id = ? AND deleted_at IS NULL ORDER BY id",
            (course_id,),
        )
    ]


def lock_topic(ctx: StageContext, topic_id: str, *, title: str) -> None:
    ctx.store.conn.execute(
        "UPDATE study_topics SET edited_by_human = 1, title = ? WHERE id = ?",
        (title, topic_id),
    )


def lock_item(ctx: StageContext, topic_id: str, item_id: str) -> None:
    ctx.store.conn.execute(
        "UPDATE study_topic_items SET edited_by_human = 1 WHERE topic_id = ? AND item_id = ?",
        (topic_id, item_id),
    )


def _llm_topic(
    key: str,
    title: str,
    item_ids: Sequence[str],
    *,
    existing: str | None = None,
    cefr: str | None = "A1",
) -> dict[str, Any]:
    return {
        "key": key,
        "existing_topic_id": existing,
        "title": title,
        "description_es": "Tema sintético de prueba.",
        "cefr": cefr,
        "item_ids": list(item_ids),
    }


def _plan_for_classroom_topics(ctx: StageContext, course_id: str = "c_1") -> dict[str, Any]:
    """Salida válida del LLM que agrupa por tema de Classroom (o «Otros temas»)."""
    rows = ctx.store.conn.execute(
        "SELECT i.id, COALESCE(t.name, 'Otros temas') FROM items i"
        " LEFT JOIN topics t ON t.id = i.topic_id"
        " WHERE i.course_id = ? AND i.deleted_at IS NULL ORDER BY i.id",
        (course_id,),
    ).fetchall()
    grouped: dict[str, list[str]] = {}
    for item_id, title in rows:
        grouped.setdefault(str(title), []).append(str(item_id))
    return {
        "topics": [
            _llm_topic(f"t{index}", title, item_ids)
            for index, (title, item_ids) in enumerate(grouped.items())
        ]
    }


def _same_grouping_new_titles(ctx: StageContext, course_id: str = "c_1") -> dict[str, Any]:
    rows = ctx.store.conn.execute(
        "SELECT t.id, t.title, sti.item_id FROM study_topics t"
        " JOIN study_topic_items sti ON sti.topic_id = t.id"
        " WHERE t.course_id = ? AND t.removed_at IS NULL"
        " ORDER BY t.position, sti.position, sti.item_id",
        (course_id,),
    ).fetchall()
    grouped: dict[str, tuple[str, list[str]]] = {}
    for topic_id, title, item_id in rows:
        grouped.setdefault(str(topic_id), (str(title), []))[1].append(str(item_id))
    return {
        "topics": [
            _llm_topic(f"n{index}", f"Nuevo {title}", item_ids)
            for index, (title, item_ids) in enumerate(grouped.values())
        ]
    }


def _topics_json(plan: dict[str, Any]) -> dict[str, Any]:
    return {"topics": plan["topics"]}


def test_omitted_items_stay_in_their_current_topic(
    ctx: StageContext, course_with_topics: None
) -> None:
    out = {"topics": [_llm_topic("a", "Saludos nuevos", ["cw_1"])]}
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    tp = {t.id: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert tp["tp_saludos"].title == "Saludos nuevos"
    assert set(tp["tp_numeros"].item_ids) == {"cw_2", "cw_3"}
    assert set(tp["tp_rutina"].item_ids) == {"cw_4"}
    assert set(tp["tp_otros"].item_ids) == {"cw_5"}


def test_omitted_items_without_topic_go_through_the_rules(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    out = {"topics": [_llm_topic("a", "Introducción", ["cw_1"])]}
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    topics = list_study_topics(ctx.store.conn, "c_1")
    titles = {t.title: len(t.item_ids) for t in topics}
    assert titles == {"Introducción": 1, "Unité 1": 2, "Unité 2": 1, "Otros temas": 1}
    assert sorted(i for t in topics for i in t.item_ids) == sorted(course_with_items)


def test_rules_fallback_groups_by_classroom_topic(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    res = regroup_course(ctx, None, "c_1", allow_rules=True)
    titles = {t.title: len(t.item_ids) for t in list_study_topics(ctx.store.conn, "c_1")}
    assert res.source == "rules" and titles == {"Unité 1": 3, "Unité 2": 1, "Otros temas": 1}
    assert sorted(i for t in list_study_topics(ctx.store.conn, "c_1") for i in t.item_ids) == (
        course_with_items
    )


def test_locked_topic_does_not_absorb_items_from_another_topic(
    ctx: StageContext,
) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1", "Les salutations")
    _item(conn, "cw_2", "Les nombres")
    _study_topic(conn, "tp_a", "Saludos", ["cw_1"], position=0, locked=True)
    _study_topic(conn, "tp_b", "Números", ["cw_2"], position=1)
    out = {
        "topics": [
            _llm_topic("a", "Saludos", ["cw_1", "cw_2"], existing="tp_a"),
        ]
    }
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    tp = {t.id: t for t in list_study_topics(conn, "c_1")}
    assert set(tp["tp_a"].item_ids) == {"cw_1"}
    assert set(tp["tp_b"].item_ids) == {"cw_2"}


def test_locked_topic_accepts_new_items_without_current_topic(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_1", "Les salutations")
    _item(conn, "cw_2", "Les nombres")
    _study_topic(conn, "tp_a", "Saludos", ["cw_1"], position=0, locked=True)
    out = {
        "topics": [
            _llm_topic("a", "Saludos", ["cw_1", "cw_2"], existing="tp_a"),
        ]
    }
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    tp = {t.id: t for t in list_study_topics(conn, "c_1")}
    assert set(tp["tp_a"].item_ids) == {"cw_1", "cw_2"}


def test_rules_fallback_reuses_existing_otros_temas(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    _study_topic(ctx.store.conn, "tp_otros", "Otros temas", ["cw_1"], position=0)
    regroup_course(ctx, None, "c_1", allow_rules=True)
    topics = list_study_topics(ctx.store.conn, "c_1")
    otros = [topic for topic in topics if topic.title == "Otros temas"]
    assert len(otros) == 1
    assert set(otros[0].item_ids) == {"cw_1", "cw_5"}


def test_llm_omitted_unclassified_item_reuses_existing_otros_temas(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    _study_topic(ctx.store.conn, "tp_otros", "Otros temas", ["cw_1"], position=0)
    out = {"topics": [_llm_topic("a", "Lecciones", ["cw_2", "cw_3", "cw_4"])]}
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    topics = list_study_topics(ctx.store.conn, "c_1")
    otros = [topic for topic in topics if topic.title == "Otros temas"]
    assert len(otros) == 1
    assert set(otros[0].item_ids) == {"cw_1", "cw_5"}


def test_rules_fallback_puts_new_items_in_matching_current_topic(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    _study_topic(ctx.store.conn, "tp_unite1", "Unité 1", [], position=0)
    regroup_course(ctx, None, "c_1", allow_rules=True)
    topics = {t.id: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert set(topics["tp_unite1"].item_ids) == {"cw_1", "cw_2", "cw_3"}


def test_llm_plan_every_item_exactly_once(
    ctx: StageContext, course_from_eval_case: dict[str, Any]
) -> None:
    expected = [dict(topic) for topic in course_from_eval_case["expected"]["topics"]]
    expected[0] = {**expected[0], "item_ids": [*expected[0]["item_ids"], "syn-inventado"]}
    expected[1] = {**expected[1], "item_ids": [*expected[1]["item_ids"], "syn-saludos"]}
    regroup_course(
        ctx,
        FakeLlm(model="m", replies=[_topics_json({"topics": expected})]),
        "c_1",
        allow_rules=False,
    )
    assigned = [i for t in list_study_topics(ctx.store.conn, "c_1") for i in t.item_ids]
    assert sorted(assigned) == sorted(live_item_ids(ctx, "c_1"))
    assert "syn-inventado" not in assigned


def test_regroup_respects_locked_topics_and_items(
    ctx: StageContext, course_with_topics: None
) -> None:  # REVIEW FOCUS P10-5
    lock_topic(ctx, "tp_saludos", title="Saludar y despedirse")
    lock_item(ctx, "tp_numeros", "cw_3")
    out = {"topics": [_llm_topic("a", "Todo junto", live_item_ids(ctx, "c_1"))]}
    regroup_course(ctx, FakeLlm(model="m", replies=[out]), "c_1", allow_rules=False)
    tp = {t.id: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert tp["tp_saludos"].title == "Saludar y despedirse" and "cw_3" in tp["tp_numeros"].item_ids
    assert sorted(i for t in tp.values() for i in t.item_ids) == sorted(live_item_ids(ctx, "c_1"))


def test_rules_fallback_respects_locked_topic_and_item(
    ctx: StageContext, course_with_topics: None
) -> None:
    lock_topic(ctx, "tp_saludos", title="Saludar y despedirse")
    lock_item(ctx, "tp_numeros", "cw_3")
    res = regroup_course(ctx, None, "c_1", allow_rules=True)
    tp = {t.id: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert res.source == "rules"
    assert tp["tp_saludos"].title == "Saludar y despedirse"
    assert "cw_3" in tp["tp_numeros"].item_ids
    assert sorted(i for t in tp.values() for i in t.item_ids) == sorted(live_item_ids(ctx, "c_1"))


def test_topic_ids_are_stable_across_regroups(
    ctx: StageContext, course_with_topics: None
) -> None:  # REVIEW FOCUS P10-5
    before = {frozenset(t.item_ids): t.id for t in list_study_topics(ctx.store.conn, "c_1")}
    regroup_course(
        ctx,
        FakeLlm(model="m", replies=[_same_grouping_new_titles(ctx)]),
        "c_1",
        allow_rules=False,
    )
    after = {frozenset(t.item_ids): t.id for t in list_study_topics(ctx.store.conn, "c_1")}
    assert before == after


def test_unchanged_input_is_cached_and_reports_no_changes(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    llm = FakeLlm(model="m", replies=[_plan_for_classroom_topics(ctx)])
    first = regroup_course(ctx, llm, "c_1", allow_rules=False)
    again = regroup_course(ctx, llm, "c_1", allow_rules=False)
    assert first.source == "llm" and first.changed
    assert again.source == "cached" and again.changed == [] and llm.calls == 1


def test_prompt_version_bump_forces_a_new_call(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    llm = FakeLlm(
        model="m",
        replies=[_plan_for_classroom_topics(ctx), _plan_for_classroom_topics(ctx)],
    )
    regroup_course(ctx, llm, "c_1", allow_rules=False)
    ctx.store.conn.execute("UPDATE study_topics SET generator_version = 'topics-0'")
    again = regroup_course(ctx, llm, "c_1", allow_rules=False)
    assert llm.calls == 2 and again.source == "unchanged"


def test_empty_unlocked_topic_is_removed_locked_is_kept(
    ctx: StageContext, course_with_topics: None
) -> None:
    conn = ctx.store.conn
    _study_topic(conn, "tp_vacio", "Sin publicaciones", [], position=4)
    _study_topic(conn, "tp_fijo", "Tema fijo vacío", [], position=5, locked=True)
    regroup_course(
        ctx,
        FakeLlm(model="m", replies=[_same_grouping_new_titles(ctx)]),
        "c_1",
        allow_rules=False,
    )
    removed = dict(conn.execute("SELECT id, removed_at FROM study_topics").fetchall())
    assert removed["tp_vacio"] is not None and removed["tp_fijo"] is None


def test_source_changed_flag(ctx: StageContext, course_with_topics: None) -> None:
    conn = ctx.store.conn
    conn.execute(
        "UPDATE study_topics SET edited_by_human = 1, edited_input_hash = 'viejo'"
        " WHERE id = 'tp_saludos'"
    )
    conn.execute(
        "UPDATE study_topics SET edited_input_hash = 'viejo', edited_by_human = 0"
        " WHERE id = 'tp_numeros'"
    )
    tp = {t.id: t for t in list_study_topics(ctx.store.conn, "c_1")}
    assert tp["tp_saludos"].source_changed is True
    assert tp["tp_numeros"].source_changed is False


def test_list_topics_under_300ms(ctx: StageContext, big_course: None) -> None:
    started = time.perf_counter()
    topics = list_study_topics(ctx.store.conn, "c_1")
    elapsed = time.perf_counter() - started
    assert len(topics) == 30 and sum(len(topic.item_ids) for topic in topics) == 2000
    assert elapsed < 0.3


def test_llm_failure_without_topics_writes_rules_then_reraises(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    with pytest.raises(LlmUnavailable, match="caído"):
        regroup_course(
            ctx,
            FakeLlm(model="m", replies=[LlmUnavailable("caído")]),
            "c_1",
            allow_rules=False,
        )
    assert len(list_study_topics(ctx.store.conn, "c_1")) == 3


def test_llm_failure_with_allow_rules_keeps_topics(
    ctx: StageContext, course_with_topics: None
) -> None:
    res = regroup_course(
        ctx,
        FakeLlm(model="m", replies=[LlmUnavailable("caído")]),
        "c_1",
        allow_rules=True,
    )
    assert res.source == "rules" and res.fallback_reason is not None
    assert len(list_study_topics(ctx.store.conn, "c_1")) == 4


def test_rejected_llm_output_is_not_cached_and_falls_back(
    ctx: StageContext, course_with_items: list[str]
) -> None:
    bad = {"topics": [_llm_topic("a", "", live_item_ids(ctx, "c_1"))]}
    res = regroup_course(
        ctx,
        FakeLlm(model="m", replies=[bad]),
        "c_1",
        allow_rules=True,
    )
    assert res.source == "rules"
    assert ctx.store.conn.execute("SELECT COUNT(*) FROM llm_cache").fetchone()[0] == 0


def test_regroup_all_only_included_courses(ctx: StageContext, course_with_items: list[str]) -> None:
    _course(ctx.store.conn, "c_2", included=0)
    results = regroup_all(ctx, None, allow_rules=True)
    assert [result.course_id for result in results] == ["c_1"]
