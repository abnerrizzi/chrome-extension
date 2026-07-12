# Epic / Story Tracker

> Marque `[x]` ao concluir. A skill `/commit` é instruída a atualizar este arquivo quando um arquivo do escopo correspondente for alterado.

## EPIC-001 — Core MV3 (manifest, service worker, badge, popup)
- [x] ST-001 `manifest.json` MV3: `permissions`, `host_permissions` (olx/auctions) + `optional_host_permissions` `http(s)://*/*`; `background.js` service worker efêmero
- [x] ST-002 `background.js` `setBadge` com escopo por aba via `chrome.action.setBadgeText({tabId})`
- [x] ST-003 `background.js` zera badge em count 0 e ignora URLs sem regra no `DOMAIN_REGISTRY` (`urlMatchesDomain`)
- [x] ST-004 `popup.{html,js}` lê `chrome.storage.session` `tab:<id>`, preview até 8 itens + POST `/api/v1/ingest`

## EPIC-002 — Parsers por domínio (orquestração + content scripts)
- [x] ST-005 `background.js` `DOMAIN_REGISTRY` + `registerAllParsers()` reconcilia content scripts; re-injeção SPA via `webNavigation.onHistoryStateUpdated`
- [ ] ST-006 Módulo LinkedIn de Extrações Profissionais — **reconstruído em EPIC-006**
- [x] ST-007 `extension/parsers/olx_parser.js` lê `__NEXT_DATA__` `props.pageProps.ads`
- [x] ST-007b `extension/parsers/auctions_parser.js` (placeholder, extração via DOM)
- [x] ST-007c `olx_parser.js`: `kind` venda/aluguel por `real_estate_type`, `neighbourhood`/`city`/`state` separados, `MutationObserver` no `__NEXT_DATA__`

## EPIC-003 — Backend de ingest (validação dinâmica + normalização)
- [x] ST-008 `api/app/routers/ingest.py` POST `/api/v1/ingest` + CORS `chrome-extension://*`
- [x] ST-009 `api/app/core/dynamic_validator.py` `build_item_model` via `pydantic.create_model` (cache por SHA1); schemas em `api/app/schemas/*.json` (`schema_registry.py`)
- [x] ST-010 `api/app/normalization/{olx,auctions}.py` normalizers puros + dict `NORMALIZERS` em `ingest.py`

## EPIC-004 — Migrações Liquibase (árvore Postgres)
- [x] ST-011 `db/changelog/master.xml` + properties (`autoIncrement`/`json`/`timestamp` por dbms)
- [x] ST-012 `<include>` modular dos módulos (`core`/`olx`/`auctions`) no `master.xml`
- [x] ST-013 `db/changelog/modules/core.sql` `scrape_sessions` + rollbacks
- [x] ST-014 `preconditions onFail:HALT` por changeset; `scripts/tag_release.sh`; CI `.github/workflows/build-extension.yml`

## EPIC-005 — Backend SQLite paralelo ao Postgres
- [x] ST-015 Shim de dialeto `api/app/core/db.py` (psycopg3/sqlite3 pelo scheme do `DATABASE_URL`)
- [x] ST-016 `persistence.py` sobre o shim (placeholders `?`, `db.q()`, `upsert_conflict_clause`)
- [x] ST-017 Espelho `db/changelog-sqlite/` com preconditions `sqlite_master`/`pragma_table_info`
- [x] ST-018 Perfis Compose `postgres`/`sqlite` + `db/Dockerfile.liquibase-sqlite` (`sqlite-jdbc` 3.41.2.2)
- [x] ST-019 Targets `make up-postgres`/`up-sqlite`/`down` e `tag_release.sh --backend`
- [x] ST-020 `api/tests/test_db_dialect.py` + dedup via shim

## EPIC-006 — Módulo LinkedIn (lista + detalhe, guest + logado)
- [ ] ST-021 Captura/validação do DOM logado (HTML real, confirmar SEL.LOGGEDIN)
- [x] ST-022 Parser dual-DOM `linkedin_parser.js` (detect guest/logado, lista/detalhe, acumulação por scroll, guards MV3)
- [x] ST-023 `background.js`: storage `tab:<id>:detail`, badge guard `_detail$`, dedupe por domínio, cleanup + registro no DOMAIN_REGISTRY
- [x] ST-024 `manifest.json`: host_permissions linkedin + web_accessible_resources
- [x] ST-025 `popup.js`: previewFields `linkedin` + `linkedin_detail`
- [x] ST-026 Schemas `linkedin.json` (lista) + `linkedin_detail.json` (detalhe)
- [x] ST-027 Normalizers `normalization/linkedin.py` + registro em `ingest.py` NORMALIZERS
- [x] ST-028 Persistence: branches `linkedin`→`linkedin_jobs`, `linkedin_detail`→`linkedin_job_details`
- [x] ST-029 Liquibase `modules/linkedin.sql` (2 tabelas + external_id) nas 2 árvores + includes
- [x] ST-030 Testes ingest (422, normalização lista+detalhe, upsert dedupe) — passam em Postgres e SQLite
- [x] ST-031 CHANGELOG + bump manifest version + atualizar nota CLAUDE.md
- [x] ST-032 Pipeline `make linkedin-run` + `scripts/extract_linkedin.py` (guest), espelha o pipeline OLX
- [x] ST-033 Testes extras: `scripts/test_extract_linkedin.py` (extractor guest) + join lista×detalhe por external_id

## EPIC-007 — Popup UI refresh (B_tabbed)
- [x] ST-034 `extension/manifest.json` bump 0.4.1→0.5.0 + entrada `CHANGELOG.md`
- [x] ST-035 `extension/popup.html` reestrutura: 3 tabs (items/response/info) + tabpanels, site section acima das tabs, endpoint/configurar migram p/ info
- [x] ST-036 `extension/popup.css` `.tabs`/`.tab`/`.tabpanel`/`.badge`, `.site[data-match=false]` hide, fresh-response dot
- [x] ST-037 `extension/popup.js` switching de tabs, per-site auto-send (`autoSendDomains` map) + migração legacy do `autoSend` boolean
- [x] ST-038 `extension/background.js` `autoSendIfEnabled` consulta `autoSendDomains[domain]` com fallback p/ `autoSend` legado
- [x] ST-039 `extension/popup.js` lê `tab:<id>:detail` quando não há lista (página /jobs/view/NNN isolada) — toggle e send resolvem do slot ativo

## Infraestrutura transversal
- [x] Docker Compose orquestrando db + api + liquibase
- [x] Skill `/commit` Conventional Commits (1-linha ≤75 chars)
- [x] Skill `/feature-branch` posiciona branch a partir da base escolhida
- [x] Skill `/epic-sync` registra Epics/Stories do plano e mantém `epic/todo.md` em sincronia
- [x] Hook `PostToolUse` invocando `/commit`
- [x] `epic/todo.md` mantido em sincronia com o progresso
