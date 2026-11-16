"""Store SQLite: apertura con migraciones, transacciones, WAL y FK activadas."""

import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from importlib import resources
from pathlib import Path

from frances.errors import ConfigError

_MIGRATION_RE = re.compile(r"(\d{4})_.*\.sql")
#: Comentarios SQL (`-- …` y `/* … */`) y espacios: lo que no cuenta como sentencia.
_COMMENT_OR_SPACE_RE = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)

#: PRAGMAs de cada conexión (`Store.open` y `Store.connect`).
_PRAGMAS = (
    "PRAGMA foreign_keys=ON",
    "PRAGMA journal_mode=WAL",
    "PRAGMA busy_timeout=5000",
    "PRAGMA synchronous=NORMAL",
)


def _split_statements(sql: str) -> list[str]:
    """Parte un archivo de migración en sentencias completas, sin el `;` final.

    Acumula fragmentos hasta que `sqlite3.complete_statement` da `True`, así un
    `;` dentro de un literal o del cuerpo `BEGIN … END;` de un trigger no corta.
    """
    statements: list[str] = []
    buffer = ""
    for piece in sql.split(";"):
        buffer += piece + ";"
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()[:-1].strip()
            if statement:
                statements.append(statement)
            buffer = ""
    rest = buffer[:-1].strip()  # el último fragmento no tenía `;` propio
    if _COMMENT_OR_SPACE_RE.sub("", rest).strip():
        if not sqlite3.complete_statement(rest + ";"):
            raise ValueError(f"sentencia SQL incompleta al final del archivo: {rest[:80]!r}")
        statements.append(rest)
    return statements


def _apply_migration(conn: sqlite3.Connection, sql: str) -> None:
    """Aplica una migración dentro de `BEGIN IMMEDIATE`/`COMMIT`."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        for statement in _split_statements(sql):
            conn.execute(statement)
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _pending_migrations(version: int) -> list[tuple[int, str]]:
    """Migraciones `NNNN_*.sql` con `NNNN > version`, en orden numérico."""
    base = resources.files("frances.db.migrations")
    names = sorted(
        entry.name
        for entry in base.iterdir()
        if entry.is_file() and _MIGRATION_RE.fullmatch(entry.name)
    )
    pending: list[tuple[int, str]] = []
    for name in names:
        match = _MIGRATION_RE.fullmatch(name)
        assert match is not None  # filtrado arriba
        number = int(match.group(1))
        if number > version:
            sql = (base / name).read_text(encoding="utf-8")
            pending.append((number, sql))
    pending.sort(key=lambda item: item[0])
    return pending


#: Número de la última migración empaquetada.
LATEST_SCHEMA: int = max((number for number, _ in _pending_migrations(0)), default=0)


def _configured_connection(db_path: Path) -> sqlite3.Connection:
    """Conexión en autocommit con las `_PRAGMAS` aplicadas."""
    # check_same_thread=False: el middleware HTTP cierra la conexión en otro hilo
    # del que la abrió. Cada petición tiene la suya y no se comparte.
    conn = sqlite3.connect(str(db_path), isolation_level=None, check_same_thread=False)
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    return conn


def _schema_version(conn: sqlite3.Connection) -> int:
    """`MAX(version)` de `schema_version`; 0 si la tabla falta o está vacía."""
    try:
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    except sqlite3.OperationalError:
        return 0  # la tabla schema_version aún no existe
    return int(row[0]) if row is not None and row[0] is not None else 0


class Store:
    """Conexión SQLite con `foreign_keys=ON`, WAL, `busy_timeout=5000` y `synchronous=NORMAL`."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    @classmethod
    def open(cls, db_path: Path) -> "Store":
        """Crea el archivo si falta y aplica las migraciones pendientes."""
        conn = _configured_connection(db_path)
        for _, sql in _pending_migrations(_schema_version(conn)):
            _apply_migration(conn, sql)
        return cls(conn)

    @classmethod
    def connect(cls, db_path: Path) -> "Store":
        """Abre una base ya migrada (mismas PRAGMAs, sin migrar).

        `ConfigError` si el archivo falta o si `schema_version < LATEST_SCHEMA`.
        """
        if not db_path.is_file():
            raise ConfigError(f"schema desactualizado: corre frances migrate ({db_path} no existe)")
        conn = _configured_connection(db_path)
        version = _schema_version(conn)
        if version < LATEST_SCHEMA:
            conn.close()
            raise ConfigError(
                f"schema desactualizado: corre frances migrate (v{version} < v{LATEST_SCHEMA})"
            )
        return cls(conn)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Transacción `BEGIN IMMEDIATE`; `COMMIT` o `ROLLBACK` al salir."""
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield self._conn
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        else:
            self._conn.execute("COMMIT")

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    def close(self) -> None:
        self._conn.close()
