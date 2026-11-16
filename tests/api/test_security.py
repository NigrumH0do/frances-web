"""Piezas puras de seguridad: origen, límite de intentos y cookies."""

import sqlite3
from pathlib import Path

import pytest

from frances.api.security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    LoginLimiter,
    normalize_origin,
)
from tests.testkit.api import (
    ORIGIN,
    PASSWORD,
    create_user,
    ctx_csrf,
    login,
    make_api,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://Frances.Example.ORG", "https://frances.example.org"),
        ("https://frances.example.org:443", "https://frances.example.org"),
        ("https://frances.example.org:8443", "https://frances.example.org:8443"),
        ("https://frances.example.org?", "https://frances.example.org"),
        ("https://frances.example.org#", "https://frances.example.org"),
        ("http://frances.example.org:80", "http://frances.example.org"),
        ("https://frances.example.org/app", None),
        ("https://frances.example.org?x=1", None),
        ("https://user@frances.example.org", None),
        ("ftp://frances.example.org", None),
        ("https://", None),
        ("no es una url", None),
    ],
)
def test_normalize_origin(raw: str, expected: str | None) -> None:
    assert normalize_origin(raw) == expected


def test_login_limiter_sliding_window() -> None:
    now = [0.0]
    limiter = LoginLimiter(per_minute=2, clock=lambda: now[0])
    assert limiter.hit("ip:1.2.3.4") is True
    assert limiter.hit("ip:1.2.3.4") is True
    assert limiter.hit("ip:1.2.3.4") is False
    assert limiter.hit("email:ana@ex.org") is True  # claves independientes
    now[0] = 60.0
    assert limiter.hit("ip:1.2.3.4") is True  # la ventana de 60 s ya pasó


def test_limiter_drops_empty_keys_and_purges_expired_ones() -> None:
    now = [0.0]
    limiter = LoginLimiter(per_minute=5, clock=lambda: now[0], purge_every=100)
    for i in range(10_000):
        assert limiter.hit(f"email:user{i}@ex.org") is True
    assert len(limiter._hits) == 10_000

    now[0] = 60.0  # todas las ventanas ya vencieron, nadie vuelve a llamar
    for _ in range(100):  # dispara la purga periódica con una única clave
        limiter.hit("ip:1.1.1.1")
    assert len(limiter._hits) <= 2


def test_limiter_removes_key_when_its_window_empties() -> None:
    now = [0.0]
    limiter = LoginLimiter(per_minute=5, clock=lambda: now[0])
    assert limiter.hit("email:ana@ex.org") is True
    now[0] = 60.0
    assert limiter.allows("email:ana@ex.org") is True  # su ventana venció: la clave sale
    assert "email:ana@ex.org" not in limiter._hits


def test_limiter_hard_cap_on_keys() -> None:
    now = [0.0]
    limiter = LoginLimiter(per_minute=5, clock=lambda: now[0], max_keys=50)
    for i in range(500):
        assert limiter.hit(f"email:user{i}@ex.org") is True
        assert len(limiter._hits) <= 50
    assert "email:user499@ex.org" in limiter._hits  # las más recientes se conservan
    assert "email:user0@ex.org" not in limiter._hits  # las más viejas se descartan


def test_limiter_allows_is_read_only_and_respects_window() -> None:
    now = [0.0]
    limiter = LoginLimiter(per_minute=2, clock=lambda: now[0])
    assert limiter.allows("user:u1") is True
    assert limiter.allows("user:u1") is True  # consultar no consume cupo
    limiter.hit("user:u1")
    limiter.hit("user:u1")
    assert limiter.allows("user:u1") is False
    now[0] = 60.0
    assert limiter.allows("user:u1") is True


def test_session_cookie_flags_and_only_hash_stored(tmp_path: Path) -> None:
    client, ctx = make_api(tmp_path)
    store_conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(store_conn, "ana@ex.org")
    store_conn.close()

    r = client.post(
        "/api/auth/login",
        json={"email": "ana@ex.org", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert r.status_code == 200
    cookies = r.headers.get_list("set-cookie")
    sess = next(c for c in cookies if c.startswith(f"{SESSION_COOKIE}="))
    assert all(flag in sess for flag in ("HttpOnly", "Secure", "SameSite=lax", "Path=/"))
    assert "Domain" not in sess
    csrf = next(c for c in cookies if c.startswith(f"{CSRF_COOKIE}="))
    assert "HttpOnly" not in csrf and "Secure" in csrf and "Path=/" in csrf

    token = client.cookies[SESSION_COOKIE]
    conn = sqlite3.connect(ctx.db_path)
    try:
        raw = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE token_sha256 = ?", (token,)
        ).fetchone()[0]
        hashed = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    finally:
        conn.close()
    assert raw == 0 and hashed == 1


def test_wrong_csrf_header_is_403_and_writes_nothing(tmp_path: Path) -> None:
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org")
    conn.close()
    login(client, "ana@ex.org")
    client.headers["X-CSRF-Token"] = "un-token-cualquiera"
    r = client.post("/api/admin/invites", json={})
    assert r.status_code == 403 and r.json()["code"] == "csrf"
    conn = sqlite3.connect(ctx.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM invites").fetchone()[0] == 0
    finally:
        conn.close()


def test_post_without_csrf_token_is_403_and_writes_nothing(tmp_path: Path) -> None:
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@ex.org", role="admin")
    conn.close()
    login(client, "ana@ex.org")

    client.headers.pop("X-CSRF-Token")
    r = client.post("/api/admin/invites", json={})
    assert r.status_code == 403 and r.json()["code"] == "csrf"

    client.headers["X-CSRF-Token"] = ctx_csrf(client)
    foreign = client.post("/api/admin/invites", json={}, headers={"Origin": "https://evil.example"})
    assert foreign.status_code == 403 and foreign.json()["code"] == "csrf"

    check = sqlite3.connect(ctx.db_path)
    try:
        assert check.execute("SELECT COUNT(*) FROM invites").fetchone()[0] == 0
    finally:
        check.close()
