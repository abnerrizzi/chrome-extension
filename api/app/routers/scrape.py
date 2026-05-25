"""POST /api/v1/scrape — fetch remoto + parser + pipeline de ingest em uma única chamada."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.routers.ingest import process_items
from app.scrape import olx_fetcher, olx_parser

router = APIRouter(tags=["scrape"])

# domain_id -> (fetch_fn(url, cookies) -> Response, parse_fn(html) -> list[dict])
FETCHERS: dict[str, tuple[Callable, Callable]] = {
    "olx": (olx_fetcher.fetch, olx_parser.parse_html),
}

DEFAULT_COOKIE_FILE = "/app/.olx-cookies.txt"


class ScrapeRequest(BaseModel):
    domain_id: str
    url: str
    cookies: Optional[str] = None


def _resolve_cookies(req: ScrapeRequest) -> str:
    if req.cookies:
        return req.cookies.strip()
    path = os.getenv("OLX_COOKIE_FILE", DEFAULT_COOKIE_FILE)
    if Path(path).exists():
        return Path(path).read_text().strip()
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"no cookies provided and {path} not found",
    )


@router.post("/scrape")
def scrape(req: ScrapeRequest):
    pair = FETCHERS.get(req.domain_id)
    if pair is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"no fetcher registered for domain: {req.domain_id}",
        )
    fetch_fn, parse_fn = pair

    resp = fetch_fn(req.url, _resolve_cookies(req))
    if resp.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"upstream returned {resp.status_code} ({len(resp.content)} bytes)",
        )

    items = parse_fn(resp.text)
    result = process_items(req.domain_id, items)
    result["fetched_url"] = req.url
    result["fetched_bytes"] = len(resp.content)
    result["parsed_items"] = len(items)
    return result
