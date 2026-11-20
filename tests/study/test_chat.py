"""Chat con el material: recuperación, citas y eventos SSE (AI-12)."""

import json
import logging
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from frances.cards.llm import (
    LlmBudgetExceeded,
    LlmStreamInterrupted,
    LlmUnavailable,
)
from frances.db.store import Store
from frances.db.usage import bogota_day, usage_daily_get
from frances.models.study import ChatEvent, Citation, SearchHit
from frances.study.chat import (
    FALLBACK_CITATIONS,
    MAX_FRAGMENTS,
    Retrieved,
    answer_events,
    is_no_material,
    parse_citations,
    retrieve,
)
from frances.study.chat_repo import create_thread
from frances.study.prompts import MAX_FRAGMENT_CHARS, NO_MATERIAL_TEXT
from frances.timeutil import format_ts

_NOW = datetime(2026, 11, 3, 1, 0, tzinfo=UTC)
_STAMP = format_ts(_NOW)


class FakeStreamLlm:
    """Implementa `stream_chat`; cada respuesta es una lista de trozos o una excepción."""

    def __init__(
        self,
        model: str = "m",
        stream_replies: list[Any] | None = None,
        on_token: Callable[[], None] | None = None,
    ) -> None:
        self.model = model
        self.calls = 0
        self.last_messages: list[dict[str, str]] | None = None
        self._replies = list(stream_replies or [])
        self._on_token = on_token

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        task: str = "chat",
        prompt_version: str,
        temperature: float = 0.3,
    ) -> Iterator[str]:
        self.calls += 1
        self.last_messages = messages
        assert self._replies, "llamada inesperada al LLM"
        reply = self._replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        for token in reply:
            if self._on_token is not None:
                self._on_token()
            yield token


class InterruptedAfter:
    """Genera trozos y después simula que se cortó el flujo."""

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = chunks

    def __iter__(self) -> Iterator[str]:
        yield from self._chunks
        raise LlmStreamInterrupted("cortado")


class TrackingStore:
    """Envuelve el Store del stream para observar transacciones y cierre."""

    def __init__(self, store: Store) -> None:
        self._store = store
        self.closed = False

    @property
    def conn(self) -> sqlite3.Connection:
        return self._store.conn

    def tx(self) -> Any:
        return self._store.tx()

    def close(self) -> None:
        self.closed = True
        self._store.close()


@dataclass
class StoredMessage:
    id: int
    content: str
    status: str
    model: str | None
    prompt_version: str | None
    citations: list[Citation]


@dataclass
class ChatEnv:
    store: Store
    db_path: Path
    clock: Callable[[], datetime]
    thread: str
    opened: list[TrackingStore] = field(default_factory=list)
    fake: FakeStreamLlm | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        return self.store.conn

    def open_store(self) -> Store:
        tracking = TrackingStore(Store.connect(self.db_path))
        self.opened.append(tracking)
        return tracking  # type: ignore[return-value]


_ITEM_TEXT = "La pomme est un fruit. «La pomme» se mange crue."
_ATTACHMENT_TEXT = "La pomme pousse dans un pommier. Le chat dort dessus."
_SECOND_ITEM_TEXT = "Le chat mange une pomme."
_LONG_TEXT = "longue " + "a" * 760


def _item(conn: sqlite3.Connection, item_id: str, title: str, text: str) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, title, text, _STAMP, _STAMP, f"{item_id}-h", _STAMP, _STAMP),
    )


def _block(
    conn: sqlite3.Connection,
    item_id: str,
    source: str,
    text: str,
    *,
    page: int | None = None,
    position: int = 0,
) -> None:
    conn.execute(
        "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
        " extractor_version, created_at) VALUES (?, ?, ?, ?, 'fr', ?, 'test-1', ?)",
        (item_id, source, page, position, text, _STAMP),
    )


