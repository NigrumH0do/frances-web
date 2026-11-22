"""Chat con el material: recuperación FTS5, prompt, citas y persistencia (AI-12).

Cada respuesta cita al menos un bloque real cuando hay material. Si la búsqueda
no devuelve fragmentos se responde con un texto fijo sin llamar al LLM; si el
modelo responde sin marcas válidas, se guardan como citas los mejores fragmentos
recuperados. ``answer_events`` abre y cierra su propio ``Store`` y no mantiene
ninguna transacción abierta mientras espera al LLM.
"""

import re
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import datetime

from frances.cards.llm import (
    LlmBudgetExceeded,
    LlmGenerator,
    LlmStreamInterrupted,
    LlmUnavailable,
)
from frances.db.store import Store
from frances.db.usage import bogota_day, usage_daily_add
from frances.models.study import ChatEvent, Citation, SearchHit
from frances.study import chat_repo
from frances.study.prompts import (
    MAX_FRAGMENT_CHARS,
    NO_MATERIAL_TEXT,
    PROMPT_VERSIONS,
    render_chat_messages,
)
from frances.study.schemas import PromptFragment
from frances.study.search import search_blocks
from frances.textnorm import norm_key
from frances.timeutil import format_ts

MAX_FRAGMENTS = 6
HISTORY_TURNS = 3
FALLBACK_CITATIONS = 3

_CITATION_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_NO_MATERIAL_KEY = norm_key(NO_MATERIAL_TEXT)


@dataclass(frozen=True)
class Retrieved:
    """Hits de FTS5 y los fragmentos numerados que se mandan al LLM."""

    hits: list[SearchHit]
    fragments: list[PromptFragment]
    titles: dict[int, str] = field(default_factory=dict)


def _fragment_with_title(
    conn: sqlite3.Connection, hit: SearchHit, n: int
) -> tuple[PromptFragment, str]:
    """Fragmento con etiqueta y el título legible de su publicación."""
    row = conn.execute(
        "SELECT i.title, b.text, a.title FROM text_blocks b"
        " JOIN items i ON i.id = b.item_id"
        " LEFT JOIN attachments a ON a.id = b.source"
        " WHERE b.id = ?",
        (hit.block_id,),
    ).fetchone()
    item_title = str(row[0]) if row is not None and row[0] else hit.item_id
    text = str(row[1]) if row is not None else hit.snippet
    label = item_title
    if hit.page is not None:
        label += f", p. {hit.page}"
    if row is not None and hit.source != "item" and row[2]:
        label += f" · {row[2]}"
    return PromptFragment(n=n, label=label, text=text[:MAX_FRAGMENT_CHARS]), item_title


def _fragment(conn: sqlite3.Connection, hit: SearchHit, n: int) -> PromptFragment:
    """Fragmento con etiqueta de publicación, página y adjunto si aplica."""
    return _fragment_with_title(conn, hit, n)[0]


def retrieve(conn: sqlite3.Connection, question: str) -> Retrieved:
    """Fragmentos mejor rankeados para la pregunta (BM25 de AI-05)."""
    hits = search_blocks(conn, question, limit=MAX_FRAGMENTS)
    fragments: list[PromptFragment] = []
    titles: dict[int, str] = {}
    for n, hit in enumerate(hits, start=1):
        frag, title = _fragment_with_title(conn, hit, n)
        fragments.append(frag)
        titles[hit.block_id] = title
    return Retrieved(hits=hits, fragments=fragments, titles=titles)


def _citation(hit: SearchHit, item_title: str | None = None) -> Citation:
    return Citation(
        item_id=hit.item_id,
        item_title=item_title,
        source=hit.source,
        page=hit.page,
        block_id=hit.block_id,
        snippet=hit.snippet,
    )


