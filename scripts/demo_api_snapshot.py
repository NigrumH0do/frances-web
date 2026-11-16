"""Genera la instantánea del demo llamando a la API real en proceso (Task UI-20).

La instantánea se arma sobre los fixtures sintéticos de BND-04: se restaura
``tests/fixtures/demo_state.sql`` en un directorio de datos temporal, se corre la
capa de estudio con ``[llm] mode = "off"`` (fichas base, temas, quizzes y plan
por reglas) y se recorre la API con ``TestClient`` (sin sockets TCP). El
resultado es ``DIR/index.json``, los cuerpos de los ``GET`` en ``DIR/r/`` y los
bytes de archivos y audio en ``DIR/files/`` y ``DIR/audio/``.

``quiz_keys`` sale de ``questions.answer_json`` leído con SQL **solo** aquí:
esa información nunca se sirve desde una ruta de la API. Con el mismo ``--now``
dos corridas producen exactamente los mismos bytes.
"""

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from itertools import count
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, urlsplit

from fastapi.testclient import TestClient

import frances.accounts.repo as accounts_repo
import frances.study.topics_repo as topics_repo
from frances.accounts.repo import create_user
from frances.api.app import ApiContext, create_app
from frances.api.security import SESSION_COOKIE
from frances.config import load_settings
from frances.db.dump import restore_sql
from frances.db.store import Store
from frances.jobs.queue import enqueue
from frances.jobs.registry import HandlerRegistry, load_handlers
from frances.jobs.worker import run_one
from frances.models.ids import token_sha256
from frances.models.study import ChatEvent, Citation
from frances.paths import DataPaths
from frances.stage import StageContext
from frances.study.prompts import NO_MATERIAL_TEXT
from frances.timeutil import format_ts, now_utc, parse_ts

FIXTURES: Path = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
DEMO_SQL: Path = FIXTURES / "demo_state.sql"
DEMO_AUDIO: Path = FIXTURES / "demo_audio"

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-demo-demo"
DEMO_DISPLAY_NAME = "Demo"
DEMO_CSRF = "demo-csrf"
DEMO_INVITE = "demo"
DEMO_ORIGIN = "https://testserver"
DEMO_WORKER_ID = "demo-api-snapshot"
SNAPSHOT_VERSION = 1
MAX_SNAPSHOT_BYTES = 15 * 1024 * 1024

CHAT_TOKEN = "Modo demo: estos son los fragmentos del material que responden."
MAX_CHAT_ENTRIES = 3
MAX_CHAT_CITATIONS = 3

_QUOTE_SAFE = "-_.!~*'()"


def _blob_sources() -> dict[str, Path]:
    """Marcador → archivo: dos primeros PDF y primera imagen (orden alfabético)."""
    pdfs = sorted((FIXTURES / "pdf").glob("*.pdf"), key=lambda path: path.name)
    images = sorted(
        (path for path in (FIXTURES / "images").iterdir() if path.is_file()),
        key=lambda path: path.name,
    )
    return {"pdf1": pdfs[0], "pdf2": pdfs[1], "img1": images[0]}


def _demo_sql(blobs: dict[str, Path]) -> str:
    """SQL del demo con ``{{marcador}}`` y ``{{marcador_size}}`` sustituidos."""
    text = DEMO_SQL.read_text(encoding="utf-8")
    for name, path in blobs.items():
        data = path.read_bytes()
        text = text.replace("{{" + name + "_size}}", str(len(data)))
        text = text.replace("{{" + name + "}}", hashlib.sha256(data).hexdigest())
    return text


@contextmanager
def _deterministic_ids() -> Iterator[None]:
    """Ids estables para el usuario y los temas (el snapshot debe ser idéntico).

    ``frances.models.ids`` usa ``secrets`` por contrato (R-39). La instantánea es
    un artefacto reproducible, así que durante su generación se sustituyen solo
    esos dos generadores por un contador; el resto de ids ya es estable.
    """
    user_ids = count(1)
    topic_ids = count(1)
    original_user = accounts_repo.new_user_id
    original_topic = topics_repo.new_topic_id
    accounts_repo.new_user_id = lambda: f"u_{next(user_ids):016x}"
    topics_repo.new_topic_id = lambda: f"tp_{next(topic_ids):016x}"
    try:
        yield
    finally:
        accounts_repo.new_user_id = original_user
        topics_repo.new_topic_id = original_topic


