"""Imagen multi-arch y contexto de build (Task SRV-13)."""

import re
from pathlib import Path


def test_base_images_pinned_by_digest() -> None:
    froms = re.findall(
        r"^FROM\s+(?:--platform=\S+\s+)?(\S+)", Path("infra/Dockerfile").read_text(), re.M
    )
    assert all(re.search(r"@sha256:[0-9a-f]{64}$", f) for f in froms) and len(froms) == 3
    assert any(f.startswith("python:3.12-slim") for f in froms)
    assert any(f.startswith("caddy:2.11.7") for f in froms)


def test_web_build_runs_on_build_platform() -> None:
    assert "FROM --platform=$BUILDPLATFORM node:22" in Path("infra/Dockerfile").read_text()


def test_dockerignore_excludes_data_and_secrets() -> None:
    ig = Path(".dockerignore").read_text().split()
    assert {".env*", "data/", ".git", "**/node_modules"} <= set(ig)
