"""`/api/auth/providers` y `/api/auth/google/*`: login web OIDC + PKCE (ADR-021)."""

from __future__ import annotations

import base64
import hashlib
import secrets
import sqlite3
from datetime import timedelta
from typing import Annotated, Any
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token as google_id_token

from frances.accounts.repo import (
    consume_oauth_state,
    create_session,
    login_or_register_google,
    save_oauth_state,
)
from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.security import session_ttl, set_session_cookies
from frances.config import GoogleLoginConfig, admin_bootstrap_emails, google_login_config
from frances.log import get_logger
from frances.models.accounts import AuthProvidersOut
from frances.timeutil import format_ts

router = APIRouter(prefix="/api/auth")

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_OAUTH_STATE_TTL = timedelta(minutes=10)
_TOKEN_TIMEOUT_S = 15.0

_log = get_logger(__name__)


def _sanitize_next(raw: str | None) -> str:
    """Devuelve solo rutas relativas locales seguras; si no, ``/``."""
    if not raw:
        return "/"
    candidate = raw.strip()
    if not candidate.startswith("/") or candidate.startswith("//") or "\\" in candidate:
        return "/"
    parts = urlsplit(candidate)
    if parts.scheme or parts.netloc:
        return "/"
    return candidate


def _pkce_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _exchange_code(cfg: GoogleLoginConfig, code: str, code_verifier: str) -> dict[str, Any]:
    """Canjea el código de autorización por tokens (solo red saliente controlada)."""
    with httpx.Client(trust_env=False, timeout=_TOKEN_TIMEOUT_S) as client:
        resp = client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": cfg.client_id,
                "client_secret": cfg.client_secret,
                "redirect_uri": cfg.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
    if resp.status_code != 200:
        raise ValueError(f"token_http_{resp.status_code}")
    payload = resp.json()
    if not isinstance(payload, dict):
        raise ValueError("token_invalid_json")
    return payload


def _verify_id_token(raw_token: str, client_id: str) -> dict[str, Any]:
    """Verifica firma, audiencia y emisor del ``id_token`` OIDC de Google."""
    claims: dict[str, Any] = google_id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
        raw_token, GoogleAuthRequest(), client_id
    )
    return claims


@router.get("/providers", response_model=AuthProvidersOut)
def auth_providers(ctx: Annotated[ApiContext, Depends(get_ctx)]) -> AuthProvidersOut:
    """Proveedores de autenticación activos en este despliegue."""
    return AuthProvidersOut(
        google_enabled=google_login_config(ctx.settings) is not None,
        password_enabled=True,
    )


@router.get("/google/start")
def google_start(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    next: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """Inicia flujo OIDC + PKCE con selector de cuenta de Google (cualquier cuenta)."""
    cfg = google_login_config(ctx.settings)
    if cfg is None:
        raise ApiErrorResponse(
            404,
            "google_auth_disabled",
            "El inicio de sesión con Google no está configurado.",
        )

    now = ctx.now()
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(48)
    next_path = _sanitize_next(next)
    save_oauth_state(
        conn,
        state=state,
        code_verifier=code_verifier,
        next_path=next_path,
        created_at=format_ts(now),
        expires_at=format_ts(now + _OAUTH_STATE_TTL),
    )

    params = urlencode(
        {
            "client_id": cfg.client_id,
            "redirect_uri": cfg.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": _pkce_challenge(code_verifier),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    return RedirectResponse(
        url=f"{_GOOGLE_AUTH_URL}?{params}",
        status_code=302,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/google/callback")
def google_callback(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """Completa el flujo OIDC, registra o enlaza cuenta y crea sesión si está activa."""
    no_store = {"Cache-Control": "no-store"}
    if error is not None:
        return RedirectResponse(url="/login?error=google_denied", status_code=302, headers=no_store)

    cfg = google_login_config(ctx.settings)
    if cfg is None:
        return RedirectResponse(
            url="/login?error=google_disabled", status_code=302, headers=no_store
        )

    if not code or not state:
        return RedirectResponse(url="/login?error=oauth_state", status_code=302, headers=no_store)

    consumed = consume_oauth_state(conn, state, ctx.now())
    if consumed is None:
        return RedirectResponse(url="/login?error=oauth_state", status_code=302, headers=no_store)
    code_verifier, next_path = consumed

    try:
        tokens = _exchange_code(cfg, code, code_verifier)
        raw_id_token = tokens.get("id_token")
        if not isinstance(raw_id_token, str) or not raw_id_token:
            raise ValueError("missing_id_token")
        claims = _verify_id_token(raw_id_token, cfg.client_id)
    except Exception as exc:
        _log.warning("google oauth callback rechazado (%s)", type(exc).__name__)
        return RedirectResponse(url="/login?error=google_failed", status_code=302, headers=no_store)

    email = claims.get("email")
    sub = claims.get("sub")
    if (
        claims.get("email_verified") is not True
        or not isinstance(email, str)
        or not isinstance(sub, str)
    ):
        return RedirectResponse(
            url="/login?error=google_unverified", status_code=302, headers=no_store
        )

    display_name = claims.get("name")
    picture = claims.get("picture")
    user, is_active = login_or_register_google(
        conn,
        email=email,
        google_sub=sub,
        display_name=display_name if isinstance(display_name, str) else email,
        avatar_url=picture if isinstance(picture, str) else None,
        admin_emails=admin_bootstrap_emails(ctx.settings),
        now=ctx.now(),
    )

    if user.status == "pending":
        return RedirectResponse(url="/login?status=pending", status_code=302, headers=no_store)
    if not is_active:
        return RedirectResponse(
            url="/login?error=account_disabled", status_code=302, headers=no_store
        )

    ttl = session_ttl(ctx)
    token, session = create_session(conn, user.id, ttl, ctx.now())
    response = RedirectResponse(url=next_path, status_code=302, headers=no_store)
    set_session_cookies(response, token, session.csrf_token, max_age_s=int(ttl.total_seconds()))
    return response
