"""Indexado de bloques de texto en FTS5 con ids estables (AI-04)."""

import sqlite3
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

# frances.db debe cargarse antes que frances.stage (ciclo db.usage -> stage); ver tests/cards.
from frances.db import store as _store  # noqa: F401
from frances.models import Extraction, TextBlock
from frances.models.ids import attachment_id
from frances.stage import StageContext, make_context
from frances.study.index import MAX_CHUNK_CHARS, chunk_blocks, reindex_item, run_index

_NOW = "2026-11-02T10:00:00Z"
_PDF_SHA = "b" * 64
# Fuente que trae la extracción; el índice debe reemplazarla por el id del adjunto.
_EXTRACTION_SOURCE = "fuente-del-primer-adjunto"


@pytest.fixture
def ctx(tmp_path: Path) -> Iterator[StageContext]:
    context = make_context(tmp_path, {})
    try:
        context.store.conn.execute(
            "INSERT INTO courses (id, name, state, update_time, raw_json)"
            " VALUES ('c_1', 'Français 1', 'ACTIVE', ?, '{}')",
            (_NOW,),
        )
        yield context
    finally:
        context.store.close()


def _item(conn: sqlite3.Connection, item_id: str, title: str, text: str) -> None:
    conn.execute(
        "INSERT INTO items (id, course_id, kind, classroom_id, title, text, state,"
        " creation_time, update_time, content_hash, raw_json, first_seen_at, last_seen_at)"
        " VALUES (?, 'c_1', 'coursework', ?, ?, ?, 'PUBLISHED', ?, ?, ?, '{}', ?, ?)",
        (item_id, item_id, title, text, _NOW, _NOW, f"{item_id}-h", _NOW, _NOW),
    )


def _extraction(ctx: StageContext, sha: str, ver: str, blocks: list[TextBlock]) -> None:
    """Blob, fila `extractions` y su JSON en `extractions/`."""
    conn = ctx.store.conn
    conn.execute(
        "INSERT OR IGNORE INTO blobs (sha256, size, mime_type, created_at)"
        " VALUES (?, 1, 'application/pdf', ?)",
        (sha, _NOW),
    )
    extraction = Extraction(
        blob_sha256=sha,
        extractor_version=ver,
        method="pdf_text",
        blocks=blocks,
        char_count=sum(len(b.text) for b in blocks),
    )
    conn.execute(
        "INSERT INTO extractions (blob_sha256, extractor_version, method, lang, char_count,"
        " path, created_at) VALUES (?, ?, 'pdf_text', 'fr', ?, ?, ?)",
        (sha, ver, extraction.char_count, f"extractions/{sha}.{ver}.json", _NOW),
    )
    ctx.paths.extraction_path(sha, ver).write_text(extraction.model_dump_json(), encoding="utf-8")


def _attachment(conn: sqlite3.Connection, item_id: str, external_id: str, sha: str) -> str:
    att = attachment_id(item_id, "drive_file", external_id)
    conn.execute(
        "INSERT INTO attachments (id, item_id, kind, external_id, title, blob_sha256, status,"
        " updated_at) VALUES (?, ?, 'drive_file', ?, 'Leçon.pdf', ?, 'downloaded', ?)",
        (att, item_id, external_id, sha, _NOW),
    )
    return att


def _seed_item_with_pdf(ctx: StageContext) -> tuple[str, str]:
    """Publicación `mt_pdf` con texto propio y un PDF sintético de 2 páginas."""
    conn = ctx.store.conn
    _item(conn, "mt_pdf", "Leçon 1", "Bonjour Paul.\n\nJe vais à l'école.")
    _extraction(
        ctx,
        _PDF_SHA,
        "1",
        [
            TextBlock(text="Page un du PDF.", lang="fr", source=_EXTRACTION_SOURCE, page=1),
            TextBlock(text="Page deux du PDF.", lang="fr", source=_EXTRACTION_SOURCE, page=2),
        ],
    )
    att = _attachment(conn, "mt_pdf", "pdf-1", _PDF_SHA)
    return "mt_pdf", att


