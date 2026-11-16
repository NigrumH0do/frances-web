"""Handlers del pipeline v1 como trabajos de la cola (SRV-07).

Un fallo de auth de Google es permanente: el trabajo no reintenta contra Google y el
error queda en `last_error` para que el admin lo vea. Los demás fallos del pipeline se
reintentan con backoff.
"""

from typing import Any

from frances.errors import AuthError
from frances.jobs.queue import Job, PermanentJobError, enqueue
from frances.jobs.registry import HandlerRegistry
from frances.jobs.scheduler import FOLLOW_UPS
from frances.models.jobs import JobKind
from frances.ops.daily import daily_exit_code, is_changed, run_daily, write_summary
from frances.stage import StageContext
from frances.sync.auth import REAUTH_MESSAGE, build_credentials
from frances.sync.google_http import GoogleApi
from frances.sync.run import run_reconcile

CLASSROOM_BASE_URL = "https://classroom.googleapis.com/v1"
_REFRESH_TOKEN_REJECTED = "Google rechazó el refresh token: repite LIVE-01"


def handle_daily(
    ctx: StageContext, job: Job, kinds: frozenset[JobKind] = frozenset()
) -> dict[str, Any]:
    """Corre el pipeline v1 del día. Devuelve el resumen sin errores.

    Con cambios, encola los `FOLLOW_UPS` de `pipeline.daily` que tengan handler en `kinds`.
    Un `AuthError` (exit code 3) falla sin reintentos. Un fallo de etapa (exit code 1)
    es reintentable.
    """
    reports = run_daily(ctx)
    summary = write_summary(ctx.paths.cache / "daily_summary.json", reports)
    code = daily_exit_code(reports)
    if code == 3:
        raise PermanentJobError(_REFRESH_TOKEN_REJECTED)
    if code == 1:
        raise RuntimeError("pipeline falló")
    if is_changed(reports):
        slot = str(job.payload.get("slot", "manual"))
        for kind in FOLLOW_UPS.get("pipeline.daily", ()):
            if kind in kinds:
                enqueue(
                    ctx.store.conn,
                    kind,
                    {"slot": slot},
                    now=ctx.now(),
                    dedupe_key=f"{kind}:{slot}",
                )
    return summary


def handle_reconcile(ctx: StageContext, job: Job) -> dict[str, Any]:
    """Reconcilia con Classroom. Anomalías (`partial`) completan el trabajo; `failed` reintenta."""
    del job  # el trabajo no lleva datos: el reconcile recorre todos los cursos seleccionados
    try:
        report = run_reconcile(ctx)
    except AuthError as exc:
        raise PermanentJobError(REAUTH_MESSAGE) from exc
    if report.status == "failed":
        raise RuntimeError("reconcile falló")
    # Solo contadores: los textos de anomalía pueden llevar contenido del curso.
    return {"stage": report.stage, "status": report.status, "counts": dict(report.counts)}


def handle_auth_check(ctx: StageContext, job: Job) -> dict[str, Any]:
    """`frances auth check` sin subprocess: refresca el token y pide un curso.

    Usa el entorno del contexto, no `os.environ`. Un `AuthError` falla sin reintentos.
    """
    del job
    try:
        api = GoogleApi(build_credentials(ctx.env), CLASSROOM_BASE_URL)
        api.refresh()
        api.get_json("courses", {"pageSize": 1})
    except AuthError as exc:
        raise PermanentJobError(REAUTH_MESSAGE) from exc
    return {"ok": 1}


def register_handlers(reg: HandlerRegistry) -> None:
    """Registra `pipeline.daily`, `pipeline.reconcile` y `auth.check`.

    Los kinds de `pipeline.daily` se leen al ejecutar, cuando ya cargaron todos los módulos.
    """
    reg.add("pipeline.daily", lambda c, j: handle_daily(c, j, reg.kinds()))
    reg.add("pipeline.reconcile", handle_reconcile)
    reg.add("auth.check", handle_auth_check)
