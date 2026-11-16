"""Registro de handlers de la cola: un `kind` → una función (plan maestro v2, SRV-06).

Cada módulo de `HANDLER_MODULES` expone `register_handlers(reg)`. Un módulo que todavía
no existe se salta (igual que `load_commands` en la CLI); cualquier otro error revienta.
"""

import importlib
from collections.abc import Callable, Mapping
from types import ModuleType
from typing import Any

from frances.db.store import Store  # noqa: F401  (rompe el ciclo de import stage↔db.usage)
from frances.jobs.queue import Job
from frances.models.jobs import JobKind
from frances.stage import StageContext

JobHandler = Callable[[StageContext, Job], Mapping[str, Any] | None]

HANDLER_MODULES: tuple[str, ...] = (
    "frances.jobs.pipeline",
    "frances.study.jobs",
    "frances.manage.jobs",
)


class HandlerRegistry:
    """Mapa `kind → handler`. Un `kind` admite un solo handler."""

    def __init__(self) -> None:
        self._handlers: dict[JobKind, JobHandler] = {}

    def add(self, kind: JobKind, handler: JobHandler) -> None:
        """Registra el handler de `kind`. `ValueError` si ya tiene uno."""
        if kind in self._handlers:
            raise ValueError(f"el kind {kind!r} ya tiene handler")
        self._handlers[kind] = handler

    def get(self, kind: JobKind) -> JobHandler | None:
        return self._handlers.get(kind)

    def kinds(self) -> frozenset[JobKind]:
        return frozenset(self._handlers)


def import_optional(name: str) -> ModuleType | None:
    """Importa `name`; `None` si el módulo (o su paquete padre) no existe. Otro error revienta."""
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        if exc.name is not None and (name == exc.name or name.startswith(exc.name + ".")):
            return None
        raise


def load_handlers(reg: HandlerRegistry) -> None:
    """Llama a `register_handlers(reg)` de cada módulo de `HANDLER_MODULES` que exista."""
    for name in HANDLER_MODULES:
        module = import_optional(name)
        if module is not None:
            module.register_handlers(reg)
