"""Caché del LLM de estudio por sha256 de (tarea, entrada, versión de prompt, modelo) (AI-01).

La clave usa exactamente el texto que se envía al modelo (R-43). Una salida que no
pasa los validadores de calidad (`accept`) no se guarda: se lanza `LlmRejected`.
La llamada al modelo corre fuera de cualquier transacción.
"""

import hashlib
import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from frances.cards.llm import LlmUnavailable
from frances.db.store import Store
from frances.models import llm_cache_key
from frances.timeutil import format_ts


class JsonLlm(Protocol):
    """Cliente con salida JSON validada; lo cumple `LlmGenerator`."""

    @property
    def model(self) -> str: ...

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type[BaseModel],
        prompt_version: str,
    ) -> dict[str, Any]: ...


class LlmRejected(LlmUnavailable):
    """Salida con forma válida que no pasó los validadores de calidad. No se cachea."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("salida del LLM rechazada por los validadores")
        self.problems = problems


@dataclass(frozen=True)
class CacheResult:
    data: dict[str, Any]
    key: str
    hit: bool


def cache_get(conn: sqlite3.Connection, key: str, now: str) -> dict[str, Any] | None:
    """Devuelve la salida cacheada y registra el acierto. Llamar dentro de `store.tx()`."""
    row = conn.execute("SELECT output_json FROM llm_cache WHERE key = ?", (key,)).fetchone()
    if row is None:
        return None
    conn.execute(
        "UPDATE llm_cache SET hits = hits + 1, last_hit_at = ? WHERE key = ?",
        (now, key),
    )
    loaded: dict[str, Any] = json.loads(row[0])
    return loaded


def cache_put(
    conn: sqlite3.Connection,
    *,
    key: str,
    task: str,
    prompt_version: str,
    model: str,
    user_text: str,
    output: Mapping[str, Any],
    now: str,
) -> None:
    """Guarda o reemplaza una salida. Llamar dentro de `store.tx()`."""
    input_sha256 = _sha256(user_text)
    output_json = json.dumps(
        dict(output), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    conn.execute(
        "INSERT OR REPLACE INTO llm_cache "
        "(key, task, prompt_version, model, input_sha256, output_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (key, task, prompt_version, model, input_sha256, output_json, now),
    )


def cached_json(
    store: Store,
    llm: JsonLlm,
    *,
    task: str,
    system: str,
    user: str,
    schema: type[BaseModel],
    prompt_version: str,
    now: Callable[[], datetime],
    accept: Callable[[dict[str, Any]], list[str]] | None = None,
) -> CacheResult:
    """Devuelve la salida del LLM, desde caché si la misma entrada ya se respondió."""
    key = llm_cache_key(task, user, prompt_version, llm.model)
    stamp = format_ts(now())

    with store.tx() as conn:
        cached = cache_get(conn, key, stamp)
    if cached is not None:
        try:
            schema.model_validate(cached)
        except ValidationError:
            cached = None  # entrada corrupta: se trata como fallo y se reemplaza
        else:
            return CacheResult(data=cached, key=key, hit=True)

    data = llm.complete_json(
        task=task,
        system=system,
        user=user,
        schema=schema,
        prompt_version=prompt_version,
    )
    problems = accept(data) if accept is not None else []
    if problems:
        raise LlmRejected(problems)

    with store.tx() as conn:
        cache_put(
            conn,
            key=key,
            task=task,
            prompt_version=prompt_version,
            model=llm.model,
            user_text=user,
            output=data,
            now=stamp,
        )
    return CacheResult(data=data, key=key, hit=False)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
