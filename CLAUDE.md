# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & runtime model

Everything except the Chrome extension itself runs in **Docker Compose**. There is intentionally no local Python/Postgres/SQLite/Liquibase install required.

**Dual-backend.** The persistence layer supports Postgres **or** SQLite, chosen at API process start from the `DATABASE_URL` scheme (`postgresql://…` → psycopg3; `sqlite:///…` or a bare path → stdlib `sqlite3`). The dialect shim lives at `api/app/core/db.py`; `persistence.py` authors SQL with `?` placeholders and wraps every statement in `db.q(...)` which rewrites to `%s` on Postgres. Upserts go through `db.upsert_conflict_clause("external_id")` — both backends require the `WHERE external_id IS NOT NULL` predicate in the conflict target to match the partial unique index (SQLite rejects the upsert with "ON CONFLICT clause does not match …" otherwise). `db.insert_returning_id` handles the `RETURNING id` ↔ `lastrowid` split.

Both backends use Liquibase, with parallel changelog trees that must stay in lockstep:

- `db/changelog/`        — Postgres flavor (BIGSERIAL, JSONB, TIMESTAMPTZ, `information_schema` preconditions).
- `db/changelog-sqlite/` — SQLite flavor (INTEGER PK AUTOINCREMENT, TEXT, `sqlite_master`/`pragma_table_info` preconditions). Custom image at `db/Dockerfile.liquibase-sqlite` bundles the xerial `sqlite-jdbc` jar.

Same changeset IDs across trees — when adding/altering a column, edit **both** files in the same commit.

Compose services, gated by profiles:

- `db` (profile `postgres`) — `postgres:16-alpine`, exposes 5432, healthchecked. Data at `./data/pgdata` (gitignored).
- `liquibase` (profile `postgres`) — official `liquibase/liquibase:4.27`, runs `db/changelog/master.xml`.
- `liquibase-sqlite` (profile `sqlite`) — built from `db/Dockerfile.liquibase-sqlite`, runs `db/changelog-sqlite/master.xml` against `/data/scraper.db` (host bind: `./data:/data`, gitignored). The Dockerfile pins **sqlite-jdbc 3.41.2.2** — the last release before xerial made `slf4j-api` a hard runtime dep that the official Liquibase image doesn't ship; newer jars crash on init with `NoClassDefFoundError: org/slf4j/LoggerFactory`. The container runs as `root` so it can write the bind-mounted DB file regardless of who created `./data/`.
- `api` (no profile — always available) — FastAPI + Pydantic v2 + psycopg3 + uvicorn. Mounts `./api` for hot-reload and `./data` so SQLite persists outside the container.

The Chrome extension is loaded manually in `chrome://extensions → Load unpacked → ./extension`. It talks to `http://localhost:8000` by default, but the URL is **configurable per-user** via the options page (see "MV3 specifics").

## Common commands

```bash
cp .env.example .env                            # one-time — escolha DATABASE_URL aqui

# Postgres path:
make up-postgres                                # db + liquibase update + api
docker compose --profile postgres run --rm liquibase rollback-count 1
./scripts/tag_release.sh v1                     # default backend=postgres
docker compose exec db psql -U app scraper_dev  # psql shell

# SQLite path (sem Postgres no host):
make up-sqlite                                  # liquibase-sqlite update + api
docker compose --profile sqlite run --rm liquibase-sqlite rollback-count 1
./scripts/tag_release.sh --backend sqlite v1
sqlite3 data/scraper.db                         # shell SQLite

# Comum:
docker compose up -d api                        # start API at :8000
docker compose run --rm api pytest              # run all tests
docker compose run --rm api pytest tests/test_ingest_dynamic.py::test_olx_house_payload_full_normalization
make down                                       # para tudo de ambos os perfis (mantém binds ./data e ./data/pgdata)

# Rodar pytest contra um backend específico (sobrescreve DATABASE_URL):
docker compose run --rm -e DATABASE_URL=sqlite:////data/scraper.db -v "$(pwd)/data:/data" api pytest
docker compose run --rm -e DATABASE_URL=postgresql://app:app@db:5432/scraper_dev api pytest
# O test_external_id_upsert_dedupes_olx só exercita o roundtrip real quando as migrações estão aplicadas
# no backend ativo; sem schema, ele degrada para um no-op (persisted=false).
```

