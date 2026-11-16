"""Respuestas de archivo: ETag, caché, Range/416 y mime seguro."""

from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from frances.api.streaming import file_response

SHA = "a" * 64


def _client(path: Path, *, mime: str = "application/pdf", etag: str = SHA) -> TestClient:
    app = FastAPI()

    @app.get("/file")
    def serve(request: Request) -> object:
        return file_response(path, mime=mime, etag=etag, request=request)

    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def blob(tmp_path: Path) -> Path:
    path = tmp_path / "blob"
    path.write_bytes(b"0123456789")
    return path


def test_file_response_headers_range_and_304(blob: Path) -> None:
    client = _client(blob)
    full = client.get("/file")
    assert full.status_code == 200 and full.content == b"0123456789"
    assert full.headers["etag"] == f'"{SHA}"'
    assert full.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert full.headers["x-content-type-options"] == "nosniff"
    assert full.headers["content-disposition"] == "inline"
    assert full.headers["content-type"] == "application/pdf"

    part = client.get("/file", headers={"Range": "bytes=2-5"})
    assert part.status_code == 206 and part.content == b"2345"
    assert part.headers["content-range"] == "bytes 2-5/10"

    suffix = client.get("/file", headers={"Range": "bytes=-3"})
    assert suffix.status_code == 206 and suffix.content == b"789"

    assert client.get("/file", headers={"If-None-Match": f'"{SHA}"'}).status_code == 304


@pytest.mark.parametrize(
    "range_header",
    [
        "bytes=99-100",
        "bytes=abc",
        "bytes=5-2",
        "bytes=-",
        "items=0-1",
        "bytes=" + "9" * 5000 + "-",
        "bytes=0-" + "9" * 5000,
    ],
)
def test_invalid_range_is_416(blob: Path, range_header: str) -> None:
    response = _client(blob).get("/file", headers={"Range": range_header})
    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */10"


def test_unlisted_mime_is_octet_stream_attachment(blob: Path) -> None:
    response = _client(blob, mime="text/html").get("/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"] == "attachment"


@pytest.mark.parametrize(
    "mime",
    ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"],
)
def test_allowed_mimes_are_inline(blob: Path, mime: str) -> None:
    response = _client(blob, mime=mime).get("/file")
    assert response.status_code == 200
    assert response.headers["content-disposition"] == "inline"
