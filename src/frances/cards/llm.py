"""Generador LLM OpenAI-compatible con salida JSON estricta validada [CRD-04].

Contrato del proveedor en ``docs/decisions/ADR-006-llm.md``: POST a
``{LLM_BASE_URL}/chat/completions`` con ``Authorization: Bearer`` y un
``User-Agent`` de navegador fijo (el gateway está tras Cloudflare y rechaza
clientes sin él). La respuesta se valida contra :class:`GenerationOutput`;
si no cumple el esquema se hace un único reintento con el error como pista.
"""

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import datetime
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from frances.db.store import Store
from frances.db.usage import bogota_day, current_month, usage_add, usage_daily_add, usage_daily_get
from frances.log import get_logger
from frances.models.content import CardDraft, GenerationInput, GenerationOutput

#: Presupuesto máximo de caracteres que se envía en el mensaje de usuario.
MAX_INPUT_CHARS = 12_000

#: Recortes post-validación (plan CRD-04).
MAX_VOCAB = 25
MAX_PHRASES = 10
MAX_GRAMMAR_POINTS = 5

#: Versión de los prompts de tarjetas (clave de caché, R-43).
CARDS_PROMPT_VERSION = "cards-1"

_TEMPERATURE = 0.2
_TIMEOUT_S = 30.0
_CONNECT_TIMEOUT_S = 10.0
_CHAT_TEMPERATURE = 0.3
_SSE_PREFIX = "data:"
_SSE_DONE = "[DONE]"
_EVENT_STREAM = "text/event-stream"
_MAX_ERROR_CHARS = 1000
#: Nombre del esquema enviado a la API; se conserva el de v1.
_SCHEMA_NAME = "generation_output"
_METER_LLM_CALLS = "llm_calls"

#: ADR-006: UA de navegador fijo; Cloudflare responde 1010 sin él.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)

#: Texto fijado por el plan CRD-04 (copy exacta; no parafrasear). El guion de
#: «A1-A2» va escapado para no disparar RUF001: el valor en tiempo de
#: ejecución es idéntico al del plan.
SYSTEM_PROMPT = (
    "Eres un asistente que prepara material de estudio de francés para un estudiante "
    "universitario hispanohablante de nivel A1\u2013A2.\n"
    "Recibes una publicación de su profesora: un título y bloques de texto etiquetados "
    "con su idioma ([fr], [es], [mixed]).\n"
    "Devuelve solo un objeto JSON que cumpla el esquema generation_output. No escribas "
    "nada fuera del JSON.\n"
    "Reglas:\n"
    "1. Usa únicamente palabras, frases y temas que aparecen en el texto. Jamás inventes "
    "contenido que no esté en el texto.\n"
    '2. Tarjetas "vocab": máximo 25. front_fr es la palabra en forma de diccionario; '
    "los sustantivos llevan artículo (le, la, l', les). back_es es su traducción al "
    "español.\n"
    '3. Tarjetas "phrase": máximo 10 frases útiles copiadas del texto, de 3 a 14 '
    "palabras, con su traducción en back_es.\n"
    '4. Tarjetas "grammar" o "conjugation" solo si el texto trabaja ese punto: front_fr '
    "nombra la estructura en francés y back_es la explica en español en una o dos "
    "oraciones.\n"
    "5. Si una oración del texto usa la palabra, ponla en example_fr y su traducción en "
    "example_es; si no, déjalos en null.\n"
    '6. Nunca crees tarjetas de tipo "drill".\n'
    "7. Ficha (sheet): summary_es resume la publicación en español en 2 a 4 oraciones.\n"
    "8. vocab_fronts repite exactamente el front_fr de las tarjetas vocab más "
    "importantes.\n"
    "9. grammar tiene máximo 5 puntos; cada uno con título, explicación en español y "
    "exactamente 2 ejemplos (fr y es) tomados o adaptados del texto.\n"
    "10. key_phrases repite las frases útiles con su traducción.\n"
    "11. Conserva la ortografía francesa (tildes, cedillas, apóstrofos) tal como "
    "aparece en el texto.\n"
    "12. tags: como máximo 3 etiquetas cortas en español y en minúsculas, por ejemplo "
    '"saludos" o "familia".\n'
    "13. Si el texto no contiene francés, devuelve listas vacías y un resumen breve en "
    "español.\n"
    "Escribe todas las traducciones y explicaciones en español neutro, claras y breves."
)

