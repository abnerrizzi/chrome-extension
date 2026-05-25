#!/usr/bin/env python3
"""Extrai apenas o JSON cru do <script id="__NEXT_DATA__"> de uma página OLX.

Saída é o JSON em si — sem wrapping, sem filtro, sem normalização.
Útil para inspecionar a estrutura antes de adaptar o parser.

Uso:
    dump_next_data.py <input.html>                # imprime em stdout
    dump_next_data.py <input.html> <out.json>     # grava no arquivo
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

if len(sys.argv) < 2:
    print(__doc__, file=sys.stderr)
    sys.exit(2)

text = Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(?P<json>\{.*?\})\s*</script>',
    text, re.S,
)
if not m:
    raise SystemExit("__NEXT_DATA__ não encontrado no input.")

raw = m.group("json")
if len(sys.argv) >= 3:
    Path(sys.argv[2]).write_text(raw, encoding="utf-8")
    print(f"{len(raw):,} bytes → {sys.argv[2]}", file=sys.stderr)
else:
    sys.stdout.write(raw)
