"""`/api/admin/azure/*`: gestión multicuenta de Azure Speech y Translator (ADR-022)."""

from __future__ import annotations

import sqlite3
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends

from frances.api.app import ApiContext
from frances.api.deps import ApiErrorResponse, get_conn, get_ctx
from frances.api.routes.speech import ISSUE_URL as SPEECH_ISSUE_URL
from frances.api.security import CurrentUser, require_admin
from frances.azure.crypto import SecretsKeyMissingError
from frances.azure.pool import (
    AzureAccountNotFound,
    clear_cooldown,
    create_account,
    delete_account,
    list_accounts,
    pool_summary,
    record_failure,
    resolve_account_key,
    set_strategy,
    update_account,
)
from frances.cards.translate import ENDPOINT as TRANSLATOR_ENDPOINT
from frances.log import redact
from frances.models.azure import (
    AzureAccountIn,
    AzureAccountOut,
    AzureAccountPatch,
    AzurePoolSummary,
    AzureStrategyPatch,
    AzureTestResult,
)

router = APIRouter(prefix="/api/admin/azure", dependencies=[Depends(require_admin)])

_TRANSLATOR_TEST_PARAMS = {"api-version": "3.0", "from": "fr", "to": "es"}
_TEST_TIMEOUT_S = 10.0


def _test_live_connection(
    kind: str, region: str, api_key: str
) -> tuple[bool, int | None, int, str]:
    """Prueba conectividad real contra Azure STS o Translator (sin registrar la clave)."""
    started = time.perf_counter()
    try:
        with httpx.Client(trust_env=False, timeout=_TEST_TIMEOUT_S) as client:
            if kind == "speech":
                resp = client.post(
                    SPEECH_ISSUE_URL.format(region=region),
                    headers={"Ocp-Apim-Subscription-Key": api_key},
                    content=b"",
                )
            else:
                resp = client.post(
                    TRANSLATOR_ENDPOINT,
                    params=_TRANSLATOR_TEST_PARAMS,
                    headers={
                        "Ocp-Apim-Subscription-Key": api_key,
                        "Ocp-Apim-Subscription-Region": region,
                    },
                    json=[{"Text": "bonjour"}],
                )
    except httpx.HTTPError as exc:
        elapsed = int((time.perf_counter() - started) * 1000)
        return False, None, elapsed, f"Error de red ({type(exc).__name__})"

    elapsed = int((time.perf_counter() - started) * 1000)
    if resp.status_code == 200:
        return True, 200, elapsed, "Conexión verificada correctamente."
    return False, resp.status_code, elapsed, redact(f"Azure respondió HTTP {resp.status_code}")


@router.get("/accounts", response_model=list[AzureAccountOut])
def get_azure_accounts(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> list[AzureAccountOut]:
    return list_accounts(conn, ctx.env, ctx.now())


@router.post("/accounts", response_model=AzureAccountOut, status_code=201)
def create_azure_account(
    body: AzureAccountIn,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> AzureAccountOut:
    try:
        return create_account(conn, ctx.env, body, ctx.now())
    except SecretsKeyMissingError as exc:
        raise ApiErrorResponse(503, "secrets_key_missing", str(exc)) from None


@router.patch("/accounts/{account_id}", response_model=AzureAccountOut)
def patch_azure_account(
    account_id: str,
    body: AzureAccountPatch,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> AzureAccountOut:
    try:
        return update_account(conn, ctx.env, account_id, body, ctx.now())
    except SecretsKeyMissingError as exc:
        raise ApiErrorResponse(503, "secrets_key_missing", str(exc)) from None
    except AzureAccountNotFound:
        raise ApiErrorResponse(404, "not_found", "Cuenta de Azure no encontrada.") from None


@router.delete("/accounts/{account_id}")
def delete_azure_account(
    account_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> dict[str, bool]:
    try:
        delete_account(conn, account_id)
    except AzureAccountNotFound:
        raise ApiErrorResponse(404, "not_found", "Cuenta de Azure no encontrada.") from None
    return {"ok": True}


@router.post("/accounts/{account_id}/test", response_model=AzureTestResult)
def test_azure_account(
    account_id: str,
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> AzureTestResult:
    try:
        account = resolve_account_key(conn, ctx.env, account_id)
    except SecretsKeyMissingError as exc:
        raise ApiErrorResponse(503, "secrets_key_missing", str(exc)) from None
    except ValueError:
        raise ApiErrorResponse(
            500, "decrypt_error", "La clave cifrada no coincide con FRANCES_SECRETS_KEY."
        ) from None
    if account is None:
        raise ApiErrorResponse(404, "not_found", "Cuenta de Azure no encontrada.")

    ok, status_code, latency_ms, detail = _test_live_connection(
        account.kind, account.region, account.api_key
    )
    now = ctx.now()
    if ok:
        clear_cooldown(conn, account.id, now)
    else:
        record_failure(conn, account.id, status_code, detail, now)
    return AzureTestResult(ok=ok, status_code=status_code, latency_ms=latency_ms, detail=detail)


@router.get("/summary", response_model=AzurePoolSummary)
def get_azure_summary(
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> AzurePoolSummary:
    return pool_summary(conn, ctx.env, ctx.now())


@router.patch("/strategy", response_model=AzurePoolSummary)
def patch_azure_strategy(
    body: AzureStrategyPatch,
    admin: Annotated[CurrentUser, Depends(require_admin)],
    ctx: Annotated[ApiContext, Depends(get_ctx)],
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
) -> AzurePoolSummary:
    now = ctx.now()
    set_strategy(conn, body.strategy, updated_by=admin.id, now=now)
    return pool_summary(conn, ctx.env, now)
