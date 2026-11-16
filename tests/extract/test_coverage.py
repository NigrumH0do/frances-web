"""Informe de cobertura: qué adjuntos tienen texto y cuáles no, y por qué (EXT-07)."""

from pathlib import Path

import typer
from typer.testing import CliRunner

from frances.extract import run
from frances.extract.coverage import coverage
from tests.extract.test_run import ATT_COLUMNS, NOW, ctx_with_blobs, sha_of


def _add(ctx, key: str, kind: str, status: str, mime: str | None = None) -> None:  # type: ignore[no-untyped-def]
    with ctx.store.tx() as conn:
        conn.execute(
            f"{ATT_COLUMNS} VALUES (?, 'i1', ?, ?, 'T', 'https://x', ?, NULL, NULL, NULL, NULL,"
            " ?, NULL, 0, ?, NULL)",
            (f"att_{key}", kind, f"file_{key}", mime, status, NOW),
        )


def _extract(ctx, key: str, chars: int, method: str = "pdf_text") -> None:  # type: ignore[no-untyped-def]
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO extractions (blob_sha256, extractor_version, method, lang, char_count,"
            " path, created_at) VALUES (?, ?, ?, 'fr', ?, 'x', ?)",
            (sha_of(ctx, key), run.EXTRACTOR_VERSION, method, chars, NOW),
        )


def test_every_attachment_lands_in_one_bucket(tmp_path: Path) -> None:
    ctx = ctx_with_blobs(
        tmp_path,
        {"pdf": "application/pdf", "png": "image/png", "mp3": "audio/mpeg", "new": "text/plain"},
    )
    _extract(ctx, "pdf", 1200)
    _extract(ctx, "png", 3, method="image_ocr")
    _add(ctx, "big", "drive_file", "skipped_too_large")
    _add(ctx, "yt", "youtube", "reference")
    _add(ctx, "web", "link", "reference")

    rep = coverage(ctx.store.conn, run.EXTRACTOR_VERSION)

    assert rep.counts == {
        "con_texto": 1,
        "sin_texto": 1,
        "pendiente": 1,
        "sin_soporte": 1,
        "no_descargado": 1,
        "enlace": 2,
    }
    assert rep.by_method == {"pdf_text": 1, "image_ocr": 1}
    reasons = {row.attachment_id: row.reason for row in rep.problems}
    assert reasons == {
        "att_png": "sin_texto",
        "att_new": "pendiente",
        "att_mp3": "sin_soporte",
        "att_big": "no_descargado",
    }
    assert rep.files_total == 5
    assert rep.files_ok_share == 1 / 5


def test_old_extractor_version_counts_as_pending(tmp_path: Path) -> None:
    ctx = ctx_with_blobs(tmp_path, {"pdf": "application/pdf"})
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO extractions (blob_sha256, extractor_version, method, lang, char_count,"
            " path, created_at) VALUES (?, '1', 'pdf_text', 'fr', 500, 'x', ?)",
            (sha_of(ctx, "pdf"), NOW),
        )
    rep = coverage(ctx.store.conn, run.EXTRACTOR_VERSION)
    assert rep.counts["pendiente"] == 1 and rep.counts["con_texto"] == 0


def test_cli_prints_a_summary(tmp_path: Path) -> None:
    ctx = ctx_with_blobs(tmp_path, {"pdf": "application/pdf"})
    _extract(ctx, "pdf", 800)
    ctx.store.close()
    app = typer.Typer()
    run.register(app)
    result = CliRunner().invoke(app, ["coverage", "--data", str(tmp_path), "--json"])
    assert result.exit_code == 0, result.output
    assert '"con_texto": 1' in result.output
