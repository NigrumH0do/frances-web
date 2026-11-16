"""Genera los casos del set de evaluación del LLM (AI-03).

Todo sale de textos sintéticos escritos a mano en este archivo: lecciones inventadas sobre
saludos, números, familia, rutina y el pasado compuesto. Ningún dato viene de un curso real.
La generación es determinista: mismo código, mismos bytes.

Uso: uv run python tests/fixtures/llm_eval/build_eval.py
"""

import hashlib
import json
from pathlib import Path
from typing import Any

CASES_DIR = Path(__file__).resolve().parent / "cases"
NO_MATERIAL = "El material del curso no cubre esta pregunta."

LESSONS: dict[str, dict[str, Any]] = {
    "saludos": {
        "item_id": "syn-saludos",
        "title": "Saludos sin prisa",
        "summary": "Frases para saludar y responder a la pregunta cómo estás.",
        "blocks": [
            ("fr", "Bonjour, comment ça va aujourd\u2019hui ? Très bien, merci !"),
            ("es", "Esta lección presenta los saludos formales e informales."),
            ("fr", "Salut ! Ça va ? Oui, ça va bien, merci."),
        ],
    },
    "numeros": {
        "item_id": "syn-numeros",
        "title": "Contar hasta diez",
        "summary": "Los números del uno al diez para contar objetos.",
        "blocks": [
            ("fr", "un, deux, trois, quatre, cinq, six, sept, huit, neuf, dix."),
            ("es", "Los números del uno al diez aparecen en casi todas las conversaciones."),
            ("fr", "J\u2019ai trois chats et deux poissons rouges."),
        ],
    },
    "familia": {
        "item_id": "syn-familia",
        "title": "Mi familia",
        "summary": "Vocabulario de la familia y posesivos básicos.",
        "blocks": [
            ("fr", "Ma mère et mon frère habitent à Lille avec mon oncle."),
            ("es", "Vocabulario de la familia para describir a las personas."),
            ("fr", "Mon grand-père est très gentil et il aime le jardin."),
        ],
    },
    "rutina": {
        "item_id": "syn-rutina",
        "title": "Rutina diaria",
        "summary": "Verbos de la rutina de cada día.",
        "blocks": [
            ("fr", "Je me lève à sept heures et je prends mon petit-déjeuner."),
            ("es", "Verbos reflexivos de la rutina diaria."),
            ("fr", "Le soir, je me couche tard et je lis un livre."),
        ],
    },
    "pasado": {
        "item_id": "syn-pasado",
        "title": "El pasado compuesto",
        "summary": "Acciones terminadas con el pasado compuesto.",
        "blocks": [
            ("fr", "Hier, j\u2019ai mangé une pomme. Nous sommes allés au marché."),
            ("es", "El pasado compuesto se forma con avoir o être más el participio."),
        ],
    },
}


def _generation(key: str) -> dict[str, Any]:
    lesson = LESSONS[key]
    blocks = [
        {"text": text, "lang": lang, "source": "item", "page": None}
        for lang, text in lesson["blocks"]
    ]
    digest = hashlib.sha256(json.dumps(blocks, sort_keys=True).encode("utf-8")).hexdigest()
    return {
        "item_id": lesson["item_id"],
        "title": lesson["title"],
        "blocks": blocks,
        "input_hash": digest,
    }


def _fragments(key: str) -> list[dict[str, Any]]:
    lesson = LESSONS[key]
    return [
        {"n": index, "label": f"{lesson['title']}, p. {index}", "text": text}
        for index, (_, text) in enumerate(lesson["blocks"], start=1)
    ]


def _item(key: str, current: str | None = None, locked: bool = False) -> dict[str, Any]:
    lesson = LESSONS[key]
    return {
        "id": lesson["item_id"],
        "title": lesson["title"],
        "classroom_topic": "Unidad de prueba",
        "summary_es": lesson["summary"],
        "tags": [key],
        "current_topic_id": current,
        "locked": locked,
    }


def _case(task: str, case_id: str, inp: Any, expected: Any, bad: list[dict[str, Any]]) -> Any:
    return {
        "synthetic": True,
        "task": task,
        "case_id": case_id,
        "input": inp,
        "expected": expected,
        "bad": bad,
    }