There's also a **Make pipeline** that mirrors the extension end-to-end without Chrome — see "Make pipeline" below. API docs at `http://localhost:8000/docs`.

## Architecture: how the three layers talk

**Frontend → Backend**: `extension/background.js` (MV3 service worker — ephemeral) registers per-domain parsers via `chrome.scripting.registerContentScripts` on `onInstalled`/`onStartup`, plus a `chrome.webNavigation.onHistoryStateUpdated` listener that **re-injects the parser on SPA pushState** (OLX paginates via `&o=2` without full document load). `registerAllParsers()` **reconciles** rather than blindly adds: it unregisters orphan ids no longer in `DOMAIN_REGISTRY` (e.g. a renamed parser), `updateContentScripts` for ids that already exist, registers genuinely new ids, and swallows the benign `Duplicate script ID` / `Nonexistent script ID` race when `onInstalled` and `onStartup` fire concurrently. Each parser in `extension/parsers/<domain>_parser.js` is a **static file** (MV3 forbids string-eval). The parser builds an `items` array and sends `{type: "DOM_COUNT", domain, count, items}` via `chrome.runtime.sendMessage`. `background.js` then:
1. Calls `chrome.action.setBadgeText({text, tabId: sender.tab.id})` — **always tabId-scoped** to avoid badge pollution. Empty string when count is 0.
2. Stashes the payload in `chrome.storage.session` keyed by `tab:<tabId>` so the popup can read it.

The popup (`popup.js`) reads `chrome.storage.session` for the active tab, renders a preview of up to 8 items in a terminal-style UI, and POSTs `{domain_id, raw_data: {items}}` to `${apiUrl}/api/v1/ingest` (apiUrl from `chrome.storage.sync`, default `http://localhost:8000`). A toggle switch in the popup (`#autosend-toggle`, persisted as `autoSend` in `chrome.storage.sync`) makes `background.js` POST automatically on every new `DOM_COUNT`, with per-tab dedupe by hash of `domain|external_ids` stored in `chrome.storage.session` under `tab:<id>:lastSentHash` — re-injections and `MutationObserver` re-fires on the same content do not double-POST.

**Backend dynamic validation pipeline** (`api/app/routers/ingest.py`):
1. `schema_registry.get_schema(domain_id)` loads JSON Schema from `api/app/schemas/<domain_id>.json` (LRU cached).
2. `dynamic_validator.build_item_model(domain_id, schema)` walks `schema['properties']` and calls `pydantic.create_model(...)` to build a Pydantic class **at runtime**. The result is cached by SHA1 of the JSON repr so equivalent schemas reuse the same class.
3. Each item is validated; failures collect into an `errors` list. Returns 422 if *all* fail, 200 with partial errors otherwise.
4. Pure-function normalizers in `api/app/normalization/<domain>.py` transform validated dicts (e.g. OLX `"R$ 2.250.000"` → `price: 2250000.0` stored as `NUMERIC(12,2)`; epoch seconds → ISO-8601; `"3 quartos"` → `3`).
5. `app/core/persistence.py` opens a sync connection per request through `app.core.db.connect()` (psycopg3 on Postgres, stdlib `sqlite3` on SQLite). It INSERTs a `scrape_sessions` row, then **UPSERTs** per-domain rows via `ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET …` — same form on both backends (each requires the `WHERE` predicate to match the partial unique index). Dedup is per-domain; the partial index lets items without `external_id` coexist. **Graceful degradation**: if `DATABASE_URL` is unreachable or migrations haven't run, the response still returns 200 with `persisted: false` and a `skipped_reason`.
6. `GET /api/v1/sessions` + `GET /api/v1/sessions/{id}` expose the persisted data over HTTP.

