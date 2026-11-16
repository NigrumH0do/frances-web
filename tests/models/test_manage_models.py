"""Contratos de gestión de P11 (CHG-17)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from frances.models.manage import (
    DefaultVoicesIn,
    TopicItemsIn,
    TopicsMergeIn,
    TopicSplitIn,
    TopicUpdateIn,
)
from frances.models.schema_cli import export_schemas

MANAGE_MODELS = (
    DefaultVoicesIn,
    TopicItemsIn,
    TopicSplitIn,
    TopicUpdateIn,
    TopicsMergeIn,
)


def test_default_voices_requires_unique_nonempty_ids() -> None:
    assert DefaultVoicesIn(voice_ids=["fr-FR-DeniseNeural"]).voice_ids == ["fr-FR-DeniseNeural"]
    for bad in ([], ["a", "a"], ["  "]):
        with pytest.raises(ValidationError):
            DefaultVoicesIn(voice_ids=bad)


def test_topic_update_requires_at_least_one_field() -> None:
    assert TopicUpdateIn(title="  Salutations  ").title == "Salutations"
    assert TopicUpdateIn(description_es="").description_es == ""
    for bad in ({}, {"title": "   "}):
        with pytest.raises(ValidationError):
            TopicUpdateIn(**bad)


def test_merge_split_and_move_bounds() -> None:
    assert TopicsMergeIn(topic_ids=["tp_1", "tp_2"], title="  Unité  ").title == "Unité"
    assert TopicsMergeIn(topic_ids=["tp_1", "tp_2"], title="Unité").topic_ids == ["tp_1", "tp_2"]
    for body in (
        {"topic_ids": ["tp_1"], "title": "x"},
        {"topic_ids": ["tp_1", "tp_1"], "title": "x"},
        {"topic_ids": ["tp_1", "tp_2"], "title": "   "},
    ):
        with pytest.raises(ValidationError):
            TopicsMergeIn(**body)
    with pytest.raises(ValidationError):
        TopicSplitIn(item_ids=[], title="x")
    with pytest.raises(ValidationError):
        TopicSplitIn(item_ids=["cw_1", "cw_1"], title="x")
    assert TopicSplitIn(item_ids=["cw_1"], title="  Nombres  ").title == "Nombres"
    with pytest.raises(ValidationError):
        TopicItemsIn(item_ids=["cw_1", "cw_1"])
    assert TopicItemsIn(item_ids=["cw_1", "cw_2"]).item_ids == ["cw_1", "cw_2"]


def test_manage_models_are_reexported() -> None:
    import frances.models as models

    for model in MANAGE_MODELS:
        assert getattr(models, model.__name__) is model
        assert model.__name__ in models.__all__


def test_api_schema_has_manage_models(tmp_path: Path) -> None:
    export_schemas(tmp_path)

    defs = json.loads((tmp_path / "api.schema.json").read_text())["$defs"]
    assert {
        "DefaultVoicesIn",
        "TopicUpdateIn",
        "TopicsMergeIn",
        "TopicSplitIn",
        "TopicItemsIn",
    } <= set(defs)


def test_master_plan_names_manage_models() -> None:
    text = Path("docs/superpowers/plans/2026-11-02-00-v2-master-plan.md").read_text()
    for name in (
        "DefaultVoicesIn",
        "TopicUpdateIn",
        "TopicsMergeIn",
        "TopicSplitIn",
        "TopicItemsIn",
    ):
        assert f"`{name}`" in text
