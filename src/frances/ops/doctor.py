"""`frances doctor`: tamaños, cuotas, pendientes, voces y token (OPS-07).

Diagnóstico de solo lectura del repo de datos: tamaño por directorio y top 10
de blobs, medidores de uso del mes contra sus topes, conteos de pendientes,
registro de voces y —con `--online`— el exit code de `frances auth check`
(lee el entorno, R-23). Nunca imprime contenido: solo rutas relativas, sha,
tamaños y conteos (R-09).
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import typer

from frances.audio.voices import load_voices
from frances.cli import DataOpt, exit_with
from frances.config import Settings
from frances.db.usage import current_month, usage_get
from frances.errors import ConfigError
from frances.extract import ocr
from frances.paths import DataPaths
from frances.stage import StageContext, make_context

STORAGE_WARN_BYTES = 8_000_000_000
REPO_WARN_BYTES = STORAGE_WARN_BYTES
USAGE_WARN_RATIO = 0.8

_SIZE_DIRS: tuple[str, ...] = ("state", "blobs", "extractions", "audio", "voices")


@dataclass(frozen=True)
class SizeReport:
    """Tamaños por directorio, `site/` aparte y los 10 blobs más grandes."""

    by_dir: dict[str, int]
    site_bytes: int
    largest_blobs: list[tuple[str, int]]
    total: int


@dataclass(frozen=True)
class UsageLine:
    """Un medidor de uso del mes contra su tope (`cap=None`: límite diario)."""

    meter: str
    used: int
    cap: int | None
    warn: bool


@dataclass
class DoctorReport:
    """Salida del doctor: líneas de diagnóstico y avisos."""

    lines: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _dir_size(directory: Path) -> int:
    """Suma recursiva de los tamaños de archivo; 0 si el directorio falta."""
    if not directory.is_dir():
        return 0
    total = 0
    for root, _dirs, files in os.walk(directory):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return total


def collect_sizes(paths: DataPaths) -> SizeReport:
    """Tamaños de `state`, `blobs`, `extractions`, `audio` y `voices`; `site/` aparte.

    Los blobs van ordenados por tamaño desc, empate por sha; quedan los 10
    primeros. El total es la suma de los directorios más `site/`.
    """
    by_dir = {name: _dir_size(paths.root / name) for name in _SIZE_DIRS}
    site_bytes = _dir_size(paths.root / "site")
    blobs: list[tuple[str, int]] = []
    blobs_dir = paths.root / "blobs"
    if blobs_dir.is_dir():
        for path in blobs_dir.rglob("*"):
            if path.is_file():
                try:
                    blobs.append((path.name, path.stat().st_size))
                except OSError:
                    continue
    blobs.sort(key=lambda item: (-item[1], item[0]))
    return SizeReport(
        by_dir=by_dir,
        site_bytes=site_bytes,
        largest_blobs=blobs[:10],
        total=sum(by_dir.values()) + site_bytes,
    )


def usage_lines(conn: sqlite3.Connection, settings: Settings, month: str) -> list[UsageLine]:
    """Uso del mes contra los topes; `llm_items` sin tope mensual (el límite es diario)."""
    tts_used = usage_get(conn, month, "azure_tts_chars")
    tts_cap = settings.audio.azure_tts_monthly_char_cap
    tr_used = usage_get(conn, month, "azure_translator_chars")
    tr_cap = settings.translator.monthly_char_cap
    return [
        UsageLine(
            meter="azure_tts_chars",
            used=tts_used,
            cap=tts_cap,
            warn=tts_used >= int(tts_cap * USAGE_WARN_RATIO),
        ),
        UsageLine(
            meter="azure_translator_chars",
            used=tr_used,
            cap=tr_cap,
            warn=tr_used >= int(tr_cap * USAGE_WARN_RATIO),
        ),
        UsageLine(
            meter="llm_items", used=usage_get(conn, month, "llm_items"), cap=None, warn=False
        ),
    ]


def pending_counts(conn: sqlite3.Connection) -> dict[str, dict[str, int]]:
    """Conteos por estado: `attachments` por `status`, `audio` por `<family>/<status>`."""
    attachments = {
        str(status): int(count)
        for status, count in conn.execute(
            "SELECT status, COUNT(*) FROM attachments GROUP BY status ORDER BY status"
        )
    }
    audio = {
        f"{family}/{status}": int(count)
        for family, status, count in conn.execute(
            "SELECT family, status, COUNT(*) FROM audio GROUP BY family, status"
            " ORDER BY family, status"
        )
    }
    return {"attachments": attachments, "audio": audio}


def _fmt_mb(n: int) -> str:
    """Tamaño en MB con 1 decimal y coma decimal."""
    return f"{n / 1_000_000:.1f}".replace(".", ",") + " MB"


def _fmt_gb(n: int) -> str:
    """Tamaño en GB con 1 decimal y coma decimal."""
    return f"{n / 1_000_000_000:.1f}".replace(".", ",") + " GB"


def _size_lines(rep: SizeReport) -> list[str]:
    """Sección de tamaños: por directorio, `site/`, total y top 10 de blobs."""
    lines = ["[tamaños]"]
    for name in _SIZE_DIRS:
        lines.append(f"  {name}: {_fmt_mb(rep.by_dir.get(name, 0))}")
    lines.append(f"  site/: {_fmt_mb(rep.site_bytes)}")
    lines.append(f"  total datos + site/: {_fmt_mb(rep.total)}")
    for sha, size in rep.largest_blobs:
        lines.append(f"  blob {sha}: {_fmt_mb(size)}")
    return lines


def _storage_warnings(rep: SizeReport) -> list[str]:
    """Aviso si datos + `site/` superan el objetivo del volumen local de la instancia."""
    if rep.total > REPO_WARN_BYTES:
        return [
            "datos + site/ = "
            f"{_fmt_gb(rep.total)} superan el aviso de {_fmt_gb(REPO_WARN_BYTES)}"
            " del volumen local de datos de la instancia"
        ]
    return []


def _auth_line() -> str:
    """Corre `frances auth check` y reporta solo su exit code (sin `--data`, R-23)."""
    try:
        proc = subprocess.run(
            ["frances", "auth", "check"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return "auth: FALLA (exit 127)"
    if proc.returncode == 0:
        return "auth: OK (exit 0)"
    return f"auth: FALLA (exit {proc.returncode})"


def run_doctor(ctx: StageContext, online: bool) -> DoctorReport:
    """Diagnóstico completo: tamaños, cuotas, pendientes, voces y token.

    Solo lee; los avisos no cambian el exit code (0 salvo `ConfigError` de
    config o voces, que sale 4 vía `exit_with`).
    """
    lines: list[str] = []
    warnings: list[str] = []
    rep = collect_sizes(ctx.paths)
    lines.extend(_size_lines(rep))
    warnings.extend(_storage_warnings(rep))
    conn = ctx.store.conn
    month = current_month(ctx.now())
    lines.append(f"[uso {month}]")
    for usage in usage_lines(conn, ctx.settings, month):
        if usage.cap is None:
            lines.append(
                f"  {usage.meter}: {usage.used}"
                f" (límite diario {ctx.settings.cards.llm_daily_item_limit})"
            )
        else:
            lines.append(f"  {usage.meter}: {usage.used}/{usage.cap}")
            if usage.warn:
                warnings.append(f"uso de {usage.meter} en {usage.used}/{usage.cap} (80% del tope)")
    pending = pending_counts(conn)
    lines.append("[pendientes]")
    for status, count in pending["attachments"].items():
        lines.append(f"  attachments.{status}: {count}")
    for key, count in pending["audio"].items():
        lines.append(f"  audio.{key}: {count}")
    voices = load_voices(ctx.paths)
    enabled = sum(1 for voice in voices if voice.enabled)
    lines.append(f"voces: {len(voices)} registradas, {enabled} activas")
    if enabled == 0:
        warnings.append("no hay voces activas")
    try:
        lines.append(f"ocr: {', '.join(ocr.check_ocr())}")
    except ConfigError as exc:
        lines.append("ocr: ninguno")
        warnings.append(str(exc))
    if online:
        lines.append(_auth_line())
    return DoctorReport(lines=lines, warnings=warnings)


def _sizes_only(ctx: StageContext) -> DoctorReport:
    """Solo la sección de tamaños (`--sizes`, spec §8)."""
    rep = collect_sizes(ctx.paths)
    return DoctorReport(lines=_size_lines(rep), warnings=_storage_warnings(rep))


def _doctor_cmd(data: Path, sizes: bool, online: bool) -> None:
    """Imprime el reporte y devuelve `None` (exit 0); `ConfigError` → exit 4."""
    ctx = make_context(data)
    try:
        report = _sizes_only(ctx) if sizes else run_doctor(ctx, online)
    finally:
        ctx.store.close()
    for line in report.lines:
        typer.echo(line)
    for warning in report.warnings:
        typer.echo(f"aviso: {warning}", err=True)


def register(app: typer.Typer) -> None:
    """Registra `frances doctor` en la CLI."""

    @app.command("doctor")
    def doctor(
        sizes: bool = typer.Option(False, "--sizes", help="Solo la sección de tamaños"),
        online: bool = typer.Option(
            False, "--online", help="Verifica el token con `frances auth check`"
        ),
        data: DataOpt = Path("."),
    ) -> None:
        exit_with(lambda: _doctor_cmd(data, sizes, online))
