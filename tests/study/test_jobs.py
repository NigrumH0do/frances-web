"""Handlers de los trabajos de estudio encadenados tras el pipeline (AI-13).

Todo es sintético y sin red: el LLM se sustituye por un doble que despacha por
tarea. Los trabajos se ejecutan con el worker real (`run_one`), así los tests
cubren también el backoff de la cola y el respaldo por reglas del último
intento.
"""

import json
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

import frances.study.jobs as jobs_mod
from frances.cards.llm import LlmBudgetExceeded, LlmUnavailable

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.db import store as _store  # noqa: F401
from frances.errors import AuthError
from frances.jobs.queue import Job, enqueue, get_job
from frances.jobs.registry import HandlerRegistry
from frances.jobs.scheduler import FOLLOW_UPS
from frances.jobs.worker import run_one
from frances.models import StudySheet
from frances.stage import StageContext, make_context
from frances.study.jobs import (
    defer_to_tomorrow,
    is_last_attempt,
    register_handlers,
)
from frances.study.quiz import QuizRunResult
from frances.timeutil import format_ts

#: 05:17 en Bogotá: el día siguiente empieza a las 00:05 locales = 05:05 UTC.
NOW = datetime(2026, 11, 2, 10, 17, tzinfo=UTC)
TS = format_ts(NOW)
COURSE_ID = "c_1"
ITEM_IDS = ["cw_1", "cw_2", "cw_3"]
_TEXT = (
    "Bonjour, comment ça va aujourd\u2019hui ? Très bien, merci !\n\n"
    "Esta lección presenta los saludos formales e informales.\n\n"
    "Salut ! Ça va ? Oui, ça va bien, merci.\n\n"
    "Le matin, on dit bonjour à tout le monde."
)
_EVAL_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval" / "cases"


class Clock:
    """Reloj inyectado que solo avanza cuando el test lo pide."""

    def __init__(self, moment: datetime) -> None:
        self.moment = moment

    def __call__(self) -> datetime:
        return self.moment

    def advance(self, delta: timedelta) -> None:
        self.moment += delta


class FakeLlm:
    """Doble de `JsonLlm` que despacha la respuesta según `task`.

    Un valor `Exception` se lanza siempre (fallo persistente); un `dict` se
    devuelve siempre; una `list` se consume en orden.
    """

    def __init__(self, replies: Mapping[str, Any]) -> None:
        self.model = "modelo-falso"
        self.calls: list[str] = []
        self._replies = {
            task: list(value) if isinstance(value, list) else value
            for task, value in replies.items()
        }

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type,
        prompt_version: str,
        **_: Any,
    ) -> dict[str, Any]:
        self.calls.append(task)
        if task not in self._replies:
            raise AssertionError(f"tarea LLM no preparada: {task}")
        value = self._replies[task]
        if isinstance(value, list):
            if not value:
                raise AssertionError(f"sin respuestas preparadas para {task}")
            value = value.pop(0)
        if isinstance(value, Exception):
            raise value
        return dict(value)


@contextmanager
def fake_llm(ctx: StageContext, **replies: Any) -> Iterator[FakeLlm]:
    """Sustituye `frances.study.jobs.study_llm` por un doble por tarea."""
    fake = FakeLlm(replies)
    with patch.object(jobs_mod, "study_llm", lambda _ctx: fake):
        yield fake


def _eval_case(task: str, case_id: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (_EVAL_DIR / task / f"{case_id}.json").read_text(encoding="utf-8")
    )
    return data


def ok_sheet() -> dict[str, Any]:
    return dict(_eval_case("sheet", "saludos")["expected"])


def ok_topics(item_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "topics": [
            {
                "key": "saludos",
                "existing_topic_id": None,
                "title": "Primeros pasos",
                "description_es": "Tema sintético de prueba.",
                "cefr": "A1",
                "item_ids": list(item_ids or ITEM_IDS),
            }
        ]
    }


