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
    query = fts_query(q)
    if query is None:
        return []
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
