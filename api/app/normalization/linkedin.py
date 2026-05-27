"""Funções puras de normalização para itens do LinkedIn.

A página de busca emite cards rasos (job_title/company/location/url/external_id);
a página de detalhe emite um item único com os mesmos campos + description,
seniority, workplace_type, posted_at e skills. O mesmo normalizer cobre os dois
formatos — tudo além de `job_title` é opcional. O upsert por `external_id`
mescla detalhe sobre lista na camada de persistência.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

_REL_RE = re.compile(
    r"""(?ix)                              # case-insensitive, verbose
        (?:reposted|posted)?\s*            # opcional 'Reposted ' / 'Posted '
        (\d+)\s+                           # quantidade
        (minute|hour|day|week|month|year)s?  # unidade
        \s+ago                             # sufixo
    """
)
_UNIT_SECONDS = {
    "minute": 60,
    "hour":   3_600,
    "day":    86_400,
    "week":   604_800,
    "month":  2_592_000,    # ~30d, aproximação aceita para discovery
    "year":   31_536_000,
}


def _posted_at_to_iso(raw):
    """Converte 'Reposted 3 days ago' / '<time datetime="…">' / ISO em ISO-8601 UTC.

    Retorna None quando o input é nulo. Se o input já parecer ISO, devolve como veio.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Já é ISO-8601 (com 'T' e algum offset/Z)?
    if "T" in s and (s.endswith("Z") or "+" in s[10:] or "-" in s[10:]):
        return s
    m = _REL_RE.search(s)
    if m:
        qty = int(m.group(1))
        unit = m.group(2).lower()
        delta = timedelta(seconds=qty * _UNIT_SECONDS[unit])
        return (datetime.now(timezone.utc) - delta).isoformat()
    return s  # passthrough — quem ler decide


def _skills_to_json(raw):
    """Lista de skills → string JSON. Tabela usa JSONB no Postgres e TEXT no
    SQLite — serializar uma única vez aqui mantém o INSERT cross-backend trivial.
    Já vindo como string, devolve como está (assume JSON pré-formatado)."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw or None
    if isinstance(raw, list):
        cleaned = [str(s).strip() for s in raw if s and str(s).strip()]
        return json.dumps(cleaned) if cleaned else None
    return None


def _opt_str(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _raw_to_json(raw):
    """`raw_json` catch-all: o parser já manda string JSON; se vier dict/list,
    serializa. Armazenado em JSONB (Postgres) / TEXT (SQLite), como skills."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw or None
    try:
        return json.dumps(raw)
    except (TypeError, ValueError):
        return None


def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "external_id":     it.get("external_id"),
            "job_title":       (it.get("job_title") or "").strip(),
            "company":         _opt_str(it.get("company")),
            "location":        _opt_str(it.get("location")),
            "url":             it.get("url"),
            "description":     _opt_str(it.get("description")),
            "seniority":       _opt_str(it.get("seniority")),
            "workplace_type":  _opt_str(it.get("workplace_type")),
            "posted_at":       _posted_at_to_iso(it.get("posted_at")),
            "employment_type": _opt_str(it.get("employment_type")),
            "job_function":    _opt_str(it.get("job_function")),
            "industries":      _opt_str(it.get("industries")),
            "raw_json":        _raw_to_json(it.get("raw_json")),
            "skills":          _skills_to_json(it.get("skills")),
        }
        for it in items
    ]
