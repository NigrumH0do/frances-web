"""``GET /api/search``: búsqueda BM25 en los bloques de texto (AI-05)."""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from frances.api.deps import get_conn
from frances.api.security import require_user
from frances.models.study import SearchHit
from frances.study.search import MAX_SEARCH_RESULTS, search_blocks

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/search", response_model=list[SearchHit])
def search(
    conn: Annotated[sqlite3.Connection, Depends(get_conn)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=MAX_SEARCH_RESULTS)] = 20,
) -> list[SearchHit]:
    """Hits de FTS5 ordenados por BM25; ``q`` sin tokens útiles devuelve ``[]``."""
    return search_blocks(conn, q, limit=limit)
