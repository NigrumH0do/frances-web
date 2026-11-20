"""Contratos v2 de estudio (plan maestro v2).

CHG-05 crea el archivo con ``FsrsStateCode``, ``FsrsCard`` y ``UserCardStateOut``
(los usa ``CardView``); CHG-06 agrega el resto.

``models.api`` importa este módulo (``CardView`` usa ``UserCardStateOut``), así que
``AudioClip`` se importa solo para tipos y ``frances.models`` reconstruye
``Question`` y ``Quiz`` cuando ambos módulos ya están cargados.
"""

from typing import TYPE_CHECKING, Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from frances.timeutil import parse_ts

if TYPE_CHECKING:
    from frances.models.api import AudioClip

FsrsStateCode = Literal[0, 1, 2, 3]  # New, Learning, Review, Relearning (ts-fsrs)


class FsrsCard(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    due: str
    stability: float
    difficulty: float
    elapsed_days: int
    scheduled_days: int
    learning_steps: int
    reps: int
    lapses: int
    state: FsrsStateCode
    last_review: str | None


class UserCardStateOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    card_id: str
    fsrs: FsrsCard
    suspended: bool
    flagged_hard: bool
    updated_at: str


# ---- desde aquí, CHG-06 ----


class ReviewIn(BaseModel):
    """Repaso calculado en el cliente con ts-fsrs; el servidor valida que sea posible (R-38)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    card_id: str
    rating: Literal[1, 2, 3, 4]
    reviewed_at: str
    next: FsrsCard

    @model_validator(mode="after")
    def _check_next(self) -> "ReviewIn":
        if not self.next.stability > 0:
            raise ValueError("next.stability debe ser > 0")
        if not 1 <= self.next.difficulty <= 10:
            raise ValueError("next.difficulty debe estar entre 1 y 10")
        if parse_ts(self.next.due) < parse_ts(self.reviewed_at):
            raise ValueError("next.due no puede ser anterior a reviewed_at")
        return self


class CardFlagsIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    suspended: bool | None = None
    flagged_hard: bool | None = None


class CardOverrideIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    front_fr: str
    back_es: str
    example_fr: str | None = None
    example_es: str | None = None
    notes: str | None = None


class OwnCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["vocab", "phrase", "grammar", "conjugation"]
    front_fr: str
    back_es: str
    example_fr: str | None = None
    example_es: str | None = None
    notes: str | None = None


class UserPrefs(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    preferred_voice_ids: list[str] = []
    daily_new_cards: int = 10
    theme: Literal["system", "light", "dark"] = "system"


Cefr = Literal["A1", "A2", "B1", "B2", "C1", "C2"]


class StudyTopic(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    course_id: str
    title: str
    description_es: str
    cefr: Cefr | None
    position: int
    item_ids: list[str]
    card_count: int
    edited_by_human: bool
    source_changed: bool


QuestionKind = Literal["mcq", "cloze", "translate", "order", "dictation"]


class Question(BaseModel):
    """Pregunta de salida. La respuesta NO viaja al cliente: no hay campo para ella."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    kind: QuestionKind
    prompt_es: str
    prompt_fr: str | None
    options: list[str]
    audio: "AudioClip | None"
    source_item_id: str | None


class Quiz(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    scope_kind: Literal["topic", "item"]
    scope_id: str
    title_es: str
    questions: list[Question]
    stale: bool


class AnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    answer: str | list[str]


class QuizAttemptIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    started_at: str
    answers: list[AnswerIn] = Field(min_length=1, max_length=100)


class AnswerResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    correct: bool
    expected: str | list[str]
    explanation_es: str | None


class QuizAttemptResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    attempt_id: int
    score: float
    results: list[AnswerResult]


PlanKind = Literal["review", "quiz", "read", "drill"]


class PlanEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    position: int
    kind: PlanKind
    ref_id: str | None
    title_es: str
    reason_es: str
    why_llm_es: str | None
    done: bool


class StudyPlanDay(BaseModel):
    """``day`` = YYYY-MM-DD en Bogotá."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    day: str
    entries: list[PlanEntry]
    generated_at: str


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item_id: str
    item_title: str | None = None
    source: str
    page: int | None
    block_id: int
    snippet: str


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int
    role: Literal["user", "assistant"]
    content: str
    citations: list[Citation]
    status: Literal["ok", "no_material", "error", "partial"]
    created_at: str


class ChatThreadOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    title: str
    created_at: str
    updated_at: str


class ChatThreadDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    thread: ChatThreadOut
    messages: list[ChatMessageOut]


class ChatAskIn(BaseModel):
    """``question``: 1…2000 caracteres tras ``strip()`` (se guarda sin espacios de borde)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]


class ChatEvent(BaseModel):
    """Cada evento SSE del chat (``event`` = ``kind``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["meta", "token", "citation", "done", "error"]
    text: str | None = None
    citation: Citation | None = None
    message_id: int | None = None
    code: str | None = None


class SearchHit(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    block_id: int
    item_id: str
    source: str
    page: int | None
    snippet: str
    score: float


# ---- CHG-11: contratos de API de estudio de P10 ----

StudyJobKind = Literal["index.text_blocks", "llm.sheet", "llm.topics", "llm.quiz", "plan.daily"]


class QuizAttemptOut(BaseModel):
    """Intento anterior del usuario. No incluye respuestas ni texto de otro usuario."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    attempt_id: int
    quiz_id: str
    score: float
    started_at: str
    finished_at: str


class StudyRunRequest(BaseModel):
    """``scope_kind`` y ``scope_id`` solo con ``kind == "llm.quiz"``, y van juntos."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: StudyJobKind
    scope_kind: Literal["topic", "item"] | None = None
    scope_id: str | None = None

    @model_validator(mode="after")
    def _check_scope(self) -> "StudyRunRequest":
        has_scope = self.scope_kind is not None or self.scope_id is not None
        if not has_scope:
            return self
        if self.kind != "llm.quiz":
            raise ValueError("scope_kind/scope_id solo aplican a llm.quiz")
        if self.scope_kind is None or self.scope_id is None:
            raise ValueError("scope_kind y scope_id van juntos")
        return self


class StudyStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    llm_enabled: bool
    llm_calls_today: int
    llm_calls_cap: int
    pending: dict[StudyJobKind, int]  # queued + running por kind; siempre con las 5 claves
    last_topics_at: str | None
    last_plan_at: str | None

    @model_validator(mode="after")
    def _check_pending_keys(self) -> "StudyStatus":
        expected = set(get_args(StudyJobKind))
        present = set(self.pending)
        if present != expected:
            missing = sorted(expected - present)
            extra = sorted(present - expected)
            raise ValueError(
                f"pending debe tener exactamente las claves de StudyJobKind; "
                f"faltan {missing}, sobran {extra}"
            )
        return self


# ---- CHG-12: contratos de progreso del usuario de P09 ----


class DayCount(BaseModel):
    """``day`` = YYYY-MM-DD en Bogotá."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    day: str
    reviews: int
    quiz_attempts: int


class QuizBest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    quiz_id: str
    title_es: str
    best_score: float
    attempts: int
    last_at: str


class UserStats(BaseModel):
    """``retention_30d`` es None si hay menos de 10 reseñas con estado previo 2 en 30 días.

    ``week`` tiene 7 entradas, de lunes a domingo de la semana actual (Bogotá).
    ``quiz_best`` tiene hasta 5 entradas, ordenadas por ``last_at`` descendente.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cards_learned: int
    due_now: int
    reviews_today: int
    retention_30d: float | None
    streak_days: int
    week: list[DayCount] = Field(min_length=7, max_length=7)
    quiz_best: list[QuizBest] = Field(max_length=5)


class TopicProgress(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    topic_id: str
    cards_total: int
    cards_learned: int
    last_quiz_score: float | None
