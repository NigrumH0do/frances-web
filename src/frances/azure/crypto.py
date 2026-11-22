"""Cifrado en reposo con Fernet (``cryptography``) para claves de Azure en SQLite (ADR-022)."""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping

from cryptography.fernet import Fernet, InvalidToken

#: Longitud en bytes de la clave que espera ``Fernet`` (32 bytes en base64 urlsafe).
_KEY_BYTES = 32


class SecretsKeyMissingError(RuntimeError):
    """Falta ``FRANCES_SECRETS_KEY`` para cifrar o descifrar credenciales en SQLite."""


class SecretsKeyInvalidError(SecretsKeyMissingError, ValueError):
    """``FRANCES_SECRETS_KEY`` está definida pero no es una clave Fernet válida.

    Hereda de :class:`SecretsKeyMissingError` para que quien ya responde ``503``
    ante la ausencia de la clave responda igual ante una clave malformada, y de
    ``ValueError`` porque el valor recibido no sirve. El mensaje nunca incluye la
    clave.
    """


def _invalid_key_error() -> SecretsKeyInvalidError:
    return SecretsKeyInvalidError(
        "FRANCES_SECRETS_KEY no es una clave Fernet válida: debe ser base64 urlsafe de 32 "
        "bytes. Genera una con: python -c 'from cryptography.fernet import Fernet; "
        "print(Fernet.generate_key().decode())'"
    )


def fernet_from_env(env: Mapping[str, str]) -> Fernet | None:
    """Construye un ``Fernet`` desde ``FRANCES_SECRETS_KEY``.

    Devuelve ``None`` si la variable falta y lanza :class:`SecretsKeyInvalidError`
    si está definida pero no es una clave Fernet válida (base64 urlsafe que
    decodifica a exactamente 32 bytes). No se deriva ninguna clave a partir de
    una frase: una clave mal escrita es un error de configuración, no un secreto
    distinto.
    """
    raw = (env.get("FRANCES_SECRETS_KEY") or "").strip()
    if not raw:
        return None
    raw_bytes = raw.encode("utf-8")
    try:
        decoded = base64.b64decode(raw_bytes, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        raise _invalid_key_error() from None
    if len(decoded) != _KEY_BYTES:
        raise _invalid_key_error()
    # Ya validado: Fernet acepta cualquier clave de exactamente 32 bytes.
    return Fernet(raw_bytes)


def require_fernet(env: Mapping[str, str]) -> Fernet:
    """Devuelve ``Fernet`` o lanza :class:`SecretsKeyMissingError`/``InvalidError``."""
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
