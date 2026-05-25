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


_ISO_RX = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_DIGITS_ONLY = re.compile(r"^\d{10,}$")  # unix epoch (s ou ms)


def _date_to_iso(raw, now: Optional[datetime] = None) -> Optional[str]:
    """Converte para ISO-8601 aceitando 3 formatos comuns:
    1. pt-BR DOM antigo: '9 de mai, 04:58'
    2. ISO 8601 já formatado (passa direto): '2026-05-09T04:58:00Z'
    3. Unix timestamp em segundos ou ms (string ou int): '1715228280000'
    """
    if raw in (None, "", 0):
        return None
    s = str(raw).strip()

    # ISO já formatado → passa direto.
    if _ISO_RX.match(s):
        return s

    # Unix timestamp puro.
    if _DIGITS_ONLY.match(s):
        ts = int(s)
        if ts > 10_000_000_000:  # ms
            ts = ts / 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

    # pt-BR abreviado.
    m = re.match(
        r"^\s*(?P<day>\d{1,2})\s+de\s+(?P<mon>[a-z]{3})\.?,?\s+(?P<hh>\d{1,2}):(?P<mm>\d{2})\s*$",
        s.lower(),
    )
    if not m:
        return s  # passa o original — validação posterior decide
    mon = _MONTHS_PT.get(m.group("mon"))
    if not mon:
        return s
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
