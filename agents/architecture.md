# Architecture spec

**What this is.** A stable reference describing the three layers of the system,
how data flows through them, and which invariants must not be broken.

**When to use it.** Open a new module's work with this doc in context, so the
session has the system's shape before touching any domain-specific files.

For day-to-day orientation, `CLAUDE.md` at the repo root remains authoritative.
This doc reorganizes the same material as a stable spec rather than a living
README.

---

## Three layers

### 1. Chrome Extension (MV3) — `extension/`

- **Service worker** (`background.js`) is **ephemeral**. Never assume in-memory
  state survives between events. Cross-event state lives in
  `chrome.storage.session`; user preferences live in `chrome.storage.sync`.
- **No string-eval.** All parsers are static `.js` files referenced by path;
  injection goes through `chrome.scripting.registerContentScripts` (declarative
  registration on `onInstalled`/`onStartup`) and
  `chrome.scripting.executeScript` (imperative re-injection on SPA navigation).
- **`DOMAIN_REGISTRY`** in `extension/background.js:4` is the source of truth
  for which domain maps to which parser file and host glob.
- **`host_permissions`** in `extension/manifest.json` lists the parser domains.
  These are **mandatory** even though `optional_host_permissions` declares
  `*://*/*` — `chrome.scripting.executeScript` (used in the SPA re-inject path)
  requires actual host permission at call time.
  `optional_host_permissions` stays reserved for the user-configurable API URL,
  requested at runtime in the options page.
- **`webNavigation` permission** powers SPA re-injection in
  `extension/background.js:60` (`onHistoryStateUpdated`). Without it, paginated
  SPAs (e.g. OLX `&o=2`) would not trigger the parser after the initial load.

### 2. API — `api/`

- **FastAPI + Pydantic v2 + uvicorn**, Python 3.11, dependencies in
  `api/requirements.txt`.
- **`POST /api/v1/ingest`** is the single ingress for extension payloads
  (`api/app/routers/ingest.py:74`). Shared validate-normalize-persist pipeline
  lives in `process_items` at `api/app/routers/ingest.py:35`.
- **Dynamic Pydantic models.** Per-domain JSON Schemas at
  `api/app/schemas/<domain>.json` drive `pydantic.create_model(...)` at runtime
  via `app/core/dynamic_validator.py`. Models are cached by SHA1 of their JSON
  repr — equivalent schemas reuse the same class.
- **Schema registry** at `api/app/core/schema_registry.py` LRU-caches schema
  file reads and exposes `get_schema(domain_id)` + `list_domains()`.
- **Per-domain normalizers** are pure functions: `normalize(items) -> items`,
  registered in `NORMALIZERS` at `api/app/routers/ingest.py:18`.
- **Persistence** is sync, one connection per request, dialect-aware via the
  shim at `api/app/core/db.py`. The entry point is `persist` at
  `api/app/core/persistence.py:19`. Per-domain INSERT/UPSERT is dispatched in
  `_insert_items` at `api/app/core/persistence.py:47`.
- **Auxiliary endpoints**: `GET /api/v1/domains`, `GET /api/v1/sessions`,
  `GET /api/v1/sessions/{id}` (read-back), plus `/api/v1/scrape` for the
  server-side OLX fetch path.
- **API version** is read at startup from `api/pyproject.toml` (`tomllib`) so
  `[project].version` is the single source of truth. See
  `api/app/main.py:1-12`.

### 3. Database — Liquibase + dual backend

- **Backend choice** is decided at API process start from the `DATABASE_URL`
  scheme: `postgresql://…` → psycopg3; `sqlite:///…` or a bare path →
  stdlib `sqlite3`. The dialect shim lives at `api/app/core/db.py`.
- **Two parallel Liquibase trees** that must stay in lockstep:
  - `db/changelog/` — Postgres flavor (BIGSERIAL, JSONB, TIMESTAMPTZ,
    `information_schema` preconditions).
  - `db/changelog-sqlite/` — SQLite flavor (INTEGER PK AUTOINCREMENT, TEXT,
    `sqlite_master` / `pragma_table_info` preconditions).
  Same changeset IDs across trees. When adding/altering a column, edit **both**
  files in the same commit.
- **Liquibase Formatted SQL** (not XML changesets). Master orchestration
  remains XML because Formatted SQL has no native `--include`.