**Adding a new domain** requires five files in lockstep:
- `extension/parsers/<domain>_parser.js` — extraction logic (DOM or `__NEXT_DATA__`).
- `extension/background.js → DOMAIN_REGISTRY` — registers the parser for the URL pattern.
- `api/app/schemas/<domain>.json` — JSON Schema (drives the dynamic Pydantic model). Include `external_id` as an optional string for dedup.
- `api/app/normalization/<domain>.py` — pure normalizer; register it in `routers/ingest.py:NORMALIZERS`.
- `db/changelog/modules/<domain>.sql` **and** `db/changelog-sqlite/modules/<domain>.sql` — Liquibase Formatted SQL changesets (table + a follow-up `<domain>-NNN-external-id` that adds the column + partial unique index). Same changeset IDs in both trees; include in the respective `master.xml`. Wire INSERT/UPSERT in `core/persistence.py:_insert_items` using `?` placeholders + `db.q()`.

## OLX specifics

The OLX parser **does not query the rendered DOM**. It reads `<script id="__NEXT_DATA__">` (Next.js hydration blob), uses **only** `props.pageProps.ads`, and derives the **module kind** (`venda` | `aluguel`) from the prefix of `properties[].real_estate_type` (e.g. `"Venda - casa em rua pública"` → `venda`). Anúncios sem prefixo Venda/Aluguel — temporada, troca etc. — são **descartados**; só casas de venda ou aluguel chegam ao backend. Fallback heurístico: regex `\b(aluguel|alugar|locacao)\b` / `\b(venda|vender|comprar)\b` no título/URL quando a property falta.

A captura também expõe `origListTime` (epoch), `properties[]` (rooms / bathrooms / garage_spaces / size / iptu / category / real_estate_type) e `locationDetails` (`municipality` / `neighbourhood` / `uf`) — **separados** em colunas próprias do banco (`city`, `neighbourhood`, `state`) em vez de achatados em uma única string `location`.

Um `MutationObserver` no próprio `<script id="__NEXT_DATA__">` re-roda o parser se o Next.js re-hidratar o blob no client. A re-injeção do content script via `chrome.webNavigation.onHistoryStateUpdated` em `background.js` cobre o caso comum (paginação SPA com `pushState`).

Fixture para desenvolvimento: `tmp/olx_next_data.json` (untracked) — um `__NEXT_DATA__` capturado de uma página real.

OLX is behind Cloudflare; plain `curl` returns a CAPTCHA page. Use the curl-impersonate Docker image (TLS fingerprint of Chrome 110) — the Makefile already wires this.

## LinkedIn specifics

LinkedIn is an Ember SPA — **no `__NEXT_DATA__`**, so `extension/parsers/linkedin_parser.js` is fully DOM-driven. It auto-detects **two DOMs** at runtime and serves **two page types**:

- **Guest** (logged-out, `/jobs/search/`): server-rendered list `ul.jobs-search__results-list > div.base-card`; detail page `/jobs/view/NNN` (`div.show-more-less-html__markup`, `li.description__job-criteria-item`). These selectors are confirmed against a real capture.
- **Logged-in** (the common case): the jobs list is **virtualized** (~7 `li[data-occludable-job-id]` cards in the DOM at a time) and a job opens in a **side detail pane** (URL gains `?currentJobId=NNN`). The logged-in selectors in `SEL.LOGGEDIN` are **best-effort and flagged UNVERIFIED** — every field degrades to `null` (never throws); validate/correct them against a real logged-in capture (epic story ST-021).

Because the logged-in list is virtualized, the parser **accumulates across the user's scroll** rather than snapshotting once: a `Map` deduped by job id (kept on `window.__linkedinParserState` so it survives the `executeScript` re-injections that `pushState` triggers — a full reload starts fresh), grown by a debounced `MutationObserver`, re-emitting the full array each fire.

