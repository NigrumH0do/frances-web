"""Rutas `/api/admin/*`: usuarios e invitaciones, y el rechazo de no admins."""

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from tests.testkit.api import (
    BASE_URL,
    ORIGIN,
    PASSWORD,
    create_user,
    login,
    make_api,
    second_user_client,
)


def _setup(tmp_path: Path) -> tuple[TestClient, sqlite3.Connection, str, str]:
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    admin_id = create_user(conn, "ana@ex.org", role="admin")
    leo_id = create_user(conn, "leo@ex.org", role="user")
    login(client, "ana@ex.org")
    return client, conn, admin_id, leo_id


def test_user_cannot_reach_admin(tmp_path: Path) -> None:
    client, conn, _, _ = _setup(tmp_path)
    leo = second_user_client(client, "leo@ex.org")
    assert leo.get("/api/admin/users").status_code == 403
    assert leo.post("/api/admin/invites", json={}).status_code == 403
    conn.close()


def test_admin_lists_users_without_secrets(tmp_path: Path) -> None:
    client, conn, _, _ = _setup(tmp_path)
    r = client.get("/api/admin/users")
    assert r.status_code == 200
    emails = {u["email"] for u in r.json()}
    assert emails == {"ana@ex.org", "leo@ex.org"}
    assert "password_hash" not in r.text
    conn.close()


def test_disable_user_revokes_sessions(tmp_path: Path) -> None:
    client, conn, _, leo_id = _setup(tmp_path)
    leo = second_user_client(client, "leo@ex.org")
    assert leo.get("/api/auth/me").status_code == 200

    r = client.post(f"/api/admin/users/{leo_id}/disable")
    assert r.status_code == 200 and r.json()["disabled"] is True
    assert leo.get("/api/auth/me").status_code == 401
    conn.close()


def test_enable_user_again(tmp_path: Path) -> None:
    client, conn, _, leo_id = _setup(tmp_path)
    client.post(f"/api/admin/users/{leo_id}/disable")
    r = client.post(f"/api/admin/users/{leo_id}/enable")
    assert r.status_code == 200 and r.json()["disabled"] is False
    conn.close()


def test_cannot_disable_last_active_admin(tmp_path: Path) -> None:
    client, conn, admin_id, _ = _setup(tmp_path)
    r = client.post(f"/api/admin/users/{admin_id}/disable")
    assert r.status_code == 409 and r.json()["code"] == "conflict"
    conn.close()


def test_disable_unknown_user_is_404(tmp_path: Path) -> None:
    client, conn, _, _ = _setup(tmp_path)
    assert client.post("/api/admin/users/u_0000000000000000/disable").status_code == 404
    conn.close()


def test_invite_list_revoke_and_url_fragment(tmp_path: Path) -> None:
    client, conn, _, _ = _setup(tmp_path)
    created = client.post("/api/admin/invites", json={"role": "user", "ttl_hours": 24})
    assert created.status_code == 201
    body = created.json()
    assert body["url"].startswith(ORIGIN + "/invitacion#")
    assert "?" not in body["url"]  # el token va en el fragmento, no en la consulta

    listed = client.get("/api/admin/invites").json()
    assert len(listed) == 1 and listed[0]["id"] == body["invite"]["id"]
    assert "token" not in listed[0]

    gone = client.delete(f"/api/admin/invites/{body['invite']['id']}")
    assert gone.status_code == 204
    token = body["url"].split("#", 1)[1]
    check = client.post(
        "/api/auth/invite/check",
        json={"token": token},
        headers={"Origin": ORIGIN},
    )
    assert check.json()["valid"] is False
    conn.close()


def test_max_users_is_409(tmp_path: Path) -> None:
    (tmp_path / "frances.toml").write_text("[server]\nmax_users = 2\n", encoding="utf-8")
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org", role="admin")
    create_user(conn, "leo@ex.org", role="user")  # ya son 2 = max_users
    login(client, "ana@ex.org")
    token = client.post("/api/admin/invites", json={}).json()["url"].split("#", 1)[1]
    anon = TestClient(client.app, base_url=BASE_URL)
    r = anon.post(
        "/api/auth/invite/accept",
        json={"token": token, "email": "nuevo@ex.org", "display_name": "N", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 409 and r.json()["code"] == "conflict"
    conn.close()


def test_filter_users_by_status_and_approve_pending(tmp_path: Path) -> None:
    client, conn, _, _ = _setup(tmp_path)
    conn.execute(
        "INSERT INTO users (id, email, display_name, password_hash, role, created_at,"
        " status, auth_provider) VALUES ('u_pend', 'pend@gmail.com', 'Pendiente',"
        " '!oauth-only', 'user', '2026-11-19T00:00:00Z', 'pending', 'google')"
    )
    pend_list = client.get("/api/admin/users", params={"status": "pending"}).json()
    assert [u["id"] for u in pend_list] == ["u_pend"]

    res = client.post("/api/admin/users/u_pend/approve")
    assert res.status_code == 200
    assert res.json()["status"] == "active" and res.json()["disabled"] is False
    assert client.post("/api/admin/users/u_missing/approve").status_code == 404
    conn.close()
