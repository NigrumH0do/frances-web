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


def test_smoke_imports_onnxruntime_and_rapidocr_on_arm64():
    """El smoke ARM64 comprueba que RapidOCR/ONNX cargan dentro de la imagen."""
    run = "\n".join(s.get("run", "") for s in WF["jobs"]["docker"]["steps"])
    assert "import onnxruntime, rapidocr" in run


def test_ci_is_read_only_and_guards_the_real_build():
    """`ci.yml` limita permisos y valida el build sin demo, igual que `e2e.yml`."""
    ci_text = Path(".github/workflows/ci.yml").read_text()
    ci = yaml.safe_load(ci_text)
    assert ci["permissions"] == {"contents": "read"}
    steps = ci["jobs"]["web"]["steps"]
    guarded = [
        s for s in steps if s.get("run") == "npm run build && node scripts/check-no-demo.mjs dist"
    ]
    assert guarded and guarded[0]["working-directory"] == "web"
    uses = [s["uses"] for j in ci["jobs"].values() for s in j["steps"] if "uses" in s]
    assert uses and all(PINNED.fullmatch(u.split(" ")[0]) for u in uses)