def ok_quiz() -> dict[str, Any]:
    return dict(_eval_case("quiz", "saludos")["expected"])


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json, included)"
        " VALUES (?, 'Français 1', 'ACTIVE', ?, '{}', 1)",
        (COURSE_ID, TS),
    )
    conn.execute(
        "INSERT INTO topics (id, course_id, name, update_time) VALUES ('ct_1', ?, 'Unité 1', ?)",
        (COURSE_ID, TS),
    )
    for position, item_id in enumerate(ITEM_IDS, start=1):
        conn.execute(
            "INSERT INTO items (id, course_id, kind, classroom_id, topic_id, title, text,"
            " state, creation_time, update_time, content_hash, raw_json, first_seen_at,"
            " last_seen_at) VALUES (?, ?, 'coursework', ?, 'ct_1', ?, ?, 'PUBLISHED', ?, ?,"
            " ?, '{}', ?, ?)",
            (
                item_id,
                COURSE_ID,
                item_id,
                f"Leçon {position}",
                _TEXT,
                TS,
                TS,
                f"content-{position}",
                TS,
                TS,
            ),
        )
        conn.execute(
            "INSERT INTO generations (item_id, input_hash, generator, generator_version,"
            " created_at) VALUES (?, ?, 'llm', '1', ?)",
            (item_id, f"input-{position}", TS),
        )
        base = StudySheet(
            item_id=item_id,
            summary_es="Resumen base sintético.",
            vocab_card_ids=[],
            grammar=[],
            key_phrases=[],
        )
        conn.execute(
            "INSERT INTO sheets (item_id, json, generator, generator_version, updated_at)"
            " VALUES (?, ?, 'llm', '1', ?)",
            (item_id, base.model_dump_json(), TS),
        )

    cards = [
        ("c_bonjour", "vocab", "bonjour", "buenos días", "Bonjour, comment ça va ?"),
        ("c_merci", "vocab", "merci", "gracias", "Oui, ça va bien, merci."),
        ("c_salut", "vocab", "salut", "hola", None),
        ("c_matin", "vocab", "matin", "mañana", "Le matin, on dit bonjour."),
        ("c_monde", "vocab", "monde", "mundo", "Bonjour à tout le monde."),
        (
            "c_phrase",
            "phrase",
            "Comment ça va aujourd\u2019hui ?",
            "¿Cómo estás hoy?",
            None,
        ),
    ]
    for card_id, kind, front_fr, back_es, example_fr in cards:
        conn.execute(
            "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es,"
            " generator, generator_version, stale, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, NULL, 'cards', 'cards-1', 0, ?, ?)",
            (card_id, kind, front_fr, back_es, example_fr, TS, TS),
        )
        conn.execute(
            "INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)",
            (card_id, ITEM_IDS[0]),
        )

    conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, updated_at) VALUES ('aud_1', ?, ?, 'v1', 'familia', '1', 'done', ?)",
        ("Comment ça va aujourd\u2019hui ?", "comment ca va aujourd hui", TS),
    )
    conn.execute(
        "INSERT INTO card_audio (card_id, field, cache_key) VALUES ('c_phrase', 'front', 'aud_1')"
    )
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES ('u_1', 'u_1@example.test', 'Alumno', 'x', 'user', ?)",
        (TS,),
    )


def _add_second_course(conn: sqlite3.Connection) -> None:
    """Segundo curso incluido, sin temas de estudio, para el respaldo por curso."""
    conn.execute(
        "INSERT INTO courses (id, name, state, update_time, raw_json, included)"
        " VALUES ('c_2', 'Français 2', 'ACTIVE', ?, '{}', 1)",
        (TS,),
    )
    conn.execute(
        "INSERT INTO topics (id, course_id, name, update_time)"
        " VALUES ('ct_2', 'c_2', 'Unité 2', ?)",
        (TS,),
    )
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, topic_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES ('cw_20', 'c_2', 'coursework', 'cw_20', 'ct_2', 'Deuxième leçon', ?,"
        " 'PUBLISHED', ?, ?, 'content-20', '{}', ?, ?)",
        (_TEXT, TS, TS, TS, TS),
    )
    conn.execute(
        "INSERT INTO generations (item_id, input_hash, generator, generator_version, created_at)"
        " VALUES ('cw_20', 'input-20', 'llm', '1', ?)",
        (TS,),
    )


