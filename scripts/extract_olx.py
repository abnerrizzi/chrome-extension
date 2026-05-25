#!/usr/bin/env python3
"""Lê HTML do OLX (ou JSON do __NEXT_DATA__) e gera o payload de ingest.

Espelha exatamente a lógica do parser JS em extension/parsers/olx_parser.js:
    - usa apenas `props.pageProps.ads`
    - extrai `kind` ("venda" | "aluguel") de `properties[].real_estate_type`
      (fallback: regex no título/URL)
    - filtra anúncios que NÃO sejam venda nem aluguel de casa
    - mesmo shape de campos do parser (`external_id, title, url, price_raw,
      listing_kind, location, neighbourhood, city_raw, state_raw, category_raw,
      real_estate_type_raw, kind, date_raw, image_url, iptu_raw, bedrooms_raw,
      bathrooms_raw, garage_spaces_raw, area_raw`)

Uso:
    extract_olx.py <input.html|input.json>            # imprime payload em stdout
    extract_olx.py <input> <output.json>              # grava no arquivo
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path


def load_next_data(text: str) -> dict:
    """Aceita 3 formatos:
    1. HTML com <script id="__NEXT_DATA__" type="application/json">{...}</script>
    2. Trecho contendo o mesmo script (ex: tmp/next_data.js do dev)
    3. JSON puro (já extraído)
    """
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    m = re.search(
        r'<script[^>]*id="__NEXT_DATA__"[^>]*>(?P<json>\{.*?\})\s*</script>',
        text, re.S,
    )
    if not m:
        raise SystemExit("__NEXT_DATA__ não encontrado no input.")
    return json.loads(m.group("json"))


def find_prop(props, name: str):
    if not isinstance(props, list):
        return None
    want = name.lower()
    for p in props:
        if isinstance(p, dict) and str(p.get("name", "")).lower() == want:
            v = p.get("value")
            return None if v is None else str(v)
    return None


def format_location(ad: dict):
    ld = ad.get("locationDetails") or {}
    if ld.get("neighbourhood") or ld.get("municipality"):
        return ", ".join(
            x for x in [ld.get("neighbourhood"), ld.get("municipality"), ld.get("uf")] if x
        )
    return ad.get("location")


def pick_image(ad: dict):
    imgs = ad.get("images") or []
    if not imgs:
        return ad.get("thumbnail")
    first = imgs[0]
    if isinstance(first, str):
        return first
    return first.get("originalWebp") or first.get("original") or first.get("medium")


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def kind_from_real_estate_type(raw):
    if not raw:
        return None
    prefix = _strip_accents(str(raw)).split("-")[0].strip().lower()
    if prefix.startswith("venda"):
        return "venda"
    if prefix.startswith("aluguel") or prefix.startswith("locacao"):
        return "aluguel"
    return None


def kind_from_title_or_url(title, url):
    t = _strip_accents(f"{title or ''} {url or ''}").lower()
    if re.search(r"\b(aluguel|alugar|locacao|para alugar)\b", t):
        return "aluguel"
    if re.search(r"\b(venda|vender|a venda|comprar|compra)\b", t):
        return "venda"
    return None


def is_venda_ou_aluguel(item: dict) -> bool:
    return item.get("kind") in ("venda", "aluguel")


def to_item(ad: dict):
    if not isinstance(ad, dict):
        return None
    id_ = ad.get("listId") or ad.get("id")
    url = ad.get("url") or ad.get("friendlyUrl")
    title = ad.get("subject") or ad.get("title")
    if id_ is None or not url or not title:
        return None
    props = ad.get("properties")
    ld = ad.get("locationDetails") or {}
    date_raw = ad.get("origListTime") or ad.get("date")
    real_estate_type_raw = find_prop(props, "real_estate_type")
    category_raw = find_prop(props, "category")
    return {
        "external_id": str(id_),
        "title": str(title),
        "url": str(url),
        "price_raw": ad.get("priceValue"),
        "listing_kind": ad.get("categoryName") or ad.get("category"),
        "location": format_location(ad),
        "neighbourhood": ld.get("neighbourhood"),
        "city_raw": ld.get("municipality"),
        "state_raw": ld.get("uf"),
        "category_raw": category_raw,
        "real_estate_type_raw": real_estate_type_raw,
        "kind": kind_from_real_estate_type(real_estate_type_raw)
            or kind_from_title_or_url(title, url),
        "date_raw": None if date_raw is None else str(date_raw),
        "image_url": pick_image(ad),
        "iptu_raw": find_prop(props, "iptu"),
        "bedrooms_raw": find_prop(props, "rooms"),
        "bathrooms_raw": find_prop(props, "bathrooms"),
        "garage_spaces_raw": find_prop(props, "garage_spaces"),
        "area_raw": find_prop(props, "size"),
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1]).read_text(encoding="utf-8")
    data = load_next_data(src)
    ads = data.get("props", {}).get("pageProps", {}).get("ads")
    if not isinstance(ads, list):
        raise SystemExit("props.pageProps.ads ausente ou não é array.")
    items = [it for it in (to_item(a) for a in ads) if it and is_venda_ou_aluguel(it)]
    payload = {"domain_id": "olx", "raw_data": {"items": items}}
    out = json.dumps(payload, ensure_ascii=False)
    if len(sys.argv) >= 3:
        Path(sys.argv[2]).write_text(out, encoding="utf-8")
        print(f"{len(items)} casas → {sys.argv[2]}", file=sys.stderr)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
