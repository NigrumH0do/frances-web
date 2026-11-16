import json
from pathlib import Path
from typing import get_args

from frances.models import (
    CardView,
    FsrsCard,
    Health,
    ItemDetail,
    JobKind,
    JobOut,
    Me,
    UserCardStateOut,
    UserOut,
)
from frances.models.schema_cli import API_SCHEMA_MODELS, export_schemas


def test_models_are_frozen_and_forbid_extra() -> None:
    for m in (UserOut, Me, JobOut, CardView, ItemDetail, Health, UserCardStateOut):
        assert m.model_config["frozen"] is True and m.model_config["extra"] == "forbid"


def test_all_api_schema_models_are_frozen_and_forbid_extra() -> None:
    for m in API_SCHEMA_MODELS:
        assert m.model_config["frozen"] is True and m.model_config["extra"] == "forbid", m


def test_job_kind_contract() -> None:
    assert set(get_args(JobKind)) == {
        "pipeline.daily",
        "pipeline.reconcile",
        "auth.check",
        "index.text_blocks",
        "llm.sheet",
        "llm.topics",
        "llm.quiz",
        "plan.daily",
        "cards.regenerate_item",
        "audio.regenerate",
    }


def test_card_view_carries_user_state() -> None:
    st = UserCardStateOut(
        card_id="c_1",
        fsrs=FsrsCard(
            due="2026-11-02T10:00:00.000000Z",
            stability=1.0,
            difficulty=5.0,
            elapsed_days=0,
            scheduled_days=1,
            learning_steps=0,
            reps=1,
            lapses=0,
            state=1,
            last_review=None,
        ),
        suspended=False,
        flagged_hard=True,
        updated_at="2026-11-02T10:00:00.000000Z",
    )
    assert CardView.model_fields["state"].annotation == UserCardStateOut | None and st.flagged_hard


# Solo pueden llevar respuesta la entrada del alumno (AnswerIn) y el resultado
# que se devuelve después de corregir (AnswerResult). Ninguna vista que se
# entrega antes de responder la expone (Review Focus CHG-05, ajustado en CHG-06).
_ANSWER_FIELDS_ALLOWED = {"AnswerIn", "AnswerResult"}


def test_no_api_view_exposes_answers() -> None:  # Review Focus CHG-05
    for m in API_SCHEMA_MODELS:
        if m.__name__ in _ANSWER_FIELDS_ALLOWED:
            continue
        assert not {"answer", "answer_json", "expected"} & set(m.model_fields), m


def test_api_schema_exported(tmp_path: Path) -> None:
    export_schemas(tmp_path)
    schema = json.loads((tmp_path / "api.schema.json").read_text())
    assert schema["title"] == "FrancesApi"
    defs = schema["$defs"]
    assert {"CardView", "ItemDetail", "Me", "JobOut", "PipelineStatus", "SpeechToken"} <= set(defs)
