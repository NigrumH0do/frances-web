"""Prompts de sistema versionados y renderizadores de entrada del LLM (AI-02).

Cada renderizador es determinista: el mismo argumento produce el mismo texto,
byte a byte, sin importar el orden de llegada ni la hora. Ese texto es la
entrada de la clave de caché.

Si cambia un texto de :data:`SYSTEM_PROMPTS`, sube su versión en
:data:`PROMPT_VERSIONS` y actualiza ``tests/fixtures/llm_eval/prompts.lock.json``.
El test ``test_prompt_lock_matches_system_text`` falla si no lo haces.
"""

from collections.abc import Mapping, Sequence

from pydantic import BaseModel

from frances.cards.llm import render_input
from frances.models.content import GenerationInput
from frances.study.schemas import (
    PlanWhyLlmOut,
    PromptCard,
    PromptFragment,
    PromptItem,
    PromptPlanEntry,
    PromptTopic,
    QuizLlmOut,
    SheetLlmOut,
    TopicsLlmOut,
)
from frances.textnorm import norm_key

PROMPT_VERSIONS: Mapping[str, str] = {
    "sheet": "sheet-1",
    "topics": "topics-1",
    "quiz": "quiz-1",
    "plan_why": "plan-why-1",
    "chat": "chat-1",
}

#: Esquema de salida por tarea. El de tarjetas (CRD-04) vive en ``frances.cards.llm``.
SCHEMAS: Mapping[str, type[BaseModel]] = {
    "sheet": SheetLlmOut,
    "topics": TopicsLlmOut,
    "quiz": QuizLlmOut,
    "plan_why": PlanWhyLlmOut,
}

NO_MATERIAL_TEXT = "El material del curso no cubre esta pregunta."

MAX_TOPICS_INPUT_CHARS = 32_000
ITEM_LINE_CHARS = 240
MAX_QUIZ_INPUT_CHARS = 16_000
MAX_FRAGMENT_CHARS = 700

_EMPTY = "\u2014"  # guion largo para valores vacíos


def _lines(*rows: str) -> str:
    return "\n".join(rows)


_SHEET_PROMPT = _lines(
    "Eres un asistente que prepara la ficha de estudio de una clase de francés para un "
    "estudiante universitario hispanohablante de nivel A1\u2013A2.",
    "Recibes el título y los bloques de texto de una publicación de su profesora, etiquetados "
    "con su idioma ([fr], [es], [mixed]), y la lista de tarjetas que ya existen para esa "
    "publicación.",
    "Devuelve solo un objeto JSON que cumpla el esquema sheet. No escribas nada fuera del JSON.",
    "Reglas:",
    "1. Usa únicamente contenido que aparece en el texto. Jamás inventes palabras, temas ni "
    "ejemplos.",
    "2. summary_es: de 2 a 4 oraciones en español que digan de qué trata la clase.",
    "3. objectives_es: de 1 a 5 objetivos que empiecen con un verbo en infinitivo.",
    "4. vocab_fronts: hasta 15 entradas copiadas exactamente de la lista de tarjetas, las más "
    "importantes primero.",
    "5. grammar: hasta 5 puntos; cada uno con título, explicación en español en una o dos "
    "oraciones y exactamente 2 ejemplos (fr y es) tomados o adaptados del texto.",
    "6. key_phrases: hasta 10 frases útiles copiadas del texto en francés, con su traducción.",
    "7. common_mistakes: hasta 5 errores típicos de un hispanohablante con este contenido: "
    "wrong_fr, right_fr y why_es en una oración.",
    "8. Conserva la ortografía francesa (tildes, cedillas, apóstrofos) tal como aparece en el "
    "texto.",
    "9. Si el texto no contiene francés, devuelve listas vacías y un resumen breve en español.",
)

