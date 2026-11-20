"""Pruebas unitarias de cifrado, selección, failover TTS/Translator y redacción Azure (ADR-022)."""

from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import respx

from frances.audio.azure_tts import PooledAzureTtsEngine
from frances.azure.crypto import (
    SecretsKeyMissingError,
    decrypt_secret,
    encrypt_secret,
    fernet_from_env,
    mask_key,
    require_fernet,
)
from frances.azure.pool import (
    candidate_accounts,
    create_account,
    list_accounts,
    record_failure,
    record_usage,
    set_strategy,
)
from frances.cards.translate import translator_from_env
from frances.db.store import Store
from frances.db.usage import current_month
from frances.log import redact
from frances.models.audio import Voice
from frances.models.azure import AzureAccountIn

NOW = datetime(2026, 11, 19, 14, 0, tzinfo=UTC)
ENV_SECRET = {"FRANCES_SECRETS_KEY": "clave-maestra-sintetica-de-prueba-v3"}


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
        decrypt_secret(require_fernet({"FRANCES_SECRETS_KEY": "otra-clave"}), token)


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
