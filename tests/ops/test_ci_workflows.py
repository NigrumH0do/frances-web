"""CI de contratos, grafo de tareas y e2e v2 (Tasks OPS-01 y CHG-16)."""

import re
from pathlib import Path

import yaml

WF = Path(".github/workflows")
CI = ("contracts.yml", "e2e.yml")
PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")


def load(n):
    return yaml.safe_load((WF / n).read_text())


def on(wf):
    return wf.get("on", wf.get(True))  # PyYAML lee `on:` como True


def steps(wf):
    return [s for j in wf["jobs"].values() for s in j["steps"]]


def test_triggers_permissions_and_no_secrets():
    for n in CI:
        wf, text = load(n), (WF / n).read_text()
        assert set(on(wf)) >= {"pull_request", "push"} and on(wf)["push"]["branches"] == ["main"]
        assert wf["permissions"] == {"contents": "read"} and "secrets." not in text
        assert all(PINNED.fullmatch(s["uses"]) for s in steps(wf) if "uses" in s)


def test_contracts_job_commands_in_order():
    job = load("contracts.yml")["jobs"]["contracts"]
    run = "\n".join(s.get("run", "") for s in job["steps"])
    cmds = [
        "uv run frances schema export contracts/",
        "npm --prefix web run gen:types",
        "git diff --exit-code contracts web/src/contracts",
        "uv run python scripts/tasks_check.py",
    ]
    assert job["name"] == "contracts" and [run.index(c) for c in cmds] == sorted(
        run.index(c) for c in cmds
    )


def test_e2e_job_installs_both_browsers_and_runs_v2():
    job = load("e2e.yml")["jobs"]["e2e"]
    run = "\n".join(s.get("run", "") for s in job["steps"])
    assert job["name"] == "e2e" and job["timeout-minutes"] == 30
    assert "playwright install --with-deps chromium webkit" in run
    # Playwright resuelve su config desde el cwd: el step debe correr dentro
    # de web/ (con `npm --prefix web exec ...` el cwd quedaba en la raíz).
    run_step = next(s for s in job["steps"] if s.get("name") == "Run e2e")
    assert run_step.get("working-directory") == "web"
    assert run_step.get("run", "").strip() == "npx playwright test -c playwright.v2.config.ts"
    assert "e2e:prepare" not in run  # R-21: lo prepara webServer.command
    assert "demo-bundle" not in run and "espeak-ng" not in run and "ffmpeg" not in run
    guard = next(s for s in job["steps"] if s.get("name") == "Guardián del build real")
    assert guard.get("working-directory") == "web"
    assert guard.get("run", "").strip() == "npm run build && node scripts/check-no-demo.mjs dist"
    assert any(
        "upload-artifact" in s.get("uses", "") and s.get("if") == "failure()" for s in job["steps"]
    )
