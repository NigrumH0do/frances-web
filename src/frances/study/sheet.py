"""Ficha de estudio ampliada por publicación (AI-06).

CRD-05 deja una ficha base con resumen, vocabulario, gramática y frases. Esta
capa la amplía con objetivos y errores típicos usando el LLM de estudio, y
guarda el resultado en ``sheets`` con ``generator = 'study'``.

Dos garantías del Review Focus:

- una ficha con ``edited_by_human = 1`` no se reescribe (el ``WHERE`` del
  upsert la protege, aunque se llame a :func:`write_study_sheet` directamente);
- si el LLM está apagado o falla, la ficha base de CRD-05 se queda visible.

La llamada al LLM ocurre fuera de toda transacción; los archivos de extracción
se leen en :func:`build_sheet_request` antes de abrir cualquier escritura.
"""

import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import partial
from typing import Any

from frances.cards.input import build_input
from frances.cards.llm import LlmBudgetExceeded, LlmUnavailable
from frances.db.store import Store
from frances.log import get_logger
from frances.models import GenerationInput, StudySheet
from frances.paths import DataPaths
from frances.stage import StageContext
from frances.study.llm_cache import JsonLlm, cached_json
from frances.study.prompts import PROMPT_VERSIONS, SYSTEM_PROMPTS, render_sheet_input
from frances.study.quality import grounded, sheet_problems
from frances.study.schemas import SheetLlmOut
from frances.textnorm import norm_key
from frances.timeutil import format_ts

SHEET_GENERATOR = "study"
MAX_SHEETS_PER_RUN = 30
#: Fallos seguidos de LLM (incluye `LlmRejected`) que cortan el run.
BREAKER = 2

_logger = get_logger(__name__)


def items_needing_sheet(conn: sqlite3.Connection, prompt_version: str) -> list[str]:
    """Ítems vivos que necesitan la ficha ampliada, ``first_seen_at`` descendente.

    Solo cuentan los que ya tienen fila en ``generations`` (CRD-05 corrió). La
    ficha falta, o no es de ``study``, o es de otra versión de prompt. Una ficha
    editada por el admin nunca entra.
    """
    rows = conn.execute(
        "SELECT i.id FROM items i"
        " LEFT JOIN sheets s ON s.item_id = i.id"
        " WHERE i.deleted_at IS NULL"
        " AND EXISTS (SELECT 1 FROM generations g WHERE g.item_id = i.id)"
        " AND (s.item_id IS NULL OR s.generator != ? OR s.generator_version != ?)"
        " AND COALESCE(s.edited_by_human, 0) = 0"
        " ORDER BY i.first_seen_at DESC, i.id",
        (SHEET_GENERATOR, prompt_version),
    ).fetchall()
    return [str(row[0]) for row in rows]


@dataclass(frozen=True)
class SheetRequest:
    """Entrada completa de la ficha de una publicación."""

    item_id: str
    inp: GenerationInput
    user_text: str
    #: ``norm_key(front_fr)`` → id de la tarjeta ``vocab`` viva ligada al ítem.
    vocab: Mapping[str, str]


def build_sheet_request(store: Store, paths: DataPaths, item_id: str) -> SheetRequest:
    """Arma la entrada del LLM; lee las extracciones fuera de transacción."""
    inp = build_input(store, paths, item_id)
    rows = store.conn.execute(
        "SELECT c.id, c.front_fr FROM cards c"
        " JOIN card_sources s ON s.card_id = c.id"
        " WHERE s.item_id = ? AND c.kind = 'vocab' AND c.removed_at IS NULL"
        " ORDER BY c.front_fr, c.id",
        (item_id,),
    ).fetchall()
    fronts = [str(row[1]) for row in rows]
    vocab = {norm_key(str(row[1])): str(row[0]) for row in rows}
    return SheetRequest(
        item_id=item_id,
        inp=inp,
        user_text=render_sheet_input(inp, fronts),
        vocab=vocab,
    )


def drop_identical_mistakes(out: SheetLlmOut) -> SheetLlmOut:
    """Quita los errores típicos sin corrección (``wrong_fr`` igual a ``right_fr``).

    Un error así no enseña nada, pero no invalida el resto de la ficha: se descarta
    solo esa entrada, igual que las frases clave sin ancla en el texto.
    """
    kept = [m for m in out.common_mistakes if norm_key(m.wrong_fr) != norm_key(m.right_fr)]
    if len(kept) == len(out.common_mistakes):
        return out
    return out.model_copy(update={"common_mistakes": kept})


