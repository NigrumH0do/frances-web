"""Corrección de quizzes en el servidor (AI-09). Fixtures sintéticos, sin red."""

import json
import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from frances.db.store import Store
from frances.models import AnswerIn, QuizAttemptIn
from frances.study.grading import grade_attempt, grade_question, visible_questions

T0 = "2026-11-02T10:00:00Z"
T1 = "2026-11-02T10:05:00Z"
Q1 = "q_1"  # mcq, visible, respuesta «manzana»
Q_DICTATION_NO_AUDIO = "q_5"  # dictado cuyo audio sigue pending: no es visible


@pytest.fixture
def conn_with_quiz(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    store = Store.open(tmp_path / "grading.db")
    try:
        conn = store.conn
        conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (T0,),
        )
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
            " VALUES ('u_1', 'u1@example.test', 'Usuario 1', 'x', 'user', ?)",
            (T0,),
        )
        conn.execute(
            "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash,"
            " prompt_version, model, stale, created_at)"
            " VALUES ('qz_1', 'topic', 'tp_1', 'Quiz de prueba', 'h', 'quiz-1', 'm', 0, ?)",
            (T0,),
        )
        conn.execute(
            "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
            " status, updated_at) VALUES ('aud_1', 'Il fait beau.', 'Il fait beau.',"
            " 'v', 'f', '1', 'pending', ?)",
            (T0,),
        )
        questions = [
            (
                Q1,
                0,
                "mcq",
                "¿Cuál es la manzana?",
                None,
                ["pera", "manzana", "uva", "kiwi"],
                ["manzana"],
                None,
            ),
            ("q_2", 1, "cloze", "Completa: je ___ à l'école", None, [], ["vais"], None),
            ("q_3", 2, "translate", "La manzana", None, [], ["la pomme", "pomme"], None),
            (
                "q_4",
                3,
                "order",
                "Ordena la frase",
                None,
                ["l'école", "je", "à", "vais"],
                ["je", "vais", "à", "l'école"],
                None,
            ),
            (
                Q_DICTATION_NO_AUDIO,
                4,
                "dictation",
                "Escucha y escribe",
                None,
                [],
                ["Il fait beau."],
                "aud_1",
            ),
        ]
        for qid, pos, kind, prompt, prompt_fr, options, answers, audio_key in questions:
            conn.execute(
                "INSERT INTO questions (id, quiz_id, position, kind, prompt_es, prompt_fr,"
                " options_json, answer_json, explanation_es, audio_cache_key)"
                " VALUES (?, 'qz_1', ?, ?, ?, ?, ?, ?, NULL, ?)",
                (
                    qid,
                    pos,
                    kind,
                    prompt,
                    prompt_fr,
                    json.dumps(options),
                    json.dumps(answers),
                    audio_key,
                ),
            )
        yield conn
    finally:
        store.close()


@pytest.mark.parametrize(
    "kind,answers,options,given,ok",
    [
        ("mcq", ["manzana"], ["pera", "manzana", "uva", "kiwi"], "Manzana", True),
        ("mcq", ["manzana"], ["pera", "manzana", "uva", "kiwi"], "naranja", False),
        ("cloze", ["vais"], [], " Vais. ", True),
        ("translate", ["la pomme", "pomme"], [], "La pomme !", True),
        ("translate", ["à la maison"], [], "a la maison", False),  # la tilde importa
        (
            "order",
            ["je", "vais", "à", "l'école"],
            ["l'école", "je", "à", "vais"],
            ["je", "vais", "à", "l\u2019école"],
            True,
        ),
        ("order", ["je", "vais"], ["vais", "je"], "je vais", True),
        ("dictation", ["Il fait beau."], [], "il fait beau", True),
        ("cloze", ["vais"], [], ["vais"], False),
    ],
)
def test_grade_question(
    kind: str, answers: list[str], options: list[str], given: str | list[str], ok: bool
) -> None:
    assert grade_question(kind, answers, options, given) is ok  # type: ignore[arg-type]


def test_grade_attempt_scores_saves_and_reveals_after(conn_with_quiz: sqlite3.Connection) -> None:
    # 4 preguntas visibles + 1 dictado sin audio
    attempt = QuizAttemptIn(started_at=T0, answers=[AnswerIn(question_id=Q1, answer="manzana")])
    res = grade_attempt(conn_with_quiz, "u_1", "qz_1", attempt, T1)
    assert res.score == 0.25
    assert [r.question_id for r in res.results] == [Q1]
    assert res.results[0].expected == "manzana"
    assert conn_with_quiz.execute("SELECT user_id, score FROM quiz_attempts").fetchone() == (
        "u_1",
        0.25,
    )


