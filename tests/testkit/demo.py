"""Base sintética del demo y sus blobs (antes en ``frances.bundle.demo``; CHG-21).

El runtime FRB1 se retiró, pero ``tests/fixtures/demo_state.sql`` y
``tests/fixtures/demo_audio/`` siguen siendo la base del demo v2 (UI-20) y de
los tests de API/DB. Este helper solo lee fixtures sintéticos: no abre red.
"""

import hashlib
from collections.abc import Mapping
from pathlib import Path

FIXTURES: Path = Path(__file__).resolve().parents[1] / "fixtures"


def blob_sources() -> dict[str, Path]:
    """Marcador → archivo: dos primeros PDF y primera imagen (orden alfabético)."""
    pdfs = sorted((FIXTURES / "pdf").glob("*.pdf"), key=lambda path: path.name)
    images = sorted(
        (path for path in (FIXTURES / "images").iterdir() if path.is_file()),
        key=lambda path: path.name,
    )
    return {"pdf1": pdfs[0], "pdf2": pdfs[1], "img1": images[0]}


def demo_sql(blobs: Mapping[str, Path]) -> str:
    """SQL del demo con ``{{marcador}}`` y ``{{marcador_size}}`` sustituidos."""
    text = (FIXTURES / "demo_state.sql").read_text(encoding="utf-8")
    for name, path in blobs.items():
        data = path.read_bytes()
        text = text.replace("{{" + name + "_size}}", str(len(data)))
        text = text.replace("{{" + name + "}}", hashlib.sha256(data).hexdigest())
    return text
