"""Respuestas de archivos con ETag, caché privada y ``Range`` (plan SRV-08).

``FileResponse`` de Starlette atiende las peticiones parciales; aquí se validan
antes para que un ``Range`` mal formado también responda 416 y nunca se lea
fuera del archivo. La ruta se arma en la capa de rutas con
``DataPaths.blob_path(sha)`` a partir de un sha registrado en la base.
"""

import re
from pathlib import Path

from fastapi import Request
from starlette.responses import FileResponse, PlainTextResponse, Response

#: Mimes que se pueden mostrar en línea. El resto cae a descarga forzada.
INLINE_MIMES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "text/plain",
        "audio/mpeg",
    }
)
FALLBACK_MIME = "application/octet-stream"
CACHE_CONTROL = "private, max-age=31536000, immutable"
_RANGE_PART_RE = re.compile(r"(\d*)-(\d*)")


def _etag_header(etag: str) -> str:
    return f'"{etag}"'


def _if_none_match_matches(value: str | None, etag: str) -> bool:
    if value is None:
        return False
    wanted = _etag_header(etag)
    for candidate in value.split(","):
        token = candidate.strip()
        if token == "*" or token == wanted or token == f"W/{wanted}":
            return True
    return False


def _parse_range_offset(raw: str) -> int | None:
    """Convierte un extremo decimal; un número desmesurado es Range inválido."""
    try:
        return int(raw)
    except ValueError:
        return None


def _range_is_satisfiable(value: str, size: int) -> bool:
    """Valida la sintaxis de ``Range`` y que cada tramo quepa en el archivo."""
    if not value.lower().startswith("bytes="):
        return False
    specs = value[len("bytes=") :].split(",")
    if not specs:
        return False
    for spec in specs:
        match = _RANGE_PART_RE.fullmatch(spec.strip())
        if match is None:
            return False
        start_raw, end_raw = match.groups()
        if not start_raw and not end_raw:
            return False
        start: int | None = None
        if start_raw:
            start = _parse_range_offset(start_raw)
            if start is None or start >= size:
                return False
        if end_raw:
            end = _parse_range_offset(end_raw)
            if end is None:
                return False
            if start is not None and end < start:
                return False
            if start is None and end == 0:
                return False
    return True


def file_response(path: Path, *, mime: str, etag: str, request: Request) -> Response:
    """Sirve ``path`` con ``ETag``/caché, 304, 206/416 y mime acotado.

    ``etag`` es el sha256 del blob: la ruta la decide el llamador y aquí no se
    acepta ningún otro identificador.
    """
    size = path.stat().st_size
    inline = mime in INLINE_MIMES
    headers: dict[str, str] = {
        "etag": _etag_header(etag),
        "cache-control": CACHE_CONTROL,
        "x-content-type-options": "nosniff",
        "content-disposition": "inline" if inline else "attachment",
    }
    if _if_none_match_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    range_header = request.headers.get("range")
    if range_header is not None and not _range_is_satisfiable(range_header, size):
        headers["content-range"] = f"bytes */{size}"
        return PlainTextResponse("", status_code=416, headers=headers)

    return FileResponse(
        path,
        media_type=mime if inline else FALLBACK_MIME,
        headers=headers,
    )