def _normalize_audio_cache_keys(store: Store, paths: DataPaths) -> None:
    """Reasigna las claves ``demo…`` del fixture a 32 hex que exige ``/api/audio``.

    Los fixtures de BND-04 vienen del bundle v1 y usan claves con prefijo
    ``demo``; SRV-09 valida ``^[0-9a-f]{32}$`` porque las claves reales salen de
    ``audio_cache_key``. La instantánea normaliza las claves en su copia temporal
    (mismos bytes y mismas tarjetas) para que el demo use la ruta real.
    """
    rows = store.conn.execute("SELECT cache_key FROM audio ORDER BY cache_key").fetchall()
    mapping = {
        str(row[0]): hashlib.sha256(f"demo-audio:{row[0]}".encode()).hexdigest()[:32]
        for row in rows
    }
    if all(old == new for old, new in mapping.items()):
        return
    with store.tx() as conn:
        for old, new in mapping.items():
            conn.execute(
                "INSERT INTO audio (cache_key, text, text_norm, voice_id, family, family_version,"
                " status, engine_used, path, duration_ms, qa_cer, attempts, error, updated_at)"
                " SELECT ?, text, text_norm, voice_id, family, family_version, status,"
                " engine_used, ?, duration_ms, qa_cer, attempts, error, updated_at"
                " FROM audio WHERE cache_key = ?",
                (new, f"audio/{new}.mp3", old),
            )
            conn.execute("UPDATE card_audio SET cache_key = ? WHERE cache_key = ?", (new, old))
            conn.execute(
                "UPDATE questions SET audio_cache_key = ? WHERE audio_cache_key = ?", (new, old)
            )
        for old, _new in mapping.items():
            conn.execute("DELETE FROM audio WHERE cache_key = ?", (old,))
    for old, new in mapping.items():
        source = paths.audio_path(old)
        if source.is_file():
            source.rename(paths.audio_path(new))


def _prepare_state(data_dir: Path, now: datetime) -> StageContext:
    """Restaura los fixtures, crea el usuario demo y arma el contexto de etapa."""
    data_dir.mkdir(parents=True, exist_ok=True)
    paths = DataPaths(data_dir)
    paths.ensure_dirs()
    (data_dir / "frances.toml").write_text('[llm]\nmode = "off"\n', encoding="utf-8")
    blobs = _blob_sources()
    for path in blobs.values():
        dest = paths.blob_path(hashlib.sha256(path.read_bytes()).hexdigest())
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)
    for mp3 in sorted(DEMO_AUDIO.glob("*.mp3")):
        shutil.copyfile(mp3, paths.audio_path(mp3.stem))
    store = restore_sql(_demo_sql(blobs), paths.state_db)
    _normalize_audio_cache_keys(store, paths)
    env = {"FRANCES_PUBLIC_ORIGIN": DEMO_ORIGIN}
    settings = load_settings(paths.config, env)
    create_user(
        store.conn,
        DEMO_EMAIL,
        DEMO_DISPLAY_NAME,
        DEMO_PASSWORD,
        "user",
        now,
    )
    return StageContext(
        settings=settings,
        paths=paths,
        store=store,
        env=env,
        now=lambda: now,
    )


def _drain(ctx: StageContext, reg: HandlerRegistry, *, limit: int = 200) -> None:
    """Corre trabajos hasta que la cola no tenga ninguno listo."""
    for _ in range(limit):
        if run_one(ctx, reg, DEMO_WORKER_ID) is None:
            return
    raise RuntimeError(f"la cola no se vació en {limit} ciclos")


def _run_study_jobs(ctx: StageContext) -> None:
    """Encadena indexado, temas, quizzes y plan como lo haría el worker."""
    reg = HandlerRegistry()
    load_handlers(reg)
    conn = ctx.store.conn
    first = ("index.text_blocks", "llm.sheet", "llm.topics", "llm.quiz")
    for kind in first:
        enqueue(conn, kind, {}, now=ctx.now(), dedupe_key=f"demo:{kind}")
    _drain(ctx, reg)
    enqueue(conn, "plan.daily", {}, now=ctx.now(), dedupe_key="demo:plan.daily")
    _drain(ctx, reg)
    bad = conn.execute(
        "SELECT id, kind, state, last_error FROM jobs WHERE state != 'done' ORDER BY id"
    ).fetchall()
    if bad:
        raise RuntimeError(f"trabajos de la instantánea sin completar: {bad!r}")


