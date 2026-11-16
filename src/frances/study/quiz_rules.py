"""Reglas deterministas del respaldo de quizzes (AI-08).

Todo sale del material ya guardado: no hay red ni reloj. El mismo material y la
misma semilla producen las mismas preguntas, incluidas las opciones barajadas.
"""

import hashlib
import re
from collections.abc import Sequence
from typing import TypeVar

from frances.study.quiz import (
    MAX_DICTATION,
    MAX_QUESTIONS,
    CardFact,
    Fragment,
    QuizMaterial,
    StoredQuestion,
)
from frances.textnorm import norm_key

T = TypeVar("T")

#: Preguntas por tipo que aporta el respaldo por reglas.
_MAX_PER_KIND = 3
_BLANK = "___"
_ORDER_MIN_WORDS = 3
_ORDER_MAX_WORDS = 12
_ARTICLE_RE = re.compile(r"^(?:le|la|les|un|une|des)\s+|^l['\u2019]", re.IGNORECASE)


def stable_shuffle(xs: Sequence[T], seed: str) -> list[T]:
    """Permutación determinista: orden por ``sha256(seed + "\\x1f" + repr(i))``."""
    decorated = [
        (hashlib.sha256(f"{seed}\x1f{index!r}".encode()).hexdigest(), index, value)
        for index, value in enumerate(xs)
    ]
    decorated.sort(key=lambda item: (item[0], item[1]))
    return [value for _digest, _index, value in decorated]


def rules_questions(m: QuizMaterial, *, seed: str) -> list[StoredQuestion]:
    """Preguntas escritas del respaldo: mcq, traducir, completar y ordenar."""
    questions = [
        *_mcq_questions(m, seed),
        *_translate_questions(m),
        *_cloze_questions(m),
        *_order_questions(m, seed),
    ]
    return questions[: MAX_QUESTIONS - MAX_DICTATION]


def dictation_questions(m: QuizMaterial, *, limit: int = MAX_DICTATION) -> list[StoredQuestion]:
    """Dictados que reutilizan el audio ``front`` ya ligado a la tarjeta.

    No se crea audio: ``audio_cache_key`` es la clave existente de ``card_audio``.
    La tarjeta puede tener el audio en cualquier estado; la vista de preguntas
    (AI-09) oculta el dictado mientras no esté ``done``.
    """
    limit = max(0, limit)
    questions: list[StoredQuestion] = []
    for card in m.cards:
        if card.front_audio_key is None:
            continue
        eligible = card.kind == "phrase" or (
            card.kind == "vocab" and len(card.front_fr.split()) >= 2
        )
        if not eligible:
            continue
        questions.append(
            StoredQuestion(
                kind="dictation",
                prompt_es="Escucha y escribe lo que oyes.",
                prompt_fr=None,
                options=[],
                answers=[card.front_fr],
                explanation_es=None,
                audio_cache_key=card.front_audio_key,
                source_block_id=None,
            )
        )
        if len(questions) >= limit:
            break
    return questions


def _bare(front_fr: str) -> str:
    """Frente sin artículo inicial: «le marché» → «marché», «l'école» → «école»."""
    return _ARTICLE_RE.sub("", front_fr.strip(), count=1).strip()


def _source_block(card: CardFact, fragments: Sequence[Fragment]) -> int | None:
    """Primer fragmento que contiene el ``front_fr`` (comparación normalizada)."""
    wanted = norm_key(card.front_fr)
    if not wanted:
        return None
    for fragment in fragments:
        if wanted in norm_key(fragment.text):
            return fragment.block_id
    return None


def _mcq_questions(m: QuizMaterial, seed: str) -> list[StoredQuestion]:
    questions: list[StoredQuestion] = []
    for index, card in enumerate(m.cards):
        if len(questions) >= _MAX_PER_KIND:
            break
        distractors: list[str] = []
        for other in m.cards:
            if other.card_id == card.card_id or other.kind != card.kind:
                continue
            if other.back_es == card.back_es or other.back_es in distractors:
                continue
            distractors.append(other.back_es)
            if len(distractors) == 3:
                break
        if len(distractors) < 3:
            continue
        options = stable_shuffle([card.back_es, *distractors], f"{seed}\x1fmcq\x1f{index}")
        questions.append(
            StoredQuestion(
                kind="mcq",
                prompt_es=f"¿Qué significa «{card.front_fr}»?",
                prompt_fr=None,
                options=options,
                answers=[card.back_es],
                explanation_es=None,
                audio_cache_key=None,
                source_block_id=_source_block(card, m.fragments),
            )
        )
    return questions


def _translate_questions(m: QuizMaterial) -> list[StoredQuestion]:
    questions: list[StoredQuestion] = []
    for card in m.cards:
        if len(questions) >= _MAX_PER_KIND:
            break
        if card.kind not in ("vocab", "phrase"):
            continue
        answers = [card.front_fr]
        bare = _bare(card.front_fr)
        if bare and bare != card.front_fr and bare not in answers:
            answers.append(bare)
        questions.append(
            StoredQuestion(
                kind="translate",
                prompt_es=f"Traduce al francés: «{card.back_es}»",
                prompt_fr=None,
                options=[],
                answers=answers,
                explanation_es=None,
                audio_cache_key=None,
                source_block_id=_source_block(card, m.fragments),
            )
        )
    return questions


def _cloze_questions(m: QuizMaterial) -> list[StoredQuestion]:
    questions: list[StoredQuestion] = []
    for card in m.cards:
        if len(questions) >= _MAX_PER_KIND:
            break
        if not card.example_fr:
            continue
        bare = _bare(card.front_fr)
        if not bare:
            continue
        pattern = re.compile(r"(?<!\w)" + re.escape(bare) + r"(?!\w)", re.IGNORECASE)
        matches = list(pattern.finditer(card.example_fr))
        if len(matches) != 1:
            continue
        match = matches[0]
        prompt_fr = card.example_fr[: match.start()] + _BLANK + card.example_fr[match.end() :]
        if prompt_fr.count(_BLANK) != 1:
            continue
        questions.append(
            StoredQuestion(
                kind="cloze",
                prompt_es=f"Completa la frase: «{card.back_es}»",
                prompt_fr=prompt_fr,
                options=[],
                answers=[bare],
                explanation_es=None,
                audio_cache_key=None,
                source_block_id=_source_block(card, m.fragments),
            )
        )
    return questions


def _order_questions(m: QuizMaterial, seed: str) -> list[StoredQuestion]:
    questions: list[StoredQuestion] = []
    for card in m.cards:
        if len(questions) >= _MAX_PER_KIND:
            break
        if card.kind != "phrase":
            continue
        words = card.front_fr.split()
        if not _ORDER_MIN_WORDS <= len(words) <= _ORDER_MAX_WORDS:
            continue
        options = stable_shuffle(words, f"{seed}\x1forder\x1f{card.card_id}")
        if options == words:
            options = options[1:] + options[:1]
        questions.append(
            StoredQuestion(
                kind="order",
                prompt_es=f"Ordena las palabras: «{card.back_es}»",
                prompt_fr=None,
                options=options,
                answers=words,
                explanation_es=None,
                audio_cache_key=None,
                source_block_id=_source_block(card, m.fragments),
            )
        )
    return questions
