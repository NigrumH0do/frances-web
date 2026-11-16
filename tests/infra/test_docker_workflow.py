"""CI multi-arch con QEMU y chequeo de wheels aarch64 (Task SRV-14)."""

import re
from pathlib import Path

import yaml

WF = yaml.safe_load(Path(".github/workflows/docker.yml").read_text())
PINNED = re.compile(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}")


def on(wf):
    # PyYAML (YAML 1.1) convierte la clave `on` en el booleano True.
    return wf.get("on", wf.get(True))


def test_triggers_permissions_and_no_secrets():  # REVIEW FOCUS R-45
    text = Path(".github/workflows/docker.yml").read_text()
    assert set(on(WF)) == {"pull_request", "push", "workflow_dispatch"}
    assert WF["permissions"] == {"contents": "read"}
    assert "secrets." not in text
    assert "pull_request_target" not in text
    assert "self-hosted" not in text


def test_all_actions_pinned_by_sha():
    uses = [s["uses"] for j in WF["jobs"].values() for s in j["steps"] if "uses" in s]
    assert uses and all(PINNED.fullmatch(u.split(" ")[0]) for u in uses)


def test_builds_both_arches_without_push():  # REVIEW FOCUS R-45
    steps = WF["jobs"]["docker"]["steps"]
    builds = [s for s in steps if "build-push-action" in s.get("uses", "")]
    assert {b["with"]["target"] for b in builds} == {"app", "web"}
    assert all(
        b["with"]["platforms"] == "linux/arm64,linux/amd64"
        and str(b["with"]["push"]).lower() == "false"
        for b in builds
    )
    assert any("setup-qemu-action" in s.get("uses", "") for s in steps)


def test_smoke_runs_arm64_image_and_wheels_gate():
    run = "\n".join(s.get("run", "") for s in WF["jobs"]["docker"]["steps"])
    assert "--platform linux/arm64" in run
    assert "frances-app:ci --help" in run
    assert WF["jobs"]["docker"]["needs"] == "wheels"
    wheels_run = "\n".join(s.get("run", "") for s in WF["jobs"]["wheels"]["steps"])
    assert "check_aarch64_wheels.py" in wheels_run
