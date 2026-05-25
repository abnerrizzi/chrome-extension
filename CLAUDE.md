# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & runtime model

Everything except the Chrome extension itself runs in **Docker Compose**. There is intentionally no local Python/Postgres/Liquibase install required. Three services in `docker-compose.yml`:

- `db` — `postgres:16-alpine`, exposes 5432 on host, healthchecked.
- `api` — built from `./api/Dockerfile` (FastAPI + Pydantic v2 + uvicorn). Mounts `./api` for hot-reload via `--reload`. Depends on `db` healthy.
- `liquibase` — `liquibase/liquibase:4.27`. Run on-demand via `docker compose run --rm liquibase <cmd>`. Mounts `./db/changelog` as `/liquibase/changelog`. Connection env vars are baked in via `LIQUIBASE_COMMAND_*`.

The Chrome extension is loaded manually in `chrome://extensions → Load unpacked → ./extension` and talks to `http://localhost:8000` (the host-exposed API port).

## Common commands

```bash
cp .env.example .env                            # one-time
docker compose up -d db                         # bring up DB
docker compose run --rm liquibase update        # apply migrations
docker compose run --rm liquibase rollback-count 1   # revert last changeset
./scripts/tag_release.sh v1                     # tag DB state
docker compose up -d api                        # start API at :8000
docker compose run --rm api pytest              # run all tests
docker compose run --rm api pytest tests/test_ingest_dynamic.py::test_olx_price_normalized_to_cents  # single test
docker compose exec db psql -U app scraper_dev  # psql shell
docker compose down -v                          # nuke including pgdata volume
```

API docs available at `http://localhost:8000/docs` once `api` is up. No build step for the extension — `chrome://extensions` reloads from disk.

## Architecture: how the three layers talk

**Frontend → Backend**: The extension's `background.js` (MV3 service worker — ephemeral, no persistent state) registers per-domain parsers via `chrome.scripting.registerContentScripts` on `onInstalled`/`onStartup`. Each parser in `extension/parsers/<domain>_parser.js` is a **static file** (MV3 forbids string-eval). When a page loads, the parser queries the DOM, builds an `items` array, and sends `{type: "DOM_COUNT", domain, count, items}` via `chrome.runtime.sendMessage`. `background.js` then:
1. Calls `chrome.action.setBadgeText({text, tabId: sender.tab.id})` — **always tabId-scoped** to avoid badge pollution across tabs. Empty string when count is 0.
2. Stashes the payload in `chrome.storage.session` keyed by `tab:<tabId>` so the popup can read it.

The popup (`popup.js`) reads `chrome.storage.session` for the active tab, lets the user click "Enviar para API", and POSTs `{domain_id, raw_data: {items}}` to `http://localhost:8000/api/v1/ingest`.

**Backend dynamic validation pipeline** (`api/app/routers/ingest.py`):
1. `schema_registry.get_schema(domain_id)` loads JSON Schema from `api/app/schemas/<domain_id>.json` (LRU cached).
2. `dynamic_validator.build_item_model(domain_id, schema)` walks `schema['properties']` and calls `pydantic.create_model(...)` to build a Pydantic class **at runtime**. The result is cached by SHA1 of the JSON repr so equivalent schemas reuse the same class.
3. Each item in `raw_data.items` is validated; failures collect into an `errors` list. Returns 422 if *all* fail, otherwise 200 with partial errors surfaced.
4. Domain-specific pure-function normalizers in `api/app/normalization/<domain>.py` transform validated dicts (e.g. OLX `"R$ 25.000,00"` → `price_cents: 2500000`; auctions `dd/mm/yyyy` → ISO-8601).
5. `app/core/persistence.py` opens a sync `psycopg` connection per request, INSERTs a `scrape_sessions` row, then bulk-inserts the per-domain rows. **Graceful degradation**: if `DATABASE_URL` is unreachable or migrations haven't been applied, the response still returns 200 with `persisted: false` and a `skipped_reason` explaining why — no crash. The extension can therefore work standalone (validation only) even without Postgres.
6. `GET /api/v1/sessions` and `GET /api/v1/sessions/{id}` let you peek at persisted data without psql.

**Adding a new domain** requires four files in lockstep:
- `extension/parsers/<domain>_parser.js` — DOM extraction logic.
- `extension/background.js` `DOMAIN_REGISTRY` — registers the parser for the URL pattern.
- `api/app/schemas/<domain>.json` — JSON Schema (drives the dynamic Pydantic model).
- `api/app/normalization/<domain>.py` — pure normalizer; register it in `routers/ingest.py:NORMALIZERS`.
- `db/changelog/modules/<domain>.sql` — Liquibase formatted SQL changeset; include it in `db/changelog/master.xml`.

## Database conventions

Migrations are **Liquibase Formatted SQL** files (`db/changelog/modules/*.sql`) orchestrated by `db/changelog/master.xml`. The master remains XML because Liquibase Formatted SQL has no native `--include` directive. Every changeset must include:
- `--preconditions onFail:HALT onError:HALT` + checks (typically `--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_name='X'`).
- `--rollback` lines that fully undo the changeset (`DROP INDEX IF EXISTS …; DROP TABLE IF EXISTS …;`).

Postgres-only: types are hardcoded (`BIGSERIAL`, `JSONB`, `TIMESTAMPTZ`) since the XML `<property>` substitution layer was dropped during the SQL conversion (`refactor(db): converte changelogs liquibase de xml para sql`).

## MV3 constraints to remember

- Service worker is **ephemeral** — never assume in-memory state survives. Use `chrome.storage.session` for cross-event data.
- **No string-eval**: parsers must be static `.js` files referenced by path in `registerContentScripts`. `web_accessible_resources` in `manifest.json` must declare each parser with a restricted `matches` array (not `<all_urls>` blanket).
- `host_permissions` is kept minimal (`localhost:8000`); per-domain access lives in `optional_host_permissions` to keep the install dialog clean.

## Commit workflow

Skill at `.claude/skills/commit/SKILL.md` produces single-line Conventional Commits (`<type>(<scope>): <subject>`, **hard cap 75 chars**, lowercase subject, no period). Scopes used so far: `ext`, `api`, `db`, `infra`, `skill`. The skill also updates `epic/todo.md` checkboxes when a changed file maps to a tracked story. A `PostToolUse` hook in `.claude/settings.json` reminds to run `/commit` whenever the working tree has uncommitted changes after Edit/Write/MultiEdit.

`epic/todo.md` is the canonical task tracker (Epics ↔ Stories mirror the original spec in `agents/claude-code-prompt.md`). Keep it in sync.

## What is intentionally **not** here

- Auth on `/api/v1/ingest` (anyone with the URL can POST).
- Real extension icons (`extension/icons/*.png` are 1×1 red placeholders).
- Connection pooling — `psycopg.connect()` per request. Fine at single-user dev scale; introduce a pool (e.g. `psycopg_pool`) if throughput becomes a concern.
- The `dyntamic` library — `create_model` with a small hand-rolled type resolver is sufficient at current scale. Consider `dyntamic` or build-time codegen (`datamodel-code-generator`) only if schema count explodes.