It emits **two domains** from one parser: `linkedin` (list cards → table `linkedin_jobs`) and `linkedin_detail` (the open job → `linkedin_job_details`), joined by `external_id` (the numeric jobPosting id). `background.js` keeps the detail payload in a separate `tab:<id>:detail` slot so it never clobbers the list badge/preview. The reference logged-out Selenium scraper lives at `jobhubmine/scrapers/linkedin-ff-selenium` (guest selectors only).

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

`scripts/extract_olx.py` **mirrors `extension/parsers/olx_parser.js` line-by-line**: same path (`props.pageProps.ads`), same field mapping, same `kindFromRealEstateType` derivation, same `isVendaOuAluguel` filter (venda + aluguel only). Keep them in sync when changing parser logic. `scripts/dump_next_data.py` is the smaller utility that just yanks the JSON out of the HTML.

There's a parallel **LinkedIn pipeline** (`make linkedin-fetch → linkedin-extract → linkedin-ingest`, chained by `make linkedin-run`). It targets the **guest** experience only — `curl` can't be logged in — so it fetches the public `jobs-guest/jobs/api/seeMoreJobPostings/search` fragment (default `LI_URL`, overridable) via the same curl-impersonate image. `scripts/extract_linkedin.py` parses that HTML with stdlib `html.parser` and **mirrors the guest branch (`SEL.GUEST.list`) of `linkedin_parser.js`** — same fields (`external_id, title, company, location, url, posted_raw`, `source_view="guest"`), same tolerant keep filter. It can't exercise the logged-in/virtualized or detail paths (those need a browser session). Keep it in sync with the parser's guest selectors.

`URL=…` (OLX) / `LI_URL=…` (LinkedIn) override the default search; `API=…` overrides `http://localhost:8000`.

## Database conventions

Migrations are **Liquibase Formatted SQL**, kept in **two parallel trees** — `db/changelog/modules/*.sql` (Postgres) and `db/changelog-sqlite/modules/*.sql` (SQLite) — each orchestrated by its own `master.xml`. The masters remain XML because Formatted SQL has no native `--include`. Every changeset must include:
- `--preconditions onFail:HALT onError:HALT` + a `--precondition-sql-check`. The query differs per tree: Postgres uses `information_schema.{tables|columns}`; SQLite uses `sqlite_master` for tables and `pragma_table_info('<table>')` for columns.
- `--rollback` lines that fully undo the changeset.

For `external_id` dedup, the pattern is a **partial unique index** in both dialects: `CREATE UNIQUE INDEX uq_<table>_external_id ON <table>(external_id) WHERE external_id IS NOT NULL;` (SQLite supports the partial WHERE since 3.8). The persistence layer leverages this with `ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE` — the same form on both backends, because each requires the conflict target to repeat the index predicate. `db.upsert_conflict_clause` keeps the wording in one place.

Type mapping conventions (Postgres tree → SQLite tree): `BIGSERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`; `BIGINT` → `INTEGER`; `VARCHAR(n)` → `TEXT`; `JSONB` → `TEXT`; `TIMESTAMPTZ` → `TEXT` (ISO-8601 via `CURRENT_TIMESTAMP`); `NUMERIC(p,s)` → `NUMERIC`; `DEFAULT NOW()` → `DEFAULT CURRENT_TIMESTAMP`. SQLite only allows one `ADD COLUMN` per `ALTER TABLE`, so multi-column ALTERs are split into one statement per column.

## MV3 specifics

