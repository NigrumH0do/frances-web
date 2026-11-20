"""Contratos v2 de cuentas, sesiones e invitaciones (plan maestro v2, CHG-05)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

Role = Literal["admin", "user"]
UserStatus = Literal["active", "pending", "disabled"]
AuthProvider = Literal["local", "google", "both"]


class UserOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    email: str
    display_name: str
    role: Role
    created_at: str
    last_login_at: str | None
    disabled: bool
    status: UserStatus = "active"
    auth_provider: AuthProvider = "local"
    avatar_url: str | None = None


class AuthProvidersOut(BaseModel):
    """Proveedores de autenticación habilitados en este despliegue."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    google_enabled: bool
    password_enabled: bool = True


class Me(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    user: UserOut
    csrf_token: str


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    email: str
    password: str


class InviteCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    token: str


class InviteStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    valid: bool
    expires_at: str | None


class AcceptInviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    token: str
    email: str
    display_name: str
    password: str


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    current_password: str
    new_password: str


class CreateInviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Role = "user"
    note: str | None = None
    ttl_hours: int | None = None  # None → server.invite_ttl_hours


class InviteOut(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    role: Role
    note: str | None
    created_at: str
    expires_at: str
    used_at: str | None
    revoked_at: str | None


class InviteCreated(BaseModel):
    """``url`` = f"{FRANCES_PUBLIC_ORIGIN}/invitacion#{token}"; el token solo se muestra aquí."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    invite: InviteOut
    url: str
