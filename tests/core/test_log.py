import logging

import pytest

from frances.log import SENSITIVE_ENV, get_logger, redact


def test_sensitive_env_lists_secret_names() -> None:
    assert SENSITIVE_ENV == (
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
        "GOOGLE_LOGIN_CLIENT_ID",
        "GOOGLE_LOGIN_CLIENT_SECRET",
        "AZURE_SPEECH_KEY",
        "AZURE_TRANSLATOR_KEY",
        "FRANCES_PASSPHRASE",
        "FRANCES_SECRETS_KEY",
        "FRANCES_ADMIN_EMAILS",
        "FRANCES_FORWARDED_ALLOW_IPS",
        "LLM_BASE_URL",
        "LLM_API_KEY",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "FRANCES_BACKUP_ACCESS_KEY_ID",
        "FRANCES_BACKUP_SECRET_ACCESS_KEY",
    )


def test_redact_hides_admin_emails_and_forwarded_ips() -> None:
    """`FRANCES_ADMIN_EMAILS` y `FRANCES_FORWARDED_ALLOW_IPS` son sensibles (AGENTS.md)."""
    env = {
        "FRANCES_ADMIN_EMAILS": "boss@uni.example.edu, otro@uni.example.edu",
        "FRANCES_FORWARDED_ALLOW_IPS": "172.28.0.0/24",
    }
    out = redact(
        "admins=boss@uni.example.edu, otro@uni.example.edu proxy=172.28.0.0/24 desde 1.2.3.4",
        env,
    )
    assert "boss@uni" not in out and "otro@uni" not in out
    assert "172.28.0.0" not in out
    assert "1.2.3.4" in out  # solo se redacta el valor de la variable
    assert out.count("[REDACTED]") == 2


def test_logger_filter_redacts_admin_emails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("FRANCES_ADMIN_EMAILS", "jefa@uni.example.edu")
    logger = get_logger("test-fnd04-admin")
    with caplog.at_level(logging.WARNING, logger="test-fnd04-admin"):
        logger.warning("admin promovido: %s", "jefa@uni.example.edu")
    assert "jefa@uni.example.edu" not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_redact_env_values_and_patterns() -> None:
    env = {"AZURE_SPEECH_KEY": "s3cretvalue123", "AZURE_SPEECH_REGION": "eastus"}
    hex32, hex64 = "0123456789abcdef" * 2, "ab" * 32
    out = redact(
        "k=s3cretvalue123 r=eastus t=ya29.a0AfH6x Bearer abc.def 1//0gAbCdEfGhIjKlMnOpQrSt "
        f"c=GOCSPX-abc123def456 h={hex32} s={hex64}",
        env,
    )
    assert "s3cretvalue123" not in out and "ya29." not in out and "abc.def" not in out
    assert "1//0g" not in out and "GOCSPX-abc123def456" not in out
    assert hex32 in out and hex64 in out  # claves de caché, sha256 e ids: no se redactan (R-07)
    assert "eastus" in out  # valores de < 8 caracteres no se tocan
    assert out.count("[REDACTED]") == 5


def test_redact_reads_os_environ_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRANCES_PASSPHRASE", "correct horse battery staple xyz")
    out = redact("p=correct horse battery staple xyz")
    assert "correct horse" not in out
    assert "[REDACTED]" in out


def test_logger_filter_redacts(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    secret = "demo demo demo demo demo demo"
    monkeypatch.setenv("FRANCES_PASSPHRASE", secret)
    logger = get_logger("test-fnd04-log")
    with caplog.at_level(logging.WARNING, logger="test-fnd04-log"):
        logger.warning("pass=%s", secret)
    assert "demo demo" not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_get_logger_adds_filter_once() -> None:
    first = get_logger("test-fnd04-once")
    second = get_logger("test-fnd04-once")
    assert first is second
    assert len(first.filters) == 1
