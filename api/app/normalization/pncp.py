"""Normalization functions for PNCP government auction items.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

def _to_iso(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    raw_clean = raw.strip()
    # Try common formats
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(raw_clean, fmt).isoformat()
        except ValueError:
            continue
    # If it already looks like ISO format: check for 'T' followed by digits
    if "T" in raw_clean and any(c.isdigit() for c in raw_clean):
        # basic check: e.g. 2026-07-10T14:30:00Z or similar
        # let's be more specific: look for a digit before and after T
        if re.search(r"\d[T ]\d", raw_clean):
            return raw_clean
    return None

def _parse_float(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    raw_clean = raw.replace("R$", "").strip()
    if "," in raw_clean and "." in raw_clean:
        # e.g. 1.234,56
        raw_clean = raw_clean.replace(".", "").replace(",", ".")
    elif "," in raw_clean:
        # e.g. 1234,56
        raw_clean = raw_clean.replace(",", ".")
    try:
        return float(raw_clean)
    except ValueError:
        return None

def _parse_local(raw: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not raw:
        return None, None
    parts = [p.strip() for p in raw.split("/")]
    if len(parts) >= 2:
        return parts[0], parts[1][:2].upper()
    return raw.strip(), None

def normalize(items: list[dict]) -> list[dict]:
    res = []
    for it in items:
        municipio, uf = _parse_local(it.get("local"))
        res.append({
            "external_id": (it.get("external_id") or "").strip(),
            "pncp_id": (it.get("pncp_id") or "").strip(),
            "numero_edital": (it.get("numero_edital") or "").strip(),
            "modalidade": (it.get("modalidade") or "").strip(),
            "municipio": municipio,
            "uf": uf,
            "objeto": (it.get("objeto") or "").strip(),
            "data_publicacao_pncp": _to_iso(it.get("ultima_atualizacao_raw")),
            "url": (it.get("url") or "").strip(),
        })
    return res

def normalize_detail(items: list[dict]) -> list[dict]:
    res = []
    for it in items:
        # If municipio/uf are sent separately
        municipio = it.get("municipio")
        uf = it.get("uf")
        
        # Otherwise try to parse local if present
        if not municipio or not uf:
            m, u = _parse_local(it.get("local"))
            municipio = municipio or m
            uf = uf or u

        normalized_itens = []
        for pi in (it.get("itens") or []):
            normalized_itens.append({
                "numero_item": int(pi.get("numero_item") or 0),
                "descricao": (pi.get("descricao") or "").strip(),
                "material_ou_servico": (pi.get("material_ou_servico") or "").strip(),
                "valor_unitario_estimado": float(pi["valor_unitario_estimado"]) if pi.get("valor_unitario_estimado") is not None else None,
                "valor_unitario_estimado_raw": (pi.get("valor_unitario_estimado_raw") or "").strip() or None,
                "valor_total": float(pi["valor_total"]) if pi.get("valor_total") is not None else None,
                "valor_total_raw": (pi.get("valor_total_raw") or "").strip() or None,
                "quantidade": float(pi["quantidade"]) if pi.get("quantidade") is not None else None,
                "unidade_medida": (pi.get("unidade_medida") or "").strip(),
                "situacao": (pi.get("situacao") or "").strip(),
            })

        res.append({
            "external_id": (it.get("external_id") or "").strip(),
            "pncp_id": (it.get("pncp_id") or "").strip(),
            "numero_edital": (it.get("numero_edital") or "").strip(),
            "modalidade": (it.get("modalidade") or "").strip(),
            "modo_disputa": (it.get("modo_disputa") or "").strip(),
            "orgao_cnpj": (it.get("orgao_cnpj") or "").strip(),
            "orgao_razao_social": (it.get("orgao_razao_social") or "").strip(),
            "municipio": municipio,
            "uf": uf,
            "objeto": (it.get("objeto") or "").strip(),
            "valor_total_estimado": _parse_float(it.get("valor_total_estimado_raw")),
            "valor_total_homologado": _parse_float(it.get("valor_total_homologado_raw")),
            "situacao": (it.get("situacao") or "").strip(),
            "srp": it.get("srp") is True,
            "amparo_legal": (it.get("amparo_legal") or "").strip(),
            "data_publicacao_pncp": _to_iso(it.get("data_publicacao_pncp_raw")),
            "data_abertura_proposta": _to_iso(it.get("data_abertura_proposta_raw")),
            "data_encerramento_proposta": _to_iso(it.get("data_encerramento_proposta_raw")),
            "link_sistema_origem": (it.get("link_sistema_origem") or "").strip(),
            "url": (it.get("url") or "").strip(),
            "itens": normalized_itens,
        })
    return res
