"""Fetcher for PNCP public API.
"""
from __future__ import annotations

import re
import httpx

class MockResponse:
    def __init__(self, text: str, status_code: int):
        self.text = text
        self.content = text.encode("utf-8")
        self.status_code = status_code

def fetch(url: str, cookie_str: str = "") -> MockResponse:
    # Extract cnpj, year, and sequential from browser detail page URL
    # e.g. https://pncp.gov.br/app/editais/18712158000150/2026/27
    match = re.search(r"/editais/(\d+)/(\d+)/(\d+)", url)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if match:
        cnpj, ano, seq = match.groups()
        api_url = f"https://pncp.gov.br/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq}"
        items_url = f"https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens?pagina=1&tamanhoPagina=5000"
        
        r_compra = httpx.get(api_url, headers=headers, timeout=30)
        if r_compra.status_code != 200:
            return MockResponse(r_compra.text, r_compra.status_code)
            
        r_itens = httpx.get(items_url, headers=headers, timeout=30)
        itens = r_itens.json() if r_itens.status_code == 200 else []
        
        import json
        try:
            data = r_compra.json()
            data["itens"] = itens
            return MockResponse(json.dumps(data), 200)
        except Exception as e:
            return MockResponse(str(e), 500)
    else:
        r = httpx.get(url, headers=headers, timeout=30)
        return MockResponse(r.text, r.status_code)
