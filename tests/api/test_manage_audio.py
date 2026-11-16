"""Audio admin (MGT-02): cola, regeneración y voces por defecto.

Solo admin; toda escritura exige CSRF (lo deja puesto ``login``). La cola y los
trabajos fallidos se sirven con ``JobOut``: nunca llevan ``payload`` ni ``result``.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.timeutil import format_ts
from tests.testkit.api import NOW, create_user, login, make_api, session_client

DONE_KEY = "a" * 32
VOICE_A = "fr-FR-HenriNeural"
VOICE_B = "fr-FR-DeniseNeural"


class AdminApi:
    """Cliente admin con acceso a la base y a ``app_settings`` para las aserciones."""

    def __init__(self, client: TestClient, ctx: ApiContext, conn: sqlite3.Connection) -> None:
        self.client = client
        self.ctx = ctx
        self.conn = conn

    def get(self, url: str, **kwargs: Any) -> Any:
        return self.client.get(url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self.client.post(url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> Any:
        return self.client.put(url, **kwargs)

    def setting(self, key: str) -> object:
        row = self.conn.execute(
            "SELECT value_json FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        return None if row is None else json.loads(row[0])


@pytest.fixture
def admin_api(tmp_path: Path) -> Iterator[AdminApi]:
    """App migrada con un admin (sesión iniciada) y un usuario normal."""
    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    create_user(conn, "ana@example.test", role="admin")
    create_user(conn, "leo@example.test", role="user")
    login(client, "ana@example.test")
    wrapper = AdminApi(client, ctx, conn)
    yield wrapper
    conn.close()
    client.close()


@pytest.fixture
def user_api(admin_api: AdminApi) -> Iterator[TestClient]:
    client = session_client(admin_api.client, "leo@example.test")
    yield client
    client.close()


@pytest.fixture
def done_key(admin_api: AdminApi) -> str:
    """Un clip ``done`` sintético que existe en la tabla ``audio``."""
    admin_api.conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, engine_used, path, duration_ms, attempts, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            DONE_KEY,
            "Bonjour",
            "Bonjour",
            VOICE_B,
            "ms-neural",
            "1",
            "done",
            "edge",
            f"audio/{DONE_KEY}.mp3",
            1200,
            1,
            format_ts(NOW),
        ),
    )
    return DONE_KEY


def test_default_voices_replace_config_and_enqueue_regeneration(admin_api: AdminApi) -> None:
    r = admin_api.put("/api/admin/voices/default", json={"voice_ids": [VOICE_A, VOICE_B]})
    assert r.status_code == 200
    assert [v["id"] for v in r.json()] == [VOICE_A, VOICE_B]
    assert admin_api.setting("audio.default_voice_ids") == [VOICE_A, VOICE_B]
    jobs = admin_api.get("/api/admin/audio/queue").json()
    assert jobs[0]["kind"] == "audio.regenerate" and jobs[0]["state"] == "queued"


def test_default_voices_rejects_unknown_disabled_or_empty(admin_api: AdminApi) -> None:
    for body in (
        {"voice_ids": []},
        {"voice_ids": ["no-existe"]},
        {"voice_ids": [VOICE_A, VOICE_A]},
        {"voice_ids": [""]},
    ):
        assert admin_api.put("/api/admin/voices/default", json=body).status_code == 400
    assert admin_api.setting("audio.default_voice_ids") is None


def test_default_voices_rejects_disabled_voice(admin_api: AdminApi, tmp_path: Path) -> None:
    (tmp_path / "voices.yaml").write_text(
        "voices:\n  - id: fr-FR-HenriNeural\n    enabled: false\n", encoding="utf-8"
    )
    r = admin_api.put(
        "/api/admin/voices/default",
        json={"voice_ids": [VOICE_A]},
    )
    assert r.status_code == 400
    assert admin_api.setting("audio.default_voice_ids") is None


def test_default_voices_do_not_modify_existing_clips(admin_api: AdminApi, done_key: str) -> None:
    select = (
        "SELECT cache_key, status, engine_used, path, duration_ms, attempts"
        " FROM audio WHERE cache_key = ?"
    )
    before = admin_api.conn.execute(select, (done_key,)).fetchone()
    assert (
        admin_api.put("/api/admin/voices/default", json={"voice_ids": [VOICE_A]}).status_code == 200
    )
    assert admin_api.conn.execute(select, (done_key,)).fetchone() == before


def test_same_default_voices_do_not_enqueue_again(admin_api: AdminApi) -> None:
    body = {"voice_ids": [VOICE_A, VOICE_B]}
    assert admin_api.put("/api/admin/voices/default", json=body).status_code == 200
    first = admin_api.get("/api/admin/audio/queue").json()
    assert len(first) == 1
    assert admin_api.put("/api/admin/voices/default", json=body).status_code == 200
    assert admin_api.get("/api/admin/audio/queue").json() == first


def test_regenerate_audio_enqueues_deduped_job(admin_api: AdminApi, done_key: str) -> None:
    a = admin_api.post(f"/api/admin/audio/{done_key}/regenerate")
    b = admin_api.post(f"/api/admin/audio/{done_key}/regenerate")
    assert a.status_code == 202 and a.json()["kind"] == "audio.regenerate"
    assert a.json()["id"] == b.json()["id"]
    row = admin_api.conn.execute(
        "SELECT payload, dedupe_key FROM jobs WHERE id = ?", (a.json()["id"],)
    ).fetchone()
    assert json.loads(row[0]) == {"cache_keys": [done_key]}
    assert row[1] == f"audio.regenerate:{done_key}"


def test_regenerate_unknown_audio_is_404(admin_api: AdminApi) -> None:
    assert admin_api.post("/api/admin/audio/" + "f" * 32 + "/regenerate").status_code == 404


def test_regenerate_malformed_cache_key_is_400(admin_api: AdminApi) -> None:
    assert admin_api.post("/api/admin/audio/not-a-cache-key/regenerate").status_code == 400


def test_audio_queue_returns_job_out_without_payload_or_result(
    admin_api: AdminApi, done_key: str
) -> None:
    admin_api.post(f"/api/admin/audio/{done_key}/regenerate")
    job = admin_api.get("/api/admin/audio/queue").json()[0]
    assert {"payload", "result", "locked_by", "dedupe_key"}.isdisjoint(job)


def test_admin_audio_writes_require_csrf(admin_api: AdminApi, done_key: str) -> None:
    csrf = admin_api.client.headers.pop("X-CSRF-Token")
    try:
        assert (
            admin_api.put("/api/admin/voices/default", json={"voice_ids": [VOICE_A]}).status_code
            == 403
        )
        assert admin_api.post(f"/api/admin/audio/{done_key}/regenerate").status_code == 403
    finally:
        admin_api.client.headers["X-CSRF-Token"] = csrf
    assert admin_api.setting("audio.default_voice_ids") is None


def test_user_cannot_use_admin_audio(user_api: TestClient) -> None:
    assert user_api.get("/api/admin/audio/queue").status_code == 403
    assert (
        user_api.put("/api/admin/voices/default", json={"voice_ids": [VOICE_A]}).status_code == 403
    )