def parse_citations(text: str, retrieved: Retrieved) -> list[Citation]:
    """Citas ``[n]`` y ``[n, m]`` válidas, en orden de primera aparición."""
    citations: list[Citation] = []
    seen: set[int] = set()
    for match in _CITATION_RE.finditer(text):
        for raw in match.group(1).split(","):
            n = int(raw)
            if not 1 <= n <= len(retrieved.hits) or n in seen:
                continue
            seen.add(n)
            hit = retrieved.hits[n - 1]
            citations.append(_citation(hit, retrieved.titles.get(hit.block_id)))
    return citations


def normalize_citations(text: str, retrieved: Retrieved) -> tuple[str, list[Citation]]:
    """Renumera las marcas ``[n]`` a 1…len(citations) en orden de aparición.

    El modelo a veces cita solo ``[4]`` cuando recuperó seis fragmentos; la
    lista compacta de citas tiene entonces un elemento y la marca no apunta a
    ``citations[0]``. Se reescribe el texto para que cada marca válida quede
    alineada 1 a 1 con ``citations``; un corchete solo con números fuera de
    rango se deja intacto y uno mixto conserva los válidos renumerados.
    """
    total = len(retrieved.hits)
    mapping: dict[int, int] = {}
    citations: list[Citation] = []

    def renumbered(n: int) -> int:
        if n not in mapping:
            hit = retrieved.hits[n - 1]
            citations.append(_citation(hit, retrieved.titles.get(hit.block_id)))
            mapping[n] = len(citations)
        return mapping[n]

    pieces: list[str] = []
    last = 0
    for match in _CITATION_RE.finditer(text):
        numbers: list[int] = []
        for raw in match.group(1).split(","):
            n = int(raw)
            if not 1 <= n <= total:
                continue
            m = renumbered(n)
            if m not in numbers:
                numbers.append(m)
        if not numbers:
            continue
        pieces.append(text[last : match.start()])
        pieces.append("[" + ", ".join(str(m) for m in numbers) + "]")
        last = match.end()
    pieces.append(text[last:])
    return "".join(pieces), citations


def is_no_material(text: str) -> bool:
    """El modelo respondió el texto fijo de «el material no lo cubre»."""
    return norm_key(text).startswith(_NO_MATERIAL_KEY)


def _save_assistant(
    store: Store,
    thread_id: str,
    *,
    content: str,
    citations: list[Citation],
    status: chat_repo.MessageStatus,
    model: str | None,
    prompt_version: str | None,
    stamp: str,
) -> int:
    with store.tx() as tx:
        return chat_repo.add_message(
            tx,
            thread_id,
            role="assistant",
            content=content,
            citations=citations,
            status=status,
            model=model,
            prompt_version=prompt_version,
            now=stamp,
        )


def _partial_events(
    store: Store,
    thread_id: str,
    text: str,
    retrieved: Retrieved,
    *,
    model: str,
    prompt_version: str,
    stamp: str,
) -> list[ChatEvent]:
    """Guarda lo recibido como ``partial`` y emite sus citas válidas y el error."""
    content, citations = normalize_citations(text, retrieved)
    _save_assistant(
        store,
        thread_id,
        content=content,
        citations=citations,
        status="partial",
        model=model,
        prompt_version=prompt_version,
        stamp=stamp,
    )
    events = [ChatEvent(kind="citation", citation=citation) for citation in citations]
    events.append(ChatEvent(kind="error", code="llm_unavailable"))
    return events