def _bad(output: Any, problem: str) -> dict[str, Any]:
    return {"output": output, "problem": problem}


# ---------------------------------------------------------------- cards


def _card(kind: str, front: str, back: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "front_fr": front,
        "back_es": back,
        "example_fr": None,
        "example_es": None,
        "notes": None,
        "tags": [],
    }


CARD_SETS: dict[str, list[dict[str, Any]]] = {
    "saludos": [
        _card("vocab", "bonjour", "buenos días"),
        _card("phrase", "Comment ça va aujourd\u2019hui ?", "¿Cómo estás hoy?"),
        _card("drill", "Très bien, merci", "Muy bien, gracias"),
    ],
    "numeros": [
        _card("vocab", "trois", "tres"),
        _card(
            "phrase",
            "J\u2019ai trois chats et deux poissons rouges.",
            "Tengo tres gatos y dos peces rojos.",
        ),
        _card("grammar", "Números: un, une", "Uno se dice un con masculino y une con femenino."),
    ],
    "familia": [
        _card("vocab", "mère", "madre"),
        _card("phrase", "Mon grand-père est très gentil.", "Mi abuelo es muy amable."),
        _card(
            "drill",
            "Ma mère et mon frère habitent à Lille.",
            "Mi madre y mi hermano viven en Lille.",
        ),
    ],
    "pasado": [
        _card("vocab", "marché", "mercado"),
        _card("phrase", "Hier, j\u2019ai mangé une pomme.", "Ayer comí una manzana."),
        _card("conjugation", "j\u2019ai mangé", "comí, he comido"),
    ],
}

SHEET_DRAFT_KEYS = ("summary_es", "vocab_fronts", "grammar", "key_phrases")


def _grammar(title: str, explanation: str, examples: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "title": title,
        "explanation_es": explanation,
        "examples": [{"fr": fr, "es": es} for fr, es in examples],
    }


def _phrase(fr: str, es: str) -> dict[str, str]:
    return {"fr": fr, "es": es}


def _mistake(wrong: str, right: str, why: str) -> dict[str, str]:
    return {"wrong_fr": wrong, "right_fr": right, "why_es": why}


SHEETS: dict[str, dict[str, Any]] = {
    "saludos": {
        "summary_es": (
            "La lección enseña a saludar con fórmulas formales e informales. "
            "También explica cómo responder a la pregunta cómo estás."
        ),
        "objectives_es": ["Saludar con fórmulas formales e informales", "Responder a cómo estás"],
        "vocab_fronts": ["bonjour", "Très bien, merci"],
        "grammar": [
            _grammar(
                "Saludos formales e informales",
                "Bonjour sirve en cualquier contexto. Salut se usa con amigos.",
                [
                    ("Bonjour, comment ça va ?", "Buenos días, ¿cómo estás?"),
                    ("Salut ! Ça va ?", "¡Hola! ¿Qué tal?"),
                ],
            )
        ],
        "key_phrases": [
            _phrase("Oui, ça va bien, merci.", "Sí, bien, gracias."),
            _phrase("Salut ! Ça va ?", "¡Hola! ¿Qué tal?"),
        ],
        "common_mistakes": [
            _mistake(
                "Bonjour, ça va bien ?", "Bonjour, comment ça va ?", "Falta la palabra comment."
            ),
        ],
    },
    "numeros": {
        "summary_es": (
            "La lección presenta los números del uno al diez. "
            "Se usan para contar objetos y dar cantidades."
        ),
        "objectives_es": ["Contar del uno al diez en francés"],
        "vocab_fronts": ["trois"],
        "grammar": [
            _grammar(
                "Números cardinales",
                "Los números no cambian de forma delante de sustantivos.",
                [("trois chats", "tres gatos"), ("deux poissons", "dos peces")],
            )
        ],
        "key_phrases": [
            _phrase(
                "J\u2019ai trois chats et deux poissons rouges.",
                "Tengo tres gatos y dos peces rojos.",
            )
        ],
        "common_mistakes": [
            _mistake("un chats", "un chat", "Después de un el sustantivo va en singular.")
        ],
    },
    "familia": {
        "summary_es": (
            "Vocabulario para hablar de la familia y describir a las personas. "
            "La lección usa los posesivos ma y mon."
        ),
        "objectives_es": ["Nombrar a los miembros de la familia", "Usar los posesivos ma y mon"],
        "vocab_fronts": ["mère"],
        "grammar": [
            _grammar(
                "Posesivos",
                "Mon se usa con sustantivos masculinos y ma con femeninos.",
                [("ma mère", "mi madre"), ("mon frère", "mi hermano")],
            )
        ],
        "key_phrases": [
            _phrase(
                "Ma mère et mon frère habitent à Lille.", "Mi madre y mi hermano viven en Lille."
            )
        ],
        "common_mistakes": [_mistake("mon mère", "ma mère", "Mère es femenino, por eso va ma.")],
    },
    "pasado": {
        "summary_es": (
            "El pasado compuesto describe acciones terminadas. "
            "Se forma con el auxiliar y el participio pasado."
        ),
        "objectives_es": ["Formar el pasado compuesto con avoir"],
        "vocab_fronts": ["marché"],
        "grammar": [
            _grammar(
                "Pasado compuesto con avoir",
                "Se usa avoir en presente y se añade el participio pasado.",
                [("j\u2019ai mangé", "comí"), ("il a parlé", "habló")],
            )
        ],
        "key_phrases": [_phrase("Hier, j\u2019ai mangé une pomme.", "Ayer comí una manzana.")],
        "common_mistakes": [
            _mistake("j\u2019ai allé", "je suis allé", "Ir usa être como auxiliar.")
        ],
    },
}


