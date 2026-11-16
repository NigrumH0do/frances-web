"""API del chat (AI-15): hilos por usuario y respuesta en SSE por POST.

SSE por ``POST`` para que el navegador pueda mandar la pregunta y el header
``X-CSRF-Token`` con ``fetch`` (``EventSource`` no lo permite). Una sola
pregunta en curso por usuario; el cupo se libera siempre, también si el cliente
corta la conexión. ``answer_events`` abre su propia conexión y el LLM se cierra
en cuanto el flujo deja de consumirse.
"""

from __future__ import annotations

import json
import queue
import sqlite3
import threading
from collections.abc import AsyncIterator, Generator, Iterator
from dataclasses import dataclass, field
from typing import Annotated, cast

import anyio
from fastapi import APIRouter, Depends, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent, format_sse_event

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import CurrentUser, require_user
from frances.cards.llm import LlmGenerator
from frances.db.store import Store
from frances.models.study import ChatAskIn, ChatEvent, ChatThreadDetail, ChatThreadOut
from frances.study import chat_repo
from frances.study.chat import answer_events
from frances.study.client import study_llm_for

router = APIRouter(prefix="/api/chat", dependencies=[Depends(require_user)])

#: Segundos sin eventos antes de mandar un comentario ``: ping``.
PING_S = 15.0

_NOT_FOUND = "No existe."
_IN_FLIGHT = "Ya hay una pregunta en curso; espera a que termine."

#: Usuarios con una pregunta en vuelo (un solo proceso ``api``, R-37).
_inflight: dict[str, _QuestionSlot] = {}
_inflight_lock = threading.Lock()

_END = object()


class _ClientGone(Exception):
    """El cliente cortó la conexión: no se persiste una respuesta inexistente."""


@dataclass
class _QuestionSlot:
    """Cupo reservado para una pregunta; ``stop`` avisa al hilo de trabajo."""

    user_id: str
    stop: threading.Event = field(default_factory=threading.Event)


def _reserve(user_id: str) -> _QuestionSlot | None:
    with _inflight_lock:
        if user_id in _inflight:
            return None
        slot = _QuestionSlot(user_id=user_id)
        _inflight[user_id] = slot
        return slot


def _release(slot: _QuestionSlot) -> None:
    """Suelta el cupo solo si sigue siendo la reserva vigente de ese usuario."""
    with _inflight_lock:
        if _inflight.get(slot.user_id) is slot:
            del _inflight[slot.user_id]


def _not_found() -> ApiErrorResponse:
    return ApiErrorResponse(404, "not_found", _NOT_FOUND)


