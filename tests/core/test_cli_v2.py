import sys
from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

import frances.cli as cli
from frances.cli import COMMAND_MODULES


def test_command_modules_v2_appended() -> None:
    assert COMMAND_MODULES[-4:] == (
        "frances.api.cli",
        "frances.accounts.cli",
        "frances.jobs.cli",
        "frances.backup.cli",
    )


def test_help_works_without_v2_modules_installed() -> None:
    app = typer.Typer()

    @app.callback()
    def _root() -> None:
        """Raíz."""

    cli.load_commands(app)
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0


def test_missing_parent_package_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "COMMAND_MODULES", ("frances.no_existe_pkg.cli",))
    cli.load_commands(typer.Typer())


def test_missing_inner_dependency_still_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg = tmp_path / "pkg_ok_v2"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "cli.py").write_text("import pkg_ok_v2.falta_dep\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setattr(cli, "COMMAND_MODULES", ("pkg_ok_v2.cli",))
    try:
        with pytest.raises(ModuleNotFoundError):
            cli.load_commands(typer.Typer())
    finally:
        for mod in [m for m in sys.modules if m.startswith("pkg_ok_v2")]:
            del sys.modules[mod]
