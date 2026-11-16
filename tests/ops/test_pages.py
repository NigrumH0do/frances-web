"""Workflow de GitHub Pages: demo v2 con la instantánea de la API (Task CHG-16)."""

import re
from pathlib import Path

import yaml

WF = Path(".github/workflows")
PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")


def load(n):
    return yaml.safe_load((WF / n).read_text())


def on(wf):
    return wf.get("on", wf.get(True))  # PyYAML lee `on:` como True


def steps(wf):
    return [s for j in wf["jobs"].values() for s in j["steps"]]


def step(wf, name):
    return next(s for s in steps(wf) if s.get("name") == name)


def test_pages_shape():
    wf, text = load("pages.yml"), (WF / "pages.yml").read_text()
    assert on(wf)["push"]["branches"] == ["main"] and "workflow_dispatch" in on(wf)
    assert wf["permissions"] == {"contents": "read", "pages": "write", "id-token": "write"}
    assert wf["concurrency"] == {"group": "pages", "cancel-in-progress": False}
    assert "secrets." not in text and re.findall(r"vars\.(\w+)", text) == []
    assert all(PINNED.fullmatch(s["uses"]) for s in steps(wf) if "uses" in s)
    job = wf["jobs"]["pages"]
    assert job["environment"]["name"] == "github-pages"
    assert step(wf, "Build demo v2")["env"]["VITE_BASE"] == "/${{ github.event.repository.name }}/"
    names = [s.get("name") for s in job["steps"]]
    assert (
        "Build app" not in names
        and "Demo bundle" not in names
        and names.index("Build demo v2")
        < names.index("Demo snapshot")
        < names.index("Upload pages artifact")
        < names.index("Deploy pages")
    )
    assert (
        step(wf, "Demo snapshot")["run"]
        == "uv run python scripts/demo_api_snapshot.py --out web/dist/demo-api"
    )
    build = step(wf, "Build demo v2")["run"]
    assert "--mode demo" in build and "VITE_UI" not in text
    upload = step(wf, "Upload pages artifact")
    assert upload["with"]["path"] == "web/dist"
