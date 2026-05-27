#!/usr/bin/env python3
"""Lê HTML de vagas do LinkedIn (experiência GUEST) e gera o payload de ingest.

Espelha a extração do ramo **guest** de extension/parsers/linkedin_parser.js
(SEL.GUEST.list): cada card é um `div.base-card.job-search-card`, com
    external_id  ← data-entity-urn (dígitos) ou /jobs/view/<slug>-<id>
    title        ← h3.base-search-card__title
    company      ← h4.base-search-card__subtitle
    location     ← span.job-search-card__location
    url          ← a.base-card__full-link[href]   (query removida)
    posted_raw   ← time[datetime] (fallback: texto do <time>)
    source_view  = "guest"

Funciona tanto na página de busca guest quanto no fragmento da API guest
(`/jobs-guest/jobs/api/seeMoreJobPostings/search`). Mantém só itens com título e
(external_id ou url) — mesmo filtro tolerante do parser JS.

Uso:
    extract_linkedin.py <input.html>                  # imprime payload em stdout
    extract_linkedin.py <input.html> <output.json>    # grava no arquivo
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

_VIEW_ID = re.compile(r"/jobs/view/(?:[^/?#]*?-)?(\d{6,})")
_CUR_ID = re.compile(r"currentJobId=(\d+)")
_LONG_ID = re.compile(r"(\d{6,})")


def _digits(s: str | None):
    if not s:
        return None
    m = re.search(r"\d{4,}", s) or re.search(r"\d+", s)
    return m.group(0) if m else None


def _id_from_url(href: str | None):
    if not href:
        return None
    for rx in (_CUR_ID, _VIEW_ID, _LONG_ID):
        m = rx.search(href)
        if m:
            return m.group(1)
    return None


def _norm(text: str) -> str:
    return " ".join(text.split())


class GuestCardsParser(HTMLParser):
    """Coleta cards `div.base-card`. Sem rastrear profundidade: descarrega o card
    anterior ao encontrar o próximo `base-card` (e o último no `close()`). Cada
    campo é capturado uma vez (primeira ocorrência) por elemento de classe
    específica, que só existe dentro do card."""

    _CAPTURE_TAGS = {"h3", "h4", "span", "time"}

    def __init__(self):
        super().__init__()
        self.cards: list[dict] = []
        self.cur: dict | None = None
        self.capture: str | None = None
        self._buf: list[str] = []

    def _flush(self):
        if self.cur is not None:
            self.cards.append(self.cur)
        self.cur = None
        self.capture = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        classes = a.get("class", "").split()

        if tag == "div" and "base-card" in classes:
            self._flush()
            self.cur = {
                "external_id": _digits(a.get("data-entity-urn")),
                "title": None, "company": None, "location": None,
                "url": None, "posted_raw": None, "source_view": "guest",
            }
            return
        if self.cur is None:
            return

        if tag == "a" and "base-card__full-link" in classes and a.get("href"):
            self.cur["url"] = a["href"].split("?")[0].strip()
            if not self.cur["external_id"]:
                self.cur["external_id"] = _id_from_url(a["href"])
        elif tag == "time" and a.get("datetime"):
            self.cur["posted_raw"] = a["datetime"].strip()
        elif tag == "time":
            self.capture, self._buf = "posted_raw", []
        elif tag == "h3" and "base-search-card__title" in classes:
            self.capture, self._buf = "title", []
        elif tag == "h4" and "base-search-card__subtitle" in classes:
            self.capture, self._buf = "company", []
        elif tag == "span" and "job-search-card__location" in classes:
            self.capture, self._buf = "location", []

    def handle_data(self, data):
        if self.capture:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if self.cur is not None and self.capture and tag in self._CAPTURE_TAGS:
            text = _norm("".join(self._buf))
            if text and not self.cur.get(self.capture):
                self.cur[self.capture] = text
            self.capture, self._buf = None, []

    def close(self):
        super().close()
        self._flush()


def extract_items(html: str) -> list[dict]:
    """Parseia o HTML guest e devolve os cards válidos (mesmo filtro tolerante
    do parser JS: mantém se tem título e (external_id ou url))."""
    p = GuestCardsParser()
    p.feed(html)
    p.close()
    return [c for c in p.cards if c.get("title") and (c.get("external_id") or c.get("url"))]


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    items = extract_items(Path(sys.argv[1]).read_text(encoding="utf-8"))
    payload = {"domain_id": "linkedin", "raw_data": {"items": items}}
    out = json.dumps(payload, ensure_ascii=False)
    if len(sys.argv) >= 3:
        Path(sys.argv[2]).write_text(out, encoding="utf-8")
        print(f"{len(items)} vagas → {sys.argv[2]}", file=sys.stderr)
    else:
        sys.stdout.write(out)


if __name__ == "__main__":
    main()
