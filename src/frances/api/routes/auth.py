"""`/api/auth/*`: login, sesión, contraseña e invitaciones (plan SRV-04).

Rutas públicas (lista cerrada `PUBLIC_ROUTES`): login, invite/check, invite/accept. Las demás
declaran `require_user` como parámetro. Los errores de cuentas salen como `ApiError` sin traza.
"""

import sqlite3
from datetime import timedelta
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, Request, Response

from frances.accounts.passwords import WeakPassword
from frances.accounts.repo import (
    AccountError,
    AccountInputError,
    accept_invite,
    authenticate,
    change_password,
    create_session,
    get_user,
    invite_status,
    revoke_session,
    revoke_user_sessions,
)
from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import (
    CurrentUser,
    LoginLimiter,
    check_public_origin,
    clear_session_cookies,
    login_limiter,
    require_user,
    session_ttl,
    set_session_cookies,
)
from frances.models.accounts import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    InviteCheckRequest,
    InviteStatus,
    LoginRequest,
    Me,
)

router = APIRouter(prefix="/api/auth")

_WRONG_LOGIN = "Email o contraseña incorrectos."
_RATE_LIMITED = "Demasiados intentos. Espera un minuto y vuelve a intentarlo."
_WRONG_CURRENT = "La contraseña actual no es correcta."


def account_failure(exc: Exception) -> ApiErrorResponse:
    """Traduce un error de cuentas a `ApiError`: solo el código y el mensaje fijo del dominio."""
    if isinstance(exc, (WeakPassword, AccountInputError)):
        return ApiErrorResponse(400, "bad_request", str(exc))
    if isinstance(exc, AccountError):
        if exc.code == "not_found":
            return ApiErrorResponse(404, "not_found", "No existe.")
        if exc.code in ("email_taken", "last_admin", "max_users"):
            return ApiErrorResponse(409, "conflict", str(exc))
        return ApiErrorResponse(400, "bad_request", str(exc))
    raise exc  # no es de cuentas: que lo maneje el guardián 500


def _reraise(exc: Exception) -> NoReturn:
    raise account_failure(exc) from None


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "desconocida"


def _open_session(
    conn: sqlite3.Connection,
    ctx: ApiContext,
    user_id: str,
    response: Response,
) -> Me:
    ttl: timedelta = session_ttl(ctx)
    token, session = create_session(conn, user_id, ttl, ctx.now())
    set_session_cookies(response, token, session.csrf_token, max_age_s=int(ttl.total_seconds()))
    user = get_user(conn, user_id)
    if user is None:  # no ocurre: la cuenta acaba de existir
        raise ApiErrorResponse(500, "internal", "Error interno del servidor.")
    return Me(user=user, csrf_token=session.csrf_token)


@router.post("/login", response_model=Me)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    limiter: Annotated[LoginLimiter, Depends(login_limiter)],
) -> Me:
    check_public_origin(request)
    client_ip = _client_ip(request)
    ip_ok = limiter.hit(f"ip:{client_ip}")
    email_ok = limiter.hit(f"email:{body.email.strip().casefold()}")
    if not (ip_ok and email_ok):
        raise ApiErrorResponse(429, "rate_limited", _RATE_LIMITED)
    user = authenticate(conn, body.email, body.password, ctx.now())
    if user is None:
        raise ApiErrorResponse(401, "unauthenticated", _WRONG_LOGIN)
    return _open_session(conn, ctx, user.id, response)


@router.post("/logout", status_code=204)
def logout(
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Response:
    revoke_session(conn, user.session_sha256, ctx.now())
    response = Response(status_code=204)
    clear_session_cookies(response)
    return response


@router.get("/me", response_model=Me)
def me(
    user: Annotated[CurrentUser, Depends(require_user)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> Me:
    current = get_user(conn, user.id)
    if current is None:
        raise ApiErrorResponse(401, "unauthenticated", "Inicia sesión para continuar.")
    return Me(user=current, csrf_token=user.csrf_token)


@router.post("/password", status_code=204)
def change_own_password(
    body: ChangePasswordRequest,
    user: Annotated[CurrentUser, Depends(require_user)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    limiter: Annotated[LoginLimiter, Depends(login_limiter)],
) -> Response:
    # hit() comprueba y registra bajo un lock: el intento se reserva antes de verificar.
    if not limiter.hit(f"user:{user.id}"):
        raise ApiErrorResponse(429, "rate_limited", _RATE_LIMITED)
    now = ctx.now()
    try:
        changed = change_password(conn, user.id, body.current_password, body.new_password, now)
    except (WeakPassword, AccountInputError, AccountError) as exc:
        _reraise(exc)
    if not changed:
        raise ApiErrorResponse(400, "bad_request", _WRONG_CURRENT)
    revoke_user_sessions(conn, user.id, now, except_sha256=user.session_sha256)
    return Response(status_code=204)


@router.post("/invite/check", response_model=InviteStatus)
def check_invite(
    body: InviteCheckRequest,
    request: Request,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> InviteStatus:
    check_public_origin(request)
    invite = invite_status(conn, body.token, ctx.now())
    if invite is None:
        return InviteStatus(valid=False, expires_at=None)
    return InviteStatus(valid=True, expires_at=invite.expires_at)


@router.post("/invite/accept", response_model=Me)
def accept_invitation(
    body: AcceptInviteRequest,
    request: Request,
    response: Response,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    limiter: Annotated[LoginLimiter, Depends(login_limiter)],
) -> Me:
    check_public_origin(request)
    # Presupuesto propio por IP: aceptar invitaciones no consume el cupo del login.
    if not limiter.hit(f"invite:ip:{_client_ip(request)}"):
        raise ApiErrorResponse(429, "rate_limited", _RATE_LIMITED)
    try:
        user = accept_invite(
            conn,
            body.token,
            body.email,
            body.display_name,
            body.password,
            ctx.now(),
            max_users=ctx.settings.server.max_users,
        )
    except (WeakPassword, AccountInputError, AccountError) as exc:
        _reraise(exc)
    return _open_session(conn, ctx, user.id, response)
