"""POST /api/v1/ingest — recebe o payload do popup da extensão e normaliza."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.core import persistence
from app.core.dynamic_validator import build_item_model
from app.core.schema_registry import SchemaNotFoundError, get_schema, list_domains
from app.normalization import auctions as norm_auctions
from app.normalization import linkedin as norm_linkedin
from app.normalization import olx as norm_olx

router = APIRouter(tags=["ingest"])

NORMALIZERS = {
    "olx": norm_olx.normalize,
    "auctions": norm_auctions.normalize,
    "linkedin": norm_linkedin.normalize_list,
    "linkedin_detail": norm_linkedin.normalize_detail,
}


class IngestPayload(BaseModel):
    domain_id: str
    raw_data: dict[str, Any]


@router.get("/domains")
def domains() -> list[str]:
    return list_domains()


def process_items(domain_id: str, items_raw: Any) -> dict:
    """Validate → normalize → persist. Shared por /ingest e /scrape."""
    try:
        schema = get_schema(domain_id)
    except SchemaNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown domain: {domain_id}")

    if not isinstance(items_raw, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "items must be a list")

    Model = build_item_model(domain_id, schema)
    validated: list[dict] = []
    errors: list[dict] = []
    for idx, raw in enumerate(items_raw):
        try:
            validated.append(Model(**raw).model_dump())
        except ValidationError as e:
            errors.append({"index": idx, "errors": e.errors()})

    if errors and not validated:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    normalizer = NORMALIZERS.get(domain_id, lambda xs: xs)
    normalized = normalizer(validated)

    session_id, skipped_reason = persistence.persist(domain_id, normalized)

    return {
        "domain_id": domain_id,
        "received": len(items_raw),
        "validated": len(validated),
        "errors": errors,
        "persisted": session_id is not None,
        "session_id": session_id,
        "skipped_reason": skipped_reason,
        "normalized": normalized,
    }


@router.post("/ingest")
def ingest(payload: IngestPayload):
    return process_items(payload.domain_id, payload.raw_data.get("items", []))
