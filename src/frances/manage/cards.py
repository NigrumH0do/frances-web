"""Gestión de tarjetas desde la app (P11 MGT-01).

La tarjeta compartida vive en ``cards`` con ``owner_user_id IS NULL``. La copia
personal de cada usuario vive en ``card_overrides`` y nunca toca su estado FSRS.
Las tarjetas propias viven en ``cards`` con ``owner_user_id`` y se borran en
firme; el borrado del admin sobre una compartida es lógico (``removed_at``) y
marca ``edited_by_human = 1`` para que el pipeline no la resucite.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import cast

from frances.api.cards_repo import get_card_view
from frances.cards.input import build_input
from frances.cards.llm import DailyCallMeter, LlmUnavailable, llm_from_env
from frances.cards.merge import merge_output
from frances.cards.repo import llm_items_since
from frances.cards.rules import CardGenerator, RulesGenerator
from frances.cards.translate import translator_from_env
from frances.db.usage import current_month, usage_add
from frances.jobs.queue import enqueue, get_job, to_out
from frances.models import (
    CardKind,
    CardOverrideIn,
    CardView,
    GenerationInput,
    GenerationOutput,
    OwnCardIn,
    user_card_id,
)
from frances.models.jobs import JobOut
from frances.stage import StageContext
from frances.study.quality import card_problems
from frances.textnorm import display_clean
from frances.timeutil import BOGOTA, format_ts, norm_ts

#: ``edited_input_hash`` vigente de la primera publicación de origen de la tarjeta.
_EDITED_INPUT_HASH_SQL = (
    "(SELECT g.input_hash FROM generations g"
    " JOIN card_sources cs ON cs.item_id = g.item_id"
    " WHERE cs.card_id = ? ORDER BY cs.item_id LIMIT 1)"
)

_CARD_STATE_SQL = "SELECT owner_user_id, removed_at, updated_at FROM cards WHERE id = ?"


class CardConflict(Exception):
    """La operación choca con el estado de la tarjeta (duplicada o no editable)."""


class CardNotVisible(LookupError):
    """La tarjeta o publicación no existe, está borrada o es privada de otro usuario."""


@contextmanager
def _tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """``BEGIN IMMEDIATE`` propio, salvo que el llamador ya tenga una transacción."""
    if conn.in_transaction:
        yield conn
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _card_state(
    conn: sqlite3.Connection, card_id: str
) -> tuple[str | None, str | None, str] | None:
    """``(owner_user_id, removed_at, updated_at)`` o ``None`` si la fila no existe."""
    row = conn.execute(_CARD_STATE_SQL, (card_id,)).fetchone()
    if row is None:
        return None
    return (
        None if row[0] is None else str(row[0]),
        None if row[1] is None else str(row[1]),
        str(row[2]),
    )


def _override_fields(
    body: CardOverrideIn,
) -> tuple[str, str, str | None, str | None, str | None]:
    """Campos limpios de una edición; ``ValueError`` si el frente o el reverso quedan vacíos."""
    front = display_clean(body.front_fr)
    back = display_clean(body.back_es)
    if not front or not back:
        raise ValueError("front_fr y back_es no pueden estar vacíos")
    return front, back, body.example_fr, body.example_es, body.notes


def _own_fields(body: OwnCardIn) -> tuple[str, str, str | None, str | None, str | None]:
    """Campos limpios de una tarjeta propia; mismos mínimos que una edición."""
    front = display_clean(body.front_fr)
    back = display_clean(body.back_es)
    if not front or not back:
        raise ValueError("front_fr y back_es no pueden estar vacíos")
    return front, back, body.example_fr, body.example_es, body.notes


def upsert_my_card(
    conn: sqlite3.Connection, user_id: str, card_id: str, body: CardOverrideIn, now: str
) -> CardView:
    """Guarda la copia personal de una tarjeta compartida visible."""
    with _tx(conn):
        state = _card_state(conn, card_id)
        if state is None or state[1] is not None:
            raise CardNotVisible(card_id)
        if state[0] is not None:
            if state[0] == user_id:
                raise CardConflict("la tarjeta es propia; no tiene copia personal")
            raise CardNotVisible(card_id)
        front, back, example_fr, example_es, notes = _override_fields(body)
        conn.execute(
            "INSERT INTO card_overrides (user_id, card_id, front_fr, back_es, example_fr,"
            " example_es, notes, base_updated_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(user_id, card_id) DO UPDATE SET front_fr = excluded.front_fr,"
            " back_es = excluded.back_es, example_fr = excluded.example_fr,"
            " example_es = excluded.example_es, notes = excluded.notes,"
            " base_updated_at = excluded.base_updated_at, updated_at = excluded.updated_at",
            (user_id, card_id, front, back, example_fr, example_es, notes, state[2], now),
        )
        view = get_card_view(conn, user_id, card_id)
    if view is None:  # pragma: no cover - la fila se acaba de leer dentro de la transacción
        raise CardNotVisible(card_id)
    return view


def delete_my_card(conn: sqlite3.Connection, user_id: str, card_id: str, now: str) -> CardView:
    """Borra la copia personal y devuelve la tarjeta compartida base."""
    del now  # la firma es común con las demás escrituras; el borrado no necesita sello
    with _tx(conn):
        state = _card_state(conn, card_id)
        if state is None or state[1] is not None:
            raise CardNotVisible(card_id)
        if state[0] is not None:
            if state[0] == user_id:
                raise CardConflict("la tarjeta es propia; no tiene copia personal")
            raise CardNotVisible(card_id)
        conn.execute(
            "DELETE FROM card_overrides WHERE user_id = ? AND card_id = ?",
            (user_id, card_id),
        )
        view = get_card_view(conn, user_id, card_id)
    if view is None:  # pragma: no cover - la fila se acaba de leer dentro de la transacción
        raise CardNotVisible(card_id)
    return view


def create_own_card(conn: sqlite3.Connection, user_id: str, body: OwnCardIn, now: str) -> CardView:
    """Crea una tarjeta propia con id estable ``user_card_id``; duplicada → ``CardConflict``."""
    front, back, example_fr, example_es, notes = _own_fields(body)
    kind = cast("CardKind", body.kind)
    card_id = user_card_id(user_id, front, kind)
    with _tx(conn):
        if conn.execute("SELECT 1 FROM cards WHERE id = ?", (card_id,)).fetchone() is not None:
            raise CardConflict("ya existe una tarjeta con ese frente")
        try:
            conn.execute(
                "INSERT INTO cards (id, kind, front_fr, back_es, example_fr, example_es, notes,"
                " phonemes, tags, generator, generator_version, stale, created_at, updated_at,"
                " owner_user_id)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'user', '1', 0, ?, ?, ?)",
                (card_id, kind, front, back, example_fr, example_es, notes, now, now, user_id),
            )
        except sqlite3.IntegrityError as exc:  # carrera contra otro alta del mismo id
            raise CardConflict("ya existe una tarjeta con ese frente") from exc
        view = get_card_view(conn, user_id, card_id)
    if view is None:  # pragma: no cover - la fila se acaba de insertar
        raise CardNotVisible(card_id)
    return view


def delete_own_card(conn: sqlite3.Connection, user_id: str, card_id: str) -> None:
    """Borra en firme una tarjeta propia y sus filas hijas.

    Una compartida no se borra por esta vía (``PermissionError``); la propia de
    otro usuario responde como inexistente (``CardNotVisible``).
    """
    with _tx(conn):
        state = _card_state(conn, card_id)
        if state is None or state[1] is not None:
            raise CardNotVisible(card_id)
        if state[0] is None:
            raise PermissionError("las tarjetas compartidas solo las borra el admin")
        if state[0] != user_id:
            raise CardNotVisible(card_id)
        for table in (
            "review_log",
            "user_card_state",
            "card_overrides",
            "card_audio",
            "card_sources",
        ):
            conn.execute(f"DELETE FROM {table} WHERE card_id = ?", (card_id,))
        conn.execute("DELETE FROM cards WHERE id = ? AND owner_user_id = ?", (card_id, user_id))


def admin_update_card(
    conn: sqlite3.Connection, admin_id: str, card_id: str, body: CardOverrideIn, now: str
) -> CardView:
    """Edita la tarjeta compartida y la marca como editada por una persona."""
    with _tx(conn):
        state = _card_state(conn, card_id)
        if state is None or state[1] is not None:
            raise CardNotVisible(card_id)
        if state[0] is not None:
            raise CardConflict("la tarjeta pertenece a un usuario")
        front, back, example_fr, example_es, notes = _override_fields(body)
        conn.execute(
            "UPDATE cards SET front_fr = ?, back_es = ?, example_fr = ?, example_es = ?,"
            " notes = ?, edited_by_human = 1,"
            f" edited_input_hash = {_EDITED_INPUT_HASH_SQL}, updated_at = ?"
            " WHERE id = ? AND owner_user_id IS NULL AND removed_at IS NULL",
            (front, back, example_fr, example_es, notes, card_id, now, card_id),
        )
        view = get_card_view(conn, admin_id, card_id)
    if view is None:  # pragma: no cover - la fila se acaba de leer dentro de la transacción
        raise CardNotVisible(card_id)
    return view


def admin_delete_card(conn: sqlite3.Connection, admin_id: str, card_id: str, now: str) -> None:
    """Borra lógicamente una compartida: conserva la fila y bloquea su regeneración."""
    del admin_id  # la autorización ya la exige la ruta; no se guarda en la fila
    with _tx(conn):
        state = _card_state(conn, card_id)
        if state is None or state[1] is not None:
            raise CardNotVisible(card_id)
        if state[0] is not None:
            raise CardConflict("la tarjeta pertenece a un usuario")
        conn.execute(
            "UPDATE cards SET removed_at = ?, edited_by_human = 1,"
            f" edited_input_hash = {_EDITED_INPUT_HASH_SQL}, updated_at = ?"
            " WHERE id = ? AND owner_user_id IS NULL AND removed_at IS NULL",
            (now, card_id, now, card_id),
        )


def queue_regenerate_item(conn: sqlite3.Connection, item_id: str, now: datetime) -> JobOut:
    """Encola ``cards.regenerate_item`` para una publicación viva, con dedupe."""
    with _tx(conn):
        alive = conn.execute(
            "SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL", (item_id,)
        ).fetchone()
        if alive is None:
            raise CardNotVisible(item_id)
        job_id = enqueue(
            conn,
            "cards.regenerate_item",
            {"item_id": item_id},
            now=now,
            dedupe_key=f"cards.regenerate_item:{item_id}",
            priority=5,
        )
        job = get_job(conn, job_id)
    assert job is not None  # enqueue siempre deja una fila
    return to_out(job)


def regenerate_item(
    ctx: StageContext, item_id: str, *, generator: CardGenerator | None = None
) -> dict[str, int | str]:
    """Regenera las tarjetas de una publicación; nunca pisa ediciones humanas.

    El generador se inyecta en los tests. Sin él se usa el LLM si hay
    configuración y cupo, y se cae a reglas si el proveedor falla.
    """
    alive = ctx.store.conn.execute(
        "SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL", (item_id,)
    ).fetchone()
    if alive is None:
        raise CardNotVisible(item_id)
    try:
        inp = build_input(ctx.store, ctx.paths, item_id)
    except KeyError as exc:
        raise CardNotVisible(item_id) from exc

    if generator is None:
        chosen, output = _generate_with_defaults(ctx, inp)
    else:
        chosen, output = generator, generator.generate(inp)

    dropped = 0
    if chosen.name == "llm":
        output, dropped = _drop_ungrounded_llm_cards(output, inp)

    stats = merge_output(
        ctx.store, item_id, output, chosen.name, chosen.version, format_ts(ctx.now())
    )
    return {
        "generator": chosen.name,
        "cards": len(output.cards),
        "created": stats.cards_created,
        "updated": stats.cards_updated,
        "kept_human": stats.cards_kept_human,
        "dropped": dropped,
    }


def _generate_with_defaults(
    ctx: StageContext, inp: GenerationInput
) -> tuple[CardGenerator, GenerationOutput]:
    """LLM si está configurado, queda cupo y la política está en ``auto``; si no, reglas."""
    translator = translator_from_env(ctx.env, ctx.store, ctx.settings.translator.monthly_char_cap)
    rules = RulesGenerator(translator, vocab_max=ctx.settings.cards.vocab_per_item_max)
    if ctx.settings.llm.mode != "auto" or ctx.settings.cards.llm != "auto":
        return rules, rules.generate(inp)
    meter = DailyCallMeter(ctx.store, ctx.now, ctx.settings.llm.max_calls_per_day)
    llm = llm_from_env(ctx.env, timeout_s=float(ctx.settings.llm.timeout_s), meter=meter)
    if llm is not None and _llm_has_room(ctx):
        try:
            output = llm.generate(inp)
        except LlmUnavailable:
            pass
        else:
            with ctx.store.tx() as conn:
                usage_add(conn, current_month(ctx.now()), "llm_items", 1)
            return llm, output
    return rules, rules.generate(inp)


def _llm_has_room(ctx: StageContext) -> bool:
    """Cupo diario de publicaciones con LLM (R-14), contado desde medianoche de Bogotá."""
    local = ctx.now().astimezone(BOGOTA)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    since = norm_ts(midnight.isoformat())
    return llm_items_since(ctx.store.conn, since) < ctx.settings.cards.llm_daily_item_limit


def _drop_ungrounded_llm_cards(
    output: GenerationOutput, inp: GenerationInput
) -> tuple[GenerationOutput, int]:
    """Quita del LLM las tarjetas que no apuntan a un fragmento real (AI-03)."""
    kept = [draft for draft in output.cards if not card_problems(draft, inp)]
    dropped = len(output.cards) - len(kept)
    if dropped == 0:
        return output, 0
    return GenerationOutput(cards=kept, sheet=output.sheet), dropped
