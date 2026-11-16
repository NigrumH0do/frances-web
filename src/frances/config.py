"""Configuración: TOML (``frances.toml``) + secretos solo por entorno."""

import os
import re
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, field_validator

from frances.errors import ConfigError
from frances.log import redact
from frances.paths import DataPaths

_HHMM = re.compile(r"\d{2}:\d{2}", re.ASCII)


def _check_hhmm(value: str) -> str:
    if not _HHMM.fullmatch(value):
        raise ValueError("la hora debe tener formato HH:MM")
    return value


class ClassroomSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_course_ids: list[str] = Field(default_factory=list)
    include_name_regex: str = "(?i)fran"
    max_download_mb: int = 50


class CardsSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    llm: Literal["auto", "off"] = "auto"
    llm_daily_item_limit: int = 30
    vocab_per_item_max: int = 25


class AudioSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fixed_voices: list[str] = Field(
        default_factory=lambda: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"]
    )
    rotating: int = 1
    azure_tts_monthly_char_cap: int = 450000
    max_clips_per_run: int = 3000


class TranslatorSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    monthly_char_cap: int = 1800000


class BundleSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    salt: str = ""
    iterations: int = 600000
    max_total_mb: int = 900


class ServerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_ttl_days: int = 30
    invite_ttl_hours: int = 72
    login_max_per_minute: int = 5
    max_users: int = 25


class LlmSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["auto", "off"] = "auto"
    max_calls_per_day: int = 300
    timeout_s: int = 120


class JobsSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_attempts: int = 5
    backoff_base_s: int = 60
    backoff_cap_s: int = 3600
    poll_s: float = 5


class SchedulerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: str = "America/Bogota"
    daily_at: str = "05:17"
    reconcile_weekday: int = Field(default=6, ge=0, le=6)
    reconcile_at: str = "06:00"
    auth_check_at: str = "05:00"
    plan_at: str = "05:45"
    catchup_hours: int = 12

    @field_validator("daily_at", "reconcile_at", "auth_check_at", "plan_at")
    @classmethod
    def _hhmm(cls, value: str) -> str:
        return _check_hhmm(value)

    @field_validator("timezone")
    @classmethod
    def _zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("zona horaria desconocida") from exc
        return value


class BackupSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: str = "04:30"
    retention_days: int = 14
    prefix: str = "frances/"

    @field_validator("at")
    @classmethod
    def _hhmm(cls, value: str) -> str:
        return _check_hhmm(value)

    @field_validator("prefix")
    @classmethod
    def _prefix(cls, value: str) -> str:
        if not value.endswith("/"):
            raise ValueError("prefix debe terminar en /")
        return value


class Settings(BaseModel):
    """Un atributo anidado por sección del TOML (R-08)."""

    model_config = ConfigDict(extra="forbid")

    classroom: ClassroomSettings = Field(default_factory=ClassroomSettings)
    cards: CardsSettings = Field(default_factory=CardsSettings)
    audio: AudioSettings = Field(default_factory=AudioSettings)
    translator: TranslatorSettings = Field(default_factory=TranslatorSettings)
    bundle: BundleSettings = Field(default_factory=BundleSettings)
    server: ServerSettings = Field(default_factory=ServerSettings)
    llm: LlmSettings = Field(default_factory=LlmSettings)
    jobs: JobsSettings = Field(default_factory=JobsSettings)
    scheduler: SchedulerSettings = Field(default_factory=SchedulerSettings)
    backup: BackupSettings = Field(default_factory=BackupSettings)

    _env: Mapping[str, str] = PrivateAttr(default_factory=dict)

    def secret(self, name: str) -> str:
        """Secreto obligatorio del entorno; falta → ``ConfigError``."""
        value = self._env.get(name)
        if value is None:
            raise ConfigError(f"falta la variable {name}")
        return value

    def optional_secret(self, name: str) -> str | None:
        """Secreto opcional del entorno; falta → ``None``."""
        return self._env.get(name)


def load_settings(path: Path, env: Mapping[str, str]) -> Settings:
    """Carga el TOML; archivo inexistente → defaults.

    TOML inválido o claves/valores desconocidos → ``ConfigError`` (sin valores).
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        settings = Settings()
        settings._env = dict(env)
        return settings
    except OSError as exc:
        raise ConfigError(f"no se pudo leer {path}: {redact(str(exc), env)}") from exc
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"TOML inválido en {path}: {redact(str(exc), env)}") from exc
    try:
        settings = Settings.model_validate(data)
    except ValidationError as exc:
        raise ConfigError(f"config inválida en {path}: {redact(str(exc), env)}") from exc
    settings._env = dict(env)
    return settings


def resolve_state_db(paths: DataPaths, env: Mapping[str, str]) -> Path:
    """``FRANCES_STATE_DB`` del ``env`` recibido o ``paths.state_db`` v1 (R-36)."""
    value = env.get("FRANCES_STATE_DB")
    return Path(value) if value else paths.state_db


def resolve_data_dir(env: Mapping[str, str], default: Path) -> Path:
    """``FRANCES_DATA_DIR`` del ``env`` recibido o ``default``."""
    value = env.get("FRANCES_DATA_DIR")
    return Path(value) if value else default


def process_env() -> dict[str, str]:
    """Copia del entorno del proceso: única lectura de ``os.environ`` fuera de los módulos v1."""
    return dict(os.environ)


_LOCAL_HTTP_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def public_origin(settings: Settings) -> str:
    """``FRANCES_PUBLIC_ORIGIN`` validado, sin path, query ni fragmento.

    En cualquier host el esquema es ``https``. ``http`` solo se acepta en
    ``localhost``, ``127.0.0.1`` y ``::1``, para probar en la máquina.
    Falta o inválido → ``ConfigError`` (el mensaje no incluye el valor).
    """
    value = settings.optional_secret("FRANCES_PUBLIC_ORIGIN")
    if value is None:
        raise ConfigError("falta la variable FRANCES_PUBLIC_ORIGIN")
    error = ConfigError("FRANCES_PUBLIC_ORIGIN debe ser https://host[:puerto] sin path")
    try:
        parts = urlsplit(value)
        _ = parts.port
    except ValueError as exc:
        raise error from exc
    local_http = parts.scheme == "http" and parts.hostname in _LOCAL_HTTP_HOSTS
    if (
        not (parts.scheme == "https" or local_http)
        or not parts.netloc
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.path
        or parts.query
        or parts.fragment
    ):
        raise error
    return value
