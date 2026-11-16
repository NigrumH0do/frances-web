"""Lectura de cursos, temas de Classroom, publicaciones y adjuntos (plan SRV-08).

Todas las rutas exigen sesión. ``/api/files/{sha256}`` solo sirve blobs cuyo sha
salió de ``attachments`` vigentes; la ruta del disco se arma únicamente con
``DataPaths.blob_path`` a partir de ese sha validado.
"""

import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from frances.api.app import ApiContext
from frances.api.content_repo import (
    blob_for_download,
    get_item_detail,
    list_classroom_topics,
    list_courses,
    page_items,
)
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import require_user
from frances.api.streaming import file_response
from frances.models.api import ItemDetail, ItemPage
from frances.models.bundle import CourseOut, TopicOut
from frances.models.classroom import ItemKind

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_NOT_FOUND = "No existe."


@router.get("/courses", response_model=list[CourseOut])
def get_courses(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[CourseOut]:
    return list_courses(conn)


@router.get("/courses/{course_id}/classroom-topics", response_model=list[TopicOut])
def get_classroom_topics(
    course_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[TopicOut]:
    return list_classroom_topics(conn, course_id)


@router.get("/items", response_model=ItemPage)
def get_items(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    course_id: str | None = None,
    topic_id: str | None = None,
    kind: ItemKind | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ItemPage:
    try:
        return page_items(
            conn,
            course_id=course_id,
            topic_id=topic_id,
            kind=kind,
            cursor=cursor,
            limit=limit,
        )
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", "Datos no válidos.") from None


@router.get("/items/{item_id}", response_model=ItemDetail)
def get_item(
    item_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> ItemDetail:
    detail = get_item_detail(conn, item_id)
    if detail is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return detail


@router.get("/files/{sha256}")
def get_file(
    sha256: str,
    request: Request,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Response:
    # El path param se valida a mano: un sha con otra forma es 404, nunca 400 ni una ruta.
    if _SHA256_RE.fullmatch(sha256) is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    found = blob_for_download(conn, sha256)
    if found is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    mime, _size = found
    path = ctx.paths.blob_path(sha256)
    if not path.is_file():
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return file_response(path, mime=mime, etag=sha256, request=request)
