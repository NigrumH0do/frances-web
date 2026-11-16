"""`POST /api/speech/token`: token de Azure de corta vida, caché y límite (SRV-10)."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
import respx
from fastapi.testclient import TestClient

from tests.testkit.api import create_user, login, make_api

REGION = "eastus"
KEY = "test-speech-key-123"


@pytest.fixture
def user_client(tmp_path: Path) -> Iterator[TestClient]:
    client, ctx = make_api(
        tmp_path,
        env={"AZURE_SPEECH_KEY": KEY, "AZURE_SPEECH_REGION": REGION},
    )
    conn = sqlite3.connect(ctx.db_path)
    create_user(conn, "ana@ex.org")
    conn.close()
    login(client, "ana@ex.org")
    yield client
    client.close()


@respx.mock
def test_token_issued_and_cached(user_client: TestClient) -> None:
    route = respx.post("https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken").respond(
        200, text="tok-1"
    )
    a = user_client.post("/api/speech/token").json()
    b = user_client.post("/api/speech/token").json()
    assert a["token"] == b["token"] == "tok-1"
    assert a["region"] == "eastus"
    assert route.call_count == 1
    assert route.calls[0].request.headers["Ocp-Apim-Subscription-Key"] == KEY


@respx.mock
def test_key_never_in_response_or_logs(
    user_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    respx.post(url__regex=r".*/issueToken").respond(401, text=f"bad key {KEY}")
    r = user_client.post("/api/speech/token")
    assert r.status_code == 503
    assert KEY not in r.text + caplog.text


@respx.mock
def test_per_user_rate_limit(user_client: TestClient) -> None:
    respx.post(url__regex=r".*/issueToken").respond(200, text="t")
    codes = [user_client.post("/api/speech/token").status_code for _ in range(31)]
    assert codes[:30] == [200] * 30
    assert codes[-1] == 429


def test_requires_csrf(user_client: TestClient) -> None:
    user_client.headers.pop("X-CSRF-Token")
    assert user_client.post("/api/speech/token").status_code == 403
