"""Lectura de tarjetas, fichas, voces, taladros y audio (plan SRV-09).

Todas las rutas exigen sesión. La visibilidad de las tarjetas se filtra en SQL
(compartidas o propias del usuario, sin ``removed_at``). El audio solo se sirve
si su clave salió de la tabla ``audio`` como ``done`` y la ruta la arma
``DataPaths.audio_path``; el ``Range`` lo atiende ``file_response`` de SRV-08.
"""

import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from frances.api.app import ApiContext
from frances.api.cards_repo import (
    audio_for_download,
    drill_decks_for_user,
    enabled_voices,
    get_card_view,
    get_sheet,
    page_cards,
)
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import CurrentUser, require_user
from frances.api.streaming import file_response
from frances.models.api import CardPage, CardView
from frances.models.bundle import DrillDeck, VoiceOut
from frances.models.content import CardKind, StudySheet

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_CACHE_KEY_RE = re.compile(r"^[0-9a-f]{32}$")
_NOT_FOUND = "No existe."


@router.get("/cards", response_model=CardPage)
def get_cards(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    item_id: str | None = None,
    kind: CardKind | None = None,
    q: str | None = None,
    include_stale: bool = False,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> CardPage:
    try:
        return page_cards(
            conn,
            user.id,
            item_id=item_id,
            kind=kind,
            q=q,
            include_stale=include_stale,
            cursor=cursor,
            limit=limit,
        )
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", "Datos no válidos.") from None


@router.get("/cards/{card_id}", response_model=CardView)
def get_card(
    card_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> CardView:
    view = get_card_view(conn, user.id, card_id)
    if view is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return view


@router.get("/sheets/{item_id}", response_model=StudySheet)
def get_item_sheet(
    item_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> StudySheet:
    sheet = get_sheet(conn, item_id)
    if sheet is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return sheet


@router.get("/voices", response_model=list[VoiceOut])
def get_voices(ctx: Annotated[ApiContext, Depends(get_ctx)]) -> list[VoiceOut]:
    return enabled_voices(ctx.paths)


@router.get("/drills", response_model=list[DrillDeck])
def get_drills(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> list[DrillDeck]:
    return drill_decks_for_user(conn, user.id)


@router.get("/audio/{cache_key}")
def get_audio(
    cache_key: str,
    request: Request,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Response:
    # Clave con otra forma: 404 sin tocar la base ni el disco.
    if _CACHE_KEY_RE.fullmatch(cache_key) is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    found = audio_for_download(conn, cache_key, ctx.paths)
    if found is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    path, _duration_ms = found
    if not path.is_file():
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return file_response(path, mime="audio/mpeg", etag=cache_key, request=request)