def _seed_cw1(ctx: StageContext) -> None:
    """Tarea `cw_1` sintética: tres bloques de texto, uno de ellos con acento."""
    _item(ctx.store.conn, "cw_1", "Leçon", "Bonjour Paul.\n\nJe vais à l'école.\n\nIl pleut.")


def _block_ids(conn: sqlite3.Connection, item_id: str) -> dict[str, int]:
    rows = conn.execute("SELECT text, id FROM text_blocks WHERE item_id = ?", (item_id,))
    return {str(text): int(row_id) for text, row_id in rows}


def test_index_item_text_and_attachment_pages(ctx: StageContext) -> None:
    item_id, att = _seed_item_with_pdf(ctx)
    run_index(ctx)
    conn = ctx.store.conn
    rows = conn.execute(
        "SELECT source, page FROM text_blocks WHERE item_id = ? ORDER BY id", (item_id,)
    ).fetchall()
    assert ("item", None) in rows
    assert (att, 2) in rows
    assert not any(source == _EXTRACTION_SOURCE for source, _ in rows)
    hits = conn.execute(
        "SELECT COUNT(*) FROM text_blocks_fts WHERE text_blocks_fts MATCH 'ecole'"
    ).fetchone()[0]
    assert hits >= 1


def test_reindex_is_idempotent(ctx: StageContext) -> None:
    _seed_item_with_pdf(ctx)
    first = run_index(ctx)
    count = ctx.store.conn.execute("SELECT COUNT(*) FROM text_blocks").fetchone()[0]
    second = run_index(ctx)
    assert first["inserted"] == count
    assert second["inserted"] == 0 and second["updated"] == 0 and second["deleted"] == 0
    assert ctx.store.conn.execute("SELECT COUNT(*) FROM text_blocks").fetchone()[0] == count