- **Custom Liquibase image** for SQLite at `db/Dockerfile.liquibase-sqlite`
  bundles xerial `sqlite-jdbc` 3.41.2.2 (pinned — newer jars introduce a hard
  `slf4j-api` runtime dep that the official Liquibase image doesn't ship).
- **Compose profiles**: `postgres` (db + liquibase + api), `sqlite`
  (liquibase-sqlite + api). The `api` service has no profile and is always
  available.

---

## End-to-end data flow

```
                                       chrome.runtime.sendMessage
[page] ── parser ──────────────────────────────────────────────┐
                                                               ▼
                                      ┌────────────────────────────────────┐
                                      │ extension/background.js (SW)        │
                                      │  - setBadge (tabId-scoped)         │
                                      │  - chrome.storage.session["tab:N"] │
                                      │  - autoSendIfEnabled → POST        │
                                      └────────────────────────────────────┘
                                                               │
                                                  manual send  │  auto-send
                                                  via popup    │  (background)
                                                               ▼
                                      ┌────────────────────────────────────┐
                                      │  POST /api/v1/ingest               │
                                      │  - process_items                    │
                                      │    1. get_schema(domain_id)         │
                                      │    2. build_item_model (dynamic)    │
                                      │    3. Pydantic validate per item    │
                                      │    4. NORMALIZERS[domain_id](xs)   │
                                      │    5. persistence.persist(...)      │
                                      └────────────────────────────────────┘
                                                               │
                                                               ▼
                                      ┌────────────────────────────────────┐
                                      │ db.connect()  (Postgres OR SQLite)  │
                                      │  - INSERT scrape_sessions           │
                                      │  - executemany INSERT … ON CONFLICT │
                                      │    (external_id) DO UPDATE …        │
                                      └────────────────────────────────────┘
```

Key file:line anchors:

- Parser → SW message: `chrome.runtime.sendMessage({type:"DOM_COUNT", domain, count, items})` (see `extension/parsers/olx_parser.js:65`).
- Badge dispatch: `setBadge` at `extension/background.js:75`.
- Auto-send with per-tab dedup hash: `autoSendIfEnabled` at `extension/background.js:95`.
- Ingest pipeline: `process_items` at `api/app/routers/ingest.py:35`.
- Persistence entry: `persist` at `api/app/core/persistence.py:19`.
- Per-domain SQL dispatch: `_insert_items` at `api/app/core/persistence.py:47`.

---

## Invariants

Break these and downstream things will fail in non-obvious ways.

1. **No string-eval anywhere in the extension.** Parsers must be static files
   declared in `manifest.json` `web_accessible_resources` and registered via
   `chrome.scripting.registerContentScripts`. MV3 enforces this; the project
   does too.
2. **Badge is always `tabId`-scoped.** Calling `setBadgeText({text})` without
   `tabId` pollutes every tab. See `extension/background.js:75`. Empty string
   on count 0.
3. **Liquibase trees stay in lockstep.** Adding a column in `db/changelog/`
   without the parallel change in `db/changelog-sqlite/` (or vice versa)
   silently diverges the two backends.
4. **`external_id` partial unique index pattern.** Per-domain tables that
   support dedup use:
   `CREATE UNIQUE INDEX uq_<table>_external_id ON <table>(external_id) WHERE external_id IS NOT NULL;`
   The persistence layer's upsert (`db.upsert_conflict_clause("external_id")`)
   repeats the `WHERE external_id IS NOT NULL` predicate in the conflict target
   — both backends reject the upsert otherwise.
5. **Persistence returns `(None, reason)` on DB unavailability.** Never raise
   from `persist` when the DB is unreachable or migrations haven't run — the
   HTTP layer must still return 200 with `persisted: false` so the extension
   can fail gracefully. See `api/app/core/persistence.py:19`.
6. **Dynamic validation tolerates partial failures.** `process_items` collects
   errors and returns 200 if at least one item validated; 422 only when *all*
   items fail. The extension expects this shape (`errors` is an array,
   `validated` is the count).
7. **One commit per logical change.** See `CLAUDE.md` "Commit workflow" and
   `.claude/skills/commit/SKILL.md`. Don't accumulate cross-cutting changes
   into a single end-of-session commit.

---

## Intentionally out of scope

(Mirrors the closing section of `CLAUDE.md`. Listed here so a future session
doesn't introduce these on a whim.)

- **No auth on `/api/v1/ingest`.** Anyone with the URL can POST. Adding auth
  is a deliberate epic-sized change.
- **No connection pooling.** `db.connect()` opens one connection per request
  on both backends. Fine at single-user dev scale; consider `psycopg_pool`
  or a SQLite write-serializer if throughput becomes a concern.
- **No `dyntamic` library.** `pydantic.create_model` + the small in-house
  type resolver in `app/core/dynamic_validator.py` is sufficient at current
  scale.
- **No real extension icons.** `extension/icons/*.png` are 1×1 placeholders.
- **No IBM Plex fonts in the shipped popup.** The design source uses Plex
  Sans (gitignored under `extension/design/`); the shipped popup falls back
  to `ui-monospace` to keep the bundle lean.