_TOPICS_PROMPT = _lines(
    "Organizas las publicaciones de un curso de francés en temas de estudio para un estudiante "
    "hispanohablante.",
    "Recibes los temas actuales (los marcados [fijo] los editó el administrador) y las "
    "publicaciones del curso con su id, tema actual, tema de Classroom, título, resumen y "
    "etiquetas.",
    "Devuelve solo un objeto JSON que cumpla el esquema topics.",
    "Reglas:",
    "1. Cada id de publicación de la lista aparece en exactamente un tema. No inventes ids.",
    "2. Entre 1 y 30 temas, en el orden en que conviene estudiarlos.",
    "3. Un tema [fijo] conserva su id en existing_topic_id, su título y su descripción; puedes "
    "agregarle publicaciones.",
    "4. Una publicación marcada [fija] queda en su tema actual.",
    "5. Si un tema continúa un tema actual no fijo, pon su id en existing_topic_id; si no, null.",
    "6. title: de 2 a 6 palabras en español. description_es: una o dos oraciones.",
    "7. cefr: el nivel MCER que exige el tema (A1, A2, B1, B2, C1 o C2), o null si no se puede "
    "estimar.",
    "8. key: identificador corto y único por tema, en minúsculas y sin espacios.",
)

_QUIZ_PROMPT = _lines(
    "Escribes ejercicios de francés para un estudiante hispanohablante de nivel A1\u2013A2.",
    "Recibes el material de un tema o de una publicación: resúmenes, tarjetas (francés = "
    "español) y fragmentos numerados del texto original.",
    "Devuelve solo un objeto JSON que cumpla el esquema quiz, con entre 6 y 10 preguntas.",
    "Tipos:",
    "- mcq: prompt_es es la pregunta en español; options tiene 4 opciones distintas; answers "
    "tiene solo la opción correcta, copiada igual.",
    "- cloze: prompt_fr es una oración en francés con un único hueco ___; answers tiene de 1 a 3 "
    "formas correctas.",
    "- translate: prompt_es es una frase en español; answers tiene de 1 a 3 traducciones "
    "correctas al francés.",
    "- order: prompt_es dice qué frase armar; answers son las palabras de una frase del texto en "
    "el orden correcto (de 3 a 12); options vacío.",
    "Reglas:",
    "1. Cada pregunta se basa en un fragmento: source_block es su número.",
    "2. Usa solo vocabulario y estructuras del material. No inventes contenido.",
    "3. explanation_es explica la respuesta en una oración.",
    "4. Incluye al menos una pregunta de cada tipo si el material lo permite.",
)

_PLAN_WHY_PROMPT = _lines(
    "Explicas a un estudiante de francés, en una oración corta en español y hablándole de tú, "
    "por qué le conviene hacer cada tarea de su plan de hoy.",
    "Recibes las tareas numeradas con su motivo.",
    "Devuelve solo un objeto JSON que cumpla el esquema plan_why, con una línea por tarea y su "
    "position.",
    "No agregues tareas ni cambies fechas o cantidades. Máximo 25 palabras por oración.",
)

_CHAT_PROMPT = _lines(
    "Respondes preguntas de un estudiante hispanohablante sobre el material de su curso de "
    "francés.",
    "Recibes fragmentos numerados del material ([1], [2], \u2026) y la pregunta.",
    "Reglas:",
    "1. Responde en español, breve y claro; los ejemplos en francés van tal como aparecen en el "
    "material.",
    "2. Usa solo la información de los fragmentos. Después de cada afirmación pon entre corchetes "
    "el número del fragmento que la respalda, por ejemplo [2].",
    "3. Si los fragmentos no responden la pregunta, responde exactamente: "
    "El material del curso no cubre esta pregunta.",
    "4. No inventes datos, fechas ni ejemplos que no estén en los fragmentos.",
)

SYSTEM_PROMPTS: Mapping[str, str] = {
    "sheet": _SHEET_PROMPT,
    "topics": _TOPICS_PROMPT,
    "quiz": _QUIZ_PROMPT,
    "plan_why": _PLAN_WHY_PROMPT,
    "chat": _CHAT_PROMPT,
}


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit]


def render_sheet_input(inp: GenerationInput, card_fronts: Sequence[str]) -> str:
    """Bloques de la publicación y, al final, las tarjetas existentes ordenadas."""
    fronts = sorted(card_fronts, key=lambda front: (norm_key(front), front))
    cards = [f"- {front}" for front in fronts]
    return render_input(inp) + "\n\nTarjetas de la publicación:\n" + "\n".join(cards)


def _topic_line(topic: PromptTopic) -> str:
    prefix = "[fijo] " if topic.locked else ""
    return f"{prefix}{topic.id} | {topic.title} | {topic.description_es}"


