# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & runtime model

Everything except the Chrome extension itself runs in **Docker Compose**. There is intentionally no local Python/Postgres/Liquibase install required. Three services in `docker-compose.yml`:

- `db` — `postgres:16-alpine`, exposes 5432, healthchecked. Data lives on a host bind mount at `./data/pgdata` (ignored by git).
- `api` — built from `./api/Dockerfile` (FastAPI + Pydantic v2 + psycopg3 + uvicorn). Mounts `./api` for hot-reload via `--reload`. Depends on `db` healthy.
- `liquibase` — `liquibase/liquibase:4.27`. Run on-demand via `docker compose run --rm liquibase <cmd>`. Mounts `./db/changelog` as `/liquibase/changelog`. Connection env baked in via `LIQUIBASE_COMMAND_*`.

The Chrome extension is loaded manually in `chrome://extensions → Load unpacked → ./extension`. It talks to `http://localhost:8000` by default, but the URL is **configurable per-user** via the options page (see "MV3 specifics").

## Common commands

```bash
cp .env.example .env                            # one-time
docker compose up -d db                         # bring up DB
docker compose run --rm liquibase update        # apply migrations
docker compose run --rm liquibase rollback-count 1   # revert last changeset
./scripts/tag_release.sh v1                     # tag DB state
docker compose up -d api                        # start API at :8000
docker compose run --rm api pytest              # run all tests
docker compose run --rm api pytest tests/test_ingest_dynamic.py::test_olx_house_payload_full_normalization  # single test
docker compose exec db psql -U app scraper_dev  # psql shell
docker compose down -v                          # stop containers (preserves ./data/pgdata bind mount)
```

There's also a **Make pipeline** that mirrors the extension end-to-end without Chrome — see "Make pipeline" below. API docs at `http://localhost:8000/docs`.

## Architecture: how the three layers talk

**Frontend → Backend**: `extension/background.js` (MV3 service worker — ephemeral) registers per-domain parsers via `chrome.scripting.registerContentScripts` on `onInstalled`/`onStartup`, plus a `chrome.webNavigation.onHistoryStateUpdated` listener that **re-injects the parser on SPA pushState** (OLX paginates via `&o=2` without full document load). Each parser in `extension/parsers/<domain>_parser.js` is a **static file** (MV3 forbids string-eval). The parser builds an `items` array and sends `{type: "DOM_COUNT", domain, count, items}` via `chrome.runtime.sendMessage`. `background.js` then:
1. Calls `chrome.action.setBadgeText({text, tabId: sender.tab.id})` — **always tabId-scoped** to avoid badge pollution. Empty string when count is 0.
2. Stashes the payload in `chrome.storage.session` keyed by `tab:<tabId>` so the popup can read it.

The popup (`popup.js`) reads `chrome.storage.session` for the active tab, renders a preview of up to 8 items in a terminal-style UI, and POSTs `{domain_id, raw_data: {items}}` to `${apiUrl}/api/v1/ingest` (apiUrl from `chrome.storage.sync`, default `http://localhost:8000`).

**Backend dynamic validation pipeline** (`api/app/routers/ingest.py`):
1. `schema_registry.get_schema(domain_id)` loads JSON Schema from `api/app/schemas/<domain_id>.json` (LRU cached).
2. `dynamic_validator.build_item_model(domain_id, schema)` walks `schema['properties']` and calls `pydantic.create_model(...)` to build a Pydantic class **at runtime**. The result is cached by SHA1 of the JSON repr so equivalent schemas reuse the same class.
3. Each item is validated; failures collect into an `errors` list. Returns 422 if *all* fail, 200 with partial errors otherwise.
4. Pure-function normalizers in `api/app/normalization/<domain>.py` transform validated dicts (e.g. OLX `"R$ 25.000,00"` → `price_cents: 2500000`; epoch seconds → ISO-8601; "5 ou mais" → `5`).
5. `app/core/persistence.py` opens a sync `psycopg` connection per request, INSERTs a `scrape_sessions` row, then **UPSERTs** per-domain rows via `ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET …` — dedup is per-domain, partial unique index allows items without `external_id` to coexist. **Graceful degradation**: if `DATABASE_URL` is unreachable or migrations haven't run, the response still returns 200 with `persisted: false` and a `skipped_reason`.
6. `GET /api/v1/sessions` + `GET /api/v1/sessions/{id}` expose the persisted data over HTTP.

**Adding a new domain** requires five files in lockstep:
- `extension/parsers/<domain>_parser.js` — extraction logic (DOM or `__NEXT_DATA__`).
- `extension/background.js → DOMAIN_REGISTRY` — registers the parser for the URL pattern.
- `api/app/schemas/<domain>.json` — JSON Schema (drives the dynamic Pydantic model). Include `external_id` as an optional string for dedup.
- `api/app/normalization/<domain>.py` — pure normalizer; register it in `routers/ingest.py:NORMALIZERS`.
- `db/changelog/modules/<domain>.sql` — Liquibase Formatted SQL changesets (table + a follow-up `<domain>-NNN-external-id` that adds the column + partial unique index). Include in `db/changelog/master.xml`. Wire INSERT/UPSERT in `core/persistence.py:_insert_items`.

