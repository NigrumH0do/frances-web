"""Generación de quizzes por tema y publicación (AI-08).

Todo es sintético y el LLM se simula con ``FakeLlm``: ningún test abre la red.
La lectura del material ocurre fuera de transacción y la escritura en
``store.tx()``.
"""

import json
import sqlite3
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.cards.llm import LlmUnavailable

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver test_index.
from frances.db import store as _store  # noqa: F401
from frances.models.ids import content_hash
from frances.stage import StageContext, make_context
from frances.study.llm_cache import LlmRejected
from frances.study.quiz import (
    MIN_QUESTIONS,
    QuizScope,
    StoredQuestion,
    generate_quiz,
    load_material,
    questions_from_llm,
    quiz_input_text,
    save_quiz,
    scopes_needing_quiz,
)
from frances.study.quiz_rules import dictation_questions
from tests.study.conftest import FakeLlm

_NOW = "2026-11-06T10:00:00.000000Z"
_CLOCK = datetime(2026, 11, 6, 10, 0, tzinfo=UTC)
_EVAL_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "llm_eval" / "cases"


def eval_case(task: str, case_id: str) -> dict[str, Any]:
    """Caso sintético del set de evaluación del LLM (AI-03)."""
    data: dict[str, Any] = json.loads(
        (_EVAL_DIR / task / f"{case_id}.json").read_text(encoding="utf-8")
    )
    return data


@dataclass(frozen=True)
class QuizRow:
    id: str
    title_es: str
    input_hash: str
    prompt_version: str
    model: str
    stale: int


@dataclass(frozen=True)
class QuestionRow:
    id: str
    kind: str
    prompt_es: str
    options: list[str]
    answers: list[str]
    source_block_id: int | None
    audio_cache_key: str | None


def _item(conn: sqlite3.Connection, item_id: str, title: str, *, text: str = "") -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, title, text, _NOW, _NOW, f"{item_id}-h", _NOW, _NOW),
    )


def _study_topic(
    conn: sqlite3.Connection, topic_id: str, title: str, item_ids: Sequence[str]
) -> None:
    conn.execute(
        "INSERT INTO study_topics (id, course_id, title, description_es, position, generator,"
        " generator_version, input_hash, created_at, updated_at)"
        " VALUES (?, 'c_1', ?, '', 0, 'rules', 'rules-1', 'h', ?, ?)",
        (topic_id, title, _NOW, _NOW),
    )
    for position, item_id in enumerate(item_ids):
        conn.execute(
            "INSERT INTO study_topic_items (topic_id, item_id, position) VALUES (?, ?, ?)",
            (topic_id, item_id, position),
        )


def _sheet(conn: sqlite3.Connection, item_id: str, summary: str) -> None:
    conn.execute(
        "INSERT INTO sheets (item_id, json, generator, generator_version, updated_at)"
        " VALUES (?, ?, 'study', 'sheet-1', ?)",
        (item_id, json.dumps({"summary_es": summary}, ensure_ascii=False), _NOW),
    )


def _card(
    conn: sqlite3.Connection,
    card_id: str,
    kind: str,
    front_fr: str,
    back_es: str,
    *,
    example_fr: str | None = None,
    item_id: str = "cw_saludos",
) -> None:
    conn.execute(
        "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, generator,"
        " generator_version, stale, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, NULL, 'cards', 'cards-1', 0, ?, ?)",
        (card_id, kind, front_fr, back_es, example_fr, _NOW, _NOW),
    )
    conn.execute("INSERT INTO card_sources (card_id, item_id) VALUES (?, ?)", (card_id, item_id))


def _audio(conn: sqlite3.Connection, cache_key: str, text: str, status: str) -> None:
    conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, updated_at) VALUES (?, ?, ?, 'v1', 'familia', '1', ?, ?)",
        (cache_key, text, text, status, _NOW),
    )