def test_one_answer_reveals_expected_only_for_that_question(
    conn_with_quiz: sqlite3.Connection,
) -> None:
    # Quiz de 5 preguntas (4 visibles + dictado sin audio); solo se responde q_3.
    attempt = QuizAttemptIn(started_at=T0, answers=[AnswerIn(question_id="q_3", answer="pomme")])
    res = grade_attempt(conn_with_quiz, "u_1", "qz_1", attempt, T1)
    assert [r.question_id for r in res.results] == ["q_3"]
    assert res.results[0].correct is True and res.results[0].expected == "la pomme"
    assert res.score == 0.25


def test_malicious_answers_grade_without_error_and_fast(
    conn_with_quiz: sqlite3.Connection,
) -> None:
    attempt = QuizAttemptIn(
        started_at=T0,
        answers=[
            AnswerIn(question_id=Q1, answer="a" * 300_000),
            AnswerIn(question_id="q_2", answer="\x00\x07\x1b[31m\u202e\ufeff\r\n\t\x7f"),
            AnswerIn(question_id="q_3", answer="😀🇫🇷👩‍👩‍👧 é\U0001f4a9"),
            AnswerIn(question_id="q_4", answer=[f"tok{i}" for i in range(10_000)]),
        ],
    )
    started = time.perf_counter()
    res = grade_attempt(conn_with_quiz, "u_1", "qz_1", attempt, T1)
    elapsed = time.perf_counter() - started
    assert elapsed < 1.0
    assert res.score == 0.0
    assert len(res.results) == 4 and not any(r.correct for r in res.results)


@pytest.mark.parametrize("given", ["  ", "...", " ¿? ", "«»"])
def test_answer_empty_after_normalization_is_wrong(given: str) -> None:
    assert grade_question("cloze", ["vais"], [], given) is False
    assert grade_question("translate", ["la pomme"], [], given) is False
    assert grade_question("mcq", ["manzana"], ["manzana", "pera"], given) is False


def test_foreign_or_repeated_question_is_rejected(conn_with_quiz: sqlite3.Connection) -> None:
    for answers in (
        [AnswerIn(question_id="q_otro", answer="x")],
        [AnswerIn(question_id=Q1, answer="a"), AnswerIn(question_id=Q1, answer="b")],
        [AnswerIn(question_id=Q_DICTATION_NO_AUDIO, answer="x")],
    ):
        with pytest.raises(ValueError):
            grade_attempt(
                conn_with_quiz, "u_1", "qz_1", QuizAttemptIn(started_at=T0, answers=answers), T1
            )
    assert conn_with_quiz.execute("SELECT COUNT(*) FROM quiz_attempts").fetchone()[0] == 0


def test_visible_questions_hide_dictation_without_audio(conn_with_quiz: sqlite3.Connection) -> None:
    ids = [q.id for q in visible_questions(conn_with_quiz, "qz_1")]
    assert ids == [Q1, "q_2", "q_3", "q_4"]


def test_visible_question_row_includes_answers_for_internal_grading(
    conn_with_quiz: sqlite3.Connection,
) -> None:
    row = visible_questions(conn_with_quiz, "qz_1")[0]
    assert row.answers == ["manzana"] and row.options == ["pera", "manzana", "uva", "kiwi"]


def test_unanswered_questions_count_as_wrong_but_are_not_revealed(
    conn_with_quiz: sqlite3.Connection,
) -> None:
    attempt = QuizAttemptIn(
        started_at=T0,
        answers=[AnswerIn(question_id="q_4", answer=["je", "vais", "à", "l'école"])],
    )
    res = grade_attempt(conn_with_quiz, "u_1", "qz_1", attempt, T1)
    assert res.score == 0.25
    assert [r.question_id for r in res.results] == ["q_4"]
    assert res.results[0].correct is True
    assert res.results[0].expected == ["je", "vais", "à", "l'école"]


def test_missing_quiz_raises_key_error(conn_with_quiz: sqlite3.Connection) -> None:
    attempt = QuizAttemptIn(started_at=T0, answers=[AnswerIn(question_id=Q1, answer="x")])
    with pytest.raises(KeyError):
        grade_attempt(conn_with_quiz, "u_1", "qz_no", attempt, T1)


def test_started_after_now_is_rejected(conn_with_quiz: sqlite3.Connection) -> None:
    attempt = QuizAttemptIn(started_at=T1, answers=[AnswerIn(question_id=Q1, answer="x")])
    with pytest.raises(ValueError):
        grade_attempt(conn_with_quiz, "u_1", "qz_1", attempt, T0)
