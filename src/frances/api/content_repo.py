"""Consultas de solo lectura para cursos, publicaciones y adjuntos (plan SRV-08).

Ninguna función arma rutas del disco: los blobs se identifican por su sha256 y
la ruta la construye ``DataPaths.blob_path`` en la capa de rutas, solo después
de que este módulo confirme que el sha está registrado en la base.
"""

import base64
import binascii
import json
import sqlite3
import threading
from collections import OrderedDict

from frances.extract.lang import detect_lang
from frances.models.api import (
    AttachmentView,
    FileLink,
    ItemDetail,
    ItemPage,
    ItemSummary,
)
from frances.models.bundle import CourseOut, TopicOut
from frances.models.classroom import ItemKind
from frances.models.content import Lang, StudySheet

_LANG_CACHE_MAX = 2000
_LANG_CACHE: OrderedDict[tuple[str, str], tuple[str, Lang]] = OrderedDict()
_LANG_LOCK = threading.Lock()

_ITEM_COLUMNS = (
    "i.id, i.course_id, i.kind, i.topic_id, i.title, i.text, i.creation_time,"
    " i.update_time, i.first_seen_at, i.due_at, i.content_hash,"
    " (SELECT COUNT(*) FROM attachments a WHERE a.item_id = i.id AND a.removed_at IS NULL),"
    " (SELECT COUNT(*) FROM card_sources cs JOIN cards c ON c.id = cs.card_id"
    "   WHERE cs.item_id = i.id AND c.removed_at IS NULL),"
    " EXISTS(SELECT 1 FROM sheets s WHERE s.item_id = i.id)"
)


def _text_lang(item_id: str, content_hash: str, text: str) -> Lang:
    """``detect_lang`` memorizado por ``(item_id, content_hash)``, LRU de 2000."""
    key = (item_id, content_hash)
    with _LANG_LOCK:
        cached = _LANG_CACHE.get(key)
        if cached is not None and cached[0] == text:
            _LANG_CACHE.move_to_end(key)
            return cached[1]
    detected = detect_lang(text)
    with _LANG_LOCK:
        _LANG_CACHE[key] = (text, detected)
        _LANG_CACHE.move_to_end(key)
        while len(_LANG_CACHE) > _LANG_CACHE_MAX:
            _LANG_CACHE.popitem(last=False)
    return detected


def _as_int(value: object) -> int:
    return int(str(value))


def _summary(row: tuple[object, ...]) -> ItemSummary:
    return ItemSummary(
        id=str(row[0]),
        course_id=str(row[1]),
        kind=row[2],  # type: ignore[arg-type]
        topic_id=str(row[3]) if row[3] is not None else None,
        title=str(row[4]) if row[4] is not None else None,
        text_lang=_text_lang(str(row[0]), str(row[10]), str(row[5])),
        created_at=str(row[6]),
        updated_at=str(row[7]),
        first_seen_at=str(row[8]),
        due_at=str(row[9]) if row[9] is not None else None,
        n_attachments=_as_int(row[11]),
        n_cards=_as_int(row[12]),
        has_sheet=bool(row[13]),
    )


def list_courses(conn: sqlite3.Connection) -> list[CourseOut]:
    rows = conn.execute(
        "SELECT id, name, section FROM courses WHERE included = 1 ORDER BY id"
    ).fetchall()
    return [CourseOut(id=str(r[0]), name=str(r[1]), section=r[2]) for r in rows]


def list_classroom_topics(conn: sqlite3.Connection, course_id: str) -> list[TopicOut]:
    rows = conn.execute(
        "SELECT id, course_id, name FROM topics WHERE course_id = ? ORDER BY name, id",
        (course_id,),
    ).fetchall()
    return [TopicOut(id=str(r[0]), course_id=str(r[1]), name=str(r[2])) for r in rows]


