"""Indexado de `TextBlock` en FTS5 con ids estables (AI-04).

Cada publicación produce bloques `text_blocks` con clave `(source, page, position)`.
Reindexar compara esa clave: una fila con el mismo texto conserva su `id`, un
texto distinto se actualiza (el trigger `au` resincroniza FTS), una clave nueva se
inserta y una clave sobrante se borra. Antes de borrar, las preguntas que apuntan
al bloque quedan con `source_block_id = NULL`.

Los bloques de un adjunto usan el `attachments.id` de esta publicación, no la
fuente que guardó la extracción (la extracción es compartida por blob).
"""

import re
import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, cast

from frances.db.store import Store
from frances.extract.lang import split_blocks
from frances.log import get_logger
from frances.models import Extraction, Lang, TextBlock
from frances.paths import DataPaths
from frances.stage import StageContext
from frances.timeutil import format_ts

INDEX_ITEM_VERSION = "item-1"
MAX_CHUNK_CHARS = 800

_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
_logger = get_logger(__name__)


@dataclass(frozen=True)
class IndexedBlock:
    source: str
    page: int | None
    position: int
    lang: Lang
    text: str
    extractor_version: str


@dataclass
class IndexDelta:
    inserted: int = 0
    updated: int = 0
    deleted: int = 0
    kept: int = 0


def chunk_blocks(blocks: Sequence[TextBlock], extractor_version: str) -> list[IndexedBlock]:
    """Parte cada bloque largo en trozos de como máximo `MAX_CHUNK_CHARS`.

    Los cortes van en límites de oración; una oración sola demasiado larga se parte
    por espacios y, si una palabra sola no cabe, por caracteres. `position` numera
    los trozos dentro de cada `(source, page)` en orden.
    """
    out: list[IndexedBlock] = []
    counters: dict[tuple[str, int | None], int] = {}
    for block in blocks:
        for piece in _chunks_of(block.text):
            key = (block.source, block.page)
            position = counters.get(key, 0)
            counters[key] = position + 1
            out.append(
                IndexedBlock(
                    source=block.source,
                    page=block.page,
                    position=position,
                    lang=block.lang,
                    text=piece,
                    extractor_version=extractor_version,
                )
            )
    return out


def desired_blocks(conn: sqlite3.Connection, paths: DataPaths, item_id: str) -> list[IndexedBlock]:
    """Bloques que el ítem debe tener indexados, según su texto y sus adjuntos vivos.

    Mismo contenido que `build_input` (CRD-01): primero el texto del ítem, luego los
    bloques de la extracción vigente de cada adjunto en orden de `attachments.id`.
    Lee los JSON de extracción, así que no debe llamarse dentro de una transacción.
    """
    item = _q_item(conn, item_id)
    if item is None:
        raise KeyError(item_id)
    title: str | None = item[1]
    text_blocks = split_blocks((title or "") + "\n\n" + str(item[2]), source="item")
    out = chunk_blocks(text_blocks, INDEX_ITEM_VERSION)
    for attachment_id, sha in _q_live_attachments(conn, item_id):
        if sha is None:
            continue
        version = _q_current_version(conn, str(sha))
        if version is None:
            continue
        extraction = Extraction.model_validate_json(
            paths.extraction_path(str(sha), version).read_text(encoding="utf-8")
        )
        blocks = [
            TextBlock(text=b.text, lang=b.lang, source=attachment_id, page=b.page)
            for b in extraction.blocks
        ]
        out.extend(chunk_blocks(blocks, version))
    return out


def reindex_item(store: Store, paths: DataPaths, item_id: str, now: str) -> IndexDelta:
    """Deja `text_blocks` del ítem igual a `desired_blocks`, con ids estables."""
    conn = store.conn
    row = conn.execute("SELECT deleted_at FROM items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise KeyError(item_id)
    # Los archivos se leen aquí, antes de abrir la transacción de escritura.
    desired = [] if row[0] is not None else desired_blocks(conn, paths, item_id)

    delta = IndexDelta()
    with store.tx() as tx:
        existing = _existing_rows(tx, item_id)
        for block in desired:
            key = (block.source, block.page, block.position)
            old = existing.pop(key, None)
            if old is None:
                tx.execute(
                    "INSERT INTO text_blocks (item_id, source, page, position, lang, text,"
                    " extractor_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        item_id,
                        block.source,
                        block.page,
                        block.position,
                        block.lang,
                        block.text,
                        block.extractor_version,
                        now,
                    ),
                )
                delta.inserted += 1
            elif (old[1], old[2], old[3]) == (block.text, block.lang, block.extractor_version):
                delta.kept += 1
            else:
                tx.execute(
                    "UPDATE text_blocks SET text = ?, lang = ?, extractor_version = ? WHERE id = ?",
                    (block.text, block.lang, block.extractor_version, old[0]),
                )
                delta.updated += 1
        if existing:
            stale_ids = [value[0] for value in existing.values()]
            _unlink_questions(tx, stale_ids)
            placeholders = ", ".join("?" for _ in stale_ids)
            tx.execute(f"DELETE FROM text_blocks WHERE id IN ({placeholders})", stale_ids)
            delta.deleted = len(stale_ids)
    return delta


