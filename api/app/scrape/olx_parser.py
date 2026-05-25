"""Server-side port of extension/parsers/olx_parser.js — extracts ads from __NEXT_DATA__."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

_NEXT_DATA_RX = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)
_HOUSE_KIND_RX = re.compile(r"^casas?$", re.IGNORECASE)
_HOUSE_URL_RX = re.compile(r"/imoveis/casa", re.IGNORECASE)
_HOUSE_TITLE_RX = re.compile(r"\bcasa\b", re.IGNORECASE)


def parse_html(html: str) -> list[dict]:
    m = _NEXT_DATA_RX.search(html)
    if not m:
        return []
    data = json.loads(m.group(1))
    ads = data.get("props", {}).get("pageProps", {}).get("ads")
    if not isinstance(ads, list):
        return []
    items = (_to_item(ad) for ad in ads)
    return [it for it in items if it and _is_house(it)]


def _to_item(ad: Any) -> Optional[dict]:
    if not isinstance(ad, dict):
        return None
    list_id = ad.get("listId") or ad.get("id")
    url = ad.get("url") or ad.get("friendlyUrl")
    title = ad.get("subject") or ad.get("title")
    if not (title and url and list_id is not None):
        return None
    props = ad.get("properties")
    return {
        "external_id": str(list_id),
        "title": str(title),
        "url": str(url),
        "price_raw": ad.get("priceValue"),
        "listing_kind": ad.get("categoryName") or ad.get("category"),
        "location": _format_location(ad),
        "date_raw": _stringify_date(ad.get("origListTime") or ad.get("date")),
        "image_url": _pick_image(ad),
        "iptu_raw": _find_prop(props, "iptu"),
        "bedrooms_raw": _find_prop(props, "rooms"),
        "bathrooms_raw": _find_prop(props, "bathrooms"),
        "garage_spaces_raw": _find_prop(props, "garage_spaces"),
        "area_raw": _find_prop(props, "size"),
    }


def _format_location(ad: dict) -> Optional[str]:
    ld = ad.get("locationDetails")
    if isinstance(ld, dict) and (ld.get("neighbourhood") or ld.get("municipality")):
        parts = [ld.get("neighbourhood"), ld.get("municipality"), ld.get("uf")]
        return ", ".join(p for p in parts if p)
    return ad.get("location")


def _pick_image(ad: dict) -> Optional[str]:
    imgs = ad.get("images")
    if not isinstance(imgs, list) or not imgs:
        return ad.get("thumbnail")
    first = imgs[0]
    if isinstance(first, str):
        return first
    if isinstance(first, dict):
        return (
            first.get("originalWebp")
            or first.get("original")
            or first.get("medium")
            or first.get("thumbnail")
        )
    return None


def _stringify_date(v: Any) -> Optional[str]:
    if v in (None, "", 0):
        return None
    return str(v)


def _find_prop(props: Any, name: str) -> Optional[str]:
    if not isinstance(props, list):
        return None
    want = name.lower()
    for p in props:
        if isinstance(p, dict) and str(p.get("name") or "").lower() == want:
            v = p.get("value")
            return str(v) if v is not None else None
    return None


def _is_house(it: dict) -> bool:
    kind = (it.get("listing_kind") or "").strip()
    if kind and _HOUSE_KIND_RX.match(kind):
        return True
    if _HOUSE_URL_RX.search(it.get("url") or ""):
        return True
    return bool(_HOUSE_TITLE_RX.search(it.get("title") or ""))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--html", help="Path to HTML file (default: stdin)")
    args = p.parse_args()
    html = Path(args.html).read_text() if args.html else sys.stdin.read()
    items = parse_html(html)
    json.dump(items, sys.stdout, ensure_ascii=False, indent=2)
    print(f"\n# {len(items)} items", file=sys.stderr)


if __name__ == "__main__":
    main()
