"""Repositorio de cuentas, invitaciones y sesiones sobre SQLite (plan SRV-03).

Las funciones reciben una conexión ya abierta. Las escrituras de varios pasos abren su
propia transacción `BEGIN IMMEDIATE` si el llamador no tiene una abierta, así una
invitación nunca queda consumida a medias.
"""

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from frances.accounts.passwords import (
    _DUMMY_HASH,
    MAX_LEN,
    MIN_LEN,
    _normalize,
    hash_password,
    needs_rehash,
    verify_password,
)
from frances.errors import FrancesError
from frances.models.accounts import InviteOut, Role, UserOut
from frances.models.ids import new_invite_id, new_secret_token, new_user_id
from frances.models.ids import token_sha256 as _sha256
from frances.textnorm import display_clean
from frances.timeutil import format_ts, parse_ts

AccountCode = Literal["email_taken", "invite_invalid", "last_admin", "max_users", "not_found"]

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_NAME_MAX = 80

_USER_COLUMNS = "id, email, display_name, role, created_at, last_login_at, disabled_at"
_INVITE_COLUMNS = "id, role, note, created_at, expires_at, used_at, revoked_at"


class AccountError(FrancesError):
    """Error de cuentas con código estable para la API (salida 1)."""

    def __init__(self, code: AccountCode, message: str) -> None:
        super().__init__(message)
        self.code: AccountCode = code


class AccountInputError(FrancesError):
    """Dato de cuenta mal formado (correo o nombre). Salida 1, sin traceback en la CLI."""


@dataclass(frozen=True)
class SessionRow:
    token_sha256: str
    user: UserOut
    csrf_token: str
    expires_at: str


@contextmanager
def _write(conn: sqlite3.Connection) -> Iterator[None]:
    """Transacción de escritura; reutiliza la del llamador si ya hay una abierta."""
    if conn.in_transaction:
        yield
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _clean_email(raw: str) -> str:
    email = raw.strip()
    if not _EMAIL_RE.fullmatch(email):
        raise AccountInputError("correo no válido")
    return email


def _clean_email_or_none(raw: str) -> str | None:
    email = raw.strip()
    return email if _EMAIL_RE.fullmatch(email) else None


def _clean_name(raw: str) -> str:
    name = display_clean(raw)
    if not 1 <= len(name) <= _NAME_MAX:
        raise AccountInputError(f"el nombre debe tener entre 1 y {_NAME_MAX} caracteres")
    return name


def _user(row: tuple[object, ...]) -> UserOut:
    return UserOut(
        id=str(row[0]),
        email=str(row[1]),
        display_name=str(row[2]),
        role=row[3],  # type: ignore[arg-type]
        created_at=str(row[4]),
        last_login_at=None if row[5] is None else str(row[5]),
        disabled=row[6] is not None,
    )


def _invite(row: tuple[object, ...]) -> InviteOut:
    return InviteOut(
        id=str(row[0]),
        role=row[1],  # type: ignore[arg-type]
        note=None if row[2] is None else str(row[2]),
        created_at=str(row[3]),
        expires_at=str(row[4]),
        used_at=None if row[5] is None else str(row[5]),
        revoked_at=None if row[6] is None else str(row[6]),
    )


def _email_exists(conn: sqlite3.Connection, email: str) -> bool:
    row = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    return row is not None


# ---- usuarios -------------------------------------------------------------------------


def create_user(
    conn: sqlite3.Connection,
    email: str,
    display_name: str,
    password: str,
    role: Role,
    now: datetime,
    invited_by: str | None = None,
) -> UserOut:
    clean_email = _clean_email(email)
    name = _clean_name(display_name)
    password_hash = hash_password(password)  # WeakPassword antes de tocar la base
    user_id = new_user_id()
    with _write(conn):
        if _email_exists(conn, clean_email):
            raise AccountError("email_taken", "el correo ya tiene una cuenta")
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, invited_by,"
            " created_at, last_login_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
            (user_id, clean_email, name, password_hash, role, invited_by, format_ts(now)),
        )
    user = get_user(conn, user_id)
    assert user is not None
    return user


def get_user(conn: sqlite3.Connection, user_id: str) -> UserOut | None:
    row = conn.execute(f"SELECT {_USER_COLUMNS} FROM users WHERE id = ?", (user_id,)).fetchone()
    return None if row is None else _user(tuple(row))


def get_user_by_email(conn: sqlite3.Connection, email: str) -> UserOut | None:
    clean = _clean_email_or_none(email)
    if clean is None:
        return None
    row = conn.execute(f"SELECT {_USER_COLUMNS} FROM users WHERE email = ?", (clean,)).fetchone()
    return None if row is None else _user(tuple(row))


def list_users(conn: sqlite3.Connection) -> list[UserOut]:
    rows = conn.execute(f"SELECT {_USER_COLUMNS} FROM users ORDER BY created_at, id").fetchall()
    return [_user(tuple(row)) for row in rows]