def test_reindex_keeps_ids_and_nulls_question_refs(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _seed_cw1(ctx)
    run_index(ctx, ["cw_1"])
    ids = _block_ids(conn, "cw_1")
    conn.execute(
        "INSERT INTO quizzes (id, scope_kind, scope_id, title_es, input_hash, prompt_version,"
        " model, created_at) VALUES ('qz_1', 'item', 'cw_1', 'Quiz', 'h', 'v1', 'm', ?)",
        (_NOW,),
    )
    conn.execute(
        "INSERT INTO questions (id, quiz_id, position, kind, prompt_es, answer_json,"
        " source_block_id) VALUES ('q_1', 'qz_1', 0, 'mcq', '¿Qué pasa?', '\"llueve\"', ?)",
        (ids["Il pleut."],),
    )
    conn.execute(
        "UPDATE items SET text = ? WHERE id = 'cw_1'", ("Bonjour Paul.\n\nJe vais au marché.",)
    )
    delta = run_index(ctx, ["cw_1"])
    new = _block_ids(conn, "cw_1")
    assert new["Bonjour Paul."] == ids["Bonjour Paul."]
    assert delta["updated"] == 1 and delta["deleted"] == 1
    assert "Il pleut." not in new
    ref = conn.execute("SELECT source_block_id FROM questions WHERE id = 'q_1'").fetchone()[0]
    assert ref is None


def test_long_block_is_chunked_on_sentences() -> None:
    text = " ".join(f"Phrase numéro {i} avec quelques mots." for i in range(60))
    chunks = chunk_blocks([TextBlock(text=text, lang="fr", source="item")], "item-1")
    assert len(chunks) > 1
    assert all(len(c.text) <= MAX_CHUNK_CHARS for c in chunks)
    assert [c.position for c in chunks] == list(range(len(chunks)))
    assert " ".join(c.text for c in chunks) == text


def test_overlong_word_is_split_by_characters() -> None:
    text = "a" * (MAX_CHUNK_CHARS * 2 + 5)
    chunks = chunk_blocks([TextBlock(text=text, lang="fr", source="item")], "item-1")
    assert all(len(c.text) <= MAX_CHUNK_CHARS for c in chunks)
    assert "".join(c.text for c in chunks) == text


def test_positions_restart_for_each_page() -> None:
    long_text = " ".join(f"Frase {i} corta." for i in range(120))
    blocks = [
        TextBlock(text=long_text, lang="es", source="s", page=1),
        TextBlock(text=long_text, lang="es", source="s", page=2),
    ]
    chunks = chunk_blocks(blocks, "v1")
    page2 = [c.position for c in chunks if c.page == 2]
    assert page2 == list(range(len(page2)))
    assert len(page2) > 1


def test_deleted_items_are_purged(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _seed_cw1(ctx)
    run_index(ctx)
    conn.execute("UPDATE items SET deleted_at = 't' WHERE id = 'cw_1'")
    result = run_index(ctx)
    assert result["deleted"] > 0
    assert (
        conn.execute("SELECT COUNT(*) FROM text_blocks WHERE item_id = 'cw_1'").fetchone()[0] == 0
    )


def test_no_transaction_while_reading_files(
    ctx: StageContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_item_with_pdf(ctx)
    seen: list[bool] = []
    real_read_text = Path.read_text

    def spy(self: Path, *args: object, **kwargs: object) -> str:
        seen.append(ctx.store.conn.in_transaction)
        return real_read_text(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Path, "read_text", spy)
    run_index(ctx)
    assert seen
    assert not any(seen)


def test_attachment_blob_shared_by_two_publications_gets_own_ids(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _seed_item_with_pdf(ctx)
    _item(conn, "mt_otro", "Leçon 2", "Salut la classe.")
    att_otro = _attachment(conn, "mt_otro", "pdf-2", _PDF_SHA)
    run_index(ctx)
    sources = {
        row[0]
        for row in conn.execute(
            "SELECT DISTINCT source FROM text_blocks WHERE item_id = 'mt_otro' AND page = 1"
        )
    }
    assert sources == {att_otro}


def test_failing_item_is_counted_and_does_not_stop_the_rest(ctx: StageContext) -> None:
    conn = ctx.store.conn
    _seed_cw1(ctx)
    _item(conn, "mt_roto", "Leçon 3", "Texte.")
    conn.execute(
        "INSERT INTO blobs (sha256, size, mime_type, created_at) VALUES ('c', 1, 'x', ?)", (_NOW,)
    )
    conn.execute(
        "INSERT INTO extractions (blob_sha256, extractor_version, method, lang, char_count,"
        " path, created_at) VALUES ('c', '1', 'pdf_text', 'fr', 0, 'x', ?)",
        (_NOW,),
    )
    _attachment(conn, "mt_roto", "pdf-x", "c")
    result = run_index(ctx)
    assert result["errors"] == 1
    assert _block_ids(conn, "cw_1")


def test_reindex_item_reads_once_and_returns_delta(ctx: StageContext) -> None:
    _seed_cw1(ctx)
    delta = reindex_item(ctx.store, ctx.paths, "cw_1", _NOW)
    # Título + tres párrafos: cuatro bloques.
    assert delta.inserted == 4 and delta.kept == 0


def test_two_thousand_unchanged_items_reindex_under_five_seconds(ctx: StageContext) -> None:
    conn = ctx.store.conn
    for i in range(2000):
        _item(conn, f"mt_{i}", f"Leçon {i}", f"Bonjour {i}.\n\nJe vais à l'école numéro {i}.")
    run_index(ctx)
    started = time.perf_counter()
    result = run_index(ctx)
    elapsed = time.perf_counter() - started
    assert result["inserted"] == 0 and result["updated"] == 0 and result["deleted"] == 0
    assert elapsed < 5.0
