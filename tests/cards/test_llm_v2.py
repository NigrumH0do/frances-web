"""Cliente LLM v2: timeout configurable, medidor diario y complete_json [CHG-08, R-43]."""

import json
import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx
from pydantic import BaseModel, ConfigDict

from frances.cards.llm import (
    CARDS_PROMPT_VERSION,
    SYSTEM_PROMPT,
    USER_AGENT,
    CallMeter,
    DailyCallMeter,
    LlmBudgetExceeded,
    LlmGenerator,
    LlmUnavailable,
    llm_from_env,
    strict_schema,
    strict_schema_for,
)
from frances.db.store import Store
from frances.db.usage import bogota_day, current_month, usage_daily_get, usage_get
from frances.models import GenerationOutput

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
URL = "https://llm.example.test/v1/chat/completions"
SECRET_KEY = "sk-test-secreto-no-real"
COURSE_TEXT = "CONTENIDO-DEL-CURSO-SENTINELA"


class Tiny(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    words: list[str]
    note: str | None = None


def ok_body(payload: dict) -> dict:
    return {"choices": [{"message": {"content": json.dumps(payload)}}]}


@pytest.fixture
def clock() -> Callable[[], datetime]:
    fixed = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)
    return lambda: fixed


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = Store.open(tmp_path / "state.db")
    try:
        yield opened
    finally:
        opened.close()


@pytest.mark.usefixtures("respx_mock")
def test_complete_json_validates_and_uses_timeout(
    respx_mock: respx.Router, store: Store, clock: Callable[[], datetime]
) -> None:
    respx_mock.post(URL).mock(
        return_value=httpx.Response(200, json=ok_body({"words": ["la pomme"], "note": None}))
    )
    gen = LlmGenerator(
        "https://llm.example.test/v1",
        "k",
        "m",
        timeout_s=120,
        meter=DailyCallMeter(store, clock, 300),
    )
    assert gen.complete_json("sheet", "sys", "user", Tiny, "sheet-1") == {
        "words": ["la pomme"],
        "note": None,
    }
    sent = respx_mock.calls[0].request
    assert json.loads(sent.content)["response_format"]["json_schema"]["schema"] == (
        strict_schema_for(Tiny)
    )
    assert sent.extensions["timeout"]["read"] == 120
    assert sent.headers["user-agent"] == USER_AGENT


@pytest.mark.usefixtures("respx_mock")
def test_cap_blocks_before_http_and_retry_counts(
    respx_mock: respx.Router, store: Store, clock: Callable[[], datetime]
) -> None:  # REVIEW FOCUS P10-1
    bad = {"choices": [{"message": {"content": "{}"}}]}
    good = ok_body({"words": [], "note": None})
    route = respx_mock.post(URL).mock(
        side_effect=[httpx.Response(200, json=bad), httpx.Response(200, json=good)]
    )
    gen = LlmGenerator(
        "https://llm.example.test/v1", "k", "m", meter=DailyCallMeter(store, clock, 2)
    )
    gen.complete_json("sheet", "s", "u", Tiny, "sheet-1")  # 1 + reintento = 2 llamadas
    assert usage_daily_get(store.conn, bogota_day(clock()), "llm_calls") == 2
    with pytest.raises(LlmBudgetExceeded):
        gen.complete_json("sheet", "s", "u", Tiny, "sheet-1")
    assert route.call_count == 2
    assert usage_get(store.conn, current_month(clock()), "llm_calls") == 2


def test_budget_exceeded_is_llm_unavailable() -> None:
    assert issubclass(LlmBudgetExceeded, LlmUnavailable)


def test_meter_commits_before_returning(store: Store, clock: Callable[[], datetime]) -> None:
    DailyCallMeter(store, clock, 5).reserve()
    assert not store.conn.in_transaction


def test_meter_remaining_is_read_only(store: Store, clock: Callable[[], datetime]) -> None:
    meter = DailyCallMeter(store, clock, 3)
    assert meter.remaining() == 3
    meter.reserve()
    assert meter.remaining() == 2
    assert usage_daily_get(store.conn, bogota_day(clock()), "llm_calls") == 1


def test_meter_implements_protocol(store: Store, clock: Callable[[], datetime]) -> None:
    meter: CallMeter = DailyCallMeter(store, clock, 1)
    meter.reserve()
    with pytest.raises(LlmBudgetExceeded):
        meter.reserve()


def test_strict_schema_unchanged_for_cards() -> None:
    assert strict_schema() == strict_schema_for(GenerationOutput)
    expected = (FIXTURES / "cards_strict_schema_v1.json").read_text(encoding="utf-8").strip()
    assert json.dumps(strict_schema(), sort_keys=True) == expected


@pytest.mark.usefixtures("respx_mock")
def test_default_schema_name_matches_v1(respx_mock: respx.Router) -> None:
    respx_mock.post(URL).respond(200, json=ok_body({"words": [], "note": None}))
    LlmGenerator("https://llm.example.test/v1", "k", "m").complete_json(
        "sheet", "s", "u", Tiny, "sheet-1"
    )
    rf = json.loads(respx_mock.calls[0].request.content)["response_format"]
    assert rf["json_schema"]["name"] == "generation_output"


@pytest.mark.usefixtures("respx_mock")
def test_schema_name_keyword_overrides(respx_mock: respx.Router) -> None:
    respx_mock.post(URL).respond(200, json=ok_body({"words": [], "note": None}))
    LlmGenerator("https://llm.example.test/v1", "k", "m").complete_json(
        "sheet", "s", "u", Tiny, "sheet-1", schema_name="custom_name"
    )
    rf = json.loads(respx_mock.calls[0].request.content)["response_format"]
    assert rf["json_schema"]["name"] == "custom_name"


def test_cards_prompt_version_constant() -> None:
    assert CARDS_PROMPT_VERSION == "cards-3"
    assert LlmGenerator.version == "cards-3"


def test_system_prompt_requests_notes_and_rich_phrases() -> None:
    lower = SYSTEM_PROMPT.lower()
    assert "notes" in lower
    assert "phrase" in lower
    assert "concordancia" in lower or "pronunciación" in lower


def test_llm_from_env_accepts_v2_keywords(store: Store, clock: Callable[[], datetime]) -> None:
    env = {"LLM_BASE_URL": "https://llm.example.test/v1", "LLM_API_KEY": "k", "LLM_MODEL": "m"}
    meter = DailyCallMeter(store, clock, 10)
    gen = llm_from_env(env, timeout_s=45.0, meter=meter)
    assert gen is not None and gen.model == "m"
    assert llm_from_env({}, timeout_s=45.0, meter=meter) is None


@pytest.mark.usefixtures("respx_mock")
def test_logs_never_contain_key_or_course_text(
    respx_mock: respx.Router, caplog: pytest.LogCaptureFixture
) -> None:
    respx_mock.post(URL).respond(500, text=COURSE_TEXT)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(LlmUnavailable):
        LlmGenerator("https://llm.example.test/v1", SECRET_KEY, "m").complete_json(
            "sheet", "s", COURSE_TEXT, Tiny, "sheet-1"
        )
    logs = caplog.text
    assert SECRET_KEY not in logs
    assert COURSE_TEXT not in logs
    assert "sheet" in logs and "sheet-1" in logs
