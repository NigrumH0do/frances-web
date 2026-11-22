"""Pruebas unitarias de cifrado, selección, failover TTS/Translator y redacción Azure (ADR-022)."""

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx

from frances.audio.azure_tts import PooledAzureTtsEngine
from frances.azure.crypto import (
    SecretsKeyInvalidError,
    SecretsKeyMissingError,
    decrypt_secret,
    encrypt_secret,
    fernet_from_env,
    mask_key,
    require_fernet,
)
from frances.azure.pool import (
    ENV_SPEECH_ID,
    ENV_TRANSLATOR_ID,
    candidate_accounts,
    clear_cooldown,
    create_account,
    get_strategy,
    list_accounts,
    record_failure,
    record_usage,
    reset_env_cooldowns,
    set_strategy,
)
from frances.cards.translate import translator_from_env
from frances.db.store import Store
from frances.db.usage import current_month
from frances.log import redact
from frances.models.audio import Voice
from frances.models.azure import AzureAccountIn
from frances.timeutil import format_ts

NOW = datetime(2026, 11, 19, 14, 0, tzinfo=UTC)
#: Claves Fernet sintéticas (32 bytes base64 urlsafe): nunca son secretos reales.
KEY = "vtmGIpxjUMQaza_WYMSTzzWf8KvLX6cgPXqoLZ0asKU="
OTHER_KEY = "KsLQbMEzX8NfSrWW6rffziYisFkSjEEqgOKdVgyjzx8="
ENV_SECRET = {"FRANCES_SECRETS_KEY": KEY}


def test_crypto_roundtrip_and_masking() -> None:
    assert fernet_from_env({}) is None
    with pytest.raises(SecretsKeyMissingError):
        require_fernet({})

    fernet = require_fernet(ENV_SECRET)
    secret = "azure-fake-secret-9876"
    token = encrypt_secret(fernet, secret)
    assert secret not in token
    assert decrypt_secret(fernet, token) == secret
    assert mask_key(secret) == "••••9876"
    with pytest.raises(ValueError):
        decrypt_secret(require_fernet({"FRANCES_SECRETS_KEY": OTHER_KEY}), token)


def test_malformed_secrets_key_is_rejected_not_derived() -> None:
    """Una `FRANCES_SECRETS_KEY` malformada falla explícita: no se deriva un SHA-256."""
    malformed = (
        "clave-maestra-sintetica-de-prueba-v3",  # frase: no es base64 de 32 bytes
        "x" * 64,  # 64 hex: decodifica a 48 bytes
        "AAAA",  # base64 válido, 3 bytes
        "no-es-base64!!",
    )
    for bad in malformed:
        with pytest.raises(SecretsKeyInvalidError) as info:
            fernet_from_env({"FRANCES_SECRETS_KEY": bad})
        assert bad not in str(info.value)  # nunca se filtra la clave en el error
        assert isinstance(info.value, ValueError)
        assert isinstance(info.value, SecretsKeyMissingError)
        with pytest.raises(SecretsKeyInvalidError):
            require_fernet({"FRANCES_SECRETS_KEY": bad})
    # Una clave bien formada sí se acepta y no se toca.
    assert fernet_from_env({"FRANCES_SECRETS_KEY": KEY}) is not None
    assert fernet_from_env({"FRANCES_SECRETS_KEY": f"  {KEY}  "}) is not None


def test_create_account_with_invalid_secrets_key_raises(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        with pytest.raises(SecretsKeyInvalidError):
            create_account(
                store.conn,
                {"FRANCES_SECRETS_KEY": "clave-invalida-sin-formato"},
                AzureAccountIn(label="X", kind="speech", region="eastus", api_key="k-123456"),
                NOW,
            )
        assert store.conn.execute("SELECT COUNT(*) FROM azure_accounts").fetchone()[0] == 0
    finally:
        store.close()


def test_pool_strategy_least_used_and_cooldown_redacts_secret(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        key1 = "key-speech-primera-1111"
        key2 = "key-speech-segunda-2222"
        a1 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="Speech A",
                kind="speech",
                region="eastus",
                api_key=key1,
                priority=10,
                monthly_stt_seconds_cap=100,
            ),
            NOW,
        )
        a2 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="Speech B",
                kind="speech",
                region="brazilsouth",
                api_key=key2,
                priority=20,
                monthly_stt_seconds_cap=100,
            ),
            NOW,
        )
        assert key1 not in str(list_accounts(store.conn, ENV_SECRET, NOW))
        assert key1 not in redact(f"error usando {key1} en {a1.region}")

        c_prio = candidate_accounts(
            store.conn, ENV_SECRET, kind="speech", meter="stt_seconds", needed=10, now=NOW
        )
        assert [c.id for c in c_prio] == [a1.id, a2.id]

        set_strategy(store.conn, "least_used", updated_by=None, now=NOW)
        record_usage(store.conn, a1.id, current_month(NOW), "stt_seconds", 80, NOW)
        c_least = candidate_accounts(
            store.conn, ENV_SECRET, kind="speech", meter="stt_seconds", needed=10, now=NOW
        )
        assert [c.id for c in c_least] == [a2.id, a1.id]

        record_failure(store.conn, a2.id, 429, f"rate limit {key2}", NOW)
        c_after_fail = candidate_accounts(
            store.conn, ENV_SECRET, kind="speech", meter="stt_seconds", needed=10, now=NOW
        )
        assert [c.id for c in c_after_fail] == [a1.id]
    finally:
        store.close()


