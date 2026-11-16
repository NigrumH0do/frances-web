"""Workflows de CI de CHG-16: demo v2 en Pages y e2e v2 con guardián."""

from pathlib import Path

import yaml

WF = Path(".github/workflows")


def load(name: str) -> dict:
    return yaml.safe_load((WF / name).read_text())


def run_text(workflow: dict, job_name: str) -> str:
    job = workflow["jobs"][job_name]
    return "\n".join(step.get("run", "") for step in job["steps"])


def test_pages_builds_demo_v2_only():
    wf = load("pages.yml")
    steps = run_text(wf, "pages")
    assert "--mode demo" in steps and "demo_api_snapshot.py" in steps
    assert "demo-bundle" not in steps
    text = (WF / "pages.yml").read_text()
    assert "Build app" not in text
    assert "FRANCES_DATA_URL" not in text
    assert "VITE_UI" not in text
    assert "./demo/" not in text


def test_e2e_runs_v2_config_and_guards_the_real_build():
    wf = load("e2e.yml")
    steps = run_text(wf, "e2e")
    assert "playwright test -c playwright.v2.config.ts" in steps
    assert "npm run build && node scripts/check-no-demo.mjs dist" in steps
    assert "demo-bundle" not in steps
    assert "espeak-ng" not in steps and "ffmpeg" not in steps
    text = (WF / "e2e.yml").read_text()
    assert "playwright.config.ts" not in text


def test_tasks_yaml_keeps_the_v1_web_and_prn_tasks_as_history():
    graph = yaml.safe_load(Path("docs/superpowers/plans/tasks.yaml").read_text())
    ids = {task["id"] for task in graph["tasks"]}
    assert {
        "WEB-01",
        "WEB-02",
        "WEB-10",
        "WEB-13",
        "PRN-02",
        "PRN-03",
    } <= ids
