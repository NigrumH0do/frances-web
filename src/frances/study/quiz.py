"""Generación de quizzes por tema y publicación (AI-08).

Un quiz se identifica por ``(alcance, sha256 del material)``. La misma entrada no
se vuelve a generar ni se reescribe: ``save_quiz`` usa ``INSERT OR IGNORE`` para
que los intentos guardados sigan apuntando a las mismas preguntas. Si el
material cambia, el quiz nuevo tiene otro id y el anterior queda ``stale``.

La lectura del material y la llamada al LLM ocurren fuera de transacción; la
escritura corre dentro de ``store.tx()``. Sin LLM (o si falla) el respaldo por
reglas arma el quiz con un ``input_hash`` con prefijo ``rules`` para que un quiz
del LLM posterior no choque con él.
"""

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from pydantic import ValidationError

from frances.cards.llm import LlmUnavailable
from frances.log import redact
from frances.models.content import CardKind
from frances.models.ids import content_hash, question_id, quiz_id
from frances.models.study import QuestionKind
from frances.stage import StageContext
from frances.study.llm_cache import JsonLlm, cached_json
from frances.study.prompts import PROMPT_VERSIONS, SYSTEM_PROMPTS, render_quiz_input
from frances.study.quality import question_problems
from frances.study.schemas import PromptCard, PromptFragment, QuizLlmOut
from frances.timeutil import format_ts

MIN_QUESTIONS = 4
MAX_QUESTIONS = 12
MAX_DICTATION = 2
MAX_FRAGMENTS = 24
MAX_CARDS = 40
RULES_VERSION = "quiz-rules-1"


@dataclass(frozen=True)
class QuizScope:
    kind: Literal["topic", "item"]
    id: str


@dataclass(frozen=True)
class CardFact:
    card_id: str
    kind: CardKind
    front_fr: str
    back_es: str
    example_fr: str | None
    example_es: str | None
    front_audio_key: str | None


@dataclass(frozen=True)
class Fragment:
    block_id: int
    item_id: str
    label: str
    text: str


@dataclass(frozen=True)
class QuizMaterial:
    scope: QuizScope
    title: str
    summaries: tuple[str, ...]
    cards: tuple[CardFact, ...]
    fragments: tuple[Fragment, ...]


@dataclass(frozen=True)
class StoredQuestion:
    kind: QuestionKind
    prompt_es: str
    prompt_fr: str | None
    options: list[str]
    answers: list[str]
    explanation_es: str | None
    audio_cache_key: str | None
    source_block_id: int | None


@dataclass
class QuizRunResult:
    scope: QuizScope
    quiz_id: str | None
    source: Literal["llm", "cached", "rules", "unchanged", "empty"]
    fallback_reason: str | None


def load_material(conn: sqlite3.Connection, scope: QuizScope) -> QuizMaterial | None:
    """Material del alcance: tema completo o una publicación.

    Devuelve ``None`` si el alcance no existe o si no quedan tarjetas ni
    fragmentos con los que armar preguntas.
    """
    if scope.kind == "topic":
        row = conn.execute(
            "SELECT title FROM study_topics WHERE id = ? AND removed_at IS NULL", (scope.id,)
        ).fetchone()
        if row is None:
            return None
        title = str(row[0])
        item_rows = conn.execute(
            "SELECT i.id, COALESCE(i.title, '') FROM study_topic_items sti"
            " JOIN items i ON i.id = sti.item_id"
            " WHERE sti.topic_id = ? AND i.deleted_at IS NULL"
            " ORDER BY sti.position, sti.item_id",
            (scope.id,),
        ).fetchall()
    else:
        row = conn.execute(
            "SELECT COALESCE(title, '') FROM items WHERE id = ? AND deleted_at IS NULL",
            (scope.id,),
        ).fetchone()
        if row is None:
            return None
        title = str(row[0])
        item_rows = [(scope.id, title)]

    item_ids = [str(row[0]) for row in item_rows]
    if not item_ids:
        return None
    titles = {str(row[0]): str(row[1]) for row in item_rows}
    cards = _load_cards(conn, item_ids)
    fragments = _load_fragments(conn, item_ids, titles)
    if not cards and not fragments:
        return None
    return QuizMaterial(
        scope=scope,
        title=title,
        summaries=_load_summaries(conn, item_ids),
        cards=cards,
        fragments=fragments,
    )