@pytest.fixture
def worker_clock() -> Clock:
    return Clock(NOW)


@pytest.fixture
def worker_ctx(tmp_path: Path, worker_clock: Clock) -> Iterator[StageContext]:
    context = replace(make_context(tmp_path, {}), now=worker_clock)
    _seed(context.store.conn)
    try:
        yield context
    finally:
        context.store.close()


@pytest.fixture
def worker_ctx_llm_off(tmp_path: Path, worker_clock: Clock) -> Iterator[StageContext]:
    data_dir = tmp_path / "apagado"
    data_dir.mkdir()
    (data_dir / "frances.toml").write_text('[llm]\nmode = "off"\n', encoding="utf-8")
    context = replace(make_context(data_dir, {}), now=worker_clock)
    _seed(context.store.conn)
    try:
        yield context
    finally:
        context.store.close()


def _job(kind: str, *, attempts: int = 1, max_attempts: int = 5) -> Job:
    return Job(
        id=1,
        kind=kind,  # type: ignore[arg-type]
        payload={},
        state="running",
        priority=0,
        attempts=attempts,
        max_attempts=max_attempts,
        run_after=TS,
        dedupe_key=None,
        locked_by="test",
        last_error=None,
        created_at=TS,
        updated_at=TS,
    )


def full_registry() -> HandlerRegistry:
    reg = HandlerRegistry()
    register_handlers(reg)
    return reg


def enqueue_follow_ups_like_pipeline(ctx: StageContext, slot: str = "2026-11-02") -> None:
    """Los FOLLOW_UPS que SRV-07 encola tras un pipeline.daily con cambios."""
    for kind in FOLLOW_UPS["pipeline.daily"]:
        enqueue(
            ctx.store.conn,
            kind,
            {"slot": slot},
            now=ctx.now(),
            dedupe_key=f"{kind}:{slot}",
        )


def run_one_at(ctx: StageContext, reg: HandlerRegistry, *, advance: timedelta) -> int | None:
    clock = ctx.now
    assert isinstance(clock, Clock)
    clock.advance(advance)
    return run_one(ctx, reg, "w1")


def drain(ctx: StageContext, reg: HandlerRegistry) -> None:
    for _ in range(200):
        if run_one(ctx, reg, "w1") is None:
            return
    raise AssertionError("la cola no se vació")


def done_kinds(ctx: StageContext) -> list[str]:
    return [
        str(row[0])
        for row in ctx.store.conn.execute(
            "SELECT kind FROM jobs WHERE state = 'done' ORDER BY id"
        ).fetchall()
    ]


def only_queued(ctx: StageContext, kind: str) -> Job:
    rows = ctx.store.conn.execute(
        "SELECT id FROM jobs WHERE kind = ? AND state = 'queued' ORDER BY id", (kind,)
    ).fetchall()
    assert len(rows) == 1
    job = get_job(ctx.store.conn, int(rows[0][0]))
    assert job is not None
    return job


def all_items_have_sheet(ctx: StageContext) -> bool:
    row = ctx.store.conn.execute(
        "SELECT COUNT(*) FROM items i LEFT JOIN sheets s ON s.item_id = i.id"
        " WHERE i.deleted_at IS NULL AND s.item_id IS NULL"
    ).fetchone()
    return int(row[0]) == 0


