"""Registro de handlers de la cola de trabajos (SRV-06)."""

import sys
import types

import pytest

from frances.jobs import registry
from frances.jobs.registry import HANDLER_MODULES, HandlerRegistry, load_handlers


def test_handler_modules_contract() -> None:
    assert HANDLER_MODULES == (
        "frances.jobs.pipeline",
        "frances.study.jobs",
        "frances.manage.jobs",
    )


def test_registry_rejects_duplicate_kind() -> None:
    reg = HandlerRegistry()
    reg.add("auth.check", lambda ctx, job: None)
    with pytest.raises(ValueError):
        reg.add("auth.check", lambda ctx, job: None)


def test_registry_get_and_kinds() -> None:
    reg = HandlerRegistry()
    assert reg.get("auth.check") is None
    assert reg.kinds() == frozenset()

    def handler(ctx: object, job: object) -> None:
        return None

    reg.add("auth.check", handler)
    assert reg.get("auth.check") is handler
    assert reg.kinds() == frozenset({"auth.check"})


def test_load_handlers_skips_only_missing_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    present = types.ModuleType("frances_test_handlers_present")

    def register_handlers(reg: HandlerRegistry) -> None:
        calls.append("present")
        reg.add("auth.check", lambda ctx, job: None)

    present.register_handlers = register_handlers  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "frances_test_handlers_present", present)
    monkeypatch.setattr(
        registry,
        "HANDLER_MODULES",
        ("frances_test_handlers_absent", "frances_test_handlers_present"),
    )

    reg = HandlerRegistry()
    load_handlers(reg)

    assert calls == ["present"]
    assert reg.kinds() == frozenset({"auth.check"})
