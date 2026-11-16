"""Política de autorización: toda ruta `/api/*` exige sesión salvo `PUBLIC_ROUTES` (R-33).

Lee cada `APIRouter` de `ROUTER_MODULES` (no los internos de FastAPI): las dependencias de
router y de ruta son las que cuentan. Un módulo que aún no existe se salta.
"""

from collections.abc import Iterator
from importlib import import_module

from fastapi import APIRouter
from fastapi.routing import APIRoute

from frances.api.app import ROUTER_MODULES
from frances.api.security import PUBLIC_ROUTES, require_admin, require_user


def _routers() -> list[APIRouter]:
    found: list[APIRouter] = []
    for name in ROUTER_MODULES:
        try:
            module = import_module(name)
        except ModuleNotFoundError as exc:
            if exc.name is not None and (name == exc.name or name.startswith(exc.name + ".")):
                continue
            raise
        found.append(module.router)
    return found


def _api_endpoints() -> Iterator[tuple[str, str, set[object]]]:
    """(método, ruta, dependencias efectivas): las del router más las de la ruta."""
    for router in _routers():
        router_deps: set[object] = {dep.dependency for dep in router.dependencies}
        for route in router.routes:
            if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
                continue
            route_deps = {dep.call for dep in route.dependant.dependencies}
            for method in route.methods:
                yield method, route.path, router_deps | route_deps


def test_every_route_requires_auth_except_public_routes() -> None:
    seen = 0
    for method, path, deps in _api_endpoints():
        seen += 1
        if (method, path) in PUBLIC_ROUTES:
            assert require_user not in deps, (method, path)
            continue
        assert require_user in deps or require_admin in deps, (method, path)
        if path.startswith("/api/admin/"):
            assert require_admin in deps, (method, path)
    assert seen > 0


def test_public_routes_are_registered() -> None:
    present = {(method, path) for method, path, _ in _api_endpoints()}
    assert present >= PUBLIC_ROUTES
