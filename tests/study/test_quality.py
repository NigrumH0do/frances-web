"""Validadores de calidad de las salidas del LLM de estudio (AI-03)."""

from frances.models.content import (
    CardDraft,
    CommonMistake,
    Example,
    GenerationInput,
    GrammarPoint,
    TextBlock,
)
from frances.study.prompts import NO_MATERIAL_TEXT
from frances.study.quality import (
    card_problems,
    chat_problems,
    grounded,
    is_french,
    is_spanish,
    plan_why_problems,
    question_problems,
    sheet_problems,
    topics_problems,
)
from frances.study.schemas import (
    PlanWhyLine,
    PlanWhyLlmOut,
    QuestionLlm,
    SheetLlmOut,
    TopicLlm,
    TopicsLlmOut,
)

BLOCKS = [
    TextBlock(
        text="Bonjour, comment ça va aujourd\u2019hui ? Très bien, merci !",
        lang="fr",
        source="item",
    ),
    TextBlock(
        text="Esta lección presenta los saludos formales e informales.", lang="es", source="item"
    ),
]
INP = GenerationInput(
    item_id="syn-saludos", title="Saludos sin prisa", blocks=BLOCKS, input_hash="0" * 64
)
ITEM_IDS = {"syn-saludos", "syn-numeros"}


def _card(kind: str, front: str, back: str = "buenos días") -> CardDraft:
    return CardDraft.model_validate({"kind": kind, "front_fr": front, "back_es": back})


def _sheet(**overrides: object) -> SheetLlmOut:
    base: dict[str, object] = {
        "summary_es": "La lección enseña a saludar. Sirve para empezar una conversación.",
        "objectives_es": ["Saludar con fórmulas formales"],
        "vocab_fronts": ["bonjour"],
        "grammar": [
            GrammarPoint(
                title="Saludos",
                explanation_es="Bonjour sirve siempre.",
                examples=[Example(fr="Bonjour", es="Buenos días"), Example(fr="Salut", es="Hola")],
            )
        ],
        "key_phrases": [Example(fr="Très bien, merci !", es="Muy bien, gracias.")],
        "common_mistakes": [
            CommonMistake(
                wrong_fr="Bonjour, ça va",
                right_fr="Bonjour, comment ça va ?",
                why_es="Falta la palabra comment.",
            )
        ],
    }
    base.update(overrides)
    return SheetLlmOut.model_validate(base)


def _topic(
    key: str,
    item_ids: list[str],
    existing: str | None = None,
    title: str = "Saludos y números",
) -> TopicLlm:
    return TopicLlm(
        key=key,
        existing_topic_id=existing,
        title=title,
        description_es="Tema de prueba.",
        cefr="A1",
        item_ids=item_ids,
    )


def _question(**overrides: object) -> QuestionLlm:
    base: dict[str, object] = {
        "kind": "mcq",
        "prompt_es": "¿Cómo se dice buenos días en francés?",
        "prompt_fr": None,
        "options": ["Bonjour", "Merci", "Pardon"],
        "answers": ["Bonjour"],
        "explanation_es": None,
        "source_block": 1,
    }
    base.update(overrides)
    return QuestionLlm.model_validate(base)


def test_is_french_and_spanish_use_detected_language() -> None:
    assert is_french("Comment ça va aujourd\u2019hui ?")
    assert not is_french("Esta lección presenta los saludos formales.")
    assert is_spanish("Esta lección presenta los saludos formales.")
    assert not is_spanish("Comment ça va aujourd\u2019hui ?")


def test_short_text_is_accepted_only_up_to_two_words() -> None:
    assert is_french("pomme")
    assert not is_french("")
    assert not is_french("ok ok ok")


def test_grounded_ignores_article_case_and_apostrophe() -> None:
    blocks = [TextBlock(text="J\u2019ai une Pomme rouge.", lang="fr", source="item")]
    assert grounded("la pomme", blocks)
    assert grounded("une pomme rouge", blocks)
    assert not grounded("la poire", blocks)


def test_grounded_rejects_empty_phrase_after_article() -> None:
    assert not grounded("la", BLOCKS)
    assert not grounded("   ", BLOCKS)


def test_card_problems_accepts_grounded_card() -> None:
    assert card_problems(_card("vocab", "Bonjour"), INP) == []


def test_card_problems_flags_front_not_in_material() -> None:
    found = card_problems(_card("vocab", "pain au chocolat"), INP)
    assert any("front_fr no aparece en el texto" in p for p in found)