def purge_deleted(store: Store) -> int:
    """Borra los bloques de ítems con `deleted_at`; devuelve las filas borradas."""
    deleted_items = "SELECT id FROM items WHERE deleted_at IS NOT NULL"
    with store.tx() as tx:
        tx.execute(
            "UPDATE questions SET source_block_id = NULL WHERE source_block_id IN"
            " (SELECT id FROM text_blocks WHERE item_id IN (" + deleted_items + "))"
        )
        cursor = tx.execute("DELETE FROM text_blocks WHERE item_id IN (" + deleted_items + ")")
        return cursor.rowcount


def run_index(ctx: StageContext, item_ids: Sequence[str] | None = None) -> dict[str, int]:
    """Reindexa los ítems dados, o todos los vivos más la purga de los borrados.

    Un ítem que falla se cuenta en `errors` y el resto sigue. El log incluye el id,
    nunca el texto. Devuelve la suma de los `IndexDelta` más `items` (intentados) y
    `errors`.
    """
    now = format_ts(ctx.now())
    conn = ctx.store.conn
    if item_ids is None:
        ids = [
            str(row[0])
            for row in conn.execute(
                "SELECT id FROM items WHERE deleted_at IS NULL ORDER BY first_seen_at DESC, id"
            ).fetchall()
        ]
    else:
        ids = list(item_ids)
    totals = {"inserted": 0, "updated": 0, "deleted": 0, "kept": 0, "items": 0, "errors": 0}
    for item_id in ids:
        totals["items"] += 1
        try:
            delta = reindex_item(ctx.store, ctx.paths, item_id, now)
        except Exception as exc:
            totals["errors"] += 1
            _logger.error("indexado del ítem %s falló (%s)", item_id, type(exc).__name__)
            continue
        totals["inserted"] += delta.inserted
        totals["updated"] += delta.updated
        totals["deleted"] += delta.deleted
        totals["kept"] += delta.kept
    if item_ids is None:
        totals["deleted"] += purge_deleted(ctx.store)
    return totals


# ---- privados ----


def _chunks_of(text: str) -> list[str]:
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    units: list[str] = []
    for sentence in _SENTENCE_END.split(text.strip()):
        if len(sentence) <= MAX_CHUNK_CHARS:
            units.append(sentence)
        else:
            units.extend(_pack(_hard_split_words(sentence), " "))
    return _pack(units, " ")


def _hard_split_words(text: str) -> list[str]:
    pieces: list[str] = []
    for word in text.split():
        for start in range(0, len(word), MAX_CHUNK_CHARS):
            pieces.append(word[start : start + MAX_CHUNK_CHARS])
    return pieces


def _pack(units: Iterable[str], sep: str) -> list[str]:
    """Une unidades consecutivas mientras el resultado quepa en `MAX_CHUNK_CHARS`."""
    packed: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
        elif len(current) + len(sep) + len(unit) <= MAX_CHUNK_CHARS:
            current = current + sep + unit
        else:
            packed.append(current)
            current = unit
    if current:
        packed.append(current)
    return packed


def _existing_rows(
    conn: sqlite3.Connection, item_id: str
) -> dict[tuple[str, int | None, int], tuple[int, str, str, str]]:
    """Filas actuales del ítem por clave `(source, page, position)`.

    El valor es `(id, text, lang, extractor_version)`. La clave se compara en Python
    porque el `UNIQUE` de SQLite no protege filas con `page IS NULL`.
    """
    rows = conn.execute(
        "SELECT id, source, page, position, text, lang, extractor_version"
        " FROM text_blocks WHERE item_id = ?",
        (item_id,),
    ).fetchall()
    existing: dict[tuple[str, int | None, int], tuple[int, str, str, str]] = {}
    for row_id, source, page, position, text, lang, version in rows:
        key = (str(source), None if page is None else int(page), int(position))
        existing[key] = (int(row_id), str(text), str(lang), str(version))
    return existing


def _unlink_questions(conn: sqlite3.Connection, block_ids: Sequence[int]) -> None:
    placeholders = ", ".join("?" for _ in block_ids)
    conn.execute(
        f"UPDATE questions SET source_block_id = NULL WHERE source_block_id IN ({placeholders})",
        list(block_ids),
    )


def _q_item(conn: sqlite3.Connection, item_id: str) -> tuple[Any, ...] | None:
    """Fila del ítem `(id, title, text, content_hash)`, o `None` si no existe."""
    row = conn.execute(
        "SELECT id, title, text, content_hash FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    return cast("tuple[Any, ...] | None", row)


def _q_live_attachments(conn: sqlite3.Connection, item_id: str) -> list[tuple[str, str | None]]:
    """Adjuntos vivos y descargados `(attachments.id, sha)`, en orden de `attachments.id`.

    El blob efectivo es `export_text_sha256` si no es NULL, si no `blob_sha256`.
    """
    rows = conn.execute(
        "SELECT id, COALESCE(export_text_sha256, blob_sha256) AS sha FROM attachments"
        " WHERE item_id = ? AND removed_at IS NULL AND status = 'downloaded' ORDER BY id",
        (item_id,),
    ).fetchall()
    return [(str(row[0]), None if row[1] is None else str(row[1])) for row in rows]


def _q_current_version(conn: sqlite3.Connection, sha: str) -> str | None:
    """Versión vigente de un blob (R-26): mayor `created_at`, empate por mayor
    `extractor_version`; `None` si el blob no tiene extracción."""
    row = conn.execute(
        "SELECT extractor_version FROM extractions WHERE blob_sha256 = ?"
        " ORDER BY created_at DESC, extractor_version DESC LIMIT 1",
        (sha,),
    ).fetchone()
    return str(row[0]) if row is not None else None
