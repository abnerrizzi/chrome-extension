# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions track `extension/manifest.json#version`. Database changes reference the
Liquibase changeset id (e.g. `olx-004`).

## [0.3.1] — 2026-05-25

### Added
- Toggle switch `auto-send` no popup, no estilo do design figma
  (`extension/design/01 _ idle _ready to send_ (1).html`): pill `border-radius:999px`,
  thumb âmbar 12×12 com glow `0 0 6px rgba(255,180,84,.5)` e `translateX(18px)`
  ao ligar, transitions de 0.16s.

### Changed
- `<section class="site">` (toggle auto-send) movida para antes de `items.preview`.

## [0.3.0] — 2026-05-25

### Added
- Auto-send: preferência `autoSend` em `chrome.storage.sync` faz `background.js`
  postar `{domain_id, raw_data:{items}}` automaticamente ao receber `DOM_COUNT`.
  Dedup por hash de `domain|external_ids` em `chrome.storage.session` por aba
  (`tab:<id>:lastSentHash`), evitando double-POST por re-injeção SPA ou
  `MutationObserver` re-rodando sobre o mesmo conteúdo.

## [0.2.1] — 2026-05-25

### Fixed
- `host_permissions` passa a declarar explicitamente os domínios de parser
  (`*://*.olx.com.br/*`, `*://*.linkedin.com/*`, `*://*.auctions.example/*`).
  `chrome.scripting.executeScript` exige host permission no momento da chamada;
  `optional_host_permissions` sozinha não cobria a re-injeção SPA, que falhava
  com *"Extension manifest must request permission to access this host"*.

### Removed
- Changeset `olx-006`: drop nas colunas `latitude`, `longitude` e `images`
  (nunca populadas). Rollback simétrico recria os três campos com os tipos
  originais.

## [0.2.0] — 2026-05-25

### Added
- **Módulos OLX venda / aluguel.** Parser deriva `kind` (`venda`|`aluguel`)
  do prefixo de `properties[].real_estate_type` (fallback heurístico em
  título/URL). Anúncios fora desses dois grupos são descartados.
- Changeset `olx-004`: colunas `neighbourhood VARCHAR(128)`,
  `kind VARCHAR(16)`, `real_estate_type VARCHAR(128)` em `olx_listings`,
  com índices em `kind` e `neighbourhood`.
- `MutationObserver` no `<script id="__NEXT_DATA__">` em
  `extension/parsers/olx_parser.js` re-roda a contagem quando o blob é
  re-hidratado pelo Next.js.
- `extension/popup.js` exibe `kind` no `meta` do preview OLX.
- Story `ST-007c` em `epic/todo.md` (refinamento OLX).
- Skill `/commit` ganha seção **Granularidade** reforçando 1 commit por
  alteração lógica (não batch no fim do plano).

### Changed
- `locationDetails` (`municipality` / `neighbourhood` / `uf`) agora vai para
  colunas separadas (`city`, `neighbourhood`, `state`) em vez de ser achatado
  na string `location` composta.
- Changeset `olx-005`: `price_cents` / `iptu_cents` (`BIGINT`, centavos) →
  `price` / `iptu` (`NUMERIC(12,2)`, reais). Normalizer retorna `float`.
  Dados existentes migrados in-place (`UPDATE … SET price = price_cents/100`).
- `scripts/extract_olx.py` espelhada à nova lógica do parser JS.

## [0.1.1] — 2026-05-25

### Added
- Popup com visual terminal: header `$ scraper`, dot de status, preview de até
  8 itens, bloco de resultado (`ingest.ok` / `ingest.err`).
- Página de opções (`extension/options.{html,js,css}`) com `chrome.permissions.request({origins})`
  para usuário colar uma URL de API custom.
- Pipeline `make fetch | raw | extract | ingest | run | sessions | session-N`
  mirroreando o parser da extensão; bypass de Cloudflare via
  `lwthiker/curl-impersonate:0.5-chrome` (TLS fingerprint Chrome 110).
- Endpoint `/scrape` (encadeia fetch → parse → ingest server-side via `curl_cffi`).
- Parser OLX migrado de DOM → `__NEXT_DATA__`; aceita ISO-8601 e epoch
  (segundos ou ms) em `date_raw`.
- Changeset `olx-002`: `listing_kind`, `bedrooms`, `bathrooms`, `garage_spaces`,
  `area_m2`, `iptu_cents`, `image_url`.
- Changeset `olx-003`: `external_id` com unique index parcial
  (`WHERE external_id IS NOT NULL`) + UPSERT em `_insert_items` por domínio.

## [0.1.0] — 2026-05-24 — bootstrap

### Added
- Docker Compose orquestrando `db` (postgres:16-alpine) + `api`
  (FastAPI + psycopg3) + `liquibase` on-demand.
- Three-domain parser registry no `background.js` (`linkedin`, `olx`,
  `auctions`); content scripts registrados via `chrome.scripting.registerContentScripts`.
- Pipeline dinâmico no backend: `schema_registry` (LRU) →
  `dynamic_validator.build_item_model` (`pydantic.create_model`) →
  normalizers puros por domínio → `_insert_items` (psycopg sync, 1 conexão por
  request).
- Liquibase Formatted SQL (`db/changelog/modules/*.sql`) com `master.xml`,
  precondition + rollback obrigatórios.
- Skill `/commit` Conventional Commits (1-linha ≤75 chars) + hook
  `PostToolUse` lembrando.
- CI `.github/workflows/build-extension.yml` empacotando `.crx` (assinado se
  o secret `CRX_PRIVATE_KEY` existir; ephemeral caso contrário) + `.zip` para
  Web Store; anexa em GitHub Releases nos tags `v*`.
- `epic/todo.md` como tracker canônico de stories.
- `CLAUDE.md` com guia de arquitetura e comandos.