def quiz_input_text(m: QuizMaterial) -> str:
    """Entrada exacta del LLM: fragmentos numerados 1…n en el orden del material."""
    return render_quiz_input(
        m.title,
        m.summaries,
        [
            PromptCard(kind=card.kind, front_fr=card.front_fr, back_es=card.back_es)
            for card in m.cards
        ],
        [
            PromptFragment(n=position, label=fragment.label, text=fragment.text)
            for position, fragment in enumerate(m.fragments, start=1)
        ],
    )


def questions_from_llm(out: QuizLlmOut, m: QuizMaterial, *, seed: str) -> list[StoredQuestion]:
    """Convierte la salida del LLM y descarta las preguntas con problemas.

    ``source_block`` es un número local (1…n) que se traduce al ``block_id``
    real. Las opciones de ``mcq`` y ``order`` se barajan de forma determinista.
    """
    from frances.study.quiz_rules import stable_shuffle

    questions: list[StoredQuestion] = []
    for index, question in enumerate(out.questions):
        if question_problems(question, len(m.fragments)):
            continue
        block_id = m.fragments[question.source_block - 1].block_id
        options = list(question.options)
        if question.kind == "mcq":
            options = stable_shuffle(options, f"{seed}{index}")
        elif question.kind == "order":
            answers = list(question.answers)
            options = stable_shuffle(answers, f"{seed}{index}\x1forder")
            if options == answers:
                options = options[1:] + options[:1]
        questions.append(
            StoredQuestion(
                kind=cast("QuestionKind", question.kind),
                prompt_es=question.prompt_es,
                prompt_fr=question.prompt_fr,
                options=options,
                answers=list(question.answers),
                explanation_es=question.explanation_es,
                audio_cache_key=None,
                source_block_id=block_id,
            )
        )
        if len(questions) >= MAX_QUESTIONS - MAX_DICTATION:
            break
    return questions


def save_quiz(
    conn: sqlite3.Connection,
    scope: QuizScope,
    title_es: str,
    questions: Sequence[StoredQuestion],
    *,
    input_hash: str,
    prompt_version: str,
    model: str,
    now: str,
) -> str:
    """Guarda el quiz y sus preguntas sin reescribir jamás un id existente.

    ``INSERT OR IGNORE`` protege el quiz y sus preguntas: un intento guardado
    sigue apuntando a las mismas filas. Los demás quizzes del alcance quedan
    ``stale``. El llamador debe estar dentro de una transacción.
    """
    qid = quiz_id(scope.kind, scope.id, input_hash)
    cursor = conn.execute(
        "INSERT OR IGNORE INTO quizzes (id, scope_kind, scope_id, title_es, input_hash,"
        " prompt_version, model, stale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
        (qid, scope.kind, scope.id, title_es, input_hash, prompt_version, model, now),
    )
    # Un quiz que vuelve a ser el vigente recupera el estado activo sin tocar sus
    # preguntas: los intentos guardados siguen apuntando a las mismas filas.
    if cursor.rowcount == 0:
        conn.execute("UPDATE quizzes SET stale = 0 WHERE id = ?", (qid,))
    else:
        for position, question in enumerate(questions):
            conn.execute(
                "INSERT OR IGNORE INTO questions (id, quiz_id, position, kind, prompt_es,"
                " prompt_fr, options_json, answer_json, explanation_es, audio_cache_key,"
                " source_block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    question_id(qid, position),
                    qid,
                    position,
                    question.kind,
                    question.prompt_es,
                    question.prompt_fr,
                    json.dumps(question.options, ensure_ascii=False),
                    json.dumps(question.answers, ensure_ascii=False),
                    question.explanation_es,
                    question.audio_cache_key,
                    question.source_block_id,
                ),
            )
    conn.execute(
        "UPDATE quizzes SET stale = 1 WHERE scope_kind = ? AND scope_id = ? AND id != ?",
        (scope.kind, scope.id, qid),
    )
    return qid


