"""Fixtures del respaldo: contexto real con SQLite, blobs sintéticos y un almacén en memoria."""

import dataclasses
import hashlib
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest

import frances.db.store  # noqa: F401  # frances.db antes que frances.stage (ciclo de importación v1)
from frances.stage import StageContext, make_context

NOW = datetime(2026, 11, 6, 9, 30, tzinfo=UTC)  # viernes 04:30 en Bogotá
PREFIX = "frances/"


class FakeStore:
    """Almacén en memoria con el mismo protocolo que `S3BackupStore`."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.ops: list[tuple[str, str]] = []

    def put_file(self, key: str, path: Path) -> None:
        self.objects[key] = path.read_bytes()
        self.ops.append(("put", key))

    def get_file(self, key: str, dest: Path) -> None:
        if key not in self.objects:
            raise FileNotFoundError(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.objects[key])
        self.ops.append(("get", key))

    def delete(self, key: str) -> None:
        del self.objects[key]
        self.ops.append(("delete", key))

    def seed(self, key: str, data: bytes = b"x") -> None:
        self.objects[key] = data

    def keys(self, needle: str = "") -> list[str]:
        return sorted(k for k in self.objects if needle in k)

    # Va al final: el nombre `list` de la clase oculta el builtin en las anotaciones.
    def list(self, prefix: str) -> dict[str, int]:
        return {k: len(v) for k, v in self.objects.items() if k.startswith(prefix)}


@pytest.fixture
def fake_store() -> FakeStore:
    return FakeStore()


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    base = make_context(tmp_path / "data", env={})
    frozen = dataclasses.replace(base, now=lambda: NOW)
    yield frozen
    frozen.store.close()


@pytest.fixture
def ctx_with_blobs(ctx: StageContext) -> StageContext:
    root = ctx.paths.root
    for body in (b"uno", b"dos", b"tres"):
        sha = hashlib.sha256(body).hexdigest()
        path = ctx.paths.blob_path(sha)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    (root / "audio").mkdir(exist_ok=True)
    (root / "audio" / "clip.mp3").write_bytes(b"audio")
    (root / "extractions").mkdir(exist_ok=True)
    (root / "extractions" / "x.json").write_text("{}", encoding="utf-8")
    (root / "voices.yaml").write_text("voces: []\n", encoding="utf-8")
    return ctx


def db_row_count(path: Path, table: str) -> int:
    conn = sqlite3.connect(str(path))
    try:
        row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    finally:
        conn.close()
    assert row is not None
    return int(row[0])
