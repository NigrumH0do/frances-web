"""Etapas sync/reconcile + CLI + semántica de fallo de auth (SYN-07)."""

import dataclasses
import gc
import hashlib
import json
import sys
import warnings
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import respx
import typer
from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "fixtures"))

from google_mock import FRENCH_COURSE_ID, install_google_mocks

from frances.db.store import Store
from frances.errors import AuthError
from frances.models.ids import item_id
from frances.stage import StageReport, make_context
from frances.sync.attachments import extract_attachments
from frances.sync.classroom import CLASSROOM_BASE_URL
from frances.sync.run import register, run_reconcile, run_sync
from frances.timeutil import format_ts

pytestmark = pytest.mark.respx(assert_all_called=False)

FR = FRENCH_COURSE_ID
BASE = CLASSROOM_BASE_URL
FIX = Path(__file__).resolve().parents[1] / "fixtures"
TOKEN_URL = "https://oauth2.googleapis.com/token"

FAKE_ENV = {
    "GOOGLE_CLIENT_ID": "cid",
    "GOOGLE_CLIENT_SECRET": "csecret",
    "GOOGLE_REFRESH_TOKEN": "rt",
}
FIXED = datetime(2026, 10, 14, 10, 17, tzinfo=UTC)
NOW = format_ts(FIXED)

STREAMS = ("coursework", "material", "announcement")


def raws(scenario: str, kind: str) -> list[dict]:
    sdir = FIX / "classroom" / scenario
    if kind == "coursework":
        out: list[dict] = []
        for name in ("courseWork.page1.json", "courseWork.page2.json"):
            out.extend(json.loads((sdir / name).read_text(encoding="utf-8"))["courseWork"])
        return out
    files = {
        "material": ("courseWorkMaterials.json", "courseWorkMaterial"),
        "announcement": ("announcements.json", "announcements"),
    }
    fname, key = files[kind]
    return json.loads((sdir / fname).read_text(encoding="utf-8"))[key]


def courses(scenario: str) -> list[dict]:
    return json.loads((FIX / "classroom" / scenario / "courses.json").read_text(encoding="utf-8"))[
        "courses"
    ]


CALC = next(c["id"] for c in courses("v1") if "lculo" in c["name"])


#: Recursos abiertos por los helpers del módulo: el fixture `_close_resources` los cierra.
_OPEN_STORES: list[Store] = []


@pytest.fixture(autouse=True)
def _close_resources() -> Iterator[None]:
    """Cierra los `Store` que abren los helpers del módulo (una conexión `sqlite` cada uno)."""
    yield
    while _OPEN_STORES:
        _OPEN_STORES.pop().close()


def make_ctx(tmp_path: Path) -> Any:
    ctx = dataclasses.replace(make_context(tmp_path, FAKE_ENV), now=lambda: FIXED)
    _OPEN_STORES.append(ctx.store)
    return ctx


def make_app() -> typer.Typer:
    app = typer.Typer()
    register(app)
    return app


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected_attachments(scenario: str) -> int:
    return len(
        {
            a.id
            for k in STREAMS
            for x in raws(scenario, k)
            for a in extract_attachments(x, item_id(k, x["id"]))  # type: ignore[arg-type]
        }
    )


def runs_rows(store: Store) -> list[tuple[str, str]]:
    return [
        (str(stage), str(status))
        for stage, status in store.conn.execute(
            "SELECT stage, status FROM runs ORDER BY id"
        ).fetchall()
    ]


def course_row(store: Store, course_id: str) -> dict[str, Any]:
    cur = store.conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,))
    cols = [d[0] for d in cur.description]
    row = cur.fetchone()
    assert row is not None
    return dict(zip(cols, row, strict=True))


def test_auth_failure_writes_nothing(tmp_path: Path, respx_mock: respx.Router) -> None:
    ctx = make_ctx(tmp_path)
    install_google_mocks(respx_mock, "v1")
    respx_mock.post(TOKEN_URL).respond(400, json={"error": "invalid_grant"})
    before = sha256_file(ctx.paths.state_db)
    with pytest.raises(AuthError):
        run_sync(ctx)
    assert sha256_file(ctx.paths.state_db) == before
    assert not any(c.request.url.host == "classroom.googleapis.com" for c in respx_mock.calls)


