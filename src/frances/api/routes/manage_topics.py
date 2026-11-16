"""Admin de temas de estudio: renombrar, unir, dividir y mover publicaciones (MGT-03).

Todas las rutas exigen ``role == "admin"`` (``require_admin``, R-33) y, por ser
métodos no seguros, el CSRF de ``require_user``. La lógica de escritura vive en
``frances.manage.topics``; aquí solo se traduce ``LookupError`` a 404 y
``ValueError`` a 400.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import require_admin
from frances.manage.topics import merge_topics, move_items, split_topic, update_topic
from frances.models.manage import (
    TopicItemsIn,
    TopicsMergeIn,
    TopicSplitIn,
    TopicUpdateIn,
)
from frances.models.study import StudyTopic
from frances.timeutil import format_ts

router = APIRouter(prefix="/api/admin/topics", dependencies=[Depends(require_admin)])

_NOT_FOUND = "No existe."
_BAD_REQUEST = "Datos no válidos."


def _now(ctx: ApiContext) -> str:
    return format_ts(ctx.now())


@router.patch("/{topic_id}", response_model=StudyTopic)
def update_admin_topic(
    topic_id: str,
    body: TopicUpdateIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudyTopic:
    try:
        return update_topic(conn, topic_id, body, _now(ctx))
    except LookupError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None


@router.post("/merge", response_model=StudyTopic)
def merge_admin_topics(
    body: TopicsMergeIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudyTopic:
    try:
        return merge_topics(conn, body, _now(ctx))
    except LookupError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None


@router.post("/{topic_id}/split", response_model=list[StudyTopic])
def split_admin_topic(
    topic_id: str,
    body: TopicSplitIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[StudyTopic]:
    try:
        return split_topic(conn, topic_id, body, _now(ctx))
    except LookupError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None


@router.post("/{topic_id}/items", response_model=StudyTopic)
def move_admin_items(
    topic_id: str,
    body: TopicItemsIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudyTopic:
    try:
        return move_items(conn, topic_id, body, _now(ctx))
    except LookupError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None