def answer_events(
    open_store: Callable[[], Store],
    llm: LlmGenerator | None,
    *,
    user_id: str,
    thread_id: str,
    question: str,
    now: Callable[[], datetime],
) -> Iterator[ChatEvent]:
    """Genera los eventos SSE de una pregunta y guarda ambos mensajes.

    Abre su propia conexión: la de la petición puede cerrarse antes de que el
    flujo termine. Fuera de las transacciones cortas de escritura no queda
    ninguna abierta mientras el LLM responde.
    """
    store = open_store()
    try:
        conn = store.conn
        moment = now()
        stamp = format_ts(moment)
        with store.tx() as tx:
            history = chat_repo.recent_history(tx, thread_id, HISTORY_TURNS)
            user_message_id = chat_repo.add_message(
                tx,
                thread_id,
                role="user",
                content=question,
                citations=[],
                status="ok",
                model=None,
                prompt_version=None,
                now=stamp,
            )
            chat_repo.title_if_default(tx, thread_id, question)
            usage_daily_add(tx, bogota_day(moment), "chat_questions", 1)
        yield ChatEvent(kind="meta", message_id=user_message_id)

        retrieved = retrieve(conn, question)
        if not retrieved.hits:
            assistant_id = _save_assistant(
                store,
                thread_id,
                content=NO_MATERIAL_TEXT,
                citations=[],
                status="no_material",
                model=None,
                prompt_version=None,
                stamp=stamp,
            )
            yield ChatEvent(kind="token", text=NO_MATERIAL_TEXT)
            yield ChatEvent(kind="done", message_id=assistant_id, code="no_material")
            return

        if llm is None:
            _save_assistant(
                store,
                thread_id,
                content="",
                citations=[],
                status="error",
                model=None,
                prompt_version=None,
                stamp=stamp,
            )
            yield ChatEvent(kind="error", code="llm_unavailable")
            return

        prompt_version = PROMPT_VERSIONS["chat"]
        messages = render_chat_messages(question, retrieved.fragments, history)
        parts: list[str] = []
        try:
            for piece in llm.stream_chat(messages, task="chat", prompt_version=prompt_version):
                parts.append(piece)
                yield ChatEvent(kind="token", text=piece)
        except LlmBudgetExceeded:
            _save_assistant(
                store,
                thread_id,
                content="",
                citations=[],
                status="error",
                model=llm.model,
                prompt_version=prompt_version,
                stamp=stamp,
            )
            yield ChatEvent(kind="error", code="rate_limited")
            return
        except LlmStreamInterrupted:
            yield from _partial_events(
                store,
                thread_id,
                "".join(parts),
                retrieved,
                model=llm.model,
                prompt_version=prompt_version,
                stamp=stamp,
            )
            return
        except LlmUnavailable:
            if parts:
                yield from _partial_events(
                    store,
                    thread_id,
                    "".join(parts),
                    retrieved,
                    model=llm.model,
                    prompt_version=prompt_version,
                    stamp=stamp,
                )
            else:
                _save_assistant(
                    store,
                    thread_id,
                    content="",
                    citations=[],
                    status="error",
                    model=llm.model,
                    prompt_version=prompt_version,
                    stamp=stamp,
                )
                yield ChatEvent(kind="error", code="llm_unavailable")
            return

        text = "".join(parts)
        if is_no_material(text):
            assistant_id = _save_assistant(
                store,
                thread_id,
                content=text,
                citations=[],
                status="no_material",
                model=llm.model,
                prompt_version=prompt_version,
                stamp=stamp,
            )
            yield ChatEvent(kind="done", message_id=assistant_id, code="no_material")
            return

        content, citations = normalize_citations(text, retrieved)
        if citations:
            assistant_id = _save_assistant(
                store,
                thread_id,
                content=content,
                citations=citations,
                status="ok",
                model=llm.model,
                prompt_version=prompt_version,
                stamp=stamp,
            )
            for citation in citations:
                yield ChatEvent(kind="citation", citation=citation)
            yield ChatEvent(kind="done", message_id=assistant_id)
            return

        fallback = [
            _citation(hit, retrieved.titles.get(hit.block_id))
            for hit in retrieved.hits[:FALLBACK_CITATIONS]
        ]
        assistant_id = _save_assistant(
            store,
            thread_id,
            content=text,
            citations=fallback,
            status="partial",
            model=llm.model,
            prompt_version=prompt_version,
            stamp=stamp,
        )
        for citation in fallback:
            yield ChatEvent(kind="citation", citation=citation)
        yield ChatEvent(kind="done", message_id=assistant_id, code="partial")
    finally:
        store.close()
