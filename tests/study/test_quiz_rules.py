"""Reglas deterministas de los quizzes: mezcla estable, cinco tipos y dictado (AI-08).

Materiales sintéticos; ninguna función de este módulo abre la base ni la red.
"""

from frances.study.quiz import (
    MAX_DICTATION,
    MAX_QUESTIONS,
    CardFact,
    Fragment,
    QuizMaterial,
    QuizScope,
)
from frances.study.quiz_rules import dictation_questions, rules_questions, stable_shuffle
from frances.textnorm import norm_key


def _material(cards: list[CardFact], fragments: list[Fragment] | None = None) -> QuizMaterial:
    return QuizMaterial(
        scope=QuizScope("topic", "tp_1"),
        title="Tema de prueba",
        summaries=("Resumen sintético.",),
        cards=tuple(cards),
        fragments=tuple(fragments or []),
    )


def _card(
    card_id: str,
    kind: str,
    front_fr: str,
    back_es: str,
    *,
    example_fr: str | None = None,
    audio: str | None = None,
) -> CardFact:
    return CardFact(
        card_id=card_id,
        kind=kind,  # type: ignore[arg-type]
        front_fr=front_fr,
        back_es=back_es,
        example_fr=example_fr,
        example_es=None,
        front_audio_key=audio,
    )


CARDS = [
    _card(
        "cd_01_marche",
        "vocab",
        "le marché",
        "el mercado",
        example_fr="Nous allons au marché le samedi.",
    ),
    _card("cd_02_bonjour", "vocab", "bonjour", "buenos días"),
    _card("cd_03_merci", "vocab", "merci", "gracias"),
    _card("cd_04_pardon", "vocab", "pardon", "perdón"),
    _card(
        "cd_05_leve",
        "phrase",
        "Je me lève à sept heures.",
        "Me levanto a las siete.",
        audio="aud_leve",
    ),
    _card(
        "cd_06_soir",
        "phrase",
        "Le soir, je lis un livre.",
        "Por la noche leo un libro.",
        audio="aud_soir",
    ),
    _card("cd_07_va", "phrase", "Bonjour, comment ça va ?", "¿Cómo estás?"),
    _card("cd_08_tres", "vocab", "très bien", "muy bien", audio="aud_tres"),
    _card("cd_09_fromage", "vocab", "fromage", "queso", audio="aud_fromage"),
]

FRAGMENTS = [
    Fragment(
        block_id=1, item_id="cw_1", label="Tema, p. 1", text="Le marché ouvre tôt le samedi matin."
    ),
    Fragment(
        block_id=2,
        item_id="cw_1",
        label="Tema, p. 2",
        text="Je me lève à sept heures et je prends mon petit-déjeuner.",
    ),
    Fragment(
        block_id=3,
        item_id="cw_1",
        label="Tema, p. 3",
        text="Nous allons au marché le samedi.",
    ),
]


def test_stable_shuffle_is_deterministic_and_a_permutation() -> None:
    xs = ["a", "b", "c", "d", "e"]
    first = stable_shuffle(xs, "s")
    assert first == stable_shuffle(xs, "s")
    assert sorted(first) == sorted(xs)
    assert stable_shuffle(xs, "a") != stable_shuffle(xs, "b")


def test_rules_questions_cover_the_four_written_kinds() -> None:
    questions = rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1")
    kinds = {question.kind for question in questions}
    assert kinds == {"mcq", "translate", "cloze", "order"}
    assert len(questions) == MAX_QUESTIONS - MAX_DICTATION
    for kind in kinds:
        assert sum(question.kind == kind for question in questions) <= 3


def test_mcq_has_four_unique_options_and_the_answer_between_them() -> None:
    questions = [
        q for q in rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1") if q.kind == "mcq"
    ]
    assert questions
    for question in questions:
        assert len(question.options) == 4
        assert len(set(question.options)) == 4
        assert question.answers[0] in question.options


def test_translate_accepts_the_front_with_and_without_article() -> None:
    questions = rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1")
    marche = next(q for q in questions if q.prompt_es == "Traduce al francés: «el mercado»")
    assert marche.answers == ["le marché", "marché"]


def test_cloze_has_exactly_one_blank_and_the_bare_front_as_answer() -> None:
    questions = [
        q for q in rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1") if q.kind == "cloze"
    ]
    assert questions
    for question in questions:
        assert question.prompt_fr is not None
        assert question.prompt_fr.count("___") == 1
        assert question.answers[0] in question.prompt_fr.replace("___", question.answers[0])
    marche = next(q for q in questions if "marché" in q.answers)
    assert marche.prompt_fr == "Nous allons au ___ le samedi."
    assert marche.answers == ["marché"]


def test_order_options_are_a_shuffled_permutation_of_the_answer() -> None:
    questions = [
        q for q in rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1") if q.kind == "order"
    ]
    assert questions
    for question in questions:
        assert sorted(question.options) == sorted(question.answers)
        assert question.options != question.answers
        assert 3 <= len(question.answers) <= 12


def test_source_block_is_the_first_fragment_containing_the_front() -> None:
    questions = rules_questions(_material(CARDS, FRAGMENTS), seed="tp_1")
    marche = next(q for q in questions if q.prompt_es == "¿Qué significa «le marché»?")
    assert marche.source_block_id == 1
    expected = next(
        fragment.block_id
        for fragment in FRAGMENTS
        if norm_key("le marché") in norm_key(fragment.text)
    )
    assert marche.source_block_id == expected


def test_rules_questions_are_deterministic_for_the_same_seed() -> None:
    material = _material(CARDS, FRAGMENTS)
    assert rules_questions(material, seed="tp_1") == rules_questions(material, seed="tp_1")
    assert rules_questions(material, seed="tp_1") != rules_questions(material, seed="tp_2")


def test_dictation_reuses_phrase_and_multiword_vocab_audio() -> None:
    questions = dictation_questions(_material(CARDS, FRAGMENTS), limit=10)
    assert [question.answers[0] for question in questions] == [
        "Je me lève à sept heures.",
        "Le soir, je lis un livre.",
        "très bien",
    ]
    assert all(question.kind == "dictation" for question in questions)
    assert all(question.prompt_es == "Escucha y escribe lo que oyes." for question in questions)
    assert all(question.prompt_fr is None for question in questions)
    assert all(question.options == [] for question in questions)
    assert {question.audio_cache_key for question in questions} == {
        "aud_leve",
        "aud_soir",
        "aud_tres",
    }
    assert all(question.source_block_id is None for question in questions)


def test_dictation_default_limit_is_two() -> None:
    questions = dictation_questions(_material(CARDS, FRAGMENTS))
    assert len(questions) == MAX_DICTATION == 2
    assert [question.answers[0] for question in questions] == [
        "Je me lève à sept heures.",
        "Le soir, je lis un livre.",
    ]


def test_dictation_skips_cards_without_audio() -> None:
    questions = dictation_questions(_material(CARDS, FRAGMENTS), limit=10)
    answers = {question.answers[0] for question in questions}
    assert "Bonjour, comment ça va ?" not in answers
    assert "fromage" not in answers
