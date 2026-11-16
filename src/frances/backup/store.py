"""Almacén remoto del respaldo: protocolo y cliente S3 para Object Storage de Oracle.

Las claves de acceso salen solo de `Settings.secret` (`frances.config`). Nada aquí lee
`os.environ`. El cliente desactiva las sumas de comprobación por defecto de boto3, que
algunos servicios compatibles con S3 rechazan.
"""

from pathlib import Path
from typing import Any, Protocol

import boto3  # type: ignore[import-untyped]
from boto3.s3.transfer import TransferConfig  # type: ignore[import-untyped]
from botocore.config import Config  # type: ignore[import-untyped]

from frances.config import Settings

MULTIPART_THRESHOLD = 8 * 1024 * 1024
_CHUNK = 1024 * 1024


class BackupStore(Protocol):
    def list(self, prefix: str) -> dict[str, int]: ...

    def put_file(self, key: str, path: Path) -> None: ...

    def get_file(self, key: str, dest: Path) -> None: ...

    def delete(self, key: str) -> None: ...


class S3BackupStore:
    """`BackupStore` sobre boto3. Las claves y el endpoint vienen de `FRANCES_BACKUP_*`."""

    def __init__(self, bucket: str, client: Any) -> None:
        self.bucket = bucket
        self.client = client

    @classmethod
    def from_settings(cls, settings: Settings) -> "S3BackupStore":
        """Cliente boto3; una variable faltante → `ConfigError` que la nombra."""
        endpoint = settings.secret("FRANCES_BACKUP_ENDPOINT")
        region = settings.secret("FRANCES_BACKUP_REGION")
        bucket = settings.secret("FRANCES_BACKUP_BUCKET")
        access_key = settings.secret("FRANCES_BACKUP_ACCESS_KEY_ID")
        secret_key = settings.secret("FRANCES_BACKUP_SECRET_ACCESS_KEY")
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            retries={"max_attempts": 5, "mode": "standard"},
        )
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=config,
        )
        return cls(bucket, client)

    def put_file(self, key: str, path: Path) -> None:
        transfer = TransferConfig(multipart_threshold=MULTIPART_THRESHOLD)
        self.client.upload_file(str(path), self.bucket, key, Config=transfer)

    def get_file(self, key: str, dest: Path) -> None:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as handle:
            for chunk in response["Body"].iter_chunks(_CHUNK):
                handle.write(chunk)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def list(self, prefix: str) -> dict[str, int]:
        found: dict[str, int] = {}
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                found[str(obj["Key"])] = int(obj["Size"])
        return found