def _client(ctx: ApiContext) -> TestClient:
    return TestClient(create_app(lambda: ctx), base_url=DEMO_ORIGIN)


def _login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        headers={"Origin": DEMO_ORIGIN},
    )
    if response.status_code != 200:
        raise RuntimeError(f"login del usuario demo falló: {response.status_code}")


def _set_demo_csrf(db_path: Path, client: TestClient) -> None:
    """Fija el CSRF del demo en la sesión recién creada (el real es aleatorio)."""
    token = client.cookies.get(SESSION_COOKIE)
    if token is None:
        raise RuntimeError("el login del demo no dejó la cookie de sesión")
    store = Store.connect(db_path)
    try:
        store.conn.execute(
            "UPDATE sessions SET csrf_token = ? WHERE token_sha256 = ?",
            (DEMO_CSRF, token_sha256(token)),
        )
    finally:
        store.close()


def _quote(value: str) -> str:
    return quote(value, safe=_QUOTE_SAFE)


def route_key(method: str, url: str) -> str:
    """``MÉTODO /ruta?query ordenada``, igual que ``routeKey`` de UI-21."""
    parts = urlsplit(url)
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    pairs.sort(key=lambda pair: (pair[0], pair[1]))
    query = "&".join(f"{_quote(key)}={_quote(value)}" for key, value in pairs)
    return f"{method.upper()} {parts.path}" + (f"?{query}" if query else "")


@dataclass
class _Collector:
    """Recorre GET y guarda el cuerpo exacto de cada uno."""

    client: TestClient
    routes: dict[str, str]
    bodies: dict[str, bytes]
    parsed: dict[str, Any]

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.routes = {}
        self.bodies = {}
        self.parsed = {}

    def get(self, url: str) -> Any | None:
        key = route_key("GET", url)
        if key in self.parsed:
            return self.parsed[key]
        response = self.client.get(url)
        if response.status_code != 200:
            return None
        body = response.json()
        self.routes[key] = f"r/{len(self.routes)}.json"
        self.bodies[key] = response.content
        self.parsed[key] = body
        return body

    def get_json(self, url: str) -> Any | None:
        """GET que no forma parte de la instantánea (p. ej. la búsqueda del chat)."""
        response = self.client.get(url)
        return response.json() if response.status_code == 200 else None


def _pages(collector: _Collector, path: str) -> list[Any]:
    """Todas las páginas de un listado por ``next_cursor``."""
    out: list[Any] = []
    cursor: str | None = None
    while True:
        url = path
        if cursor is not None:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}cursor={_quote(cursor)}"
        body = collector.get(url)
        if body is None:
            return out
        page = body.get("items") or body.get("cards") or []
        out.extend(page)
        cursor = body.get("next_cursor")
        if cursor is None:
            return out


def _collect_quiz(collector: _Collector, quiz_id: str, quiz_ids: set[str]) -> None:
    if collector.get(f"/api/quizzes/{_quote(quiz_id)}") is not None:
        quiz_ids.add(quiz_id)
    collector.get(f"/api/quizzes/{_quote(quiz_id)}/attempts")


