"""Reglas de IDs estables (plan maestro, «Reglas de IDs»)."""

import hashlib
import secrets

from frances.models.classroom import AttachmentKind, ItemKind
from frances.models.content import CardKind
from frances.textnorm import norm_key

ITEM_PREFIX: dict[str, str] = {"coursework": "cw_", "material": "mt_", "announcement": "an_"}


def item_id(kind: ItemKind, classroom_id: str) -> str:
    """Prefijo por tipo de publicación + id de Classroom."""
    return ITEM_PREFIX[kind] + classroom_id


def attachment_id(item_id: str, kind: AttachmentKind, external_id: str) -> str:
    """Id estable del adjunto: at_ + 16 hex del sha256 de sus tres partes."""
    digest = hashlib.sha256(f"{item_id}\x1f{kind}\x1f{external_id}".encode()).hexdigest()
    return "at_" + digest[:16]


def card_id(front_fr: str, kind: CardKind) -> str:
    """Id estable de la tarjeta: c_ + 16 hex de norm_key(frente) + kind.

    La misma palabra con apóstrofo tipográfico, en NFD o entre « »
    produce una sola tarjeta; cambiar ``kind`` cambia el id.
    """
    digest = hashlib.sha256((norm_key(front_fr) + "\x1f" + kind).encode()).hexdigest()
    return "c_" + digest[:16]


def content_hash(*parts: str) -> str:
    """Huella hex de las partes unidas con \\x1f."""
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


# ---- Reglas de IDs v2 (plan maestro v2, R-39): aleatorios con ``secrets`` ----


def new_user_id() -> str:
    """Id aleatorio de usuario: u_ + 16 hex."""
    return "u_" + secrets.token_hex(8)


def new_invite_id() -> str:
    """Id aleatorio de invitación: inv_ + 16 hex."""
    return "inv_" + secrets.token_hex(8)


def new_thread_id() -> str:
    """Id aleatorio de hilo de chat: th_ + 16 hex."""
    return "th_" + secrets.token_hex(8)


def new_topic_id() -> str:
    """Id aleatorio de tema de estudio: tp_ + 16 hex."""
    return "tp_" + secrets.token_hex(8)


def new_secret_token() -> str:
    """Token de sesión, CSRF o invitación (43 caracteres url-safe)."""
    return secrets.token_urlsafe(32)


def token_sha256(token: str) -> str:
    """Huella del token; es lo único que se guarda de sesión e invitación."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_card_id(user_id: str, front_fr: str, kind: CardKind) -> str:
    """Id estable de una tarjeta propia: uc_ + 16 hex de usuario + norm_key(frente) + kind."""
    digest = hashlib.sha256(f"{user_id}\x1f{norm_key(front_fr)}\x1f{kind}".encode()).hexdigest()
    return "uc_" + digest[:16]


def quiz_id(scope_kind: str, scope_id: str, input_hash: str) -> str:
    """Id estable del quiz: qz_ + 16 hex de sus tres partes."""
    return "qz_" + content_hash(scope_kind, scope_id, input_hash)[:16]


def question_id(quiz_id: str, position: int) -> str:
    """Id estable de la pregunta: q_ + 16 hex de quiz y posición."""
    return "q_" + hashlib.sha256(f"{quiz_id}\x1f{position}".encode()).hexdigest()[:16]


def llm_cache_key(task: str, input_text: str, prompt_version: str, model: str) -> str:
    """Clave de caché del LLM: sha256 de tarea, versión de prompt, modelo y entrada."""
    return content_hash(task, prompt_version, model, input_text)
