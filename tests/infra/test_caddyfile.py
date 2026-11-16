"""Caddyfile: HTTPS, SSE y cabeceras de seguridad (Task SRV-13)."""

import re
from pathlib import Path


def test_caddyfile_proxy_sse_and_headers() -> None:
    cf = Path("infra/Caddyfile").read_text()
    assert "reverse_proxy api:8000" in cf
    assert "flush_interval -1" in cf
    assert "try_files {path} /index.html" in cf
    assert "frame-ancestors 'none'" in cf
    assert "Strict-Transport-Security" in cf
    assert not re.search(r"^\s*log\b", cf, re.M)
