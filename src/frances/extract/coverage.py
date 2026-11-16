"""Cobertura de lectura: qué adjuntos del curso tienen texto y cuáles no (EXT-07).

Cada adjunto vivo cae en un solo grupo:

- ``con_texto``: extraído con la versión vigente y al menos ``MIN_CHARS`` letras.
- ``sin_texto``: extraído, pero sin texto útil (una foto sin letras, un PDF en blanco).
- ``pendiente``: descargado y con formato soportado, falta extraer con esta versión.
- ``sin_soporte``: descargado, pero su formato no tiene texto (audio, video, zip…).
- ``no_descargado``: demasiado grande, sin permiso, borrado en Drive o con error.
- ``enlace``: enlaces web, YouTube y formularios (no se descargan).
"""

import sqlite3
from collections import Counter
from dataclasses import dataclass, field

from frances.extract.office import is_office_mime

#: Menos letras que esto en una extracción = el archivo no aportó texto.
MIN_CHARS = 20

GROUPS = ("con_texto", "sin_texto", "pendiente", "sin_soporte", "no_descargado", "enlace")

_NATIVE_PREFIX = "application/vnd.google-apps."
_GENERIC = frozenset({"", "application/octet-stream", "binary/octet-stream"})


@dataclass(frozen=True)
class CoverageRow:
    attachment_id: str
    item_id: str
    title: str
    mime_type: str
    reason: str
    detail: str


@dataclass
class CoverageReport:
    counts: dict[str, int]
    by_method: dict[str, int]
    problems: list[CoverageRow] = field(default_factory=list)

    @property
    def files_total(self) -> int:
        return sum(count for group, count in self.counts.items() if group != "enlace")

    @property
    def files_ok_share(self) -> float:
        total = self.files_total
        return self.counts["con_texto"] / total if total else 1.0


def supported(mime: str, native: bool) -> bool:
    """¿La etapa extract sabe leer este tipo? (debe coincidir con ``run._dispatch``)."""
    return (
        native
        or mime in _GENERIC
        or mime == "application/pdf"
        or is_office_mime(mime)
        or mime.startswith(("image/", "text/"))
    )


def coverage(conn: sqlite3.Connection, extractor_version: str) -> CoverageReport:
    rows = conn.execute(
        "SELECT a.id, a.item_id, COALESCE(a.title, ''), a.kind, a.status, COALESCE(a.error, ''),"
        " COALESCE(NULLIF(a.mime_type, ''), b.mime_type, ''),"
        " COALESCE(a.export_text_sha256, a.blob_sha256), a.mime_type LIKE ? || '%',"
        " e.method, e.char_count"
        " FROM attachments a JOIN items i ON i.id = a.item_id"
        " LEFT JOIN blobs b ON b.sha256 = a.blob_sha256"
        " LEFT JOIN extractions e ON e.blob_sha256 = COALESCE(a.export_text_sha256, a.blob_sha256)"
        "  AND e.extractor_version = ?"
        " WHERE a.removed_at IS NULL AND i.deleted_at IS NULL"
        " ORDER BY a.item_id, a.id",
        (_NATIVE_PREFIX, extractor_version),
    ).fetchall()
    counts: Counter[str] = Counter(dict.fromkeys(GROUPS, 0))
    methods: Counter[str] = Counter()
    problems: list[CoverageRow] = []
    for att_id, item_id, title, kind, status, error, mime, sha, native, method, chars in rows:
        if kind != "drive_file":
            counts["enlace"] += 1
            continue
        detail = ""
        if status != "downloaded" or sha is None:
            group, detail = "no_descargado", status if not error else f"{status}: {error}"
        elif method is not None:
            methods[str(method)] += 1
            group = "con_texto" if int(chars or 0) >= MIN_CHARS else "sin_texto"
            detail = f"{method}, {int(chars or 0)} letras"
        elif supported(str(mime), bool(native)):
            group = "pendiente"
        else:
            group, detail = "sin_soporte", str(mime) or "sin tipo"
        counts[group] += 1
        if group != "con_texto":
            problems.append(
                CoverageRow(str(att_id), str(item_id), str(title), str(mime), group, detail)
            )
    return CoverageReport(counts=dict(counts), by_method=dict(methods), problems=problems)
