"""`/api/admin/users` e `/api/admin/invites`: solo administradores (`require_admin`, R-33)."""

import sqlite3
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from frances.accounts.repo import (
    AccountError,
    create_invite,
    list_invites,
    list_users,
    revoke_invite,
    set_disabled,
)
from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.routes.auth import account_failure
from frances.api.security import CurrentUser, require_admin
from frances.config import public_origin
from frances.models.accounts import (
    CreateInviteRequest,
    InviteCreated,
    InviteOut,
    UserOut,
)

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

#: Vigencia máxima de una invitación creada desde la API: 30 días.
MAX_INVITE_TTL_HOURS = 24 * 30


@router.get("/users", response_model=list[UserOut])
def list_all_users(conn: Annotated[sqlite3.Connection, Depends(get_conn)]) -> list[UserOut]:
    return list_users(conn)


def _set_user_disabled(
    user_id: str,
    disabled: bool,
    ctx: ApiContext,
    conn: sqlite3.Connection,
) -> UserOut:
    try:
        return set_disabled(conn, user_id, disabled, ctx.now())
    except AccountError as exc:
        raise account_failure(exc) from None


@router.post("/users/{user_id}/disable", response_model=UserOut)
def disable_user(
    user_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> UserOut:
    return _set_user_disabled(user_id, True, ctx, conn)


@router.post("/users/{user_id}/enable", response_model=UserOut)
def enable_user(
    user_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> UserOut:
    return _set_user_disabled(user_id, False, ctx, conn)


@router.get("/invites", response_model=list[InviteOut])
def list_all_invites(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[InviteOut]:
    return list_invites(conn)


@router.post("/invites", response_model=InviteCreated, status_code=201)
def create_invitation(
    body: CreateInviteRequest,
    admin: Annotated[CurrentUser, Depends(require_admin)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> InviteCreated:
    hours = body.ttl_hours if body.ttl_hours is not None else ctx.settings.server.invite_ttl_hours
    if not 1 <= hours <= MAX_INVITE_TTL_HOURS:
        raise ApiErrorResponse(400, "bad_request", "La vigencia debe estar entre 1 y 720 horas.")
    invite, token = create_invite(
        conn,
        admin.id,
        body.role,
        body.note,
        timedelta(hours=hours),
        ctx.now(),
    )
    # El token va en el fragmento (#): no llega a logs del servidor ni al Referer.
    url = f"{public_origin(ctx.settings)}/invitacion#{token}"
    return InviteCreated(invite=invite, url=url)


@router.delete("/invites/{invite_id}", status_code=204)
def revoke_invitation(
    invite_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Response:
    try:
        revoke_invite(conn, invite_id, ctx.now())
    except AccountError as exc:
        if exc.code == "invite_invalid":
            raise ApiErrorResponse(409, "conflict", "La invitación ya fue usada.") from None
        raise account_failure(exc) from None
    return Response(status_code=204)