def encode_cursor(update_time: str, item_id: str) -> str:
    """Cursor opaco de paginación: b64url de ``{"u": update_time, "i": id}``."""
    raw = json.dumps({"u": update_time, "i": item_id}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[str, str]:
    """Decodifica un cursor; cualquier valor inválido lanza ``ValueError``."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        data = json.loads(raw)
    except (ValueError, binascii.Error, UnicodeError, RecursionError) as exc:
        raise ValueError("cursor inválido") from exc
    if (
        not isinstance(data, dict)
        or set(data) != {"u", "i"}
        or not isinstance(data["u"], str)
        or not isinstance(data["i"], str)
    ):
        raise ValueError("cursor inválido")
    return data["u"], data["i"]


def page_items(
    conn: sqlite3.Connection,
    *,
    course_id: str | None,
    topic_id: str | None,
    kind: ItemKind | None,
    cursor: str | None,
    limit: int,
) -> ItemPage:
    """Página por ``(update_time DESC, id DESC)``; el cursor guarda esa pareja."""
    where = ["i.deleted_at IS NULL"]
    params: list[object] = []
    if course_id is not None:
        where.append("i.course_id = ?")
        params.append(course_id)
    if topic_id is not None:
        where.append("i.topic_id = ?")
        params.append(topic_id)
    if kind is not None:
        where.append("i.kind = ?")
        params.append(kind)
    if cursor is not None:
        update_time, item_id = decode_cursor(cursor)
        where.append("(i.update_time < ? OR (i.update_time = ? AND i.id < ?))")
        params.extend((update_time, update_time, item_id))

    sql = (
        f"SELECT {_ITEM_COLUMNS} FROM items i WHERE {' AND '.join(where)}"
        " ORDER BY i.update_time DESC, i.id DESC LIMIT ?"
    )
    params.append(limit + 1)
    rows = conn.execute(sql, params).fetchall()
    has_more = len(rows) > limit
    visible = rows[:limit]
    items = [_summary(tuple(row)) for row in visible]
    next_cursor = None
    if has_more and visible:
        last = visible[-1]
        next_cursor = encode_cursor(str(last[7]), str(last[0]))
    return ItemPage(items=items, next_cursor=next_cursor)


def _file_link(sha: object, mime: object, size: object) -> FileLink | None:
    if sha is None or size is None:
        return None
    return FileLink(
        url=f"/api/files/{sha}",
        size=_as_int(size),
        mime=str(mime) if mime is not None else "application/octet-stream",
        sha256=str(sha),
    )


def _attachments(conn: sqlite3.Connection, item_id: str) -> list[AttachmentView]:
    rows = conn.execute(
        "SELECT a.id, a.kind, a.title, a.url, a.mime_type, a.status, a.blob_sha256,"
        " a.export_pdf_sha256, bf.mime_type, bf.size, bp.mime_type, bp.size"
        " FROM attachments a"
        " LEFT JOIN blobs bf ON bf.sha256 = a.blob_sha256"
        " LEFT JOIN blobs bp ON bp.sha256 = a.export_pdf_sha256"
        " WHERE a.item_id = ? AND a.removed_at IS NULL"
        " ORDER BY a.id",
        (item_id,),
    ).fetchall()
    out: list[AttachmentView] = []
    for row in rows:
        downloaded = row[5] == "downloaded"
        file = _file_link(row[6], row[8], row[9]) if downloaded else None
        view_pdf = _file_link(row[7], row[10], row[11]) if downloaded else None
        out.append(
            AttachmentView(
                id=str(row[0]),
                kind=row[1],
                title=str(row[2]) if row[2] is not None else None,
                url=str(row[3]) if row[3] is not None else None,
                mime_type=str(row[4]) if row[4] is not None else None,
                status=row[5],
                file=file,
                view_pdf=view_pdf,
            )
        )
    return out


def _sheet(conn: sqlite3.Connection, item_id: str) -> StudySheet | None:
    row = conn.execute("SELECT json FROM sheets WHERE item_id = ?", (item_id,)).fetchone()
    if row is None:
        return None
    payload = json.loads(str(row[0]))
    payload["item_id"] = item_id
    return StudySheet.model_validate(payload)


def get_item_detail(conn: sqlite3.Connection, item_id: str) -> ItemDetail | None:
    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS}, i.text, i.alternate_link"
        " FROM items i WHERE i.id = ? AND i.deleted_at IS NULL",
        (item_id,),
    ).fetchone()
    if row is None:
        return None
    card_ids = [
        str(r[0])
        for r in conn.execute(
            "SELECT c.id FROM cards c JOIN card_sources cs ON cs.card_id = c.id"
            " WHERE cs.item_id = ? AND c.removed_at IS NULL ORDER BY c.id",
            (item_id,),
        ).fetchall()
    ]
    return ItemDetail(
        item=_summary(tuple(row[:14])),
        text=str(row[14]),
        alternate_link=str(row[15]) if row[15] is not None else None,
        attachments=_attachments(conn, item_id),
        card_ids=card_ids,
        sheet=_sheet(conn, item_id),
    )


def blob_for_download(conn: sqlite3.Connection, sha256: str) -> tuple[str, int] | None:
    """``(mime, size)`` solo si el sha pertenece a un adjunto vigente y vivo."""
    row = conn.execute(
        "SELECT b.mime_type, b.size FROM blobs b WHERE b.sha256 = ? AND EXISTS ("
        " SELECT 1 FROM attachments a JOIN items i ON i.id = a.item_id"
        " WHERE a.removed_at IS NULL AND i.deleted_at IS NULL"
        " AND (a.blob_sha256 = b.sha256 OR a.export_pdf_sha256 = b.sha256))",
        (sha256,),
    ).fetchone()
    if row is None:
        return None
    return str(row[0]), _as_int(row[1])
