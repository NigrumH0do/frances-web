"""Rutas de lectura de contenido: cursos, temas de Classroom, publicaciones y blobs."""

import base64
import hashlib
import shutil
import sqlite3
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.app import ApiContext
from frances.api.content_repo import decode_cursor
from frances.db.dump import restore_sql
from frances.paths import DataPaths
from tests.testkit.api import BASE_URL, create_user, login, make_api
from tests.testkit.demo import blob_sources, demo_sql


@dataclass(frozen=True)
class Seeded:
    client: TestClient
    ctx: ApiContext
    item_with_pdf: str
    deleted_item: str
    removed_attachment_sha: str
    pdf_sha: str


def _fill_blobs(paths: DataPaths) -> None:
    for source in blob_sources().values():
        sha = hashlib.sha256(source.read_bytes()).hexdigest()
        dest = paths.blob_path(sha)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)


def _seed_database(db_path: Path) -> tuple[str, str, str]:
    """Restaura el demo sintético y devuelve (ítem con PDF, ítem borrado, sha retirado)."""
    store = restore_sql(demo_sql(blob_sources()), db_path)
    try:
        removed_sha = store.conn.execute(
            "SELECT blob_sha256 FROM attachments WHERE id = 'at_8948549182c82663'"
        ).fetchone()[0]
        store.conn.execute(
            "UPDATE attachments SET removed_at = '2026-11-02T00:00:00.000000Z'"
            " WHERE id = 'at_8948549182c82663'"
        )
        store.conn.execute(
            "UPDATE items SET deleted_at = '2026-11-02T00:00:00.000000Z' WHERE id = 'mt_demo4'"
        )
        return "mt_demo1", "mt_demo4", str(removed_sha)
    finally:
        store.close()


@pytest.fixture
def seeded(tmp_path: Path) -> Iterator[Seeded]:
    paths = DataPaths(tmp_path)
    paths.ensure_dirs()
    _fill_blobs(paths)
    item_with_pdf, deleted_item, removed_sha = _seed_database(tmp_path / "state.db")

    client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path, isolation_level=None)
    try:
        create_user(conn, "ana@ex.org")
        login(client, "ana@ex.org")
        pdf_sha = str(
            conn.execute(
                "SELECT blob_sha256 FROM attachments WHERE id = 'at_30c7354561507085'"
            ).fetchone()[0]
        )
        yield Seeded(
            client=client,
            ctx=ctx,
            item_with_pdf=item_with_pdf,
            deleted_item=deleted_item,
            removed_attachment_sha=removed_sha,
            pdf_sha=pdf_sha,
        )
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


