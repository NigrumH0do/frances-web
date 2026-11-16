"""OCR de imágenes en francés y español (EXT-02; motores en ADR-019).

Motor principal: RapidOCR con los modelos PP-OCRv6 que trae el propio paquete
(ONNX, CPU, sin red; reconocen francés con tildes, ç y œ).
Respaldo: Tesseract ``fra+spa``. Tesseract solo
se usa si tiene el idioma ``fra``: sin él lee con el modelo español y pierde las
tildes francesas («Le madecinet infirmiare»), así que es mejor no leer.

``ocr_image`` prueba los motores en orden y devuelve el primer texto no vacío.
Un motor que no está disponible (paquete, modelos o idioma ausentes) lanza
:class:`OcrUnavailable`; si ninguno lo está, ``ocr_image`` también la lanza.
"""

from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from statistics import median
from typing import Any, Protocol

import numpy as np
import pytesseract  # type: ignore[import-untyped]
from PIL import Image, ImageOps

from frances.errors import ConfigError
from frances.log import get_logger

_log = get_logger(__name__)

#: Altura de línea por encima de la cual un salto vertical abre un párrafo nuevo.
PARAGRAPH_GAP = 2.0
#: Una caja pertenece a la línea si su centro está a menos de esta fracción de altura.
SAME_LINE = 0.6

#: Usos de cada motor desde el último :func:`reset_engine_uses` (lo reporta extract).
ENGINE_USES: Counter[str] = Counter()


class OcrUnavailable(RuntimeError):
    """El motor no puede leer en este entorno (paquete, modelos o idioma ausentes)."""


class OcrEngine(Protocol):
    name: str

    def read(self, img: Image.Image) -> str: ...


def preprocess(img: Image.Image) -> Image.Image:
    """Escala de grises + autocontraste; duplica si el ancho es menor de 1000 px."""
    gray = ImageOps.autocontrast(ImageOps.grayscale(img))
    width, height = gray.size
    if width < 1000:
        return gray.resize((width * 2, height * 2), Image.Resampling.LANCZOS)
    return gray


def lines_from_boxes(boxes: Sequence[Any], texts: Sequence[str]) -> str:
    """Texto en orden de lectura desde cajas de detección (4 puntos x, y).

    Agrupa por línea según el centro vertical, ordena cada línea por x y deja una
    línea en blanco cuando el salto vertical supera ``PARAGRAPH_GAP`` alturas: así
    ``split_blocks`` separa los párrafos igual que con la capa de texto de un PDF.
    """
    items: list[tuple[float, float, float, str]] = []
    for box, text in zip(boxes, texts, strict=False):
        if not text.strip():
            continue
        points = np.asarray(box, dtype=np.float64)
        top, bottom = float(points[:, 1].min()), float(points[:, 1].max())
        items.append(((top + bottom) / 2, max(bottom - top, 1.0), float(points[:, 0].min()), text))
    if not items:
        return ""
    height = median(item[1] for item in items)
    items.sort(key=lambda item: item[0])

    lines: list[list[tuple[float, float, float, str]]] = []
    for item in items:
        if lines and abs(item[0] - _center(lines[-1])) <= SAME_LINE * height:
            lines[-1].append(item)
        else:
            lines.append([item])

    out: list[str] = []
    previous: float | None = None
    for line in lines:
        center = _center(line)
        if previous is not None and center - previous > PARAGRAPH_GAP * height:
            out.append("")
        out.append(" ".join(item[3].strip() for item in sorted(line, key=lambda i: i[2])))
        previous = center
    return "\n".join(out)


def _center(line: Sequence[tuple[float, float, float, str]]) -> float:
    return sum(item[0] for item in line) / len(line)


