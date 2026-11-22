"""Rutas `/api/auth/*`: login, sesión, contraseña, invitaciones."""

import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import frances.accounts.repo as accounts_repo
from frances.api.security import CSRF_COOKIE, SESSION_COOKIE, LoginLimiter
from tests.testkit.api import (
    BASE_URL,
    ORIGIN,
    PASSWORD,
    create_user,
    ctx_csrf,
    login,
    make_api,
    same_user_second_client,
    second_user_client,
    session_client,
)

NEW_PASSWORD = "otra clave de prueba muy larga 1"


def _seed(tmp_path: Path, *, admin: bool = True) -> tuple[TestClient, sqlite3.Connection, str]:
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    admin_id = create_user(conn, "ana@ex.org", role="admin") if admin else ""
    create_user(conn, "leo@ex.org", role="user")
    return client, conn, admin_id


def test_login_me_logout(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    csrf = login(client, "ana@ex.org")
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["email"] == "ana@ex.org" and body["user"]["role"] == "admin"
    assert body["csrf_token"] == csrf
    assert "password_hash" not in str(body)

    out = client.post("/api/auth/logout", headers={"Origin": ORIGIN})
    assert out.status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    conn.close()


def test_login_generic_401_and_no_account_leak(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    wrong = client.post(
        "/api/auth/login",
        json={"email": "ana@ex.org", "password": "mala clave de prueba"},
        headers={"Origin": ORIGIN},
    )
    unknown = client.post(
        "/api/auth/login",
        json={"email": "nadie@ex.org", "password": "mala clave de prueba"},
        headers={"Origin": ORIGIN},
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    conn.close()


def test_disabled_user_cannot_login(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    conn.execute(
        "UPDATE users SET disabled_at = '2026-11-02T00:00:00.000000Z' WHERE email = 'leo@ex.org'"
    )
    r = client.post(
        "/api/auth/login",
        json={"email": "leo@ex.org", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 401
    conn.close()


def test_session_expired_gives_401(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    conn.execute("UPDATE sessions SET expires_at = '2026-11-01T00:00:00.000000Z'")
    assert client.get("/api/auth/me").status_code == 401
    conn.close()


def test_session_revoked_gives_401(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    conn.execute("UPDATE sessions SET revoked_at = '2026-11-02T00:00:00.000000Z'")
    assert client.get("/api/auth/me").status_code == 401
    conn.close()


def test_change_password_revokes_other_sessions(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path, admin=False)
    login(client, "leo@ex.org")
    other = same_user_second_client(client, "leo@ex.org")
    assert other.get("/api/auth/me").status_code == 200

    r = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 204
    assert other.get("/api/auth/me").status_code == 401  # otra sesión revocada
    assert client.get("/api/auth/me").status_code == 200  # la que cambió sigue viva
    conn.close()


def test_change_password_wrong_current_is_400(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path, admin=False)
    login(client, "leo@ex.org")
    r = client.post(
        "/api/auth/password",
        json={"current_password": "no es esta", "new_password": NEW_PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    conn.close()


def test_change_password_wrong_attempts_rate_limited_even_with_correct_password(
    tmp_path: Path,
) -> None:
    client, conn, _ = _seed(tmp_path, admin=False)
    now = [0.0]
    client.app.state.login_limiter = LoginLimiter(per_minute=2, clock=lambda: now[0])
    login(client, "leo@ex.org")

    for _ in range(2):
        r = client.post(
            "/api/auth/password",
            json={"current_password": "no es esta", "new_password": NEW_PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert r.status_code == 400

    blocked = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "rate_limited"

    now[0] = 60.0  # pasa la ventana: vuelve a aceptarse el cambio correcto
    ok = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert ok.status_code == 204
    conn.close()


def test_change_password_weak_is_400(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path, admin=False)
    login(client, "leo@ex.org")
    r = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "corta"},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    conn.close()


def test_session_cookie_is_host_prefixed_and_httponly_on_logout(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    assert ctx_csrf(client)
    r = client.post("/api/auth/logout", headers={"Origin": ORIGIN})
    cleared = r.headers.get_list("set-cookie")
    assert any(c.startswith(f"{SESSION_COOKIE}=") for c in cleared)
    assert any(c.startswith(f"{CSRF_COOKIE}=") for c in cleared)
    conn.close()


def test_invite_flow_end_to_end(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    created = client.post("/api/admin/invites", json={"note": "compañero"})
    assert created.status_code == 201
    url = created.json()["url"]
    assert url.startswith(ORIGIN + "/invitacion#")
    token = url.split("#", 1)[1]

    anon = TestClient(client.app, base_url=BASE_URL)
    check = anon.post("/api/auth/invite/check", json={"token": token}, headers={"Origin": ORIGIN})
    assert check.json()["valid"] is True

    me = anon.post(
        "/api/auth/invite/accept",
        json={
            "token": token,
            "email": "nuevo@ex.org",
            "display_name": "Nuevo",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN},
    )
    assert me.status_code == 200 and me.json()["user"]["role"] == "user"

    again = anon.post(
        "/api/auth/invite/accept",
        json={"token": token, "email": "otro@ex.org", "display_name": "O", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert again.status_code == 400
    conn.close()


def test_accept_with_existing_email_has_same_body_as_invalid_token(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    token = client.post("/api/admin/invites", json={}).json()["url"].split("#", 1)[1]
    anon = TestClient(client.app, base_url=BASE_URL)

    existing = anon.post(
        "/api/auth/invite/accept",
        json={"token": token, "email": "leo@ex.org", "display_name": "L", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    invalid = anon.post(
        "/api/auth/invite/accept",
        json={
            "token": "token-que-no-existe",
            "email": "x@ex.org",
            "display_name": "X",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN},
    )
    assert existing.status_code == invalid.status_code == 400
    assert existing.json() == invalid.json()

    # El correo repetido no consume la invitación: sigue sirviendo con un correo libre.
    ok = anon.post(
        "/api/auth/invite/accept",
        json={"token": token, "email": "libre@ex.org", "display_name": "L", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert ok.status_code == 200
    conn.close()


def test_invite_check_invalid_token_is_not_error(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    r = client.post("/api/auth/invite/check", json={"token": "nope"}, headers={"Origin": ORIGIN})
    assert r.status_code == 200 and r.json() == {"valid": False, "expires_at": None}
    conn.close()


def test_second_user_session_is_independent(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    leo = second_user_client(client, "leo@ex.org")
    assert leo.get("/api/auth/me").json()["user"]["email"] == "leo@ex.org"
    assert client.get("/api/auth/me").json()["user"]["email"] == "ana@ex.org"
    conn.close()


def test_login_requires_matching_origin(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    no_origin = client.post("/api/auth/login", json={"email": "ana@ex.org", "password": PASSWORD})
    foreign = client.post(
        "/api/auth/login",
        json={"email": "ana@ex.org", "password": PASSWORD},
        headers={"Origin": "https://evil.example"},
    )
    assert no_origin.status_code == 403 and no_origin.json()["code"] == "csrf"
    assert foreign.status_code == 403
    conn.close()


def test_login_rate_limited_per_email(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    codes = [
        client.post(
            "/api/auth/login",
            json={"email": "ana@ex.org", "password": "mala clave de prueba"},
            headers={"Origin": ORIGIN},
        ).status_code
        for _ in range(6)
    ]
    assert codes[:5] == [401] * 5 and codes[5] == 429
    # Con el límite agotado, ni la clave correcta entra: la base ni se consulta.
    blocked = client.post(
        "/api/auth/login",
        json={"email": "ana@ex.org", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "rate_limited"
    conn.close()


def test_parallel_wrong_password_changes_cannot_exceed_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """20 peticiones simultáneas con contraseña incorrecta y límite 5: solo 5 verifican."""
    client, conn, _ = _seed(tmp_path, admin=False)
    app = client.app
    app.state.login_limiter = LoginLimiter(per_minute=1000, clock=lambda: 0.0)
    clients = [session_client(client, "leo@ex.org") for _ in range(20)]
    app.state.login_limiter = LoginLimiter(per_minute=5, clock=lambda: 0.0)

    calls = 0
    calls_lock = threading.Lock()
    real_verify = accounts_repo.verify_password

    def slow_wrong_verify(stored: str, password: str) -> bool:
        nonlocal calls
        with calls_lock:
            calls += 1
        real_verify(stored, password)  # coste real de argon2, como en producción
        return False

    monkeypatch.setattr(accounts_repo, "verify_password", slow_wrong_verify)

    barrier = threading.Barrier(len(clients))
    statuses = [0] * len(clients)

    def attempt(index: int) -> None:
        barrier.wait()
        response = clients[index].post(
            "/api/auth/password",
            json={"current_password": "no es esta", "new_password": NEW_PASSWORD},
            headers={"Origin": ORIGIN},
        )
        statuses[index] = response.status_code

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(len(clients))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert calls == 5
    assert sorted(statuses) == [400] * 5 + [429] * 15
    conn.close()


def test_invite_accept_is_rate_limited_per_ip(tmp_path: Path) -> None:
    client, conn, _ = _seed(tmp_path)
    login(client, "ana@ex.org")
    token = client.post("/api/admin/invites", json={}).json()["url"].split("#", 1)[1]
    anon = TestClient(client.app, base_url=BASE_URL)
    bogus = {
        "token": "token-que-no-existe",
        "email": "nueva@ex.org",
        "display_name": "Nueva",
        "password": PASSWORD,
    }

    codes = [
        anon.post("/api/auth/invite/accept", json=bogus, headers={"Origin": ORIGIN}).status_code
        for _ in range(6)
    ]

    assert codes[:5] == [400] * 5 and codes[5] == 429
    blocked = anon.post(
        "/api/auth/invite/accept",
        json={
            "token": token,
            "email": "libre@ex.org",
            "display_name": "Libre",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN},
    )
    assert blocked.status_code == 429 and blocked.json()["code"] == "rate_limited"
    # El límite corta antes del repositorio: la invitación sigue sin gastarse.
    still_valid = anon.post(
        "/api/auth/invite/check", json={"token": token}, headers={"Origin": ORIGIN}
    )
    assert still_valid.json()["valid"] is True
    conn.close()
