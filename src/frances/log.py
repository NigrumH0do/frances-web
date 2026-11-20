"""Logging con redacción de secretos (toda salida pasa por :func:`redact`)."""

import logging
import os
import re
import threading
from collections.abc import Mapping

SENSITIVE_ENV: tuple[str, ...] = (
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_LOGIN_CLIENT_ID",
    "GOOGLE_LOGIN_CLIENT_SECRET",
    "AZURE_SPEECH_KEY",
    "AZURE_TRANSLATOR_KEY",
    "FRANCES_PASSPHRASE",
    "FRANCES_SECRETS_KEY",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "FRANCES_BACKUP_ACCESS_KEY_ID",
    "FRANCES_BACKUP_SECRET_ACCESS_KEY",
)

_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"ya29\.[\w-]+"),
    re.compile(r"1//[\w-]{20,}"),
    re.compile(r"Bearer\s+\S+"),
    re.compile(r"GOCSPX-[\w-]+"),
)

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_runtime_lock = threading.Lock()
_runtime_secrets: set[str] = set()


def register_runtime_secret(value: str) -> None:
    """Registra en memoria un secreto descifrado (p. ej. de Azure DB) para redactarlo en logs."""
    cleaned = value.strip()
    if len(cleaned) < 8:
        return
    with _runtime_lock:
        if len(_runtime_secrets) < 256:
            _runtime_secrets.add(cleaned)


def redact(text: str, env: Mapping[str, str] | None = None) -> str:
    """Reemplaza por ``[REDACTED]`` los valores sensibles (>= 8 caracteres) y patrones.

    Sin patrón genérico de hex (R-07): claves de caché, sha256 e ids no se tocan.
    ``env=None`` lee ``os.environ``.
    """
    source = os.environ if env is None else env
    secret_set = {
        value for key, value in source.items() if key in SENSITIVE_ENV and len(value) >= 8
    }
    with _runtime_lock:
        secret_set.update(_runtime_secrets)
    values = sorted(secret_set, key=len, reverse=True)
    out = text
    for value in values:
        out = out.replace(value, "[REDACTED]")
    for pattern in _PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


class RedactFilter(logging.Filter):
    """Filtro que redacta el mensaje ya formateado y vacía los args."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = ()
        return True


def get_logger(name: str) -> logging.Logger:
    """Logger con formato común y :class:`RedactFilter` (agregado una sola vez)."""
    logger = logging.getLogger(name)
    if not any(isinstance(existing, RedactFilter) for existing in logger.filters):
        logger.addFilter(RedactFilter())
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(_LOG_FORMAT))
        logger.addHandler(handler)
    return logger
