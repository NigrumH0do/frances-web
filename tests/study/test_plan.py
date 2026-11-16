"""Plan de estudio diario por reglas (AI-10). Reloj inyectado; sin LLM ni red."""

import sqlite3
import time
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.db import store as _store  # noqa: F401
from frances.stage import StageContext, make_context
from frances.study.plan import (
    build_week,
    ensure_today,
    plan_day_view,
    plan_for_day,
    run_plans,
    save_week,
    set_done,
)
from frances.timeutil import format_ts

# Lunes 2 de noviembre de 2026, 06:00 en Bogotá.
NOW = datetime(2026, 11, 2, 11, 0, tzinfo=UTC)
_T0 = format_ts(NOW)
_DAY = "2026-11-02"


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = make_context(tmp_path, {})
    try:
        conn = context.store.conn
        conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_T0,),
        )
        _user(conn, "u_1")
        yield context
    finally:
        context.store.close()


def _user(conn: sqlite3.Connection, user_id: str, disabled: bool = False) -> None:
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at, disabled_at)"
        " VALUES (?, ?, ?, 'x', 'user', ?, ?)",
        (user_id, f"{user_id}@example.test", user_id, _T0, _T0 if disabled else None),
    )


def _item(
    conn: sqlite3.Connection,
    item_id: str,
    *,
    kind: str = "coursework",
    title: str = "Tarea",
    due: str | None = None,
    first_seen: str = _T0,
) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state, creation_time,"
        " update_time, due_at, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', ?, ?, ?, '', 'PUBLISHED', ?, ?, ?, ?, '{}', ?, ?)",
        (item_id, kind, item_id, title, _T0, _T0, due, f"{item_id}-h", first_seen, _T0),
    )


def _card(
    conn: sqlite3.Connection,
    card_id: str,
    *,
    owner: str | None = None,
    stale: int = 0,
    removed_at: str | None = None,
    created_at: str = _T0,
) -> None:
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at, owner_user_id, removed_at)"
        " VALUES (?, 'vocab', ?, 'palabra', 'rules', '1', ?, ?, ?, ?, ?)",
        (card_id, card_id, stale, created_at, _T0, owner, removed_at),
    )


def _state(
    conn: sqlite3.Connection, user_id: str, card_id: str, due: str, suspended: int = 0
) -> None:
    conn.execute(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty, elapsed_days,"
        " scheduled_days, learning_steps, reps, lapses, state, last_review, suspended,"
        " flagged_hard, updated_at) VALUES (?, ?, ?, 1.0, 5.0, 0, 0, 0, 1, 0, 2, NULL, ?, 0, ?)",
        (user_id, card_id, due, suspended, _T0),
    )


def _topic(conn: sqlite3.Connection, topic_id: str, item_ids: list[str]) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, cefr, position,"
        " generator, generator_version, input_hash, created_at, updated_at)"
        " VALUES (?, 'c_1', ?, '', NULL, 0, 'rules', '1', 'h', ?, ?)",
        (topic_id, f"Tema {topic_id}", _T0, _T0),
    )
    for position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, position),
        )


def _quiz(
    conn: sqlite3.Connection,
    quiz_id: str,
    *,
    scope_kind: str = "topic",
    scope_id: str,
    stale: int = 0,
) -> None:
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash, prompt_version,"
        " model, stale, created_at) VALUES (?, ?, ?, ?, 'h', '1', 'm', ?, ?)",
        (quiz_id, scope_kind, scope_id, f"Examen {quiz_id}", stale, _T0),
    )


def _attempt(
    conn: sqlite3.Connection, user_id: str, quiz_id: str, score: float, finished: str = _T0
) -> None:
    conn.execute(
        "INSERT INTO quiz_attempts (user_id, quiz_id, answers_json, score, started_at,"
        " finished_at) VALUES (?, ?, '[]', ?, ?, ?)",
        (user_id, quiz_id, score, _T0, finished),
    )


def _at(ctx: StageContext, moment: datetime) -> StageContext:
    return replace(ctx, now=lambda: moment)