def _card_audio(conn: sqlite3.Connection, card_id: str, cache_key: str) -> None:
    conn.execute(
        "INSERT INTO card_audio (card_id, field, cache_key) VALUES (?, 'front', ?)",
        (card_id, cache_key),
    )


def _block(
    conn: sqlite3.Connection, block_id: int, item_id: str, position: int, lang: str, text: str
) -> None:
    conn.execute(
        "INSERT INTO text_blocks (id, item_id, source, page, position, lang, text,"
        " extractor_version, created_at) VALUES (?, ?, 'item', NULL, ?, ?, ?, 'item-1', ?)",
        (block_id, item_id, position, lang, text, _NOW),
    )


def _user(conn: sqlite3.Connection, user_id: str = "u_1") -> None:
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
        " VALUES (?, ?, 'Alumno', 'x', 'user', ?)",
        (user_id, f"{user_id}@example.test", _NOW),
    )


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = replace(make_context(tmp_path, {}), now=lambda: _CLOCK)
    try:
        context.store.conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_NOW,),
        )
        yield context
    finally:
        context.store.close()


@pytest.fixture
def topic_with_material(ctx: StageContext) -> dict[str, Any]:
    """Tema con tarjetas (dos con audio) y bloques indexados en francés."""
    conn = ctx.store.conn
    _item(conn, "cw_saludos", "Saludos sin prisa")
    _study_topic(conn, "tp_saludos", "Saludos", ["cw_saludos"])
    _sheet(conn, "cw_saludos", "Frases para saludar y responder.")

    cards: list[tuple[str, str, str, str, str | None]] = [
        ("c_aurevoir", "vocab", "au revoir", "adiós", None),
        ("c_bonjour", "vocab", "bonjour", "buenos días", None),
        (
            "c_marche",
            "vocab",
            "le marché",
            "el mercado",
            "Nous allons au marché le samedi.",
        ),
        ("c_merci", "vocab", "merci", "gracias", None),
        ("c_pardon", "vocab", "pardon", "perdón", None),
        ("c_frappe", "phrase", "Comment ça va aujourd\u2019hui ?", "¿Cómo estás hoy?", None),
        (
            "c_leve",
            "phrase",
            "Je me lève à sept heures.",
            "Me levanto a las siete.",
            "Je me lève à sept heures.",
        ),
        ("c_soir", "phrase", "Le soir, je lis un livre.", "Por la noche leo un libro.", None),
        ("c_va", "phrase", "Salut, ça va bien.", "Hola, estoy bien.", None),
    ]
    for card_id, kind, front, back, example in cards:
        _card(conn, card_id, kind, front, back, example_fr=example)

    _audio(conn, "aud_leve", "Je me lève à sept heures.", "done")
    _audio(conn, "aud_soir", "Le soir, je lis un livre.", "pending")
    _card_audio(conn, "c_leve", "aud_leve")
    _card_audio(conn, "c_soir", "aud_soir")

    blocks = [
        (1, "fr", "Bonjour, comment ça va aujourd\u2019hui ? Très bien, merci !"),
        (2, "es", "Esta lección presenta los saludos formales e informales."),
        (3, "fr", "Salut ! Ça va ? Oui, ça va bien, merci."),
        (4, "fr", "Le matin, on dit bonjour à tout le monde."),
    ]
    for position, (block_id, lang, text) in enumerate(blocks):
        _block(conn, block_id, "cw_saludos", position, lang, text)

    # Fuera del tema: ni sus tarjetas ni sus bloques entran en el material del tema.
    _item(conn, "cw_extra", "Otra clase")
    _card(conn, "c_extra", "vocab", "fromage", "queso", item_id="cw_extra")
    _block(conn, 9, "cw_extra", 0, "fr", "Le fromage est délicieux avec du pain.")

    return {
        "topic_id": "tp_saludos",
        "item_id": "cw_saludos",
        "block_ids": [1, 3, 4],
        "audio_keys": ["aud_leve", "aud_soir"],
    }


