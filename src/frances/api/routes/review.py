"""API de repaso: cola, reseñas FSRS y banderas por usuario (plan UI-05).

Todas las rutas exigen sesión (``require_user``) y los métodos no seguros pasan
por el CSRF de SRV-04. La visibilidad de la tarjeta se comprueba con
``get_card_view`` (SRV-09): una tarjeta propia de otro usuario responde 404.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from frances.api.app import ApiContext
from frances.api.cards_repo import get_card_view
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.review_repo import ReviewRejected, apply_review, queue_card_ids, set_flags
from frances.api.security import CurrentUser, require_user
from frances.models.api import CardView
from frances.models.study import CardFlagsIn, ReviewIn, UserCardStateOut

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

_NOT_FOUND = "No existe."
_BAD_REQUEST = "Datos no válidos."


@router.get("/review/queue", response_model=list[CardView])
def get_review_queue(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[CardView]:
    """Vencidas primero y luego nuevas hasta ``daily_new_cards`` (reglas CHG-12)."""
    ids = queue_card_ids(conn, user.id, ctx.now(), limit)
    views: list[CardView] = []
    for card_id in ids:
        view = get_card_view(conn, user.id, card_id)
        if view is not None:
            views.append(view)
    return views


@router.post("/reviews", response_model=UserCardStateOut)
def post_review(
    rv: ReviewIn,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
) -> UserCardStateOut:
    """Reseña calculada en el cliente; 200 también si se repite la misma ``reviewed_at``."""
    if get_card_view(conn, user.id, rv.card_id) is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    try:
        return apply_review(conn, user.id, rv, ctx.now())
    except ReviewRejected as exc:
        status = 400 if exc.code == "bad_request" else 409
        raise ApiErrorResponse(status, exc.code, exc.message_es) from None


@router.patch("/cards/{card_id}/flags", response_model=UserCardStateOut)
def patch_card_flags(
    card_id: str,
    flags: CardFlagsIn,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
) -> UserCardStateOut:
    """Suspender o marcar «difícil»; crea el estado vacío si aún no existe."""
    if flags.suspended is None and flags.flagged_hard is None:
        raise ApiErrorResponse(400, "bad_request", _BAD_REQUEST)
    if get_card_view(conn, user.id, card_id) is None:
        raise ApiErrorResponse(404, "not_found", _NOT_FOUND)
    return set_flags(conn, user.id, card_id, flags, ctx.now())
