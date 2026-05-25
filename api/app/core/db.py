"""Camada fina de dialeto: escolhe Postgres (psycopg3) ou SQLite (stdlib)
em runtime, a partir do scheme do `DATABASE_URL`.

Formas aceitas:
  postgresql://user:pass@host:port/db   → Postgres via psycopg3
  sqlite:///rel/path.db                 → SQLite, caminho relativo
  sqlite:////abs/path.db                → SQLite, caminho absoluto
  /abs/path.db                          → SQLite, caminho cru

A persistence.py é o único consumidor; escreve SQL com `?` e usa
`q()` para reescrever para `%s` quando o backend é Postgres.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from typing import Any, Iterator

DATABASE_URL = os.environ.get("DATABASE_URL")


def _detect_backend(url: str | None) -> str:
    if not url:
        return "postgres"
    if url.startswith(("postgres://", "postgresql://")):
        return "postgres"
    if url.startswith("sqlite:") or url.startswith(("/", "./")) or url.endswith(".db"):
        return "sqlite"
    return "postgres"


BACKEND = _detect_backend(DATABASE_URL)
IS_SQLITE = BACKEND == "sqlite"
IS_POSTGRES = BACKEND == "postgres"


if IS_POSTGRES:
    import psycopg
    from psycopg import rows as _pg_rows

    OperationalError: type = psycopg.OperationalError
    DBError: type = psycopg.Error
else:
    OperationalError = sqlite3.OperationalError
    DBError = sqlite3.Error


def _sqlite_path(url: str) -> str:
    """`sqlite:///rel.db` → `rel.db`; `sqlite:////abs.db` → `/abs.db`; caminho cru → ele mesmo."""
    if not url.startswith("sqlite:"):
        return url
    rest = url[len("sqlite://"):]
    return rest[1:] if rest.startswith("/") else rest


@contextmanager
def connect() -> Iterator[Any]:
    """Conexão pronta para uso. Commit no sucesso, rollback em exceção."""
    if IS_POSTGRES:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
            yield conn
        return
    path = _sqlite_path(DATABASE_URL or "")
    conn = sqlite3.connect(path, timeout=3, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def cursor(conn) -> Iterator[Any]:
    """Cursor padrão (tuplas). Garante close em ambos os drivers — sqlite3.Cursor não
    suporta `with` nativo."""
    cur = conn.cursor()
    try:
        yield cur
    finally:
        cur.close()


@contextmanager
def dict_cursor(conn) -> Iterator[Any]:
    """Cursor que retorna linhas conversíveis para dict via `dict(row)`."""
    if IS_POSTGRES:
        cur = conn.cursor(row_factory=_pg_rows.dict_row)
    else:
        cur = conn.cursor()  # conn.row_factory já é sqlite3.Row
    try:
        yield cur
    finally:
        cur.close()


def q(sql: str) -> str:
    """Reescreve `?` → `%s` quando Postgres. SQL deve usar `?` por padrão.
    Não usar `?` dentro de literais de string nas queries (não temos hoje)."""
    return sql.replace("?", "%s") if IS_POSTGRES else sql


def upsert_conflict_clause(col: str) -> str:
    """Cláusula de upsert compatível com índice único parcial em `col`.

    Tanto Postgres quanto SQLite exigem o `WHERE` no conflict target para
    casar com o predicado do índice único parcial — caso contrário o driver
    SQLite rejeita com `ON CONFLICT clause does not match any … UNIQUE
    constraint`. A forma é idêntica nos dois backends; mantemos o helper
    centralizado para evitar drift entre persistence e changelogs."""
    return f"ON CONFLICT ({col}) WHERE {col} IS NOT NULL DO UPDATE SET"


def insert_returning_id(cur, insert_sql_qmark: str, params: tuple) -> int:
    """Executa INSERT e retorna o id da linha. Em Postgres usa RETURNING id;
    em SQLite usa lastrowid."""
    if IS_POSTGRES:
        cur.execute(q(insert_sql_qmark + " RETURNING id"), params)
        return cur.fetchone()[0]
    cur.execute(insert_sql_qmark, params)
    return cur.lastrowid


def is_missing_table(exc: BaseException) -> bool:
    """Erro de tabela inexistente — varia entre drivers."""
    if IS_POSTGRES:
        return isinstance(exc, psycopg.errors.UndefinedTable)
    return isinstance(exc, sqlite3.OperationalError) and "no such table" in str(exc).lower()


def iso(value: Any) -> Any:
    """Normaliza datetimes para ISO-8601. Postgres devolve datetime; SQLite devolve str."""
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row_as_dict(row) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_as_dicts(rows) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]