def add_card_to_topic(
    ctx: StageContext, topic_id: str, front_fr: str, back_es: str, card_id: str = "c_nuevo"
) -> None:
    conn = ctx.store.conn
    row = conn.execute(
        "SELECT item_id FROM study_topic_items WHERE topic_id = ? ORDER BY position LIMIT 1",
        (topic_id,),
    ).fetchone()
    assert row is not None
    _card(conn, card_id, "vocab", front_fr, back_es, item_id=str(row[0]))


def questions_of(ctx: StageContext, quiz_id: str) -> list[QuestionRow]:
    rows = ctx.store.conn.execute(
        "SELECT id, kind, prompt_es, options_json, answer_json, source_block_id,"
        " audio_cache_key FROM questions WHERE quiz_id = ? ORDER BY position",
        (quiz_id,),
    ).fetchall()
    return [
        QuestionRow(
            id=str(row[0]),
            kind=str(row[1]),
            prompt_es=str(row[2]),
            options=list(json.loads(row[3])),
            answers=list(json.loads(row[4])),
            source_block_id=None if row[5] is None else int(row[5]),
            audio_cache_key=None if row[6] is None else str(row[6]),
        )
        for row in rows
    ]


def quiz_row(ctx: StageContext, quiz_id: str) -> QuizRow:
    row = ctx.store.conn.execute(
        "SELECT id, title_es, input_hash, prompt_version, model, stale FROM quizzes WHERE id = ?",
        (quiz_id,),
    ).fetchone()
    assert row is not None
    return QuizRow(
        id=str(row[0]),
        title_es=str(row[1]),
        input_hash=str(row[2]),
        prompt_version=str(row[3]),
        model=str(row[4]),
        stale=int(row[5]),
    )


def block_ids_of_topic(ctx: StageContext, topic_id: str) -> set[int]:
    return {
        int(row[0])
        for row in ctx.store.conn.execute(
            "SELECT tb.id FROM text_blocks tb"
            " JOIN study_topic_items sti ON sti.item_id = tb.item_id"
            " WHERE sti.topic_id = ?",
            (topic_id,),
        )
    }


def audio_count(ctx: StageContext) -> int:
    return int(ctx.store.conn.execute("SELECT COUNT(*) FROM audio").fetchone()[0])


def _mcq_with_answer_outside_options() -> dict[str, Any]:
    return {
        "kind": "mcq",
        "prompt_es": "Pregunta rota",
        "prompt_fr": None,
        "options": ["une", "deux", "trois"],
        "answers": ["quatre"],
        "explanation_es": None,
        "source_block": 1,
    }


def _order_with_one_word() -> dict[str, Any]:
    return {
        "kind": "order",
        "prompt_es": "Ordena",
        "prompt_fr": None,
        "options": [],
        "answers": ["seul"],
        "explanation_es": None,
        "source_block": 1,
    }