def _collect_routes(
    collector: _Collector,
) -> tuple[dict[str, Any], list[dict[str, Any]], set[str]]:
    """Recorre las rutas de la API y devuelve ``me``, publicaciones y quizzes."""
    me = collector.get("/api/auth/me")
    if not isinstance(me, dict):
        raise RuntimeError("la API no devolvió /api/auth/me")
    collector.get("/api/health")
    courses = collector.get("/api/courses") or []
    quiz_ids: set[str] = set()
    for course in courses:
        course_id = str(course["id"])
        collector.get(f"/api/courses/{_quote(course_id)}/classroom-topics")
        collector.get(f"/api/me/topic-progress?course_id={_quote(course_id)}")
        topics = collector.get(f"/api/topics?course_id={_quote(course_id)}") or []
        for topic in topics:
            topic_id = str(topic["id"])
            collector.get(f"/api/topics/{_quote(topic_id)}")
            _pages(collector, f"/api/topics/{_quote(topic_id)}/cards")
            # TopicSummary recorre las tarjetas del tema con `limit=50`.
            _pages(collector, f"/api/topics/{_quote(topic_id)}/cards?limit=50")
            quizzes = (
                collector.get(f"/api/quizzes?scope_kind=topic&scope_id={_quote(topic_id)}") or []
            )
            for quiz in quizzes:
                _collect_quiz(collector, str(quiz["id"]), quiz_ids)

    details: list[dict[str, Any]] = []
    for item in _pages(collector, "/api/items"):
        item_id = str(item["id"])
        detail = collector.get(f"/api/items/{_quote(item_id)}")
        if isinstance(detail, dict):
            details.append(detail)
        collector.get(f"/api/sheets/{_quote(item_id)}")
        collector.get(f"/api/cards?item_id={_quote(item_id)}")
        quizzes = collector.get(f"/api/quizzes?scope_kind=item&scope_id={_quote(item_id)}") or []
        for quiz in quizzes:
            _collect_quiz(collector, str(quiz["id"]), quiz_ids)

    card_ids: set[str] = set()
    for card in _pages(collector, "/api/cards"):
        card_ids.add(str(card["id"]))
    for card in _pages(collector, "/api/cards?kind=phrase"):
        card_ids.add(str(card["id"]))
    for detail in details:
        card_ids.update(str(card_id) for card_id in detail.get("card_ids", []))
    for queue_url in (
        "/api/review/queue",
        "/api/review/queue?limit=20",
        "/api/review/queue?limit=50",
    ):
        queue = collector.get(queue_url) or []
        card_ids.update(str(card["id"]) for card in queue)
    for card_id in sorted(card_ids):
        collector.get(f"/api/cards/{_quote(card_id)}")

    collector.get("/api/voices")
    collector.get("/api/drills")
    collector.get("/api/plan/today")
    collector.get("/api/plan/week")
    collector.get("/api/me/prefs")
    collector.get("/api/me/stats")
    collector.get("/api/me/upcoming")
    collector.get("/api/me/upcoming?limit=3")
    collector.get("/api/study/status")
    collector.get("/api/chat/threads")
    return me, details, quiz_ids


