"""GET /api/v1/sessions — leitura rápida das sessões gravadas, sem psql."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from app.core import persistence

router = APIRouter(tags=["sessions"])


@router.get("/sessions")
def recent_sessions(limit: int = Query(20, ge=1, le=200)):
    return persistence.fetch_recent_sessions(limit=limit)


@router.get("/sessions/{session_id}")
def session_detail(session_id: int):
    data = persistence.fetch_session_items(session_id)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"session {session_id} not found")
    return data
