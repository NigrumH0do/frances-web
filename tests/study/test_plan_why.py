"""«Por qué» del plan redactado por el LLM (AI-11). Sin red: LLM falso.

El «por qué» es opcional: su ausencia o su fallo nunca impide ver el plan. La
entrada del LLM lleva solo las tareas del día; ningún dato del usuario.
"""

import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_plan.
from frances.cards.llm import LlmUnavailable
from frances.config import Settings
from frances.db import store as _store  # noqa: F401
from frances.db.store import Store
from frances.stage import make_context
from frances.study.plan import plan_day_view
from frances.study.plan_why import WHY_RESERVE, run_why, why_for_today
from frances.timeutil import format_ts

# Lunes 2 de noviembre de 2026, 06:00 en Bogotá.
NOW = datetime(2026, 11, 2, 11, 0, tzinfo=UTC)
_T0 = format_ts(NOW)
_DAY = "2026-11-02"

_ENTRIES = [
    ("read", "cw_9", "Preparar «Tarea 3»", "Se entrega el 3/11."),
    ("review", None, "Repasar 7 tarjetas", "7 vencen."),
]


class FakeLlm:
    """Cumple ``JsonLlm``; guarda el último mensaje de usuario y cuenta llamadas."""

    def __init__(self, model: str, replies: list[Any]) -> None:
        self.model = model
        self.calls = 0
        self.last_user = ""
        self._replies = list(replies)

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type,
        prompt_version: str,
        **_: Any,
    ) -> dict[str, Any]:
        self.calls += 1
        self.last_user = user
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return dict(reply)


def _valid_why() -> dict[str, Any]:
    return {
        "lines": [
            {"position": 0, "why_es": "Mañana entregas la tarea."},
            {"position": 1, "why_es": "Repasar hoy fija el vocabulario."},
        ]
    }


def _user(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    disabled: bool = False,
    display_name: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at, disabled_at)"
        " VALUES (?, ?, ?, 'x', 'user', ?, ?)",
        (
            user_id,
            f"{user_id}@example.test",
            display_name or user_id,
            _T0,
            _T0 if disabled else None,
        ),
    )


def _plan(conn: sqlite3.Connection, user_id: str) -> None:
    for position, (kind, ref_id, title, reason) in enumerate(_ENTRIES):
        conn.execute(
            "INSERT INTO study_plan (user_id, day, position, kind, ref_id, title_es, reason_es,"
            " why_llm_es, done_at, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
            (user_id, _DAY, position, kind, ref_id, title, reason, _T0),
        )


@pytest.fixture
def settings() -> Settings:
    return Settings()


@pytest.fixture
def settings_cap_50() -> Settings:
    return Settings.model_validate({"llm": {"max_calls_per_day": 50}})


@pytest.fixture
def store_with_plan(tmp_path: Path) -> Iterator[Store]:
    opened = Store.open(tmp_path / "state.db")
    try:
        _user(opened.conn, "u_1", display_name="Alumno Uno")
        _plan(opened.conn, "u_1")
        yield opened
    finally:
        opened.close()


@pytest.fixture
def store_with_two_identical_plans(tmp_path: Path) -> Iterator[Store]:
    opened = Store.open(tmp_path / "state.db")
    try:
        _user(opened.conn, "u_1", display_name="Alumno Uno")
        _user(opened.conn, "u_2", display_name="Alumno Dos")
        _plan(opened.conn, "u_1")
        _plan(opened.conn, "u_2")
        yield opened
    finally:
        opened.close()


def test_why_is_written_per_position(store_with_plan: Store, settings: Settings) -> None:
    out = _valid_why()
    result = why_for_today(store_with_plan, FakeLlm(model="m", replies=[out]), settings, "u_1", NOW)

    assert result == "written"
    entries = plan_day_view(store_with_plan.conn, "u_1", _DAY).entries
    assert [entry.why_llm_es for entry in entries[:2]] == [line["why_es"] for line in out["lines"]]


def test_two_users_with_same_plan_share_cache(
    store_with_two_identical_plans: Store, settings: Settings
) -> None:
    llm = FakeLlm(model="m", replies=[_valid_why()])

    results = [
        why_for_today(store_with_two_identical_plans, llm, settings, user_id, NOW)
        for user_id in ("u_1", "u_2")
    ]

    assert results == ["written", "cached"]
    assert llm.calls == 1
    for user_id in ("u_1", "u_2"):
        entries = plan_day_view(store_with_two_identical_plans.conn, user_id, _DAY).entries
        assert [entry.why_llm_es for entry in entries] == [
            "Mañana entregas la tarea.",
            "Repasar hoy fija el vocabulario.",
        ]


