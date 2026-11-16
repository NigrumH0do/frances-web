"""Handlers de los trabajos de gestión (P11, MGT-04).

Dos ``kind`` corren en el worker, nunca dentro de una petición:

- ``cards.regenerate_item``: regenera las tarjetas de una publicación viva con
  :func:`frances.manage.cards.regenerate_item` (que respeta ``edited_by_human``
  y ``removed_at``), planifica el audio de sus tarjetas y encola un solo
  ``audio.regenerate`` con las claves pendientes.
- ``audio.regenerate``: sintetiza solo los clips pedidos. Acepta ``scope=all``,
  una lista explícita de ``cache_keys`` o una ``card_id``; nunca toca clips que
  no estén en el alcance del payload.

Los handlers no abren transacciones durante la red: la síntesis corre en
``run_audio_keys``/``run_audio`` fuera de toda transacción. Lo que se guarda en
``jobs.result`` o ``jobs.last_error`` son ids, conteos y nombres de estado:
nunca texto del curso.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from frances.audio.repo import reset_for_regeneration, select_by_keys
from frances.audio.run import run_audio, run_audio_keys
from frances.jobs.queue import Job, PermanentJobError
from frances.jobs.registry import HandlerRegistry
from frances.manage.audio import plan_audio_for_cards, queue_audio_regeneration
from frances.manage.cards import regenerate_item
from frances.stage import StageContext
from frances.timeutil import format_ts

_EMPTY_COUNTS: dict[str, int] = {
    "requested": 0,
    "planned": 0,
    "done": 0,
    "failed": 0,
    "left_pending": 0,
    "azure_used": 0,
}


def handle_cards_regenerate_item(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Regenera las tarjetas de una publicación y encola su audio pendiente.

    Un ``item_id`` ausente, mal formado, inexistente o borrado falla de forma
    permanente: reintentarlo no puede cambiar el resultado. Devuelve los
    conteos de :func:`regenerate_item` más el id del trabajo de audio encolado
    (``None`` si no había clips pendientes).
    """
    item_id = _payload_str(job.payload, "item_id")
    if not _item_alive(ctx, item_id):
        raise PermanentJobError("publicación no encontrada")
    try:
        result = regenerate_item(ctx, item_id)
    except LookupError as exc:
        raise PermanentJobError("publicación no encontrada") from exc

    card_ids = [
        str(row[0])
        for row in ctx.store.conn.execute(
            "SELECT card_id FROM card_sources WHERE item_id = ? ORDER BY card_id",
            (item_id,),
        ).fetchall()
    ]
    pending = plan_audio_for_cards(ctx, card_ids)
    audio_job: int | None = None
    if pending:
        audio_job = queue_audio_regeneration(
            ctx.store.conn,
            {"cache_keys": pending},
            f"audio.regenerate:item:{item_id}",
            ctx.now(),
        ).id
    return {**result, "audio_job": audio_job}


def handle_audio_regenerate(ctx: StageContext, job: Job) -> dict[str, int]:
    """Sintetiza solo los clips del payload y devuelve los conteos del run.

    ``{"scope": "all"}`` relee la cola completa; ``{"cache_keys": [...]}``
    reinicia y sintetiza exactamente esas claves; ``{"card_id": ...}``
    planifica las tarjetas de esa tarjeta. Un payload sin claves, con claves
    desconocidas o con más de un modo falla de forma permanente.
    """
    payload = job.payload
    modes = [key for key in ("scope", "cache_keys", "card_id") if key in payload]
    if len(modes) != 1:
        raise PermanentJobError("payload inválido: audio.regenerate")
    mode = modes[0]
    if mode == "scope":
        if payload.get("scope") != "all":
            raise PermanentJobError("payload inválido: scope")
        return dict(run_audio(ctx, None).counts)
    if mode == "cache_keys":
        keys = _cache_keys(payload["cache_keys"])
        existing = sorted({row.cache_key for row in select_by_keys(ctx.store.conn, keys)})
        if not existing:
            raise PermanentJobError("sin clips de audio")
        _reset(ctx, existing)
        return dict(run_audio_keys(ctx, existing).counts)

    card_id = _payload_str(payload, "card_id")
    if not _card_alive(ctx, card_id):
        raise PermanentJobError("tarjeta no encontrada")
    keys = plan_audio_for_cards(ctx, [card_id])
    if not keys:
        return dict(_EMPTY_COUNTS)
    _reset(ctx, keys)
    return dict(run_audio_keys(ctx, keys).counts)


def register_handlers(reg: HandlerRegistry) -> None:
    """Registra los dos ``kind`` de gestión de P11."""
    reg.add("cards.regenerate_item", handle_cards_regenerate_item)
    reg.add("audio.regenerate", handle_audio_regenerate)


# ---- privados ----


def _payload_str(payload: Mapping[str, Any], key: str) -> str:
    """Valor de texto no vacío del payload; cualquier otra forma es permanente."""
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise PermanentJobError(f"payload inválido: {key}")
    return value


def _cache_keys(value: Any) -> list[str]:
    """Lista no vacía de claves de texto; otra forma es un payload permanente inválido."""
    if not isinstance(value, list) or not value:
        raise PermanentJobError("payload inválido: cache_keys")
    keys: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise PermanentJobError("payload inválido: cache_keys")
        keys.append(item)
    return sorted(set(keys))


def _item_alive(ctx: StageContext, item_id: str) -> bool:
    row = ctx.store.conn.execute(
        "SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL", (item_id,)
    ).fetchone()
    return row is not None


def _card_alive(ctx: StageContext, card_id: str) -> bool:
    row = ctx.store.conn.execute(
        "SELECT 1 FROM cards WHERE id = ? AND removed_at IS NULL", (card_id,)
    ).fetchone()
    return row is not None


def _reset(ctx: StageContext, cache_keys: list[str]) -> None:
    """Devuelve a ``pending`` solo las claves pedidas, sin tocar sus enlaces."""
    stamp = format_ts(ctx.now())
    with ctx.store.tx() as conn:
        for cache_key in cache_keys:
            reset_for_regeneration(conn, cache_key, stamp)
