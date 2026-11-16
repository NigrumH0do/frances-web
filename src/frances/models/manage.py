"""Contratos de gestión de P11: tarjetas, audio y temas (CHG-17)."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

_Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
_Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
_VoiceId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _reject_duplicates(values: list[str], field: str) -> None:
    if len(set(values)) != len(values):
        raise ValueError(f"{field} no puede tener duplicados")


class DefaultVoicesIn(BaseModel):
    """Voces por defecto del audio (``PUT /api/admin/voices/default``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    voice_ids: list[_VoiceId] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def _check_unique_voice_ids(self) -> "DefaultVoicesIn":
        _reject_duplicates(self.voice_ids, "voice_ids")
        return self


class TopicUpdateIn(BaseModel):
    """Cambios de un tema editable; al menos ``title`` o ``description_es``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    title: _Title | None = None
    description_es: _Description | None = None

    @model_validator(mode="after")
    def _check_at_least_one_field(self) -> "TopicUpdateIn":
        if self.title is None and self.description_es is None:
            raise ValueError("title o description_es debe estar presente")
        return self


class TopicsMergeIn(BaseModel):
    """Unión de temas; el primer id de ``topic_ids`` es el superviviente."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    topic_ids: list[str] = Field(min_length=2, max_length=20)
    title: _Title

    @model_validator(mode="after")
    def _check_unique_topic_ids(self) -> "TopicsMergeIn":
        _reject_duplicates(self.topic_ids, "topic_ids")
        return self


class TopicSplitIn(BaseModel):
    """División de un tema: publicaciones que pasan al tema nuevo."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    item_ids: list[str] = Field(min_length=1, max_length=200)
    title: _Title

    @model_validator(mode="after")
    def _check_unique_item_ids(self) -> "TopicSplitIn":
        _reject_duplicates(self.item_ids, "item_ids")
        return self


class TopicItemsIn(BaseModel):
    """Publicaciones que se mueven a otro tema."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    item_ids: list[str] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _check_unique_item_ids(self) -> "TopicItemsIn":
        _reject_duplicates(self.item_ids, "item_ids")
        return self
