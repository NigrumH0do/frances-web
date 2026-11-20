"""Consultas de lectura de tarjetas, fichas, voces y audio (plan SRV-09).

Toda la visibilidad se decide en SQL: ``owner_user_id IS NULL OR owner_user_id =
user_id`` y ``removed_at IS NULL``. La copia personal (``card_overrides``) y el
estado FSRS se leen en la misma consulta de la página; los clips y los orígenes
se cargan en dos consultas ``IN (...)`` para no caer en N+1.
"""

import base64
import binascii
import json
import sqlite3
import threading
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal, cast

from frances.audio.voices import load_voices
from frances.cards.drills import build_drill_decks
from frances.models.api import AudioClip, CardOverride, CardPage, CardView
from frances.models.bundle import AudioPending, DrillDeck, VoiceOut
from frances.models.content import CardKind, StudySheet
from frances.models.study import FsrsCard, FsrsStateCode, UserCardStateOut
from frances.paths import DataPaths
from frances.textnorm import norm_key

_AudioField = Literal["front", "example"]

_CARD_COLUMNS = (
    "c.id, c.kind, c.front_fr, c.back_es, c.example_fr, c.example_es, c.notes,"
    " c.ipa, c.phonemes, c.tags, c.stale, c.owner_user_id, c.edited_by_human,"
    " c.edited_input_hash,"
    " o.front_fr, o.back_es, o.example_fr, o.example_es, o.notes,"
    " o.base_updated_at, o.updated_at,"
    " s.due, s.stability, s.difficulty, s.elapsed_days, s.scheduled_days,"
    " s.learning_steps, s.reps, s.lapses, s.state, s.last_review,"
    " s.suspended, s.flagged_hard, s.updated_at,"
    " EXISTS(SELECT 1 FROM card_sources cs JOIN generations g ON g.item_id = cs.item_id"
    "        WHERE cs.card_id = c.id AND g.input_hash IS NOT c.edited_input_hash)"
)
_CARD_JOIN = (
    " LEFT JOIN card_overrides o ON o.card_id = c.id AND o.user_id = ?"
    " LEFT JOIN user_card_state s ON s.card_id = c.id AND s.user_id = ?"
)

_VOICES_CACHE_MAX = 8
_VOICES_CACHE: dict[tuple[str, int | None], list[VoiceOut]] = {}
_VOICES_LOCK = threading.Lock()