def _with_summary(sheet: dict[str, Any], summary: str) -> dict[str, Any]:
    return {**sheet, "summary_es": summary}


def _sheet_bads(sheet: dict[str, Any]) -> list[dict[str, Any]]:
    seven = " ".join(f"Oración {n}." for n in range(1, 8))
    invented = [
        _phrase("Je suis très content.", "Estoy muy contento."),
        _phrase("Il pleut beaucoup.", "Llueve mucho."),
    ]
    twice = sheet["common_mistakes"][0]
    first_point = sheet["grammar"][0]
    return [
        _bad(_with_summary(sheet, seven), "summary_es tiene más de 6 oraciones"),
        _bad({**sheet, "objectives_es": []}, "entre 1 y 5 objetivos"),
        _bad({**sheet, "key_phrases": invented}, "más de la mitad de key_phrases"),
        _bad(
            {**sheet, "common_mistakes": [{**twice, "right_fr": twice["wrong_fr"]}]},
            "wrong_fr igual a right_fr",
        ),
        _bad(
            {**sheet, "grammar": [{**first_point, "examples": first_point["examples"][:1]}]},
            "no tiene exactamente 2 ejemplos",
        ),
    ]


def _cards_cases() -> list[Any]:
    cases = []
    for key, cards in CARD_SETS.items():
        sheet = SHEETS[key]
        draft = {k: sheet[k] for k in SHEET_DRAFT_KEYS}
        expected = {"cards": cards, "sheet": draft}
        invented = [*cards, _card("vocab", "pain au chocolat", "pan de chocolate")]
        empty_back = [{**cards[0], "back_es": ""}, *cards[1:]]
        spanish_phrase = [cards[0], _card("phrase", "¿Cómo estás hoy?", "¿Qué tal?"), cards[2]]
        bad = [
            _bad({"cards": invented, "sheet": draft}, "front_fr no aparece en el texto"),
            _bad({"cards": empty_back, "sheet": draft}, "back_es vacío"),
            _bad(
                {"cards": spanish_phrase, "sheet": draft},
                "front_fr de una frase no está en francés",
            ),
        ]
        cases.append(_case("cards", key, {"generation": _generation(key)}, expected, bad))
    return cases


