"""Contratos de API de estudio de P10 (CHG-11)."""

import json
import re
from pathlib import Path
from typing import get_args

import pytest
from pydantic import BaseModel, ValidationError

from frances.models import JobKind
from frances.models.schema_cli import export_schemas
from frances.models.study import QuizAttemptOut, StudyJobKind, StudyRunRequest, StudyStatus

# Campos que ningún modelo nuevo de CHG-11 puede exponer: respuestas y datos de otro usuario.
FORBIDDEN_FIELDS = {"answer", "answer_json", "expected", "user_id", "owner_id", "email", "username"}
CHG11_MODELS = (QuizAttemptOut, StudyRunRequest, StudyStatus)
STUDY_KINDS = set(get_args(StudyJobKind))


def _status(pending: dict[str, int]) -> dict[str, object]:
    return {
        "llm_enabled": True,
        "llm_calls_today": 0,
        "llm_calls_cap": 50,
        "pending": pending,
        "last_topics_at": None,
        "last_plan_at": None,
    }


def test_study_status_pending_accepts_exactly_five_kinds() -> None:
    pending = dict.fromkeys(STUDY_KINDS, 0)
    pending["llm.quiz"] = 2
    status = StudyStatus(**_status(pending))
    assert set(status.pending) == STUDY_KINDS
    assert status.pending["llm.quiz"] == 2


def test_study_status_pending_rejects_missing_kind() -> None:
    pending = dict.fromkeys(STUDY_KINDS, 0)
    del pending["plan.daily"]
    with pytest.raises(ValidationError, match=re.escape("plan.daily")):
        StudyStatus(**_status(pending))


def test_study_status_pending_rejects_extra_kind() -> None:
    pending = dict.fromkeys(STUDY_KINDS, 0)
    pending["pipeline.daily"] = 1  # clase de job de P08, no de estudio
    with pytest.raises(ValidationError):
        StudyStatus(**_status(pending))


@pytest.mark.parametrize("model", CHG11_MODELS, ids=lambda m: m.__name__)
def test_chg11_models_have_no_answer_or_foreign_identity_fields(  # Review Focus CHG-11
    model: type[BaseModel],
) -> None:
    assert not FORBIDDEN_FIELDS & set(model.model_fields)


def test_study_run_request_scope_rules() -> None:
    StudyRunRequest(kind="llm.quiz", scope_kind="topic", scope_id="tp_1")
    StudyRunRequest(kind="llm.topics")
    for bad in (
        {"kind": "llm.sheet", "scope_kind": "item", "scope_id": "cw_1"},
        {"kind": "llm.quiz", "scope_kind": "item"},
    ):
        with pytest.raises(ValidationError):
            StudyRunRequest(**bad)


def test_study_job_kinds_are_job_kinds() -> None:
    assert set(get_args(StudyJobKind)) <= set(get_args(JobKind))


def test_api_schema_has_p10_models(tmp_path: Path) -> None:
    export_schemas(tmp_path)
    defs = json.loads((tmp_path / "api.schema.json").read_text())["$defs"]
    assert {"QuizAttemptOut", "StudyRunRequest", "StudyStatus"} <= set(defs)


def test_master_plan_lists_p10_routes() -> None:
    text = Path("docs/superpowers/plans/2026-11-02-00-v2-master-plan.md").read_text()
    for route in (
        "/api/topics/{topic_id}/cards",
        "/api/quizzes/{quiz_id}/attempts",
        "/api/study/status",
        "/api/admin/study/run",
    ):
        assert f"`{route}`" in text
