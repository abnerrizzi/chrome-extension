"""Normalização para itens OLX especializados em casas (imóveis).

Converte:
- preços localizados (`R$ 2.250.000` / `R$ 1.234,56`) em centavos inteiros;
- aria-labels de detalhes (`"3 quartos"`, `"230 metros quadrados"`) em inteiros;
- datas pt-BR abreviadas (`"9 de mai, 04:58"`) em ISO-8601 (ano inferido pelo
  ano corrente, com fallback para o anterior caso a data caia no futuro).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

_PRICE_RX = re.compile(r"[^\d,]")
_INT_RX = re.compile(r"\d+")

_MONTHS_PT = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}


def _price_to_cents(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    cleaned = _PRICE_RX.sub("", raw).replace(",", ".")
    if not cleaned:
        return None
    try:
        return int(round(float(cleaned) * 100))
    except ValueError:
        return None


def _first_int(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    m = _INT_RX.search(raw)
    return int(m.group(0)) if m else None


def _date_to_iso(raw: Optional[str], now: Optional[datetime] = None) -> Optional[str]:
    """Converte '9 de mai, 04:58' para ISO-8601. Ano = ano atual; volta um ano se ficar no futuro."""
    if not raw:
        return None
    m = re.match(
        r"^\s*(?P<day>\d{1,2})\s+de\s+(?P<mon>[a-z]{3})\.?,?\s+(?P<hh>\d{1,2}):(?P<mm>\d{2})\s*$",
        raw.strip().lower(),
    )
    if not m:
        return raw
    mon = _MONTHS_PT.get(m.group("mon"))
    if not mon:
        return raw
    now = now or datetime.now(timezone.utc)
    candidate = datetime(now.year, mon, int(m.group("day")),
                         int(m.group("hh")), int(m.group("mm")), tzinfo=timezone.utc)
    if candidate > now:
        candidate = candidate.replace(year=now.year - 1)
    return candidate.isoformat()


def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "external_id": it.get("external_id"),
            "title": (it.get("title") or "").strip(),
            "url": it.get("url"),
            "price_cents": _price_to_cents(it.get("price_raw")),
            "currency": "BRL",
            "listing_kind": (it.get("listing_kind") or "").strip() or None,
            "location": (it.get("location") or "").strip() or None,
            "posted_at": _date_to_iso(it.get("date_raw")),
            "image_url": it.get("image_url"),
            "iptu_cents": _price_to_cents(it.get("iptu_raw")),
            "bedrooms": _first_int(it.get("bedrooms_raw")),
            "bathrooms": _first_int(it.get("bathrooms_raw")),
            "garage_spaces": _first_int(it.get("garage_spaces_raw")),
            "area_m2": _first_int(it.get("area_raw")),
        }
        for it in items
    ]
