"""Validadores de calidad de las salidas del LLM de estudio (AI-03).

Funciones puras. Cada una devuelve una lista de problemas en español; la lista vacía
significa que la salida se acepta. Ningún problema copia texto del curso: solo nombra
el campo y, cuando aplica, el índice.
"""

import re
from collections import Counter
from collections.abc import Collection, Mapping, Sequence

from frances.extract.lang import detect_lang
from frances.models.content import CardDraft, GenerationInput, TextBlock
from frances.study.prompts import NO_MATERIAL_TEXT
from frances.study.schemas import PlanWhyLlmOut, QuestionLlm, SheetLlmOut, TopicsLlmOut
from frances.textnorm import norm_key

#: Artículos que se ignoran al comparar una frase con el texto del material.
_ARTICLES = ("le ", "la ", "l'", "les ", "un ", "une ", "des ")
#: Tarjetas de gramática y conjugación describen reglas; no tienen que citar el texto.
_UNANCHORED_KINDS = frozenset({"grammar", "conjugation"})
_SENTENCE_RE = re.compile(r"(?<=[.!?\u2026])\s+")
_CITATION_RE = re.compile(r"\[(\d+)\]")
_BLANK = "___"
_MAX_SUMMARY_SENTENCES = 6
_MAX_TOPICS = 30
_MAX_PLAN_WHY_WORDS = 30


def _sentences(text: str) -> list[str]:
    return [part for part in _SENTENCE_RE.split(text.strip()) if part]


def _is_language(text: str, wanted: frozenset[str]) -> bool:
    """Idioma detectado en ``wanted``. Con 1 o 2 palabras, lingua no decide: se acepta."""
    lang = detect_lang(text)
    if lang in wanted:
        return True
    return lang == "unknown" and 0 < len(text.split()) <= 2


def is_french(text: str) -> bool:
    return _is_language(text, frozenset({"fr", "mixed"}))


def is_spanish(text: str) -> bool:
    return _is_language(text, frozenset({"es"}))


def _core(phrase: str) -> str:
    key = _flat(phrase)
    for article in _ARTICLES:
        if key.startswith(article):
            return key[len(article) :]
    return key


def _flat(text: str) -> str:
    """``norm_key`` con saltos de línea y espacios repetidos colapsados a uno.

    El texto de OCR y de diapositivas corta las frases en varias líneas; sin esto
    «Je m'appelle\\nLéa» no contiene «je m'appelle léa».
    """
    return " ".join(norm_key(text).split())


def grounded(phrase: str, blocks: Sequence[TextBlock]) -> bool:
    """La frase, sin artículo inicial, aparece en el texto de algún bloque."""
    core = _core(phrase)
    return bool(core) and any(core in _flat(block.text) for block in blocks)


def card_problems(draft: CardDraft, inp: GenerationInput) -> list[str]:
    problems: list[str] = []
    front = draft.front_fr.strip()
    if not front:
        problems.append("front_fr vacío")
    elif draft.kind not in _UNANCHORED_KINDS and not grounded(front, inp.blocks):
        problems.append("front_fr no aparece en el texto del material")
    if draft.kind == "phrase" and front and not is_french(front):
        problems.append("front_fr de una frase no está en francés")
    if not draft.back_es.strip():
        problems.append("back_es vacío")
    return problems


def sheet_problems(out: SheetLlmOut, inp: GenerationInput) -> list[str]:
    problems: list[str] = []
    summary = out.summary_es.strip()
    if not summary:
        problems.append("summary_es vacío")
    elif len(_sentences(summary)) > _MAX_SUMMARY_SENTENCES:
        problems.append("summary_es tiene más de 6 oraciones")
    if not 1 <= len(out.objectives_es) <= 5:
        problems.append("objectives_es debe tener entre 1 y 5 objetivos")
    if len(out.grammar) > 5:
        problems.append("grammar tiene más de 5 puntos")
    for index, point in enumerate(out.grammar):
        if len(point.examples) != 2:
            problems.append(f"grammar[{index}] no tiene exactamente 2 ejemplos")
    for index, mistake in enumerate(out.common_mistakes):
        if mistake.wrong_fr == mistake.right_fr:
            problems.append(f"common_mistakes[{index}]: wrong_fr igual a right_fr")
    if out.key_phrases:
        ungrounded = sum(not grounded(phrase.fr, inp.blocks) for phrase in out.key_phrases)
        if 2 * ungrounded > len(out.key_phrases):
            problems.append("más de la mitad de key_phrases no están en el texto del material")
    return problems