_META_KEYS = ("default", "title", "description")
_LANG_PRIORITY = {"fr": 0, "mixed": 1}
_CARD_CAPS = {"vocab": MAX_VOCAB, "phrase": MAX_PHRASES}

_logger = get_logger(__name__)


class LlmUnavailable(Exception):
    """El LLM no respondió o no devolvió un JSON válido tras el reintento."""


class LlmBudgetExceeded(LlmUnavailable):
    """Se alcanzó llm.max_calls_per_day."""


class LlmStreamInterrupted(LlmUnavailable):
    """El flujo se cortó después de al menos un token."""


class CallMeter(Protocol):
    """Cuenta cada llamada HTTP al LLM antes de enviarla."""

    def reserve(self) -> None: ...


class DailyCallMeter:
    """Medidor diario con tope; cuenta en `usage_daily` y en `usage` mensual."""

    def __init__(self, store: Store, now: Callable[[], datetime], cap: int) -> None:
        self._store = store
        self._now = now
        self._cap = cap

    def reserve(self) -> None:
        """Reserva una llamada o lanza `LlmBudgetExceeded`; commit antes de volver."""
        moment = self._now()
        day = bogota_day(moment)
        with self._store.tx() as conn:
            used = usage_daily_get(conn, day, _METER_LLM_CALLS)
            if used >= self._cap:
                raise LlmBudgetExceeded("se alcanzó llm.max_calls_per_day")
            usage_daily_add(conn, day, _METER_LLM_CALLS, 1)
            usage_add(conn, current_month(moment), _METER_LLM_CALLS, 1)

    def remaining(self) -> int:
        """Llamadas que quedan hoy (solo lectura)."""
        used = usage_daily_get(self._store.conn, bogota_day(self._now()), _METER_LLM_CALLS)
        return max(self._cap - used, 0)


def render_input(inp: GenerationInput) -> str:
    """Título y bloques ``[lang] texto``, con ``fr`` y ``mixed`` primero.

    Los grupos conservan su orden original. Si el resultado supera
    :data:`MAX_INPUT_CHARS`, se corta el último bloque incluido para no
    superar el presupuesto.
    """
    blocks = sorted(inp.blocks, key=lambda block: _LANG_PRIORITY.get(block.lang, 2))
    chunks: list[str] = []
    if inp.title:
        chunks.append(f"Título: {inp.title}")
    chunks.extend(f"[{block.lang}] {block.text.strip()}" for block in blocks)

    parts: list[str] = []
    remaining = MAX_INPUT_CHARS
    for chunk in chunks:
        separator = 1 if parts else 0
        available = remaining - separator
        if available <= 0:
            break
        if len(chunk) <= available:
            parts.append(chunk)
            remaining -= len(chunk) + separator
        else:
            parts.append(chunk[:available])
            remaining = 0
    return "\n".join(parts)


def _accepts_null(prop: dict[str, Any]) -> bool:
    """True si el subesquema ya admite ``null``."""
    if prop.get("type") == "null":
        return True
    branches = prop.get("anyOf")
    return isinstance(branches, list) and any(
        isinstance(branch, dict) and branch.get("type") == "null" for branch in branches
    )


def _allow_null(prop: dict[str, Any]) -> None:
    """Amplía la propiedad para que admita ``null`` conservando metadatos."""
    if _accepts_null(prop):
        return
    meta = {key: prop[key] for key in _META_KEYS if key in prop}
    branch = {key: value for key, value in prop.items() if key not in _META_KEYS}
    prop.clear()
    prop.update(meta)
    prop["anyOf"] = [branch, {"type": "null"}]