def sheet_from_output(req: SheetRequest, out: SheetLlmOut, prompt_version: str) -> StudySheet:
    """Convierte la salida del LLM en la ficha guardable.

    ``vocab_card_ids`` incluye solo los fronts que existen como tarjeta
    ``vocab``, en el orden del LLM y sin repetir. Las frases clave que no están
    ancladas en el texto del material y los errores típicos sin corrección se
    descartan.
    """
    out = drop_identical_mistakes(out)
    vocab_card_ids: list[str] = []
    for front in out.vocab_fronts:
        cid = req.vocab.get(norm_key(front))
        if cid is not None and cid not in vocab_card_ids:
            vocab_card_ids.append(cid)
    key_phrases = [phrase for phrase in out.key_phrases if grounded(phrase.fr, req.inp.blocks)]
    return StudySheet(
        item_id=req.item_id,
        summary_es=out.summary_es,
        vocab_card_ids=vocab_card_ids,
        grammar=list(out.grammar),
        key_phrases=key_phrases,
        objectives_es=list(out.objectives_es),
        common_mistakes=list(out.common_mistakes),
        prompt_version=prompt_version,
    )


def _accept_output(data: dict[str, Any], inp: GenerationInput) -> list[str]:
    """Valida la salida del LLM contra la entrada concreta de la publicación."""
    return sheet_problems(drop_identical_mistakes(SheetLlmOut.model_validate(data)), inp)


def write_study_sheet(conn: sqlite3.Connection, sheet: StudySheet, now: str) -> bool:
    """Escribe la ficha ampliada; ``False`` si el admin la había editado.

    El ``WHERE`` del upsert protege la edición humana en la misma sentencia, no
    solo en la consulta de candidatos.
    """
    if sheet.prompt_version is None:
        raise ValueError("la ficha ampliada necesita prompt_version")
    cursor = conn.execute(
        "INSERT INTO sheets (item_id, json, generator, generator_version, updated_at)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(item_id) DO UPDATE SET json = excluded.json,"
        " generator = excluded.generator, generator_version = excluded.generator_version,"
        " updated_at = excluded.updated_at WHERE sheets.edited_by_human = 0",
        (sheet.item_id, sheet.model_dump_json(), SHEET_GENERATOR, sheet.prompt_version, now),
    )
    return cursor.rowcount > 0


@dataclass
class SheetRunResult:
    """Qué hizo un :func:`run_sheets`."""

    written: list[str] = field(default_factory=list)
    cached: int = 0
    failed: list[str] = field(default_factory=list)
    budget_exhausted: bool = False
    llm_down: bool = False
    pending: int = 0


def run_sheets(
    ctx: StageContext,
    llm: JsonLlm | None,
    *,
    item_ids: Sequence[str] | None = None,
    max_items: int = MAX_SHEETS_PER_RUN,
) -> SheetRunResult:
    """Amplía las fichas pendientes; sin LLM no toca nada y deja la base visible.

    ``BREAKER`` fallos seguidos de LLM cortan el run con ``llm_down``. Agotar el
    presupuesto diario corta con ``budget_exhausted``. ``pending`` son los
    candidatos que quedaron sin procesar (incluidos los que exceden
    ``max_items``).
    """
    conn = ctx.store.conn
    candidates = (
        list(item_ids)
        if item_ids is not None
        else items_needing_sheet(conn, PROMPT_VERSIONS["sheet"])
    )
    result = SheetRunResult()
    if llm is None:
        result.pending = len(candidates)
        return result

    now = format_ts(ctx.now())
    prompt_version = PROMPT_VERSIONS["sheet"]
    processed = 0
    failures_in_a_row = 0
    for item_id in candidates[:max_items]:
        try:
            req = build_sheet_request(ctx.store, ctx.paths, item_id)
            cached = cached_json(
                ctx.store,
                llm,
                task="sheet",
                system=SYSTEM_PROMPTS["sheet"],
                user=req.user_text,
                schema=SheetLlmOut,
                prompt_version=prompt_version,
                now=ctx.now,
                accept=partial(_accept_output, inp=req.inp),
            )
        except LlmBudgetExceeded:
            result.budget_exhausted = True
            break
        except LlmUnavailable as exc:
            result.failed.append(item_id)
            processed += 1
            failures_in_a_row += 1
            _logger.warning("ficha de %s sin LLM (%s)", item_id, type(exc).__name__)
            if failures_in_a_row >= BREAKER:
                result.llm_down = True
                break
            continue
        failures_in_a_row = 0
        processed += 1
        if cached.hit:
            result.cached += 1
        sheet = sheet_from_output(req, SheetLlmOut.model_validate(cached.data), prompt_version)
        if write_study_sheet(conn, sheet, now):
            result.written.append(item_id)
    result.pending = max(len(candidates) - processed, 0)
    return result