def _sheet_cases() -> list[Any]:
    cases = []
    for key in SHEETS:
        fronts = [card["front_fr"] for card in CARD_SETS[key]]
        inp = {"generation": _generation(key), "card_fronts": fronts}
        sheet = SHEETS[key]
        cases.append(_case("sheet", key, inp, sheet, _sheet_bads(sheet)))
    return cases


# ---------------------------------------------------------------- topics


def _topic(
    key: str,
    existing: str | None,
    title: str,
    item_ids: list[str],
    cefr: str = "A1",
) -> dict[str, Any]:
    return {
        "key": key,
        "existing_topic_id": existing,
        "title": title,
        "description_es": "Tema de prueba con publicaciones sintéticas.",
        "cefr": cefr,
        "item_ids": item_ids,
    }


def _prompt_topic(topic_id: str, title: str, locked: bool) -> dict[str, Any]:
    return {
        "id": topic_id,
        "title": title,
        "description_es": "Tema existente de prueba.",
        "locked": locked,
    }


def _topics_cases() -> list[Any]:
    base_items = [_item(k) for k in ("saludos", "numeros", "familia", "rutina", "pasado")]
    plain = [
        _topic("saludos", None, "Saludos y presentaciones", ["syn-saludos"]),
        _topic("numeros-rutina", None, "Números y rutina diaria", ["syn-numeros", "syn-rutina"]),
        _topic("familia", None, "Vocabulario familiar", ["syn-familia"]),
        _topic("pasado", None, "El pasado compuesto", ["syn-pasado"], cefr="A2"),
    ]
    crowd = [*plain, *(_topic(f"extra-{n}", None, f"Tema extra {n}", []) for n in range(1, 28))]
    cases = [
        _case(
            "topics",
            "sin-bloqueos",
            {"topics": [], "items": base_items},
            {"topics": plain},
            [
                _bad(
                    {
                        "topics": [
                            _topic(
                                "saludos",
                                None,
                                "Saludos y presentaciones",
                                ["syn-saludos", "syn-inventado"],
                            ),
                            *plain[1:],
                        ]
                    },
                    "id de publicación inventado",
                ),
                _bad(
                    {
                        "topics": [
                            *plain[:2],
                            {**plain[2], "item_ids": ["syn-familia", "syn-saludos"]},
                            plain[3],
                        ]
                    },
                    "id de publicación repetido",
                ),
                _bad(
                    {"topics": [plain[0], {**plain[1], "item_ids": ["syn-numeros"]}, *plain[2:]]},
                    "publicación(es) sin tema",
                ),
                _bad({"topics": crowd}, "más de 30 temas"),
            ],
        )
    ]

    locked_items = [
        _item("familia", current="t-familia", locked=True),
        _item("saludos"),
        _item("numeros"),
        _item("rutina"),
        _item("pasado"),
    ]
    locked_expected = [
        _topic("familia", "t-familia", "Mi familia", ["syn-familia"]),
        _topic(
            "resto",
            None,
            "Saludos, números y rutina",
            ["syn-saludos", "syn-numeros", "syn-rutina", "syn-pasado"],
        ),
    ]
    cases.append(
        _case(
            "topics",
            "bloqueos",
            {"topics": [_prompt_topic("t-familia", "Mi familia", True)], "items": locked_items},
            {"topics": locked_expected},
            [
                _bad(
                    {
                        "topics": [
                            {**locked_expected[0], "item_ids": []},
                            {
                                **locked_expected[1],
                                "item_ids": [*locked_expected[1]["item_ids"], "syn-familia"],
                            },
                        ]
                    },
                    "publicación bloqueada fuera de su tema",
                ),
                _bad(
                    {"topics": [{**locked_expected[0], "title": "Familia"}, locked_expected[1]]},
                    "tema bloqueado con otro título",
                ),
            ],
        )
    )

    continuation = [
        _topic("pasado", "t-pasado", "El pasado compuesto", ["syn-pasado"], cefr="A2"),
        _topic("saludos", None, "Saludos y números", ["syn-saludos", "syn-numeros"]),
    ]
    cases.append(
        _case(
            "topics",
            "continuacion",
            {
                "topics": [_prompt_topic("t-pasado", "Pasado", False)],
                "items": [_item("pasado", current="t-pasado"), _item("saludos"), _item("numeros")],
            },
            {"topics": continuation},
            [
                _bad(
                    {
                        "topics": [
                            continuation[0],
                            {**continuation[1], "title": "El pasado compuesto"},
                        ]
                    },
                    "título repetido",
                ),
                _bad(
                    {"topics": [continuation[0], {**continuation[1], "key": "pasado"}]},
                    "key repetida",
                ),
                _bad(
                    {"topics": [{**continuation[0], "title": ""}, continuation[1]]}, "title vacío"
                ),
            ],
        )
    )

    single = [_topic("basico", None, "Primeros pasos", ["syn-saludos", "syn-numeros"])]
    cases.append(
        _case(
            "topics",
            "un-tema",
            {"topics": [], "items": [_item("saludos"), _item("numeros")]},
            {"topics": single},
            [
                _bad({"topics": [{**single[0], "title": ""}]}, "title vacío"),
                _bad(
                    {
                        "topics": [
                            {**single[0], "item_ids": ["syn-saludos", "syn-numeros", "syn-otro"]}
                        ]
                    },
                    "id de publicación inventado",
                ),
            ],
        )
    )
    return cases


