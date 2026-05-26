# Recipe — add a new domain module

**What this is.** A reusable contract for adding a new domain to the scraper.
Written as a brief you can paste into a fresh Claude Code session along with a
domain-specific input list.

**When to use it.** Any time a new site/domain needs scraping. The recipe is
designed so that the same five files (per backend, six counting the SQLite
parallel) get touched in a predictable order.

Read [`architecture.md`](architecture.md) first — that doc establishes
*invariants*; this one is *the steps*.

---

## Inputs the requester must provide

Before starting the work, the requester (you or a user) must commit to four
inputs. Without these, the rest of the recipe stalls.

1. **`domain_id`** — short, lowercase, kebab-case. This string is the key used
   in `manifest.json`, `DOMAIN_REGISTRY`, schema filename, normalizer module,
   `NORMALIZERS` dict, `_insert_items` dispatch, and the
   `scrape_sessions.domain_name` column. Once committed, renaming is painful.
2. **URL pattern** — host glob in MV3 form (e.g., `*://*.example.com/*`).
   This goes into both `manifest.json` `host_permissions` /
   `web_accessible_resources` and `DOMAIN_REGISTRY.matches`.
3. **Data source** — pick **one**:
   - **`__NEXT_DATA__` / hydration blob.** Preferred when available. Use OLX
     as the gold reference (`extension/parsers/olx_parser.js`). Robust against
     class-name rotation. Add a `MutationObserver` on the script element.
   - **DOM selectors.** Fragile but sometimes the only option (LinkedIn).
     Document the selectors you keyed off, in a header comment, so future
     rotation is debuggable.
   - **XHR / API interception.** Rare; only if the page exposes a clean
     internal API. No current example.
4. **Field list** — the canonical mapping from raw fields (whatever the parser
   pulls) to normalized fields (what the DB column expects). Include type
   conversions: e.g. `price_raw: "R$ 2.250.000"` → `price: NUMERIC(12,2)`.
   This list is the single source of consistency across the JSON Schema, the
   normalizer, and the table DDL.

---

## The five (six) files in lockstep

All paths are relative to repo root. The order below is the suggested writing
order — schema first anchors the field contract, then everything else falls
out of it.

### 1. `api/app/schemas/<domain_id>.json`

JSON Schema, draft 2020-12.

Template:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "<DomainId>Item",
  "type": "object",
  "required": ["title", "url"],
  "properties": {
    "external_id": { "type": "string", "description": "Stable per-listing ID for dedup" },
    "title":       { "type": "string" },
    "url":         { "type": "string" }
  }
}
```

Conventions:

- Always include **`external_id`** as an optional string. The partial unique
  index on the matching column makes dedup work; items without `external_id`
  coexist.
- Keep `required` minimal — only the fields without which the normalizer
  cannot produce a meaningful row.
- Use `enum` where domain knowledge constrains values (e.g. OLX `kind` →
  `["venda", "aluguel"]`).
- Field names ending in `_raw` are convention for "string as captured, before
  normalization." The normalizer reads `<x>_raw` and emits `<x>`.

Reference: `api/app/schemas/olx.json`.

### 2. `extension/parsers/<domain_id>_parser.js`

IIFE that posts `{type: "DOM_COUNT", domain: "<domain_id>", count, items}`.
**No string-eval, no inline imports** — the file must be standalone and runs
inside a content script context.

Two valid shapes:

**Shape A — hydration blob (preferred).**

```js
(function () {
  runOnce();
  const script = document.getElementById("__NEXT_DATA__");
  if (script) {
    new MutationObserver(runOnce).observe(script, {
      childList: true, characterData: true, subtree: true,
    });
  }

  function runOnce() {
    const data = readBlob();
    if (!data) return send(0, [], "blob missing");
    const records = getPath(data, "props.pageProps.ads"); // adjust per site
    if (!Array.isArray(records)) return send(0, [], "records not array");
    const items = records.map(toItem).filter(Boolean);
    send(items.length, items);
  }

  function send(count, items, debug) {
    const msg = { type: "DOM_COUNT", domain: "<domain_id>", count, items };
    if (debug) msg.debug = debug;
    chrome.runtime.sendMessage(msg);
  }

  function toItem(raw) { /* map raw → schema-shaped item */ }
  function readBlob() { /* JSON.parse a script tag */ }
  function getPath(o, p) { return p.split(".").reduce((a, k) => a?.[k], o); }
})();
```

**Shape B — DOM selectors.**

```js
(function () {
  const cards = document.querySelectorAll("<selector>");
  const items = Array.from(cards).map((el) => ({
    external_id: el.getAttribute("data-id") || null,
    title: el.querySelector(".title")?.textContent?.trim() || null,
    url:   el.querySelector("a[href]")?.href || null,
  })).filter((x) => x.title);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain: "<domain_id>",
    count: items.length,
    items,
  });
})();
```

References:
- Hydration-blob: `extension/parsers/olx_parser.js`.
- DOM: `extension/parsers/linkedin_parser.js` (stub).

### 3. `extension/manifest.json`

Add the host to **`host_permissions`** (mandatory — see invariant in
`architecture.md`) and to **`web_accessible_resources`** with a per-domain
`matches` array.

Diff template:

```json
"host_permissions": [
  …,
  "*://*.<domain>/*"
],
…,
"web_accessible_resources": [
  …,
  {
    "resources": ["parsers/<domain_id>_parser.js"],
    "matches": ["*://*.<domain>/*"]
  }
]
```

Bump `"version"` after wiring the new module end-to-end (the popup header
reads it dynamically — see `extension/popup.js:25`).

### 4. `extension/background.js` → `DOMAIN_REGISTRY`

Add an entry to the array at `extension/background.js:4`:

```js
{
  id: "<domain_id>",
  js: ["parsers/<domain_id>_parser.js"],
  matches: ["*://*.<domain>/*"],
  allFrames: false,
  runAt: "document_idle",
},
```

`allFrames: true` only if the data lives in an iframe (auctions placeholder
uses this — see `extension/background.js:24`). `runAt: "document_idle"` is
the safe default; flip to `"document_end"` only if the data is fully
hydrated earlier.

### 5. `api/app/normalization/<domain_id>.py`

Pure function `normalize(items: list[dict]) -> list[dict]`. No I/O. Each
output dict must match the column list the persistence layer writes.

Template:

```python
from __future__ import annotations

