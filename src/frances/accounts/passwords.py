"""Hash de contraseñas con argon2id (plan maestro v2, Global Constraints «Contraseñas»).

Solo se usan los parámetros por defecto de ``argon2.PasswordHasher()``. Una contraseña
nunca se loguea, se devuelve ni se guarda en claro.
"""

import unicodedata

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from frances.errors import FrancesError

MIN_LEN = 12
MAX_LEN = 128

_hasher = PasswordHasher()


class WeakPassword(FrancesError):
    """La contraseña no cumple el largo (tras NFC): salida 4."""

    exit_code = 4


def _normalize(password: str) -> str:
    return unicodedata.normalize("NFC", password)


def _dummy_hash() -> str:
    """Hash fijo para igualar el tiempo cuando el email no existe (sin cuenta real)."""
    return _hasher.hash("contraseña-ficticia-sin-cuenta")


_DUMMY_HASH: str = _dummy_hash()


def hash_password(password: str) -> str:
    """Valida el largo (tras NFC) y devuelve el hash argon2id."""
    normalized = _normalize(password)
    if not MIN_LEN <= len(normalized) <= MAX_LEN:
        raise WeakPassword(f"la contraseña debe tener entre {MIN_LEN} y {MAX_LEN} caracteres")
    return _hasher.hash(normalized)


def verify_password(stored: str, password: str) -> bool:
    """True si ``password`` coincide con ``stored``; nunca lanza (hash malformado → False)."""
    try:
        return _hasher.verify(stored, _normalize(password))
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    """True si el hash guardado usa parámetros distintos de los actuales."""
    try:
        return _hasher.check_needs_rehash(stored)
    except InvalidHashError:
        return True
