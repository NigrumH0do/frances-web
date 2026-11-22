"""Pruebas HTTP del flujo Google OIDC + PKCE y aprobación de cuentas (ADR-021)."""

from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from frances.accounts.repo import list_users, set_disabled
from frances.api.app import ApiContext
from frances.api.routes import auth_google
from frances.api.security import CSRF_COOKIE, SESSION_COOKIE
from frances.db.store import Store
from tests.testkit.api import BASE_URL, NOW, create_user, make_api

GOOGLE_ENV = {
    "GOOGLE_LOGIN_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
    "GOOGLE_LOGIN_CLIENT_SECRET": "GOCSPX-testsecret123456",
    "FRANCES_ADMIN_EMAILS": "boss@uni.example.edu",
}


def test_providers_reflects_env_configuration(tmp_path: Path) -> None:
    (tmp_path / "off").mkdir()
    (tmp_path / "on").mkdir()
    off_client, _ = make_api(tmp_path / "off")
    assert off_client.get("/api/auth/providers").json() == {
        "google_enabled": False,
        "password_enabled": True,
    }
    assert off_client.get("/api/auth/google/start").status_code == 404

    on_client, _ = make_api(tmp_path / "on", env=GOOGLE_ENV)
    assert on_client.get("/api/auth/providers").json() == {
        "google_enabled": True,
        "password_enabled": True,
    }


def test_google_start_redirects_with_pkce_and_sanitizes_next(tmp_path: Path) -> None:
    client, _ctx = make_api(tmp_path, env=GOOGLE_ENV)
    res = client.get(
        "/api/auth/google/start",
        params={"next": "https://evil.example/phish"},
        follow_redirects=False,
    )
    assert res.status_code == 302
    loc = urlsplit(res.headers["location"])
    assert loc.scheme == "https" and loc.netloc == "accounts.google.com"
    query = parse_qs(loc.query)
    assert query["client_id"] == [GOOGLE_ENV["GOOGLE_LOGIN_CLIENT_ID"]]
    assert query["code_challenge_method"] == ["S256"]
    assert query["prompt"] == ["select_account"]

    store = Store.connect(tmp_path / "state.db")
    row = store.conn.execute("SELECT next_path FROM oauth_states").fetchone()
    store.close()
    assert row == ("/",)


def test_google_callback_pending_then_admin_approve_then_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)

    def fake_exchange(_cfg: Any, _code: str, _verifier: str) -> dict[str, Any]:
        return {"id_token": "fake.jwt.token"}

    current_claims: dict[str, Any] = {
        "sub": "sub-student-1",
        "email": "student@gmail.com",
        "email_verified": True,
        "name": "Estudiante Prueba",
        "picture": "https://example.test/p.png",
    }

    monkeypatch.setattr(auth_google, "_exchange_code", fake_exchange)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda _tok, _cid: dict(current_claims))

    # 1. Usuario cualquiera entra por Google -> queda pending y sin cookies de sesión
    start1 = client.get("/api/auth/google/start?next=/repasar", follow_redirects=False)
    state1 = parse_qs(urlsplit(start1.headers["location"]).query)["state"][0]
    current_claims["nonce"] = auth_google._oauth_nonce(_stored_verifier(ctx, state1))
    cb1 = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state1},
        follow_redirects=False,
    )
    assert cb1.status_code == 302
    assert cb1.headers["location"] == "/entrar?status=pending"
    assert SESSION_COOKIE not in client.cookies

    # Reutilizar mismo state falla
    cb_reuse = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state1},
        follow_redirects=False,
    )
    assert cb_reuse.headers["location"] == "/entrar?error=oauth_state"

    # 2. Correo bootstrap admin entra activo de inmediato y recibe cookies
    current_claims.update({"sub": "sub-boss", "email": "boss@uni.example.edu", "name": "Profe"})
    admin_client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    start_admin = admin_client.get("/api/auth/google/start?next=/admin", follow_redirects=False)
    state_admin = parse_qs(urlsplit(start_admin.headers["location"]).query)["state"][0]
    current_claims["nonce"] = auth_google._oauth_nonce(_stored_verifier(ctx, state_admin))
    cb_admin = admin_client.get(
        "/api/auth/google/callback",
        params={"code": "code-a", "state": state_admin},
        follow_redirects=False,
    )
    assert cb_admin.status_code == 302
    assert cb_admin.headers["location"] == "/admin"
    assert SESSION_COOKIE in admin_client.cookies
    csrf = admin_client.cookies.get(CSRF_COOKIE)
    assert csrf is not None
    admin_client.headers["X-CSRF-Token"] = csrf
    admin_client.headers["Origin"] = "https://frances.example.org"

    pending_users = admin_client.get("/api/admin/users?status=pending").json()
    assert len(pending_users) == 1 and pending_users[0]["email"] == "student@gmail.com"
    student_id = pending_users[0]["id"]

    # 3. Admin aprueba al estudiante -> ahora puede iniciar sesión con Google
    approved = admin_client.post(f"/api/admin/users/{student_id}/approve")
    assert approved.status_code == 200 and approved.json()["status"] == "active"

    current_claims.update({"sub": "sub-student-1", "email": "student@gmail.com", "name": "Est"})
    start2 = client.get("/api/auth/google/start?next=/repasar", follow_redirects=False)
    state2 = parse_qs(urlsplit(start2.headers["location"]).query)["state"][0]
    current_claims["nonce"] = auth_google._oauth_nonce(_stored_verifier(ctx, state2))
    cb2 = client.get(
        "/api/auth/google/callback",
        params={"code": "code-2", "state": state2},
        follow_redirects=False,
    )
    assert cb2.status_code == 302 and cb2.headers["location"] == "/repasar"
    assert client.get("/api/auth/me").json()["user"]["email"] == "student@gmail.com"

    # 4. Admin deshabilita al estudiante -> sesión revocada y callback bloqueado
    disabled = admin_client.post(f"/api/admin/users/{student_id}/disable")
    assert disabled.status_code == 200 and disabled.json()["status"] == "disabled"
    assert client.get("/api/auth/me").status_code == 401

    store = Store.connect(ctx.db_path)
    assert len(list_users(store.conn)) == 2
    store.close()


