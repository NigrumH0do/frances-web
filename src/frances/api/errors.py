"""Errores uniformes ``ApiError`` para `/api/*`. Ninguna respuesta lleva trazas, SQL ni cuerpos."""

import sqlite3
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from frances.api.deps import ApiErrorResponse
from frances.log import get_logger
from frances.models.api import ApiError

_log = get_logger(__name__)

_DEFAULT_MESSAGES: dict[str, str] = {
    "bad_request": "Datos no válidos.",
    "not_found": "No existe.",
    "busy": "La base de datos está ocupada; reintenta.",
    "internal": "Error interno del servidor.",
}


def _error(status: int, code: str, message_es: str | None = None) -> JSONResponse:
    body = ApiError(code=code, message_es=message_es or _DEFAULT_MESSAGES[code])
    return JSONResponse(status_code=status, content=body.model_dump())


def _on_api_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiErrorResponse)
    return _error(exc.status, exc.code, exc.message_es)


def _on_validation(request: Request, exc: Exception) -> Response:
    # Sin eco del cuerpo ni de los campos: solo el código genérico.
    return _error(400, "bad_request")


def _on_http(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    if exc.status_code == 404:
        return _error(404, "not_found")
    if exc.status_code < 500:
        return _error(exc.status_code, "bad_request")
    return _error(exc.status_code, "internal")


def _on_sqlite(request: Request, exc: Exception) -> Response:
    if isinstance(exc, sqlite3.OperationalError) and "locked" in str(exc):
        return _error(503, "busy")
    _log.error("error de base de datos: %s", type(exc).__name__)
    return _error(500, "internal")


def install_error_handlers(app: FastAPI) -> None:
    """Registra los manejadores y un guardián que vuelve 500 genérico cualquier otro error.

    Las respuestas `/api/*` llevan ``Cache-Control: no-store`` salvo las que ya traigan la suya.
    """
    app.add_exception_handler(ApiErrorResponse, _on_api_error)
    app.add_exception_handler(RequestValidationError, _on_validation)
    app.add_exception_handler(StarletteHTTPException, _on_http)
    app.add_exception_handler(sqlite3.OperationalError, _on_sqlite)

    @app.middleware("http")
    async def _guard(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            response = await call_next(request)
        except Exception as exc:
            # Solo el tipo: el mensaje puede contener rutas, SQL o secretos.
            _log.error("excepción no controlada: %s", type(exc).__name__)
            response = _error(500, "internal")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
