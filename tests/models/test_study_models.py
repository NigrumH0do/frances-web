"""Contratos v2 de estudio (CHG-06)."""

from typing import get_args

import pytest
from pydantic import ValidationError

from frances.models import (
    ChatAskIn,
    ChatEvent,
    FsrsCard,
    Question,
    QuizAttemptIn,
    ReviewIn,
    StudySheet,
)


def test_old_sheet_json_still_validates() -> None:  # compatibilidad con fichas v1 guardadas
    raw = {
        "item_id": "cw_1",
        "summary_es": "r",
        "vocab_card_ids": [],
        "grammar": [],
        "key_phrases": [],
    }
    s = StudySheet.model_validate(raw)
    assert (s.objectives_es, s.common_mistakes, s.prompt_version) == ([], [], None)


def test_review_in_rejects_impossible_state() -> None:
    good = dict(
        due="2026-11-03T10:00:00.000000Z",
        stability=2.0,
        difficulty=5.0,
        elapsed_days=0,
        scheduled_days=1,
        learning_steps=0,
        reps=1,
        lapses=0,
        state=2,
        last_review="2026-11-02T10:00:00.000000Z",
    )
    ReviewIn(
        card_id="c_1",
        rating=3,
        reviewed_at="2026-11-02T10:00:00.000000Z",
        next=FsrsCard(**good),  # type: ignore[arg-type]
    )
    bads: tuple[dict[str, object], ...] = (
        {"stability": 0},
        {"difficulty": 11},
        {"due": "2026-11-01T00:00:00.000000Z"},
    )
    for bad in bads:
        with pytest.raises(ValidationError):
            ReviewIn(
                card_id="c_1",
                rating=3,
                reviewed_at="2026-11-02T10:00:00.000000Z",
                next=FsrsCard(**(good | bad)),  # type: ignore[arg-type]
            )


def test_question_has_no_answer_field() -> None:
    assert not {"answer", "answer_json", "expected"} & set(Question.model_fields)


def test_chat_event_kinds() -> None:
    assert set(get_args(ChatEvent.model_fields["kind"].annotation)) == {
        "meta",
        "token",
        "citation",
        "done",
        "error",
    }


def test_chat_question_length() -> None:
    with pytest.raises(ValidationError):
        ChatAskIn(question="   ")
    with pytest.raises(ValidationError):
        ChatAskIn(question="x" * 2001)
    assert ChatAskIn(question="x" * 2000).question == "x" * 2000


def test_quiz_attempt_answers_bounds() -> None:
    with pytest.raises(ValidationError):
        QuizAttemptIn(started_at="2026-11-02T10:00:00.000000Z", answers=[])
    many = [{"question_id": f"q_{i}", "answer": "a"} for i in range(101)]
    with pytest.raises(ValidationError):
        QuizAttemptIn.model_validate({"started_at": "2026-11-02T10:00:00.000000Z", "answers": many})
