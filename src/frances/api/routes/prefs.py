"""API de preferencias, estadísticas, progreso y entregas del usuario (plan UI-06).

``router`` exige sesión en todas las rutas; ``PUT /prefs`` pasa además por el
CSRF de SRV-04. Las preferencias se validan con el modelo de CHG-12
(``extra="forbid"``) y con las reglas de rango y voces de CHG-12.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from frances.api.app import ApiContext
from frances.api.cards_repo import enabled_voices
from frances.api.content_repo import get_item_detail
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.prefs_repo import (
    course_included,
    save_prefs,
    topic_progress,
    upcoming_item_ids,
    user_stats,
)
from frances.api.review_repo import get_prefs_row
from frances.api.security import CurrentUser, require_user
from frances.models.api import ItemSummary
from frances.models.study import TopicProgress, UserPrefs, UserStats

router = APIRouter(prefix="/api/me", dependencies=[Depends(require_user)])

_NOT_FOUND = "No existe."
_BAD_REQUEST = "Datos no válidos."
_MAX_DAILY_NEW_CARDS = 100


@router.get("/prefs", response_model=UserPrefs)
def get_prefs(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> UserPrefs:
    """Preferencias guardadas sobre los valores por defecto de ``UserPrefs``."""
    return get_prefs_row(conn, user.id)


@router.put("/prefs", response_model=UserPrefs)
def put_prefs(
    prefs: UserPrefs,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
) -> UserPrefs:
    """Valida rango y voces habilitadas (CHG-12); si no, 400 ``bad_request``."""
    if not 0 <= prefs.daily_new_cards <= _MAX_DAILY_NEW_CARDS:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST)
    enabled = {voice.id for voice in enabled_voices(ctx.paths)}
    if any(voice_id not in enabled for voice_id in prefs.preferred_voice_ids):
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST)
    return save_prefs(conn, user.id, prefs, ctx.now())


@router.get("/stats", response_model=UserStats)
def get_stats(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
) -> UserStats:
    """Racha, semana, retención y mejores quizzes del usuario de la sesión."""
    return user_stats(conn, user.id, ctx.now())


@router.get("/topic-progress", response_model=list[TopicProgress])
def get_topic_progress(
    course_id: Annotated[str, Query(min_length=1)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> list[TopicProgress]:
    """Un elemento por tema vigente del curso; curso ausente o no incluido → 404."""
    if not course_included(conn, course_id):
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return topic_progress(conn, user.id, course_id)


@router.get("/upcoming", response_model=list[ItemSummary])
def get_upcoming(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    limit: Annotated[int, Query(ge=1, le=10)] = 3,
) -> list[ItemSummary]:
    """Entregas futuras vivas de cursos incluidos, por ``due_at`` ascendente."""
    items: list[ItemSummary] = []
    for item_id in upcoming_item_ids(conn, ctx.now(), limit):
        detail = get_item_detail(conn, item_id)
        if detail is not None:
            items.append(detail.item)
    return items