def test_card_problems_exempts_grammar_and_conjugation_from_grounding() -> None:
    assert card_problems(_card("grammar", "Pronoms personnels"), INP) == []
    assert card_problems(_card("conjugation", "être"), INP) == []


def test_card_problems_flags_empty_fields_and_non_french_phrase() -> None:
    assert any("back_es vacío" in p for p in card_problems(_card("vocab", "Bonjour", ""), INP))
    assert any("front_fr vacío" in p for p in card_problems(_card("drill", " "), INP))
    spanish = card_problems(_card("phrase", "¿Cómo estás hoy?"), INP)
    assert any("no está en francés" in p for p in spanish)


def test_card_problems_do_not_echo_course_text() -> None:
    found = card_problems(_card("vocab", "pain au chocolat"), INP)
    assert found
    assert all("pain" not in p and "chocolat" not in p for p in found)


def test_sheet_problems_accepts_valid_sheet() -> None:
    assert sheet_problems(_sheet(), INP) == []


def test_sheet_problems_limits_sentences_objectives_and_grammar() -> None:
    many = " ".join(f"Oración {i}." for i in range(1, 8))
    assert any("más de 6 oraciones" in p for p in sheet_problems(_sheet(summary_es=many), INP))
    assert any("entre 1 y 5 objetivos" in p for p in sheet_problems(_sheet(objectives_es=[]), INP))
    one_example = _sheet(
        grammar=[
            GrammarPoint(
                title="Saludos",
                explanation_es="Bonjour sirve siempre.",
                examples=[Example(fr="Bonjour", es="Buenos días")],
            )
        ]
    )
    assert any("exactamente 2 ejemplos" in p for p in sheet_problems(one_example, INP))


def test_sheet_problems_flags_identical_mistake_and_ungrounded_phrases() -> None:
    same = _sheet(
        common_mistakes=[CommonMistake(wrong_fr="Bonjour", right_fr="Bonjour", why_es="Nada.")]
    )
    assert any("wrong_fr igual a right_fr" in p for p in sheet_problems(same, INP))
    invented = _sheet(
        key_phrases=[
            Example(fr="Je suis très content.", es="Estoy muy contento."),
            Example(fr="Il pleut beaucoup.", es="Llueve mucho."),
        ]
    )
    assert any("más de la mitad de key_phrases" in p for p in sheet_problems(invented, INP))


def test_grounded_ignores_line_breaks_and_repeated_spaces() -> None:
    """El texto de OCR y diapositivas corta las frases en varias líneas (ADR-019)."""
    blocks = [
        TextBlock(
            text="Bonjour, je m'appelle\nLéa et  j'habite\n\nà Lyon.", lang="fr", source="item"
        )
    ]
    assert grounded("Je m'appelle Léa", blocks)
    assert grounded("j'habite à Lyon", blocks)
    assert not grounded("Je m'appelle Paul", blocks)


def test_topics_problems_accepts_complete_plan() -> None:
    out = TopicsLlmOut(
        topics=[_topic("a", ["syn-saludos"]), _topic("b", ["syn-numeros"], title="Contar")]
    )
    assert topics_problems(out, ITEM_IDS, {}, {}) == []


def test_topics_problems_flags_invented_repeated_and_missing_ids() -> None:
    invented = TopicsLlmOut(
        topics=[
            _topic("a", ["syn-saludos", "syn-fantasma"]),
            _topic("b", ["syn-numeros"], title="X"),
        ]
    )
    assert any(
        "id de publicación inventado" in p for p in topics_problems(invented, ITEM_IDS, {}, {})
    )
    repeated = TopicsLlmOut(
        topics=[
            _topic("a", ["syn-saludos"]),
            _topic("b", ["syn-saludos", "syn-numeros"], title="X"),
        ]
    )
    assert any(
        "id de publicación repetido" in p for p in topics_problems(repeated, ITEM_IDS, {}, {})
    )
    missing = TopicsLlmOut(topics=[_topic("a", ["syn-saludos"])])
    assert any("publicación(es) sin tema" in p for p in topics_problems(missing, ITEM_IDS, {}, {}))


