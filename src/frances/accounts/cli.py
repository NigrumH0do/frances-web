"""Comandos `frances admin …` para crear usuarios, invitar y deshabilitar (SRV-03).

Nunca imprime hashes ni tokens, salvo la URL de invitación (única vez que sale el token).
"""

import sqlite3
from datetime import timedelta
from pathlib import Path
from typing import Annotated, cast

import typer

from frances.accounts.repo import (
    AccountError,
    create_invite,
    create_user,
    get_user_by_email,
    set_disabled,
)
from frances.cli import DataOpt, exit_with
from frances.config import public_origin
from frances.models.accounts import Role
from frances.stage import make_context

_ROLES: tuple[str, ...] = ("admin", "user")

RoleOpt = Annotated[str, typer.Option("--role", help="admin o user")]


def _role(value: str) -> Role:
    if value not in _ROLES:
        raise typer.BadParameter("el rol debe ser admin o user")
    return cast(Role, value)


def _create_user_cmd(data: Path, email: str, name: str, role: Role, password: str) -> None:
    ctx = make_context(data)
    try:
        user = create_user(ctx.store.conn, email, name, password, role, ctx.now())
    finally:
        ctx.store.close()
    typer.echo(f"usuario creado: {user.id} ({user.role})")


def _invite_cmd(data: Path, role: Role, note: str | None) -> None:
    ctx = make_context(data)
    try:
        admin = _first_active_admin(ctx.store.conn)
        ttl = timedelta(hours=ctx.settings.server.invite_ttl_hours)
        _, token = create_invite(ctx.store.conn, admin, role, note, ttl, ctx.now())
        url = f"{public_origin(ctx.settings)}/invitacion#{token}"
    finally:
        ctx.store.close()
    typer.echo(url)


def _disable_cmd(data: Path, email: str) -> None:
    ctx = make_context(data)
    try:
        user = get_user_by_email(ctx.store.conn, email)
        if user is None:
            raise typer.BadParameter("no hay ninguna cuenta con ese correo")
        set_disabled(ctx.store.conn, user.id, True, ctx.now())
    finally:
        ctx.store.close()
    typer.echo(f"usuario deshabilitado: {user.id}")


def _first_active_admin(conn: sqlite3.Connection) -> str:
    """Id del primer admin activo: la invitación de la CLI se atribuye a él (`created_by`)."""
    row = conn.execute(
        "SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL ORDER BY created_at, id"
        " LIMIT 1"
    ).fetchone()
    if row is None:
        raise AccountError("not_found", "no hay ningún administrador activo; crea uno primero")
    return str(row[0])


def register(app: typer.Typer) -> None:
    """Registra el grupo `admin` en la CLI."""
    admin_app = typer.Typer(help="Administración de cuentas.", no_args_is_help=True)
    app.add_typer(admin_app, name="admin")

    @admin_app.command("create-user")
    def create_user_command(
        email: Annotated[str, typer.Option("--email", help="Correo del usuario")],
        name: Annotated[str, typer.Option("--name", help="Nombre a mostrar")],
        role: RoleOpt = "user",
        data: DataOpt = Path("."),
    ) -> None:
        checked = _role(role)
        password = typer.prompt("Contraseña", hide_input=True, confirmation_prompt=True)
        exit_with(lambda: _create_user_cmd(data, email, name, checked, password))

    @admin_app.command("invite")
    def invite_command(
        role: RoleOpt = "user",
        note: Annotated[str | None, typer.Option("--note", help="Nota interna")] = None,
        data: DataOpt = Path("."),
    ) -> None:
        checked = _role(role)
        exit_with(lambda: _invite_cmd(data, checked, note))

    @admin_app.command("disable")
    def disable_command(
        email: Annotated[str, typer.Option("--email", help="Correo de la cuenta")],
        data: DataOpt = Path("."),
    ) -> None:
        exit_with(lambda: _disable_cmd(data, email))
