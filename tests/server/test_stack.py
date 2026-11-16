"""Dependencias del servidor y chequeo de wheels aarch64 (Task SRV-01)."""

import subprocess
import sys
import tomllib
from pathlib import Path


def test_server_stack_pinned() -> None:
    deps = tomllib.loads(Path("pyproject.toml").read_text())["project"]["dependencies"]
    for pin in (
        "fastapi==0.162.0",
        "uvicorn==0.54.0",
        "argon2-cffi==25.1.0",
        "argon2-cffi-bindings==26.1.0",
    ):
        assert pin in deps
    assert not any("[standard]" in d for d in deps)


def test_server_stack_imports() -> None:
    from argon2 import PasswordHasher, Type
    from fastapi.sse import EventSourceResponse  # noqa: F401

    assert PasswordHasher().type is Type.ID


def test_wheel_checker_flags_missing_arm_wheel(tmp_path: Path) -> None:
    lock = tmp_path / "uv.lock"
    lock.write_text(
        'version = 1\n[[package]]\nname = "x"\nversion = "1"\n'
        'sdist = { url = "https://e/x-1.tar.gz" }\n'
        'wheels = [{ url = "https://e/x-1-cp312-cp312-manylinux_2_17_x86_64.whl" }]\n'
    )
    r = subprocess.run(
        [sys.executable, "scripts/check_aarch64_wheels.py", "--lock", str(lock)],
        capture_output=True,
        text=True,
    )
    assert r.returncode == 1 and "x==1" in r.stdout


def test_wheel_checker_passes_on_repo_lock() -> None:
    assert subprocess.run([sys.executable, "scripts/check_aarch64_wheels.py"]).returncode == 0


def test_adr_lists_every_new_dependency() -> None:
    adr = Path("docs/decisions/ADR-007-server-stack.md").read_text()
    assert all(
        p in adr for p in ("fastapi", "uvicorn", "argon2-cffi", "argon2-cffi-bindings", "MIT-0")
    )
