"""Contraseñas argon2id (plan SRV-03, Global Constraints «Contraseñas»)."""

import pytest

from frances.accounts.passwords import (
    WeakPassword,
    hash_password,
    needs_rehash,
    verify_password,
)


def test_hash_is_argon2id_and_verifies() -> None:
    h = hash_password("correcto caballo bateria")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "correcto caballo bateria")
    assert not verify_password(h, "otra cosa larga")


def test_short_or_long_password_is_weak() -> None:
    with pytest.raises(WeakPassword):
        hash_password("corta")
    with pytest.raises(WeakPassword):
        hash_password("x" * 129)


def test_length_is_checked_after_nfc() -> None:
    # "é" en NFD son dos code points; el largo se mide tras NFC.
    with pytest.raises(WeakPassword):
        hash_password("e\u0301" * 6)  # 24 code points, pero 6 caracteres tras NFC
    h = hash_password("e\u0301" * 12)  # 12 caracteres tras NFC
    assert verify_password(h, "é" * 12) is True


def test_verify_never_raises_on_garbage() -> None:
    assert verify_password("no-es-un-hash", "x" * 12) is False


def test_needs_rehash_is_false_for_current_defaults() -> None:
    assert needs_rehash(hash_password("clave muy larga 1")) is False
