"""Dependencias de FastAPI: contexto del proceso y conexión SQLite por petición."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from typing import TYPE_CHECKING

from fastapi import Request

from frances.db.store import Store
from frances.errors import ConfigError

if TYPE_CHECKING:
    from frances.api.app import ApiContext


class ApiErrorResponse(Exception):
    """Error de la API: se responde con ``status`` y el ``ApiError`` ``code``/``message_es``."""

    def __init__(self, status: int, code: str, message_es: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message_es = message_es


def get_ctx(request: Request) -> ApiContext:
    ctx: ApiContext = request.app.state.ctx
    return ctx


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    """Abre ``Store.connect`` por petición y lo cierra al terminar.

    Base sin migrar o ausente → 503 ``busy`` (sin ruta ni detalle).
    """
    ctx = get_ctx(request)
    try:
        store = Store.connect(ctx.db_path)
    except ConfigError as exc:
        raise ApiErrorResponse(503, "busy", "La base de datos no está lista.") from exc
    try:
        yield store.conn
    finally:
        store.close()