## OLX specifics

The OLX parser **does not query the rendered DOM**. It reads `<script id="__NEXT_DATA__">` (Next.js hydration blob), uses **only** `props.pageProps.ads`, and filters `categoryName === "Casas"`. This is dramatically more stable than CSS selectors and gives access to richer fields (`origListTime` epoch, `properties[]` array with rooms/bathrooms/garage/size/iptu, structured `locationDetails`). Fixture for development: `tmp/next_data.js` (untracked) — a captured `__NEXT_DATA__` blob from a real page.

OLX is behind Cloudflare; plain `curl` returns a CAPTCHA page. Use the curl-impersonate Docker image (TLS fingerprint of Chrome 110) — the Makefile already wires this.

## Make pipeline (mirrors the extension)

`Makefile` at repo root drives the same flow as the extension, headlessly, via container tooling:

```
make fetch    → tmp/olx_live.html         (curl-impersonate via Docker bypasses Cloudflare)
make raw      → tmp/olx_next_data.json    (extracts the __NEXT_DATA__ JSON only)
make extract  → tmp/olx_payload.json      (50 houses, same shape the popup POSTs)
make ingest   → POSTs to /api/v1/ingest, formats response
make run      → chains fetch → extract → ingest
make sessions → GET /api/v1/sessions  (last 10)
make session-<N> → GET /api/v1/sessions/<N>  (detail with items)
```

`scripts/extract_olx.py` **mirrors `extension/parsers/olx_parser.js` line-by-line**: same path (`props.pageProps.ads`), same field mapping, same `isHouse` filter. Keep them in sync when changing parser logic. `scripts/dump_next_data.py` is the smaller utility that just yanks the JSON out of the HTML.

`URL=…` env var overrides the default search; `API=…` overrides `http://localhost:8000`.

## Database conventions

Migrations are **Liquibase Formatted SQL** (`db/changelog/modules/*.sql`) orchestrated by `db/changelog/master.xml`. The master remains XML because Formatted SQL has no native `--include`. Every changeset must include:
- `--preconditions onFail:HALT onError:HALT` + a `--precondition-sql-check` (typically `expectedResult:0 SELECT count(*) FROM information_schema.{tables|columns} WHERE …`).
- `--rollback` lines that fully undo the changeset.

For `external_id` dedup, the pattern is a **partial unique index**: `CREATE UNIQUE INDEX uq_<table>_external_id ON <table>(external_id) WHERE external_id IS NOT NULL;`. The persistence layer leverages this in `ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE`.

Postgres-only: types are hardcoded (`BIGSERIAL`, `JSONB`, `TIMESTAMPTZ`) since the XML `<property>` substitution layer was dropped during the SQL conversion (`refactor(db): converte changelogs liquibase de xml para sql`).

## MV3 specifics

- Service worker is **ephemeral** — never assume in-memory state survives. Use `chrome.storage.session` for cross-event data, `chrome.storage.sync` for user prefs (API URL).
- **No string-eval**: parsers must be static `.js` files referenced by path. `web_accessible_resources` in `manifest.json` declares each parser with a per-domain `matches` array.
- `host_permissions` is **empty** by design. `optional_host_permissions` declares `http://*/*` and `https://*/*`, and the options page (`extension/options.{html,js,css}`) requests the specific origin via `chrome.permissions.request({origins: [...]})` when the user saves a custom API URL.
- `webNavigation` permission powers the SPA re-injection in `background.js` — without it, OLX pagination via pushState wouldn't trigger the parser.

## Commit workflow

Skill at `.claude/skills/commit/SKILL.md` produces single-line Conventional Commits (`<type>(<scope>): <subject>`, **hard cap 75 chars**, lowercase subject, no period). Scopes in use: `ext`, `api`, `db`, `olx`, `infra`, `skill`, `ci`. The skill also updates `epic/todo.md` checkboxes when a changed file maps to a tracked story. A `PostToolUse` hook in `.claude/settings.json` reminds to run `/commit` whenever the working tree has uncommitted changes after Edit/Write/MultiEdit.

`epic/todo.md` is the canonical task tracker (Epics ↔ Stories mirror the original spec in `agents/claude-code-prompt.md`).

## CI

`.github/workflows/build-extension.yml` builds `.crx` (signed if the repo has a `CRX_PRIVATE_KEY` secret; ephemeral key otherwise) + `.zip` (Web Store upload) on push to `main`, on `v*` tags, and on `workflow_dispatch`. Tagged builds get attached to a GitHub Release automatically.

## What is intentionally **not** here

- Auth on `/api/v1/ingest` (anyone with the URL can POST).
- Real extension icons (`extension/icons/*.png` are 1×1 red placeholders).
- Connection pooling — `psycopg.connect()` per request. Fine at single-user dev scale; introduce `psycopg_pool` if throughput becomes a concern.
- The `dyntamic` library — `pydantic.create_model` with a small hand-rolled type resolver is sufficient at current scale. Consider `dyntamic` or build-time codegen (`datamodel-code-generator`) only if schema count explodes.
- IBM Plex fonts — the popup design (`extension/design/`, gitignored) uses IBM Plex Sans, but the shipped popup falls back to `ui-monospace` to keep the extension bundle lean.