- Service worker is **ephemeral** — never assume in-memory state survives. Use `chrome.storage.session` for cross-event data, `chrome.storage.sync` for user prefs (API URL).
- **No string-eval**: parsers must be static `.js` files referenced by path. `web_accessible_resources` in `manifest.json` declares each parser with a per-domain `matches` array.
- `host_permissions` lists the **parser domains** (olx, auctions placeholder). These are mandatory because `chrome.scripting.executeScript` (used in the SPA re-inject path) requires actual host permission at call time — `optional_host_permissions` alone isn't enough even when granted. `optional_host_permissions` declares `http://*/*` and `https://*/*` and stays reserved for the **user-configurable API URL**: the options page (`extension/options.{html,js,css}`) requests the specific origin via `chrome.permissions.request({origins: [...]})` when the user saves a custom API URL.
- `webNavigation` permission powers the SPA re-injection in `background.js` — without it, OLX pagination via pushState wouldn't trigger the parser.
- **Stale content scripts**: reloading the extension leaves the *previous* content script alive on already-open tabs (re-injection only happens on a fresh page load), and its `MutationObserver` keeps firing — any `chrome.runtime.sendMessage` then throws `Extension context invalidated`. Parsers should guard every `chrome.*` call behind an `extensionAlive()` helper (`chrome.runtime?.id` becomes undefined once invalidated) and `disconnectAndStop()` the observer on the first dead-context signal, with a `try/catch` for the guard↔send race. **After reloading the extension, refresh open tabs** to pick up the new build.

## Branch workflow

Skill at `.claude/skills/feature-branch/SKILL.md` (invoke with `/feature-branch [slug]`) checks out a fresh branch before any new feature, refactor, or non-trivial fix. It **always asks which base branch** to use — current branch (to stack on unmerged work / an open PR), `main`/`master`, or `develop` — rather than defaulting. Branch names mirror the Conventional Commits vocabulary: `<type>/<scope>-<subject-kebab>` (e.g. `feat/ext-olx-pagination`, `fix/api-upsert-coalesce`). Pre-flight checks: working tree clean, base up to date (`--ff-only` when it has an upstream), no force operations. The skill **only** positions the branch — it does not commit. (A `develop` branch exists alongside `main`; pick the base that matches your intended PR target.)

## Commit workflow

Skill at `.claude/skills/commit/SKILL.md` produces single-line Conventional Commits (`<type>(<scope>): <subject>`, **hard cap 75 chars**, lowercase subject, no period). Scopes in use: `ext`, `api`, `db`, `olx`, `infra`, `skill`, `ci`. The skill also updates `epic/todo.md` checkboxes when a changed file maps to a tracked story. A `PostToolUse` hook in `.claude/settings.json` reminds to run `/commit` whenever the working tree has uncommitted changes after Edit/Write/MultiEdit.

**Granularidade**: 1 commit por alteração lógica. Quando executar um plano multi-step, rodar `/commit` **após cada etapa** (cada arquivo ou grupo coeso), não acumular tudo em um commit final. Mudanças inseparáveis (schema + normalizer + persistence onde o teste só passa com os 3) podem ir juntas, mas o mais cedo possível. Ver a seção "Granularidade" no `SKILL.md`.

`epic/todo.md` is the canonical task tracker (Epics ↔ Stories mirror the original spec in `agents/claude-code-prompt.md`). User-facing version history lives in `CHANGELOG.md` (Keep a Changelog format, versions track `extension/manifest.json#version`).

## CI

`.github/workflows/build-extension.yml` builds `.crx` (signed if the repo has a `CRX_PRIVATE_KEY` secret; ephemeral key otherwise) + `.zip` (Web Store upload) on push to `main`, on `v*` tags, and on `workflow_dispatch`. Tagged builds get attached to a GitHub Release automatically.

## What is intentionally **not** here

- Auth on `/api/v1/ingest` (anyone with the URL can POST).
- Real extension icons (`extension/icons/*.png` are 1×1 red placeholders).
- Connection pooling — `db.connect()` opens one connection per request (psycopg or sqlite3). Fine at single-user dev scale; introduce `psycopg_pool` (or a SQLite write-serializer) if throughput becomes a concern.
- The `dyntamic` library — `pydantic.create_model` with a small hand-rolled type resolver is sufficient at current scale. Consider `dyntamic` or build-time codegen (`datamodel-code-generator`) only if schema count explodes.
- IBM Plex fonts — the popup design (`extension/design/`, gitignored) uses IBM Plex Sans, but the shipped popup falls back to `ui-monospace` to keep the extension bundle lean.