def _question_slot(
    thread_id: str,
    user: Annotated[CurrentUser, Depends(require_user)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Iterator[_QuestionSlot]:
    """Comprueba el hilo (404) y reserva el cupo (429) antes de abrir el flujo."""
    if chat_repo.get_thread(conn, user.id, thread_id) is None:
        raise _not_found()
    slot = _reserve(user.id)
    if slot is None:
        raise ApiErrorResponse(429, "rate_limited", _IN_FLIGHT)
    try:
        yield slot
    finally:
        slot.stop.set()
        _release(slot)


class _CancelableLlm:
    """Envuelve el LLM para dejar de consumirlo en cuanto se pide parar."""

    def __init__(self, llm: LlmGenerator, stop: threading.Event) -> None:
        self._llm = llm
        self._stop = stop

    @property
    def model(self) -> str:
        return self._llm.model

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        task: str = "chat",
        prompt_version: str,
        temperature: float = 0.3,
    ) -> Generator[str, None, None]:
        if self._stop.is_set():
            raise _ClientGone
        inner = cast(
            Generator[str, None, None],
            self._llm.stream_chat(
                messages,
                task=task,
                prompt_version=prompt_version,
                temperature=temperature,
            ),
        )
        try:
            while not self._stop.is_set():
                try:
                    piece = next(inner)
                except StopIteration:
                    if self._stop.is_set():
                        raise _ClientGone from None
                    return
                if self._stop.is_set():
                    raise _ClientGone
                yield piece
        finally:
            inner.close()


def _pump(
    slot: _QuestionSlot,
    thread_id: str,
    question: str,
    ctx: ApiContext,
    out: queue.Queue[object],
) -> None:
    """Hilo de trabajo: consume ``answer_events`` y deja cada evento en la cola."""
    meter_store: Store | None = None
    try:
        meter_store = Store.connect(ctx.db_path)
        llm = study_llm_for(ctx.settings, ctx.env, meter_store, ctx.now)
        wrapped = None if llm is None else cast(LlmGenerator, _CancelableLlm(llm, slot.stop))
        events = cast(
            Generator[ChatEvent, None, None],
            answer_events(
                open_store=lambda: Store.connect(ctx.db_path),
                llm=wrapped,
                user_id=slot.user_id,
                thread_id=thread_id,
                question=question,
                now=ctx.now,
            ),
        )
        try:
            while not slot.stop.is_set():
                try:
                    event = next(events)
                except StopIteration:
                    break
                if slot.stop.is_set():
                    break
                out.put(event)
        finally:
            events.close()
    except _ClientGone:
        pass
    except BaseException as exc:  # el generador lo relanza y cierra el flujo
        out.put(exc)
    finally:
        if meter_store is not None:
            meter_store.close()
        out.put(_END)


def _encode(event: ChatEvent) -> bytes:
    """Codifica un evento con el mismo formato que usa FastAPI para SSE."""
    payload = ServerSentEvent(
        event=event.kind,
        data=event.model_dump(mode="json", exclude_none=True),
    )
    data_str = (
        None
        if payload.data is None
        else json.dumps(payload.data, ensure_ascii=False, separators=(",", ":"))
    )
    return format_sse_event(event=payload.event, data_str=data_str)


def _ping() -> bytes:
    return format_sse_event(comment="ping")


async def _event_stream(
    slot: _QuestionSlot,
    thread_id: str,
    question: str,
    ctx: ApiContext,
) -> AsyncIterator[bytes]:
    out: queue.Queue[object] = queue.Queue()
    worker = threading.Thread(
        target=_pump,
        args=(slot, thread_id, question, ctx, out),
        name="frances-chat-sse",
        daemon=True,
    )
    worker.start()
    try:
        while True:
            try:
                item = await anyio.to_thread.run_sync(out.get, True, PING_S, abandon_on_cancel=True)
            except queue.Empty:
                yield _ping()
                continue
            if item is _END:
                return
            if isinstance(item, BaseException):
                raise item
            yield _encode(cast(ChatEvent, item))
    finally:
        slot.stop.set()
        _release(slot)
        worker.join(timeout=0.2)


def _stream_response(
    slot: _QuestionSlot,
    thread_id: str,
    question: str,
    ctx: ApiContext,
) -> EventSourceResponse:
    return EventSourceResponse(
        _event_stream(slot, thread_id, question, ctx),
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/threads", response_model=list[ChatThreadOut])
def list_threads(
    user: Annotated[CurrentUser, Depends(require_user)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[ChatThreadOut]:
    """Hilos vivos del usuario, el más reciente primero."""
    return chat_repo.list_threads(conn, user.id)


@router.post("/threads", response_model=ChatThreadOut, status_code=201)
def create_thread(
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> ChatThreadOut:
    """Crea un hilo vacío con el título por defecto."""
    return chat_repo.create_thread(conn, user.id, ctx.now())


@router.get("/threads/{thread_id}", response_model=ChatThreadDetail)
def thread_detail(
    thread_id: str,
    user: Annotated[CurrentUser, Depends(require_user)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> ChatThreadDetail:
    """Hilo y mensajes; ajeno, borrado o inexistente → 404."""
    detail = chat_repo.get_thread_detail(conn, user.id, thread_id)
    if detail is None:
        raise _not_found()
    return detail


@router.delete("/threads/{thread_id}", status_code=204)
def delete_thread(
    thread_id: str,
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Response:
    """Marca ``deleted_at``; ajeno, borrado o inexistente → 404."""
    if not chat_repo.soft_delete_thread(conn, user.id, thread_id, ctx.now()):
        raise _not_found()
    return Response(status_code=204)


@router.post("/threads/{thread_id}/messages")
async def ask(
    thread_id: str,
    body: ChatAskIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    slot: Annotated[_QuestionSlot, Depends(_question_slot)],
) -> Response:
    """Pregunta al material y responde en SSE; máximo una pregunta en curso por usuario."""
    return _stream_response(slot, thread_id, body.question, ctx)
