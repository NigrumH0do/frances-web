"""CLI `frances backup …` y bucle diario: códigos de salida, claves y registro en `runs`."""

import dataclasses
import threading
from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

import frances.backup.cli as cli_mod
from frances.backup.cli import register, run_loop
from frances.backup.run import run_backup
from frances.stage import StageContext, make_context
from tests.backup.conftest import NOW, PREFIX, FakeStore

SECRET_ID = "AKIDSECRET-0001"
SECRET_KEY = "SECRETVALUE-0002"
ENV = {
    "FRANCES_BACKUP_ENDPOINT": "https://ns.compat.objectstorage.sa-bogota-1.oraclecloud.com",
    "FRANCES_BACKUP_REGION": "sa-bogota-1",
    "FRANCES_BACKUP_BUCKET": "frances-bkt",
    "FRANCES_BACKUP_ACCESS_KEY_ID": SECRET_ID,
    "FRANCES_BACKUP_SECRET_ACCESS_KEY": SECRET_KEY,
}


class ScriptedStop(threading.Event):
    """Evento de parada con respuestas programadas: `False` = toca respaldar, `True` = salir."""

    def __init__(self, script: list[bool]) -> None:
        super().__init__()
        self.script = list(script)
        self.waits: list[float] = []

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout or 0.0)
        return self.script.pop(0) if self.script else True


@pytest.fixture
def cli_app() -> typer.Typer:
    app = typer.Typer()
    register(app)
    return app


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


@pytest.fixture
def configured_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def unconfigured_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def fake_store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    store = FakeStore()
    monkeypatch.setattr(cli_mod, "_store_for", lambda settings: store)
    return store


def _seeded_source(tmp_path: Path, fake: FakeStore) -> None:
    source = make_context(tmp_path / "origen", env={})
    frozen = dataclasses.replace(source, now=lambda: NOW)
    try:
        run_backup(frozen, fake, NOW)
    finally:
        frozen.store.close()


def test_run_without_configuration_exits_4_and_names_variable(
    cli_app: typer.Typer, runner: CliRunner, tmp_path: Path, unconfigured_env: None
) -> None:
    result = runner.invoke(cli_app, ["backup", "run", "--data", str(tmp_path / "data")])
    assert result.exit_code == 4
    assert "FRANCES_BACKUP_ENDPOINT" in result.output


def test_run_uploads_and_prints_no_secrets(
    cli_app: typer.Typer,
    runner: CliRunner,
    tmp_path: Path,
    configured_env: None,
    fake_store: FakeStore,
) -> None:
    result = runner.invoke(cli_app, ["backup", "run", "--data", str(tmp_path / "data")])
    assert result.exit_code == 0, result.output
    assert any(key.startswith(f"{PREFIX}db/state-") for key in fake_store.objects)
    assert SECRET_ID not in result.output and SECRET_KEY not in result.output


def test_list_shows_db_copies_only(
    cli_app: typer.Typer,
    runner: CliRunner,
    tmp_path: Path,
    configured_env: None,
    fake_store: FakeStore,
) -> None:
    _seeded_source(tmp_path, fake_store)
    fake_store.seed(f"{PREFIX}blobs/ab/abc", b"0123")
    result = runner.invoke(cli_app, ["backup", "list", "--data", str(tmp_path / "data")])
    assert result.exit_code == 0, result.output
    lines = [line for line in result.output.splitlines() if line.strip()]
    assert len(lines) == 1
    key, size = lines[0].split("\t")
    assert key.startswith(f"{PREFIX}db/state-20261106T093000Z")
    assert int(size) > 0
    assert SECRET_KEY not in result.output


def test_restore_then_refuses_overwrite_without_force(
    cli_app: typer.Typer,
    runner: CliRunner,
    tmp_path: Path,
    configured_env: None,
    fake_store: FakeStore,
) -> None:
    _seeded_source(tmp_path, fake_store)
    data = tmp_path / "destino"
    first = runner.invoke(cli_app, ["backup", "restore", "--data", str(data)])
    assert first.exit_code == 0, first.output
    assert f"{PREFIX}db/state-20261106T093000Z.db.gz" in first.output
    assert (data / ".cache" / "state.db").is_file()

    second = runner.invoke(cli_app, ["backup", "restore", "--data", str(data)])
    assert second.exit_code == 4
    assert "--force" in second.output

    forced = runner.invoke(cli_app, ["backup", "restore", "--data", str(data), "--force"])
    assert forced.exit_code == 0, forced.output


def test_loop_without_configuration_records_not_configured_and_keeps_going(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli_mod, "_store_for", _raise_not_configured)
    base = make_context(tmp_path / "data", env={})
    ctx: StageContext = dataclasses.replace(base, now=lambda: NOW)
    stop = ScriptedStop([False, False, True])
    try:
        run_loop(ctx, stop)
        rows = ctx.store.conn.execute("SELECT stage, status, stats FROM runs").fetchall()
    finally:
        ctx.store.close()
    assert [(stage, status) for stage, status, _ in rows] == [("backup", "failed")] * 2
    assert all('"not_configured":1' in stats for _, _, stats in rows)
    # 04:30 Bogotá exacto: el siguiente disparo es el día siguiente a la misma hora.
    assert stop.waits[0] == 86400.0


def test_loop_stats_never_contain_secret_values(tmp_path: Path) -> None:
    partial = {k: v for k, v in ENV.items() if k != "FRANCES_BACKUP_BUCKET"}
    base = make_context(tmp_path / "data", env=partial)
    ctx = dataclasses.replace(base, now=lambda: NOW)
    try:
        run_loop(ctx, ScriptedStop([False, True]))
        stats = ctx.store.conn.execute("SELECT stats FROM runs").fetchone()
    finally:
        ctx.store.close()
    assert stats is not None
    assert "FRANCES_BACKUP_BUCKET" in stats[0]
    assert SECRET_KEY not in stats[0] and SECRET_ID not in stats[0]


def test_loop_runs_backup_on_each_slot(tmp_path: Path, fake_store: FakeStore) -> None:
    base = make_context(tmp_path / "data", env={})
    ctx = dataclasses.replace(base, now=lambda: NOW)
    try:
        run_loop(ctx, ScriptedStop([False, False, True]))
        rows = ctx.store.conn.execute("SELECT stage, status FROM runs").fetchall()
    finally:
        ctx.store.close()
    assert rows == [("backup", "ok"), ("backup", "ok")]


def _raise_not_configured(settings: object) -> FakeStore:
    from frances.errors import ConfigError

    raise ConfigError("falta la variable FRANCES_BACKUP_ENDPOINT")
