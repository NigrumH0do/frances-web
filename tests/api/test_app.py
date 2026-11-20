"""App base: registro de routers, errores uniformes, cabeceras y ``frances serve``."""

from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
import typer
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from typer.testing import CliRunner

import frances.api.app as app_mod
from frances import cli
from frances.api import cli as api_cli
from frances.api.app import ROUTER_MODULES, ApiContext, api_context_from_env, include_routers
from frances.api.deps import ApiErrorResponse
from frances.errors import ConfigError


def test_router_modules_contract() -> None:
    assert ROUTER_MODULES[:7] == (
        "frances.api.routes.health",
        "frances.api.routes.auth",
        "frances.api.routes.auth_google",
        "frances.api.routes.admin_users",
        "frances.api.routes.content",
        "frances.api.routes.cards",
        "frances.api.routes.speech",
    )
    assert len(ROUTER_MODULES) == 18


def test_missing_router_modules_are_skipped_but_broken_ones_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        app_mod,
        "ROUTER_MODULES",
        ("frances.api.routes.health", "frances.api.routes.nope"),
    )
    assert include_routers(FastAPI()) == ["frances.api.routes.health"]


def test_broken_router_module_dependency_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    real_import: Callable[[str], Any] = app_mod.import_module

    def fake_import(name: str) -> Any:
        if name == "frances.api.routes.health":
            raise ModuleNotFoundError("falta una dependencia", name="frances.api.dep_faltante")
        return real_import(name)

    monkeypatch.setattr(app_mod, "import_module", fake_import)
    with pytest.raises(ModuleNotFoundError):
        include_routers(FastAPI())


def test_app_module_does_not_read_os_environ() -> None:
    source = Path(app_mod.__file__).read_text(encoding="utf-8")
    assert "os.environ" not in source
    assert "import os" not in source


def test_api_context_none_env_uses_process_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen: list[None] = []

    def fake_process_env() -> dict[str, str]:
        seen.append(None)
        return {"FRANCES_DATA_DIR": str(tmp_path)}

    monkeypatch.setattr(app_mod, "process_env", fake_process_env)
    ctx = api_context_from_env(None)
    assert seen == [None]
    assert ctx.env == {"FRANCES_DATA_DIR": str(tmp_path)}


def test_no_docs_in_production(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    assert client.get("/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_unknown_route_uses_api_error(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json() == {"code": "not_found", "message_es": "No existe."}


def test_wrong_method_maps_to_bad_request(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    r = client.post("/api/health")
    assert r.status_code == 405
    assert r.json()["code"] == "bad_request"


class _Body(BaseModel):
    email: str


def _probe(app: FastAPI) -> None:
    @app.post("/api/probe")
    def probe(body: _Body) -> dict[str, str]:
        return {"ok": body.email}

    @app.get("/api/conflict")
    def conflict() -> None:
        raise ApiErrorResponse(409, "conflict", "Ya existe.")


def test_validation_error_is_api_error_without_echo(
    api: tuple[TestClient, ApiContext],
) -> None:
    client, _ = api
    _probe(client.app)  # type: ignore[arg-type]
    r = client.post("/api/probe", json={"email": 12, "secreto": "filtrado-xyz"})
    assert r.status_code == 400
    assert r.json() == {"code": "bad_request", "message_es": "Datos no válidos."}
    assert "filtrado-xyz" not in r.text


def test_api_error_response_maps_status_and_body(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    _probe(client.app)  # type: ignore[arg-type]
    r = client.get("/api/conflict")
    assert r.status_code == 409
    assert r.json() == {"code": "conflict", "message_es": "Ya existe."}


def test_unhandled_exception_returns_generic_500(
    api: tuple[TestClient, ApiContext], monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = api
    from frances.api.routes import health as health_mod

    def boom(conn: object) -> int:
        raise RuntimeError("secreto-interno-xyz /data/state.db")

    monkeypatch.setattr(health_mod, "_q_schema_version", boom)
    r = client.get("/api/health")
    assert r.status_code == 500
    assert r.json() == {"code": "internal", "message_es": "Error interno del servidor."}
    assert "secreto-interno-xyz" not in r.text
    assert "/data/state.db" not in r.text


def test_api_responses_are_no_store(api: tuple[TestClient, ApiContext]) -> None:
    client, _ = api
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    assert client.get("/api/nope").headers["cache-control"] == "no-store"


def test_api_context_requires_data_dir() -> None:
    with pytest.raises(ConfigError):
        api_context_from_env({})


def test_serve_calls_uvicorn_with_single_worker(
    cli_runner: CliRunner, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr("uvicorn.run", lambda app, **kw: seen.update(kw))
    main_app = typer.Typer()

    @main_app.callback()
    def _root() -> None:
        """Raíz."""

    api_cli.register(main_app)
    r = cli_runner.invoke(
        main_app,
        ["serve", "--port", "8001"],
        env={"FRANCES_DATA_DIR": str(tmp_path)},
    )
    assert r.exit_code == 0, r.output
    assert seen["workers"] == 1
    assert seen["access_log"] is False
    assert seen["server_header"] is False
    assert seen["forwarded_allow_ips"] == "127.0.0.1"
    assert seen["port"] == 8001
    assert seen["host"] == "127.0.0.1"


def test_serve_is_registered_in_main_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "COMMAND_MODULES", ("frances.api.cli",))
    main_app = typer.Typer()
    cli.load_commands(main_app)
    assert "serve" in {c.name for c in main_app.registered_commands}


def test_api_context_uses_resolve_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from frances.config import resolve_data_dir as real_resolve

    seen: list[Path] = []

    def spy(env: Mapping[str, str], default: Path) -> Path:
        seen.append(default)
        return real_resolve(env, default)

    monkeypatch.setattr(app_mod, "resolve_data_dir", spy)
    ctx = api_context_from_env({"FRANCES_DATA_DIR": str(tmp_path)})
    assert seen, "api_context_from_env debe resolver el directorio con resolve_data_dir"
    assert ctx.paths.root == tmp_path
    assert ctx.db_path.exists()


def test_api_context_without_data_dir_env_raises_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        api_context_from_env({"FRANCES_STATE_DB": str(tmp_path / "x.db")})