@pytest.fixture
def chat_env(tmp_path: Path, clock: Callable[[], datetime]) -> Iterator[ChatEnv]:
    store = Store.open(tmp_path / "state.db")
    conn = store.conn
    try:
        conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_STAMP,),
        )
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, created_at)"
            " VALUES ('u_1', 'u_1@example.test', 'Prueba', 'hash-sintetico', 'user', ?)",
            (_STAMP,),
        )
        _item(conn, "cw_1", "Leçon 1", _ITEM_TEXT)
        _item(conn, "cw_2", "Leçon 2", _SECOND_ITEM_TEXT)
        _item(conn, "cw_3", "Leçon 3", _LONG_TEXT)
        conn.execute(
            "INSERT INTO attachments (id, item_id, kind, external_id, title, status, updated_at)"
            " VALUES ('at_1', 'cw_1', 'drive_file', 'ext-1', 'Fiche de vocabulaire',"
            " 'downloaded', ?)",
            (_STAMP,),
        )
        _block(conn, "cw_1", "item", _ITEM_TEXT)
        _block(conn, "cw_1", "at_1", _ATTACHMENT_TEXT, page=2)
        _block(conn, "cw_2", "item", _SECOND_ITEM_TEXT)
        _block(conn, "cw_3", "item", _LONG_TEXT)
        thread = create_thread(conn, "u_1", clock())
    except BaseException:
        store.close()
        raise
    env = ChatEnv(store=store, db_path=tmp_path / "state.db", clock=clock, thread=thread.id)
    yield env
    store.close()
    for opened in env.opened:
        if not opened.closed:
            opened.close()


_MISSING = object()


def run(
    env: ChatEnv,
    *,
    stream_replies: list[Any] | None = None,
    question: str,
    llm: Any = _MISSING,
) -> list[ChatEvent]:
    fake = llm if llm is not _MISSING else FakeStreamLlm(stream_replies=stream_replies)
    if isinstance(fake, FakeStreamLlm):
        env.fake = fake
    return list(
        answer_events(
            env.open_store,
            fake,
            user_id="u_1",
            thread_id=env.thread,
            question=question,
            now=env.clock,
        )
    )


def kinds(events: list[ChatEvent]) -> list[str]:
    return [event.kind for event in events]


def last_assistant(env: ChatEnv) -> StoredMessage:
    row = env.conn.execute(
        "SELECT id, content, status, model, prompt_version, citations_json"
        " FROM chat_messages WHERE thread_id = ? AND role = 'assistant'"
        " ORDER BY id DESC LIMIT 1",
        (env.thread,),
    ).fetchone()
    assert row is not None
    return StoredMessage(
        id=int(row[0]),
        content=str(row[1]),
        status=str(row[2]),
        model=None if row[3] is None else str(row[3]),
        prompt_version=None if row[4] is None else str(row[4]),
        citations=[Citation.model_validate(item) for item in json.loads(row[5])],
    )


def thread_title(env: ChatEnv) -> str:
    row = env.conn.execute("SELECT title FROM chat_threads WHERE id = ?", (env.thread,)).fetchone()
    assert row is not None
    return str(row[0])


def _retrieved(env: ChatEnv, question: str) -> Retrieved:
    return retrieve(env.conn, question)


def test_no_fragments_answers_without_llm(chat_env: ChatEnv) -> None:
    llm = FakeStreamLlm(model="m", stream_replies=[])
    events = list(
        answer_events(
            chat_env.open_store,
            llm,
            user_id="u_1",
            thread_id=chat_env.thread,
            question="¿Quién ganó el mundial?",
            now=chat_env.clock,
        )
    )

    assert kinds(events) == ["meta", "token", "done"]
    assert events[1].text == NO_MATERIAL_TEXT and events[2].code == "no_material"
    assert llm.calls == 0
    stored = last_assistant(chat_env)
    assert stored.status == "no_material" and stored.model is None and stored.citations == []


