"""Repositorio de cuentas: usuarios, invitaciones y sesiones (plan SRV-03)."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import frances.accounts.repo as accounts_repo
from frances.accounts.passwords import WeakPassword
from frances.accounts.repo import (
    AccountError,
    AccountInputError,
    accept_invite,
    authenticate,
    change_password,
    create_invite,
    create_session,
    create_user,
    invite_status,
    list_invites,
    lookup_session,
    revoke_invite,
    revoke_session,
    revoke_user_sessions,
    set_disabled,
    touch_session,
)
from frances.db.store import Store
from frances.errors import FrancesError
from frances.models.ids import token_sha256

NOW = datetime(2026, 11, 2, 15, 0, tzinfo=UTC)


def test_authenticate_disabled_and_unknown(conn: sqlite3.Connection) -> None:
    u = create_user(conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    assert authenticate(conn, "ANA@ex.org", "clave muy larga 1", NOW).id == u.id  # type: ignore[union-attr]
    assert authenticate(conn, "nadie@ex.org", "clave muy larga 1", NOW) is None
    create_user(conn, "bea@ex.org", "Bea", "clave muy larga 2", "admin", NOW)
    set_disabled(conn, u.id, True, NOW)
    assert authenticate(conn, "ana@ex.org", "clave muy larga 1", NOW) is None


def test_authenticate_wrong_password_and_last_login(conn: sqlite3.Connection) -> None:
    u = create_user(conn, "ana@ex.org", "Ana", "clave muy larga 1", "user", NOW)
    assert authenticate(conn, "ana@ex.org", "clave equivocada", NOW) is None
    later = NOW + timedelta(minutes=5)
    assert authenticate(conn, "ana@ex.org", "clave muy larga 1", later) is not None
    row = conn.execute("SELECT last_login_at FROM users WHERE id = ?", (u.id,)).fetchone()
    assert row[0] is not None and row[0].startswith("2026-11-02T15:05:00")


def test_last_admin_cannot_be_disabled(conn: sqlite3.Connection) -> None:
    u = create_user(conn, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
    with pytest.raises(AccountError) as e:
        set_disabled(conn, u.id, True, NOW)
    assert e.value.code == "last_admin"


def test_disabling_user_revokes_sessions(conn: sqlite3.Connection, user_id: str) -> None:
    token, _ = create_session(conn, user_id, timedelta(days=30), NOW)
    set_disabled(conn, user_id, True, NOW)
    assert lookup_session(conn, token, NOW) is None


def test_invite_is_single_use_under_race(db_path: Path) -> None:  # REVIEW FOCUS 3 (plan maestro v2)
    seed = Store.open(db_path)
    try:
        with seed.tx() as c:
            admin = create_user(c, "ana@ex.org", "Ana", "clave muy larga 1", "admin", NOW)
            _, token = create_invite(c, admin.id, "user", None, timedelta(hours=72), NOW)
    finally:
        seed.close()

    def accept(i: int) -> object:
        s = Store.connect(db_path)
        try:
            with s.tx() as c:
                return accept_invite(c, token, f"u{i}@ex.org", "U", "clave muy larga 3", NOW, 25)
        except AccountError:
            return None
        finally:
            s.close()

    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(accept, range(4)))
    assert sum(r is not None for r in results) == 1
    check = Store.connect(db_path)
    assert check.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
    check.close()


def test_expired_or_revoked_invite_is_invalid(conn: sqlite3.Connection, admin_id: str) -> None:
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=1), NOW)
    assert invite_status(conn, token, NOW + timedelta(hours=2)) is None
    inv2, token2 = create_invite(conn, admin_id, "user", None, timedelta(hours=1), NOW)
    revoke_invite(conn, inv2.id, NOW)
    with pytest.raises(AccountError):
        accept_invite(conn, token2, "x@ex.org", "X", "clave muy larga 4", NOW, 25)


def test_invite_stores_only_hash(conn: sqlite3.Connection, admin_id: str) -> None:
    _, token = create_invite(conn, admin_id, "user", "nota", timedelta(hours=72), NOW)
    assert (
        conn.execute("SELECT COUNT(*) FROM invites WHERE token_sha256 = ?", (token,)).fetchone()[0]
        == 0
    )
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM invites WHERE token_sha256 = ?", (token_sha256(token),)
        ).fetchone()[0]
        == 1
    )
    assert invite_status(conn, token, NOW) is not None


def test_failed_weak_password_does_not_burn_invite(conn: sqlite3.Connection, admin_id: str) -> None:
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=72), NOW)
    with pytest.raises(WeakPassword):
        accept_invite(conn, token, "x@ex.org", "X", "corta", NOW, 25)
    assert invite_status(conn, token, NOW) is not None


def test_accept_invite_creates_user_with_invite_role(
    conn: sqlite3.Connection, admin_id: str
) -> None:
    inv, token = create_invite(conn, admin_id, "admin", None, timedelta(hours=72), NOW)
    user = accept_invite(conn, token, "Nueva@ex.org", "Nueva", "clave muy larga 4", NOW, 25)
    assert user.role == "admin" and user.email == "Nueva@ex.org"
    used = conn.execute("SELECT used_by FROM invites WHERE id = ?", (inv.id,)).fetchone()
    assert used[0] == user.id
    assert invite_status(conn, token, NOW) is None
    assert [i.id for i in list_invites(conn)] == [inv.id]


def test_session_lifecycle_stores_only_hash(conn: sqlite3.Connection, user_id: str) -> None:
    token, row = create_session(conn, user_id, timedelta(days=30), NOW)
    assert (
        conn.execute("SELECT COUNT(*) FROM sessions WHERE token_sha256 = ?", (token,)).fetchone()[0]
        == 0
    )
    assert lookup_session(conn, token, NOW).user.id == user_id  # type: ignore[union-attr]
    assert lookup_session(conn, token, NOW + timedelta(days=31)) is None
    revoke_session(conn, row.token_sha256, NOW)
    assert lookup_session(conn, token, NOW) is None


def test_touch_session_slides_expiry_at_most_once_a_minute(
    conn: sqlite3.Connection, user_id: str
) -> None:
    token, row = create_session(conn, user_id, timedelta(days=1), NOW)
    touch_session(conn, row.token_sha256, timedelta(days=30), NOW + timedelta(seconds=30))
    first = conn.execute(
        "SELECT expires_at FROM sessions WHERE token_sha256 = ?", (row.token_sha256,)
    ).fetchone()[0]
    assert first == row.expires_at  # menos de un minuto: sin escritura
    touch_session(conn, row.token_sha256, timedelta(days=30), NOW + timedelta(minutes=2))
    second = conn.execute(
        "SELECT expires_at FROM sessions WHERE token_sha256 = ?", (row.token_sha256,)
    ).fetchone()[0]
    assert second > first
    assert lookup_session(conn, token, NOW + timedelta(days=5)) is not None


def test_revoke_user_sessions_keeps_current(conn: sqlite3.Connection, user_id: str) -> None:
    keep, keep_row = create_session(conn, user_id, timedelta(days=1), NOW)
    other, _ = create_session(conn, user_id, timedelta(days=1), NOW)
    assert revoke_user_sessions(conn, user_id, NOW, except_sha256=keep_row.token_sha256) == 1
    assert lookup_session(conn, keep, NOW) is not None
    assert lookup_session(conn, other, NOW) is None


def test_change_password(conn: sqlite3.Connection, user_id: str) -> None:
    assert change_password(conn, user_id, "clave equivocada", "clave nueva 12345", NOW) is False
    assert change_password(conn, user_id, "clave muy larga 9", "clave nueva 12345", NOW) is True
    assert authenticate(conn, "user@ex.org", "clave nueva 12345", NOW) is not None
    with pytest.raises(WeakPassword):
        change_password(conn, user_id, "clave nueva 12345", "corta", NOW)


def test_max_users(conn: sqlite3.Connection, admin_id: str) -> None:
    _, t = create_invite(conn, admin_id, "user", None, timedelta(hours=1), NOW)
    with pytest.raises(AccountError) as e:
        accept_invite(conn, t, "x@ex.org", "X", "clave muy larga 4", NOW, max_users=1)
    assert e.value.code == "max_users"


def test_accept_invite_existing_email_same_error_as_invalid_token(
    conn: sqlite3.Connection, admin_id: str, user_id: str
) -> None:
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=72), NOW)
    with pytest.raises(AccountError) as taken:
        accept_invite(conn, token, "user@ex.org", "Otra", "clave muy larga 4", NOW, 25)
    with pytest.raises(AccountError) as bogus:
        accept_invite(
            conn, "token-que-no-existe", "nueva@ex.org", "X", "clave muy larga 4", NOW, 25
        )
    assert taken.value.code == bogus.value.code == "invite_invalid"
    assert str(taken.value) == str(bogus.value)
    assert invite_status(conn, token, NOW) is not None  # la invitación sigue sin gastar


def test_invalid_email_raises_account_input_error(conn: sqlite3.Connection) -> None:
    with pytest.raises(AccountInputError):
        create_user(conn, "no-mail", "Ana", "clave muy larga 1", "user", NOW)
    with pytest.raises(FrancesError) as e:
        create_user(conn, "no-mail", "Ana", "clave muy larga 1", "user", NOW)
    assert not isinstance(e.value, ValueError)


def test_invalid_name_raises_account_input_error(conn: sqlite3.Connection, admin_id: str) -> None:
    with pytest.raises(AccountInputError):
        create_user(conn, "ana@ex.org", "   ", "clave muy larga 1", "user", NOW)
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=72), NOW)
    with pytest.raises(AccountInputError):
        accept_invite(conn, token, "no-mail", "Ana", "clave muy larga 4", NOW, 25)


def test_touch_session_does_not_extend_expired_session(
    conn: sqlite3.Connection, user_id: str
) -> None:
    token, row = create_session(conn, user_id, timedelta(days=1), NOW)
    later = NOW + timedelta(days=2)
    touch_session(conn, row.token_sha256, timedelta(days=30), later)
    stored = conn.execute(
        "SELECT expires_at FROM sessions WHERE token_sha256 = ?", (row.token_sha256,)
    ).fetchone()[0]
    assert stored == row.expires_at
    assert lookup_session(conn, token, later) is None


def test_touch_session_does_not_extend_revoked_session(
    conn: sqlite3.Connection, user_id: str
) -> None:
    _, row = create_session(conn, user_id, timedelta(days=1), NOW)
    revoke_session(conn, row.token_sha256, NOW)
    touch_session(conn, row.token_sha256, timedelta(days=30), NOW + timedelta(minutes=5))
    stored = conn.execute(
        "SELECT expires_at FROM sessions WHERE token_sha256 = ?", (row.token_sha256,)
    ).fetchone()[0]
    assert stored == row.expires_at


def _forbidden_hash(_password: str) -> str:
    raise AssertionError("hash_password se ejecutó antes de validar la invitación")


def test_accept_invite_validates_before_hashing_password(
    conn: sqlite3.Connection, admin_id: str, user_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """El argon2id (caro) va al final: token, correo y `max_users` se comprueban antes."""
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=72), NOW)
    monkeypatch.setattr(accounts_repo, "hash_password", _forbidden_hash)

    with pytest.raises(AccountError) as bogus:
        accept_invite(
            conn, "token-que-no-existe", "nueva@ex.org", "Nueva", "clave muy larga 4", NOW, 25
        )
    assert bogus.value.code == "invite_invalid"

    with pytest.raises(WeakPassword):
        accept_invite(conn, "token-que-no-existe", "nueva@ex.org", "Nueva", "corta", NOW, 25)

    with pytest.raises(AccountError) as taken:
        accept_invite(conn, token, "user@ex.org", "Otra", "clave muy larga 4", NOW, 25)
    assert taken.value.code == "invite_invalid"

    with pytest.raises(AccountError) as capped:
        accept_invite(conn, token, "libre@ex.org", "Libre", "clave muy larga 4", NOW, max_users=1)
    assert capped.value.code == "max_users"
    assert invite_status(conn, token, NOW) is not None  # ningún intento la gastó


def test_accept_invite_hashes_password_once_when_the_invite_is_valid(
    conn: sqlite3.Connection, admin_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    real_hash = accounts_repo.hash_password

    def spy(password: str) -> str:
        calls.append(password)
        return real_hash(password)

    monkeypatch.setattr(accounts_repo, "hash_password", spy)
    _, token = create_invite(conn, admin_id, "user", None, timedelta(hours=72), NOW)
    user = accept_invite(conn, token, "nueva@ex.org", "Nueva", "clave muy larga 4", NOW, 25)

    assert calls == ["clave muy larga 4"]
    assert authenticate(conn, "nueva@ex.org", "clave muy larga 4", NOW).id == user.id  # type: ignore[union-attr]