def test_llm_quiz_has_all_five_kinds_and_valid_refs(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    out = eval_case("quiz", "saludos")["expected"]
    res = generate_quiz(
        ctx,
        FakeLlm(model="m", replies=[out]),
        QuizScope("topic", str(topic_with_material["topic_id"])),
        allow_rules=False,
    )
    assert res.source == "llm"
    assert res.quiz_id is not None
    rows = questions_of(ctx, res.quiz_id)
    assert {row.kind for row in rows} == {"mcq", "cloze", "translate", "order", "dictation"}
    assert len(rows) >= MIN_QUESTIONS
    ids = block_ids_of_topic(ctx, str(topic_with_material["topic_id"]))
    assert all(row.source_block_id in ids for row in rows if row.kind != "dictation")


def test_invalid_llm_questions_are_dropped_and_too_few_fall_back(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    out = {
        "title_es": "x",
        "questions": [_mcq_with_answer_outside_options(), _order_with_one_word()],
    }
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    with pytest.raises(LlmRejected):
        generate_quiz(ctx, FakeLlm(model="m", replies=[out]), scope, allow_rules=False)

    res = generate_quiz(ctx, FakeLlm(model="m", replies=[out]), scope, allow_rules=True)
    assert res.source == "rules"
    assert res.quiz_id is not None
    assert quiz_row(ctx, res.quiz_id).model == "rules"


def test_order_options_are_shuffled_and_mcq_answer_is_an_option(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    res = generate_quiz(
        ctx, None, QuizScope("topic", str(topic_with_material["topic_id"])), allow_rules=True
    )
    assert res.quiz_id is not None
    for question in questions_of(ctx, res.quiz_id):
        if question.kind == "order":
            assert sorted(question.options) == sorted(question.answers)
            assert question.options != question.answers
        if question.kind == "mcq":
            assert question.answers[0] in question.options
            assert len(set(question.options)) == len(question.options) == 4


def test_same_material_is_unchanged_new_material_stales_old(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    llm = FakeLlm(model="m", replies=[eval_case("quiz", "saludos")["expected"]] * 2)
    first = generate_quiz(ctx, llm, scope, allow_rules=False)
    repeat = generate_quiz(ctx, llm, scope, allow_rules=False)
    assert repeat.source == "unchanged"
    assert repeat.quiz_id == first.quiz_id
    assert llm.calls == 1

    add_card_to_topic(ctx, str(topic_with_material["topic_id"]), "le dîner", "la cena")
    second = generate_quiz(ctx, llm, scope, allow_rules=False)
    assert second.quiz_id is not None and first.quiz_id is not None
    assert second.quiz_id != first.quiz_id
    assert quiz_row(ctx, first.quiz_id).stale == 1
    assert quiz_row(ctx, second.quiz_id).stale == 0


def test_rules_quiz_does_not_block_later_llm_quiz(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    rules = generate_quiz(ctx, None, scope, allow_rules=True)
    llm = generate_quiz(
        ctx,
        FakeLlm(model="m", replies=[eval_case("quiz", "saludos")["expected"]]),
        scope,
        allow_rules=False,
    )
    assert rules.quiz_id is not None and llm.quiz_id is not None
    assert llm.source == "llm"
    assert llm.quiz_id != rules.quiz_id
    assert quiz_row(ctx, rules.quiz_id).stale == 1


def test_dictation_reuses_card_audio_only(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    before = audio_count(ctx)
    questions = dictation_questions(
        load_material(ctx.store.conn, QuizScope("topic", str(topic_with_material["topic_id"])))
    )
    keys = {
        str(row[0])
        for row in ctx.store.conn.execute("SELECT cache_key FROM card_audio WHERE field = 'front'")
    }
    assert questions
    assert all(question.audio_cache_key in keys for question in questions)
    assert {question.audio_cache_key for question in questions} == set(
        topic_with_material["audio_keys"]
    )
    assert audio_count(ctx) == before


def test_item_scope_and_empty_scope(ctx: StageContext, topic_with_material: dict[str, Any]) -> None:
    material = load_material(ctx.store.conn, QuizScope("item", "cw_saludos"))
    assert material is not None
    assert material.title == "Saludos sin prisa"
    assert {card.card_id for card in material.cards} == {
        "c_aurevoir",
        "c_bonjour",
        "c_marche",
        "c_merci",
        "c_pardon",
        "c_frappe",
        "c_leve",
        "c_soir",
        "c_va",
    }
    res = generate_quiz(ctx, None, QuizScope("item", "cw_saludos"), allow_rules=True)
    assert res.source == "rules" and res.quiz_id is not None

    assert load_material(ctx.store.conn, QuizScope("topic", "tp_inexistente")) is None
    missing = generate_quiz(ctx, None, QuizScope("topic", "tp_inexistente"), allow_rules=True)
    assert missing.scope == QuizScope("topic", "tp_inexistente")
    assert missing.quiz_id is None and missing.source == "empty"


def test_save_quiz_never_rewrites_a_quiz_with_the_same_id_and_attempts_keep_their_questions(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    """Review Focus: los intentos guardados siguen apuntando a sus preguntas."""
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    created = generate_quiz(ctx, None, scope, allow_rules=True)
    assert created.quiz_id is not None
    original_quiz = quiz_row(ctx, created.quiz_id)
    original_questions = questions_of(ctx, created.quiz_id)
    assert original_questions

    with ctx.store.tx() as conn:
        _user(conn)
        conn.execute(
            "INSERT INTO quiz_attempts (user_id, quiz_id, answers_json, score, started_at,"
            " finished_at) VALUES ('u_1', ?, '{}', 0.0, ?, ?)",
            (created.quiz_id, _NOW, _NOW),
        )

    replacement = [
        StoredQuestion(
            kind="mcq",
            prompt_es=f"Pregunta nueva {position}",
            prompt_fr=None,
            options=["a", "b", "c", "d"],
            answers=["a"],
            explanation_es=None,
            audio_cache_key=None,
            source_block_id=None,
        )
        for position in range(12)
    ]
    with ctx.store.tx() as conn:
        same_id = save_quiz(
            conn,
            scope,
            "Otro título",
            replacement,
            input_hash=original_quiz.input_hash,
            prompt_version=original_quiz.prompt_version,
            model=original_quiz.model,
            now=_NOW,
        )

    assert same_id == created.quiz_id
    assert quiz_row(ctx, same_id) == original_quiz
    assert questions_of(ctx, same_id) == original_questions
    answer = ctx.store.conn.execute(
        "SELECT q.id, q.prompt_es FROM quiz_attempts a"
        " JOIN questions q ON q.quiz_id = a.quiz_id"
        " ORDER BY q.position LIMIT 1"
    ).fetchone()
    assert answer is not None
    assert (str(answer[0]), str(answer[1])) == (
        original_questions[0].id,
        original_questions[0].prompt_es,
    )
    assert ctx.store.conn.execute(
        "SELECT COUNT(*) FROM questions WHERE quiz_id = ?", (same_id,)
    ).fetchone()[0] == len(original_questions)


def test_questions_from_llm_maps_local_source_blocks_to_text_blocks(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    material = load_material(
        ctx.store.conn, QuizScope("topic", str(topic_with_material["topic_id"]))
    )
    assert material is not None
    out = eval_case("quiz", "saludos")["expected"]
    from frances.study.schemas import QuizLlmOut

    parsed = QuizLlmOut.model_validate(out)
    questions = questions_from_llm(parsed, material, seed="s")
    assert {question.source_block_id for question in questions} == {1, 4}
    assert all(
        question.source_block_id in block_ids_of_topic(ctx, "tp_saludos") for question in questions
    )


def test_rules_quiz_input_hash_has_the_rules_prefix(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    res = generate_quiz(ctx, None, scope, allow_rules=True)
    assert res.quiz_id is not None
    material = load_material(ctx.store.conn, scope)
    assert material is not None
    expected = content_hash("rules", quiz_input_text(material))
    assert quiz_row(ctx, res.quiz_id).input_hash == expected


def test_llm_failure_falls_back_to_rules(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    fallback = generate_quiz(
        ctx,
        FakeLlm(model="m", replies=[LlmUnavailable("kiosapi caído")]),
        scope,
        allow_rules=True,
    )
    assert fallback.source == "rules" and fallback.quiz_id is not None
    assert fallback.fallback_reason == "kiosapi caído"

    with pytest.raises(LlmUnavailable):
        generate_quiz(
            ctx,
            FakeLlm(model="m", replies=[LlmUnavailable("kiosapi caído")]),
            scope,
            allow_rules=False,
        )


def test_scopes_needing_quiz_ignores_rules_but_accepts_current_llm_quizzes(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    topic = QuizScope("topic", str(topic_with_material["topic_id"]))
    item = QuizScope("item", str(topic_with_material["item_id"]))
    assert topic in scopes_needing_quiz(ctx.store.conn)
    assert item in scopes_needing_quiz(ctx.store.conn)

    generate_quiz(ctx, None, topic, allow_rules=True)
    assert topic in scopes_needing_quiz(ctx.store.conn)

    out = eval_case("quiz", "saludos")["expected"]
    llm = FakeLlm(model="m", replies=[out, out])
    generate_quiz(ctx, llm, topic, allow_rules=False)
    assert topic not in scopes_needing_quiz(ctx.store.conn)
    assert item in scopes_needing_quiz(ctx.store.conn)

    generate_quiz(ctx, llm, item, allow_rules=False)
    assert scopes_needing_quiz(ctx.store.conn) == []


def test_reverting_material_reactivates_the_same_quiz_without_rewriting_it(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    out = eval_case("quiz", "saludos")["expected"]
    llm = FakeLlm(model="m", replies=[out, out])
    first = generate_quiz(ctx, llm, scope, allow_rules=False)
    assert first.quiz_id is not None
    original_questions = questions_of(ctx, first.quiz_id)

    add_card_to_topic(ctx, str(topic_with_material["topic_id"]), "le dîner", "la cena")
    second = generate_quiz(ctx, llm, scope, allow_rules=False)
    assert second.quiz_id is not None and second.quiz_id != first.quiz_id

    with ctx.store.tx() as conn:
        conn.execute("DELETE FROM card_sources WHERE card_id = 'c_nuevo'")
        conn.execute("DELETE FROM cards WHERE id = 'c_nuevo'")
    again = generate_quiz(ctx, llm, scope, allow_rules=False)

    assert again.quiz_id == first.quiz_id
    assert quiz_row(ctx, first.quiz_id).stale == 0
    assert quiz_row(ctx, second.quiz_id).stale == 1
    assert questions_of(ctx, first.quiz_id) == original_questions


def test_empty_fallback_stales_previous_quiz(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    old = generate_quiz(ctx, None, scope, allow_rules=True)
    assert old.quiz_id is not None
    old_questions = questions_of(ctx, old.quiz_id)

    with ctx.store.tx() as conn:
        conn.execute(
            "UPDATE cards SET stale = 1 WHERE id IN ("
            " SELECT cs.card_id FROM card_sources cs"
            " JOIN study_topic_items sti ON sti.item_id = cs.item_id"
            " WHERE sti.topic_id = ?)",
            (str(topic_with_material["topic_id"]),),
        )
        _card(conn, "c_gramatica", "grammar", "règle du pluriel", "regla del plural")

    empty = generate_quiz(ctx, None, scope, allow_rules=True)

    assert empty.source == "empty"
    assert empty.quiz_id is None
    assert quiz_row(ctx, old.quiz_id).stale == 1
    assert questions_of(ctx, old.quiz_id) == old_questions
    assert (
        ctx.store.conn.execute(
            "SELECT COUNT(*) FROM quizzes WHERE scope_kind = ? AND scope_id = ? AND stale = 0",
            (scope.kind, scope.id),
        ).fetchone()[0]
        == 0
    )


def test_removed_topic_material_none_stales_previous_quiz(
    ctx: StageContext, topic_with_material: dict[str, Any]
) -> None:
    scope = QuizScope("topic", str(topic_with_material["topic_id"]))
    old = generate_quiz(ctx, None, scope, allow_rules=True)
    assert old.quiz_id is not None
    old_questions = questions_of(ctx, old.quiz_id)

    with ctx.store.tx() as conn:
        conn.execute(
            "UPDATE study_topics SET removed_at = ? WHERE id = ?",
            (_NOW, str(topic_with_material["topic_id"])),
        )

    empty = generate_quiz(ctx, None, scope, allow_rules=True)

    assert empty.source == "empty"
    assert empty.quiz_id is None
    assert quiz_row(ctx, old.quiz_id).stale == 1
    assert questions_of(ctx, old.quiz_id) == old_questions
    assert (
        ctx.store.conn.execute(
            "SELECT COUNT(*) FROM quizzes WHERE scope_kind = ? AND scope_id = ? AND stale = 0",
            (scope.kind, scope.id),
        ).fetchone()[0]
        == 0
    )
