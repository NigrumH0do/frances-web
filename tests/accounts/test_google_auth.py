"""Pruebas unitarias del repositorio de cuentas para Google OIDC y aprobación admin."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from frances.accounts.repo import (
    OAUTH_ONLY_PASSWORD_HASH,
    approve_user,
    authenticate,
    consume_oauth_state,
    create_session,
    create_user,
    list_users,
    login_or_register_google,
    lookup_session,
    save_oauth_state,
    set_disabled,
)
from frances.db.store import Store
from frances.timeutil import format_ts

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def test_google_new_user_starts_pending_unless_bootstrap_admin(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        user, active = login_or_register_google(
            store.conn,
            email="student@gmail.com",
            google_sub="sub-student",
            display_name="Estudiante Demo",
            avatar_url="https://example.test/avatar.png",
            admin_emails={"boss@uni.example.edu"},
            now=NOW,
        )
        assert user.status == "pending"
        assert user.auth_provider == "google"
        assert active is False
        assert authenticate(store.conn, "student@gmail.com", "cualquier clave larga", NOW) is None

        admin, admin_active = login_or_register_google(
            store.conn,
            email="BOSS@uni.example.edu",
            google_sub="sub-admin",
            display_name="Profe Admin",
            avatar_url=None,
            admin_emails={"boss@uni.example.edu"},
            now=NOW,
        )
        assert admin.role == "admin" and admin.status == "active" and admin_active is True

        approved = approve_user(store.conn, user.id, NOW)
        assert approved.status == "active" and approved.disabled is False
        token, _ = create_session(store.conn, approved.id, timedelta(days=1), NOW)
        assert lookup_session(store.conn, token, NOW) is not None

        set_disabled(store.conn, approved.id, True, NOW)
        assert lookup_session(store.conn, token, NOW) is None
        _, still_active = login_or_register_google(
            store.conn,
            email="student@gmail.com",
            google_sub="sub-student",
            display_name="Estudiante Demo",
            avatar_url=None,
            admin_emails=set(),
            now=NOW,
        )
        assert still_active is False
        assert [u.id for u in list_users(store.conn, status="disabled")] == [approved.id]
    finally:
        store.close()


def test_google_links_existing_local_account_and_keeps_password(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        local = create_user(store.conn, "ana@ex.org", "Ana", "clave muy larga 1", "user", NOW)
        linked, active = login_or_register_google(
            store.conn,
            email="ana@ex.org",
            google_sub="sub-ana",
            display_name="Ana Google",
            avatar_url=None,
            admin_emails=set(),
            now=NOW,
        )
        assert linked.id == local.id
        assert linked.auth_provider == "both"
        assert active is True
        pwd_row = store.conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (local.id,)
        ).fetchone()
        assert pwd_row is not None and pwd_row[0] != OAUTH_ONLY_PASSWORD_HASH
        assert authenticate(store.conn, "ana@ex.org", "clave muy larga 1", NOW) is not None
    finally:
        store.close()


def test_oauth_state_is_single_use_and_expires(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        save_oauth_state(
            store.conn,
            state="st-1",
            code_verifier="ver-1",
            next_path="/repasar",
            created_at=format_ts(NOW),
            expires_at=format_ts(NOW + timedelta(minutes=10)),
        )
        assert consume_oauth_state(store.conn, "st-1", NOW + timedelta(minutes=1)) == (
            "ver-1",
            "/repasar",
        )
        assert consume_oauth_state(store.conn, "st-1", NOW + timedelta(minutes=1)) is None

        save_oauth_state(
            store.conn,
            state="st-old",
            code_verifier="ver-old",
            next_path="/",
            created_at=format_ts(NOW),
            expires_at=format_ts(NOW + timedelta(minutes=5)),
        )
        assert consume_oauth_state(store.conn, "st-old", NOW + timedelta(minutes=6)) is None
    finally:
        store.close()
