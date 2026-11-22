"""Volcado (`dump_sql`) y restauración (`restore_sql`) deterministas."""

import os
import re
import sqlite3
from pathlib import Path
from typing import Any

from frances.db.store import Store

_HEADER = "-- frances state dump v1"


def _literal(value: Any) -> str:
    """Literal SQL determinista para los tipos que guarda el Store."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"tipo no soportado en dump: {type(value).__name__}")


def _order_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    """Columnas para ordenar las filas: PK en orden, `runs` por rowid."""
    if table == "runs":
        return ["rowid"]
    info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    pk_cols = [row[1] for row in sorted(info, key=lambda row: row[5]) if row[5] > 0]
    if pk_cols:
        return [str(name) for name in pk_cols]
    return [str(row[1]) for row in info]  # sin PK: todas las columnas


#: Sufijos de las tablas sombra que SQLite crea para una tabla FTS5.
_SHADOW_SUFFIXES = ("_data", "_idx", "_content", "_docsize", "_config")


def _is_virtual(ddl: object) -> bool:
    return str(ddl).lstrip().upper().startswith("CREATE VIRTUAL TABLE")


def _schema(conn: sqlite3.Connection) -> tuple[list[tuple[str, str]], list[str]]:
    """`(ddl, data)` del esquema de usuario, ambos ordenados por nombre.

    `ddl` son `(name, sql)` de todas las tablas, virtuales incluidas, sin las internas
    `sqlite_%` ni las tablas sombra de FTS5. `data` son los nombres de las tablas que
    tienen filas por volcar: las virtuales se excluyen, su índice se reconstruye al restaurar.
    """
    entries = conn.execute(
        "SELECT name, sql FROM sqlite_master"
        " WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    virtual = [str(name) for name, ddl in entries if _is_virtual(ddl)]
    shadows = {f"{v}{suffix}" for v in virtual for suffix in _SHADOW_SUFFIXES}
    ddl_entries = [(str(name), str(ddl)) for name, ddl in entries if str(name) not in shadows]
    data = [name for name, ddl in ddl_entries if not _is_virtual(ddl)]
    return ddl_entries, data


def _extras(conn: sqlite3.Connection, kind: str) -> list[str]:
    """SQL de los triggers o índices explícitos (`sql` no nulo), por nombre."""
    rows = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL ORDER BY name",
        (kind,),
    ).fetchall()
    return [str(sql) for (sql,) in rows]


def _fts5_tables(conn: sqlite3.Connection) -> list[str]:
    """Nombres de las tablas virtuales FTS5, por nombre."""
    rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [
        str(name)
        for name, ddl in rows
        if re.match(r"\s*CREATE\s+VIRTUAL\s+TABLE\b.*\bUSING\s+fts5\b", str(ddl), re.I | re.S)
    ]


def _statement(sql: str) -> str:
    text = sql.strip()
    return text if text.endswith(";") else text + ";"


def dump_sql(store: Store) -> str:
    """Vuelca el esquema y las filas de forma determinista.

    Orden: cabecera, DDL de las tablas (virtuales incluidas, sin sombras), filas de
    cada tabla no virtual (PK en orden, `runs` por `rowid`; un `INSERT` por línea),
    triggers y luego índices por nombre. Los triggers van después de las filas para
    que el volcado no dispare efectos. Termina en `\\n`.
    """
    conn = store.conn
    ddl_entries, data_tables = _schema(conn)
    lines = [_HEADER]
    lines.extend(_statement(ddl) for _name, ddl in ddl_entries)
    for table in data_tables:
        order = ", ".join(f'"{col}"' for col in _order_columns(conn, table))
        rows = conn.execute(f'SELECT * FROM "{table}" ORDER BY {order}').fetchall()
        for row in rows:
            lines.append(f"INSERT INTO {table} VALUES ({', '.join(_literal(v) for v in row)});")
    lines.extend(_statement(sql) for sql in _extras(conn, "trigger"))
    lines.extend(_statement(sql) for sql in _extras(conn, "index"))
    return "\n".join(lines) + "\n"


def restore_sql(sql_text: str, db_path: Path) -> Store:
    """Restaura `sql_text` en `db_path` de forma atómica y devuelve el Store.

    El trabajo va a un `.tmp` hermano que solo reemplaza `db_path` si todo sale
    bien. Antes de empezar se borra cualquier `.tmp` de un intento anterior y, si
    `executescript`, `PRAGMA foreign_key_check` o el rebuild de FTS5 fallan, se
    cierra la conexión temporal y se borra el `.tmp` antes de relanzar: un
    restore fallido no deja restos ni una base a medias.
    """
    tmp_path = db_path.with_suffix(".tmp")
    tmp_path.unlink(missing_ok=True)
    try:
        conn = sqlite3.connect(str(tmp_path), isolation_level=None)
        try:
            conn.executescript(sql_text)
            violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise ValueError(f"dump con FK rotas: {violations!r}")
            for fts in _fts5_tables(conn):
                conn.execute(f'INSERT INTO "{fts}"("{fts}") VALUES (\'rebuild\')')
        finally:
            conn.close()
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
    # restore_sql borra -wal y -shm porque reemplaza el archivo: un WAL viejo no debe aplicarse
    # sobre la base nueva. El llamador no debe tener conexiones abiertas a esa base.
    for suffix in ("-wal", "-shm"):  # un WAL viejo no debe aplicarse sobre la base nueva
        Path(str(db_path) + suffix).unlink(missing_ok=True)
    os.replace(tmp_path, db_path)
    return Store.open(db_path)
