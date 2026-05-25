"""Geração de modelos Pydantic em runtime a partir de JSON Schemas por domínio.

Usa `pydantic.create_model` puro — sem dependências externas adicionais.
Suporta primitivos básicos, arrays e objetos aninhados rasos. Suficiente para o
escopo do scaffold; substituir por `dyntamic` ou geração em build-time se a
matriz de domínios crescer significativamente.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, List, Optional, Type

from pydantic import BaseModel, Field, create_model

_JSON_TYPE_MAP: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "object": dict,
}


def _resolve_type(prop: dict) -> Any:
    """Converte um nó de propriedade JSON Schema em tipo Python."""
    t = prop.get("type", "string")
    if t == "array":
        item_t = _resolve_type(prop.get("items", {"type": "string"}))
        return List[item_t]
    return _JSON_TYPE_MAP.get(t, str)


def _build_fields(schema: dict) -> dict[str, tuple]:
    required = set(schema.get("required", []))
    fields: dict[str, tuple] = {}
    for name, prop in schema.get("properties", {}).items():
        py_t = _resolve_type(prop)
        if name in required:
            fields[name] = (py_t, Field(..., description=prop.get("description")))
        else:
            fields[name] = (Optional[py_t], Field(default=None, description=prop.get("description")))
    return fields


@lru_cache(maxsize=128)
def build_model(domain_id: str, schema_hash: str, schema_repr: str) -> Type[BaseModel]:
    """Constrói um modelo Pydantic dinâmico.

    `schema_hash` + `schema_repr` existem apenas para tornar o cache estável
    sem precisar tornar o dict hashable. Use `build_item_model` como entrada.
    """
    import json as _json
    schema = _json.loads(schema_repr)
    fields = _build_fields(schema)
    name = f"{domain_id.title().replace('_', '')}Item"
    return create_model(name, **fields)


def build_item_model(domain_id: str, schema: dict) -> Type[BaseModel]:
    """Front-end estável: aceita o dict diretamente e delega ao builder cacheado."""
    import hashlib, json as _json
    repr_ = _json.dumps(schema, sort_keys=True)
    h = hashlib.sha1(repr_.encode("utf-8")).hexdigest()
    return build_model(domain_id, h, repr_)
