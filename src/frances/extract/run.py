"""Etapa extract: texto etiquetado por idioma desde blobs (EXT-04)."""

import json
from dataclasses import asdict
from pathlib import Path

import typer

from frances.cli import DataOpt, exit_with
from frances.db.usage import record_run
from frances.errors import ConfigError
from frances.extract import ocr
from frances.extract.coverage import GROUPS, coverage
from frances.extract.lang import merge_short_paragraphs, split_blocks
from frances.extract.ocr import ocr_file, ocr_image
from frances.extract.office import (
    DOCX_MIME,
    LEGACY_MIMES,
    PRESENTATION_MIMES,
    extract_docx,
    extract_legacy_office,
    extract_pptx,
)
from frances.extract.pdf import PageText, extract_pdf
from frances.extract.repo import ExtractCandidate, insert_extraction, list_extract_candidates
from frances.fetch.blobs import BlobStore
from frances.log import get_logger, redact
from frances.models import Extraction, ExtractMethod, Lang, TextBlock
from frances.stage import StageContext, StageReport, make_context
from frances.timeutil import format_ts

logger = get_logger(__name__)

#: v2 (ADR-019): RapidOCR + Tesseract con francés, Office, tipos sin mime y párrafos
#: cortos unidos. La v1 leía
#: sin el modelo francés de Tesseract, por eso se vuelve a extraer todo.
EXTRACTOR_VERSION = "2"

_GENERIC_MIMES = frozenset({"", "application/octet-stream", "binary/octet-stream"})


def _read_text(path: Path) -> str:
    """UTF-8 tolerante: los bytes inválidos se sustituyen por U+FFFD."""
    return path.read_text(encoding="utf-8", errors="replace")


def _sniff(path: Path) -> str:
    """Tipo por contenido cuando el mime falta o es genérico."""
    with path.open("rb") as handle:
        head = handle.read(8)
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"PK"):
        import zipfile

        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
        except zipfile.BadZipFile:
            return ""
        if "ppt/presentation.xml" in names:
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if "word/document.xml" in names:
            return DOCX_MIME
        return ""
    if head.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF")):
        return "image/*"
    return ""


def _blocks_from_pages(pages: list[PageText], source: str) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    for page in pages:
        blocks.extend(split_blocks(merge_short_paragraphs(page.text), source, page=page.page))
    return blocks


def _paged(
    pages: list[PageText], source: str, ocr_method: ExtractMethod, text_method: ExtractMethod
) -> tuple[ExtractMethod, list[TextBlock]]:
    ocr_used = any(page.method in ("pdf_ocr", "office_ocr") for page in pages)
    return (ocr_method if ocr_used else text_method), _blocks_from_pages(pages, source)


def _dispatch(cand: ExtractCandidate, path: Path) -> tuple[ExtractMethod, list[TextBlock]] | None:
    """Método y bloques según el mime; `None` si el mime no tiene soporte."""
    if cand.native:
        text = _read_text(path)
        return "export_text", split_blocks(text, cand.attachment_id)
    mime = cand.mime_type
    if mime in _GENERIC_MIMES:
        mime = _sniff(path)
    if mime == "application/pdf":
        pages = extract_pdf(path, ocr=ocr_image)
        return _paged(pages, cand.attachment_id, "pdf_ocr", "pdf_text")
    if mime in PRESENTATION_MIMES:
        return _paged(
            extract_pptx(path, ocr_image), cand.attachment_id, "office_ocr", "office_text"
        )
    if mime == DOCX_MIME:
        return _paged(
            extract_docx(path, ocr_image), cand.attachment_id, "office_ocr", "office_text"
        )
    if mime in LEGACY_MIMES:
        legacy = extract_legacy_office(path, ocr_image, pdf=extract_pdf)
        if legacy is None:
            return None
        return _paged(legacy, cand.attachment_id, "office_ocr", "office_text")
    if mime.startswith("image/"):
        text = merge_short_paragraphs(ocr_file(path))
        return "image_ocr", split_blocks(text, cand.attachment_id)
    if mime.startswith("text/"):
        text = _read_text(path)
        return "plain", split_blocks(text, cand.attachment_id)
    return None


def _row_lang(blocks: list[TextBlock]) -> Lang:
    """Idioma con más caracteres entre los bloques; `unknown` si no hay bloques."""
    totals: dict[Lang, int] = {}
    for block in blocks:
        totals[block.lang] = totals.get(block.lang, 0) + len(block.text)
    if not totals:
        return "unknown"
    return max(totals, key=lambda lang: totals[lang])


