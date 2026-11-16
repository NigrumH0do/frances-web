"""Rutas de gestión de tarjetas (P11 MGT-01).

Las rutas solo validan, delegan en ``frances.manage.cards`` y traducen sus
errores a ``ApiErrorResponse``. Las de usuario exigen sesión y CSRF; las de
``/api/admin/*`` exigen además ``require_admin``.
"""

import sqlite3
from collections.abc import Callable
from typing import Annotated, TypeVar

from fastapi import APIRouter, Depends, Response

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import CurrentUser, require_admin, require_user
from frances.jobs.queue import enqueue
from frances.manage.cards import (
    CardConflict,
    CardNotVisible,
    admin_delete_card,
    admin_update_card,
    create_own_card,
    delete_my_card,
    delete_own_card,
    queue_regenerate_item,
    upsert_my_card,
)
from frances.models.api import CardView
from frances.models.jobs import JobOut
from frances.models.study import CardOverrideIn, OwnCardIn
from frances.timeutil import format_ts

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_NOT_FOUND = "No existe."
_CONFLICT = "La tarjeta no se puede modificar."
_FORBIDDEN = "No tienes permiso para esta acción."
_BAD_REQUEST = "Datos no válidos."

T = TypeVar("T")


def _run(action: Callable[[], T]) -> T:
    """Ejecuta una operación de gestión y traduce sus errores al contrato de la API."""
    try:
        return action()
    except CardConflict:
        raise ApiErrorResponse(409, "conflict", _CONFLICT) from None
    except PermissionError:
        raise ApiErrorResponse(403, "forbidden", _FORBIDDEN) from None
    except CardNotVisible:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except LookupError:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND) from None
    except ValueError:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST) from None


def _queue_card_audio(conn: sqlite3.Connection, card_id: str, ctx: ApiContext) -> None:
    """Encola la regeneración de audio de una tarjeta sin esperar al worker."""
    enqueue(
        conn,
        "audio.regenerate",
        {"card_id": card_id},
        now=ctx.now(),
        dedupe_key=f"audio.regenerate:card:{card_id}",
    )


@router.put("/cards/{card_id}/mine", response_model=CardView)
def put_my_card(
    card_id: str,
    body: CardOverrideIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> CardView:
    return _run(lambda: upsert_my_card(conn, user.id, card_id, body, format_ts(ctx.now())))


@router.delete("/cards/{card_id}/mine", response_model=CardView)
def delete_my_card_view(
    card_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> CardView:
    return _run(lambda: delete_my_card(conn, user.id, card_id, format_ts(ctx.now())))


@router.post("/cards", response_model=CardView, status_code=201)
def post_own_card(
    body: OwnCardIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> CardView:
    view = _run(lambda: create_own_card(conn, user.id, body, format_ts(ctx.now())))
    _queue_card_audio(conn, view.id, ctx)
    return view


@router.delete("/cards/{card_id}", status_code=204)
def delete_user_card(
    card_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
) -> Response:
    _run(lambda: delete_own_card(conn, user.id, card_id))
    return Response(status_code=204)


@router.patch(
    "/admin/cards/{card_id}", response_model=CardView, dependencies=[Depends(require_admin)]
)
def patch_admin_card(
    card_id: str,
    body: CardOverrideIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> CardView:
    view = _run(lambda: admin_update_card(conn, user.id, card_id, body, format_ts(ctx.now())))
    _queue_card_audio(conn, view.id, ctx)
    return view


@router.delete("/admin/cards/{card_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_admin_card(
    card_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_admin)],
) -> Response:
    _run(lambda: admin_delete_card(conn, user.id, card_id, format_ts(ctx.now())))
    return Response(status_code=204)


@router.post(
    "/admin/items/{item_id}/regenerate",
    response_model=JobOut,
    status_code=202,
    dependencies=[Depends(require_admin)],
)
def regenerate_item_cards(
    item_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> JobOut:
    return _run(lambda: queue_regenerate_item(conn, item_id, ctx.now()))
