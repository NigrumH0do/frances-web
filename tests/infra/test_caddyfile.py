"""Caddyfile: HTTPS, SSE y cabeceras de seguridad (Task SRV-13)."""

import re
from pathlib import Path


def test_caddyfile_proxy_sse_and_headers() -> None:
    cf = Path("infra/Caddyfile").read_text()
    assert "reverse_proxy api:8000" in cf
    assert "flush_interval -1" in cf
    assert "try_files {path} /index.html" in cf
    assert "frame-ancestors 'none'" in cf
    assert "font-src 'self'" in cf
    assert "wss://*.stt.speech.microsoft.com" in cf
    assert "Strict-Transport-Security" in cf
    assert not re.search(r"^\s*log\b", cf, re.M)


def test_sse_chat_stream_is_not_compressed() -> None:
    cf = Path("infra/Caddyfile").read_text()
    assert re.search(r"^\s*@compressible not path /api/chat/\*\s*$", cf, re.M)
    assert re.search(r"^\s*encode @compressible zstd gzip\s*$", cf, re.M)
    assert not re.search(r"^\s*encode zstd gzip\s*$", cf, re.M)


def test_caddy_env_has_no_dead_azure_region_variable() -> None:
    """La CSP usa el comodín de ADR-022; `caddy.env` no define la región."""
    env = Path("infra/caddy.env.example").read_text()
    assert not re.search(r"^AZURE_SPEECH_REGION=", env, re.M)
    assert "ADR-022" in env
