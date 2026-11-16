"""Streaming del chat en el cliente LLM: stream_chat [CHG-09, R-43]."""

import json
import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx

from frances.cards.llm import (
    DailyCallMeter,
    LlmGenerator,
    LlmStreamInterrupted,
    LlmUnavailable,
)
from frances.db.store import Store
from frances.db.usage import bogota_day, usage_daily_get

URL = "https://llm.example.test/v1/chat/completions"
SECRET_KEY = "sk-test-secreto-no-real"
MESSAGES = [{"role": "user", "content": "¿Qué significa bonjour?"}]


class BrokenAfter(httpx.SyncByteStream):
    """Entrega `chunks` y luego simula una caída de red."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        yield from self._chunks
        raise httpx.ReadError("cortado")

    def close(self) -> None:
        self.closed = True


def sse_events(*chunks: str) -> bytes:
    """Eventos SSE con `content` por fragmento, sin el marcador final."""
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks]
    return "".join(lines).encode()


def sse(*chunks: str) -> bytes:
    return sse_events(*chunks) + b"data: [DONE]\n\n"


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


@pytest.fixture
def gen() -> LlmGenerator:
    return LlmGenerator("https://llm.example.test/v1", SECRET_KEY, "m")


@pytest.mark.usefixtures("respx_mock")
def test_stream_yields_content_and_skips_reasoning(
    respx_mock: respx.Router, gen: LlmGenerator
) -> None:
    body = b'data: {"choices":[{"delta":{"reasoning_content":"pienso"}}]}\n\n' + sse("Hola", " [1]")
    respx_mock.post(URL).mock(
        return_value=httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"}
        )
    )
    assert list(gen.stream_chat(MESSAGES, prompt_version="chat-1")) == ["Hola", " [1]"]
    sent = json.loads(respx_mock.calls[0].request.content)
    assert sent["stream"] is True
    assert "response_format" not in sent


@pytest.mark.usefixtures("respx_mock")
def test_non_streaming_provider_is_tolerated(respx_mock: respx.Router, gen: LlmGenerator) -> None:
    respx_mock.post(URL).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "todo [1]"}}]})
    )
    assert list(gen.stream_chat(MESSAGES, prompt_version="chat-1")) == ["todo [1]"]


@pytest.mark.usefixtures("respx_mock")
def test_http_error_before_first_token_is_unavailable(
    respx_mock: respx.Router, gen: LlmGenerator
) -> None:
    respx_mock.post(URL).mock(return_value=httpx.Response(520, text="origin"))
    with pytest.raises(LlmUnavailable) as raised:
        list(gen.stream_chat(MESSAGES, prompt_version="chat-1"))
    assert not isinstance(raised.value, LlmStreamInterrupted)


@pytest.mark.usefixtures("respx_mock")
def test_network_drop_after_first_token_is_interrupted(
    respx_mock: respx.Router, gen: LlmGenerator
) -> None:
    respx_mock.post(URL).mock(
        return_value=httpx.Response(
            200,
            stream=BrokenAfter([sse_events("Ho")]),
            headers={"content-type": "text/event-stream"},
        )
    )
    received: list[str] = []
    with pytest.raises(LlmStreamInterrupted):
        for token in gen.stream_chat(MESSAGES, prompt_version="chat-1"):
            received.append(token)
    assert received == ["Ho"]


@pytest.mark.usefixtures("respx_mock")
def test_stream_reserves_one_call(
    respx_mock: respx.Router,
    store: Store,
    clock: Callable[[], datetime],
) -> None:
    respx_mock.post(URL).mock(
        return_value=httpx.Response(
            200, content=sse("a", "b"), headers={"content-type": "text/event-stream"}
        )
    )
    metered = LlmGenerator(
        "https://llm.example.test/v1",
        SECRET_KEY,
        "m",
        meter=DailyCallMeter(store, clock, 10),
    )
    assert list(metered.stream_chat(MESSAGES, prompt_version="chat-1")) == ["a", "b"]
    assert usage_daily_get(store.conn, bogota_day(clock()), "llm_calls") == 1


@pytest.mark.usefixtures("respx_mock")
def test_closing_generator_closes_the_connection(
    respx_mock: respx.Router, gen: LlmGenerator
) -> None:
    stream = BrokenAfter([sse_events("a", "b")])
    respx_mock.post(URL).mock(
        return_value=httpx.Response(
            200, stream=stream, headers={"content-type": "text/event-stream"}
        )
    )
    tokens = gen.stream_chat(MESSAGES, prompt_version="chat-1")
    assert next(tokens) == "a"
    tokens.close()
    assert stream.closed


@pytest.mark.usefixtures("respx_mock")
def test_stream_errors_never_log_text_or_key(
    respx_mock: respx.Router, gen: LlmGenerator, caplog: pytest.LogCaptureFixture
) -> None:
    respx_mock.post(URL).mock(return_value=httpx.Response(500, text="secreto del curso"))
    caplog.set_level(logging.DEBUG)
    with pytest.raises(LlmUnavailable):
        list(gen.stream_chat(MESSAGES, prompt_version="chat-1"))
    logged = caplog.text
    assert SECRET_KEY not in logged
    assert "secreto del curso" not in logged
    assert "¿Qué significa bonjour?" not in logged