def _enforce_strict(node: Any) -> None:
    """Cierra cada objeto del esquema: todo ``required`` y sin extras."""
    if isinstance(node, list):
        for item in node:
            _enforce_strict(item)
        return
    if not isinstance(node, dict) or "$ref" in node:
        return
    properties = node.get("properties")
    if isinstance(properties, dict):
        for prop in properties.values():
            if isinstance(prop, dict) and "default" in prop:
                _allow_null(prop)
            _enforce_strict(prop)
        node["required"] = list(properties)
        node["additionalProperties"] = False
    for key in list(node):
        if key in ("properties", "required", "additionalProperties"):
            continue
        _enforce_strict(node[key])


def strict_schema_for(model: type[BaseModel]) -> dict[str, Any]:
    """Esquema JSON de `model` apto para ``strict: true``.

    Parte de ``model.model_json_schema()`` y, en cada objeto, requiere todas
    las propiedades, prohíbe las extra y permite ``null`` en las que tenían un
    valor por defecto.
    """
    schema = model.model_json_schema()
    defs = schema.get("$defs")
    if isinstance(defs, dict):
        for definition in defs.values():
            _enforce_strict(definition)
    _enforce_strict(schema)
    return schema


def strict_schema() -> dict[str, Any]:
    """Esquema de tarjetas (:class:`GenerationOutput`) apto para ``strict: true``."""
    return strict_schema_for(GenerationOutput)


def _array_branch(schema: dict[str, Any]) -> dict[str, Any] | None:
    """Rama de tipo array del esquema (directa o dentro de un ``anyOf``)."""
    if schema.get("type") == "array":
        return schema
    branches = schema.get("anyOf")
    if isinstance(branches, list):
        for branch in branches:
            if isinstance(branch, dict) and branch.get("type") == "array":
                return branch
    return None


def _normalize_null_lists(value: Any, schema: dict[str, Any], defs: dict[str, Any]) -> Any:
    """Convierte ``null`` en propiedades de tipo array a ``[]`` antes de validar."""
    ref = schema.get("$ref")
    if isinstance(ref, str):
        target = defs.get(ref.rsplit("/", 1)[-1])
        if isinstance(target, dict):
            return _normalize_null_lists(value, target, defs)
        return value
    if value is None:
        return [] if _array_branch(schema) is not None else None
    if isinstance(value, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict):
            return {
                key: _normalize_null_lists(item, properties[key], defs)
                if key in properties and isinstance(properties[key], dict)
                else item
                for key, item in value.items()
            }
        return value
    if isinstance(value, list):
        array = _array_branch(schema)
        items = array.get("items") if array is not None else None
        if isinstance(items, dict):
            return [_normalize_null_lists(item, items, defs) for item in value]
        return value
    return value


def _parse_output(content: str, model: type[BaseModel]) -> dict[str, Any]:
    """Parsea y valida ``content`` contra `model`; ``ValueError`` si no cumple."""
    data = json.loads(content)
    if not isinstance(data, dict):
        raise ValueError("la respuesta no es un objeto JSON")
    schema = strict_schema_for(model)
    defs = schema.get("$defs")
    normalized = _normalize_null_lists(data, schema, defs if isinstance(defs, dict) else {})
    return model.model_validate_json(json.dumps(normalized)).model_dump(mode="json")


def _apply_caps(output: GenerationOutput) -> GenerationOutput:
    """Descarta tarjetas ``drill`` y aplica los topes del plan."""
    counts: dict[str, int] = {}
    kept: list[CardDraft] = []
    for card in output.cards:
        if card.kind == "drill":
            continue
        cap = _CARD_CAPS.get(card.kind)
        if cap is not None:
            used = counts.get(card.kind, 0)
            if used >= cap:
                continue
            counts[card.kind] = used + 1
        kept.append(card)
    sheet = output.sheet
    if len(sheet.grammar) > MAX_GRAMMAR_POINTS:
        sheet = sheet.model_copy(update={"grammar": sheet.grammar[:MAX_GRAMMAR_POINTS]})
    return GenerationOutput(cards=kept, sheet=sheet)