def generate_quiz(
    ctx: StageContext,
    llm: JsonLlm | None,
    scope: QuizScope,
    *,
    allow_rules: bool,
) -> QuizRunResult:
    """Genera el quiz del alcance; sin LLM o con fallo usa el respaldo por reglas."""
    from frances.study.quiz_rules import dictation_questions

    material = load_material(ctx.store.conn, scope)
    if material is None:
        _mark_scope_stale(ctx, scope)
        return QuizRunResult(scope=scope, quiz_id=None, source="empty", fallback_reason=None)

    user_text = quiz_input_text(material)
    input_hash = content_hash(user_text)
    existing = ctx.store.conn.execute(
        "SELECT id FROM quizzes WHERE scope_kind = ? AND scope_id = ? AND input_hash = ?"
        " AND stale = 0 ORDER BY created_at DESC, id LIMIT 1",
        (scope.kind, scope.id, input_hash),
    ).fetchone()
    if existing is not None:
        return QuizRunResult(
            scope=scope, quiz_id=str(existing[0]), source="unchanged", fallback_reason=None
        )

    seed = scope.kind + scope.id

    def accept(data: dict[str, Any]) -> list[str]:
        try:
            parsed = QuizLlmOut.model_validate(data)
        except ValidationError:
            return ["salida con esquema quiz inválido"]
        valid = [
            *questions_from_llm(parsed, material, seed=seed),
            *dictation_questions(material),
        ]
        if len(valid) < MIN_QUESTIONS:
            return [f"menos de {MIN_QUESTIONS} preguntas válidas"]
        return []

    if llm is None:
        if not allow_rules:
            raise LlmUnavailable("LLM apagado")
        return _save_rules(ctx, material, user_text, fallback_reason="llm_off")

    try:
        cached = cached_json(
            ctx.store,
            llm,
            task="quiz",
            system=SYSTEM_PROMPTS["quiz"],
            user=user_text,
            schema=QuizLlmOut,
            prompt_version=PROMPT_VERSIONS["quiz"],
            now=ctx.now,
            accept=accept,
        )
    except LlmUnavailable as exc:
        if not allow_rules:
            raise
        return _save_rules(ctx, material, user_text, fallback_reason=redact(str(exc), ctx.env))

    output = QuizLlmOut.model_validate(cached.data)
    questions = [
        *questions_from_llm(output, material, seed=seed),
        *dictation_questions(material),
    ]
    with ctx.store.tx() as conn:
        qid = save_quiz(
            conn,
            scope,
            output.title_es,
            questions,
            input_hash=input_hash,
            prompt_version=PROMPT_VERSIONS["quiz"],
            model=llm.model,
            now=format_ts(ctx.now()),
        )
    return QuizRunResult(
        scope=scope,
        quiz_id=qid,
        source="cached" if cached.hit else "llm",
        fallback_reason=None,
    )


def scopes_needing_quiz(conn: sqlite3.Connection) -> list[QuizScope]:
    """Temas vivos y publicaciones con ficha ``study`` sin quiz LLM al día.

    Un quiz del respaldo por reglas no satisface la entrada: cuando el LLM vuelve
    se genera el quiz definitivo y el de reglas queda ``stale``.
    """
    candidates: list[QuizScope] = [
        QuizScope("topic", str(row[0]))
        for row in conn.execute(
            "SELECT id FROM study_topics WHERE removed_at IS NULL ORDER BY course_id, position, id"
        )
    ]
    candidates.extend(
        QuizScope("item", str(row[0]))
        for row in conn.execute(
            "SELECT DISTINCT i.id FROM items i JOIN sheets s ON s.item_id = i.id"
            " WHERE i.deleted_at IS NULL AND s.generator = 'study' ORDER BY i.id"
        )
    )

    needed: list[QuizScope] = []
    for scope in candidates:
        material = load_material(conn, scope)
        if material is None:
            continue
        current_hash = content_hash(quiz_input_text(material))
        has_llm_quiz = conn.execute(
            "SELECT 1 FROM quizzes WHERE scope_kind = ? AND scope_id = ? AND input_hash = ?"
            " AND stale = 0 AND model != 'rules' LIMIT 1",
            (scope.kind, scope.id, current_hash),
        ).fetchone()
        if has_llm_quiz is None:
            needed.append(scope)
    return needed


def _save_rules(
    ctx: StageContext,
    material: QuizMaterial,
    user_text: str,
    *,
    fallback_reason: str | None,
) -> QuizRunResult:
    from frances.study.quiz_rules import dictation_questions, rules_questions

    seed = material.scope.kind + material.scope.id
    questions = [
        *rules_questions(material, seed=seed),
        *dictation_questions(material),
    ]
    if not questions:
        _mark_scope_stale(ctx, material.scope)
        return QuizRunResult(
            scope=material.scope, quiz_id=None, source="empty", fallback_reason=fallback_reason
        )
    rules_hash = content_hash("rules", user_text)
    with ctx.store.tx() as conn:
        qid = save_quiz(
            conn,
            material.scope,
            material.title,
            questions,
            input_hash=rules_hash,
            prompt_version=RULES_VERSION,
            model="rules",
            now=format_ts(ctx.now()),
        )
    return QuizRunResult(
        scope=material.scope, quiz_id=qid, source="rules", fallback_reason=fallback_reason
    )


