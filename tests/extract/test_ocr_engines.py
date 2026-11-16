"""OCR con RapidOCR como motor principal y Tesseract de respaldo (EXT-05, ADR-019)."""

from collections.abc import Sequence

import numpy as np
import pytest
from PIL import Image

from frances.errors import ConfigError
from frances.extract import ocr
from frances.extract.ocr import (
    OcrUnavailable,
    TesseractEngine,
    lines_from_boxes,
    ocr_image,
    set_engines,
)


def _box(x: float, y: float, w: float = 100, h: float = 20) -> np.ndarray:
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)


class _Fake:
    def __init__(self, name: str, text: str = "", raises: Exception | None = None) -> None:
        self.name = name
        self.text = text
        self.raises = raises
        self.calls = 0

    def read(self, img: Image.Image) -> str:
        self.calls += 1
        if self.raises is not None:
            raise self.raises
        return self.text


@pytest.fixture(autouse=True)
def _reset_engines() -> None:
    yield
    set_engines(None)


IMG = Image.new("RGB", (200, 80), "white")


def test_lines_follow_reading_order_and_split_paragraphs() -> None:
    boxes: Sequence[np.ndarray] = [
        _box(220, 102),  # misma línea que «Bonjour», a la derecha
        _box(10, 300),  # párrafo nuevo: hueco grande
        _box(10, 100),
        _box(10, 130),
    ]
    texts = ["à tous", "Merci.", "Bonjour", "et bienvenue"]
    assert lines_from_boxes(boxes, texts) == "Bonjour à tous\net bienvenue\n\nMerci."


def test_lines_from_no_boxes_is_empty() -> None:
    assert lines_from_boxes([], []) == ""


def test_primary_engine_is_used_first() -> None:
    primary, fallback = _Fake("rapidocr", "Le médecin"), _Fake("tesseract", "otro")
    set_engines([primary, fallback])
    assert ocr_image(IMG) == "Le médecin"
    assert (primary.calls, fallback.calls) == (1, 0)


def test_falls_back_when_primary_fails_or_reads_nothing() -> None:
    broken, fallback = _Fake("rapidocr", raises=RuntimeError("onnx")), _Fake("tesseract", "hola")
    set_engines([broken, fallback])
    assert ocr_image(IMG) == "hola"

    empty, fallback2 = _Fake("rapidocr", "  \n"), _Fake("tesseract", "Ça va")
    set_engines([empty, fallback2])
    assert ocr_image(IMG) == "Ça va"


def test_empty_image_is_empty_text_not_an_error() -> None:
    set_engines([_Fake("rapidocr", ""), _Fake("tesseract", "")])
    assert ocr_image(IMG) == ""


def test_every_engine_unavailable_raises() -> None:
    set_engines(
        [
            _Fake("rapidocr", raises=OcrUnavailable("sin modelos")),
            _Fake("tesseract", raises=OcrUnavailable("sin fra")),
        ]
    )
    with pytest.raises(OcrUnavailable):
        ocr_image(IMG)


def test_tesseract_refuses_to_run_without_french(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin `fra` Tesseract lee con el modelo español y destroza las tildes: no se usa."""
    monkeypatch.setattr(ocr.pytesseract, "get_languages", lambda config="": ["eng", "spa", "osd"])
    with pytest.raises(OcrUnavailable, match="fra"):
        TesseractEngine().read(IMG)


def test_check_ocr_reports_missing_french(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ocr.pytesseract, "get_languages", lambda config="": ["eng", "spa"])
    monkeypatch.setattr(ocr, "rapidocr_available", lambda: False)
    with pytest.raises(ConfigError, match="tesseract-ocr-fra"):
        ocr.check_ocr()


def test_check_ocr_passes_with_rapidocr_even_without_french(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ocr.pytesseract, "get_languages", lambda config="": ["eng"])
    monkeypatch.setattr(ocr, "rapidocr_available", lambda: True)
    assert ocr.check_ocr() == ["rapidocr"]


def test_tesseract_language_check_runs_once(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def langs(config: str = "") -> list[str]:
        calls.append(1)
        return ["spa"]

    monkeypatch.setattr(ocr.pytesseract, "get_languages", langs)
    engine = TesseractEngine()
    for _ in range(3):
        with pytest.raises(OcrUnavailable):
            engine.read(IMG)
    assert len(calls) == 1


def test_unavailable_engine_is_logged_once(caplog: pytest.LogCaptureFixture) -> None:
    set_engines([_Fake("rapidocr", ""), _Fake("tesseract", raises=OcrUnavailable("sin fra"))])
    for _ in range(5):
        ocr_image(IMG)
    assert caplog.text.count("tesseract no disponible") == 1