@pytest.mark.anyio
@respx.mock
async def test_pooled_tts_fails_over_on_429_and_records_usage(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        a1 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="TTS 1",
                kind="speech",
                region="eastus",
                api_key="tts-secret-one-1111",
                priority=1,
            ),
            NOW,
        )
        a2 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="TTS 2",
                kind="speech",
                region="westus",
                api_key="tts-secret-two-2222",
                priority=2,
            ),
            NOW,
        )
        respx.post("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1").respond(429)
        respx.post("https://westus.tts.speech.microsoft.com/cognitiveservices/v1").respond(
            200, content=b"ID3audio"
        )
        async with httpx.AsyncClient() as client:
            engine = PooledAzureTtsEngine(
                ENV_SECRET, store, 450_000, client=client, now=lambda: NOW
            )
            out = tmp_path / "clip.mp3"
            voice = Voice(
                id="fr-FR-DeniseNeural",
                label="Denise · Francia · adulta",
                age="adult",
                gender="female",
                engine="edge",
                accent="Francia",
            )
            await engine.synthesize("Bonjour", voice, out)
        assert out.read_bytes() == b"ID3audio"
        accounts = {a.id: a for a in list_accounts(store.conn, ENV_SECRET, NOW)}
        assert accounts[a1.id].cooldown_until is not None
        assert accounts[a2.id].usage.tts_chars == len("Bonjour")
    finally:
        store.close()


@respx.mock
def test_pooled_translator_fails_over_and_tracks_usage(tmp_path: Path) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        t1 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="Tr 1",
                kind="translator",
                region="eastus",
                api_key="tr-secret-one-1111",
                priority=1,
            ),
            NOW,
        )
        t2 = create_account(
            store.conn,
            ENV_SECRET,
            AzureAccountIn(
                label="Tr 2",
                kind="translator",
                region="brazilsouth",
                api_key="tr-secret-two-2222",
                priority=2,
            ),
            NOW,
        )
        call_keys: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            key = request.headers["Ocp-Apim-Subscription-Key"]
            call_keys.append(key)
            if key == "tr-secret-one-1111":
                return httpx.Response(429, text="too many")
            return httpx.Response(200, json=[{"translations": [{"text": "manzana"}]}])

        respx.post("https://api.cognitive.microsofttranslator.com/translate").mock(
            side_effect=handler
        )
        tr = translator_from_env(ENV_SECRET, store, 1_800_000)
        assert tr.translate(["pomme"]) == ["manzana"]
        assert call_keys == ["tr-secret-one-1111", "tr-secret-two-2222"]
        accounts = {a.id: a for a in list_accounts(store.conn, ENV_SECRET, NOW)}
        assert accounts[t1.id].cooldown_until is not None
        assert accounts[t2.id].usage.translator_chars == len("pomme")
    finally:
        store.close()


def _candidates(store: Store, env: dict[str, str], now: datetime = NOW) -> list[str]:
    return [
        c.id
        for c in candidate_accounts(
            store.conn, env, kind="speech", meter="stt_seconds", needed=1, now=now
        )
    ]


def test_env_speech_cooldown_blocks_then_expires(tmp_path: Path) -> None:
    """`record_failure` sobre `env-speech` lo enfría en memoria y `candidate_accounts` lo salta."""
    env = {"AZURE_SPEECH_KEY": "env-speech-key-1234", "AZURE_SPEECH_REGION": "eastus"}
    store = Store.open(tmp_path / "state.db")
    reset_env_cooldowns()
    try:
        assert _candidates(store, env) == [ENV_SPEECH_ID]
        record_failure(store.conn, ENV_SPEECH_ID, 429, "rate limit", NOW)
        assert _candidates(store, env) == []
        # 429 → 15 min; justo antes sigue en pausa y después vuelve.
        assert _candidates(store, env, NOW + timedelta(minutes=14)) == []
        assert _candidates(store, env, NOW + timedelta(minutes=16)) == [ENV_SPEECH_ID]
    finally:
        reset_env_cooldowns()
        store.close()