def _mark_scope_stale(ctx: StageContext, scope: QuizScope) -> None:
    """Marca stale el quiz vigente cuando el alcance se queda sin preguntas.

    No inserta un quiz vacío ni toca títulos, preguntas o intentos: solo evita
    que AI-14 sirva como vigente un quiz que ya no corresponde al material.
    """
    with ctx.store.tx() as conn:
        conn.execute(
            "UPDATE quizzes SET stale = 1 WHERE scope_kind = ? AND scope_id = ?",
            (scope.kind, scope.id),
        )


def _load_summaries(conn: sqlite3.Connection, item_ids: Sequence[str]) -> tuple[str, ...]:
    marks = ",".join("?" * len(item_ids))
    by_item: dict[str, str] = {}
    for item_id, raw in conn.execute(
        f"SELECT item_id, json FROM sheets WHERE item_id IN ({marks})", tuple(item_ids)
    ):
        if not isinstance(raw, str):
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        summary = parsed.get("summary_es")
        if isinstance(summary, str) and summary.strip():
            by_item[str(item_id)] = summary
    return tuple(by_item[item_id] for item_id in item_ids if item_id in by_item)


def _load_cards(conn: sqlite3.Connection, item_ids: Sequence[str]) -> tuple[CardFact, ...]:
    marks = ",".join("?" * len(item_ids))
    rows = conn.execute(
        "SELECT c.id, c.kind, c.front_fr, c.back_es, c.example_fr, c.example_es FROM cards c"
        " JOIN card_sources cs ON cs.card_id = c.id"
        f" WHERE cs.item_id IN ({marks}) AND c.owner_user_id IS NULL"
        " AND c.removed_at IS NULL AND c.stale = 0"
        " ORDER BY CASE WHEN c.kind IN ('vocab','phrase') THEN 0 ELSE 1 END, c.id",
        tuple(item_ids),
    ).fetchall()
    base: list[tuple[str, CardKind, str, str, str | None, str | None]] = []
    seen: set[str] = set()
    for row in rows:
        card_id = str(row[0])
        if card_id in seen:
            continue
        seen.add(card_id)
        base.append(
            (
                card_id,
                cast("CardKind", str(row[1])),
                str(row[2]),
                str(row[3]),
                None if row[4] is None else str(row[4]),
                None if row[5] is None else str(row[5]),
            )
        )
        if len(base) >= MAX_CARDS:
            break
    audio_keys = _front_audio_keys(conn, [card_id for card_id, *_rest in base])
    return tuple(
        CardFact(
            card_id=card_id,
            kind=kind,
            front_fr=front_fr,
            back_es=back_es,
            example_fr=example_fr,
            example_es=example_es,
            front_audio_key=audio_keys.get(card_id),
        )
        for card_id, kind, front_fr, back_es, example_fr, example_es in base
    )


def _front_audio_keys(conn: sqlite3.Connection, card_ids: Sequence[str]) -> dict[str, str]:
    if not card_ids:
        return {}
    marks = ",".join("?" * len(card_ids))
    rows = conn.execute(
        "SELECT card_id, MIN(cache_key) FROM card_audio"
        f" WHERE field = 'front' AND card_id IN ({marks}) GROUP BY card_id",
        tuple(card_ids),
    ).fetchall()
    return {str(row[0]): str(row[1]) for row in rows if row[1] is not None}


def _load_fragments(
    conn: sqlite3.Connection,
    item_ids: Sequence[str],
    titles: dict[str, str],
) -> tuple[Fragment, ...]:
    marks = ",".join("?" * len(item_ids))
    rows = conn.execute(
        "SELECT id, item_id, page, text FROM text_blocks"
        f" WHERE item_id IN ({marks}) AND lang IN ('fr', 'mixed')"
        " AND LENGTH(text) > 20 ORDER BY item_id, id",
        tuple(item_ids),
    ).fetchall()
    by_item: dict[str, list[tuple[int, int | None, str]]] = {}
    for row in rows:
        by_item.setdefault(str(row[1]), []).append(
            (int(row[0]), None if row[2] is None else int(row[2]), str(row[3]))
        )

    fragments: list[Fragment] = []
    order = sorted(by_item)
    while len(fragments) < MAX_FRAGMENTS:
        added = False
        for item_id in order:
            bucket = by_item[item_id]
            if not bucket:
                continue
            block_id, page, text = bucket.pop(0)
            title = titles.get(item_id, "")
            label = f"{title}, p. {page}" if page is not None else title
            fragments.append(Fragment(block_id=block_id, item_id=item_id, label=label, text=text))
            added = True
            if len(fragments) >= MAX_FRAGMENTS:
                break
        if not added:
            break
    return tuple(fragments)
