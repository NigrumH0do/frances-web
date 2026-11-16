"""Fixtures de la API: base temporal migrada, reloj fijo y TestClient en proceso."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from frances.api.app import ApiContext, create_app
from frances.config import Settings
from frances.db.store import Store
from frances.paths import DataPaths

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


@pytest.fixture
def api(tmp_path: Path) -> Iterator[tuple[TestClient, ApiContext]]:
    db_path = tmp_path / "state.db"
    store = Store.open(db_path)
    store.close()
    ctx = ApiContext(
        settings=Settings(),
        paths=DataPaths(tmp_path),
        db_path=db_path,
        env={},
        now=lambda: NOW,
    )
    client = TestClient(create_app(lambda: ctx), base_url="https://testserver")
    yield client, ctx
    client.close()


@pytest.fixture
def cli_runner() -> CliRunner:
    return CliRunner()
