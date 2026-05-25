"""POST /api/v1/ingest — recebe o payload do popup da extensão e normaliza."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.core.dynamic_validator import build_item_model
from app.core.schema_registry import SchemaNotFoundError, get_schema, list_domains
from app.normalization import auctions as norm_auctions
from app.normalization import linkedin as norm_linkedin
from app.normalization import olx as norm_olx

router = APIRouter(tags=["ingest"])

NORMALIZERS = {
    "linkedin": norm_linkedin.normalize,
    "olx": norm_olx.normalize,
    "auctions": norm_auctions.normalize,
}


class IngestPayload(BaseModel):
    domain_id: str
    raw_data: dict[str, Any]


@router.get("/domains")
def domains() -> list[str]:
    return list_domains()


@router.post("/ingest")
def ingest(payload: IngestPayload):
    # 1. Resolve schema do domínio.
    try:
        schema = get_schema(payload.domain_id)
    except SchemaNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown domain: {payload.domain_id}")

    # 2. Constrói modelo Pydantic em runtime e valida cada item.
    Model = build_item_model(payload.domain_id, schema)
    items_raw = payload.raw_data.get("items", [])
    if not isinstance(items_raw, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "raw_data.items must be a list")

    validated: list[dict] = []
    errors: list[dict] = []
    for idx, raw in enumerate(items_raw):
        try:
            validated.append(Model(**raw).model_dump())
        except ValidationError as e:
            errors.append({"index": idx, "errors": e.errors()})

    if errors and not validated:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    # 3. Normalização pura (preço → cents, datas → ISO-8601, etc.).
    normalizer = NORMALIZERS.get(payload.domain_id, lambda xs: xs)
    normalized = normalizer(validated)

    # 4. (TODO) Persistir em Postgres — fora do escopo deste scaffold.
    return {
        "domain_id": payload.domain_id,
        "received": len(items_raw),
        "validated": len(validated),
        "errors": errors,
        "normalized": normalized,
    }
