"""Corrección de quizzes en el servidor (AI-09).

`questions.answer_json` solo lo leen este módulo y los endpoints de quiz.
Ninguna vista de salida lo incluye; `expected` sale solo en `AnswerResult`.
"""

import json
import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from frances.models import AnswerResult, QuestionKind, QuizAttemptIn, QuizAttemptResult
from frances.textnorm import norm_key
from frances.timeutil import norm_ts, parse_ts

_PUNCT_RE = re.compile(r"[.,;:!?¿¡«»\"“”]")
# Guiones sueltos (token que es solo un guion); «peut-être» conserva el suyo.
_LOOSE_DASH_RE = re.compile(r"(?:^|(?<=\s))[-\u2010\u2011\u2012\u2013\u2014](?=\s|$)")
_SPACES_RE = re.compile(r"\s+")


def norm_answer(s: str) -> str:
    """Clave de comparación de respuestas: tolerante a mayúsculas, apóstrofos y puntuación.

    Conserva las tildes: «a» y «à» dan claves distintas.
    """
    text = _PUNCT_RE.sub("", norm_key(s))
    text = _LOOSE_DASH_RE.sub(" ", text)
    return _SPACES_RE.sub(" ", text).strip()


def grade_question(
    kind: QuestionKind,
    answers: Sequence[str],
    options: Sequence[str],
    given: str | list[str],
) -> bool:
    """Indica si `given` es correcta para una pregunta de tipo `kind`."""
    if kind == "order":
        tokens = given.split() if isinstance(given, str) else list(given)
        got = [t for t in (norm_answer(x) for x in tokens) if t]
        want = [t for t in (norm_answer(a) for a in answers) if t]
        return bool(want) and got == want
    if not isinstance(given, str):
        return False
    key = norm_answer(given)
    if not key:
        return False
    if kind == "mcq":
        if key not in {norm_answer(o) for o in options}:
            return False
        return key == norm_answer(answers[0])
    return key in {norm_answer(a) for a in answers}


@dataclass(frozen=True)
class QuestionRow:
    id: str
    position: int
    kind: QuestionKind
    prompt_es: str
    prompt_fr: str | None
    options: list[str]
    answers: list[str]
    explanation_es: str | None
    audio_cache_key: str | None
    audio_done: bool
    source_block_id: int | None


def visible_questions(conn: sqlite3.Connection, quiz_id: str) -> list[QuestionRow]:
    """Preguntas del quiz en orden de `position`, sin los dictados cuyo audio no está listo."""
    rows = conn.execute(
        "SELECT q.id, q.position, q.kind, q.prompt_es, q.prompt_fr, q.options_json,"
        " q.answer_json, q.explanation_es, q.audio_cache_key, q.source_block_id, a.status"
        " FROM questions q LEFT JOIN audio a ON a.cache_key = q.audio_cache_key"
        " WHERE q.quiz_id = ? ORDER BY q.position",
        (quiz_id,),
    ).fetchall()
    out: list[QuestionRow] = []
    for (
        qid,
        position,
        kind,
        prompt_es,
        prompt_fr,
        options_json,
        answer_json,
        explanation_es,
        audio_key,
        block_id,
        audio_status,
    ) in rows:
        audio_done = audio_status == "done"
        if kind == "dictation" and not audio_done:
            continue
        out.append(
            QuestionRow(
                id=qid,
                position=position,
                kind=cast(QuestionKind, kind),
                prompt_es=prompt_es,
                prompt_fr=prompt_fr,
                options=[str(o) for o in json.loads(options_json)],
                answers=[str(a) for a in json.loads(answer_json)],
                explanation_es=explanation_es,
                audio_cache_key=audio_key,
                audio_done=audio_done,
                source_block_id=block_id,
            )
        )
    return out


def grade_attempt(
    conn: sqlite3.Connection,
    user_id: str,
    quiz_id: str,
    attempt: QuizAttemptIn,
    now: str,
) -> QuizAttemptResult:
    """Corrige un intento y guarda su fila en `quiz_attempts` dentro de la transacción del llamador.

    `KeyError` si el quiz no existe. `ValueError` si una respuesta nombra una pregunta
    no visible en el quiz, la repite, o si `started_at` es posterior a `now`.
    """
    exists = conn.execute("SELECT 1 FROM quizzes WHERE id = ?", (quiz_id,)).fetchone()
    if exists is None:
        raise KeyError(quiz_id)
    started = parse_ts(attempt.started_at)
    finished = parse_ts(now)
    if started > finished:
        raise ValueError("started_at es posterior a now")

    questions = visible_questions(conn, quiz_id)
    visible = {q.id: q for q in questions}
    given: dict[str, str | list[str]] = {}
    for item in attempt.answers:
        if item.question_id not in visible:
            raise ValueError(f"la pregunta {item.question_id} no es visible en el quiz")
        if item.question_id in given:
            raise ValueError(f"la pregunta {item.question_id} se respondió dos veces")
        given[item.question_id] = item.answer

    results: list[AnswerResult] = []
    correct = 0
    for q in questions:
        # Las no respondidas puntúan como fallo pero no revelan `expected`.
        if q.id not in given:
            continue
        ok = grade_question(q.kind, q.answers, q.options, given[q.id])
        correct += ok
        expected: str | list[str] = list(q.answers) if q.kind == "order" else q.answers[0]
        results.append(
            AnswerResult(
                question_id=q.id,
                correct=ok,
                expected=expected,
                explanation_es=q.explanation_es,
            )
        )

    score = round(correct / len(questions), 4) if questions else 0.0
    answers_json = json.dumps([item.model_dump() for item in attempt.answers], ensure_ascii=False)
    cursor = conn.execute(
        "INSERT INTO quiz_attempts (user_id, quiz_id, answers_json, score, started_at, finished_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, quiz_id, answers_json, score, norm_ts(attempt.started_at), norm_ts(now)),
    )
    attempt_id = cursor.lastrowid
    assert attempt_id is not None
    return QuizAttemptResult(attempt_id=attempt_id, score=score, results=results)
