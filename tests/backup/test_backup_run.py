"""Respaldo y restauración: API de backup en línea, blobs incrementales, retención."""

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from frances.backup import run as run_mod
from frances.backup.run import prune, restore, run_backup, snapshot_db
from frances.config import load_settings
from frances.db.store import Store
from frances.errors import ConfigError
from frances.paths import DataPaths
from frances.stage import StageContext
from tests.backup.conftest import NOW, PREFIX, FakeStore, db_row_count

DB_KEY = "frances/db/state-20261106T093000Z.db.gz"


def _insert_usage(ctx: StageContext, amount: int) -> None:
    with ctx.store.tx() as conn:
        conn.execute(
            "INSERT INTO usage (month, meter, amount) VALUES (?, ?, ?)",
            ("2026-11", f"m{amount}", amount),
        )


def test_backup_uses_online_backup_and_integrity_check(ctx: StageContext, tmp_path: Path) -> None:
    _insert_usage(ctx, 1)
    writer = Store.connect(ctx.paths.state_db)
    writer.conn.execute("BEGIN IMMEDIATE")
    writer.conn.execute("INSERT INTO usage (month, meter, amount) VALUES ('2026-11', 'x', 99)")
    copy = tmp_path / "copia.db"
    try:
        size = snapshot_db(ctx.paths.state_db, copy)
    finally:
        writer.conn.execute("ROLLBACK")
        writer.close()

    assert size > 0
    verified = sqlite3.connect(str(copy))
    try:
        check = verified.execute("PRAGMA integrity_check").fetchone()
    finally:
        verified.close()
    assert check is not None and check[0] == "ok"
    assert db_row_count(copy, "usage") == 1  # la fila sin confirmar no entra en la copia


def test_backup_upload_runs_with_store_open_elsewhere(
    ctx: StageContext, fake_store: FakeStore
) -> None:
    _insert_usage(ctx, 1)
    report = run_backup(ctx, fake_store, NOW)
    assert report.status == "ok"
    assert report.counts["db_bytes"] > 0
    assert DB_KEY in fake_store.objects


