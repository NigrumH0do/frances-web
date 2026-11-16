"""App FastAPI base: registro de routers, contexto del proceso y ``create_app``."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from importlib import import_module
from pathlib import Path

from fastapi import APIRouter, FastAPI

from frances.api.errors import install_error_handlers
from frances.config import (
    Settings,
    load_settings,
    process_env,
    resolve_data_dir,
    resolve_state_db,
)
from frances.db.store import Store
from frances.errors import ConfigError
from frances.paths import DataPaths
from frances.timeutil import now_utc

#: Orden fijo de los routers (plan maestro v2, R-32). Un módulo que aún no existe se salta.
ROUTER_MODULES: tuple[str, ...] = (
    "frances.api.routes.health",
    "frances.api.routes.auth",
    "frances.api.routes.admin_users",
    "frances.api.routes.content",
    "frances.api.routes.cards",
    "frances.api.routes.speech",
    "frances.api.routes.admin_pipeline",
    "frances.api.routes.review",
    "frances.api.routes.prefs",
    "frances.api.routes.study",
    "frances.api.routes.chat",
    "frances.api.routes.search",
    "frances.api.routes.manage_cards",
    "frances.api.routes.manage_audio",
    "frances.api.routes.manage_topics",
    "frances.api.routes.practice",
)


@dataclass(frozen=True)
class ApiContext:
    settings: Settings
    paths: DataPaths
    db_path: Path
    env: Mapping[str, str]
    now: Callable[[], datetime] = now_utc


#: Centinela: ``resolve_data_dir`` devuelve este mismo objeto cuando la variable no está.
_NO_DATA_DIR = Path("")


def api_context_from_env(env: Mapping[str, str] | None = None) -> ApiContext:
    """Arma el contexto desde el entorno (``None`` → ``process_env()``) y migra la base una vez.

    El entorno se toma igual que ``frances.stage.make_context``. Falta ``FRANCES_DATA_DIR``
    → ``ConfigError``.
    """
    source: dict[str, str] = process_env() if env is None else dict(env)
    data_dir = resolve_data_dir(source, _NO_DATA_DIR)
    if data_dir is _NO_DATA_DIR:
        raise ConfigError("falta la variable FRANCES_DATA_DIR")
    paths = DataPaths(data_dir)
    settings = load_settings(paths.config, source)
    db_path = resolve_state_db(paths, source)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    Store.open(db_path).close()
    return ApiContext(settings=settings, paths=paths, db_path=db_path, env=source)


def include_routers(app: FastAPI) -> list[str]:
    """Incluye cada módulo de ``ROUTER_MODULES`` que exista; devuelve los incluidos.

    Solo se salta el módulo ausente (``ModuleNotFoundError.name`` exacto o padre ausente);
    cualquier otra falla revienta.
    """
    included: list[str] = []
    for name in ROUTER_MODULES:
        try:
            module = import_module(name)
        except ModuleNotFoundError as exc:
            if exc.name is not None and (name == exc.name or name.startswith(exc.name + ".")):
                continue
            raise
        router: APIRouter = module.router
        app.include_router(router)
        included.append(name)
    return included


def create_app(ctx_factory: Callable[[], ApiContext]) -> FastAPI:
    """App sin documentación pública; el contexto se arma una vez por proceso."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.ctx = ctx_factory()
    install_error_handlers(app)
    include_routers(app)
    return app
