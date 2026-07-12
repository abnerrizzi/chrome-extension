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
    if match:
        cnpj, ano, seq = match.groups()
        api_url = f"https://pncp.gov.br/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq}"
    else:
        api_url = url

    # Call the public API directly
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    r = httpx.get(api_url, headers=headers, timeout=30)
    return MockResponse(r.text, r.status_code)