def test_env_translator_cooldown_uses_auth_delta(tmp_path: Path) -> None:
    env = {"AZURE_TRANSLATOR_KEY": "env-tr-key-9876", "AZURE_TRANSLATOR_REGION": "eastus"}
    store = Store.open(tmp_path / "state.db")
    reset_env_cooldowns()
    try:
        cands = candidate_accounts(
            store.conn, env, kind="translator", meter="translator_chars", needed=1, now=NOW
        )
        assert [c.id for c in cands] == [ENV_TRANSLATOR_ID]
        record_failure(store.conn, ENV_TRANSLATOR_ID, 401, "bad key env-tr-key-9876", NOW)
        cands = candidate_accounts(
            store.conn, env, kind="translator", meter="translator_chars", needed=1, now=NOW
        )
        assert cands == []
        later = NOW + timedelta(hours=23)
        cands = candidate_accounts(
            store.conn, env, kind="translator", meter="translator_chars", needed=1, now=later
        )
        assert cands == []  # 401 → 24 h
        cands = candidate_accounts(
            store.conn,
            env,
            kind="translator",
            meter="translator_chars",
            needed=1,
            now=NOW + timedelta(hours=25),
        )
        assert [c.id for c in cands] == [ENV_TRANSLATOR_ID]
    finally:
        reset_env_cooldowns()
        store.close()


def test_clear_cooldown_lifts_env_cooldown(tmp_path: Path) -> None:
    env = {"AZURE_SPEECH_KEY": "env-speech-key-1234", "AZURE_SPEECH_REGION": "eastus"}
    store = Store.open(tmp_path / "state.db")
    reset_env_cooldowns()
    try:
        record_failure(store.conn, ENV_SPEECH_ID, 500, "boom", NOW)
        assert _candidates(store, env) == []
        clear_cooldown(store.conn, ENV_SPEECH_ID, NOW)
        assert _candidates(store, env) == [ENV_SPEECH_ID]
    finally:
        reset_env_cooldowns()
        store.close()


def test_env_cooldown_is_scoped_to_its_database(tmp_path: Path) -> None:
    """El enfriamiento en memoria pertenece a la base que lo registró, no al proceso."""
    env = {"AZURE_SPEECH_KEY": "env-speech-key-1234", "AZURE_SPEECH_REGION": "eastus"}
    a, b = Store.open(tmp_path / "a.db"), Store.open(tmp_path / "b.db")
    reset_env_cooldowns()
    try:
        record_failure(a.conn, ENV_SPEECH_ID, 429, "rate limit", NOW)
        assert _candidates(a, env) == []
        assert _candidates(b, env) == [ENV_SPEECH_ID]
    finally:
        reset_env_cooldowns()
        a.close()
        b.close()


def test_saved_strategy_json_invalid_or_unknown_warns_and_uses_priority(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    store = Store.open(tmp_path / "state.db")
    try:
        conn = store.conn
        conn.execute(
            "INSERT INTO app_settings (key, value_json, updated_by, updated_at)"
            " VALUES ('azure_pool_strategy', 'no-es-json', NULL, ?)",
            (format_ts(NOW),),
        )
        with caplog.at_level(logging.WARNING, logger="frances.azure.pool"):
            assert get_strategy(conn) == "priority"
        assert any("estrategia" in record.getMessage() for record in caplog.records)

        caplog.clear()
        conn.execute(
            "UPDATE app_settings SET value_json = ? WHERE key = 'azure_pool_strategy'",
            ('"lo-que-sea"',),
        )
        with caplog.at_level(logging.WARNING, logger="frances.azure.pool"):
            assert get_strategy(conn) == "priority"
        assert any("estrategia" in record.getMessage() for record in caplog.records)

        caplog.clear()
        set_strategy(conn, "least_used", updated_by=None, now=NOW)
        with caplog.at_level(logging.WARNING, logger="frances.azure.pool"):
            assert get_strategy(conn) == "least_used"
        assert caplog.records == []
    finally:
        store.close()


def test_summary_with_invalid_secrets_key_reports_not_ready(tmp_path: Path) -> None:
    """Una clave malformada no revienta el resumen: queda como cifrado no listo."""
    from frances.azure.pool import pool_summary

    store = Store.open(tmp_path / "state.db")
    try:
        summary = pool_summary(store.conn, {"FRANCES_SECRETS_KEY": "clave-mala"}, NOW)
        assert summary.encryption_ready is False
        ok = pool_summary(store.conn, ENV_SECRET, NOW)
        assert ok.encryption_ready is True
    finally:
        store.close()


def test_env_cooldown_is_visible_in_list_accounts(tmp_path: Path) -> None:
    """El enfriamiento del respaldo del entorno se ve en la API como el de una cuenta DB."""
    env = {"AZURE_SPEECH_KEY": "env-speech-key-1234", "AZURE_SPEECH_REGION": "eastus"}
    store = Store.open(tmp_path / "state.db")
    reset_env_cooldowns()
    try:
        accounts = {a.id: a for a in list_accounts(store.conn, env, NOW)}
        assert accounts[ENV_SPEECH_ID].cooldown_until is None
        record_failure(store.conn, ENV_SPEECH_ID, 429, "rate limit", NOW)
        accounts = {a.id: a for a in list_accounts(store.conn, env, NOW)}
        assert accounts[ENV_SPEECH_ID].cooldown_until == format_ts(NOW + timedelta(minutes=15))
        expired = {a.id: a for a in list_accounts(store.conn, env, NOW + timedelta(minutes=20))}
        assert expired[ENV_SPEECH_ID].cooldown_until is None
    finally:
        reset_env_cooldowns()
        store.close()