def _extract_content(response: httpx.Response) -> str:
    """Saca ``choices[0].message.content``; ``LlmUnavailable`` si no está."""
    try:
        body = response.json()
        content = body["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        _logger.warning("llm respuesta inesperada (sin contenido en el log)")
        raise LlmUnavailable("respuesta inesperada del LLM") from exc
    if not isinstance(content, str):
        _logger.warning("llm contenido no textual (sin contenido en el log)")
        raise LlmUnavailable("contenido no textual del LLM")
    return content


def _delta_text(event: Any) -> str:
    """Texto de ``choices[0].delta.content`` de un evento SSE; "" si no hay."""
    try:
        content = event["choices"][0]["delta"]["content"]
    except (KeyError, IndexError, TypeError):
        return ""
    return content if isinstance(content, str) else ""


def _stream_error(emitted: bool, message: str) -> LlmUnavailable:
    """`LlmStreamInterrupted` si ya salió texto; si no, `LlmUnavailable`."""
    if emitted:
        return LlmStreamInterrupted(message)
    return LlmUnavailable(message)


class LlmGenerator:
    """Cliente ``chat/completions`` con salida JSON validada."""

    name = "llm"
    version = "1"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        client: httpx.Client | None = None,
        *,
        timeout_s: float = _TIMEOUT_S,
        meter: CallMeter | None = None,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._api_key = api_key
        self._model = model
        self._timeout_s = timeout_s
        self._meter = meter
        # trust_env=False: sin proxies del entorno ni red en tests (R-02).
        self._client = client if client is not None else httpx.Client(trust_env=False)

    @property
    def model(self) -> str:
        return self._model

    def _headers(self) -> dict[str, str]:
        # ADR-006 eligió Bearer; `api-key` se mantiene por el contrato del plan.
        return {
            "Authorization": f"Bearer {self._api_key}",
            "api-key": self._api_key,
            "User-Agent": USER_AGENT,
        }

    def _complete(
        self,
        messages: list[dict[str, str]],
        schema_name: str,
        schema_dict: dict[str, Any],
        *,
        task: str,
        prompt_version: str,
    ) -> str:
        """POST del turno completo; ``LlmUnavailable`` en cualquier fallo.

        El medidor (si hay) reserva la llamada antes de cada POST; si se agotó
        el cupo, ``LlmBudgetExceeded`` sale sin tocar la red.
        """
        if self._meter is not None:
            self._meter.reserve()
        body = {
            "model": self._model,
            "temperature": _TEMPERATURE,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": schema_dict,
                },
            },
        }
        where = f"task={task} prompt_version={prompt_version}"
        try:
            response = self._client.post(
                self._url,
                json=body,
                headers=self._headers(),
                timeout=self._timeout_s,
            )
        except httpx.TimeoutException as exc:
            _logger.warning("llm timeout (%s)", where)
            raise LlmUnavailable("timeout del LLM") from exc
        except httpx.HTTPError as exc:
            _logger.warning("llm error de red (%s): %s", where, type(exc).__name__)
            raise LlmUnavailable("error de red con el LLM") from exc
        if response.status_code != 200:
            _logger.warning("llm fallo HTTP %s (%s)", response.status_code, where)
            raise LlmUnavailable(f"el LLM respondió HTTP {response.status_code}")
        return _extract_content(response)

    def complete_json(
        self,
        task: str,
        system: str,
        user: str,
        schema: type[BaseModel],
        prompt_version: str,
        *,
        schema_name: str = _SCHEMA_NAME,
    ) -> dict[str, Any]:
        """Pide JSON estricto validado contra `schema` y lo devuelve como dict.

        Un único reintento con el error de validación, igual que v1. Los logs
        nombran `task` y `prompt_version`, nunca el contenido.
        """
        schema_dict = strict_schema_for(schema)
        messages: list[dict[str, str]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        content = self._complete(
            messages, schema_name, schema_dict, task=task, prompt_version=prompt_version
        )
        try:
            return _parse_output(content, schema)
        except ValueError as exc:
            problem = str(exc)[:_MAX_ERROR_CHARS]
            _logger.info("llm respuesta inválida, reintento único (task=%s)", task)
        messages.append({"role": "assistant", "content": content})
        messages.append(
            {
                "role": "user",
                "content": (
                    f"La respuesta no cumple el esquema: {problem}. "
                    "Devuelve solo el JSON corregido."
                ),
            }
        )
        content = self._complete(
            messages, schema_name, schema_dict, task=task, prompt_version=prompt_version
        )
        try:
            return _parse_output(content, schema)
        except ValueError as exc:
            raise LlmUnavailable("el LLM no devolvió un JSON válido tras el reintento") from exc

    def generate(self, inp: GenerationInput) -> GenerationOutput:
        """Tarjetas y ficha de una publicación; mismo contrato observable que v1."""
        data = self.complete_json(
            "cards",
            SYSTEM_PROMPT,
            render_input(inp),
            GenerationOutput,
            CARDS_PROMPT_VERSION,
        )
        return _apply_caps(GenerationOutput.model_validate(data))

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        task: str = "chat",
        prompt_version: str,
        temperature: float = _CHAT_TEMPERATURE,
    ) -> Iterator[str]:
        """Emite el texto de la respuesta a medida que llega (SSE).

        Reserva una llamada en el medidor antes de conectar. Solo se emite
        ``choices[0].delta.content``; el razonamiento (``reasoning_content``)
        se descarta. Si el proveedor ignora ``stream`` y responde JSON normal,
        se emite el contenido completo una vez. Cerrar el generador cierra la
        conexión. Un fallo antes del primer token lanza ``LlmUnavailable``; uno
        posterior, ``LlmStreamInterrupted``.
        """
        if self._meter is not None:
            self._meter.reserve()
        body = {
            "model": self._model,
            "temperature": temperature,
            "messages": messages,
            "stream": True,
        }
        where = f"task={task} prompt_version={prompt_version}"
        emitted = False
        timeout = httpx.Timeout(self._timeout_s, connect=_CONNECT_TIMEOUT_S)
        try:
            with self._client.stream(
                "POST", self._url, json=body, headers=self._headers(), timeout=timeout
            ) as response:
                if response.status_code != 200:
                    _logger.warning("llm fallo HTTP %s (%s)", response.status_code, where)
                    raise LlmUnavailable(f"el LLM respondió HTTP {response.status_code}")
                if _EVENT_STREAM not in response.headers.get("content-type", ""):
                    response.read()
                    yield _extract_content(response)
                    return
                for raw in response.iter_lines():
                    if not raw.startswith(_SSE_PREFIX):
                        continue
                    payload = raw[len(_SSE_PREFIX) :].strip()
                    if payload == _SSE_DONE:
                        return
                    try:
                        event = json.loads(payload)
                    except ValueError:
                        _logger.info("línea SSE ilegible (sin contenido en el log)")
                        continue
                    text = _delta_text(event)
                    if text:
                        emitted = True
                        yield text
        except httpx.TimeoutException as exc:
            _logger.warning("llm timeout en stream (%s)", where)
            raise _stream_error(emitted, "timeout del LLM") from exc
        except httpx.HTTPError as exc:
            _logger.warning("llm error de red en stream (%s): %s", where, type(exc).__name__)
            raise _stream_error(emitted, "error de red con el LLM") from exc


def llm_from_env(
    env: Mapping[str, str],
    *,
    timeout_s: float = _TIMEOUT_S,
    meter: CallMeter | None = None,
) -> LlmGenerator | None:
    """``None`` si falta ``LLM_BASE_URL``, ``LLM_API_KEY`` o ``LLM_MODEL``."""
    base_url = env.get("LLM_BASE_URL")
    api_key = env.get("LLM_API_KEY")
    model = env.get("LLM_MODEL")
    if not base_url or not api_key or not model:
        return None
    return LlmGenerator(base_url, api_key, model, timeout_s=timeout_s, meter=meter)
