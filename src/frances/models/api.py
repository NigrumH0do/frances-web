"""Contratos v2: vistas de lectura del contenido para la API (plan maestro v2, CHG-05)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from frances.models.bundle import AudioPending
from frances.models.classroom import AttachmentKind, AttachmentStatus, ItemKind
from frances.models.content import CardKind, Lang, StudySheet
from frances.models.study import UserCardStateOut


class ApiError(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message_es: str


class FileLink(BaseModel):
    """``url`` relativa: /api/files/<sha256>."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str
    size: int
    mime: str
    sha256: str


class AudioClip(BaseModel):
    """``url`` relativa: /api/audio/<cache_key>."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    field: Literal["front", "example"]
    voice_id: str
    url: str
    duration_ms: int | None


class AttachmentView(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    kind: AttachmentKind
    title: str | None
    url: str | None
    mime_type: str | None
    status: AttachmentStatus
    file: FileLink | None
    view_pdf: FileLink | None


class ItemSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    course_id: str
    kind: ItemKind
    topic_id: str | None
    title: str | None
    text_lang: Lang
    created_at: str
    updated_at: str
    first_seen_at: str
    due_at: str | None
    n_attachments: int
    n_cards: int
    has_sheet: bool


class ItemDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item: ItemSummary
    text: str
    alternate_link: str | None
    attachments: list[AttachmentView]
    card_ids: list[str]
    sheet: StudySheet | None


class ItemPage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    items: list[ItemSummary]
    next_cursor: str | None


class CardOverride(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    front_fr: str
    back_es: str
    example_fr: str | None
    example_es: str | None
    notes: str | None
    base_updated_at: str
    updated_at: str


class CardView(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    kind: CardKind
    front_fr: str
    back_es: str
    example_fr: str | None
    example_es: str | None
    notes: str | None
    ipa: str | None
    phonemes: list[str]
    tags: list[str]
    stale: bool
    source_item_ids: list[str]
    audio: list[AudioClip]
    audio_pending: list[AudioPending]
    owner: Literal["shared", "mine"]
    edited_by_human: bool
    source_changed: bool
    # datos del usuario de la sesión
    mine: CardOverride | None
    state: UserCardStateOut | None


class CardPage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cards: list[CardView]
    next_cursor: str | None


class SpeechToken(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    token: str
    region: str
    locale: Literal["fr-FR"] = "fr-FR"
    expires_at: str


#: Tope de caracteres de un texto de práctica libre (PRACTICE-01).
PRACTICE_TEXT_MAX = 400


class PracticeTtsIn(BaseModel):
    """Texto libre del usuario y la voz con la que quiere oírlo."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str = Field(max_length=PRACTICE_TEXT_MAX)
    voice_id: str = Field(min_length=1, max_length=80)


class PracticeTtsOut(BaseModel):
    """Clip listo del texto normalizado; ``url`` se sirve con ``GET /api/audio/{key}``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cache_key: str
    text: str
    voice_id: str
    status: Literal["done"]
    url: str
    duration_ms: int | None