def test_input_has_no_user_identity(store_with_plan: Store, settings: Settings) -> None:
    llm = FakeLlm(model="m", replies=[_valid_why()])

    why_for_today(store_with_plan, llm, settings, "u_1", NOW)

    assert "u_1" not in llm.last_user
    assert "@" not in llm.last_user
    assert "Alumno Uno" not in llm.last_user
    assert llm.last_user.startswith("Tareas:\n")


def test_low_budget_and_llm_failure_are_skipped(
    store_with_plan: Store, settings: Settings, settings_cap_50: Settings
) -> None:
    low_budget = FakeLlm(model="m", replies=[])
    assert (
        why_for_today(store_with_plan, low_budget, settings_cap_50, "u_1", NOW) == "skipped_budget"
    )
    assert low_budget.calls == 0

    assert (
        why_for_today(
            store_with_plan, FakeLlm(model="m", replies=[LlmUnavailable("x")]), settings, "u_1", NOW
        )
        == "skipped_llm"
    )
    entries = plan_day_view(store_with_plan.conn, "u_1", _DAY).entries
    assert all(entry.why_llm_es is None for entry in entries)


def test_reserve_boundary_leaves_sixty_calls_for_chat(
    store_with_plan: Store, settings: Settings
) -> None:
    exactly_reserve = Settings.model_validate({"llm": {"max_calls_per_day": WHY_RESERVE}})

    assert (
        why_for_today(
            store_with_plan, FakeLlm(model="m", replies=[_valid_why()]), exactly_reserve, "u_1", NOW
        )
        == "written"
    )

    below_reserve = Settings.model_validate({"llm": {"max_calls_per_day": WHY_RESERVE - 1}})
    assert (
        why_for_today(store_with_plan, FakeLlm(model="m", replies=[]), below_reserve, "u_1", NOW)
        == "skipped_budget"
    )


def test_llm_none_is_skipped_without_touching_plan(
    store_with_plan: Store, settings: Settings
) -> None:
    assert why_for_today(store_with_plan, None, settings, "u_1", NOW) == "skipped_llm"

    entries = plan_day_view(store_with_plan.conn, "u_1", _DAY).entries
    assert [entry.why_llm_es for entry in entries] == [None, None]


def test_invalid_output_is_skipped_and_plan_stays_readable(
    store_with_plan: Store, settings: Settings
) -> None:
    incomplete = {"lines": [{"position": 0, "why_es": "Falta la otra tarea."}]}

    assert (
        why_for_today(
            store_with_plan, FakeLlm(model="m", replies=[incomplete]), settings, "u_1", NOW
        )
        == "skipped_llm"
    )

    entries = plan_day_view(store_with_plan.conn, "u_1", _DAY).entries
    assert [(entry.kind, entry.title_es) for entry in entries] == [
        ("read", "Preparar «Tarea 3»"),
        ("review", "Repasar 7 tarjetas"),
    ]
    assert all(entry.why_llm_es is None for entry in entries)


def test_empty_plan_returns_empty_without_calling_llm(tmp_path: Path, settings: Settings) -> None:
    opened = Store.open(tmp_path / "state.db")
    try:
        _user(opened.conn, "u_1")
        llm = FakeLlm(model="m", replies=[])
        assert why_for_today(opened, llm, settings, "u_1", NOW) == "empty"
        assert llm.calls == 0
    finally:
        opened.close()


def test_run_why_counts_results_and_skips_disabled_users(tmp_path: Path) -> None:
    context = make_context(tmp_path, {})
    try:
        _user(context.store.conn, "u_1")
        _user(context.store.conn, "u_2", disabled=True)
        _plan(context.store.conn, "u_1")
        _plan(context.store.conn, "u_2")
        llm = FakeLlm(model="m", replies=[_valid_why()])

        counts = run_why(replace(context, now=lambda: NOW), llm)

        assert counts == {
            "written": 1,
            "cached": 0,
            "skipped_budget": 0,
            "skipped_llm": 0,
            "empty": 0,
        }
        assert llm.calls == 1
        disabled = plan_day_view(context.store.conn, "u_2", _DAY).entries
        assert all(entry.why_llm_es is None for entry in disabled)
    finally:
        context.store.close()


def test_run_why_respects_user_filter(tmp_path: Path) -> None:
    context = make_context(tmp_path, {})
    try:
        for user_id in ("u_1", "u_3"):
            _user(context.store.conn, user_id)
            _plan(context.store.conn, user_id)
        llm = FakeLlm(model="m", replies=[_valid_why()])

        counts = run_why(replace(context, now=lambda: NOW), llm, user_ids=["u_3"])

        assert counts["written"] == 1 and llm.calls == 1
        assert plan_day_view(context.store.conn, "u_1", _DAY).entries[0].why_llm_es is None
        assert plan_day_view(context.store.conn, "u_3", _DAY).entries[0].why_llm_es is not None
    finally:
        context.store.close()
