"""Texto de PowerPoint y Word con OCR de imágenes cuando no hay texto (EXT-06, ADR-019)."""

import io
import zipfile
from pathlib import Path

import pytest
from docx import Document
from PIL import Image
from pptx import Presentation
from pptx.util import Inches

from frances.extract import office
from frances.extract.office import (
    PPTX_MIME,
    extract_docx,
    extract_legacy_office,
    extract_pptx,
    is_office_mime,
)


def _png() -> io.BytesIO:
    buf = io.BytesIO()
    Image.new("RGB", (60, 30), "white").save(buf, format="PNG")
    buf.seek(0)
    return buf


class _Ocr:
    def __init__(self, text: str = "Texte de l'image") -> None:
        self.text = text
        self.calls = 0

    def __call__(self, img: Image.Image) -> str:
        self.calls += 1
        return self.text


def _pptx(path: Path, *, picture_only_slide: bool = False) -> Path:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Les métiers"
    slide.placeholders[1].text = "Le médecin soigne les malades.\nLe boulanger fait du pain."
    table = slide.shapes.add_table(1, 2, Inches(1), Inches(5), Inches(4), Inches(1)).table
    table.cell(0, 0).text = "infirmière"
    table.cell(0, 1).text = "enfermera"
    slide.notes_slide.notes_text_frame.text = "Répéter à voix haute."
    if picture_only_slide:
        blank = prs.slides.add_slide(prs.slide_layouts[6])
        blank.shapes.add_picture(_png(), Inches(1), Inches(1))
    prs.save(path)
    return path


def test_pptx_reads_titles_bodies_tables_and_notes(tmp_path: Path) -> None:
    ocr = _Ocr()
    pages = extract_pptx(_pptx(tmp_path / "a.pptx"), ocr)
    assert [p.page for p in pages] == [1]
    text = pages[0].text
    for expected in ("Les métiers", "Le médecin soigne", "infirmière", "Répéter à voix haute."):
        assert expected in text
    assert pages[0].method == "office_text" and ocr.calls == 0


def test_pptx_slide_with_only_pictures_is_ocrd(tmp_path: Path) -> None:
    ocr = _Ocr("Bonjour à tous")
    pages = extract_pptx(_pptx(tmp_path / "b.pptx", picture_only_slide=True), ocr)
    assert [(p.page, p.method) for p in pages] == [(1, "office_text"), (2, "office_ocr")]
    assert pages[1].text == "Bonjour à tous" and ocr.calls == 1


def test_ppsx_slideshow_opens_like_pptx(tmp_path: Path) -> None:
    src = _pptx(tmp_path / "c.pptx")
    ppsx = tmp_path / "c.ppsx"
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(ppsx, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "[Content_Types].xml":
                data = data.replace(b"presentation.main+xml", b"slideshow.main+xml")
            zout.writestr(info, data)
    pages = extract_pptx(ppsx, _Ocr())
    assert "Les métiers" in pages[0].text


def test_docx_reads_paragraphs_and_tables(tmp_path: Path) -> None:
    doc = Document()
    doc.add_heading("Leçon 3", level=1)
    doc.add_paragraph("Nous allons au marché le samedi.")
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "la pomme"
    table.cell(0, 1).text = "la manzana"
    path = tmp_path / "d.docx"
    doc.save(path)
    ocr = _Ocr()
    pages = extract_docx(path, ocr)
    text = "\n".join(p.text for p in pages)
    assert "Leçon 3" in text and "marché" in text and "la pomme" in text
    assert {p.method for p in pages} == {"office_text"} and ocr.calls == 0


def test_docx_made_of_scanned_images_is_ocrd(tmp_path: Path) -> None:
    doc = Document()
    doc.add_picture(_png())
    path = tmp_path / "e.docx"
    doc.save(path)
    ocr = _Ocr("Exercice 1 : complétez")
    pages = extract_docx(path, ocr)
    assert [p.method for p in pages] == ["office_ocr"]
    assert pages[0].text == "Exercice 1 : complétez"


def test_legacy_office_without_libreoffice_is_unsupported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(office.shutil, "which", lambda _name: None)
    path = tmp_path / "f.ppt"
    path.write_bytes(b"\xd0\xcf\x11\xe0")
    assert extract_legacy_office(path, _Ocr(), pdf=lambda *_a, **_k: []) is None


def test_office_mimes() -> None:
    assert is_office_mime(PPTX_MIME)
    assert is_office_mime("application/vnd.ms-powerpoint")
    assert is_office_mime("application/msword")
    assert not is_office_mime("application/pdf")
