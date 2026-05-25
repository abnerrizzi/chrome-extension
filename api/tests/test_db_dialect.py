"""Testes unitários do shim de dialeto. Não tocam em nenhum banco — exercitam
apenas as funções puras `_detect_backend`, `_sqlite_path`, `q` e
`upsert_conflict_clause` chamando os helpers diretamente."""
from __future__ import annotations

from app.core import db


def test_detect_backend_postgres_schemes():
    assert db._detect_backend("postgresql://app:app@host:5432/x") == "postgres"
    assert db._detect_backend("postgres://app:app@host:5432/x") == "postgres"


def test_detect_backend_sqlite_schemes():
    assert db._detect_backend("sqlite:///rel.db") == "sqlite"
    assert db._detect_backend("sqlite:////abs/path.db") == "sqlite"
    assert db._detect_backend("/data/scraper.db") == "sqlite"
    assert db._detect_backend("./data/x.db") == "sqlite"


def test_detect_backend_default_postgres_when_empty():
    assert db._detect_backend(None) == "postgres"
    assert db._detect_backend("") == "postgres"


def test_sqlite_path_strips_scheme():
    assert db._sqlite_path("sqlite:///rel.db") == "rel.db"
    assert db._sqlite_path("sqlite:////abs/x.db") == "/abs/x.db"
    assert db._sqlite_path("/already/raw.db") == "/already/raw.db"


def test_q_passes_through_or_rewrites():
    # Resolve em runtime conforme o backend ativo do processo de teste.
    sql = "SELECT * FROM t WHERE id=? AND name=?"
    rewritten = db.q(sql)
    if db.IS_POSTGRES:
        assert rewritten == "SELECT * FROM t WHERE id=%s AND name=%s"
    else:
        assert rewritten == sql


def test_upsert_conflict_clause_includes_partial_predicate_only_on_postgres():
    clause = db.upsert_conflict_clause("external_id")
    if db.IS_POSTGRES:
        assert "WHERE external_id IS NOT NULL" in clause
    else:
        assert "WHERE" not in clause
    assert "external_id" in clause
    assert clause.endswith("DO UPDATE SET")


def test_iso_normalizes_datetime_and_passes_strings():
    from datetime import datetime
    assert db.iso(None) is None
    assert db.iso("2026-05-25T10:00:00") == "2026-05-25T10:00:00"
    assert db.iso(datetime(2026, 5, 25, 10, 0, 0)) == "2026-05-25T10:00:00"
