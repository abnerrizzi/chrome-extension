"""Carrega e cacheia JSON Schemas por domain_id a partir do diretório app/schemas/."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas"


class SchemaNotFoundError(KeyError):
    """Domínio sem JSON Schema registrado."""


@lru_cache(maxsize=128)
def get_schema(domain_id: str) -> dict:
    """Retorna o JSON Schema do domínio. Cacheado em memória."""
    path = SCHEMAS_DIR / f"{domain_id}.json"
    if not path.exists():
        raise SchemaNotFoundError(domain_id)
    return json.loads(path.read_text(encoding="utf-8"))


def list_domains() -> list[str]:
    return sorted(p.stem for p in SCHEMAS_DIR.glob("*.json"))
