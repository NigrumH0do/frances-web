"""Ayudas de prueba de la API (R-35): app en proceso, usuarios y sesiones.

Todo corre sin red: ``TestClient`` sobre la app de ``create_app``. El reloj es fijo (UTC).
"""

import sqlite3
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from frances.accounts.repo import create_user as _create_account
from frances.api.app import ApiContext, create_app
from frances.api.security import CSRF_COOKIE, CSRF_HEADER
from frances.config import load_settings
from frances.db.store import Store
from frances.models.accounts import Role
from frances.paths import DataPaths

ORIGIN = "https://frances.example.org"
BASE_URL = "https://testserver"
PASSWORD = "clave de prueba muy larga 0"
NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


def make_api(tmp_path: Path, env: Mapping[str, str] | None = None) -> tuple[TestClient, ApiContext]:
    """App migrada en ``tmp_path`` con ``FRANCES_PUBLIC_ORIGIN`` = :data:`ORIGIN`."""
    db_path = tmp_path / "state.db"
    Store.open(db_path).close()
    source: dict[str, str] = {"FRANCES_PUBLIC_ORIGIN": ORIGIN} | dict(env or {})
    settings = load_settings(tmp_path / "frances.toml", source)
    ctx = ApiContext(
        settings=settings,
        paths=DataPaths(tmp_path),
        db_path=db_path,
        env=source,
        now=lambda: NOW,
    )
    client = TestClient(create_app(lambda: ctx), base_url=BASE_URL)
    return client, ctx


def create_user(
    conn: sqlite3.Connection,
    email: str,
    role: Role = "user",
    password: str = PASSWORD,
) -> str:
    """Crea una cuenta activa y devuelve su id."""
    return _create_account(conn, email, email.split("@", 1)[0], password, role, NOW).id


def login(client: TestClient, email: str, password: str = PASSWORD) -> str:
    """Inicia sesión en ``client``, deja puesto el header CSRF y devuelve el token CSRF."""
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"Origin": ORIGIN},
    )
    if response.status_code != 200:
        raise AssertionError(f"login rechazado: {response.status_code}")
    csrf = str(response.json()["csrf_token"])
    client.headers[CSRF_HEADER] = csrf
    return csrf


def ctx_csrf(client: TestClient) -> str:
    """Token CSRF de la sesión que ``client`` tiene en su jar de cookies."""
    value = client.cookies.get(CSRF_COOKIE)
    if value is None:
        raise AssertionError("el cliente no tiene cookie CSRF")
    return value


def session_client(app_client: TestClient, email: str, password: str = PASSWORD) -> TestClient:
    """Cliente nuevo (jar propio) con una sesión nueva de ``email`` en la misma app."""
    other = TestClient(app_client.app, base_url=BASE_URL)
    login(other, email, password)
    return other


def second_user_client(app_client: TestClient, email: str, password: str = PASSWORD) -> TestClient:
    """Sesión de otra cuenta, separada del cliente principal."""
    return session_client(app_client, email, password)


def same_user_second_client(
    app_client: TestClient, email: str, password: str = PASSWORD
) -> TestClient:
    """Segunda sesión de la misma cuenta (otro dispositivo)."""
    return session_client(app_client, email, password)