def test_today_orders_deadline_review_quiz_read(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_9", title="Tarea 3", due="2026-11-03T22:00:00.000000Z")
    _item(
        conn,
        "cw_8",
        kind="material",
        title="Clase 9",
        first_seen="2026-11-01T15:00:00.000000Z",
    )
    _quiz(conn, "qz_a", scope_kind="item", scope_id="cw_8")
    _attempt(conn, "u_1", "qz_a", 0.5)
    for n in range(7):
        _card(conn, f"c_{n}")
        _state(conn, "u_1", f"c_{n}", "2026-11-01T10:00:00.000000Z")

    plan = plan_for_day(
        conn, "u_1", date.fromisoformat(_DAY), today=date.fromisoformat(_DAY), daily_new_cards=0
    )

    assert [(e.kind, e.ref_id) for e in plan] == [
        ("read", "cw_9"),
        ("review", None),
        ("quiz", "qz_a"),
        ("read", "cw_8"),
    ]
    assert plan[0].reason_es == "Se entrega el 3/11."
    assert plan[0].title_es == "Preparar «Tarea 3»"
    assert plan[1].title_es == "Repasar 7 tarjetas"
    assert plan[1].reason_es == "7 vencen."
    assert plan[2].reason_es == "Tu último resultado fue 50 %."
    assert plan[2].title_es == "Quiz: Examen qz_a"
    assert plan[3].reason_es == "Publicación nueva del 1/11."


def test_deadline_due_today_says_so(ctx: StageContext) -> None:
    _item(ctx.store.conn, "cw_t", title="Tarea 4", due="2026-11-02T20:00:00.000000Z")

    plan = plan_for_day(
        ctx.store.conn,
        "u_1",
        date.fromisoformat(_DAY),
        today=date.fromisoformat(_DAY),
        daily_new_cards=0,
    )

    assert plan[0].reason_es == "Se entrega hoy."


def test_suspended_stale_removed_and_foreign_cards_do_not_count(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _user(conn, "u_2")
    overdue = "2026-11-01T10:00:00.000000Z"
    _card(conn, "c_ok")
    _state(conn, "u_1", "c_ok", overdue)
    _card(conn, "c_susp")
    _state(conn, "u_1", "c_susp", overdue, suspended=1)
    _card(conn, "c_stale", stale=1)
    _state(conn, "u_1", "c_stale", overdue)
    _card(conn, "c_removed", removed_at=_T0)
    _state(conn, "u_1", "c_removed", overdue)
    _card(conn, "c_foreign", owner="u_2")

    plan = plan_for_day(
        conn, "u_1", date.fromisoformat(_DAY), today=date.fromisoformat(_DAY), daily_new_cards=10
    )

    assert len(plan) == 1
    assert plan[0].title_es == "Repasar 1 tarjetas"
    assert plan[0].reason_es == "1 vencen."


def test_new_cards_respect_daily_limit(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _user(conn, "u_2")
    for n in range(5):
        _card(conn, f"c_{n}", created_at=f"2026-10-0{n + 1}T00:00:00.000000Z")
    _card(conn, "c_foreign", owner="u_2")

    plan = plan_for_day(
        conn, "u_1", date.fromisoformat(_DAY), today=date.fromisoformat(_DAY), daily_new_cards=2
    )

    assert [e.title_es for e in plan] == ["Repasar 2 tarjetas"]
    assert plan[0].reason_es == "2 son nuevas."


def test_new_cards_are_projected_once_across_the_week(ctx: StageContext) -> None:
    conn = ctx.store.conn
    for n in range(3):
        _card(conn, f"c_{n}", created_at=f"2026-10-0{n + 1}T00:00:00.000000Z")
    conn.execute(
        "INSERT INTO user_prefs (user_id, key, value_json, updated_at)"
        " VALUES ('u_1', 'daily_new_cards', '2', ?)",
        (_T0,),
    )

    week = build_week(conn, "u_1", NOW)

    assert [e.title_es for e in week["2026-11-02"]] == ["Repasar 2 tarjetas"]
    assert [e.title_es for e in week["2026-11-03"]] == ["Repasar 1 tarjetas"]
    assert week["2026-11-04"] == []


def test_quiz_of_deadline_topic_comes_first_and_caps_at_two(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_9", title="Tarea 3", due="2026-11-03T22:00:00.000000Z")
    _item(conn, "cw_new", kind="material", title="Clase 10", first_seen=_T0)
    _topic(conn, "t_1", ["cw_9"])
    _topic(conn, "t_2", ["cw_new"])
    _quiz(conn, "qt_1", scope_id="t_1")
    _quiz(conn, "qs_1", scope_id="t_1", stale=1)
    _quiz(conn, "qn_1", scope_id="t_2")
    _quiz(conn, "qz_a", scope_kind="item", scope_id="cw_old")
    _attempt(conn, "u_1", "qz_a", 0.2)

    plan = plan_for_day(
        conn, "u_1", date.fromisoformat(_DAY), today=date.fromisoformat(_DAY), daily_new_cards=0
    )

    assert [(e.kind, e.ref_id) for e in plan] == [
        ("read", "cw_9"),
        ("quiz", "qt_1"),
        ("quiz", "qz_a"),
        ("read", "cw_new"),
    ]


def test_plan_caps_at_six_entries(ctx: StageContext) -> None:
    conn = ctx.store.conn
    for n in range(7):
        _item(conn, f"cw_{n}", title=f"Tarea {n}", due=f"2026-11-02T{12 + n:02d}:00:00.000000Z")

    plan = plan_for_day(
        conn, "u_1", date.fromisoformat(_DAY), today=date.fromisoformat(_DAY), daily_new_cards=0
    )

    assert len(plan) == 6
    assert {e.kind for e in plan} == {"read"}


def test_week_has_seven_bogota_days_and_projects_due_cards(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _card(conn, "c_1")
    _state(conn, "u_1", "c_1", "2026-11-05T15:00:00.000000Z")

    week = build_week(conn, "u_1", NOW)

    assert list(week) == [f"2026-11-{d:02d}" for d in range(2, 9)]
    assert any(e.kind == "review" for e in week["2026-11-05"])
    assert not any(e.kind == "review" for e in week["2026-11-04"])
    kinds = {e.kind for days in week.values() for e in days}
    assert "drill" not in kinds


def test_regenerating_keeps_done_and_why(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_9", title="Tarea 3", due="2026-11-03T22:00:00.000000Z")
    save_week(conn, "u_1", build_week(conn, "u_1", NOW), _T0)
    set_done(conn, "u_1", _DAY, 0, True, _T0)
    conn.execute("UPDATE study_plan SET why_llm_es = 'porque sí' WHERE position = 0")

    save_week(conn, "u_1", build_week(conn, "u_1", NOW), _T0)

    entry = plan_day_view(conn, "u_1", _DAY).entries[0]
    assert entry.done
    assert entry.why_llm_es == "porque sí"


def test_set_done_roundtrip_and_missing_row(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _item(conn, "cw_9", title="Tarea 3", due="2026-11-03T22:00:00.000000Z")
    save_week(conn, "u_1", build_week(conn, "u_1", NOW), _T0)

    marked = set_done(conn, "u_1", _DAY, 0, True, _T0)
    unmarked = set_done(conn, "u_1", _DAY, 0, False, _T0)

    assert marked is not None and marked.done
    assert unmarked is not None and not unmarked.done
    assert set_done(conn, "u_1", _DAY, 99, True, _T0) is None


def test_ensure_today_is_idempotent_and_fast(ctx: StageContext) -> None:
    conn = ctx.store.conn
    conn.executemany(
        "INSERT INTO cards (id, kind, front_fr, back_es, generator, generator_version, stale,"
        " created_at, updated_at) VALUES (?, 'vocab', ?, 'x', 'rules', '1', 0, ?, ?)",
        [(f"c_{n}", f"mot {n}", _T0, _T0) for n in range(2000)],
    )
    conn.executemany(
        "INSERT INTO user_card_state (user_id, card_id, due, stability, difficulty, elapsed_days,"
        " scheduled_days, learning_steps, reps, lapses, state, suspended, flagged_hard, updated_at)"
        " VALUES ('u_1', ?, ?, 1.0, 5.0, 0, 0, 0, 1, 0, 2, 0, 0, ?)",
        [(f"c_{n}", "2026-10-30T10:00:00.000000Z", _T0) for n in range(0, 2000, 2)],
    )
    for n in range(300):
        _item(conn, f"cw_{n}", due=f"2026-11-0{2 + n % 3}T20:00:00.000000Z")

    started = time.perf_counter()
    ensure_today(ctx.store, "u_1", NOW)
    elapsed = time.perf_counter() - started
    writes = conn.total_changes
    ensure_today(ctx.store, "u_1", NOW)

    assert elapsed < 0.3
    assert conn.total_changes == writes


def test_run_plans_skips_disabled_users(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _user(conn, "u_2", disabled=True)
    _item(conn, "cw_9", title="Tarea 3", due="2026-11-03T22:00:00.000000Z")

    counts = run_plans(_at(ctx, NOW))

    assert counts["users"] == 1
    assert counts["errors"] == 0
    assert counts["entries"] > 0
    assert conn.execute("SELECT COUNT(*) FROM study_plan WHERE user_id = 'u_2'").fetchone() == (0,)
