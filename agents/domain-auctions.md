# Domain: Auctions

**What this is.** Notes on the auctions module — currently a placeholder
against a non-existent host. Scaffolding is real; the target site is not.

**When to use it.** Read when a real auctions site needs to be wired up. Most
of the work will be parser-side; the schema, normalizer, and DB are already
non-trivial and can probably be reused with light tweaks.

---

## Current state

- **Domain pattern**: `*://*.auctions.example/*` — this is a **placeholder
  host**. The TLD `.example` is reserved by IANA and not routable, so the
  parser never runs against real traffic.
- **`allFrames: true`** on this domain (see `extension/background.js:24`) —
  the original assumption was that auction listings are often embedded in
  iframes.
- **DOM-based parser** keyed off `.lot-card` or `[data-lot-id]`.

| File                                            | Lines | Status                                |
|-------------------------------------------------|-------|---------------------------------------|
| `extension/parsers/auctions_parser.js`          | 31    | DOM-only, generic selectors           |
| `api/app/schemas/auctions.json`                 | 14    | 6 properties incl. `external_id`      |
| `api/app/normalization/auctions.py`             | 46    | Bid → cents, date → ISO-8601          |
| `db/changelog/modules/auctions.sql`             | 30    | `auction_items` table                 |
| `db/changelog-sqlite/modules/auctions.sql`      | (parallel) | Same shape as Postgres           |
| `api/app/core/persistence.py:100`               | -     | `auctions` branch in `_insert_items`  |

### Schema and table shape

The `auction_items` table is already designed around real auction concepts:

| Column                | Type             | Notes                                  |
|-----------------------|------------------|----------------------------------------|
| `lot_code`            | `VARCHAR(64)`    | Required, doubles as `external_id`     |
| `title`               | `VARCHAR(512)`   | Required                               |
| `current_bid_cents`   | `BIGINT`         | Required, integer cents (BRL default)  |
| `min_increment_cents` | `BIGINT`         | Optional                               |
| `currency`            | `CHAR(3)`        | Defaults to `BRL`                      |
| `auction_end`         | `TIMESTAMPTZ`    | Required, indexed                      |
| `url`                 | `VARCHAR(1024)`  | Required                               |
| `external_id`         | `VARCHAR(64)`    | Partial unique index, defaults to `lot_code` |

Normalizer (`api/app/normalization/auctions.py`) handles:

- **Bid string → cents.** Strips non-digit characters, swaps decimal
  separator, multiplies by 100, rounds. Pattern is the same as OLX
  `_price_to_amount` but emits integer cents instead of `NUMERIC(12,2)`.
  (A future cleanup could align with OLX's float-reais convention if
  consistency matters more than precision.)
- **Date parsing.** Tries three formats:
  `"%Y-%m-%dT%H:%M:%S"`, `"%Y-%m-%d %H:%M:%S"`, `"%d/%m/%Y %H:%M"`. Falls
  through to the original string if none match (validation downstream
  decides).
- **`external_id` fallback.** Defaults to `lot_code` when `external_id` is
  absent — for auctions the lot code is already a stable unique key.

---

## Wiring up a real auctions site

When a concrete target site is chosen, follow the recipe in
[`add-domain-module.md`](add-domain-module.md) but **reuse the existing
auctions infrastructure** rather than starting from scratch.

### Steps

1. **Decide whether the placeholder host should be replaced or kept.**
   - **Replace**: change the manifest pattern, `DOMAIN_REGISTRY`, and
     `web_accessible_resources` to the real domain. Cleanest if you're
     committed to one auctions provider.
   - **Add alongside**: split into `auctions_<provider>` per the recipe.
     Reuse the same schema/normalizer/table by routing the new
     `domain_id` to `auctions` in the normalizer dispatch (or keep them
     separate if the providers have meaningfully different fields).

2. **Rewrite the parser**, keeping the message shape and field names
   identical. Most sites won't use `.lot-card` — that selector was
   illustrative. Likely sources:
   - Static server-rendered HTML (most public auction sites).
   - Hydration blob (`__NEXT_DATA__` or similar) — prefer if available;
     mirror the OLX approach (see [`domain-olx.md`](domain-olx.md)).
   - XHR responses (uncommon).

3. **Check the normalizer** against real bid strings and date formats from
   the target site. Add formats to the `_to_iso` loop if the site uses
   something not in the three currently handled patterns.

4. **Consider `allFrames`.** The current value is `true` because auction
   sites historically used iframes. Switch to `false` if the real site
   doesn't.

5. **Don't break OLX/LinkedIn.** Changing the auctions table shape requires
   a new Liquibase changeset (never edit applied ones); the schema and
   normalizer changes are isolated to this module.

### Verification

Use the full checklist from
[`add-domain-module.md`](add-domain-module.md#verification-checklist).
Additionally: confirm `auction_end` is consistently parsed by the normalizer
(the index on `auction_end` is the read-path's main affordance — bad parsing
silently degrades to NULLs and the index becomes useless).

---

## Why this module exists at all

It was scaffolded early as a third domain to prove the multi-domain
architecture (per-domain parser, schema, normalizer, table) — the original
prompt in `agents/claude-code-prompt.md` named LinkedIn, OLX, and Leilões as
the seed domains. OLX matured into the gold reference; LinkedIn stayed a
stub; auctions stayed conceptual. The shape is sound and a real auctions
integration should be cheap relative to the OLX work.