def _count(ctx: StageContext, table: str) -> int:
    return int(ctx.store.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def result_of(ctx: StageContext, job_id: int) -> dict[str, Any]:
    row = ctx.store.conn.execute("SELECT result FROM jobs WHERE id = ?", (job_id,)).fetchone()
    assert row is not None
    loaded: dict[str, Any] = json.loads(row[0] or "{}")
    return loaded


def test_registers_the_five_study_kinds() -> None:
    reg = HandlerRegistry()
    register_handlers(reg)
    assert reg.kinds() == {
        "index.text_blocks",
        "llm.sheet",
        "llm.topics",
        "llm.quiz",
        "plan.daily",
    }


def test_is_last_attempt_counts_the_current_attempt() -> None:
    assert is_last_attempt(_job("llm.sheet", attempts=4, max_attempts=5)) is False
    assert is_last_attempt(_job("llm.sheet", attempts=5, max_attempts=5)) is True


def test_defer_to_tomorrow_uses_next_bogota_day(worker_ctx: StageContext) -> None:
    first = defer_to_tomorrow(worker_ctx.store.conn, "llm.sheet", {}, NOW)
    second = defer_to_tomorrow(worker_ctx.store.conn, "llm.sheet", {}, NOW)

    job = get_job(worker_ctx.store.conn, first)
    assert job is not None
    assert first == second
    assert job.run_after == "2026-11-03T05:05:00.000000Z"
    assert job.dedupe_key == "llm.sheet:deferred:2026-11-03"


def test_pipeline_follow_ups_reach_study_handlers(worker_ctx: StageContext) -> None:
    reg = full_registry()
    enqueue_follow_ups_like_pipeline(worker_ctx)
    with fake_llm(worker_ctx, sheet=ok_sheet(), topics=ok_topics(), quiz=ok_quiz()):
        drain(worker_ctx, reg)

    kinds = done_kinds(worker_ctx)
    assert kinds[:3] == ["index.text_blocks", "llm.sheet", "llm.topics"]
    assert "llm.quiz" in kinds
    assert all_items_have_sheet(worker_ctx)


def test_sheet_llm_down_retries_then_fails_but_base_sheets_stay(
    worker_ctx: StageContext,
) -> None:
    reg = full_registry()
    jid = enqueue(worker_ctx.store.conn, "llm.sheet", now=worker_ctx.now())
    with fake_llm(worker_ctx, sheet=LlmUnavailable("caído")):
        for _ in range(5):
            run_one_at(worker_ctx, reg, advance=timedelta(hours=1))

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None
    assert job.state == "failed"
    assert job.last_error is not None and "StudyRetry" in job.last_error
    assert all_items_have_sheet(worker_ctx)


def test_topics_fall_back_to_rules_on_first_failure_when_empty_and_on_last_attempt(
    worker_ctx: StageContext,
) -> None:
    reg = full_registry()
    jid = enqueue(worker_ctx.store.conn, "llm.topics", now=worker_ctx.now())
    with fake_llm(worker_ctx, topics=LlmUnavailable("caído"), quiz=ok_quiz()):
        run_one(worker_ctx, reg, "w1")
        first = get_job(worker_ctx.store.conn, jid)
        assert first is not None and first.state == "queued"
        assert _count(worker_ctx, "study_topics") > 0

        for _ in range(20):
            current = get_job(worker_ctx.store.conn, jid)
            if current is not None and current.state == "done":
                break
            run_one_at(worker_ctx, reg, advance=timedelta(hours=1))

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None
    assert job.state == "done"
    assert result_of(worker_ctx, jid).get("fallback") == "rules"
    assert _count(worker_ctx, "study_topics") > 0


def test_topics_budget_exhausted_writes_rules_and_defers(worker_ctx: StageContext) -> None:
    jid = enqueue(worker_ctx.store.conn, "llm.topics", now=worker_ctx.now())

    with fake_llm(worker_ctx, topics=LlmBudgetExceeded("tope")):
        run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    assert result_of(worker_ctx, jid).get("fallback") == "rules"
    assert _count(worker_ctx, "study_topics") > 0
    nxt = only_queued(worker_ctx, "llm.topics")
    assert nxt.run_after == "2026-11-03T05:05:00.000000Z"


def test_topics_last_attempt_returns_rules_fallback_when_llm_still_raises(
    worker_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    def still_down(ctx: StageContext, llm: Any, *, allow_rules: bool) -> Any:
        assert allow_rules is True
        raise LlmUnavailable("caído")

    monkeypatch.setattr(jobs_mod, "regroup_all", still_down)
    jid = enqueue(
        worker_ctx.store.conn,
        "llm.topics",
        now=worker_ctx.now(),
        max_attempts=1,
    )

    run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    assert result_of(worker_ctx, jid) == {"fallback": "rules"}


def test_topics_llm_down_writes_rules_for_every_course_without_topics_on_first_failure(
    worker_ctx: StageContext,
) -> None:
    conn = worker_ctx.store.conn
    _add_second_course(conn)
    jid = enqueue(conn, "llm.topics", now=worker_ctx.now())

    with fake_llm(worker_ctx, topics=LlmUnavailable("caído"), quiz=ok_quiz()):
        run_one(worker_ctx, full_registry(), "w1")

    rows = conn.execute(
        "SELECT course_id, generator FROM study_topics WHERE removed_at IS NULL ORDER BY course_id"
    ).fetchall()
    assert rows == [("c_1", "rules"), ("c_2", "rules")]
    topic_ids = {
        str(row[0])
        for row in conn.execute(
            "SELECT id FROM study_topics WHERE removed_at IS NULL ORDER BY id"
        ).fetchall()
    }
    queued = {
        str(json.loads(row[0])["scope_id"])
        for row in conn.execute(
            "SELECT payload FROM jobs WHERE kind = 'llm.quiz' AND state = 'queued'"
        ).fetchall()
    }
    assert queued == topic_ids
    job = get_job(conn, jid)
    assert job is not None
    assert (job.state, job.attempts) == ("queued", 1)


def test_quiz_rules_fallback_on_last_attempt(worker_ctx: StageContext) -> None:
    conn = worker_ctx.store.conn
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, position, generator,"
        " generator_version, input_hash, created_at, updated_at)"
        " VALUES ('tp_1', ?, 'Saludos', '', 0, 'rules', 'rules-1', 'h', ?, ?)",
        (COURSE_ID, TS, TS),
    )
    for position, item_id in enumerate(ITEM_IDS):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES ('tp_1', ?, ?)",
            (item_id, position),
        )
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash, prompt_version,"
        " model, stale, created_at) VALUES ('qz_viejo', 'topic', 'tp_1', 'Viejo', 'h', '1',"
        " 'rules', 0, ?)",
        (TS,),
    )
    reg = full_registry()
    jid = enqueue(
        worker_ctx.store.conn,
        "llm.quiz",
        {"scope_kind": "topic", "scope_id": "tp_1"},
        now=worker_ctx.now(),
    )
    with fake_llm(worker_ctx, quiz=LlmUnavailable("caído")):
        run_one(worker_ctx, reg, "w1")
        first = get_job(worker_ctx.store.conn, jid)
        assert first is not None and first.state == "queued"
        assert _count(worker_ctx, "quizzes") == 1

        for _ in range(4):
            run_one_at(worker_ctx, reg, advance=timedelta(hours=1))

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    row = conn.execute(
        "SELECT model, stale FROM quizzes WHERE scope_kind = 'topic' AND scope_id = 'tp_1'"
        " AND stale = 0"
    ).fetchone()
    assert row == ("rules", 0)