# ---------------------------------------------------------------- quiz


def _q(
    kind: str,
    prompt_es: str,
    answers: list[str],
    source: int,
    prompt_fr: str | None = None,
    options: list[str] | None = None,
    explanation: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "prompt_es": prompt_es,
        "prompt_fr": prompt_fr,
        "options": options or [],
        "answers": answers,
        "explanation_es": explanation,
        "source_block": source,
    }


QUIZ: dict[str, dict[str, Any]] = {
    "saludos": {
        "title_es": "Saludos sin prisa",
        "questions": [
            _q(
                "mcq",
                "¿Cómo se dice 'buenos días' en francés?",
                ["Bonjour"],
                1,
                options=["Bonjour", "Au revoir", "Merci", "Pardon"],
                explanation="Bonjour sirve de mañana y de tarde.",
            ),
            _q(
                "cloze",
                "Completa el saludo.",
                ["Bonjour"],
                1,
                prompt_fr="___, comment ça va aujourd\u2019hui ?",
                explanation="Bonjour va al principio de la frase.",
            ),
            _q("translate", "Sí, bien, gracias.", ["Oui, ça va bien, merci."], 3),
            _q(
                "order",
                "Ordena las palabras de la pregunta: ¿cómo estás hoy?",
                ["Comment", "ça", "va", "aujourd\u2019hui", "?"],
                1,
            ),
        ],
        "summaries": ["Frases para saludar y responder a cómo estás."],
    },
    "numeros": {
        "title_es": "Contar hasta diez",
        "questions": [
            _q(
                "mcq",
                "¿Cómo se dice 'tres' en francés?",
                ["trois"],
                1,
                options=["deux", "trois", "cinq", "dix"],
            ),
            _q(
                "cloze",
                "Completa con el número de gatos.",
                ["trois"],
                3,
                prompt_fr="J\u2019ai ___ chats et deux poissons rouges.",
            ),
            _q("translate", "Tengo cinco libros.", ["J\u2019ai cinq livres."], 1),
            _q("order", "Ordena las palabras de los peces.", ["deux", "poissons", "rouges"], 3),
        ],
        "summaries": ["Los números del uno al diez para contar objetos."],
    },
    "familia": {
        "title_es": "Mi familia",
        "questions": [
            _q(
                "mcq",
                "¿Cómo se dice 'madre' en francés?",
                ["mère"],
                1,
                options=["mère", "frère", "oncle", "jardin"],
            ),
            _q(
                "cloze",
                "Completa con el posesivo de madre.",
                ["Ma"],
                1,
                prompt_fr="___ mère et mon frère habitent à Lille.",
            ),
            _q("translate", "Mi abuelo es muy amable.", ["Mon grand-père est très gentil."], 3),
            _q(
                "order",
                "Ordena: mi abuelo es muy amable.",
                ["Mon", "grand-père", "est", "très", "gentil."],
                3,
            ),
        ],
        "summaries": ["Vocabulario de la familia y posesivos básicos."],
    },
    "pasado": {
        "title_es": "El pasado compuesto",
        "questions": [
            _q(
                "mcq",
                "¿Qué auxiliar se usa en 'j'ai mangé'?",
                ["avoir"],
                2,
                options=["avoir", "être", "faire", "aller"],
            ),
            _q(
                "cloze",
                "Completa el pasado de 'comí'.",
                ["ai"],
                1,
                prompt_fr="Hier, j\u2019___ mangé une pomme.",
            ),
            _q("translate", "Ayer comí una manzana.", ["Hier, j\u2019ai mangé une pomme."], 1),
            _q(
                "order",
                "Ordena: fuimos al mercado.",
                ["Nous", "sommes", "allés", "au", "marché"],
                1,
            ),
        ],
        "summaries": ["Acciones terminadas con el pasado compuesto."],
    },
}


