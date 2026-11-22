"""CLI admin: create-user, invite, disable (plan SRV-03)."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

from frances.accounts.cli import register
from frances.accounts.repo import authenticate, create_user
from frances.db.store import Store
from frances.paths import DataPaths

NOW = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)


def _seeded_store(data: Path) -> Store:
    DataPaths(data).ensure_dirs()
    return Store.open(DataPaths(data).state_db)


def _app() -> typer.Typer:
    app = typer.Typer()
    register(app)
    return app


def test_cli_create_user_never_prints_hash(cli_runner: CliRunner, tmp_path: Path) -> None:
    r = cli_runner.invoke(
        _app(),
        [
            "admin",
            "create-user",
            "--email",
            "ana@ex.org",
            "--name",
            "Ana",
            "--role",
            "admin",
            "--data",
            str(tmp_path),
        ],
        input="clave muy larga 1\nclave muy larga 1\n",
    )
    assert r.exit_code == 0, r.output
    assert "$argon2" not in r.output
    assert "clave muy larga 1" not in r.output
    store = Store.connect(DataPaths(tmp_path).state_db)
    try:
        assert authenticate(store.conn, "ana@ex.org", "clave muy larga 1", NOW) is not None
    finally:
        store.close()


def test_cli_create_user_rejects_bad_role(cli_runner: CliRunner, tmp_path: Path) -> None:
    r = cli_runner.invoke(
        _app(),
        [
            "admin",
            "create-user",
            "--email",
            "a@ex.org",
            "--name",
            "A",
            "--role",
            "root",
            "--data",
            str(tmp_path),
        ],
        input="clave muy larga 1\nclave muy larga 1\n",
    )
    assert r.exit_code != 0


def test_cli_invite_prints_url_with_public_origin(
    cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRANCES_PUBLIC_ORIGIN", "https://frances.example.org")
    store = _seeded_store(tmp_path)
    create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    store.close()
    r = cli_runner.invoke(_app(), ["admin", "invite", "--data", str(tmp_path)])
    assert r.exit_code == 0, r.output
    line = next(x for x in r.output.splitlines() if "https://frances.example.org/invitacion#" in x)
    token = line.split("#", 1)[1].strip()
    assert len(token) >= 40
    check = Store.connect(DataPaths(tmp_path).state_db)
    try:
        stored = check.conn.execute("SELECT COUNT(*) FROM invites WHERE token_sha256 = ?", (token,))
        assert stored.fetchone()[0] == 0  # solo se guarda el hash
    finally:
        check.close()


def test_cli_disable_last_admin_fails(cli_runner: CliRunner, tmp_path: Path) -> None:
    store = _seeded_store(tmp_path)
    create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    store.close()
    r = cli_runner.invoke(
        _app(), ["admin", "disable", "--email", "ana@ex.org", "--data", str(tmp_path)]
    )
    assert r.exit_code == 1
    assert "último" in r.output


def test_cli_disable_user_succeeds(cli_runner: CliRunner, tmp_path: Path) -> None:
    store = _seeded_store(tmp_path)
    create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    create_user(store.conn, "bea@ex.org", "Bea", "clave muy larga 2", "user", NOW)
    store.close()
    r = cli_runner.invoke(
        _app(), ["admin", "disable", "--email", "BEA@ex.org", "--data", str(tmp_path)]
    )
    assert r.exit_code == 0, r.output
    check = Store.connect(DataPaths(tmp_path).state_db)
    try:
        assert (
            check.conn.execute(
                "SELECT disabled_at IS NOT NULL FROM users WHERE email = 'bea@ex.org'"
            ).fetchone()[0]
            == 1
        )
    finally:
        check.close()


def test_cli_create_user_invalid_email_is_clean_error(
    cli_runner: CliRunner, tmp_path: Path
) -> None:
    r = cli_runner.invoke(
        _app(),
        [
            "admin",
            "create-user",
            "--email",
            "no-mail",
            "--name",
            "Ana",
            "--role",
            "user",
            "--data",
            str(tmp_path),
        ],
        input="clave muy larga 1\nclave muy larga 1\n",
    )
    assert r.exit_code != 0
    assert "Traceback" not in r.output
    assert "correo no válido" in r.output


def test_cli_invite_attributes_to_an_active_admin_not_a_pending_one(
    cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRANCES_PUBLIC_ORIGIN", "https://frances.example.org")
    store = _seeded_store(tmp_path)
    pending = create_user(
        store.conn,
        "profe@ex.org",
        "Profe",
        "clave muy larga 1",
        "admin",
        NOW - timedelta(minutes=5),
    )
    active = create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 2", "admin", NOW)
    store.conn.execute("UPDATE users SET status = 'pending' WHERE id = ?", (pending.id,))
    store.close()

    r = cli_runner.invoke(_app(), ["admin", "invite", "--data", str(tmp_path)])

    assert r.exit_code == 0, r.output
    check = Store.connect(DataPaths(tmp_path).state_db)
    try:
        created_by = check.conn.execute("SELECT created_by FROM invites").fetchone()[0]
    finally:
        check.close()
    assert created_by == active.id


def test_cli_invite_fails_without_an_active_admin(
    cli_runner: CliRunner, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRANCES_PUBLIC_ORIGIN", "https://frances.example.org")
    store = _seeded_store(tmp_path)
    admin = create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    store.conn.execute("UPDATE users SET status = 'pending' WHERE id = ?", (admin.id,))
    store.close()

    r = cli_runner.invoke(_app(), ["admin", "invite", "--data", str(tmp_path)])

    assert r.exit_code == 1
    assert "administrador activo" in r.output
