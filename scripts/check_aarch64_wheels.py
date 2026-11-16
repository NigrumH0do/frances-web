#!/usr/bin/env python3
"""Verifica que cada paquete de uv.lock tenga wheel para linux aarch64 + CPython. [SRV-01]

Un paquete pasa si tiene un wheel `py3-none-any`/`py2.py3-none-any`, o uno
`manylinux*_aarch64` compatible con la versión de CPython pedida (`cpXY-cpXY`,
`cpXZ-abi3` con Z ≤ Y, o `py3-none`: binario que no usa la ABI de Python,
como ruff y pypdfium2). Los paquetes locales (el proyecto mismo:
`editable`, `virtual`, `directory`, `path`) se ignoran. Sale 0 si todos pasan; si no,
imprime `nombre==versión` de los que faltan y sale 1. Solo stdlib.
"""

import argparse
import re
import sys
import tomllib
from pathlib import Path
from typing import Any

DEFAULT_LOCK = Path("uv.lock")
CP_RE = re.compile(r"^cp3(\d+)$")


def wheel_tags(filename: str) -> tuple[set[str], set[str], set[str]] | None:
    """Devuelve (python, abi, plataforma) de un nombre de wheel, o None si no lo es."""
    name = filename.rsplit("/", 1)[-1].split("#", 1)[0].split("?", 1)[0]
    if not name.endswith(".whl"):
        return None
    parts = name[: -len(".whl")].split("-")
    if len(parts) < 5:
        return None
    py, abi, plat = parts[-3:]
    return set(py.split(".")), set(abi.split(".")), set(plat.split("."))


def wheel_ok(filename: str, minor: int) -> bool:
    tags = wheel_tags(filename)
    if tags is None:
        return False
    pys, abis, plats = tags
    if "any" in plats and "none" in abis and "py3" in pys:
        return True
    if not any(p.startswith("manylinux") and p.endswith("_aarch64") for p in plats):
        return False
    if "none" in abis and "py3" in pys:  # binario nativo que no depende de la ABI de CPython
        return True
    if f"cp3{minor}" in pys and f"cp3{minor}" in abis:
        return True
    if "abi3" in abis:
        for py in pys:
            m = CP_RE.match(py)
            if m and int(m.group(1)) <= minor:
                return True
    return False


LOCAL_SOURCES = ("editable", "virtual", "directory", "path")


def is_local(pkg: dict[str, Any]) -> bool:
    return any(k in pkg.get("source", {}) for k in LOCAL_SOURCES)


def missing_packages(lock: dict[str, Any], minor: int) -> list[str]:
    missing: list[str] = []
    for pkg in lock.get("package", []):
        if is_local(pkg):
            continue
        urls = [w.get("url") or w.get("filename") or "" for w in pkg.get("wheels", [])]
        if not any(wheel_ok(u, minor) for u in urls):
            missing.append(f"{pkg['name']}=={pkg.get('version', '?')}")
    return missing


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--python", default="3.12")
    args = parser.parse_args(argv)
    major, _, minor_s = args.python.partition(".")
    if major != "3" or not minor_s.isdigit():
        parser.error(f"--python debe ser 3.X, no {args.python!r}")
    lock = tomllib.loads(args.lock.read_text(encoding="utf-8"))
    missing = missing_packages(lock, int(minor_s))
    if missing:
        print(f"Sin wheel aarch64 para CPython {args.python}:")
        for m in missing:
            print(m)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