def _process(
    ctx: StageContext, blobs: BlobStore, cand: ExtractCandidate, report: StageReport
) -> None:
    dispatch = _dispatch(cand, blobs.path(cand.sha256))
    if dispatch is None:
        report.counts["extract.skipped_unsupported"] += 1
        return
    method, blocks = dispatch
    extraction = Extraction(
        blob_sha256=cand.sha256,
        extractor_version=EXTRACTOR_VERSION,
        method=method,
        blocks=blocks,
        char_count=sum(len(block.text) for block in blocks),
    )
    out_path = ctx.paths.extraction_path(cand.sha256, EXTRACTOR_VERSION)
    payload = json.dumps(extraction.model_dump(), sort_keys=True, indent=0, ensure_ascii=False)
    out_path.write_text(payload, encoding="utf-8")
    relative = str(out_path.relative_to(ctx.paths.root))
    with ctx.store.tx() as conn:
        insert_extraction(conn, extraction, _row_lang(blocks), relative, format_ts(ctx.now()))
    report.counts["extract.extracted"] += 1


def run_extract(ctx: StageContext) -> StageReport:
    """Extrae el texto de cada blob pendiente; idempotente por (blob, versión)."""
    report = StageReport(stage="extract", status="ok")
    report.counts = {
        "extract.extracted": 0,
        "extract.skipped_unsupported": 0,
        "extract.error": 0,
        "extract.ocr_rapidocr": 0,
        "extract.ocr_tesseract": 0,
    }
    started_at = format_ts(ctx.now())
    blobs = BlobStore(ctx.paths)
    ocr.reset_engine_uses()
    with ctx.store.tx() as conn:
        candidates = list_extract_candidates(conn, EXTRACTOR_VERSION)
    for cand in candidates:
        try:
            _process(ctx, blobs, cand, report)
        except Exception as exc:
            report.counts["extract.error"] += 1
            report.errors.append(f"{cand.sha256[:12]}: {type(exc).__name__}")
            logger.warning("extract %s: %s", cand.sha256[:12], redact(str(exc), ctx.env))
    report.counts["extract.ocr_rapidocr"] = ocr.ENGINE_USES["rapidocr"]
    report.counts["extract.ocr_tesseract"] = ocr.ENGINE_USES["tesseract"]
    if report.errors:
        report.status = "partial"
    with ctx.store.tx() as conn:
        record_run(conn, report, started_at, format_ts(ctx.now()))
    return report


def _coverage_cmd(data: Path, as_json: bool, show_all: bool) -> None:
    ctx = make_context(data)
    try:
        rep = coverage(ctx.store.conn, EXTRACTOR_VERSION)
    finally:
        ctx.store.close()
    if as_json:
        payload = {
            "extractor_version": EXTRACTOR_VERSION,
            "counts": rep.counts,
            "by_method": rep.by_method,
            "files_ok_share": round(rep.files_ok_share, 4),
            "problems": [asdict(row) for row in rep.problems],
        }
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=1))
        return
    typer.echo(f"Extractor v{EXTRACTOR_VERSION} · OCR: {', '.join(_ocr_status())}")
    for group in GROUPS:
        typer.echo(f"  {group:14} {rep.counts[group]:5}")
    typer.echo(f"  {'archivos leídos':14} {rep.files_ok_share:6.1%}")
    typer.echo("Por método: " + ", ".join(f"{k}={v}" for k, v in sorted(rep.by_method.items())))
    shown = rep.problems if show_all else [p for p in rep.problems if p.reason != "sin_soporte"]
    for row in shown:
        typer.echo(
            f"  [{row.reason}] {row.attachment_id} · {row.title} · {row.detail or row.mime_type}"
        )


def _ocr_status() -> list[str]:
    try:
        return ocr.check_ocr()
    except ConfigError as exc:
        return [f"ninguno ({exc})"]


def register(app: typer.Typer) -> None:
    """Registra `frances extract` y `frances coverage` (R-05)."""

    @app.command()
    def extract(data: DataOpt = Path(".")) -> None:
        """Extrae texto etiquetado por idioma de los blobs descargados."""
        ctx = make_context(data)
        try:
            exit_with(lambda: run_extract(ctx))
        finally:
            ctx.store.close()

    @app.command("coverage")
    def coverage_cmd(
        data: DataOpt = Path("."),
        as_json: bool = typer.Option(False, "--json", help="Salida JSON"),
        show_all: bool = typer.Option(False, "--all", help="Incluye audio, video y otros"),
    ) -> None:
        """Muestra qué adjuntos del curso tienen texto y cuáles no."""
        _coverage_cmd(data, as_json, show_all)