def _item_line(item: PromptItem) -> str:
    prefix = "[fija] " if item.locked else ""
    topic = item.current_topic_id or _EMPTY
    classroom = item.classroom_topic or _EMPTY
    tags = ", ".join(item.tags) or _EMPTY
    line = (
        f"{prefix}{item.id} | tema actual: {topic} | Classroom: {classroom} | {item.title} | "
        f"{item.summary_es} | etiquetas: {tags}"
    )
    return line[:ITEM_LINE_CHARS]


def render_topics_input(topics: Sequence[PromptTopic], items: Sequence[PromptItem]) -> str:
    """Temas actuales y publicaciones, ordenados por id.

    Si el texto pasa :data:`MAX_TOPICS_INPUT_CHARS`, se omiten las publicaciones
    más viejas que ya tienen tema (en orden de id, que es estable y no depende de
    la hora) y se avisa con una línea final. Las omitidas conservan su tema.
    """
    head = ["Temas actuales:"]
    head.extend(_topic_line(topic) for topic in sorted(topics, key=lambda t: t.id))
    head.extend(["", "Publicaciones:"])

    rows = [(item, _item_line(item)) for item in sorted(items, key=lambda i: i.id)]
    size = sum(len(line) + 1 for line in head) + sum(len(line) + 1 for _, line in rows)

    dropped: set[int] = set()
    for index, (item, line) in enumerate(rows):
        if size <= MAX_TOPICS_INPUT_CHARS:
            break
        if item.current_topic_id is None or item.locked:
            continue
        dropped.add(index)
        size -= len(line) + 1

    lines = [*head, *(line for index, (_, line) in enumerate(rows) if index not in dropped)]
    if dropped:
        lines.append(f"({len(dropped)} publicaciones antiguas omitidas; conservan su tema)")
    return "\n".join(lines)


def render_quiz_input(
    title: str,
    summaries: Sequence[str],
    cards: Sequence[PromptCard],
    fragments: Sequence[PromptFragment],
) -> str:
    """Material de un tema o publicación, cortado a :data:`MAX_QUIZ_INPUT_CHARS`.

    Si el texto es demasiado largo se quitan fragmentos desde el final.
    """
    ordered_fragments = sorted(fragments, key=lambda f: f.n)
    ordered_cards = sorted(cards, key=lambda c: (norm_key(c.front_fr), c.front_fr, c.back_es))

    def build(kept: Sequence[PromptFragment]) -> str:
        parts = [
            f"Título: {title}",
            "",
            "Resúmenes:",
            *(f"- {summary}" for summary in sorted(summaries)),
            "",
            "Tarjetas (francés = español):",
            *(f"- {card.front_fr} = {card.back_es}" for card in ordered_cards),
            "",
            "Fragmentos:",
            *(f"[{frag.n}] ({frag.label}) {_clip(frag.text, MAX_FRAGMENT_CHARS)}" for frag in kept),
        ]
        return "\n".join(parts)

    kept = list(ordered_fragments)
    text = build(kept)
    while len(text) > MAX_QUIZ_INPUT_CHARS and kept:
        kept.pop()
        text = build(kept)
    return text[:MAX_QUIZ_INPUT_CHARS]


def render_plan_why_input(entries: Sequence[PromptPlanEntry]) -> str:
    """Tareas del plan de hoy, ordenadas por posición."""
    rows = [
        f"{entry.position}. [{entry.kind}] {entry.title_es} | motivo: {entry.reason_es}"
        for entry in sorted(entries, key=lambda e: e.position)
    ]
    return "Tareas:\n" + "\n".join(rows)


def render_chat_messages(
    question: str,
    fragments: Sequence[PromptFragment],
    history: Sequence[tuple[str, str]],
) -> list[dict[str, str]]:
    """Mensajes para el chat: sistema, historia en orden y la pregunta con fragmentos."""
    frag_lines = [
        f"[{frag.n}] ({frag.label}) {_clip(frag.text, MAX_FRAGMENT_CHARS)}"
        for frag in sorted(fragments, key=lambda f: f.n)
    ]
    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPTS["chat"]}]
    messages.extend({"role": role, "content": content} for role, content in history)
    messages.append(
        {
            "role": "user",
            "content": "Fragmentos:\n" + "\n".join(frag_lines) + f"\n\nPregunta: {question}",
        }
    )
    return messages