@pytest.fixture
def seeded_big(seeded: Seeded) -> Seeded:
    """Dos mil publicaciones sintéticas extra para el presupuesto de 300 ms."""
    now = datetime(2026, 11, 2, tzinfo=UTC)
    rows = [
        (
            f"big_{i:04d}",
            "demo-course",
            "material",
            f"big-classroom-{i}",
            f"Publication synthétique {i}",
            "Le chemin de l'école est long mais agréable.",
            "PUBLISHED",
            (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z"),
            (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z"),
            "{}",
            (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z"),
            (now - timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%S.000000Z"),
            f"hash-{i}",
        )
        for i in range(2000)
    ]
    conn = sqlite3.connect(seeded.ctx.db_path, isolation_level=None)
    try:
        conn.executemany(
            "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
            " creation_time, update_time, raw_json, first_seen_at, last_seen_at, content_hash)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    finally:
        conn.close()
    return seeded


def test_courses_and_classroom_topics(seeded: Seeded) -> None:
    courses = seeded.client.get("/api/courses").json()
    assert courses == [
        {
            "id": "demo-course",
            "name": "Français A2 – Démo",  # noqa: RUF001
            "section": "Groupe démo",
        }
    ]
    topics = seeded.client.get("/api/courses/demo-course/classroom-topics").json()
    assert {topic["name"] for topic in topics} == {
        "Salutations",
        "Les nasales",
        "Annonces",
    }
    assert seeded.client.get("/api/courses/otro/classroom-topics").json() == []


def test_items_paginate_by_update_time_desc(seeded: Seeded) -> None:
    first = seeded.client.get("/api/items", params={"limit": 2}).json()
    second = seeded.client.get(
        "/api/items", params={"limit": 2, "cursor": first["next_cursor"]}
    ).json()
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(ids) == len(set(ids)) == 4
    times = [item["updated_at"] for item in first["items"] + second["items"]]
    assert times == sorted(times, reverse=True)


def test_bad_cursor_is_400(seeded: Seeded) -> None:
    response = seeded.client.get("/api/items", params={"cursor": "%%%"})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"

    deep = base64.urlsafe_b64encode(b"[" * 10_000 + b"0" + b"]" * 10_000)
    deep_cursor = deep.decode("ascii").rstrip("=")
    response = seeded.client.get("/api/items", params={"cursor": deep_cursor})
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"


def test_decode_cursor_rejects_deep_json() -> None:
    deep = base64.urlsafe_b64encode(b"[" * 10_000 + b"0" + b"]" * 10_000)
    with pytest.raises(ValueError, match="cursor inválido"):
        decode_cursor(deep.decode("ascii").rstrip("="))


def test_item_detail_has_attachments_sheet_and_card_ids(seeded: Seeded) -> None:
    detail = seeded.client.get(f"/api/items/{seeded.item_with_pdf}").json()
    attachment = next(a for a in detail["attachments"] if a["status"] == "downloaded")
    assert attachment["file"]["url"] == f"/api/files/{attachment['file']['sha256']}"
    assert attachment["file"]["sha256"] == seeded.pdf_sha
    assert detail["card_ids"]
    assert detail["sheet"] is not None and detail["sheet"]["item_id"] == seeded.item_with_pdf


def test_deleted_items_are_hidden(seeded: Seeded) -> None:
    assert seeded.client.get(f"/api/items/{seeded.deleted_item}").status_code == 404
    listed = {item["id"] for item in seeded.client.get("/api/items").json()["items"]}
    assert seeded.deleted_item not in listed


def test_file_route_only_serves_registered_blobs(seeded: Seeded) -> None:  # REVIEW FOCUS 6
    stray = "f" * 64
    stray_path = seeded.ctx.paths.blob_path(stray)
    stray_path.parent.mkdir(parents=True, exist_ok=True)
    stray_path.write_bytes(b"secret")  # existe en disco pero no en attachments
    assert seeded.client.get(f"/api/files/{stray}").status_code == 404
    assert seeded.client.get("/api/files/..%2F..%2Fstate.db").status_code == 404
    assert seeded.client.get(f"/api/files/{seeded.removed_attachment_sha}").status_code == 404
    # El blob registrado sí se sirve: el 404 de arriba no es un fallo general de la ruta.
    assert seeded.client.get(f"/api/files/{seeded.pdf_sha}").status_code == 200


def test_file_range_and_etag(seeded: Seeded) -> None:
    url = f"/api/files/{seeded.pdf_sha}"
    full = seeded.client.get(url)
    assert full.status_code == 200 and full.headers["etag"] == f'"{seeded.pdf_sha}"'
    part = seeded.client.get(url, headers={"Range": "bytes=0-9"})
    assert part.status_code == 206 and len(part.content) == 10
    assert part.headers["content-range"].startswith("bytes 0-9/")
    assert (
        seeded.client.get(url, headers={"If-None-Match": f'"{seeded.pdf_sha}"'}).status_code == 304
    )
    assert "immutable" in full.headers["cache-control"]
    assert full.headers["x-content-type-options"] == "nosniff"
    assert full.headers["content-disposition"] == "inline"
    assert seeded.client.get(url, headers={"Range": "bytes=999999999-"}).status_code == 416
    assert seeded.client.get(url, headers={"Range": "bytes=" + "9" * 5000 + "-"}).status_code == 416
    assert seeded.client.get(url, headers={"Range": "bytes=0-" + "9" * 5000}).status_code == 416


def test_content_requires_session(anon_client: TestClient, seeded: Seeded) -> None:
    assert anon_client.get("/api/courses").status_code == 401
    assert anon_client.get("/api/items").status_code == 401
    assert anon_client.get(f"/api/files/{seeded.pdf_sha}").status_code == 401


def test_items_list_under_300ms(seeded_big: Seeded) -> None:
    started = time.perf_counter()
    response = seeded_big.client.get("/api/items", params={"limit": 50})
    elapsed = time.perf_counter() - started
    assert response.status_code == 200
    assert elapsed < 0.3
