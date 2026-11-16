"""``GET /api/audio/{cache_key}``: solo clips ``done`` y Range (SRV-09)."""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.db.dump import restore_sql
from frances.paths import DataPaths
from tests.testkit.api import BASE_URL, create_user, login, make_api
from tests.testkit.demo import blob_sources, demo_sql

DONE_KEY = "a" * 32
PENDING_KEY = "b" * 32
AUDIO_BYTES = bytes(range(256)) * 4
NOW = "2026-11-03T00:00:00.000000Z"


@dataclass(frozen=True)
class Seeded:
    client: TestClient
    ctx: ApiContext
    conn: sqlite3.Connection


@pytest.fixture
def seeded(tmp_path: Path) -> Iterator[Seeded]:
    """Demo sintético con un clip ``done`` (con archivo) y otro ``pending``."""
    paths = DataPaths(tmp_path)
    paths.ensure_dirs()
    store = restore_sql(demo_sql(blob_sources()), tmp_path / "state.db")
    store.close()

    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    conn.executemany(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, path, updated_at) VALUES (?, 'Bonjour', 'Bonjour', 'fr-FR-DeniseNeural',"
        " 'ms-neural', '1', ?, ?, ?)",
        [
            (DONE_KEY, "done", f"audio/{DONE_KEY}.mp3", NOW),
            (PENDING_KEY, "pending", None, NOW),
        ],
    )
    paths.audio_path(DONE_KEY).write_bytes(AUDIO_BYTES)
    create_user(conn, "ana@ex.org")
    login(client, "ana@ex.org")
    try:
        yield Seeded(client=client, ctx=ctx, conn=conn)
    finally:
        conn.close()
        client.close()


@pytest.fixture
def anon_client(seeded: Seeded) -> Iterator[TestClient]:
    client = TestClient(seeded.client.app, base_url=BASE_URL)
    try:
        yield client
    finally:
        client.close()


def test_audio_done_streams_with_range_pending_is_404(seeded: Seeded) -> None:
    url = f"/api/audio/{DONE_KEY}"
    full = seeded.client.get(url)
    assert full.status_code == 200
    assert full.headers["content-type"] == "audio/mpeg"
    assert full.headers["etag"] == f'"{DONE_KEY}"'
    assert full.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert full.headers["x-content-type-options"] == "nosniff"
    assert full.headers["content-disposition"] == "inline"
    assert full.content == AUDIO_BYTES

    part = seeded.client.get(url, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206
    assert part.content == AUDIO_BYTES[:100]
    assert part.headers["content-range"] == f"bytes 0-99/{len(AUDIO_BYTES)}"

    assert seeded.client.get(url, headers={"If-None-Match": f'"{DONE_KEY}"'}).status_code == 304
    assert seeded.client.get(url, headers={"Range": "bytes=999999999-"}).status_code == 416
    assert seeded.client.get(f"/api/audio/{PENDING_KEY}").status_code == 404


@pytest.mark.parametrize(
    "range_header",
    ["bytes=abc", "bytes=5-2", "bytes=-", "items=0-1"],
)
def test_invalid_range_is_416(seeded: Seeded, range_header: str) -> None:
    response = seeded.client.get(f"/api/audio/{DONE_KEY}", headers={"Range": range_header})
    assert response.status_code == 416


def test_audio_key_must_be_registered_and_well_formed(seeded: Seeded) -> None:
    assert seeded.client.get("/api/audio/" + "0" * 32).status_code == 404
    assert seeded.client.get("/api/audio/" + "A" * 32).status_code == 404
    assert seeded.client.get("/api/audio/..%2F..%2Fstate.db").status_code == 404


def test_audio_done_without_file_is_404(seeded: Seeded) -> None:
    missing = "f" * 32
    seeded.conn.execute(
        "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
        " status, path, updated_at)"
        " VALUES (?, 'Bonjour', 'Bonjour', 'fr-FR-DeniseNeural', 'ms-neural', '1', 'done',"
        " ?, ?)",
        (missing, f"audio/{missing}.mp3", NOW),
    )
    assert seeded.client.get(f"/api/audio/{missing}").status_code == 404


def test_audio_requires_session(anon_client: TestClient) -> None:
    assert anon_client.get(f"/api/audio/{DONE_KEY}").status_code == 401
