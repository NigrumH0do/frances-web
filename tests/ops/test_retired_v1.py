import importlib.util
from pathlib import Path

import typer
from typer.testing import CliRunner

import frances.cli as cli
from tests.testkit.demo import blob_sources, demo_sql

GONE = (
    "src/frances/bundle",
    "src/frances/ops/r2.py",
    "worker",
    ".github/workflows/daily.yml",
    ".github/workflows/reconcile.yml",
    ".github/workflows/auth-check.yml",
    ".github/workflows/worker.yml",
    ".github/workflows/worker-deploy.yml",
    ".github/workflows/pages.yml",
    "tests/bundle",
    "tests/ops/test_prod_workflows.py",
    "tests/ops/test_pages.py",
    "tests/fixtures/frb1_vectors.json",
)


def test_frb1_runtime_and_v1_ops_are_gone():
    for path in GONE:
        assert not Path(path).exists(), path
    assert "frances.bundle.run" not in cli.COMMAND_MODULES
    assert importlib.util.find_spec("frances.ops.r2") is None


def test_demo_fixtures_and_helper_survive():
    assert Path("tests/fixtures/demo_state.sql").is_file()
    assert len(list(Path("tests/fixtures/demo_audio").glob("*.mp3"))) >= 20
    sql = demo_sql(blob_sources())
    assert "{{pdf1}}" not in sql and "CREATE TABLE" in sql


def test_cli_help_has_no_bundle_or_r2():
    app = typer.Typer()
    cli.load_commands(app)
    out = CliRunner().invoke(app, ["--help"]).output
    assert "bundle" not in out and "demo-bundle" not in out and "r2" not in out


def test_code_has_no_frb1_or_r2_symbols():
    historical_contract = Path("src/frances/models/bundle.py")
    # `log.py` conserva los nombres de variables de R2 en la lista de redacción
    # (no es runtime); el resto no puede mencionar R2.
    historical_redaction = Path("src/frances/log.py")
    for base in ("src", ".github/workflows"):
        for path in Path(base).rglob("*"):
            if not path.is_file() or path.suffix not in {".py", ".yml", ".yaml", ".sh"}:
                continue
            if path == historical_contract:
                continue  # conserva modelos compartidos con las vistas v2 (ver Interfaces)
            text = path.read_text(encoding="utf-8")
            assert "FRB1" not in text, path
            if path != historical_redaction:
                assert "R2_" not in text, path
            if base == "src":
                assert "frances.bundle" not in text, path
    snapshot = Path("scripts/demo_api_snapshot.py")
    if snapshot.exists():
        assert "from frances.bundle" not in snapshot.read_text(encoding="utf-8")
