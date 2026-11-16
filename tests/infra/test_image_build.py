"""Build real de la imagen y arranque del healthcheck (Task SRV-13, heavy)."""

import subprocess
import uuid

import pytest


@pytest.mark.heavy
def test_web_image_builds() -> None:
    tag = f"frances-web-srv13:{uuid.uuid4().hex[:12]}"
    try:
        subprocess.run(
            [
                "docker",
                "buildx",
                "build",
                "--target",
                "web",
                "--load",
                "-t",
                tag,
                "-f",
                "infra/Dockerfile",
                ".",
            ],
            check=True,
            timeout=1800,
        )
    finally:
        subprocess.run(["docker", "image", "rm", "-f", tag], capture_output=True, check=False)


@pytest.mark.heavy
def test_admin_create_user_works_read_only(tmp_path) -> None:
    tag = f"frances-srv13-admin:{uuid.uuid4().hex[:12]}"
    tmp_path.chmod(0o777)
    try:
        subprocess.run(
            [
                "docker",
                "buildx",
                "build",
                "--target",
                "app",
                "--load",
                "-t",
                tag,
                "-f",
                "infra/Dockerfile",
                ".",
            ],
            check=True,
            timeout=1800,
        )
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--read-only",
                "--tmpfs",
                "/tmp",
                "--user",
                "10001:10001",
                "-v",
                f"{tmp_path}:/data",
                "-e",
                "FRANCES_DATA_DIR=/data",
                "-e",
                "FRANCES_STATE_DB=/data/state.db",
                "-i",
                tag,
                "admin",
                "create-user",
                "--email",
                "admin@example.org",
                "--name",
                "Admin",
                "--role",
                "admin",
            ],
            check=True,
            capture_output=True,
            text=True,
            input="SecurePassword123\nSecurePassword123\n",
            timeout=120,
        )
        assert result.returncode == 0
    finally:
        subprocess.run(["docker", "image", "rm", "-f", tag], capture_output=True, check=False)


@pytest.mark.heavy
def test_image_builds_and_runs_health(tmp_path) -> None:
    tag = f"frances-srv13:{uuid.uuid4().hex[:12]}"
    try:
        subprocess.run(
            [
                "docker",
                "buildx",
                "build",
                "--target",
                "app",
                "--load",
                "-t",
                tag,
                "-f",
                "infra/Dockerfile",
                ".",
            ],
            check=True,
            timeout=1800,
        )
        health = (
            "from frances.api.app import api_context_from_env, create_app;"
            "from fastapi.testclient import TestClient;"
            "print(TestClient(create_app(api_context_from_env)).get('/api/health').status_code)"
        )
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--read-only",
                "--tmpfs",
                "/tmp",
                "-e",
                "FRANCES_DATA_DIR=/tmp/data",
                "-e",
                "FRANCES_STATE_DB=/tmp/data/state.db",
                "--entrypoint",
                "python",
                tag,
                "-c",
                health,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.stdout.strip() == "200"
    finally:
        subprocess.run(["docker", "image", "rm", "-f", tag], capture_output=True, check=False)
