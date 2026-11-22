"""Pool multicuenta de Azure Speech y Translator: CRUD, cuotas y failover (ADR-022).

El enfriamiento de las cuentas guardadas en la base vive en
``azure_accounts.cooldown_until``. El del respaldo del entorno (``env-speech`` y
``env-translator``, que no tienen fila propia) vive en memoria con un lock y
queda acotado a la base donde se registró, igual que los medidores de uso.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from cryptography.fernet import Fernet

from frances.azure.crypto import (
    SecretsKeyInvalidError,
    decrypt_secret,
    encrypt_secret,
    fernet_from_env,
    mask_key,
    require_fernet,
)
from frances.db.usage import current_month, usage_add, usage_get
from frances.log import get_logger, redact, register_runtime_secret
from frances.models.azure import (
    AzureAccountIn,
    AzureAccountKind,
    AzureAccountOut,
    AzureAccountPatch,
    AzureAccountUsage,
    AzurePoolStrategy,
    AzurePoolSummary,
)
from frances.timeutil import format_ts

ENV_SPEECH_ID = "env-speech"
ENV_TRANSLATOR_ID = "env-translator"

_STRATEGY_SETTING_KEY = "azure_pool_strategy"
_METER_FIELDS = {
    "stt_seconds": "monthly_stt_seconds_cap",
    "tts_chars": "monthly_tts_chars_cap",
    "translator_chars": "monthly_translator_chars_cap",
}
_ENV_LEGACY_METERS = {
    "stt_seconds": "azure_stt_seconds",
    "tts_chars": "azure_tts_chars",
    "translator_chars": "azure_translator_chars",
}
_DEFAULT_SPEECH_STT_CAP = 16_200
_DEFAULT_SPEECH_TTS_CAP = 450_000
_DEFAULT_TRANSLATOR_CAP = 1_800_000

_COOLDOWN_RATE_LIMIT = timedelta(minutes=15)
_COOLDOWN_AUTH = timedelta(hours=24)
_COOLDOWN_TRANSIENT = timedelta(minutes=5)

_log = get_logger(__name__)

#: Lock de los enfriamientos del respaldo del entorno (no hay fila en la base).
_cooldown_lock = threading.Lock()
#: ``(base de datos, cuenta) -> hasta cuándo`` de ``env-speech`` y ``env-translator``.
_env_cooldowns: dict[tuple[str, str], datetime] = {}


def _db_scope(conn: sqlite3.Connection) -> str:
    """Clave de la base a la que pertenece ``conn``.

    Los medidores de uso y las cuotas ya viven en la base: el enfriamiento del
    entorno se acota igual, para que dos bases del mismo proceso no se pisen.
    """
    try:
        row = conn.execute("PRAGMA database_list").fetchone()
    except sqlite3.Error:  # conexión cerrada: sin ámbito propio
        return ""
    return "" if row is None else str(row[2] or "")


def _active_env_cooldown(
    conn: sqlite3.Connection, account_id: str, now: datetime
) -> datetime | None:
    """Fin del enfriamiento vigente de una cuenta del entorno; al caducar se olvida."""
    key = (_db_scope(conn), account_id)
    with _cooldown_lock:
        until = _env_cooldowns.get(key)
        if until is None:
            return None
        if until <= now:
            del _env_cooldowns[key]
            return None
        return until


def _env_in_cooldown(conn: sqlite3.Connection, account_id: str, now: datetime) -> bool:
    """``True`` si la cuenta del entorno sigue en pausa."""
    return _active_env_cooldown(conn, account_id, now) is not None


def _env_cooldown_field(conn: sqlite3.Connection, account_id: str, now: datetime) -> str | None:
    """``cooldown_until`` para la API, o ``None`` si no hay enfriamiento vigente."""
    until = _active_env_cooldown(conn, account_id, now)
    return None if until is None else format_ts(until)


def _set_env_cooldown(conn: sqlite3.Connection, account_id: str, until: datetime) -> None:
    key = (_db_scope(conn), account_id)
    with _cooldown_lock:
        _env_cooldowns[key] = until


def _clear_env_cooldown(conn: sqlite3.Connection, account_id: str) -> None:
    key = (_db_scope(conn), account_id)
    with _cooldown_lock:
        _env_cooldowns.pop(key, None)


def reset_env_cooldowns() -> None:
    """Olvida todos los enfriamientos del entorno (aislamiento entre pruebas)."""
    with _cooldown_lock:
        _env_cooldowns.clear()


def _fernet_or_none(env: Mapping[str, str]) -> Fernet | None:
    """``Fernet`` de ``FRANCES_SECRETS_KEY``, o ``None`` si falta o no es válida.

    Una clave malformada se avisa aquí y no se usa para nada: sin ella las
    cuentas guardadas en la base se omiten y solo queda el respaldo del entorno.
    """
    try:
        return fernet_from_env(env)
    except SecretsKeyInvalidError:
        _log.warning(
            "azure pool: FRANCES_SECRETS_KEY no es una clave Fernet válida;"
            " se omiten las cuentas guardadas en la base"
        )
        return None


class AzureAccountNotFound(LookupError):
    """No existe ninguna cuenta con ese identificador."""


class AzurePoolUnavailable(RuntimeError):
    """No hay cuentas activas disponibles dentro de cuota."""


@dataclass(frozen=True)
class ResolvedAzureAccount:
    """Cuenta lista en memoria para emitir tokens o llamar a Azure."""

    id: str
    label: str
    kind: AzureAccountKind
    region: str
    api_key: str
    is_env_fallback: bool
    stt_seconds_cap: int
    tts_chars_cap: int
    translator_chars_cap: int
    used: int

    def cap_for(self, meter: str) -> int:
        if meter == "stt_seconds":
            return self.stt_seconds_cap
        if meter == "tts_chars":
            return self.tts_chars_cap
        return self.translator_chars_cap


def _month_usage_map(conn: sqlite3.Connection, month: str) -> dict[str, dict[str, int]]:
    rows = conn.execute(
        "SELECT account_id, meter, amount FROM azure_usage_monthly WHERE month = ?",
        (month,),
    ).fetchall()
    out: dict[str, dict[str, int]] = {}
    for acc_id, meter, amount in rows:
        out.setdefault(str(acc_id), {})[str(meter)] = int(amount)
    return out


def _usage_out(bucket: Mapping[str, int] | None) -> AzureAccountUsage:
    if not bucket:
        return AzureAccountUsage()
    return AzureAccountUsage(
        stt_seconds=int(bucket.get("stt_seconds", 0)),
        tts_chars=int(bucket.get("tts_chars", 0)),
        translator_chars=int(bucket.get("translator_chars", 0)),
    )


def _row_to_out(
    row: tuple[Any, ...], usage_by_acc: Mapping[str, Mapping[str, int]]
) -> AzureAccountOut:
    acc_id = str(row[0])
    return AzureAccountOut(
        id=acc_id,
        label=str(row[1]),
        kind=row[2],
        region=str(row[3]),
        key_hint=str(row[4]),
        enabled=bool(row[5]),
        priority=int(row[6]),
        monthly_stt_seconds_cap=int(row[7]),
        monthly_tts_chars_cap=int(row[8]),
        monthly_translator_chars_cap=int(row[9]),
        cooldown_until=None if row[10] is None else str(row[10]),
        last_error=None if row[11] is None else str(row[11]),
        last_error_at=None if row[12] is None else str(row[12]),
        last_used_at=None if row[13] is None else str(row[13]),
        usage=_usage_out(usage_by_acc.get(acc_id)),
        source="db",
    )


def get_strategy(conn: sqlite3.Connection) -> AzurePoolStrategy:
    row = conn.execute(
        "SELECT value_json FROM app_settings WHERE key = ?", (_STRATEGY_SETTING_KEY,)
    ).fetchone()
    if row is not None:
        try:
            parsed = json.loads(str(row[0]))
        except ValueError:
            _log.warning(
                "azure pool: la estrategia guardada no es JSON válido (%r); se usa 'priority'",
                str(row[0])[:40],
            )
        else:
            if parsed in ("priority", "least_used"):
                return parsed  # type: ignore[no-any-return]
            _log.warning(
                "azure pool: estrategia guardada desconocida (%r); se usa 'priority'",
                parsed,
            )
    return "priority"


def set_strategy(
    conn: sqlite3.Connection,
    strategy: AzurePoolStrategy,
    *,
    updated_by: str | None,
    now: datetime,
) -> AzurePoolStrategy:
    conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,"
        " updated_by = excluded.updated_by, updated_at = excluded.updated_at",
        (_STRATEGY_SETTING_KEY, json.dumps(strategy), updated_by, format_ts(now)),
    )
    return strategy


def _env_virtual_accounts(
    conn: sqlite3.Connection, env: Mapping[str, str], month: str, now: datetime
) -> list[AzureAccountOut]:
    out: list[AzureAccountOut] = []
    speech_key = (env.get("AZURE_SPEECH_KEY") or "").strip()
    speech_region = (env.get("AZURE_SPEECH_REGION") or "").strip()
    if speech_key and speech_region:
        register_runtime_secret(speech_key)
        out.append(
            AzureAccountOut(
                id=ENV_SPEECH_ID,
                label="Entorno (AZURE_SPEECH_KEY)",
                kind="speech",
                region=speech_region,
                key_hint=mask_key(speech_key),
                enabled=True,
                priority=999,
                monthly_stt_seconds_cap=_DEFAULT_SPEECH_STT_CAP,
                monthly_tts_chars_cap=_DEFAULT_SPEECH_TTS_CAP,
                monthly_translator_chars_cap=0,
                cooldown_until=_env_cooldown_field(conn, ENV_SPEECH_ID, now),
                usage=AzureAccountUsage(
                    stt_seconds=usage_get(conn, month, _ENV_LEGACY_METERS["stt_seconds"]),
                    tts_chars=usage_get(conn, month, _ENV_LEGACY_METERS["tts_chars"]),
                    translator_chars=0,
                ),
                source="env",
            )
        )
    tr_key = (env.get("AZURE_TRANSLATOR_KEY") or "").strip()
    tr_region = (env.get("AZURE_TRANSLATOR_REGION") or "").strip()
    if tr_key and tr_region:
        register_runtime_secret(tr_key)
        out.append(
            AzureAccountOut(
                id=ENV_TRANSLATOR_ID,
                label="Entorno (AZURE_TRANSLATOR_KEY)",
                kind="translator",
                region=tr_region,
                key_hint=mask_key(tr_key),
                enabled=True,
                priority=999,
                monthly_stt_seconds_cap=0,
                monthly_tts_chars_cap=0,
                monthly_translator_chars_cap=_DEFAULT_TRANSLATOR_CAP,
                cooldown_until=_env_cooldown_field(conn, ENV_TRANSLATOR_ID, now),
                usage=AzureAccountUsage(
                    translator_chars=usage_get(conn, month, _ENV_LEGACY_METERS["translator_chars"]),
                ),
                source="env",
            )
        )
    return out


_ACC_COLS = (
    "id, label, kind, region, key_hint, enabled, priority,"
    " monthly_stt_seconds_cap, monthly_tts_chars_cap, monthly_translator_chars_cap,"
    " cooldown_until, last_error, last_error_at, last_used_at"
)


def list_accounts(
    conn: sqlite3.Connection, env: Mapping[str, str], now: datetime
) -> list[AzureAccountOut]:
    """Lista cuentas configuradas en SQLite más las credenciales heredadas del entorno."""
    month = current_month(now)
    usage_by_acc = _month_usage_map(conn, month)
    rows = conn.execute(
        f"SELECT {_ACC_COLS} FROM azure_accounts ORDER BY kind, priority, created_at, id"
    ).fetchall()
    out = [_row_to_out(tuple(row), usage_by_acc) for row in rows]
    out.extend(_env_virtual_accounts(conn, env, month, now))
    return out


def get_account_out(
    conn: sqlite3.Connection, env: Mapping[str, str], account_id: str, now: datetime
) -> AzureAccountOut | None:
    month = current_month(now)
    row = conn.execute(
        f"SELECT {_ACC_COLS} FROM azure_accounts WHERE id = ?", (account_id,)
    ).fetchone()
    if row is not None:
        return _row_to_out(tuple(row), _month_usage_map(conn, month))
    for virt in _env_virtual_accounts(conn, env, month, now):
        if virt.id == account_id:
            return virt
    return None


def create_account(
    conn: sqlite3.Connection,
    env: Mapping[str, str],
    data: AzureAccountIn,
    now: datetime,
) -> AzureAccountOut:
    fernet = require_fernet(env)
    register_runtime_secret(data.api_key)
    acc_id = f"az_{secrets.token_hex(8)}"
    stamp = format_ts(now)
    ciphertext = encrypt_secret(fernet, data.api_key.strip())
    hint = mask_key(data.api_key)
    conn.execute(
        "INSERT INTO azure_accounts (id, label, kind, region, key_ciphertext, key_hint,"
        " enabled, priority, monthly_stt_seconds_cap, monthly_tts_chars_cap,"
        " monthly_translator_chars_cap, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            acc_id,
            data.label.strip(),
            data.kind,
            data.region.strip().lower(),
            ciphertext,
            hint,
            1 if data.enabled else 0,
            data.priority,
            data.monthly_stt_seconds_cap,
            data.monthly_tts_chars_cap,
            data.monthly_translator_chars_cap,
            stamp,
            stamp,
        ),
    )
    created = get_account_out(conn, env, acc_id, now)
    assert created is not None
    return created


def update_account(
    conn: sqlite3.Connection,
    env: Mapping[str, str],
    account_id: str,
    patch: AzureAccountPatch,
    now: datetime,
) -> AzureAccountOut:
    existing = conn.execute("SELECT id FROM azure_accounts WHERE id = ?", (account_id,)).fetchone()
    if existing is None:
        raise AzureAccountNotFound(account_id)

    sets: list[str] = []
    params: list[object] = []
    if patch.label is not None:
        sets.append("label = ?")
        params.append(patch.label.strip())
    if patch.region is not None:
        sets.append("region = ?")
        params.append(patch.region.strip().lower())
    if patch.api_key is not None:
        fernet = require_fernet(env)
        register_runtime_secret(patch.api_key)
        sets.extend(
            ("key_ciphertext = ?", "key_hint = ?", "cooldown_until = NULL", "last_error = NULL")
        )
        params.extend((encrypt_secret(fernet, patch.api_key.strip()), mask_key(patch.api_key)))
    if patch.priority is not None:
        sets.append("priority = ?")
        params.append(patch.priority)
    if patch.enabled is not None:
        sets.append("enabled = ?")
        params.append(1 if patch.enabled else 0)
        if patch.enabled:
            sets.extend(("cooldown_until = NULL", "last_error = NULL"))
    if patch.monthly_stt_seconds_cap is not None:
        sets.append("monthly_stt_seconds_cap = ?")
        params.append(patch.monthly_stt_seconds_cap)
    if patch.monthly_tts_chars_cap is not None:
        sets.append("monthly_tts_chars_cap = ?")
        params.append(patch.monthly_tts_chars_cap)
    if patch.monthly_translator_chars_cap is not None:
        sets.append("monthly_translator_chars_cap = ?")
        params.append(patch.monthly_translator_chars_cap)

    if sets:
        sets.append("updated_at = ?")
        params.append(format_ts(now))
        params.append(account_id)
        conn.execute(f"UPDATE azure_accounts SET {', '.join(sets)} WHERE id = ?", params)

    updated = get_account_out(conn, env, account_id, now)
    assert updated is not None
    return updated


def delete_account(conn: sqlite3.Connection, account_id: str) -> None:
    cur = conn.execute("DELETE FROM azure_accounts WHERE id = ?", (account_id,))
    if cur.rowcount == 0:
        raise AzureAccountNotFound(account_id)


def pool_summary(
    conn: sqlite3.Connection, env: Mapping[str, str], now: datetime
) -> AzurePoolSummary:
    month = current_month(now)
    now_s = format_ts(now)
    accounts = list_accounts(conn, env, now)
    speech = [acc for acc in accounts if acc.kind == "speech"]
    translator = [acc for acc in accounts if acc.kind == "translator"]
    return AzurePoolSummary(
        strategy=get_strategy(conn),
        month=month,
        speech_accounts=len(speech),
        speech_active=sum(
            1
            for acc in speech
            if acc.enabled and (acc.cooldown_until is None or acc.cooldown_until <= now_s)
        ),
        translator_accounts=len(translator),
        translator_active=sum(
            1
            for acc in translator
            if acc.enabled and (acc.cooldown_until is None or acc.cooldown_until <= now_s)
        ),
        stt_seconds_used=sum(acc.usage.stt_seconds for acc in speech),
        stt_seconds_cap=sum(acc.monthly_stt_seconds_cap for acc in speech if acc.enabled),
        tts_chars_used=sum(acc.usage.tts_chars for acc in speech),
        tts_chars_cap=sum(acc.monthly_tts_chars_cap for acc in speech if acc.enabled),
        translator_chars_used=sum(acc.usage.translator_chars for acc in translator),
        translator_chars_cap=sum(
            acc.monthly_translator_chars_cap for acc in translator if acc.enabled
        ),
        encryption_ready=_fernet_or_none(env) is not None,
    )


def resolve_account_key(
    conn: sqlite3.Connection, env: Mapping[str, str], account_id: str
) -> ResolvedAzureAccount | None:
    """Resuelve una cuenta concreta (DB o entorno virtual) con su clave descifrada."""
    if account_id == ENV_SPEECH_ID:
        key = (env.get("AZURE_SPEECH_KEY") or "").strip()
        region = (env.get("AZURE_SPEECH_REGION") or "").strip()
        if not (key and region):
            return None
        register_runtime_secret(key)
        return ResolvedAzureAccount(
            id=ENV_SPEECH_ID,
            label="Entorno (AZURE_SPEECH_KEY)",
            kind="speech",
            region=region,
            api_key=key,
            is_env_fallback=True,
            stt_seconds_cap=_DEFAULT_SPEECH_STT_CAP,
            tts_chars_cap=_DEFAULT_SPEECH_TTS_CAP,
            translator_chars_cap=0,
            used=0,
        )
    if account_id == ENV_TRANSLATOR_ID:
        key = (env.get("AZURE_TRANSLATOR_KEY") or "").strip()
        region = (env.get("AZURE_TRANSLATOR_REGION") or "").strip()
        if not (key and region):
            return None
        register_runtime_secret(key)
        return ResolvedAzureAccount(
            id=ENV_TRANSLATOR_ID,
            label="Entorno (AZURE_TRANSLATOR_KEY)",
            kind="translator",
            region=region,
            api_key=key,
            is_env_fallback=True,
            stt_seconds_cap=0,
            tts_chars_cap=0,
            translator_chars_cap=_DEFAULT_TRANSLATOR_CAP,
            used=0,
        )
    row = conn.execute(
        "SELECT id, label, kind, region, key_ciphertext,"
        " monthly_stt_seconds_cap, monthly_tts_chars_cap, monthly_translator_chars_cap"
        " FROM azure_accounts WHERE id = ?",
        (account_id,),
    ).fetchone()
    if row is None:
        return None
    fernet = require_fernet(env)
    api_key = decrypt_secret(fernet, str(row[4]))
    register_runtime_secret(api_key)
    return ResolvedAzureAccount(
        id=str(row[0]),
        label=str(row[1]),
        kind=row[2],
        region=str(row[3]),
        api_key=api_key,
        is_env_fallback=False,
        stt_seconds_cap=int(row[5]),
        tts_chars_cap=int(row[6]),
        translator_chars_cap=int(row[7]),
        used=0,
    )


def candidate_accounts(
    conn: sqlite3.Connection,
    env: Mapping[str, str],
    *,
    kind: AzureAccountKind,
    meter: str,
    needed: int,
    now: datetime,
    env_cap_override: int | None = None,
) -> list[ResolvedAzureAccount]:
    """Cuentas activas, fuera de enfriamiento y con cuota suficiente, ordenadas por estrategia."""
    month = current_month(now)
    now_s = format_ts(now)
    strategy = get_strategy(conn)
    usage_by_acc = _month_usage_map(conn, month)
    fernet = _fernet_or_none(env)

    rows = conn.execute(
        "SELECT id, label, region, key_ciphertext, priority,"
        " monthly_stt_seconds_cap, monthly_tts_chars_cap, monthly_translator_chars_cap,"
        " cooldown_until FROM azure_accounts"
        " WHERE kind = ? AND enabled = 1 ORDER BY priority, created_at, id",
        (kind,),
    ).fetchall()

    db_candidates: list[tuple[tuple[float, int, str], ResolvedAzureAccount]] = []
    for row in rows:
        cooldown_until = None if row[8] is None else str(row[8])
        if cooldown_until is not None and cooldown_until > now_s:
            continue
        if fernet is None:
            _log.warning("azure pool: falta FRANCES_SECRETS_KEY; se omiten cuentas en DB")
            break
        acc_id = str(row[0])
        try:
            api_key = decrypt_secret(fernet, str(row[3]))
        except ValueError as exc:
            _log.warning("azure pool %s: %s", acc_id, redact(str(exc), env))
            continue
        register_runtime_secret(api_key)
        stt_cap, tts_cap, tr_cap = int(row[5]), int(row[6]), int(row[7])
        used = int(usage_by_acc.get(acc_id, {}).get(meter, 0))
        resolved = ResolvedAzureAccount(
            id=acc_id,
            label=str(row[1]),
            kind=kind,
            region=str(row[2]),
            api_key=api_key,
            is_env_fallback=False,
            stt_seconds_cap=stt_cap,
            tts_chars_cap=tts_cap,
            translator_chars_cap=tr_cap,
            used=used,
        )
        cap = resolved.cap_for(meter)
        if used + needed > cap:
            continue
        ratio = used / cap if cap > 0 else 1.0
        prio = int(row[4])
        sort_key = (
            (float(prio), int(ratio * 1_000_000), acc_id)
            if strategy == "priority"
            else (
                ratio,
                prio,
                acc_id,
            )
        )
        db_candidates.append((sort_key, resolved))

    db_candidates.sort(key=lambda pair: pair[0])
    ordered = [resolved for _, resolved in db_candidates]

    # Respaldo del entorno al final de las cuentas administradas en DB
    if kind == "speech":
        env_key = (env.get("AZURE_SPEECH_KEY") or "").strip()
        env_region = (env.get("AZURE_SPEECH_REGION") or "").strip()
        env_id = ENV_SPEECH_ID
        env_label = "Entorno (AZURE_SPEECH_KEY)"
        default_cap = _DEFAULT_SPEECH_STT_CAP if meter == "stt_seconds" else _DEFAULT_SPEECH_TTS_CAP
    else:
        env_key = (env.get("AZURE_TRANSLATOR_KEY") or "").strip()
        env_region = (env.get("AZURE_TRANSLATOR_REGION") or "").strip()
        env_id = ENV_TRANSLATOR_ID
        env_label = "Entorno (AZURE_TRANSLATOR_KEY)"
        default_cap = _DEFAULT_TRANSLATOR_CAP

    if env_key and env_region and not _env_in_cooldown(conn, env_id, now):
        register_runtime_secret(env_key)
        env_cap = env_cap_override if env_cap_override is not None else default_cap
        legacy_meter = _ENV_LEGACY_METERS[meter]
        env_used = usage_get(conn, month, legacy_meter)
        if env_used + needed <= env_cap:
            ordered.append(
                ResolvedAzureAccount(
                    id=env_id,
                    label=env_label,
                    kind=kind,
                    region=env_region,
                    api_key=env_key,
                    is_env_fallback=True,
                    stt_seconds_cap=env_cap if meter == "stt_seconds" else _DEFAULT_SPEECH_STT_CAP,
                    tts_chars_cap=env_cap if meter == "tts_chars" else _DEFAULT_SPEECH_TTS_CAP,
                    translator_chars_cap=env_cap
                    if meter == "translator_chars"
                    else _DEFAULT_TRANSLATOR_CAP,
                    used=env_used,
                )
            )
    return ordered


def record_usage(
    conn: sqlite3.Connection,
    account_id: str,
    month: str,
    meter: str,
    amount: int,
    now: datetime,
) -> None:
    if amount <= 0:
        return
    stamp = format_ts(now)
    if account_id in (ENV_SPEECH_ID, ENV_TRANSLATOR_ID):
        usage_add(conn, month, _ENV_LEGACY_METERS[meter], amount)
        return
    exists = conn.execute("SELECT 1 FROM azure_accounts WHERE id = ?", (account_id,)).fetchone()
    if exists is None:
        return
    conn.execute(
        "INSERT INTO azure_usage_monthly (account_id, month, meter, amount, updated_at)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(account_id, month, meter) DO UPDATE"
        " SET amount = azure_usage_monthly.amount + excluded.amount,"
        " updated_at = excluded.updated_at",
        (account_id, month, meter, amount, stamp),
    )
    conn.execute(
        "UPDATE azure_accounts SET last_used_at = ?, cooldown_until = NULL, last_error = NULL,"
        " updated_at = ? WHERE id = ?",
        (stamp, stamp, account_id),
    )


def _failure_cooldown(status_code: int | None) -> timedelta:
    """Enfriamiento según el fallo: cuota, credenciales o error transitorio."""
    if status_code == 429:
        return _COOLDOWN_RATE_LIMIT
    if status_code in (401, 403):
        return _COOLDOWN_AUTH
    return _COOLDOWN_TRANSIENT


def record_failure(
    conn: sqlite3.Connection,
    account_id: str,
    status_code: int | None,
    detail: str,
    now: datetime,
) -> None:
    delta = _failure_cooldown(status_code)
    if account_id in (ENV_SPEECH_ID, ENV_TRANSLATOR_ID):
        _set_env_cooldown(conn, account_id, now + delta)
        return
    stamp = format_ts(now)
    until = format_ts(now + delta)
    clean_detail = redact(detail)[:240]
    conn.execute(
        "UPDATE azure_accounts SET cooldown_until = ?, last_error = ?, last_error_at = ?,"
        " updated_at = ? WHERE id = ?",
        (until, clean_detail, stamp, stamp, account_id),
    )


def clear_cooldown(conn: sqlite3.Connection, account_id: str, now: datetime) -> None:
    if account_id in (ENV_SPEECH_ID, ENV_TRANSLATOR_ID):
        _clear_env_cooldown(conn, account_id)
        return
    stamp = format_ts(now)
    conn.execute(
        "UPDATE azure_accounts SET cooldown_until = NULL, last_error = NULL, updated_at = ?"
        " WHERE id = ?",
        (stamp, account_id),
    )
