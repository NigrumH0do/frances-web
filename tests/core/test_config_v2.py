import os
from pathlib import Path

import pytest

from frances.config import (
    load_settings,
    process_env,
    public_origin,
    resolve_data_dir,
    resolve_state_db,
)
from frances.errors import ConfigError
from frances.log import redact
from frances.paths import DataPaths


def test_v2_sections_have_spec_defaults(tmp_path: Path) -> None:
    s = load_settings(tmp_path / "nope.toml", {})
    assert (s.llm.mode, s.llm.max_calls_per_day) == ("auto", 300)
    assert (s.jobs.max_attempts, s.jobs.backoff_base_s) == (5, 60)
    assert (s.scheduler.daily_at, s.scheduler.reconcile_weekday, s.scheduler.reconcile_at) == (
        "05:17",
        6,
        "06:00",
    )
    assert (s.backup.retention_days, s.server.session_ttl_days) == (14, 30)


@pytest.mark.parametrize(
    "toml",
    [
        '[scheduler]\ndaily_at = "5:17"',
        '[scheduler]\ntimezone = "Mars/Base"',
        '[backup]\nprefix = "sin-barra"',
        '[llm]\nmode = "on"',
        "[jobs]\nnope = 1",
    ],
)
def test_invalid_v2_values_are_config_error(tmp_path: Path, toml: str) -> None:
    (tmp_path / "f.toml").write_text(toml)
    with pytest.raises(ConfigError):
        load_settings(tmp_path / "f.toml", {})


def test_resolve_state_db_and_data_dir(tmp_path: Path) -> None:
    paths = DataPaths(tmp_path)
    assert resolve_state_db(paths, {}) == paths.state_db  # R-36: v1 por defecto
    assert resolve_state_db(paths, {"FRANCES_STATE_DB": "/data/state.db"}) == Path("/data/state.db")
    assert resolve_data_dir({"FRANCES_DATA_DIR": "/data"}, Path(".")) == Path("/data")
    assert resolve_data_dir({}, Path("x")) == Path("x")


@pytest.mark.parametrize(
    "value,ok",
    [
        ("https://frances.example.org", True),
        ("https://h:8443", True),
        ("http://localhost", True),
        ("http://localhost:5173", True),
        ("http://127.0.0.1:5173", True),
        ("http://[::1]:5173", True),
        ("http://frances.example.org", False),
        ("http://localhost.example.org", False),
        ("http://localhost:5173/entrar", False),
        ("https://h/", False),
        ("https://h/app", False),
        (None, False),
    ],
)
def test_public_origin_validation(tmp_path: Path, value: str | None, ok: bool) -> None:
    s = load_settings(
        tmp_path / "x.toml", {} if value is None else {"FRANCES_PUBLIC_ORIGIN": value}
    )
    if ok:
        assert public_origin(s) == value
    else:
        with pytest.raises(ConfigError, match="FRANCES_PUBLIC_ORIGIN"):
            public_origin(s)


def test_process_env_returns_copy_of_os_environ(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRANCES_SRV02_PROBE", "valor-srv02")
    env = process_env()
    assert env["FRANCES_SRV02_PROBE"] == "valor-srv02"
    assert env == dict(os.environ)
    env["FRANCES_SRV02_PROBE"] = "mutado"
    assert os.environ["FRANCES_SRV02_PROBE"] == "valor-srv02"


def test_backup_secrets_are_redacted() -> None:
    env = {
        "FRANCES_BACKUP_SECRET_ACCESS_KEY": "s3cr3t-value-123",
        "FRANCES_BACKUP_ACCESS_KEY_ID": "AKID-value-456",
    }
    out = redact("k=s3cr3t-value-123 id=AKID-value-456", env)
    assert "s3cr3t" not in out and "AKID-value" not in out


def test_example_toml_loads_with_all_sections() -> None:
    s = load_settings(Path("frances.example.toml"), {})
    assert {"server", "llm", "jobs", "scheduler", "backup"} <= set(type(s).model_fields)
