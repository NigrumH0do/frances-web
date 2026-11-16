"""Compose de cuatro servicios y ejemplos de entorno (Task SRV-13)."""

import re
from pathlib import Path

import yaml

C = yaml.safe_load(Path("infra/compose.yaml").read_text())


def test_services_and_commands() -> None:
    s = C["services"]
    assert set(s) == {"caddy", "api", "worker", "backup"}
    assert (s["worker"]["command"], s["backup"]["command"]) == (["worker"], ["backup", "loop"])
    assert all(s[n]["build"]["target"] == "app" for n in ("api", "worker", "backup"))
    assert s["caddy"]["build"]["target"] == "web"


def test_only_caddy_publishes_ports_and_app_is_non_root() -> None:  # REVIEW FOCUS 11
    s = C["services"]
    assert [n for n in s if "ports" in s[n]] == ["caddy"]
    assert all(
        s[n]["user"] == "10001:10001" and s[n]["read_only"] is True and s[n]["tmpfs"] == ["/tmp"]
        for n in ("api", "worker", "backup")
    )
    assert "/srv/frances/data:/data" not in s["caddy"]["volumes"]
    df = Path("infra/Dockerfile").read_text()
    assert "USER 10001:10001" in df.split("AS app", 1)[1]


def test_data_paths_and_env_files() -> None:
    for n in ("api", "worker", "backup"):
        svc = C["services"][n]
        assert svc["env_file"] == ["/srv/frances/.env"] or svc["env_file"] == "/srv/frances/.env"
        assert svc["environment"]["FRANCES_STATE_DB"] == "/data/state.db"
        assert "/srv/frances/data:/data" in svc["volumes"]
    assert "/srv/frances/.env" not in str(C["services"]["caddy"])  # caddy no recibe secretos


def test_examples_have_every_variable_and_no_real_values() -> None:
    env = Path("infra/env.example").read_text()
    for v in (
        "FRANCES_PUBLIC_ORIGIN",
        "FRANCES_BACKUP_ENDPOINT",
        "FRANCES_BACKUP_SECRET_ACCESS_KEY",
        "GOOGLE_REFRESH_TOKEN",
        "AZURE_SPEECH_KEY",
        "LLM_API_KEY",
    ):
        assert re.search(rf"^{v}=", env, re.M)
    assert not re.search(r"1//[\w-]{20,}|GOCSPX-|ya29\.", env)