def test_citations_map_to_real_blocks(chat_env: ChatEnv) -> None:
    llm = FakeStreamLlm(
        model="m",
        stream_replies=[["«La pomme» es la manzana ", "[1]. Se usa con «manger» [2]."]],
    )
    events = list(
        answer_events(
            chat_env.open_store,
            llm,
            user_id="u_1",
            thread_id=chat_env.thread,
            question="¿Qué es la pomme?",
            now=chat_env.clock,
        )
    )

    assert kinds(events) == ["meta", "token", "token", "citation", "citation", "done"]
    for event in (event for event in events if event.kind == "citation"):
        assert event.citation is not None
        row = chat_env.conn.execute(
            "SELECT item_id, source, page FROM text_blocks WHERE id = ?",
            (event.citation.block_id,),
        ).fetchone()
        assert row == (event.citation.item_id, event.citation.source, event.citation.page)
    stored = last_assistant(chat_env)
    assert stored.status == "ok" and len(stored.citations) == 2
    assert stored.model == "m" and stored.prompt_version == "chat-1"


def test_answer_without_markers_is_partial_with_fallback_citations(chat_env: ChatEnv) -> None:
    events = run(chat_env, stream_replies=[["Es la manzana."]], question="¿Qué es la pomme?")
    citations = [event.citation for event in events if event.kind == "citation"]

    assert events[-1].kind == "done" and events[-1].code == "partial"
    assert len(citations) == FALLBACK_CITATIONS == 3
    assert [citation.block_id for citation in citations if citation is not None] == [
        hit.block_id for hit in _retrieved(chat_env, "¿Qué es la pomme?").hits[:3]
    ]
    stored = last_assistant(chat_env)
    assert stored.status == "partial"
    assert (stored.model, stored.prompt_version) == ("m", "chat-1")


def test_model_says_not_covered(chat_env: ChatEnv) -> None:
    events = run(chat_env, stream_replies=[[NO_MATERIAL_TEXT]], question="¿Qué es la pomme?")

    assert events[-1].kind == "done" and events[-1].code == "no_material"
    assert not any(event.kind == "citation" for event in events)
    stored = last_assistant(chat_env)
    assert stored.status == "no_material"
    assert (stored.model, stored.prompt_version) == ("m", "chat-1")


def test_errors_map_to_codes(chat_env: ChatEnv) -> None:
    budget = run(
        chat_env,
        stream_replies=[LlmBudgetExceeded("x")],
        question="la pomme",
    )
    assert budget[-1].kind == "error" and budget[-1].code == "rate_limited"
    assert last_assistant(chat_env).status == "error"

    unavailable = run(chat_env, stream_replies=[LlmUnavailable("x")], question="la pomme")
    assert unavailable[-1].kind == "error" and unavailable[-1].code == "llm_unavailable"
    assert last_assistant(chat_env).status == "error"

    interrupted = run(
        chat_env,
        stream_replies=[InterruptedAfter(["La pomme [1]"])],
        question="la pomme",
    )
    assert kinds(interrupted)[-2:] == ["citation", "error"]
    assert interrupted[-1].code == "llm_unavailable"
    assert last_assistant(chat_env).status == "partial"
    assert last_assistant(chat_env).citations

    no_llm = run(chat_env, llm=None, question="la pomme")
    assert no_llm[-1].kind == "error" and no_llm[-1].code == "llm_unavailable"


def test_history_and_title(chat_env: ChatEnv) -> None:
    llm = FakeStreamLlm(stream_replies=[["a [1]"], ["b [1]"]])
    run(chat_env, llm=llm, question="¿Qué es la pomme?")
    run(chat_env, llm=llm, question="¿Y le chat?")

    assert thread_title(chat_env) == "¿Qué es la pomme?"
    assert llm.last_messages is not None
    assert llm.last_messages[1:3] == [
        {"role": "user", "content": "¿Qué es la pomme?"},
        {"role": "assistant", "content": "a [1]"},
    ]