def _start_state(client: TestClient) -> str:
    """Estado OAuth emitido por el flujo real de ``/api/auth/google/start``."""
    response = client.get("/api/auth/google/start", follow_redirects=False)
    assert response.status_code == 302
    return parse_qs(urlsplit(response.headers["location"]).query)["state"][0]


def _fake_tokens(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return {"id_token": "fake.jwt.token"}


def _claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "sub": "sub-student-1",
        "email": "student@gmail.com",
        "email_verified": True,
        "name": "Estudiante Prueba",
        "picture": "https://example.test/p.png",
    }
    claims.update(overrides)
    return claims


def test_google_callback_denied_redirects_to_entrar(tmp_path: Path) -> None:
    client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    res = client.get(
        "/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert res.status_code == 302
    assert res.headers["location"] == "/entrar?error=google_denied"
    assert res.headers["cache-control"] == "no-store"


def test_google_callback_unconfigured_redirects_to_entrar(tmp_path: Path) -> None:
    client, _ = make_api(tmp_path, env={})
    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": "state-1"},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=google_disabled"


def test_google_callback_missing_state_redirects_to_entrar(tmp_path: Path) -> None:
    client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    res = client.get("/api/auth/google/callback", params={"code": "code-1"}, follow_redirects=False)
    assert res.headers["location"] == "/entrar?error=oauth_state"


def test_google_callback_token_exchange_failure_redirects_to_entrar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    state = _start_state(client)

    def boom(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise ValueError("token_http_400")

    monkeypatch.setattr(auth_google, "_exchange_code", boom)
    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=google_failed"


def test_google_callback_unverified_email_redirects_to_entrar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    state = _start_state(client)
    claims = _claims_for(ctx, state, email_verified=False)  # el state se consume en el callback
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))
    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=google_unverified"


def test_google_callback_disabled_account_redirects_to_entrar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    store = Store.connect(ctx.db_path)
    try:
        account = create_user(store.conn, "student@gmail.com")
        set_disabled(store.conn, account, True, NOW)
    finally:
        store.close()
    state = _start_state(client)
    claims = _claims_for(ctx, state)
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))
    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=account_disabled"
    assert SESSION_COOKIE not in client.cookies


def _stored_verifier(ctx: ApiContext, state: str) -> str:
    """``code_verifier`` PKCE que el servidor guardó para ese ``state``."""
    store = Store.connect(ctx.db_path)
    try:
        row = store.conn.execute(
            "SELECT code_verifier FROM oauth_states WHERE state = ?", (state,)
        ).fetchone()
    finally:
        store.close()
    assert row is not None
    return str(row[0])


def _claims_for(ctx: ApiContext, state: str, **overrides: Any) -> dict[str, Any]:
    """Claims de un ``id_token`` aceptable: incluye el ``nonce`` correcto del flujo."""
    return _claims(nonce=auth_google._oauth_nonce(_stored_verifier(ctx, state)), **overrides)


