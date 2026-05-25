"""Funções puras de normalização para itens de leilão.

Converte lances localizados em centavos e datas em ISO-8601 quando possível.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

_BID_RX = re.compile(r"[^\d,]")


def _bid_to_cents(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    cleaned = _BID_RX.sub("", raw).replace(",", ".")
    try:
        return int(round(float(cleaned) * 100))
    except ValueError:
        return None


def _to_iso(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(raw.strip(), fmt).isoformat()
        except ValueError:
            continue
    return raw  # devolve original se não soubermos parsear; validação posterior decide


def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "lot_code": (it.get("lot_code") or "").strip(),
            "title": (it.get("title") or "").strip(),
            "current_bid_cents": _bid_to_cents(it.get("current_bid_raw")),
            "auction_end": _to_iso(it.get("auction_end_raw")),
            "url": it.get("url"),
        }
        for it in items
    ]
