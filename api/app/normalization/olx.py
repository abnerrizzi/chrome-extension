"""Funções puras de normalização para itens da OLX.

Converte preços em strings localizadas (ex: "R$ 1.234,56") para centavos inteiros
e preserva URL/título intactos. Sem dependências externas — regex puro.
"""
from __future__ import annotations

import re

_PRICE_RX = re.compile(r"[^\d,]")


def _price_to_cents(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = _PRICE_RX.sub("", raw).replace(",", ".")
    if not cleaned:
        return None
    try:
        return int(round(float(cleaned) * 100))
    except ValueError:
        return None


def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "title": (it.get("title") or "").strip(),
            "price_cents": _price_to_cents(it.get("price_raw")),
            "currency": "BRL",
            "location": (it.get("location") or "").strip() or None,
            "url": it.get("url"),
        }
        for it in items
    ]
