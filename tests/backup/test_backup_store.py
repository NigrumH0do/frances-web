"""Cliente S3 del respaldo: configuración para Object Storage y operaciones con Stubber."""

from pathlib import Path
from typing import Any

import pytest
from botocore.stub import ANY, Stubber  # type: ignore[import-untyped]

from frances.backup.store import S3BackupStore
from frances.config import Settings, load_settings
from frances.errors import ConfigError

ENDPOINT = "https://ns.compat.objectstorage.sa-bogota-1.oraclecloud.com"
BACKUP_ENV = {
    "FRANCES_BACKUP_ENDPOINT": ENDPOINT,
    "FRANCES_BACKUP_REGION": "sa-bogota-1",
    "FRANCES_BACKUP_BUCKET": "frances-bkt",
    "FRANCES_BACKUP_ACCESS_KEY_ID": "AKIDTEST0001",
    "FRANCES_BACKUP_SECRET_ACCESS_KEY": "secret-test-value-0001",
}


def _settings(tmp_path: Path, env: dict[str, str]) -> Settings:
    return load_settings(tmp_path / "frances.toml", env)


@pytest.fixture
def store(tmp_path: Path) -> S3BackupStore:
    return S3BackupStore.from_settings(_settings(tmp_path, BACKUP_ENV))


def test_client_config_for_oracle_object_storage(store: S3BackupStore) -> None:
    cfg = store.client.meta.config
    assert cfg.s3 is not None and cfg.s3["addressing_style"] == "path"
    assert cfg.request_checksum_calculation == "when_required"
    assert cfg.response_checksum_validation == "when_required"
    assert cfg.signature_version == "s3v4"
    assert store.client.meta.endpoint_url == ENDPOINT


@pytest.mark.parametrize(
    "missing",
    [
        "FRANCES_BACKUP_ENDPOINT",
        "FRANCES_BACKUP_REGION",
        "FRANCES_BACKUP_BUCKET",
        "FRANCES_BACKUP_ACCESS_KEY_ID",
        "FRANCES_BACKUP_SECRET_ACCESS_KEY",
    ],
)
def test_missing_variable_is_named_in_config_error(tmp_path: Path, missing: str) -> None:
    env = {k: v for k, v in BACKUP_ENV.items() if k != missing}
    with pytest.raises(ConfigError, match=missing):
        S3BackupStore.from_settings(_settings(tmp_path, env))


def test_list_returns_key_to_size_map(store: S3BackupStore) -> None:
    stubber = Stubber(store.client)
    stubber.add_response(
        "list_objects_v2",
        {
            "Contents": [
                {"Key": "frances/db/state-20261106T093000Z.db.gz", "Size": 10},
                {"Key": "frances/db/state-20261105T093000Z.db.gz", "Size": 20},
            ],
            "IsTruncated": False,
        },
        {"Bucket": "frances-bkt", "Prefix": "frances/db/"},
    )
    with stubber:
        assert store.list("frances/db/") == {
            "frances/db/state-20261106T093000Z.db.gz": 10,
            "frances/db/state-20261105T093000Z.db.gz": 20,
        }
        stubber.assert_no_pending_responses()


def test_put_file_uploads_with_upload_file(store: S3BackupStore, tmp_path: Path) -> None:
    source = tmp_path / "x.bin"
    source.write_bytes(b"contenido")
    stubber = Stubber(store.client)
    stubber.add_response(
        "put_object",
        {},
        {"Bucket": "frances-bkt", "Key": "frances/blobs/ab/abc", "Body": ANY},
    )
    with stubber:
        store.put_file("frances/blobs/ab/abc", source)
        stubber.assert_no_pending_responses()


def test_get_file_writes_destination(store: S3BackupStore, tmp_path: Path) -> None:
    dest = tmp_path / "nested" / "config.toml"
    stubber = Stubber(store.client)
    body: Any = _body(b"[backup]\n")
    stubber.add_response(
        "get_object",
        {"Body": body, "ContentLength": 9},
        {"Bucket": "frances-bkt", "Key": "frances/config/frances.toml"},
    )
    with stubber:
        store.get_file("frances/config/frances.toml", dest)
        stubber.assert_no_pending_responses()
    assert dest.read_bytes() == b"[backup]\n"


def test_delete_removes_object(store: S3BackupStore) -> None:
    stubber = Stubber(store.client)
    stubber.add_response(
        "delete_object",
        {},
        {"Bucket": "frances-bkt", "Key": "frances/db/state-20261001T093000Z.db.gz"},
    )
    with stubber:
        store.delete("frances/db/state-20261001T093000Z.db.gz")
        stubber.assert_no_pending_responses()


def _body(data: bytes) -> Any:
    from io import BytesIO

    from botocore.response import StreamingBody  # type: ignore[import-untyped]

    return StreamingBody(BytesIO(data), len(data))
