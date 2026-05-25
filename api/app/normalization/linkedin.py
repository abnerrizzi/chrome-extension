"""Funções puras de normalização para itens do LinkedIn."""
from __future__ import annotations


def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "job_title": (it.get("job_title") or "").strip(),
            "company": (it.get("company") or "").strip() or None,
            "location": (it.get("location") or "").strip() or None,
            "url": it.get("url"),
        }
        for it in items
    ]