def encode_cursor(card_id: str) -> str:
    """Cursor opaco de paginación: b64url de ``{"i": card_id}``."""
    raw = json.dumps({"i": card_id}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> str:
    """Decodifica un cursor; cualquier valor inválido lanza ``ValueError``."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        data = json.loads(raw)
    except (ValueError, binascii.Error, UnicodeError, RecursionError) as exc:
        raise ValueError("cursor inválido") from exc
    if not isinstance(data, dict) or set(data) != {"i"} or not isinstance(data["i"], str):
        raise ValueError("cursor inválido")
    return data["i"]


def _like_pattern(q: str) -> str:
    """Patrón ``LIKE`` con ``%``/``_``/``\\`` escapados y el texto normalizado."""
    escaped = norm_key(q).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _json_list(value: object) -> list[str]:
    """Lista de strings de una columna JSON; una fila corrupta no rompe la página."""
    if not isinstance(value, str):
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]


def _text(value: object) -> str | None:
    return None if value is None else str(value)


def _ipa(value: object) -> str | None:
    """IPA sin el prefijo ``v<N>|`` de v1 (R-12)."""
    if value is None:
        return None
    return str(value).split("|", 1)[-1]


def _audio_by_card(
    conn: sqlite3.Connection, card_ids: Sequence[str]
) -> tuple[dict[str, list[AudioClip]], dict[str, list[AudioPending]]]:
    """Clips ``done`` y pendientes de todas las tarjetas en una sola consulta."""
    done: dict[str, list[AudioClip]] = {}
    pending: dict[str, list[AudioPending]] = {}
    if not card_ids:
        return done, pending
    placeholders = ",".join("?" for _ in card_ids)
    rows = conn.execute(
        "SELECT ca.card_id, ca.field, au.voice_id, au.status, au.cache_key, au.duration_ms"
        " FROM card_audio ca JOIN audio au ON au.cache_key = ca.cache_key"
        f" WHERE ca.card_id IN ({placeholders})"
        " ORDER BY ca.card_id, ca.field, au.voice_id, ca.cache_key",
        tuple(card_ids),
    ).fetchall()
    for card_id, field, voice_id, status, cache_key, duration_ms in rows:
        cid = str(card_id)
        audio_field = cast("_AudioField", field)
        if status == "done":
            done.setdefault(cid, []).append(
                AudioClip(
                    field=audio_field,
                    voice_id=str(voice_id),
                    url=f"/api/audio/{cache_key}",
                    duration_ms=None if duration_ms is None else int(duration_ms),
                )
            )
        else:
            pending.setdefault(cid, []).append(
                AudioPending(field=audio_field, voice_id=str(voice_id))
            )
    return done, pending


def _sources_by_card(conn: sqlite3.Connection, card_ids: Sequence[str]) -> dict[str, list[str]]:
    """Publicaciones de origen de todas las tarjetas en una sola consulta."""
    sources: dict[str, list[str]] = {}
    if not card_ids:
        return sources
    placeholders = ",".join("?" for _ in card_ids)
    rows = conn.execute(
        "SELECT card_id, item_id FROM card_sources"
        f" WHERE card_id IN ({placeholders}) ORDER BY card_id, item_id",
        tuple(card_ids),
    ).fetchall()
    for card_id, item_id in rows:
        sources.setdefault(str(card_id), []).append(str(item_id))
    return sources


def _titles_by_item(conn: sqlite3.Connection, sources: dict[str, list[str]]) -> dict[str, str]:
    """Títulos legibles de las publicaciones referenciadas por ``sources``."""
    item_ids = sorted({item_id for ids in sources.values() for item_id in ids})
    if not item_ids:
        return {}
    placeholders = ",".join("?" for _ in item_ids)
    rows = conn.execute(
        f"SELECT id, title FROM items WHERE id IN ({placeholders})",
        tuple(item_ids),
    ).fetchall()
    return {str(row[0]): str(row[1]) for row in rows if row[1]}


def _state_from_row(row: tuple[Any, ...], card_id: str) -> UserCardStateOut | None:
    if row[21] is None:
        return None
    return UserCardStateOut(
        card_id=card_id,
        fsrs=FsrsCard(
            due=str(row[21]),
            stability=float(row[22]),
            difficulty=float(row[23]),
            elapsed_days=int(row[24]),
            scheduled_days=int(row[25]),
            learning_steps=int(row[26]),
            reps=int(row[27]),
            lapses=int(row[28]),
            state=cast("FsrsStateCode", int(row[29])),
            last_review=_text(row[30]),
        ),
        suspended=bool(row[31]),
        flagged_hard=bool(row[32]),
        updated_at=str(row[33]),
    )


def card_view_from_row(
    row: tuple[Any, ...],
    user_id: str,
    *,
    audio: list[AudioClip],
    audio_pending: list[AudioPending],
    source_item_ids: list[str],
    source_titles: dict[str, str] | None = None,
) -> CardView:
    """Vista de una tarjeta con la copia personal aplicada solo a su dueño."""
    card_id = str(row[0])
    mine = None
    if row[14] is not None:
        mine = CardOverride(
            front_fr=str(row[14]),
            back_es=str(row[15]),
            example_fr=_text(row[16]),
            example_es=_text(row[17]),
            notes=_text(row[18]),
            base_updated_at=str(row[19]),
            updated_at=str(row[20]),
        )
    edited_by_human = bool(row[12])
    return CardView(
        id=card_id,
        kind=cast("CardKind", row[1]),
        front_fr=mine.front_fr if mine is not None else str(row[2]),
        back_es=mine.back_es if mine is not None else str(row[3]),
        example_fr=mine.example_fr if mine is not None else _text(row[4]),
        example_es=mine.example_es if mine is not None else _text(row[5]),
        notes=mine.notes if mine is not None else _text(row[6]),
        ipa=_ipa(row[7]),
        phonemes=_json_list(row[8]),
        tags=_json_list(row[9]),
        stale=bool(row[10]),
        source_item_ids=source_item_ids,
        source_titles=source_titles or {},
        audio=audio,
        audio_pending=audio_pending,
        owner="mine" if row[11] == user_id else "shared",
        edited_by_human=edited_by_human,
        source_changed=edited_by_human and bool(row[34]),
        mine=mine,
        state=_state_from_row(row, card_id),
    )


def page_cards(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    item_id: str | None,
    kind: CardKind | None,
    q: str | None,
    include_stale: bool,
    cursor: str | None,
    limit: int,
) -> CardPage:
    """Página por ``id`` con solo las tarjetas visibles para ``user_id``."""
    where = ["(c.owner_user_id IS NULL OR c.owner_user_id = ?)", "c.removed_at IS NULL"]
    params: list[object] = [user_id]
    if item_id is not None:
        where.append(
            "EXISTS(SELECT 1 FROM card_sources cs WHERE cs.card_id = c.id AND cs.item_id = ?)"
        )
        params.append(item_id)
    if kind is not None:
        where.append("c.kind = ?")
        params.append(kind)
    if not include_stale:
        where.append("c.stale = 0")
    if cursor is not None:
        where.append("c.id > ?")
        params.append(decode_cursor(cursor))
    if q is not None:
        pattern = _like_pattern(q)
        if pattern == "%%":
            return CardPage(cards=[], next_cursor=None)
        conn.create_function("frances_norm_key", 1, norm_key)
        where.append(
            "(frances_norm_key(c.front_fr) LIKE ? ESCAPE '\\'"
            " OR frances_norm_key(c.back_es) LIKE ? ESCAPE '\\')"
        )
        params.extend((pattern, pattern))

    sql = (
        f"SELECT {_CARD_COLUMNS} FROM cards c{_CARD_JOIN}"
        f" WHERE {' AND '.join(where)} ORDER BY c.id LIMIT ?"
    )
    rows = conn.execute(sql, [user_id, user_id, *params, limit + 1]).fetchall()
    has_more = len(rows) > limit
    visible = [cast("tuple[Any, ...]", row) for row in rows[:limit]]
    card_ids = [str(row[0]) for row in visible]
    audio, pending = _audio_by_card(conn, card_ids)
    sources = _sources_by_card(conn, card_ids)
    titles = _titles_by_item(conn, sources)
    cards = [
        card_view_from_row(
            row,
            user_id,
            audio=audio.get(str(row[0]), []),
            audio_pending=pending.get(str(row[0]), []),
            source_item_ids=sources.get(str(row[0]), []),
            source_titles={
                iid: titles[iid] for iid in sources.get(str(row[0]), []) if iid in titles
            },
        )
        for row in visible
    ]
    next_cursor = encode_cursor(str(visible[-1][0])) if has_more and visible else None
    return CardPage(cards=cards, next_cursor=next_cursor)


def get_card_view(conn: sqlite3.Connection, user_id: str, card_id: str) -> CardView | None:
    """Tarjeta visible para el usuario, o ``None`` si no existe, está borrada o es ajena."""
    row = conn.execute(
        f"SELECT {_CARD_COLUMNS} FROM cards c{_CARD_JOIN}"
        " WHERE c.id = ? AND (c.owner_user_id IS NULL OR c.owner_user_id = ?)"
        " AND c.removed_at IS NULL",
        (user_id, user_id, card_id, user_id),
    ).fetchone()
    if row is None:
        return None
    typed = cast("tuple[Any, ...]", row)
    audio, pending = _audio_by_card(conn, [card_id])
    sources = _sources_by_card(conn, [card_id])
    titles = _titles_by_item(conn, sources)
    src_ids = sources.get(card_id, [])
    return card_view_from_row(
        typed,
        user_id,
        audio=audio.get(card_id, []),
        audio_pending=pending.get(card_id, []),
        source_item_ids=src_ids,
        source_titles={iid: titles[iid] for iid in src_ids if iid in titles},
    )


def get_sheet(conn: sqlite3.Connection, item_id: str) -> StudySheet | None:
    """Ficha de una publicación viva; ``None`` si no existe o está borrada."""
    row = conn.execute(
        "SELECT s.json FROM sheets s JOIN items i ON i.id = s.item_id"
        " WHERE s.item_id = ? AND i.deleted_at IS NULL",
        (item_id,),
    ).fetchone()
    if row is None:
        return None
    payload = cast("dict[str, Any]", json.loads(str(row[0])))
    payload["item_id"] = item_id
    return StudySheet.model_validate(payload)


def audio_for_download(
    conn: sqlite3.Connection, cache_key: str, paths: DataPaths
) -> tuple[Path, int | None] | None:
    """``(ruta, duración)`` solo si el clip está ``done``; la ruta la arma ``DataPaths``."""
    row = conn.execute(
        "SELECT duration_ms FROM audio WHERE cache_key = ? AND status = 'done'",
        (cache_key,),
    ).fetchone()
    if row is None:
        return None
    duration_ms = None if row[0] is None else int(row[0])
    return paths.audio_path(cache_key), duration_ms


def _visible_card_ids(conn: sqlite3.Connection, user_id: str, card_ids: Sequence[str]) -> set[str]:
    """Ids de ``card_ids`` visibles para el usuario y no borrados, en SQL."""
    unique = list(dict.fromkeys(card_ids))
    visible: set[str] = set()
    for start in range(0, len(unique), 500):
        chunk = unique[start : start + 500]
        placeholders = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT id FROM cards WHERE id IN ({placeholders})"
            " AND (owner_user_id IS NULL OR owner_user_id = ?) AND removed_at IS NULL",
            [*chunk, user_id],
        ).fetchall()
        visible.update(str(row[0]) for row in rows)
    return visible


def drill_decks_for_user(conn: sqlite3.Connection, user_id: str) -> list[DrillDeck]:
    """Mazos de ``build_drill_decks`` con los ``card_ids`` filtrados por usuario.

    ``build_drill_decks`` (CRD-07) arma los mazos con todas las tarjetas; aquí se
    quitan las privadas de otros usuarios y las que tienen ``removed_at``. El
    umbral ``AUTO_MIN_CARDS`` sigue siendo global: un mazo puede quedar con
    menos tarjetas visibles. Hacerlo por usuario exige tocar ``drills.py`` y se
    deja como seguimiento.
    """
    decks = build_drill_decks(conn)
    card_ids = [card_id for deck in decks for card_id in deck.card_ids]
    visible = _visible_card_ids(conn, user_id, card_ids)
    if len(visible) == len(set(card_ids)):
        return decks
    return [
        DrillDeck(
            id=deck.id,
            phoneme=deck.phoneme,
            title_es=deck.title_es,
            card_ids=[card_id for card_id in deck.card_ids if card_id in visible],
            curated=deck.curated,
        )
        for deck in decks
    ]


def enabled_voices(paths: DataPaths) -> list[VoiceOut]:
    """Voces habilitadas, memorizadas por la ruta y el ``mtime`` de ``voices.yaml``."""
    path = paths.voices_yaml
    try:
        mtime: int | None = path.stat().st_mtime_ns
    except OSError:
        mtime = None
    key = (str(path), mtime)
    with _VOICES_LOCK:
        cached = _VOICES_CACHE.get(key)
    if cached is not None:
        return cached
    voices = [
        VoiceOut(
            id=voice.id, label=voice.label, age=voice.age, gender=voice.gender, accent=voice.accent
        )
        for voice in load_voices(paths)
        if voice.enabled
    ]
    with _VOICES_LOCK:
        _VOICES_CACHE[key] = voices
        while len(_VOICES_CACHE) > _VOICES_CACHE_MAX:
            _VOICES_CACHE.pop(next(iter(_VOICES_CACHE)))
    return voices
