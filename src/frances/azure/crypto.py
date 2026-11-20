"""Cifrado en reposo con Fernet (``cryptography``) para claves de Azure en SQLite (ADR-022)."""

from __future__ import annotations

import base64
import binascii
import hashlib
from collections.abc import Mapping

from cryptography.fernet import Fernet, InvalidToken


class SecretsKeyMissingError(RuntimeError):
    """Falta ``FRANCES_SECRETS_KEY`` para cifrar o descifrar credenciales en SQLite."""


def fernet_from_env(env: Mapping[str, str]) -> Fernet | None:
    """Construye un ``Fernet`` desde ``FRANCES_SECRETS_KEY``, o ``None`` si falta."""
    raw = (env.get("FRANCES_SECRETS_KEY") or "").strip()
    if not raw:
        return None
    raw_bytes = raw.encode("utf-8")
    try:
        decoded = base64.urlsafe_b64decode(raw_bytes)
        if len(decoded) == 32:
            return Fernet(raw_bytes)
    except (binascii.Error, ValueError):
        pass
    derived = base64.urlsafe_b64encode(hashlib.sha256(raw_bytes).digest())
    return Fernet(derived)


def require_fernet(env: Mapping[str, str]) -> Fernet:
    """Devuelve ``Fernet`` o lanza :class:`SecretsKeyMissingError`."""
    fernet = fernet_from_env(env)
    if fernet is None:
        raise SecretsKeyMissingError(
            "Configura FRANCES_SECRETS_KEY en el entorno del servidor para guardar claves de Azure."
        )
    return fernet


def encrypt_secret(fernet: Fernet, secret: str) -> str:
    """Cifra un secreto en UTF-8 y devuelve el token Fernet en texto ASCII."""
    return fernet.encrypt(secret.encode("utf-8")).decode("ascii")


def decrypt_secret(fernet: Fernet, token: str) -> str:
    """Descifra un token Fernet; ``ValueError`` si el token no corresponde a la clave."""
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("no se pudo descifrar la clave de Azure con FRANCES_SECRETS_KEY") from exc


def mask_key(secret: str) -> str:
    """Máscara segura para UI: nunca revela más de los últimos 4 caracteres."""
    clean = secret.strip()
    if len(clean) >= 4:
        return "••••" + clean[-4:]
    return "••••"