def _with_question(quiz: dict[str, Any], index: int, **changes: Any) -> dict[str, Any]:
    edited = [
        {**question, **changes} if position == index else question
        for position, question in enumerate(quiz["questions"])
    ]
    return {"title_es": quiz["title_es"], "questions": edited}


def _quiz_cases() -> list[Any]:
    cases = []
    for key, quiz in QUIZ.items():
        inp = {
            "title": quiz["title_es"],
            "summaries": quiz["summaries"],
            "cards": [
                {"kind": card["kind"], "front_fr": card["front_fr"], "back_es": card["back_es"]}
                for card in CARD_SETS[key]
            ],
            "fragments": _fragments(key),
        }
        questions = quiz["questions"]
        expected = {"title_es": quiz["title_es"], "questions": questions}
        bad = [
            _bad(
                _with_question(quiz, 0, answers=["respuesta ausente"]),
                "la respuesta no es una de las opciones",
            ),
            _bad(
                _with_question(quiz, 1, prompt_fr=f"{questions[1]['prompt_fr']} ___"),
                "cloze sin exactamente un ___",
            ),
            _bad(_with_question(quiz, 2, source_block=9), "source_block fuera de"),
        ]
        cases.append(_case("quiz", key, inp, expected, bad))
    return cases


# ---------------------------------------------------------------- plan_why


def _entry(position: int, kind: str, title: str, reason: str) -> dict[str, Any]:
    return {"position": position, "kind": kind, "title_es": title, "reason_es": reason}


PLAN_WHY: dict[str, list[dict[str, Any]]] = {
    "tres-tareas": [
        _entry(1, "review", "Repasar saludos", "Tienes tarjetas pendientes."),
        _entry(2, "quiz", "Quiz de números", "Ya leíste la lección de números."),
        _entry(3, "read", "Leer la lección de familia", "Es una lección nueva."),
    ],
    "dos-tareas": [
        _entry(1, "drill", "Práctica del pasado", "Practicar el participio evita errores."),
        _entry(2, "read", "Leer la rutina diaria", "Es corta y sirve de repaso."),
    ],
    "cuatro-tareas": [
        _entry(1, "review", "Repasar familia", "Hay tarjetas que vencen hoy."),
        _entry(2, "quiz", "Quiz de rutina", "El tema ya tiene lecciones leídas."),
        _entry(3, "read", "Leer el pasado compuesto", "Falta una lección del tema."),
        _entry(4, "drill", "Dictado de números", "Escuchar cifras mejora la comprensión."),
    ],
    "una-tarea": [_entry(1, "review", "Repasar saludos", "Hay tarjetas pendientes.")],
}

PLAN_WHY_TEXT: dict[str, list[str]] = {
    "tres-tareas": [
        "Repasa hoy las tarjetas de saludo para que no se acumulen.",
        "Haz el quiz de números mientras lo recuerdas.",
        "Leer la lección de familia te prepara para el siguiente quiz.",
    ],
    "dos-tareas": [
        "Practica el participio hoy para no olvidarlo mañana.",
        "La rutina es corta, así que léela con calma.",
    ],
    "cuatro-tareas": [
        "Repasa familia antes de que venzan las tarjetas.",
        "El quiz de rutina confirma lo que ya leíste.",
        "Lee el pasado compuesto para cerrar el tema.",
        "Un dictado de números afina tu oído.",
    ],
    "una-tarea": ["Repasa saludos hoy para no perder lo aprendido."],
}


