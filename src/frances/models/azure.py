"""Contratos del pool multicuenta de Azure Speech y Translator (ADR-022, CHG-24)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AzureAccountKind = Literal["speech", "translator"]
AzurePoolStrategy = Literal["priority", "least_used"]
AzureAccountSource = Literal["db", "env"]


class AzureAccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str = Field(min_length=1, max_length=80)
    kind: AzureAccountKind
    region: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9-]+$")
    api_key: str = Field(min_length=8, max_length=256)
    priority: int = Field(default=100, ge=1, le=10_000)
    enabled: bool = True
    monthly_stt_seconds_cap: int = Field(default=16_200, ge=0, le=10_000_000)
    monthly_tts_chars_cap: int = Field(default=450_000, ge=0, le=100_000_000)
    monthly_translator_chars_cap: int = Field(default=1_800_000, ge=0, le=100_000_000)


class AzureAccountPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str | None = Field(default=None, min_length=1, max_length=80)
    region: str | None = Field(default=None, min_length=1, max_length=40, pattern=r"^[a-z0-9-]+$")
    api_key: str | None = Field(default=None, min_length=8, max_length=256)
    priority: int | None = Field(default=None, ge=1, le=10_000)
    enabled: bool | None = None
    monthly_stt_seconds_cap: int | None = Field(default=None, ge=0, le=10_000_000)
    monthly_tts_chars_cap: int | None = Field(default=None, ge=0, le=100_000_000)
    monthly_translator_chars_cap: int | None = Field(default=None, ge=0, le=100_000_000)


class AzureAccountUsage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    stt_seconds: int = 0
    tts_chars: int = 0
    translator_chars: int = 0


class AzureAccountOut(BaseModel):
    """Vista pública de cuenta Azure: nunca expone la clave ni el ciphertext."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    label: str
    kind: AzureAccountKind
    region: str
    key_hint: str
    enabled: bool
    priority: int
    monthly_stt_seconds_cap: int
    monthly_tts_chars_cap: int
    monthly_translator_chars_cap: int
    cooldown_until: str | None = None
    last_error: str | None = None
    last_error_at: str | None = None
    last_used_at: str | None = None
    usage: AzureAccountUsage
    source: AzureAccountSource = "db"


class AzurePoolSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    strategy: AzurePoolStrategy
    month: str
    speech_accounts: int
    speech_active: int
    translator_accounts: int
    translator_active: int
    stt_seconds_used: int
    stt_seconds_cap: int
    tts_chars_used: int
    tts_chars_cap: int
    translator_chars_used: int
    translator_chars_cap: int
    encryption_ready: bool


class AzureStrategyPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    strategy: AzurePoolStrategy


class AzureTestResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    status_code: int | None = None
    latency_ms: int = 0
    detail: str


class SpeechUsageIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    account_id: str = Field(min_length=1, max_length=80)
    seconds: int = Field(ge=1, le=600)