def test_sync_cli_auth_failure_exits_3(tmp_path: Path, respx_mock: respx.Router) -> None:
    install_google_mocks(respx_mock, "v1")
    respx_mock.post(TOKEN_URL).respond(400, json={"error": "invalid_grant"})
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ResourceWarning)
        res = CliRunner(env=FAKE_ENV).invoke(make_app(), ["sync", "--data", str(tmp_path)])
        exit_code = res.exit_code
        del res
        gc.collect()
    assert exit_code == 3
    assert [w for w in caught if issubclass(w.category, ResourceWarning)] == []


def _spy_close(ctx: Any, monkeypatch: pytest.MonkeyPatch) -> tuple[list[int], Any]:
    """Cuenta llamadas a ``ctx.store.close`` y cierra la conexión de verdad."""
    calls: list[int] = []
    real_close = ctx.store.close

    def spy_close() -> None:
        calls.append(1)
        real_close()

    monkeypatch.setattr(ctx.store, "close", spy_close)
    return calls, real_close


def _assert_no_resource_warning(caught: list[warnings.WarningMessage]) -> None:
    assert [w for w in caught if issubclass(w.category, ResourceWarning)] == []


def test_sync_cli_closes_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = make_context(tmp_path, FAKE_ENV)
    calls, real_close = _spy_close(ctx, monkeypatch)
    monkeypatch.setattr("frances.sync.run.make_context", lambda _data: ctx)
    monkeypatch.setattr(
        "frances.sync.run.run_sync",
        lambda _ctx, _full=False: StageReport(stage="sync", status="ok"),
    )
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            res = CliRunner().invoke(make_app(), ["sync", "--data", str(tmp_path)])
            gc.collect()
        assert res.exit_code == 0, res.output
        assert len(calls) == 1
        _assert_no_resource_warning(caught)
    finally:
        if not calls:
            real_close()


def test_reconcile_cli_closes_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = make_context(tmp_path, FAKE_ENV)
    calls, real_close = _spy_close(ctx, monkeypatch)
    monkeypatch.setattr("frances.sync.run.make_context", lambda _data: ctx)
    monkeypatch.setattr(
        "frances.sync.run.run_reconcile",
        lambda _ctx: StageReport(stage="reconcile", status="ok"),
    )
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            res = CliRunner().invoke(make_app(), ["reconcile", "--data", str(tmp_path)])
            gc.collect()
        assert res.exit_code == 0, res.output
        assert len(calls) == 1
        _assert_no_resource_warning(caught)
    finally:
        if not calls:
            real_close()


def test_sync_end_to_end_v1_then_rerun(tmp_path: Path) -> None:
    ctx = make_ctx(tmp_path)
    seen = {k: len(raws("v1", k)) for k in ("coursework", "material", "announcement")}
    with respx.mock(assert_all_called=False) as r:
        install_google_mocks(r, "v1")
        rep1 = run_sync(ctx)
    assert rep1.status == "ok" and rep1.exit_code() == 0
    assert rep1.counts["sync.courses"] == 1  # FND-05: un solo curso ACTIVE que pasa el regex
    assert {k: rep1.counts[f"sync.seen.{k}"] for k in seen} == seen
    assert (
        rep1.counts["sync.items_seen"] == rep1.counts["sync.items_upserted"] == sum(seen.values())
    )
    assert rep1.counts["sync.attachments_new"] == expected_attachments("v1")
    with respx.mock(assert_all_called=False) as r:
        install_google_mocks(r, "v1")
        rep2 = run_sync(ctx)
    assert (rep2.counts["sync.items_upserted"], rep2.counts["sync.attachments_new"]) == (0, 0)
    assert runs_rows(ctx.store) == [("sync", "ok"), ("sync", "ok")]
    assert course_row(ctx.store, FR)["included"] == 1
    assert course_row(ctx.store, CALC)["included"] == 0


def test_reconcile_anomaly_is_partial(tmp_path: Path) -> None:
    ctx = make_ctx(tmp_path)
    with respx.mock(assert_all_called=False) as r:
        install_google_mocks(r, "v1")
        run_sync(ctx)
    with respx.mock(assert_all_called=False) as r:
        install_google_mocks(r, "v1")
        r.get(f"{BASE}/courses/{FR}/announcements").respond(200, json={})
        rep = run_reconcile(ctx)
    assert rep.status == "partial" and rep.exit_code() == 2
    assert rep.counts["reconcile.anomalies"] == 1