def _plan_why_cases() -> list[Any]:
    cases = []
    for key, entries in PLAN_WHY.items():
        lines = [
            {"position": entry["position"], "why_es": text}
            for entry, text in zip(entries, PLAN_WHY_TEXT[key], strict=True)
        ]
        expected = {"lines": lines}
        long_line = {"position": 1, "why_es": " ".join(["hoy"] * 31) + "."}
        bad = [
            _bad({"lines": lines[:-1]}, "faltan posiciones del plan"),
            _bad(
                {"lines": [*lines, {"position": 99, "why_es": "Tarea ajena."}]},
                "posición ajena al plan",
            ),
            _bad({"lines": [long_line, *lines[1:]]}, "más de 30 palabras"),
        ]
        cases.append(_case("plan_why", key, {"entries": entries}, expected, bad))
    return cases


# ---------------------------------------------------------------- chat


def _chat(question: str, fragments: list[dict[str, Any]]) -> dict[str, Any]:
    return {"question": question, "fragments": fragments}


def _chat_cases() -> list[Any]:
    numbers = _fragments("numeros")[:1]
    past = [
        {"n": 1, "label": "El pasado compuesto, p. 2", "text": LESSONS["pasado"]["blocks"][1][1]},
        {"n": 2, "label": "El pasado compuesto, p. 1", "text": LESSONS["pasado"]["blocks"][0][1]},
    ]
    no_material_fragment = _fragments("saludos")[1:2]
    rutina = _fragments("rutina")[:1]
    specs: list[tuple[str, str, list[dict[str, Any]], str, list[dict[str, Any]]]] = [
        (
            "numeros-tres",
            "¿Cómo se dice tres en francés?",
            numbers,
            "Tres se dice trois [1].",
            [
                _bad({"text": "Tres se dice trois."}, "sin ninguna cita"),
                _bad({"text": "Tres se dice trois [4]."}, "fuera de rango"),
            ],
        ),
        (
            "pasado-compuesto",
            "¿Cómo se forma el pasado compuesto?",
            past,
            (
                "Se forma con avoir o être más el participio [1]. "
                "Por ejemplo: Hier, j\u2019ai mangé une pomme [2]."
            ),
            [
                _bad({"text": "Se forma con avoir o être más el participio."}, "sin ninguna cita"),
                _bad({"text": "Se forma con avoir [3]."}, "fuera de rango"),
            ],
        ),
        (
            "sin-material-capital",
            "¿Cuál es la capital de Francia?",
            no_material_fragment,
            NO_MATERIAL,
            [
                _bad({"text": "Es París."}, "sin ninguna cita"),
                _bad({"text": "Es París [0]."}, "fuera de rango"),
            ],
        ),
        (
            "sin-material-hora",
            "¿Qué hora es en Madrid ahora mismo?",
            rutina,
            NO_MATERIAL,
            [
                _bad({"text": "Son las ocho."}, "sin ninguna cita"),
                _bad({"text": "Son las ocho [0]."}, "fuera de rango"),
            ],
        ),
    ]
    cases = []
    for case_id, question, fragments, text, bad in specs:
        cases.append(_case("chat", case_id, _chat(question, fragments), {"text": text}, bad))
    return cases


# ---------------------------------------------------------------- entry point


def all_cases() -> list[Any]:
    return [
        *_cards_cases(),
        *_sheet_cases(),
        *_topics_cases(),
        *_quiz_cases(),
        *_plan_why_cases(),
        *_chat_cases(),
    ]


def build(out_dir: Path) -> list[Path]:
    """Escribe todos los casos bajo ``out_dir/<task>/<case_id>.json`` y devuelve las rutas."""
    written: list[Path] = []
    for case in all_cases():
        path = out_dir / case["task"] / f"{case['case_id']}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(case, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in build(CASES_DIR):
        print(path.relative_to(CASES_DIR.parent))
