# Domain: OLX

**What this is.** Reference notes for the OLX module — the gold-standard
implementation. Mature, real-world tested, covers most patterns the recipe in
[`add-domain-module.md`](add-domain-module.md) abstracts.

**When to use it.** Read when designing a new domain that needs hydration-blob
extraction, non-trivial normalization (prices, dates, dimensions), or a
deduplicated upsert flow. Mirror this module's shape rather than the LinkedIn
stub.

---

## Coverage

- Domain pattern: `*://*.olx.com.br/*`.
- Listing type: real estate (houses), filtered to `venda` (sale) and `aluguel`
  (rent) only. Other categories — `temporada`, `troca`, etc. — are dropped at
  the parser.
- Database table: `olx_listings`. Schema evolved across changesets
  `olx-001` through `olx-006` — see `db/changelog/modules/olx.sql` and the
  parallel `db/changelog-sqlite/modules/olx.sql`.

## Key files

| File                                         | Role                                           |
|----------------------------------------------|------------------------------------------------|
| `extension/parsers/olx_parser.js`            | `__NEXT_DATA__`-based parser, 161 lines        |
| `api/app/schemas/olx.json`                   | JSON Schema, 18 properties                     |
| `api/app/normalization/olx.py`               | Price/date/dimension normalizer                |
| `db/changelog/modules/olx.sql`               | Postgres Liquibase changesets                  |
| `db/changelog-sqlite/modules/olx.sql`        | SQLite Liquibase changesets                    |
| `api/app/core/persistence.py:67`             | `olx` branch in `_insert_items` (large upsert) |
| `scripts/extract_olx.py`                     | Mirror of the parser for the Make pipeline     |
| `api/app/scrape/olx_fetcher.py`              | Server-side fetch via curl-impersonate         |
| `api/app/scrape/olx_parser.py`               | Server-side parser (Python port)               |

## OLX-specific things to know

1. **Source of truth: `__NEXT_DATA__`.** The parser does **not** query the
   rendered DOM. It reads `<script id="__NEXT_DATA__">` (Next.js hydration
   blob), parses it as JSON, and pulls `props.pageProps.ads`. DOM scraping
   was tried and rejected — class names rotate, the hydration blob doesn't.

2. **Kind derivation.** `kindFromRealEstateType` (parser line 141) splits
   `properties[].real_estate_type` on `-` and reads the prefix:
   - `"Venda - casa em rua pública"` → `"venda"`
   - `"Aluguel - casa em condominio fechado"` → `"aluguel"`
   - Anything else (temporada, troca) → dropped by `isVendaOuAluguel`.

   Fallback heuristic for missing properties: regex against title + URL
   (`kindFromTitleOrUrl`, parser line 151).

3. **Location splitting.** `locationDetails` exposes `municipality`,
   `neighbourhood`, `uf` separately. The schema captures all three as raw
   strings; the normalizer emits `city`, `neighbourhood`, `state` as
   independent columns. A combined `location` string is still produced for
   the popup preview (compat).

4. **Numeric price.** OLX prices come as localized strings
   (`"R$ 2.250.000"`, `"R$ 1.234,56"`). `_price_to_amount`
   (`api/app/normalization/olx.py:24`) strips non-digits, swaps `,` for `.`,
   parses as `float`. Stored as `NUMERIC(12,2)` (changeset `olx-005` migrated
   from the earlier `price_cents BIGINT`).

5. **Date inference.** Three accepted formats in `_date_to_iso`
   (`api/app/normalization/olx.py:51`):
   - ISO-8601 (pass-through).
   - Unix epoch in seconds or milliseconds.
   - pt-BR abbreviated (`"9 de mai, 04:58"`) — year inferred from current
     year, fallback to previous year if the candidate falls in the future.

6. **MutationObserver on the blob.** The parser registers a
   `MutationObserver` on the `__NEXT_DATA__` script itself in case Next.js
   re-hydrates the blob client-side. In practice OLX uses pushState
   pagination, so the more important re-injection path is
   `chrome.webNavigation.onHistoryStateUpdated` in
   `extension/background.js:60`.

7. **Cloudflare bypass for the Make pipeline.** OLX sits behind Cloudflare;
   plain `curl` gets a CAPTCHA page. The Makefile uses curl-impersonate
   (Chrome 110 TLS fingerprint) via Docker. See `Makefile` targets:
   `fetch` / `raw` / `extract` / `ingest` / `run`. The extension itself is
   unaffected — it runs inside a real browser so Cloudflare is fine.

8. **Parser ↔ extractor parity.** `scripts/extract_olx.py` is a Python port
   of `extension/parsers/olx_parser.js`, intentionally line-by-line
   equivalent. Same path (`props.pageProps.ads`), same field mapping, same
   filter. Changes to one must replicate to the other.

## Why OLX is the right pattern to copy

- Hydration-blob extraction is far more stable than DOM selectors.
- Normalization is non-trivial (currency, dates, dimensions) and pure — easy
  to test in isolation.
- The dedup index + upsert is exercised by `test_external_id_upsert_dedupes_olx`
  on both backends.
- The Make pipeline mirrors the extension end-to-end, so the same payload can
  be sanity-checked without Chrome.

## Fixture

For local development, drop a real `__NEXT_DATA__` JSON at
`tmp/olx_next_data.json` (gitignored). Both `scripts/extract_olx.py` and the
unit tests can consume it.
