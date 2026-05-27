"""Normalização para vagas do LinkedIn (lista + detalhe).

Duas funções puras, uma por domínio:
- `normalize_list`   → cards da página de busca (`domain_id="linkedin"`).
- `normalize_detail` → vaga aberta com descrição completa (`domain_id="linkedin_detail"`).

As duas linhas se unem no banco pelo `external_id` (id numérico do jobPosting):
a lista insere o esqueleto e o detalhe enriquece a mesma linha via upsert.

Transforma:
- texto de candidaturas (`"Over 200 applicants"`) em inteiro;
- data de publicação ISO/epoch/relativa em ISO-8601 best-effort (relativa passa
  direto, sem inventar timestamp).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

_INT_RX = re.compile(r"\d[\d.,]*")
_ISO_RX = re.compile(r"^\d{4}-\d{2}-\d{2}")
_DIGITS_ONLY = re.compile(r"^\d{10,}$")  # unix epoch (s ou ms)


def _clean(s) -> Optional[str]:
    if s is None:
        return None
    s = str(s).strip()
    return s or None


def _first_int(raw: Optional[str]) -> Optional[int]:
    """Primeiro número de um texto, ignorando separadores de milhar
    (`"Over 1,200 applicants"` → 1200)."""
    if not raw:
        return None
    m = _INT_RX.search(str(raw))
    if not m:
        return None
    digits = re.sub(r"[^\d]", "", m.group(0))
    return int(digits) if digits else None


def _posted_to_iso(raw) -> Optional[str]:
    """ISO-8601 best-effort. Aceita ISO (passa direto) e unix epoch (s/ms).
    Texto relativo do LinkedIn (`"2 days ago"`) não é convertido — retorna o
    original para não fabricar um timestamp impreciso."""
    if raw in (None, "", 0):
        return None
    s = str(raw).strip()
    if _ISO_RX.match(s):
        return s
    if _DIGITS_ONLY.match(s):
        ts = int(s)
        if ts > 10_000_000_000:  # ms
            ts = ts / 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return s


def normalize_list(items: list[dict]) -> list[dict]:
    return [
        {
            "external_id": _clean(it.get("external_id")),
            "title": (it.get("title") or "").strip(),
            "company": _clean(it.get("company")),
            "location": _clean(it.get("location")),
            "url": it.get("url"),
            "posted_at": _posted_to_iso(it.get("posted_raw")),
            "source_view": _clean(it.get("source_view")),
        }
        for it in items
    ]


def normalize_detail(items: list[dict]) -> list[dict]:
    return [
        {
            "external_id": _clean(it.get("external_id")),
            "title": (it.get("title") or "").strip(),
            "company": _clean(it.get("company")),
            "location": _clean(it.get("location")),
            "url": it.get("url"),
            "description": _clean(it.get("description")),
            "seniority": _clean(it.get("seniority")),
            "employment_type": _clean(it.get("employment_type")),
            "applicants": _first_int(it.get("applicants_raw")),
            "source_view": _clean(it.get("source_view")),
        }
        for it in items
    ]
