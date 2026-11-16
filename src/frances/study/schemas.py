"""Salidas internas del LLM y entradas de los renderizadores de prompts (AI-02).

Estos modelos no son contrato de la API: no van a ``contracts/``.
"""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict

from frances.models.content import CardKind, CommonMistake, Example, GrammarPoint
from frances.models.study import Cefr, PlanKind

LlmQuestionKind = Literal["mcq", "cloze", "translate", "order"]  # el dictado lo arma quiz_rules


class SheetLlmOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    summary_es: str
    objectives_es: list[str]
    vocab_fronts: list[str]
    grammar: list[GrammarPoint]
    key_phrases: list[Example]
    common_mistakes: list[CommonMistake]


class TopicLlm(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    existing_topic_id: str | None
    title: str
    description_es: str
    cefr: Cefr | None
    item_ids: list[str]


class TopicsLlmOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    topics: list[TopicLlm]


class QuestionLlm(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: LlmQuestionKind
    prompt_es: str
    prompt_fr: str | None
    options: list[str]
    answers: list[str]
    explanation_es: str | None
    source_block: int  # número local del fragmento (1…n)


class QuizLlmOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title_es: str
    questions: list[QuestionLlm]


class PlanWhyLine(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    position: int
    why_es: str


class PlanWhyLlmOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    lines: list[PlanWhyLine]


@dataclass(frozen=True)
class PromptFragment:
    """Fragmento numerado del material. ``label`` = "Título de la publicación, p. 3"."""

    n: int
    label: str
    text: str


@dataclass(frozen=True)
class PromptCard:
    kind: CardKind
    front_fr: str
    back_es: str


@dataclass(frozen=True)
class PromptTopic:
    id: str
    title: str
    description_es: str
    locked: bool


@dataclass(frozen=True)
class PromptItem:
    id: str
    title: str
    classroom_topic: str | None
    summary_es: str
    tags: tuple[str, ...]
    current_topic_id: str | None
    locked: bool


@dataclass(frozen=True)
class PromptPlanEntry:
    position: int
    kind: PlanKind
    title_es: str
    reason_es: str