def _chat_entries(collector: _Collector, details: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Preguntas grabadas para el chat del demo (sin LLM)."""
    entries: list[dict[str, Any]] = []
    for detail in details:
        text = str(detail.get("text", "")).strip()
        if not text:
            continue
        item = detail["item"]
        title = str(item.get("title") or "Sin título")
        question = f"¿Qué dice «{title}»?"
        hits = collector.get_json(f"/api/search?q={_quote(title)}") or []
        events = [ChatEvent(kind="meta", message_id=1)]
        if hits:
            events.append(ChatEvent(kind="token", text=CHAT_TOKEN))
            for hit in hits[:MAX_CHAT_CITATIONS]:
                events.append(
                    ChatEvent(
                        kind="citation",
                        citation=Citation(
                            item_id=str(hit["item_id"]),
                            source=str(hit["source"]),
                            page=None if hit["page"] is None else int(hit["page"]),
                            block_id=int(hit["block_id"]),
                            snippet=str(hit["snippet"]),
                        ),
                    )
                )
            events.append(ChatEvent(kind="done", message_id=2))
        else:
            events.append(ChatEvent(kind="token", text=NO_MATERIAL_TEXT))
            events.append(ChatEvent(kind="done", message_id=2, code="no_material"))
        entries.append(
            {
                "question": question,
                "events": [event.model_dump(mode="json", exclude_none=True) for event in events],
            }
        )
        if len(entries) == MAX_CHAT_ENTRIES:
            break
    return entries


def _quiz_keys(db_path: Path, quiz_ids: set[str]) -> dict[str, dict[str, str | list[str]]]:
    """Respuestas esperadas por quiz y pregunta, solo para las preguntas visibles."""
    if not quiz_ids:
        return {}
    marks = ",".join("?" for _ in quiz_ids)
    store = Store.connect(db_path)
    try:
        rows = store.conn.execute(
            "SELECT q.quiz_id, q.id, q.kind, q.answer_json, a.status"
            " FROM questions q LEFT JOIN audio a ON a.cache_key = q.audio_cache_key"
            f" WHERE q.quiz_id IN ({marks}) ORDER BY q.quiz_id, q.position",
            tuple(sorted(quiz_ids)),
        ).fetchall()
    finally:
        store.close()
    keys: dict[str, dict[str, str | list[str]]] = {}
    for quiz_id, question_id, kind, raw, audio_status in rows:
        if kind == "dictation" and audio_status != "done":
            continue
        answers = json.loads(str(raw))
        if not isinstance(answers, list) or not answers:
            continue
        expected: str | list[str] = (
            [str(answer) for answer in answers] if kind == "order" else str(answers[0])
        )
        keys.setdefault(str(quiz_id), {})[str(question_id)] = expected
    return keys


def _iter_media_urls(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for item in value.values():
            yield from _iter_media_urls(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_media_urls(item)
    elif isinstance(value, str) and value.startswith(("/api/files/", "/api/audio/")):
        yield value


def _write_routes(out: Path, collector: _Collector) -> None:
    routes_dir = out / "r"
    routes_dir.mkdir(parents=True, exist_ok=True)
    for key, relative in collector.routes.items():
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(collector.bodies[key])


def _write_media(out: Path, collector: _Collector) -> None:
    files_dir = out / "files"
    audio_dir = out / "audio"
    files_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)
    urls = sorted({url for body in collector.parsed.values() for url in _iter_media_urls(body)})
    for url in urls:
        path = urlsplit(url).path
        response = collector.client.get(url)
        if response.status_code != 200:
            raise RuntimeError(
                f"medio de la instantánea no disponible: {path} ({response.status_code})"
            )
        if path.startswith("/api/files/"):
            sha = path.rsplit("/", 1)[1]
            if len(sha) != 64 or any(char not in "0123456789abcdef" for char in sha):
                raise RuntimeError(f"sha inválido en la instantánea: {path}")
            (files_dir / sha).write_bytes(response.content)
        else:
            cache_key = path.rsplit("/", 1)[1]
            if len(cache_key) != 32 or any(char not in "0123456789abcdef" for char in cache_key):
                raise RuntimeError(f"clave de audio inválida en la instantánea: {path}")
            (audio_dir / f"{cache_key}.mp3").write_bytes(response.content)


def _write_index(out: Path, index: dict[str, Any]) -> None:
    text = json.dumps(index, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    (out / "index.json").write_text(text, encoding="utf-8")


def _prepare_out(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name in ("r", "files", "audio"):
        directory = out / name
        if directory.exists():
            shutil.rmtree(directory)
    (out / "index.json").unlink(missing_ok=True)


def build_snapshot(out: Path, now: datetime) -> None:
    """Escribe la instantánea completa en ``out``."""
    _prepare_out(out)
    with tempfile.TemporaryDirectory(prefix="frances-demo-api-") as tmp:
        with _deterministic_ids():
            stage = _prepare_state(Path(tmp), now)
            _run_study_jobs(stage)
            api_ctx = ApiContext(
                settings=stage.settings,
                paths=stage.paths,
                db_path=stage.paths.state_db,
                env=stage.env,
                now=stage.now,
            )
            stage.store.close()
        client = _client(api_ctx)
        try:
            _login(client)
            _set_demo_csrf(api_ctx.db_path, client)
            collector = _Collector(client)
            me, details, quiz_ids = _collect_routes(collector)
            _write_routes(out, collector)
            _write_media(out, collector)
            index = {
                "version": SNAPSHOT_VERSION,
                "generated_at": format_ts(now),
                "me": {**me, "csrf_token": DEMO_CSRF},
                "demo_credentials": {"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
                "invite_token": DEMO_INVITE,
                "routes": collector.routes,
                "quiz_keys": _quiz_keys(api_ctx.db_path, quiz_ids),
                "chat": _chat_entries(collector, details),
            }
            _write_index(out, index)
        finally:
            client.close()
    total = sum(path.stat().st_size for path in out.rglob("*") if path.is_file())
    if total >= MAX_SNAPSHOT_BYTES:
        raise RuntimeError(f"la instantánea pesa {total} bytes (máximo {MAX_SNAPSHOT_BYTES})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera la instantánea del demo de Frances")
    parser.add_argument("--out", type=Path, required=True, help="directorio de salida")
    parser.add_argument("--now", default=None, help="instante ISO 8601 con zona (fijo)")
    args = parser.parse_args(argv)
    try:
        now = now_utc() if args.now is None else parse_ts(args.now)
        build_snapshot(args.out, now)
    except Exception as exc:  # el fallo se informa sin traza ni datos del curso
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