def _user_count(ctx: ApiContext) -> int:
    store = Store.connect(ctx.db_path)
    try:
        return int(store.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
    finally:
        store.close()


def test_google_start_sets_browser_bound_cookie_and_nonce(tmp_path: Path) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    res = client.get("/api/auth/google/start", follow_redirects=False)

    assert res.status_code == 302
    query = parse_qs(urlsplit(res.headers["location"]).query)
    state, nonce = query["state"][0], query["nonce"][0]
    assert nonce == auth_google._oauth_nonce(_stored_verifier(ctx, state))
    assert nonce != state

    header = res.headers["set-cookie"].lower()
    assert header.startswith("__host-frances_oauth=")
    assert "httponly" in header and "path=/" in header
    assert "max-age=600" in header and "samesite=lax" in header and "secure" in header
    assert client.cookies.get("__Host-frances_oauth") == auth_google._oauth_cookie_value(state)
    assert state != client.cookies.get("__Host-frances_oauth")


def test_google_start_uses_plain_cookie_name_on_local_http(tmp_path: Path) -> None:
    env = {**GOOGLE_ENV, "FRANCES_PUBLIC_ORIGIN": "http://localhost:8000"}
    client, _ = make_api(tmp_path, env=env)
    res = client.get("/api/auth/google/start", follow_redirects=False)

    header = res.headers["set-cookie"].lower()
    assert header.startswith("frances_oauth=")
    assert "__host-" not in header
    assert "secure" not in header
    assert client.cookies.get("frances_oauth") is not None


def test_google_callback_clears_oauth_cookie(tmp_path: Path) -> None:
    client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    _start_state(client)
    assert client.cookies.get("__Host-frances_oauth") is not None

    res = client.get(
        "/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert res.headers["location"] == "/entrar?error=google_denied"
    assert client.cookies.get("__Host-frances_oauth") is None


def test_google_callback_success_clears_oauth_cookie(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    start = client.get("/api/auth/google/start?next=/repasar", follow_redirects=False)
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    assert client.cookies.get("__Host-frances_oauth") is not None

    claims = _claims_for(ctx, state, sub="sub-boss", email=GOOGLE_ENV["FRANCES_ADMIN_EMAILS"])
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))

    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert res.headers["location"] == "/repasar"
    assert SESSION_COOKIE in client.cookies
    # La cookie de flujo OIDC ya se consumió: no debe sobrevivir 10 minutos más.
    assert client.cookies.get("__Host-frances_oauth") is None


def test_google_callback_without_cookie_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    state = _start_state(client)
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: _claims_for(ctx, state))

    client.cookies.clear()
    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=oauth_state"
    assert SESSION_COOKIE not in client.cookies
    assert _user_count(ctx) == 0


def test_google_callback_with_cookie_from_another_browser_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client_a, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    client_b = TestClient(client_a.app, base_url=BASE_URL)
    _start_state(client_a)
    state_b = _start_state(client_b)
    claims = _claims_for(ctx, state_b)
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))

    res = client_a.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state_b},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=oauth_state"
    assert SESSION_COOKIE not in client_a.cookies
    assert _user_count(ctx) == 0


@pytest.mark.parametrize("bad_nonce", [None, "nonce-de-otro-flujo"])
def test_google_callback_requires_matching_nonce(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad_nonce: str | None
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    state = _start_state(client)
    claims = _claims_for(ctx, state)
    if bad_nonce is None:
        del claims["nonce"]
    else:
        claims["nonce"] = bad_nonce
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))

    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )
    assert res.headers["location"] == "/entrar?error=oauth_state"
    assert SESSION_COOKIE not in client.cookies
    assert _user_count(ctx) == 0


def test_google_start_is_rate_limited_per_ip(tmp_path: Path) -> None:
    client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    for _ in range(5):
        assert client.get("/api/auth/google/start", follow_redirects=False).status_code == 302

    blocked = client.get("/api/auth/google/start", follow_redirects=False)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"


def test_google_callback_max_users_redirects_to_entrar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "frances.toml").write_text("[server]\nmax_users = 1\n", encoding="utf-8")
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    store = Store.connect(ctx.db_path)
    try:
        create_user(store.conn, "ana@ex.org")
    finally:
        store.close()
    state = _start_state(client)
    claims = _claims_for(ctx, state)
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))

    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )

    assert res.headers["location"] == "/entrar?error=max_users"
    assert res.headers["cache-control"] == "no-store"
    assert SESSION_COOKIE not in client.cookies
    assert _user_count(ctx) == 1  # la cuenta nueva no se creó


def test_google_callback_disabled_admin_email_stays_blocked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, ctx = make_api(tmp_path, env=GOOGLE_ENV)
    store = Store.connect(ctx.db_path)
    try:
        account = create_user(store.conn, "boss@uni.example.edu")
        set_disabled(store.conn, account, True, NOW)
    finally:
        store.close()
    state = _start_state(client)
    claims = _claims_for(ctx, state, email="boss@uni.example.edu", sub="sub-boss")
    monkeypatch.setattr(auth_google, "_exchange_code", _fake_tokens)
    monkeypatch.setattr(auth_google, "_verify_id_token", lambda *_a, **_k: dict(claims))

    res = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state},
        follow_redirects=False,
    )

    assert res.headers["location"] == "/entrar?error=account_disabled"
    assert SESSION_COOKIE not in client.cookies
    store = Store.connect(ctx.db_path)
    try:
        row = store.conn.execute(
            "SELECT role, status, disabled_at FROM users WHERE id = ?", (account,)
        ).fetchone()
    finally:
        store.close()
    assert row is not None
    assert row[0] == "user" and row[1] == "disabled" and row[2] is not None
