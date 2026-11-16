"""Comando ``frances schema export DIR``: vuelca los contratos a JSON Schema."""

import json
from pathlib import Path
from typing import Annotated

import typer
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from frances.models.accounts import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    CreateInviteRequest,
    InviteCheckRequest,
    InviteCreated,
    InviteOut,
    InviteStatus,
    LoginRequest,
    Me,
    UserOut,
)
from frances.models.api import (
    ApiError,
    AttachmentView,
    AudioClip,
    CardOverride,
    CardPage,
    CardView,
    FileLink,
    ItemDetail,
    ItemPage,
    ItemSummary,
    PracticeTtsIn,
    PracticeTtsOut,
    SpeechToken,
)
from frances.models.bundle import BundleManifest, ContentIndex
from frances.models.content import CommonMistake
from frances.models.jobs import (
    Health,
    JobOut,
    PipelineRunRequest,
    PipelineStatus,
    RunOut,
    UsageLineOut,
)
from frances.models.manage import (
    DefaultVoicesIn,
    TopicItemsIn,
    TopicsMergeIn,
    TopicSplitIn,
    TopicUpdateIn,
)
from frances.models.pron import PronResult
from frances.models.study import (
    AnswerIn,
    AnswerResult,
    CardFlagsIn,
    CardOverrideIn,
    ChatAskIn,
    ChatEvent,
    ChatMessageOut,
    ChatThreadDetail,
    ChatThreadOut,
    Citation,
    DayCount,
    FsrsCard,
    OwnCardIn,
    PlanEntry,
    Question,
    Quiz,
    QuizAttemptIn,
    QuizAttemptOut,
    QuizAttemptResult,
    QuizBest,
    ReviewIn,
    SearchHit,
    StudyPlanDay,
    StudyRunRequest,
    StudyStatus,
    StudyTopic,
    TopicProgress,
    UserCardStateOut,
    UserPrefs,
    UserStats,
)

SCHEMAS: dict[str, type[BaseModel]] = {
    "content-index": ContentIndex,
    "bundle-manifest": BundleManifest,
    "pron-result": PronResult,
}

# Todas las clases v2 (plan maestro v2, «Modelos Pydantic v2»); van a api.schema.json.
API_SCHEMA_MODELS: tuple[type[BaseModel], ...] = (
    # models/accounts.py
    UserOut,
    Me,
    LoginRequest,
    InviteCheckRequest,
    InviteStatus,
    AcceptInviteRequest,
    ChangePasswordRequest,
    CreateInviteRequest,
    InviteOut,
    InviteCreated,
    # models/jobs.py
    JobOut,
    PipelineRunRequest,
    RunOut,
    UsageLineOut,
    PipelineStatus,
    Health,
    # models/api.py
    ApiError,
    FileLink,
    AudioClip,
    AttachmentView,
    ItemSummary,
    ItemDetail,
    ItemPage,
    CardOverride,
    CardView,
    CardPage,
    SpeechToken,
    PracticeTtsIn,
    PracticeTtsOut,
    # models/study.py
    FsrsCard,
    UserCardStateOut,
    ReviewIn,
    CardFlagsIn,
    CardOverrideIn,
    OwnCardIn,
    UserPrefs,
    StudyTopic,
    Question,
    Quiz,
    AnswerIn,
    QuizAttemptIn,
    AnswerResult,
    QuizAttemptResult,
    QuizAttemptOut,
    PlanEntry,
    StudyPlanDay,
    StudyRunRequest,
    StudyStatus,
    Citation,
    ChatMessageOut,
    ChatThreadOut,
    ChatThreadDetail,
    ChatAskIn,
    ChatEvent,
    SearchHit,
    # models/study.py (CHG-12, progreso P09)
    DayCount,
    QuizBest,
    UserStats,
    TopicProgress,
    # models/content.py (CHG-06)
    CommonMistake,
    # models/manage.py (CHG-17, gestión P11)
    DefaultVoicesIn,
    TopicItemsIn,
    TopicSplitIn,
    TopicUpdateIn,
    TopicsMergeIn,
)


def _dump(schema: object, path: Path) -> Path:
    text = json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8")
    return path


def export_schemas(out_dir: Path) -> list[Path]:
    """Escribe los JSON Schema en ``out_dir`` de forma determinista.

    Uno por cada modelo raíz de ``SCHEMAS`` y ``api.schema.json`` con los
    ``$defs`` de todas las clases de ``API_SCHEMA_MODELS``.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, model in SCHEMAS.items():
        schema = model.model_json_schema(mode="serialization")
        written.append(_dump(schema, out_dir / f"{name}.schema.json"))
    _, api_schema = models_json_schema(
        [(m, "serialization") for m in API_SCHEMA_MODELS], title="FrancesApi"
    )
    written.append(_dump(api_schema, out_dir / "api.schema.json"))
    return written


def register(app: typer.Typer) -> None:
    """Registra el subcomando ``schema export DIR`` en la CLI."""
    schema_app = typer.Typer(help="Contratos: JSON Schema y tipos generados.")

    @schema_app.command("export")
    def export_cmd(
        dir: Annotated[Path, typer.Argument(help="Directorio donde escribir los schemas.")],
    ) -> None:
        for path in export_schemas(dir):
            typer.echo(str(path))

    app.add_typer(schema_app, name="schema")