def test_topics_problems_limits_count_titles_and_keys() -> None:
    first = _topic("t0", ["syn-saludos", "syn-numeros"], title="Tema 0")
    crowd = TopicsLlmOut(
        topics=[first, *(_topic(f"t{n}", [], title=f"Tema {n}") for n in range(1, 31))]
    )
    assert any("más de 30 temas" in p for p in topics_problems(crowd, ITEM_IDS, {}, {}))
    same_title = TopicsLlmOut(
        topics=[
            _topic("a", ["syn-saludos"], title="Mismo"),
            _topic("b", ["syn-numeros"], title="Mismo"),
        ]
    )
    assert any("título repetido" in p for p in topics_problems(same_title, ITEM_IDS, {}, {}))
    same_key = TopicsLlmOut(
        topics=[_topic("a", ["syn-saludos"]), _topic("a", ["syn-numeros"], title="Otro")]
    )
    assert any("key repetida" in p for p in topics_problems(same_key, ITEM_IDS, {}, {}))


def test_topics_problems_respects_locked_items_and_titles() -> None:
    out = TopicsLlmOut(
        topics=[_topic("a", ["syn-saludos"]), _topic("b", ["syn-numeros"], title="Otro")]
    )
    moved = topics_problems(out, ITEM_IDS, {"syn-saludos": "t-old"}, {})
    assert any("publicación bloqueada fuera de su tema" in p for p in moved)
    renamed = TopicsLlmOut(
        topics=[
            _topic("a", ["syn-saludos"], existing="t-old", title="Otro nombre"),
            _topic("b", ["syn-numeros"], title="Contar"),
        ]
    )
    locked = topics_problems(renamed, ITEM_IDS, {}, {"t-old": "Título fijo"})
    assert any("tema bloqueado con otro título" in p for p in locked)


def test_question_problems_accepts_each_kind() -> None:
    assert question_problems(_question(), 2) == []
    cloze = _question(
        kind="cloze", prompt_fr="___ comment ça va ?", options=[], answers=["Bonjour"]
    )
    assert question_problems(cloze, 2) == []
    translate = _question(kind="translate", prompt_es="Sí.", options=[], answers=["Oui."])
    assert question_problems(translate, 2) == []
    order = _question(kind="order", options=[], answers=["Comment", "ça", "va"])
    assert question_problems(order, 2) == []


def test_question_problems_flags_broken_questions() -> None:
    outside = _question(answers=["Merci de rien"])
    assert any("la respuesta no es una de las opciones" in p for p in question_problems(outside, 2))
    assert any(
        "source_block fuera de" in p for p in question_problems(_question(source_block=3), 2)
    )
    assert any("3 a 5 opciones" in p for p in question_problems(_question(options=["Bonjour"]), 2))
    assert any(
        "sin exactamente un ___" in p
        for p in question_problems(_question(kind="cloze", prompt_fr="Sans blanc."), 2)
    )
    assert any(
        "1 a 3 respuestas" in p
        for p in question_problems(_question(kind="translate", options=[], answers=[]), 2)
    )
    assert any(
        "menos de 3" in p
        for p in question_problems(_question(kind="order", options=[], answers=["Oui", "non"]), 2)
    )


def test_chat_problems_requires_valid_marker() -> None:
    assert chat_problems("Es manzana [1].", 2) == []
    assert chat_problems("Es manzana.", 2)
    assert chat_problems("Ver [3].", 2)
    assert chat_problems(NO_MATERIAL_TEXT, 0) == []


def test_chat_problems_reports_missing_citation_and_range() -> None:
    assert any("sin ninguna cita" in p for p in chat_problems("Es manzana.", 2))
    assert any("fuera de rango" in p for p in chat_problems("Ver [0].", 2))


def test_plan_why_problems_accepts_complete_lines() -> None:
    out = PlanWhyLlmOut(
        lines=[
            PlanWhyLine(position=1, why_es="Repasa hoy."),
            PlanWhyLine(position=2, why_es="Haz el quiz."),
        ]
    )
    assert plan_why_problems(out, [1, 2]) == []


def test_plan_why_problems_flags_positions_and_length() -> None:
    line = PlanWhyLine(position=1, why_es="Repasa hoy.")
    missing = PlanWhyLlmOut(lines=[line])
    assert any("faltan posiciones del plan" in p for p in plan_why_problems(missing, [1, 2]))
    foreign = PlanWhyLlmOut(lines=[line, PlanWhyLine(position=9, why_es="Otra.")])
    assert any("posición ajena al plan" in p for p in plan_why_problems(foreign, [1]))
    long_text = " ".join(["hoy"] * 31) + "."
    too_long = PlanWhyLlmOut(lines=[PlanWhyLine(position=1, why_es=long_text)])
    assert any("más de 30 palabras" in p for p in plan_why_problems(too_long, [1]))
    empty = PlanWhyLlmOut(lines=[PlanWhyLine(position=1, why_es="  ")])
    assert any("oración vacía" in p for p in plan_why_problems(empty, [1]))