def authenticate(
    conn: sqlite3.Connection, email: str, password: str, now: datetime
) -> UserOut | None:
    """Devuelve el usuario si el correo y la contraseña coinciden y la cuenta está activa.

    Siempre hace exactamente una verificación argon2: contra el hash del usuario o contra
    un hash ficticio si el correo no existe, para que el tiempo no revele cuentas.
    """
    clean = _clean_email_or_none(email)
    row = None
    if clean is not None:
        row = conn.execute(
            "SELECT id, password_hash, disabled_at FROM users WHERE email = ?", (clean,)
        ).fetchone()
    if row is None:
        verify_password(_DUMMY_HASH, password)
        return None
    user_id, stored, disabled_at = str(row[0]), str(row[1]), row[2]
    ok = verify_password(stored, password)
    if not ok or disabled_at is not None:
        return None
    with _write(conn):
        normalized = _normalize(password)
        if needs_rehash(stored) and MIN_LEN <= len(normalized) <= MAX_LEN:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(password), user_id),
            )
        conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (format_ts(now), user_id))
    return get_user(conn, user_id)


def set_disabled(conn: sqlite3.Connection, user_id: str, disabled: bool, now: datetime) -> UserOut:
    """Deshabilita o reactiva una cuenta. Deshabilitar revoca sus sesiones."""
    with _write(conn):
        row = conn.execute(
            "SELECT role, disabled_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise AccountError("not_found", "usuario no encontrado")
        role, current = str(row[0]), row[1]
        if disabled:
            if role == "admin" and current is None:
                others = conn.execute(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL"
                    " AND id <> ?",
                    (user_id,),
                ).fetchone()[0]
                if others == 0:
                    raise AccountError(
                        "last_admin", "no se puede deshabilitar al último administrador activo"
                    )
            if current is None:
                conn.execute(
                    "UPDATE users SET disabled_at = ? WHERE id = ?", (format_ts(now), user_id)
                )
            revoke_user_sessions(conn, user_id, now)
        else:
            conn.execute("UPDATE users SET disabled_at = NULL WHERE id = ?", (user_id,))
    user = get_user(conn, user_id)
    assert user is not None
    return user


def change_password(
    conn: sqlite3.Connection, user_id: str, current: str, new: str, now: datetime
) -> bool:
    """Cambia la contraseña si ``current`` es correcta. False si no lo es."""
    new_hash = hash_password(new)  # WeakPassword antes de verificar nada
    with _write(conn):
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AccountError("not_found", "usuario no encontrado")
        if not verify_password(str(row[0]), current):
            return False
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user_id))
    return True


# ---- invitaciones ---------------------------------------------------------------------


def create_invite(
    conn: sqlite3.Connection,
    created_by: str,
    role: Role,
    note: str | None,
    ttl: timedelta,
    now: datetime,
) -> tuple[InviteOut, str]:
    """Crea una invitación. El token en claro sale una sola vez; en la base solo su hash."""
    invite_id = new_invite_id()
    token = new_secret_token()
    clean_note = note.strip() if note is not None and note.strip() else None
    created = format_ts(now)
    expires = format_ts(now + ttl)
    with _write(conn):
        conn.execute(
            "INSERT INTO invites (id, token_sha256, role, note, created_by, created_at,"
            " expires_at, used_at, used_by, revoked_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
            (invite_id, _sha256(token), role, clean_note, created_by, created, expires),
        )
    invite = InviteOut(
        id=invite_id,
        role=role,
        note=clean_note,
        created_at=created,
        expires_at=expires,
        used_at=None,
        revoked_at=None,
    )
    return invite, token


def invite_status(conn: sqlite3.Connection, token: str, now: datetime) -> InviteOut | None:
    """La invitación si existe, no está usada, revocada ni vencida; si no, None."""
    row = conn.execute(
        f"SELECT {_INVITE_COLUMNS} FROM invites WHERE token_sha256 = ?"
        " AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        (_sha256(token), format_ts(now)),
    ).fetchone()
    return None if row is None else _invite(tuple(row))


def accept_invite(
    conn: sqlite3.Connection,
    token: str,
    email: str,
    display_name: str,
    password: str,
    now: datetime,
    max_users: int,
) -> UserOut:
    """Crea el usuario de la invitación y la marca usada, en una sola transacción.

    La contraseña se valida antes de tocar la invitación. El `UPDATE` condicional
    es la barrera: si no cambia exactamente una fila, otra aceptación ganó la carrera.
    """
    clean_email = _clean_email(email)
    name = _clean_name(display_name)
    password_hash = hash_password(password)
    digest = _sha256(token)
    now_s = format_ts(now)
    user_id = new_user_id()
    with _write(conn):
        invite = conn.execute(
            "SELECT role, created_by FROM invites WHERE token_sha256 = ?"
            " AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
            (digest, now_s),
        ).fetchone()
        # Un correo ya registrado responde igual que un token inválido: no revela cuentas
        # y no consume la invitación (la transacción se revierte al salir con error).
        if invite is None or _email_exists(conn, clean_email):
            raise AccountError("invite_invalid", "la invitación no es válida")
        total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if total >= max_users:
            raise AccountError("max_users", "se alcanzó el número máximo de usuarios")
        conn.execute(
            "INSERT INTO users (id, email, display_name, password_hash, role, invited_by,"
            " created_at, last_login_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
            (user_id, clean_email, name, password_hash, str(invite[0]), str(invite[1]), now_s),
        )
        claimed = conn.execute(
            "UPDATE invites SET used_at = ?, used_by = ? WHERE token_sha256 = ?"
            " AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
            (now_s, user_id, digest, now_s),
        )
        if claimed.rowcount != 1:
            raise AccountError("invite_invalid", "la invitación no es válida")
    user = get_user(conn, user_id)
    assert user is not None
    return user


