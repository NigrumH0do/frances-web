"""Búsqueda BM25 sobre los bloques de texto indexados en FTS5 (AI-05).

La consulta del usuario nunca llega a la sintaxis de FTS5: se normaliza, se parte
en tokens ``\\w+`` y cada token se entrecomilla. Los operadores de FTS5 (``NEAR``,
``*``, paréntesis, ``AND``…) quedan como palabras entrecomilladas o desaparecen.
"""

import re
import sqlite3
import unicodedata
from collections.abc import Collection

from frances.models.study import SearchHit
from frances.textnorm import norm_key

#: Tokens útiles como máximo en una consulta: acota el coste de `MATCH`.
MAX_QUERY_TOKENS = 12
#: Longitud mínima de un token sin dígitos («a», «de», «y» no discriminan).
MIN_TOKEN_LENGTH = 3
#: Tope defensivo de resultados de `search_blocks` (la ruta valida 1…50).
MAX_SEARCH_RESULTS = 50

_TOKEN_RE = re.compile(r"\w+")


def _strip_accents(text: str) -> str:
    """NFKD y fuera las marcas combinantes: ``école`` y ``ecole`` son la misma clave."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


#: Palabras vacías de francés y español, ya normalizadas (``norm_key`` y sin tildes).
_STOPWORD_WORDS: tuple[str, ...] = (
    # Francés: artículos, determinantes y posesivos.
    "le",
    "la",
    "les",
    "un",
    "une",
    "des",
    "du",
    "de",
    "au",
    "aux",
    "ce",
    "cet",
    "cette",
    "ces",
    "mon",
    "ma",
    "mes",
    "ton",
    "ta",
    "tes",
    "son",
    "sa",
    "ses",
    "notre",
    "nos",
    "votre",
    "vos",
    "leur",
    "leurs",
    "quel",
    "quelle",
    "chaque",
    # Francés: pronombres y adverbios.
    "je",
    "tu",
    "il",
    "elle",
    "on",
    "nous",
    "vous",
    "ils",
    "elles",
    "qui",
    "que",
    "quoi",
    "dont",
    "ou",
    "tout",
    # Francés: preposiciones y conjunciones.
    "dans",
    "par",
    "pour",
    "sans",
    "sous",
    "sur",
    "vers",
    "avec",
    "chez",
    "entre",
    "depuis",
    "apres",
    "contre",
    "et",
    "mais",
    "donc",
    "or",
    "ni",
    "car",
    "comme",
    "quand",
    "si",
    # Francés: auxiliares.
    "etre",
    "avoir",
    "suis",
    "es",
    "est",
    "sommes",
    "etes",
    "sont",
    "ai",
    "as",
    "avons",
    "avez",
    "ont",
    # Interrogativos.
    "comment",
    "pourquoi",
    "combien",
    "lequel",
    "laquelle",
    # Español: artículos y preposiciones.
    "el",
    "los",
    "las",
    "una",
    "unos",
    "unas",
    "lo",
    "del",
    "al",
    "por",
    "para",
    "con",
    "sin",
    "sobre",
    "bajo",
    "desde",
    "hasta",
    "hacia",
    "contra",
    "segun",
    "durante",
    # Español: pronombres.
    "yo",
    "ella",
    "nosotros",
    "vosotros",
    "ellos",
    "nos",
    "os",
    "les",
    "mi",
    "su",
    "nuestro",
    "nuestra",
    "esto",
    "eso",
    "esta",
    "este",
    "estos",
    "estas",
    "ese",
    "esa",
    "esos",
    "esas",
    "quien",
    "quienes",
    "cual",
    "cuales",
    # Español: conjunciones y adverbios.
    "y",
    "o",
    "u",
    "pero",
    "sino",
    "porque",
    "pues",
    "aunque",
    "mientras",
    "cuando",
    "entonces",
    "tambien",
    "tampoco",
    "ademas",
    "asi",
    "ya",
    "muy",
    "mas",
    # Español: auxiliares.
    "ser",
    "estar",
    "soy",
    "eres",
    "somos",
    "sois",
    "estan",
    "estoy",
    "haber",
    "he",
    "ha",
    "hay",
    "hace",
    "hacer",
    "tener",
    "tiene",
    "tienen",
    "ir",
    # Interrogativos.
    "como",
    "donde",
    "cuanto",
)

STOPWORDS: frozenset[str] = frozenset(_strip_accents(norm_key(word)) for word in _STOPWORD_WORDS)

#: Equivalencias pedagógicas ES->FR (sin tildes) para recuperar bloques en francés.
_ES_FR_GLOSSARY: dict[str, tuple[str, ...]] = {
    "agua": ("eau",),
    "alimento": ("aliment", "nourriture"),
    "alimentos": ("aliments", "nourriture"),
    "amigo": ("ami",),
    "amigos": ("amis",),
    "ano": ("an", "annee"),
    "anos": ("ans", "annees"),
    "articulo": ("article",),
    "articulos": ("articles",),
    "ayer": ("hier",),
    "beber": ("boire",),
    "blanco": ("blanc", "blanche"),
    "buenas": ("bonjour", "bonsoir"),
    "bueno": ("bon",),
    "buenos": ("bonjour", "bons"),
    "cafe": ("cafe",),
    "calle": ("rue",),
    "camisa": ("chemise",),
    "casa": ("maison",),
    "ciudad": ("ville",),
    "clase": ("classe", "cours"),
    "color": ("couleur",),
    "colores": ("couleurs",),
    "comer": ("manger",),
    "comida": ("nourriture", "repas", "cuisine"),
    "compras": ("achats", "courses"),
    "conjugacion": ("conjugaison",),
    "cuerpo": ("corps",),
    "desayuno": ("petit", "dejeuner"),
    "dia": ("jour", "journee"),
    "dias": ("jours",),
    "dinero": ("argent",),
    "dormir": ("dormir",),
    "escuela": ("ecole",),
    "escribir": ("ecrire",),
    "espanol": ("espagnol",),
    "estar": ("etre",),
    "estudiar": ("etudier",),
    "examen": ("examen",),
    "familia": ("famille",),
    "fecha": ("date",),
    "feliz": ("heureux", "heureuse"),
    "flor": ("fleur",),
    "fruta": ("fruit",),
    "futuro": ("futur",),
    "gato": ("chat",),
    "gatos": ("chats", "chat"),
    "gracias": ("merci",),
    "grande": ("grand", "grande"),
    "hablar": ("parler",),
    "hacer": ("faire",),
    "hermana": ("soeur",),
    "hermano": ("frere",),
    "hola": ("bonjour", "salut"),
    "hora": ("heure",),
    "horas": ("heures",),
    "hoy": ("aujourd", "hui"),
    "invierno": ("hiver",),
    "ir": ("aller",),
    "jardin": ("jardin",),
    "leccion": ("lecon",),
    "leer": ("lire",),
    "libro": ("livre",),
    "lluvia": ("pluie",),
    "madre": ("mere",),
    "manana": ("demain", "matin"),
    "manzana": ("pomme",),
    "manzanas": ("pommes",),
    "mes": ("mois",),
    "mesa": ("table",),
    "meses": ("mois",),
    "negacion": ("negation",),
    "nino": ("enfant", "garcon"),
    "noche": ("nuit", "soir"),
    "nombre": ("nom", "prenom"),
    "numero": ("nombre", "numero", "chiffre"),
    "numeros": ("nombres", "numeros", "chiffres"),
    "padre": ("pere",),
    "pan": ("pain",),
    "pasado": ("passe", "compose", "imparfait"),
    "perro": ("chien",),
    "pequeno": ("petit", "petite"),
    "pregunta": ("question",),
    "preguntas": ("questions",),
    "presente": ("present",),
    "primavera": ("printemps",),
    "pronombre": ("pronom",),
    "pronombres": ("pronoms",),
    "queso": ("fromage",),
    "rojo": ("rouge",),
    "ropa": ("vetements",),
    "saludo": ("salut", "bonjour"),
    "saludos": ("salutations", "bonjour", "salut"),
    "semana": ("semaine",),
    "ser": ("etre",),
    "sol": ("soleil",),
    "tarde": ("apres", "midi", "soir"),
    "tener": ("avoir",),
    "tiempo": ("temps",),
    "trabajo": ("travail",),
    "universidad": ("universite",),
    "verano": ("ete",),
    "verbo": ("verbe",),
    "verbos": ("verbes",),
    "viajar": ("voyager",),
    "viaje": ("voyage",),
    "vivir": ("habiter", "vivre"),
}


def query_tokens(q: str) -> list[str]:
    """Tokens ``\\w+`` útiles de ``q``: sin tildes, sin palabras vacías y sin repetir."""
    tokens: list[str] = []
    seen: set[str] = set()
    for token in _TOKEN_RE.findall(_strip_accents(norm_key(q))):
        if token in seen or token in STOPWORDS:
            continue
        if len(token) < MIN_TOKEN_LENGTH and not any(ch.isdigit() for ch in token):
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= MAX_QUERY_TOKENS:
            break
    return tokens


def _quote_token(token: str) -> str:
    """Entrecomilla un token; las comillas internas se duplican (sintaxis FTS5)."""
    return '"' + token.replace('"', '""') + '"'


def fts_query(q: str) -> str | None:
    """Consulta ``MATCH`` segura, o ``None`` si ``q`` no deja tokens útiles."""
    tokens = query_tokens(q)
    if not tokens:
        return None
    return " OR ".join(_quote_token(token) for token in tokens)


def _expanded_tokens(conn: sqlite3.Connection, base_tokens: list[str]) -> list[str]:
    """Amplía consultas en español con el glosario A1-A2 y las tarjetas ya enseñadas."""
    max_expanded = MAX_QUERY_TOKENS * 2
    expanded: list[str] = list(base_tokens)
    seen = set(base_tokens)

    def add_token(candidate: str) -> None:
        if len(expanded) >= max_expanded or candidate in seen or candidate in STOPWORDS:
            return
        if len(candidate) < MIN_TOKEN_LENGTH and not any(ch.isdigit() for ch in candidate):
            return
        seen.add(candidate)
        expanded.append(candidate)

    for token in base_tokens:
        for fr in _ES_FR_GLOSSARY.get(token, ()):
            add_token(fr)

    if len(expanded) < max_expanded and base_tokens:
        try:
            card_rows = conn.execute(
                "SELECT front_fr, back_es FROM cards WHERE removed_at IS NULL"
            ).fetchall()
        except sqlite3.OperationalError:
            card_rows = []
        base_set = set(base_tokens)
        for front_fr, back_es in card_rows:
            back_tokens = _TOKEN_RE.findall(_strip_accents(norm_key(str(back_es))))
            if not any(tok in base_set for tok in back_tokens):
                continue
            for fr_tok in _TOKEN_RE.findall(_strip_accents(norm_key(str(front_fr)))):
                add_token(fr_tok)
            if len(expanded) >= max_expanded:
                break
    return expanded


def search_blocks(
    conn: sqlite3.Connection,
    q: str,
    *,
    limit: int = 20,
    item_ids: Collection[str] | None = None,
) -> list[SearchHit]:
    """Bloques que hacen ``MATCH`` con ``q``, mejor BM25 primero.

    Solo cuenta publicaciones vivas (``items.deleted_at IS NULL``) y, si se da
    ``item_ids``, las de esa colección. El texto del usuario nunca se interpola:
    los tokens van entre comillas y los ids como parámetros ``?``.
    """
    tokens = query_tokens(q)
    if not tokens:
        return []
    query = " OR ".join(_quote_token(token) for token in _expanded_tokens(conn, tokens))
    bounded = max(0, min(int(limit), MAX_SEARCH_RESULTS))
    if bounded == 0:
        return []

    item_filter = ""
    params: list[object] = [query]
    if item_ids is not None:
        ids = list(dict.fromkeys(item_ids))
        if not ids:
            return []
        placeholders = ", ".join("?" for _ in ids)
        item_filter = f" AND b.item_id IN ({placeholders})"
        params.extend(ids)
    params.append(bounded)

    rows = conn.execute(
        "SELECT b.id, b.item_id, b.source, b.page,"
        " snippet(text_blocks_fts, 0, '', '', '…', 24) AS snip,"
        " bm25(text_blocks_fts) AS rank"
        " FROM text_blocks_fts"
        " JOIN text_blocks b ON b.id = text_blocks_fts.rowid"
        " JOIN items i ON i.id = b.item_id"
        " WHERE text_blocks_fts MATCH ? AND i.deleted_at IS NULL"
        + item_filter
        + " ORDER BY rank, b.id LIMIT ?",
        params,
    ).fetchall()
    return [
        SearchHit(
            block_id=int(row[0]),
            item_id=str(row[1]),
            source=str(row[2]),
            page=None if row[3] is None else int(row[3]),
            snippet=str(row[4]),
            score=round(-float(row[5]), 4),
        )
        for row in rows
    ]