def test_quiz_without_scope_sweeps_at_most_twenty_and_requeues(
    worker_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    scopes = [jobs_mod.QuizScope("item", f"cw_{position}") for position in range(21)]
    calls: list[str] = []

    def fake_generate(
        ctx: StageContext, llm: Any, scope: Any, *, allow_rules: bool
    ) -> QuizRunResult:
        calls.append(scope.id)
        return QuizRunResult(
            scope=scope, quiz_id=f"qz_{scope.id}", source="rules", fallback_reason=None
        )

    monkeypatch.setattr(jobs_mod, "scopes_needing_quiz", lambda conn: scopes)
    monkeypatch.setattr(jobs_mod, "generate_quiz", fake_generate)
    monkeypatch.setattr(jobs_mod, "has_quiz", lambda conn, scope: True)
    jid = enqueue(worker_ctx.store.conn, "llm.quiz", {}, now=worker_ctx.now())

    with fake_llm(worker_ctx):
        run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    assert calls == [f"cw_{position}" for position in range(20)]
    nxt = only_queued(worker_ctx, "llm.quiz")
    assert nxt.dedupe_key == "llm.quiz:sweep"


def test_llm_off_quiz_sweep_skips_scopes_that_already_have_a_quiz(
    worker_ctx_llm_off: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    scopes = [jobs_mod.QuizScope("item", "cw_1"), jobs_mod.QuizScope("item", "cw_2")]
    calls: list[tuple[str, bool]] = []

    def fake_generate(
        ctx: StageContext, llm: Any, scope: Any, *, allow_rules: bool
    ) -> QuizRunResult:
        calls.append((scope.id, allow_rules))
        return QuizRunResult(
            scope=scope, quiz_id=f"qz_{scope.id}", source="rules", fallback_reason=None
        )

    monkeypatch.setattr(jobs_mod, "scopes_needing_quiz", lambda conn: scopes)
    monkeypatch.setattr(jobs_mod, "has_quiz", lambda conn, scope: scope.id == "cw_1")
    monkeypatch.setattr(jobs_mod, "generate_quiz", fake_generate)
    jid = enqueue(worker_ctx_llm_off.store.conn, "llm.quiz", {}, now=worker_ctx_llm_off.now())

    run_one(worker_ctx_llm_off, full_registry(), "w1")

    job = get_job(worker_ctx_llm_off.store.conn, jid)
    assert job is not None and job.state == "done"
    assert calls == [("cw_2", True)]


def test_quiz_budget_exhausted_defers_to_tomorrow(worker_ctx: StageContext) -> None:
    conn = worker_ctx.store.conn
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, position, generator,"
        " generator_version, input_hash, created_at, updated_at)"
        " VALUES ('tp_1', ?, 'Saludos', '', 0, 'rules', 'rules-1', 'h', ?, ?)",
        (COURSE_ID, TS, TS),
    )
    conn.execute(
        "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES ('tp_1', ?, 0)",
        (ITEM_IDS[0],),
    )
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash, prompt_version,"
        " model, stale, created_at) VALUES ('qz_viejo', 'topic', 'tp_1', 'Viejo', 'h', '1',"
        " 'rules', 0, ?)",
        (TS,),
    )
    jid = enqueue(
        worker_ctx.store.conn,
        "llm.quiz",
        {"scope_kind": "topic", "scope_id": "tp_1"},
        now=worker_ctx.now(),
    )
    with fake_llm(worker_ctx, quiz=LlmBudgetExceeded("tope")):
        run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    nxt = only_queued(worker_ctx, "llm.quiz")
    assert nxt.run_after == "2026-11-03T05:05:00.000000Z"


