"""`POST /api/practice/tts`: audio modelo de un texto libre del usuario (PRACTICE-01).

La síntesis corre en la petición con el mismo pipeline de las tarjetas
(`audio_request` + `run_audio_keys`): una clave ya hecha se devuelve sin red ni cupo,
el texto se normaliza antes de armar la clave y nunca aparece en los logs.
"""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from frances.api.routes import practice
from frances.audio.edge import EngineError
from frances.audio.run import EngineSet
from frances.models.audio import Voice
from tests.testkit.api import create_user, login, make_api

VOICE = "fr-FR-DeniseNeural"


class _FakeEngine:
    family = "ms-neural"
    family_version = "1"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail: EngineError | None = None

    async def synthesize(self, text: str, voice: Voice, out_wav_or_mp3: Path) -> None:
        self.calls.append((text, voice.id))
        if self.fail is not None:
            raise self.fail
        out_wav_or_mp3.parent.mkdir(parents=True, exist_ok=True)
        out_wav_or_mp3.write_bytes(b"ID3fake-audio")


async def _no_sleep(_seconds: float) -> None:
    """Sin backoff real en los tests."""


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> _FakeEngine:
    fake = _FakeEngine()
    monkeypatch.setattr(
        "frances.audio.run.make_engines",
        lambda _ctx: EngineSet(edge=fake, azure=None),
    )
    monkeypatch.setattr("frances.audio.run.postprocess", _copy_postprocess)
    monkeypatch.setattr("frances.audio.run._sleep", _no_sleep)
    return fake


def _copy_postprocess(src: Path, dst: Path, _ratio: float = 1.0) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(src.read_bytes())
    return 1500


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    api_client, ctx = make_api(tmp_path)
    conn = sqlite3.connect(ctx.db_path)
    create_user(conn, "ana@ex.org")
    create_user(conn, "luis@ex.org")
    conn.close()
    login(api_client, "ana@ex.org")
    yield api_client
    api_client.close()


def _tts(client: TestClient, text: str, voice: str = VOICE) -> dict[str, object]:
    response = client.post("/api/practice/tts", json={"text": text, "voice_id": voice})
    assert response.status_code == 200, response.text
    body: dict[str, object] = response.json()
    return body


def test_synthesizes_and_serves_the_clip(client: TestClient, engine: _FakeEngine) -> None:
    body = _tts(client, "Je voudrais un croissant, s'il vous plaît.")
    key = body["cache_key"]
    assert isinstance(key, str) and len(key) == 32
    assert body["status"] == "done"
    assert body["voice_id"] == VOICE
    assert body["url"] == f"/api/audio/{key}"
    assert body["duration_ms"] == 1500
    assert body["text"] == "Je voudrais un croissant, s'il vous plaît."
    assert engine.calls == [("Je voudrais un croissant, s'il vous plaît.", VOICE)]

    audio = client.get(f"/api/audio/{key}")
    assert audio.status_code == 200
    assert audio.content == b"ID3fake-audio"


def test_same_text_and_voice_reuses_the_clip(client: TestClient, engine: _FakeEngine) -> None:
    first = _tts(client, "Bonjour à tous")
    second = _tts(client, "  Bonjour   à\ttous \n")
    assert first["cache_key"] == second["cache_key"]
    assert second["text"] == "Bonjour à tous"
    assert len(engine.calls) == 1


def test_other_voice_is_another_clip(client: TestClient, engine: _FakeEngine) -> None:
    a = _tts(client, "Merci beaucoup")
    b = _tts(client, "Merci beaucoup", "fr-FR-HenriNeural")
    assert a["cache_key"] != b["cache_key"]
    assert [voice for _, voice in engine.calls] == [VOICE, "fr-FR-HenriNeural"]


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "", "voice_id": VOICE},
        {"text": "   ", "voice_id": VOICE},
        {"text": "1234 !?", "voice_id": VOICE},
        {"text": "a" * 401, "voice_id": VOICE},
        {"text": "Bonjour", "voice_id": "fr-FR-NoExiste"},
        {"text": "Bonjour", "voice_id": VOICE, "extra": 1},
    ],
)
def test_rejects_bad_input(
    client: TestClient, engine: _FakeEngine, payload: dict[str, object]
) -> None:
    response = client.post("/api/practice/tts", json=payload)
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"
    assert engine.calls == []


def test_engine_failure_is_503_without_text_in_logs(
    client: TestClient, engine: _FakeEngine, caplog: pytest.LogCaptureFixture
) -> None:
    engine.fail = EngineError("edge-tts definitivo con voz fr-FR-DeniseNeural", retryable=False)
    secret_text = "Texte très personnel numéro 42"
    response = client.post("/api/practice/tts", json={"text": secret_text, "voice_id": VOICE})
    assert response.status_code == 503
    assert response.json()["code"] == "tts_unavailable"
    assert secret_text not in caplog.text
    assert secret_text not in response.text


def test_failed_clip_is_retried_on_next_request(client: TestClient, engine: _FakeEngine) -> None:
    engine.fail = EngineError("edge-tts definitivo", retryable=False)
    assert (
        client.post("/api/practice/tts", json={"text": "Salut", "voice_id": VOICE}).status_code
        == 503
    )
    engine.fail = None
    body = _tts(client, "Salut")
    assert body["status"] == "done"


def test_per_user_rate_limit_counts_only_new_clips(
    client: TestClient, engine: _FakeEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(practice, "PER_USER_PER_HOUR", 3)
    for word in ("un", "deux", "trois"):
        _tts(client, word)
    # Un clip ya hecho no gasta cupo.
    _tts(client, "un")
    response = client.post("/api/practice/tts", json={"text": "quatre", "voice_id": VOICE})
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"


def test_requires_csrf(client: TestClient, engine: _FakeEngine) -> None:
    client.headers.pop("X-CSRF-Token")
    response = client.post("/api/practice/tts", json={"text": "Bonjour", "voice_id": VOICE})
    assert response.status_code == 403
    assert engine.calls == []


def test_requires_session(tmp_path: Path, engine: _FakeEngine) -> None:
    anon, _ctx = make_api(tmp_path)
    response = anon.post("/api/practice/tts", json={"text": "Bonjour", "voice_id": VOICE})
    assert response.status_code in (401, 403)
    anon.close()


def test_synthesize_uses_store_connect_and_returns_503_when_semaphore_busy(
    client: TestClient, engine: _FakeEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading

    monkeypatch.setattr(practice, "_synth_semaphore", threading.Semaphore(0))
    monkeypatch.setattr(practice, "_SYNTH_ACQUIRE_TIMEOUT_S", 0.01)
    response = client.post("/api/practice/tts", json={"text": "Bonjour", "voice_id": VOICE})
    assert response.status_code == 503
    assert response.json()["code"] == "tts_unavailable"
    assert engine.calls == []