def normalize(items: list[dict]) -> list[dict]:
    return [
        {
            "external_id": it.get("external_id"),
            "title": (it.get("title") or "").strip(),
            "url": it.get("url"),
            # raw → typed conversions here
        }
        for it in items
    ]
```

Register in `api/app/routers/ingest.py:18`:

```python
from app.normalization import <domain_id> as norm_<domain_id>

NORMALIZERS = {
    …,
    "<domain_id>": norm_<domain_id>.normalize,
}
```

Reference: `api/app/normalization/olx.py` (price → float, pt-BR date →
ISO-8601, `"3 quartos"` → `3`).

### 6. Liquibase changesets — `db/changelog/modules/<domain_id>.sql` **and** `db/changelog-sqlite/modules/<domain_id>.sql`

Liquibase Formatted SQL. Same changeset IDs in both trees. Two changesets at
minimum: the table, then a follow-up `<domain_id>-NNN-external-id` adding the
column + the partial unique index.

**Postgres template** (`db/changelog/modules/<domain_id>.sql`):

```sql
--liquibase formatted sql

--changeset claude:<domain_id>-001-table
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='<domain_id>_<entity>'
CREATE TABLE <domain_id>_<entity> (
    id         BIGSERIAL    PRIMARY KEY,
    session_id BIGINT       NOT NULL REFERENCES scrape_sessions(id),
    title      VARCHAR(512) NOT NULL,
    url        VARCHAR(1024) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
--rollback DROP TABLE IF EXISTS <domain_id>_<entity>;


--changeset claude:<domain_id>-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='<domain_id>_<entity>' AND column_name='external_id'
ALTER TABLE <domain_id>_<entity> ADD COLUMN external_id VARCHAR(64);
CREATE UNIQUE INDEX uq_<domain_id>_<entity>_external_id ON <domain_id>_<entity>(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_<domain_id>_<entity>_external_id;
--rollback ALTER TABLE <domain_id>_<entity> DROP COLUMN IF EXISTS external_id;
```

**SQLite template** (`db/changelog-sqlite/modules/<domain_id>.sql`):

```sql
--liquibase formatted sql

--changeset claude:<domain_id>-001-table
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='<domain_id>_<entity>'
CREATE TABLE <domain_id>_<entity> (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES scrape_sessions(id),
    title      TEXT    NOT NULL,
    url        TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--rollback DROP TABLE IF EXISTS <domain_id>_<entity>;


--changeset claude:<domain_id>-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('<domain_id>_<entity>') WHERE name='external_id'
ALTER TABLE <domain_id>_<entity> ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_<domain_id>_<entity>_external_id ON <domain_id>_<entity>(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_<domain_id>_<entity>_external_id;
--rollback ALTER TABLE <domain_id>_<entity> DROP COLUMN IF EXISTS external_id;
```

Then `<include>` each file in the respective `master.xml`:
- `db/changelog/master.xml`
- `db/changelog-sqlite/master.xml`

### 7. `api/app/core/persistence.py` → `_insert_items`

Add an `elif` branch in `_insert_items` at `api/app/core/persistence.py:47`:

```python
elif domain_id == "<domain_id>":
    on_conflict = db.upsert_conflict_clause("external_id")
    cur.executemany(
        db.q(
            "INSERT INTO <domain_id>_<entity> "
            "(session_id, external_id, title, url) "
            "VALUES (?,?,?,?) "
            f"{on_conflict} "
            "  session_id=EXCLUDED.session_id, title=EXCLUDED.title, url=EXCLUDED.url"
        ),
        [(session_id, it.get("external_id"), it["title"], it["url"]) for it in items],
    )
```

Also add the table to the `table_map` in `fetch_session_items` at
`api/app/core/persistence.py:152` so `GET /api/v1/sessions/{id}` can read it
back:

```python
table_map = {
    …,
    "<domain_id>": "<domain_id>_<entity>",
}
```

---

## Type mapping table — Postgres ↔ SQLite

| Postgres                          | SQLite                              | Notes                                  |
|-----------------------------------|-------------------------------------|----------------------------------------|
| `BIGSERIAL PRIMARY KEY`           | `INTEGER PRIMARY KEY AUTOINCREMENT` | Auto-id                                |
| `BIGINT`                          | `INTEGER`                           |                                        |
| `VARCHAR(n)`                      | `TEXT`                              | Length hint lost on SQLite             |
| `JSONB`                           | `TEXT`                              | Store as JSON string                   |
| `TIMESTAMPTZ`                     | `TEXT`                              | ISO-8601 strings                       |
| `NUMERIC(p,s)`                    | `NUMERIC`                           | SQLite is dynamic; precision advisory  |
| `DEFAULT NOW()`                   | `DEFAULT CURRENT_TIMESTAMP`         |                                        |
| Multiple `ADD COLUMN` per ALTER   | One `ADD COLUMN` per `ALTER TABLE`  | Split into N statements on SQLite      |

Precondition idioms also differ:

- Postgres: `information_schema.tables` / `information_schema.columns`.
- SQLite: `sqlite_master` for table existence, `pragma_table_info('<t>')` for
  column existence.

`db.upsert_conflict_clause("external_id")` returns the right form per backend
— don't hand-write the `ON CONFLICT` clause; both backends require the
`WHERE external_id IS NOT NULL` predicate to match the partial index.

---

## Verification checklist

Run all of these before declaring the module done.

1. **Tests pass on the active backend.**
   ```bash
   docker compose run --rm api pytest
   ```
2. **Migrations apply on both backends.**
   ```bash
   docker compose --profile postgres run --rm liquibase update
   docker compose --profile sqlite  run --rm liquibase-sqlite update
   ```
3. **Round-trip on both backends.** With the API up on each backend in turn,
   POST a sample payload to `/api/v1/ingest` and verify `persisted: true`.
4. **Extension end-to-end.** Load the unpacked extension, navigate to a real
   URL matching the new pattern, confirm:
   - Badge updates with the item count (and clears when 0).
   - Popup preview shows the items.
   - Manual "Enviar para API" returns success.
   - With auto-send enabled, the second navigation does NOT double-POST
     (dedup hash works).
5. **Read-back works.** `GET /api/v1/sessions/{id}` returns the persisted rows
   with the new table columns populated.
6. **Granular commits.** Schema + parser + normalizer + Liquibase + persistence
   are likely interdependent for a single test to pass — commit them as one
   group, the earliest moment everything is consistent. Don't accumulate.

---

## Common mistakes to avoid

- **Forgetting `host_permissions`.** `optional_host_permissions: ["*://*/*"]`
  alone is *not enough* — `chrome.scripting.executeScript` in the SPA
  re-inject path requires the host at call time.
- **Diverging Liquibase trees.** Same changeset ID in both trees, same
  semantic change. The shim in `api/app/core/db.py` assumes parity.
- **Hand-writing `ON CONFLICT`.** Always go through
  `db.upsert_conflict_clause("external_id")` — Postgres needs the predicate
  repeated; SQLite accepts the same form. Mismatched form yields an obscure
  "ON CONFLICT clause does not match …" error on SQLite.
- **Raising from `persist`.** When the DB is unreachable, return
  `(None, reason)` and let the HTTP layer respond 200 with `persisted: false`.
- **Class-name dependency without a comment.** DOM-based parsers must
  document the exact selectors keyed off, in a header comment, so the next
  person debugging a rotation knows where to look.
