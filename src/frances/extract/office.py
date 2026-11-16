"""Texto de PowerPoint y Word subidos a Drive (EXT-06, ADR-019).

- ``.pptx``/``.ppsx``/``.pptm``: títulos, cuadros de texto, tablas, grupos y notas
  del orador, una «página» por diapositiva. Una diapositiva sin texto útil pero con
  imágenes se lee con OCR (diapositivas que son una foto o un escaneo).
- ``.docx``: párrafos y tablas en orden. Si el documento casi no tiene texto y sí
  imágenes (un escaneo pegado en Word), se leen las imágenes con OCR.
- ``.ppt``/``.doc`` antiguos: se convierten a PDF con LibreOffice si está
  instalado (binario aparte, como ffmpeg) y se leen como PDF.
"""

import io
import shutil
import subprocess
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from PIL import Image

from frances.extract.pdf import PageText

PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PPSX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.slideshow"
PPTM_MIME = "application/vnd.ms-powerpoint.presentation.macroEnabled.12"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
LEGACY_MIMES = frozenset({"application/vnd.ms-powerpoint", "application/msword"})
PRESENTATION_MIMES = frozenset({PPTX_MIME, PPSX_MIME, PPTM_MIME})

#: Menos letras útiles que esto en una diapositiva → se leen sus imágenes con OCR.
MIN_SLIDE_CHARS = 40
#: Menos letras útiles que esto en todo un .docx → se leen sus imágenes con OCR.
MIN_DOCX_CHARS = 200
#: Tope de espera de LibreOffice por archivo.
SOFFICE_TIMEOUT_S = 180

Ocr = Callable[[Image.Image], str]
PdfReader = Callable[..., list[PageText]]

_MAIN_TYPES = (b"slideshow.main+xml", b"presentation.macroEnabled.main+xml")


def is_office_mime(mime: str) -> bool:
    return mime in PRESENTATION_MIMES or mime == DOCX_MIME or mime in LEGACY_MIMES


def _useful(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def _open_presentation(path: Path) -> Any:
    """python-pptx solo abre «presentation»: un .ppsx/.pptm se reetiqueta en memoria."""
    from pptx import Presentation

    with zipfile.ZipFile(path) as zin:
        types = zin.read("[Content_Types].xml")
        if not any(main in types for main in _MAIN_TYPES):
            return Presentation(str(path))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                if info.filename == "[Content_Types].xml":
                    for main in _MAIN_TYPES:
                        data = data.replace(main, b"presentation.main+xml")
                zout.writestr(info, data)
    buf.seek(0)
    return Presentation(buf)


def _shape_texts(shapes: Any) -> Iterator[str]:
    for shape in shapes:
        if getattr(shape, "shape_type", None) == 6 and hasattr(shape, "shapes"):  # grupo
            yield from _shape_texts(shape.shapes)
            continue
        if getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip():
            yield shape.text_frame.text.strip()
        if getattr(shape, "has_table", False):
            for row in shape.table.rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    yield " — ".join(cells)


def _shape_images(shapes: Any) -> Iterator[bytes]:
    for shape in shapes:
        if getattr(shape, "shape_type", None) == 6 and hasattr(shape, "shapes"):
            yield from _shape_images(shape.shapes)
            continue
        image = getattr(shape, "image", None) if shape.shape_type == 13 else None
        if image is not None:
            yield image.blob


def _ocr_blobs(blobs: Iterator[bytes], ocr: Ocr) -> str:
    texts: list[str] = []
    for blob in blobs:
        try:
            with Image.open(io.BytesIO(blob)) as img:
                img.load()
                text = ocr(img.convert("RGB")).strip()
        except (OSError, ValueError):
            continue  # formato de imagen que PIL no abre (EMF/WMF): no aporta texto
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def extract_pptx(path: Path, ocr: Ocr) -> list[PageText]:
    """Una ``PageText`` por diapositiva con texto (o con texto leído de sus imágenes)."""
    prs = _open_presentation(path)
    pages: list[PageText] = []
    for number, slide in enumerate(prs.slides, start=1):
        parts = list(_shape_texts(slide.shapes))
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame
            if notes is not None and notes.text.strip():
                parts.append(notes.text.strip())
        text = "\n\n".join(parts)
        if _useful(text) >= MIN_SLIDE_CHARS:
            pages.append(PageText(page=number, text=text, method="office_text"))
            continue
        ocr_text = _ocr_blobs(_shape_images(slide.shapes), ocr)
        if ocr_text:
            joined = "\n\n".join(part for part in (text, ocr_text) if part)
            pages.append(PageText(page=number, text=joined, method="office_ocr"))
        elif text:
            pages.append(PageText(page=number, text=text, method="office_text"))
    return pages


def _docx_blocks(doc: Any) -> Iterator[str]:
    """Párrafos y filas de tabla en el orden del documento."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = Paragraph(child, doc).text.strip()
            if text:
                yield text
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    yield " — ".join(dict.fromkeys(cells))


def extract_docx(path: Path, ocr: Ocr) -> list[PageText]:
    """El documento entero como una página; OCR de sus imágenes si casi no tiene texto."""
    from docx import Document

    doc = Document(str(path))
    text = "\n\n".join(_docx_blocks(doc))
    if _useful(text) >= MIN_DOCX_CHARS:
        return [PageText(page=1, text=text, method="office_text")]
    images = (
        rel.target_part.blob
        for rel in doc.part.rels.values()
        if "image" in rel.reltype and not rel.is_external
    )
    ocr_text = _ocr_blobs(images, ocr)
    if ocr_text:
        joined = "\n\n".join(part for part in (text, ocr_text) if part)
        return [PageText(page=1, text=joined, method="office_ocr")]
    return [PageText(page=1, text=text, method="office_text")] if text else []


def extract_legacy_office(path: Path, ocr: Ocr, pdf: PdfReader) -> list[PageText] | None:
    """``.ppt``/``.doc`` vía LibreOffice → PDF; ``None`` si LibreOffice no está."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice is None:
        return None
    with tempfile.TemporaryDirectory(prefix="frances-office-") as tmp:
        src = Path(tmp) / f"input{path.suffix or '.bin'}"
        shutil.copyfile(path, src)
        subprocess.run(
            [
                soffice,
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{tmp}/profile",
                "--convert-to",
                "pdf",
                "--outdir",
                tmp,
                str(src),
            ],
            check=True,
            capture_output=True,
            timeout=SOFFICE_TIMEOUT_S,
        )
        out = Path(tmp) / "input.pdf"
        if not out.is_file():
            return None
        pages = pdf(out, ocr=ocr)
    return [
        PageText(
            page=page.page,
            text=page.text,
            method="office_ocr" if page.method == "pdf_ocr" else "office_text",
        )
        for page in pages
    ]