def test_no_transaction_open_while_streaming(chat_env: ChatEnv) -> None:
    seen: list[bool] = []
    llm = FakeStreamLlm(
        stream_replies=[["La pomme [1]."]],
        on_token=lambda: seen.append(chat_env.opened[-1].conn.in_transaction),
    )
    list(
        answer_events(
            chat_env.open_store,
            llm,
            user_id="u_1",
            thread_id=chat_env.thread,
            question="¿Qué es la pomme?",
            now=chat_env.clock,
        )
    )

    assert seen == [False]
    assert chat_env.opened and chat_env.opened[-1].closed


def test_chat_questions_meter(chat_env: ChatEnv) -> None:
    run(chat_env, stream_replies=[["a [1]"]], question="¿Qué es la pomme?")
    run(chat_env, stream_replies=[], question="¿Quién ganó el mundial?")

    assert usage_daily_get(chat_env.conn, bogota_day(chat_env.clock()), "chat_questions") == 2


def test_retrieve_labels_publication_page_and_attachment(chat_env: ChatEnv) -> None:
    attachment = retrieve(chat_env.conn, "pommier")
    assert attachment.hits and attachment.fragments
    assert attachment.fragments[0].label == "Leçon 1, p. 2 · Fiche de vocabulaire"
    assert attachment.fragments[0].text == _ATTACHMENT_TEXT

    long_hit = retrieve(chat_env.conn, "longue")
    assert long_hit.fragments[0].label == "Leçon 3"
    assert len(long_hit.fragments[0].text) == MAX_FRAGMENT_CHARS


def test_retrieve_returns_at_most_max_fragments(chat_env: ChatEnv) -> None:
    retrieved = retrieve(chat_env.conn, "pomme chat")
    assert len(retrieved.hits) <= MAX_FRAGMENTS
    assert [fragment.n for fragment in retrieved.fragments] == list(
        range(1, len(retrieved.hits) + 1)
    )


def test_parse_citations_accepts_groups_dedupes_and_ignores_out_of_range(
    chat_env: ChatEnv,
) -> None:
    retrieved = _retrieved(chat_env, "pomme")
    citations = parse_citations("A [1, 2] B [2] C [9] D [0] E [3].", retrieved)

    assert [citation.block_id for citation in citations] == [
        hit.block_id for hit in retrieved.hits[:3]
    ]
    assert parse_citations("Sin marcas.", retrieved) == []
    assert parse_citations("Solo [99].", retrieved) == []


def test_is_no_material_accepts_trailing_text() -> None:
    assert is_no_material(NO_MATERIAL_TEXT)
    assert is_no_material("  " + NO_MATERIAL_TEXT.lower() + " Lo siento.")
    assert not is_no_material("El material del curso sí cubre esto.")


def test_search_hits_have_the_expected_shape(chat_env: ChatEnv) -> None:
    hit = _retrieved(chat_env, "pomme").hits[0]
    assert isinstance(hit, SearchHit)
    assert hit.snippet and hit.score >= 0


def test_course_text_is_not_logged(chat_env: ChatEnv, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    run(chat_env, stream_replies=[["La pomme es una fruta [1]."]], question="¿Qué es la pomme?")
    assert "La pomme es una fruta" not in caplog.text
    assert "¿Qué es la pomme?" not in caplog.text


def test_assistant_error_message_is_persisted(chat_env: ChatEnv) -> None:
    events = run(chat_env, stream_replies=[LlmUnavailable("x")], question="la pomme")
    assert events[-1].code == "llm_unavailable"
    stored = last_assistant(chat_env)
    assert stored.status == "error" and stored.content == ""


def test_citations_include_item_title(chat_env: ChatEnv) -> None:
    retrieved = _retrieved(chat_env, "pommier")
    citations = parse_citations("Mira [1].", retrieved)
    assert len(citations) == 1
    assert citations[0].item_title == "Leçon 1"