def revoke_invite(conn: sqlite3.Connection, invite_id: str, now: datetime) -> None:
    with _write(conn):
        row = conn.execute(
            "SELECT used_at, revoked_at FROM invites WHERE id = ?", (invite_id,)
        ).fetchone()
        if row is None:
            raise AccountError("not_found", "invitación no encontrada")
        if row[0] is not None:
            raise AccountError("invite_invalid", "la invitación ya fue usada")
        if row[1] is None:
            conn.execute(
                "UPDATE invites SET revoked_at = ? WHERE id = ?", (format_ts(now), invite_id)
            )


def list_invites(conn: sqlite3.Connection) -> list[InviteOut]:
    rows = conn.execute(f"SELECT {_INVITE_COLUMNS} FROM invites ORDER BY created_at, id").fetchall()
    return [_invite(tuple(row)) for row in rows]


# ---- sesiones -------------------------------------------------------------------------


def create_session(
    conn: sqlite3.Connection, user_id: str, ttl: timedelta, now: datetime
) -> tuple[str, SessionRow]:
    """Crea una sesión. El token en claro se devuelve una vez; en la base solo su hash."""
    user = get_user(conn, user_id)
    if user is None or user.disabled:
        raise AccountError("not_found", "usuario no encontrado")
    token = new_secret_token()
    csrf = new_secret_token()
    digest = _sha256(token)
    created = format_ts(now)
    expires = format_ts(now + ttl)
    with _write(conn):
        conn.execute(
            "INSERT INTO sessions (token_sha256, user_id, csrf_token, created_at,"
            " last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
            (digest, user_id, csrf, created, created, expires),
        )
    return token, SessionRow(token_sha256=digest, user=user, csrf_token=csrf, expires_at=expires)


def lookup_session(conn: sqlite3.Connection, token: str, now: datetime) -> SessionRow | None:
    """La sesión vigente del token, o None si no existe, está revocada, vencida o el
    usuario está deshabilitado. La búsqueda es por hash (índice), no por comparación."""
    row = conn.execute(
        "SELECT s.token_sha256, s.csrf_token, s.expires_at, u.id, u.email, u.display_name,"
        " u.role, u.created_at, u.last_login_at"
        " FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token_sha256 = ? AND s.revoked_at IS NULL AND s.expires_at > ?"
        " AND u.disabled_at IS NULL",
        (_sha256(token), format_ts(now)),
    ).fetchone()
    if row is None:
        return None
    user = UserOut(
        id=str(row[3]),
        email=str(row[4]),
        display_name=str(row[5]),
        role=row[6],
        created_at=str(row[7]),
        last_login_at=None if row[8] is None else str(row[8]),
        disabled=False,
    )
    return SessionRow(
        token_sha256=str(row[0]), user=user, csrf_token=str(row[1]), expires_at=str(row[2])
    )


_TOUCH_INTERVAL = timedelta(minutes=1)


def touch_session(
    conn: sqlite3.Connection, token_sha256: str, ttl: timedelta, now: datetime
) -> None:
    """Desliza la caducidad; escribe como mucho una vez por minuto por sesión."""
    with _write(conn):
        row = conn.execute(
            "SELECT last_seen_at FROM sessions WHERE token_sha256 = ? AND revoked_at IS NULL"
            " AND expires_at > ?",
            (token_sha256, format_ts(now)),
        ).fetchone()
        if row is None or now - parse_ts(str(row[0])) < _TOUCH_INTERVAL:
            return
        conn.execute(
            "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_sha256 = ?",
            (format_ts(now), format_ts(now + ttl), token_sha256),
        )


def revoke_session(conn: sqlite3.Connection, token_sha256: str, now: datetime) -> None:
    with _write(conn):
        conn.execute(
            "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_sha256 = ?",
            (format_ts(now), token_sha256),
        )


def revoke_user_sessions(
    conn: sqlite3.Connection,
    user_id: str,
    now: datetime,
    except_sha256: str | None = None,
) -> int:
    """Revoca las sesiones activas del usuario, salvo ``except_sha256``. Devuelve cuántas."""
    with _write(conn):
        cursor = conn.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
            " AND token_sha256 IS NOT ?",
            (format_ts(now), user_id, except_sha256),
        )
        return cursor.rowcount