class RapidOcrEngine:
    """RapidOCR (PP-OCRv6, francés) con los modelos del paquete. Carga perezosa."""

    name = "rapidocr"

    def __init__(self) -> None:
        self._engine: Any = None

    def _load(self) -> Any:
        if self._engine is not None:
            return self._engine
        try:
            from rapidocr import RapidOCR

            params: dict[str, Any] = {
                "Det.lang_type": "fr",
                "Rec.lang_type": "fr",
                "Global.log_level": "error",
            }
            self._engine = RapidOCR(params=params)
        except Exception as exc:  # paquete ausente, modelos ausentes, ONNX roto
            raise OcrUnavailable(f"RapidOCR no se pudo cargar: {type(exc).__name__}") from exc
        return self._engine

    def read(self, img: Image.Image) -> str:
        result = self._load()(np.asarray(img.convert("RGB")))
        if result is None or result.txts is None or result.boxes is None:
            return ""
        return lines_from_boxes(list(result.boxes), list(result.txts))


class TesseractEngine:
    """Tesseract ``fra+spa`` con ``--psm 3`` (detecta columnas en diapositivas)."""

    name = "tesseract"

    def __init__(self, langs: str = "fra+spa", psm: int = 3) -> None:
        self._langs = langs
        self._psm = psm
        self._checked = False
        self._problem: str | None = None

    def _check(self) -> None:
        if self._checked:
            return
        if self._problem is None:
            try:
                available = set(pytesseract.get_languages(config=""))
            except Exception:  # binario ausente
                self._problem = "tesseract no está instalado"
            else:
                missing = [lang for lang in self._langs.split("+") if lang not in available]
                if missing:
                    self._problem = f"a Tesseract le faltan los idiomas: {', '.join(missing)}"
                else:
                    self._checked = True
                    return
        raise OcrUnavailable(self._problem)

    def read(self, img: Image.Image) -> str:
        self._check()
        config = f"--psm {self._psm}"
        return str(pytesseract.image_to_string(preprocess(img), lang=self._langs, config=config))


_engines: list[OcrEngine] | None = None
_warned: set[str] = set()


def set_engines(engines: Sequence[OcrEngine] | None) -> None:
    """Reemplaza los motores (tests); ``None`` vuelve a los motores por defecto."""
    global _engines
    _engines = None if engines is None else list(engines)
    _warned.clear()


def engines() -> list[OcrEngine]:
    global _engines
    if _engines is None:
        _engines = [RapidOcrEngine(), TesseractEngine()]
    return _engines


def reset_engine_uses() -> None:
    ENGINE_USES.clear()


def ocr_image(img: Image.Image) -> str:
    """Texto de la imagen con el primer motor que lea algo.

    Un motor que falla o no lee nada cede el turno al siguiente. Si todos leen
    vacío, devuelve ``""`` (imagen sin texto). Si ninguno está disponible, lanza
    :class:`OcrUnavailable`.
    """
    unavailable = 0
    current = engines()
    for engine in current:
        try:
            text = engine.read(img)
        except OcrUnavailable as exc:
            unavailable += 1
            if engine.name not in _warned:
                _warned.add(engine.name)
                _log.warning("OCR %s no disponible: %s", engine.name, exc)
            continue
        except Exception as exc:
            _log.warning("OCR %s falló: %s", engine.name, type(exc).__name__)
            continue
        if text.strip():
            ENGINE_USES[engine.name] += 1
            return text
    if current and unavailable == len(current):
        raise OcrUnavailable("ningún motor de OCR está disponible")
    return ""


def ocr_file(path: Path) -> str:
    """Texto de un archivo de imagen en disco."""
    with Image.open(path) as img:
        img.load()
        return ocr_image(img)


def tesseract_version() -> str:
    """Versión del binario ``tesseract`` como texto."""
    return str(pytesseract.get_tesseract_version())


def rapidocr_available() -> bool:
    try:
        import rapidocr  # noqa: F401
    except ImportError:
        return False
    return True


def check_ocr() -> list[str]:
    """Motores utilizables; ``ConfigError`` si no queda ninguno (lo usa ``doctor``)."""
    usable: list[str] = []
    if rapidocr_available():
        usable.append("rapidocr")
    try:
        TesseractEngine()._check()
        usable.append("tesseract")
    except OcrUnavailable:
        pass
    if not usable:
        raise ConfigError(
            "no hay OCR: instala RapidOCR o el idioma francés de Tesseract (tesseract-ocr-fra)"
        )
    return usable