def test_budget_exhausted_defers_to_tomorrow(worker_ctx: StageContext) -> None:
    reg = full_registry()
    jid = enqueue(worker_ctx.store.conn, "llm.sheet", now=worker_ctx.now())
    with fake_llm(worker_ctx, sheet=LlmBudgetExceeded("tope")):
        run_one(worker_ctx, reg, "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    nxt = only_queued(worker_ctx, "llm.sheet")
    assert nxt.run_after == "2026-11-03T05:05:00.000000Z"


def test_llm_off_still_produces_topics_quizzes_and_plan(
    worker_ctx_llm_off: StageContext,
) -> None:
    """REVIEW FOCUS: ninguna pantalla queda vacía si el LLM está apagado."""
    ctx = worker_ctx_llm_off
    reg = full_registry()
    enqueue_follow_ups_like_pipeline(ctx)
    enqueue(ctx.store.conn, "plan.daily", now=ctx.now())
    drain(ctx, reg)

    assert all_items_have_sheet(ctx)
    assert _count(ctx, "study_topics") > 0
    assert _count(ctx, "quizzes") > 0
    rules = ctx.store.conn.execute(
        "SELECT COUNT(*) FROM quizzes WHERE model = 'rules' AND stale = 0"
    ).fetchone()
    assert int(rules[0]) > 0
    assert _count(ctx, "study_plan") > 0


def test_llm_down_still_produces_base_sheets_topics_rules_quizzes_and_plan(
    worker_ctx: StageContext,
) -> None:
    """REVIEW FOCUS: con el LLM caído el pipeline tampoco deja pantallas vacías."""
    reg = full_registry()
    enqueue_follow_ups_like_pipeline(worker_ctx)
    enqueue(worker_ctx.store.conn, "plan.daily", now=worker_ctx.now())

    with fake_llm(
        worker_ctx,
        sheet=LlmUnavailable("caído"),
        topics=LlmUnavailable("caído"),
        quiz=LlmUnavailable("caído"),
        plan_why=LlmUnavailable("caído"),
    ):
        drain(worker_ctx, reg)

    assert all_items_have_sheet(worker_ctx)
    assert _count(worker_ctx, "study_topics") > 0
    rules = worker_ctx.store.conn.execute(
        "SELECT COUNT(*) FROM quizzes WHERE model = 'rules' AND stale = 0"
    ).fetchone()
    assert int(rules[0]) > 0
    assert _count(worker_ctx, "study_plan") > 0


def test_results_never_contain_course_text(worker_ctx: StageContext) -> None:
    reg = full_registry()
    enqueue(worker_ctx.store.conn, "index.text_blocks", now=worker_ctx.now())
    enqueue(worker_ctx.store.conn, "llm.sheet", now=worker_ctx.now())
    enqueue(worker_ctx.store.conn, "llm.topics", now=worker_ctx.now())
    enqueue(worker_ctx.store.conn, "plan.daily", now=worker_ctx.now())

    with fake_llm(
        worker_ctx,
        sheet=LlmUnavailable("caído"),
        topics=ok_topics(),
        quiz=ok_quiz(),
        plan_why=LlmUnavailable("caído"),
    ):
        for _ in range(4):
            run_one(worker_ctx, reg, "w1")

    rows = worker_ctx.store.conn.execute("SELECT result, last_error FROM jobs").fetchall()
    assert rows
    for result, last_error in rows:
        payload = f"{result or ''}\n{last_error or ''}"
        assert "Leçon" not in payload
        assert "Bonjour" not in payload


def test_bad_payload_is_permanent(worker_ctx: StageContext) -> None:
    jid = enqueue(
        worker_ctx.store.conn,
        "index.text_blocks",
        {"item_ids": "cw_1"},
        now=worker_ctx.now(),
    )

    run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None
    assert job.state == "failed"


def test_plan_daily_returns_counts_and_why(
    worker_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    why_reply = {"lines": []}
    monkeypatch.setattr(jobs_mod, "run_why", lambda c, llm: {"written": 1, "skipped_llm": 0})
    jid = enqueue(worker_ctx.store.conn, "plan.daily", now=worker_ctx.now())

    with fake_llm(worker_ctx, plan_why=why_reply):
        run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    result = result_of(worker_ctx, jid)
    assert result["users"] == 1 and result["why"] == {"written": 1, "skipped_llm": 0}


def test_a_why_failure_never_fails_the_plan_job(
    worker_ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_why(ctx: StageContext, llm: Any) -> dict[str, int]:
        raise RuntimeError("por qué roto")

    monkeypatch.setattr(jobs_mod, "run_why", broken_why)
    jid = enqueue(worker_ctx.store.conn, "plan.daily", now=worker_ctx.now())

    with fake_llm(worker_ctx):
        run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None and job.state == "done"
    assert result_of(worker_ctx, jid)["why"] == {"error": "RuntimeError"}


def test_auth_error_is_permanent(worker_ctx: StageContext, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken_regroup(*args: Any, **kwargs: Any) -> Any:
        raise AuthError("token revocado")

    monkeypatch.setattr(jobs_mod, "regroup_all", broken_regroup)
    jid = enqueue(worker_ctx.store.conn, "llm.topics", now=worker_ctx.now())

    run_one(worker_ctx, full_registry(), "w1")

    job = get_job(worker_ctx.store.conn, jid)
    assert job is not None
    assert (job.state, job.attempts) == ("failed", 1)
