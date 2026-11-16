from frances.extract.lang import detect_lang, split_blocks


def test_french_and_spanish_sentences():
    assert detect_lang("Je voudrais un café, s'il vous plaît.") == "fr"
    assert detect_lang("Quisiera un café, por favor, gracias.") == "es"


def test_mixed_paragraph():
    txt = "Le chat dort sur le canapé tout l'après-midi. El perro juega en el jardín con los niños."
    assert detect_lang(txt) == "mixed"


def test_short_text_is_unknown():
    assert detect_lang("Bonjour") == "unknown"


def test_split_blocks_by_blank_line():
    blocks = split_blocks(
        "Je suis étudiant à l'université.\n\n   \n\nSoy estudiante de la universidad.",
        "at_0123456789abcdef",
        page=2,
    )
    assert [(b.lang, b.source, b.page) for b in blocks] == [
        ("fr", "at_0123456789abcdef", 2),
        ("es", "at_0123456789abcdef", 2),
    ]
    assert blocks[0].text == "Je suis étudiant à l'université."


def test_merge_short_paragraphs_joins_small_pieces_until_min() -> None:
    from frances.extract.lang import merge_short_paragraphs

    text = "Les métiers\n\nLe médecin\n\nLa boulangère\n\n" + "x" * 300 + "\n\nFin"
    out = merge_short_paragraphs(text, min_chars=30, max_chars=400).split("\n\n")
    assert out[0] == "Les métiers\nLe médecin\nLa boulangère"
    assert out[1].startswith("xxx") and out[1].endswith("\nFin")


def test_merge_short_paragraphs_respects_max() -> None:
    from frances.extract.lang import merge_short_paragraphs

    text = "\n\n".join(["a" * 20] * 10)
    parts = merge_short_paragraphs(text, min_chars=500, max_chars=70).split("\n\n")
    assert all(len(p) <= 70 for p in parts) and len(parts) > 1
