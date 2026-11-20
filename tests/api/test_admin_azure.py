"""Pruebas API de ``/api/admin/azure/*``, failover ``/api/speech/token`` y ``/api/speech/usage``."""

import sqlite3
from pathlib import Path

import httpx
import respx

from tests.testkit.api import ORIGIN, create_user, login, make_api, second_user_client

ENV = {"FRANCES_SECRETS_KEY": "clave-maestra-api-admin-azure"}


def _setup(tmp_path: Path) -> tuple[object, sqlite3.Connection]:
    client, ctx = make_api(tmp_path, env=ENV)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "admin@ex.org", role="admin")
    create_user(conn, "user@ex.org", role="user")
    login(client, "admin@ex.org")
    return client, conn


def test_admin_azure_requires_admin_and_secrets_key(tmp_path: Path) -> None:
    (tmp_path / "nokey").mkdir()
    no_key_client, ctx = make_api(tmp_path / "nokey", env={})
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "admin@ex.org", role="admin")
    conn.close()
    login(no_key_client, "admin@ex.org")
    r_missing = no_key_client.post(
        "/api/admin/azure/accounts",
        json={
            "label": "Cuenta 1",
            "kind": "speech",
            "region": "eastus",
            "api_key": "fake-secret-9999",
        },
        headers={"Origin": ORIGIN},
    )
    assert r_missing.status_code == 503 and r_missing.json()["code"] == "secrets_key_missing"

    (tmp_path / "auth").mkdir()
    admin_client, ctx2 = make_api(tmp_path / "auth", env=ENV)
    conn2 = sqlite3.connect(ctx2.db_path, isolation_level=None)
    create_user(conn2, "admin@ex.org", role="admin")
    create_user(conn2, "user@ex.org", role="user")
    conn2.close()
    login(admin_client, "admin@ex.org")
    user_client = second_user_client(admin_client, "user@ex.org")
    assert user_client.get("/api/admin/azure/accounts").status_code == 403
    assert user_client.get("/api/admin/azure/summary").status_code == 403


@respx.mock
def test_admin_azure_crud_test_failover_and_speech_usage(tmp_path: Path) -> None:
    client, ctx = make_api(tmp_path, env=ENV)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "admin@ex.org", role="admin")
    create_user(conn, "student@ex.org", role="user")
    conn.close()
    login(client, "admin@ex.org")

    c1 = client.post(
        "/api/admin/azure/accounts",
        json={
            "label": "Speech Primaria",
            "kind": "speech",
            "region": "eastus",
            "api_key": "secret-primary-1111",
            "priority": 10,
        },
    )
    assert c1.status_code == 201
    acc1 = c1.json()
    assert acc1["key_hint"] == "••••1111"
    assert "secret-primary-1111" not in c1.text

    c2 = client.post(
        "/api/admin/azure/accounts",
        json={
            "label": "Speech Respaldo",
            "kind": "speech",
            "region": "brazilsouth",
            "api_key": "secret-backup-2222",
            "priority": 20,
        },
    )
    assert c2.status_code == 201
    acc2 = c2.json()

    # Probar cuenta 1 (200) y luego probar estrategia least_used
    respx.post("https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken").mock(
        side_effect=[
            httpx.Response(200, text="ok"),
            httpx.Response(429, text="quota"),
        ]
    )
    respx.post("https://brazilsouth.api.cognitive.microsoft.com/sts/v1.0/issueToken").respond(
        200, text="tok-backup"
    )

    test_res = client.post(f"/api/admin/azure/accounts/{acc1['id']}/test")
    assert test_res.status_code == 200 and test_res.json()["ok"] is True

    student = second_user_client(client, "student@ex.org")
    # Primaria devuelve 429 -> failover inmediato a respaldo (brazilsouth)
    tok = student.post("/api/speech/token")
    assert tok.status_code == 200
    tok_json = tok.json()
    assert tok_json["token"] == "tok-backup"
    assert tok_json["region"] == "brazilsouth"
    assert tok_json["account_id"] == acc2["id"]

    # Registrar consumo STT del navegador
    usage = student.post(
        "/api/speech/usage",
        json={"account_id": acc2["id"], "seconds": 18},
    )
    assert usage.status_code == 200 and usage.json()["ok"] is True

    strat = client.patch("/api/admin/azure/strategy", json={"strategy": "least_used"})
    assert strat.status_code == 200
    summary = strat.json()
    assert summary["strategy"] == "least_used"
    assert summary["stt_seconds_used"] == 18
    assert summary["encryption_ready"] is True

    # Rotación de clave + deshabilitar + eliminar
    patched = client.patch(
        f"/api/admin/azure/accounts/{acc1['id']}",
        json={"api_key": "secret-rotated-9999", "enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["key_hint"] == "••••9999" and patched.json()["enabled"] is False
    assert "secret-rotated-9999" not in patched.text

    deleted = client.delete(f"/api/admin/azure/accounts/{acc1['id']}")
    assert deleted.status_code == 200
    assert len(client.get("/api/admin/azure/accounts").json()) == 1