def topics_problems(
    out: TopicsLlmOut,
    item_ids: Collection[str],
    locked_items: Mapping[str, str],
    locked_topics: Mapping[str, str],
) -> list[str]:
    """Revisa temas contra el material.

    ``locked_items`` mapea publicación fija -> id de su tema; ``locked_topics`` mapea
    tema fijo -> título.
    """
    problems: list[str] = []
    if len(out.topics) > _MAX_TOPICS:
        problems.append("más de 30 temas")

    known = set(item_ids)
    placed = Counter(item for topic in out.topics for item in topic.item_ids)
    invented = [item for item in placed if item not in known]
    if invented:
        problems.append(f"id de publicación inventado en {len(invented)} lugar(es)")
    repeated = [item for item, count in placed.items() if count > 1]
    if repeated:
        problems.append(f"id de publicación repetido en {len(repeated)} tema(s)")
    missing = known - set(placed)
    if missing:
        problems.append(f"{len(missing)} publicación(es) sin tema")

    for index, topic in enumerate(out.topics):
        if not topic.title.strip():
            problems.append(f"title vacío en topics[{index}]")
    titles = Counter(topic.title.strip() for topic in out.topics if topic.title.strip())
    if any(count > 1 for count in titles.values()):
        problems.append("título repetido en más de un tema")
    keys = Counter(topic.key for topic in out.topics)
    if any(count > 1 for count in keys.values()):
        problems.append("key repetida")

    topic_of = {item: topic for topic in out.topics for item in topic.item_ids}
    for item, topic_id in locked_items.items():
        holder = topic_of.get(item)
        if holder is not None and holder.existing_topic_id != topic_id:
            problems.append("publicación bloqueada fuera de su tema")
    for topic_id, title in locked_topics.items():
        kept = [topic for topic in out.topics if topic.existing_topic_id == topic_id]
        if not kept:
            problems.append("tema bloqueado ausente de la salida")
        elif any(topic.title != title for topic in kept):
            problems.append("tema bloqueado con otro título")
    return problems


def question_problems(q: QuestionLlm, n_fragments: int) -> list[str]:
    problems: list[str] = []
    if not 1 <= q.source_block <= n_fragments:
        problems.append("source_block fuera de 1…n")
    if q.kind == "mcq":
        if len(set(q.options)) != len(q.options) or not 3 <= len(q.options) <= 5:
            problems.append("mcq sin 3 a 5 opciones distintas")
        if len(q.answers) != 1:
            problems.append("mcq: answers debe tener exactamente una opción")
        elif q.answers[0] not in q.options:
            problems.append("mcq: la respuesta no es una de las opciones")
    elif q.kind == "cloze":
        if q.prompt_fr is None or q.prompt_fr.count(_BLANK) != 1:
            problems.append("cloze sin exactamente un ___ en prompt_fr")
    elif q.kind == "translate":
        if not 1 <= len(q.answers) <= 3:
            problems.append("translate sin 1 a 3 respuestas en francés")
        elif not all(is_french(answer) for answer in q.answers):
            problems.append("translate: alguna respuesta no está en francés")
    elif q.kind == "order" and not 3 <= len(q.answers) <= 12:
        problems.append("order con menos de 3 o más de 12 palabras")
    return problems


def chat_problems(text: str, n_fragments: int) -> list[str]:
    if text == NO_MATERIAL_TEXT:
        return []
    markers = [int(match) for match in _CITATION_RE.findall(text)]
    if not markers:
        return ["sin ninguna cita [n] al material"]
    if any(not 1 <= marker <= n_fragments for marker in markers):
        return ["cita [n] fuera de rango"]
    return []


def plan_why_problems(out: PlanWhyLlmOut, positions: Collection[int]) -> list[str]:
    problems: list[str] = []
    expected = set(positions)
    got = Counter(line.position for line in out.lines)
    if expected - set(got):
        problems.append("faltan posiciones del plan")
    if any(count > 1 for count in got.values()):
        problems.append("posición repetida")
    if set(got) - expected:
        problems.append("posición ajena al plan")
    for index, line in enumerate(out.lines):
        words = len(line.why_es.split())
        if words == 0:
            problems.append(f"oración vacía en lines[{index}]")
        elif words > _MAX_PLAN_WHY_WORDS:
            problems.append(f"oración de más de 30 palabras en lines[{index}]")
    return problems
