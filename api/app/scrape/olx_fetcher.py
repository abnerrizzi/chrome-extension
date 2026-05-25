"""One-off OLX fetcher that bypasses Cloudflare via curl_cffi's Chrome TLS fingerprint."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from curl_cffi import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
)


def fetch(url: str, cookie_str: str, *, impersonate: str = "chrome") -> requests.Response:
    headers = {
        "user-agent": UA,
        "accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8,"
            "application/signed-exchange;v=b3;q=0.7"
        ),
        "accept-language": "en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7",
        "upgrade-insecure-requests": "1",
        "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "cookie": cookie_str,
    }
    return requests.get(url, headers=headers, impersonate=impersonate, timeout=30)


def _resolve_cookies(args: argparse.Namespace) -> str:
    if args.cookies_file:
        return Path(args.cookies_file).read_text().strip()
    env = os.getenv("OLX_COOKIE")
    if env:
        return env.strip()
    sys.exit("error: pass --cookies-file or set OLX_COOKIE")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--cookies-file")
    p.add_argument("--out")
    p.add_argument("--impersonate", default="chrome")
    args = p.parse_args()

    resp = fetch(args.url, _resolve_cookies(args), impersonate=args.impersonate)
    print(f"status={resp.status_code} bytes={len(resp.content)}", file=sys.stderr)
    if args.out:
        Path(args.out).write_bytes(resp.content)
    else:
        sys.stdout.buffer.write(resp.content)
    sys.exit(0 if resp.status_code == 200 else 1)


if __name__ == "__main__":
    main()
