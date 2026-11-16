"""Contratos de API de progreso del usuario de P09 (CHG-12)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from frances.models.schema_cli import export_schemas
from frances.models.study import DayCount, UserStats


def test_user_stats_shape() -> None:
    s = UserStats(
        cards_learned=3,
        due_now=5,
        reviews_today=2,
        retention_30d=None,
        streak_days=1,
        week=[DayCount(day=f"2026-11-0{d}", reviews=0, quiz_attempts=0) for d in range(2, 9)],
        quiz_best=[],
    )
    assert len(s.week) == 7
    with pytest.raises(ValidationError):
        UserStats.model_validate({**s.model_dump(), "extra": 1})


def test_api_schema_has_p09_models(tmp_path: Path) -> None:
    export_schemas(tmp_path)
    defs = json.loads((tmp_path / "api.schema.json").read_text())["$defs"]
    assert {"DayCount", "QuizBest", "UserStats", "TopicProgress"} <= set(defs)


def test_master_plan_lists_p09_routes() -> None:
    text = Path("docs/superpowers/plans/2026-11-02-00-v2-master-plan.md").read_text()
    for route in ("/api/me/stats", "/api/me/topic-progress", "/api/me/upcoming"):
        assert f"`{route}`" in text
    assert "Idempotente por `(user_id, card_id, reviewed_at)`" in text
