"""Parser for PNCP API responses.
"""
from __future__ import annotations

import json

def parse_detail_json(json_str: str) -> list[dict]:
    try:
        data = json.loads(json_str)
    except Exception:
        return []

    orgao = data.get("orgaoEntidade") or {}
    unidade = data.get("unidadeOrgao") or {}
    amparo = data.get("amparoLegal") or {}

    itens = []
    for pi in (data.get("itens") or []):
        itens.append({
            "numero_item": int(pi.get("numeroItem") or 0),
            "descricao": str(pi.get("descricao") or ""),
            "material_ou_servico": str(pi.get("materialOuServico") or ""),
            "valor_unitario_estimado": float(pi["valorUnitarioEstimado"]) if pi.get("valorUnitarioEstimado") is not None else None,
            "valor_total": float(pi["valorTotal"]) if pi.get("valorTotal") is not None else None,
            "quantidade": float(pi["quantidade"]) if pi.get("quantidade") is not None else None,
            "unidade_medida": str(pi.get("unidadeMedida") or "").strip(),
            "situacao": str(pi.get("situacaoCompraItemNome") or pi.get("situacaoCompraItem") or ""),
        })

    item = {
        "external_id": str(data.get("numeroControlePNCP") or ""),
        "pncp_id": str(data.get("numeroControlePNCP") or ""),
        "numero_edital": f"Edital nº {data.get('numeroCompra')}/{data.get('anoCompra')}" if data.get('numeroCompra') and data.get('anoCompra') else "",
        "modalidade": str(data.get("modalidadeNome") or ""),
        "modo_disputa": str(data.get("modoDisputaNome") or ""),
        "orgao_cnpj": str(orgao.get("cnpj") or ""),
        "orgao_razao_social": str(orgao.get("razaoSocial") or ""),
        "municipio": str(unidade.get("municipioNome") or ""),
        "uf": str(unidade.get("ufSigla") or ""),
        "objeto": str(data.get("objetoCompra") or ""),
        "valor_total_estimado_raw": str(data["valorTotalEstimado"]) if data.get("valorTotalEstimado") is not None else None,
        "valor_total_homologado_raw": str(data["valorTotalHomologado"]) if data.get("valorTotalHomologado") is not None else None,
        "situacao": str(data.get("situacaoCompraNome") or ""),
        "srp": data.get("srp") is True,
        "amparo_legal": str(amparo.get("nome") or ""),
        "data_publicacao_pncp_raw": str(data.get("dataPublicacaoPncp") or ""),
        "data_abertura_proposta_raw": str(data.get("dataAberturaProposta") or ""),
        "data_encerramento_proposta_raw": str(data.get("dataEncerramentoProposta") or ""),
        "link_sistema_origem": str(data.get("linkSistemaOrigem") or ""),
        "url": "",
        "itens": itens,
    }
    return [item]