def test_corrupt_copy_is_failed_and_not_uploaded(
    ctx: StageContext, fake_store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(run_mod, "_integrity", lambda conn: "*** corrupt")
    report = run_backup(ctx, fake_store, NOW)
    assert report.status == "failed"
    assert not any("/db/" in k for k in fake_store.objects)
    row = ctx.store.conn.execute("SELECT stage, status FROM runs").fetchone()
    assert row == ("backup", "failed")


def test_snapshot_db_rejects_corrupt_copy(
    ctx: StageContext, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(run_mod, "_integrity", lambda conn: "page 3 bad")
    with pytest.raises(RuntimeError, match="integrity_check"):
        snapshot_db(ctx.paths.state_db, tmp_path / "x.db")


def test_blobs_are_incremental(ctx_with_blobs: StageContext, fake_store: FakeStore) -> None:
    first = run_backup(ctx_with_blobs, fake_store, NOW)
    assert first.counts["blobs_uploaded"] == 3
    assert first.counts["blobs_skipped"] == 0
    second = run_backup(ctx_with_blobs, fake_store, NOW + timedelta(days=1))
    assert second.counts["blobs_uploaded"] == 0
    assert second.counts["blobs_skipped"] == 3


def test_audio_and_extractions_are_not_copied(
    ctx_with_blobs: StageContext, fake_store: FakeStore
) -> None:
    run_backup(ctx_with_blobs, fake_store, NOW)
    assert not any("audio" in k or "extractions" in k for k in fake_store.objects)
    assert f"{PREFIX}config/voices.yaml" in fake_store.objects


def test_backup_records_run_row(ctx: StageContext, fake_store: FakeStore) -> None:
    run_backup(ctx, fake_store, NOW)
    rows = ctx.store.conn.execute("SELECT stage, status FROM runs").fetchall()
    assert rows == [("backup", "ok")]


def test_retention_keeps_14_days_and_latest(fake_store: FakeStore) -> None:
    for day in range(1, 21):
        fake_store.seed(f"{PREFIX}db/state-202610{day:02d}T093000Z.db.gz")
    deleted = prune(fake_store, PREFIX, datetime(2026, 10, 20, 12, 0, tzinfo=UTC), 14)
    left = fake_store.keys("/db/")
    assert deleted == 6
    assert len(left) == 14
    assert left[0].endswith("20261007T093000Z.db.gz")
    assert left[-1].endswith("20261020T093000Z.db.gz")


def test_retention_uses_bogota_dates(fake_store: FakeStore) -> None:
    # 2026-10-07 02:00 UTC es 2026-10-06 21:00 en Bogotá: cae fuera de la ventana.
    fake_store.seed(f"{PREFIX}db/state-20261007T020000Z.db.gz")
    fake_store.seed(f"{PREFIX}db/state-20261007T093000Z.db.gz")
    fake_store.seed(f"{PREFIX}db/state-20261020T093000Z.db.gz")
    deleted = prune(fake_store, PREFIX, datetime(2026, 10, 20, 12, 0, tzinfo=UTC), 14)
    assert deleted == 1
    assert fake_store.keys("/db/") == [
        f"{PREFIX}db/state-20261007T093000Z.db.gz",
        f"{PREFIX}db/state-20261020T093000Z.db.gz",
    ]


def test_prune_never_deletes_the_latest_copy(fake_store: FakeStore) -> None:
    fake_store.seed(f"{PREFIX}db/state-20250101T000000Z.db.gz")
    assert prune(fake_store, PREFIX, NOW, 14) == 0
    assert fake_store.keys("/db/") == [f"{PREFIX}db/state-20250101T000000Z.db.gz"]


def test_prune_ignores_foreign_keys(fake_store: FakeStore) -> None:
    fake_store.seed(f"{PREFIX}db/otra-cosa.gz")
    fake_store.seed(f"{PREFIX}db/state-20250101T000000Z.db.gz")
    fake_store.seed(f"{PREFIX}db/state-20250102T000000Z.db.gz")
    assert prune(fake_store, PREFIX, NOW, 14) == 1
    assert fake_store.keys("/db/") == [
        f"{PREFIX}db/otra-cosa.gz",
        f"{PREFIX}db/state-20250102T000000Z.db.gz",
    ]


def test_prune_rejects_non_positive_retention(fake_store: FakeStore) -> None:
    with pytest.raises(ValueError):
        prune(fake_store, PREFIX, NOW, 0)


def test_restore_roundtrip_and_refuses_overwrite(
    ctx_with_blobs: StageContext, fake_store: FakeStore, tmp_path: Path
) -> None:
    _insert_usage(ctx_with_blobs, 7)
    run_backup(ctx_with_blobs, fake_store, NOW)
    target = DataPaths(tmp_path / "nuevo")
    db = target.state_db
    chosen = restore(fake_store, PREFIX, target, db)
    assert chosen == DB_KEY
    assert db_row_count(db, "usage") == 1
    assert sorted(p.name for p in (target.root / "blobs").glob("*/*")) == sorted(
        p.name for p in (ctx_with_blobs.paths.root / "blobs").glob("*/*")
    )
    assert target.voices_yaml.read_text(encoding="utf-8") == "voces: []\n"
    assert not (target.root / "audio" / "clip.mp3").exists()
    with pytest.raises(ConfigError, match="force"):
        restore(fake_store, PREFIX, target, db)


def test_restore_force_replaces_and_key_selects_copy(
    ctx: StageContext, fake_store: FakeStore, tmp_path: Path
) -> None:
    run_backup(ctx, fake_store, NOW)
    run_backup(ctx, fake_store, NOW + timedelta(days=1))
    older = f"{PREFIX}db/state-20261106T093000Z.db.gz"
    target = DataPaths(tmp_path / "otro")
    target.ensure_dirs()
    target.state_db.write_bytes(b"basura")
    chosen = restore(fake_store, PREFIX, target, target.state_db, key=older, force=True)
    assert chosen == older
    assert db_row_count(target.state_db, "usage") == 0


def test_restore_without_copies_is_config_error(fake_store: FakeStore, tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="no hay copias"):
        restore(fake_store, PREFIX, DataPaths(tmp_path / "x"), tmp_path / "x" / "s.db")


def test_restore_rejects_key_outside_db_prefix(fake_store: FakeStore, tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        restore(
            fake_store,
            PREFIX,
            DataPaths(tmp_path / "x"),
            tmp_path / "x" / "s.db",
            key=f"{PREFIX}blobs/ab/abc",
        )


def test_default_backup_settings_match_plan(ctx: StageContext) -> None:
    settings = load_settings(ctx.paths.config, {})
    assert settings.backup.at == "04:30"
    assert settings.backup.retention_days == 14
    assert settings.backup.prefix == PREFIX
