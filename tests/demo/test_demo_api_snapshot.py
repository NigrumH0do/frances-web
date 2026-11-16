"""Tests de la instantánea del demo generada con la API real (Task UI-20).

La instantánea se genera en proceso con ``TestClient`` sobre los fixtures
sintéticos. Los tests comprueban el contrato de ``index.json`` fijado en el
plan, que dos corridas con el mismo ``--now`` den bytes idénticos y que las
respuestas de los quizzes solo existan en la instantánea del demo.
"""

import hashlib
import importlib.util
import json
import socket
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "demo_api_snapshot.py"
FIXTURES = ROOT / "tests" / "fixtures"
NOW = "2026-11-02T15:00:00.000Z"
MAX_SNAPSHOT_BYTES = 15 * 1024 * 1024


def _script_module() -> ModuleType:
    """Carga ``scripts/demo_api_snapshot.py`` por ruta (no es un paquete)."""
    spec = importlib.util.spec_from_file_location("demo_api_snapshot_ui20", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_script(argv: list[str]) -> int:
    return int(_script_module().main(argv))


def load(root: Path, relative: str) -> Any:
    return json.loads((root / relative).read_text(encoding="utf-8"))


def tree_bytes(root: Path) -> dict[str, bytes]:
    """Todos los archivos del árbol, por ruta relativa ordenada."""
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def synthetic_blob_names() -> set[str]:
    """sha256 de los blobs sintéticos que usa ``demo_state.sql``."""
    pdfs = sorted((FIXTURES / "pdf").glob("*.pdf"))[:2]
    images = sorted(path for path in (FIXTURES / "images").iterdir() if path.is_file())[:1]
    return {hashlib.sha256(path.read_bytes()).hexdigest() for path in [*pdfs, *images]}


def test_snapshot_covers_every_screen_route(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    for key in (
        "GET /api/plan/today",
        "GET /api/review/queue?limit=50",
        "GET /api/me/stats",
        "GET /api/voices",
        "GET /api/study/status",
    ):
        assert key in idx["routes"]
    assert any(k.startswith("GET /api/quizzes/") for k in idx["routes"]) and idx["quiz_keys"]
    detail_keys = [
        key
        for key in idx["routes"]
        if key.startswith("GET /api/quizzes/qz_") and not key.endswith("/attempts")
    ]
    kinds = {
        question["kind"]
        for key in detail_keys
        for question in load(tmp_path, idx["routes"][key])["questions"]
    }
    assert kinds == {"mcq", "cloze", "translate", "order", "dictation"}


def test_snapshot_includes_every_route_the_screens_request(tmp_path: Path) -> None:
    """Las pantallas piden variantes que el plan no enumera; el demo no debe dar 404."""
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    routes = idx["routes"]
    for key in (
        "GET /api/me/upcoming",
        "GET /api/review/queue",
        "GET /api/review/queue?limit=20",
        "GET /api/cards?kind=phrase",
    ):
        assert key in routes
    assert any(key.startswith("GET /api/topics/") and key.endswith("/cards") for key in routes)
    # El resumen del tema pide las tarjetas con `limit=50` (TopicSummary).
    assert any(
        key.startswith("GET /api/topics/") and key.endswith("/cards?limit=50") for key in routes
    )
    assert any(key.startswith("GET /api/cards?item_id=") for key in routes)
    assert any(
        key.startswith("GET /api/quizzes/qz_") and key.endswith("/attempts") for key in routes
    )


def test_snapshot_is_deterministic(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    assert run_script(["--out", str(a), "--now", NOW]) == 0
    assert run_script(["--out", str(b), "--now", NOW]) == 0
    assert tree_bytes(a) == tree_bytes(b)


def test_quiz_views_in_snapshot_have_no_answers(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    for key, file in idx["routes"].items():
        if key.startswith("GET /api/quizzes"):
            assert "answer" not in json.dumps(load(tmp_path, file)).replace("answers", "")


def test_snapshot_only_contains_synthetic_fixtures(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    assert all(path.name in synthetic_blob_names() for path in (tmp_path / "files").iterdir())


def test_quiz_keys_only_exist_in_snapshot_index(tmp_path: Path) -> None:
    """Review Focus P09-6: las respuestas de quiz solo viven en ``index.json``."""
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx["quiz_keys"]
    for file in idx["routes"].values():
        assert "quiz_keys" not in (tmp_path / file).read_text(encoding="utf-8")
    for key, file in idx["routes"].items():
        if not (key.startswith("GET /api/quizzes/qz_") and not key.endswith("/attempts")):
            continue
        quiz = load(tmp_path, file)
        assert set(idx["quiz_keys"][quiz["id"]]) == {
            question["id"] for question in quiz["questions"]
        }


def test_snapshot_runs_without_opening_sockets(tmp_path: Path, monkeypatch: Any) -> None:
    """Review Focus P09-6: ``TestClient`` en proceso, ningún socket TCP."""

    def refuse_connect(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("la instantánea intentó abrir un socket")

    monkeypatch.setattr(socket.socket, "connect", refuse_connect)
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0


def test_snapshot_chat_has_three_recorded_publications(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    assert len(idx["chat"]) == 3
    for entry in idx["chat"]:
        assert entry["question"].startswith("¿Qué dice")
        kinds = [event["kind"] for event in entry["events"]]
        assert kinds[0] == "meta" and kinds[-1] == "done"


def test_dictation_questions_use_done_audio_from_fixtures(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    idx = json.loads((tmp_path / "index.json").read_text())
    dictations = 0
    for key, file in idx["routes"].items():
        if not (key.startswith("GET /api/quizzes/qz_") and not key.endswith("/attempts")):
            continue
        for question in load(tmp_path, file)["questions"]:
            if question["kind"] != "dictation":
                continue
            dictations += 1
            audio = question["audio"]
            assert audio is not None and audio["url"].startswith("/api/audio/")
            cache_key = audio["url"].rsplit("/", 1)[1]
            assert (tmp_path / "audio" / f"{cache_key}.mp3").is_file()
    assert dictations > 0


def test_snapshot_size_is_under_15_mb(tmp_path: Path) -> None:
    assert run_script(["--out", str(tmp_path), "--now", NOW]) == 0
    total = sum(path.stat().st_size for path in tmp_path.rglob("*") if path.is_file())
    assert total < MAX_SNAPSHOT_BYTES
