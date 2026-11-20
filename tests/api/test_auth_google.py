"""Pruebas HTTP del flujo Google OIDC + PKCE y aprobación de cuentas (ADR-021)."""

from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from frances.accounts.repo import list_users
from frances.api.routes import auth_google
from frances.api.security import CSRF_COOKIE, SESSION_COOKIE
from frances.db.store import Store
from tests.testkit.api import make_api

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
    cb1 = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state1},
        follow_redirects=False,
    )
    assert cb1.status_code == 302
    assert cb1.headers["location"] == "/login?status=pending"
    assert SESSION_COOKIE not in client.cookies

    # Reutilizar mismo state falla
    cb_reuse = client.get(
        "/api/auth/google/callback",
        params={"code": "code-1", "state": state1},
        follow_redirects=False,
    )
    assert cb_reuse.headers["location"] == "/login?error=oauth_state"

    # 2. Correo bootstrap admin entra activo de inmediato y recibe cookies
    current_claims.update({"sub": "sub-boss", "email": "boss@uni.example.edu", "name": "Profe"})
    admin_client, _ = make_api(tmp_path, env=GOOGLE_ENV)
    start_admin = admin_client.get("/api/auth/google/start?next=/admin", follow_redirects=False)
    state_admin = parse_qs(urlsplit(start_admin.headers["location"]).query)["state"][0]
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
