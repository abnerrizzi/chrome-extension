# chrome-extension — Modular DOM Scraper

Ecossistema ponta-a-ponta para extrair, validar e persistir dados de páginas web modularmente:

- **Chrome Extension (MV3)** — content scripts dinâmicos por domínio. No OLX, lê `__NEXT_DATA__` (não o DOM renderizado) e mostra contagem no badge estilo AdBlock. Popup em visual terminal.
- **API (FastAPI + Pydantic v2)** — `POST /api/v1/ingest` valida com modelo Pydantic **gerado em runtime** a partir do JSON Schema do domínio, normaliza (preço → cents, datas → ISO-8601) e faz upsert no banco por `external_id`.
- **PostgreSQL ou SQLite + Liquibase** — backend escolhido pelo scheme do `DATABASE_URL` (`postgresql://…` ou `sqlite:///…`). Changelogs em SQL formatado, modulares por domínio (`core`, `olx`, `auctions`), com `<rollback>` e `<preCondition>` por changeset, **espelhados** em `db/changelog/` (Postgres) e `db/changelog-sqlite/` (SQLite).
- **Makefile** — pipeline CLI que espelha exatamente a extensão (`fetch` → `extract` → `ingest`), útil pra testar sem abrir o Chrome.

Tudo (exceto o navegador) roda em containers via `docker compose`. Sem nenhum Python/Postgres/SQLite/Liquibase instalado no host.

---

## RUN

### 0. Pré-requisitos

- Docker Engine + Docker Compose v2
- Google Chrome (apenas pra carregar a extensão; o restante é container)
- `make` no host (para o pipeline CLI)

### 1. Escolha um backend (Postgres ou SQLite)

A seleção é por `DATABASE_URL` + perfil do Compose:

| Backend  | `DATABASE_URL`                       | Perfil compose | Bootstrap                 |
|----------|--------------------------------------|----------------|---------------------------|
| Postgres | `postgresql://app:app@db:5432/scraper_dev` | `postgres`     | `make up-postgres`        |
| SQLite   | `sqlite:////data/scraper.db`         | `sqlite`       | `make up-sqlite`          |

```bash
cp .env.example .env                           # ajusta DATABASE_URL ao backend escolhido

# Postgres (default):
make up-postgres                               # db + liquibase update + api

# OU SQLite (sem Postgres no host):
make up-sqlite                                 # liquibase-sqlite update + api
```

Sanity check: `curl -s http://localhost:8000/healthz` deve devolver `{"status":"ok"}`.

### 2. Rodar via pipeline CLI (sem Chrome)

```bash
make                                           # mostra todos os targets
make run                                       # fetch → extract → ingest (busca padrão: Setor Jaó)
make run URL='https://www.olx.com.br/imoveis/venda/estado-go?...&o=2'
make sessions                                  # lista últimas 10 sessões persistidas
make session-27                                # detalha a sessão 27 com todos os itens
```

O `make fetch` usa `lwthiker/curl-impersonate` em container — mesmo TLS fingerprint do Chrome 110, contorna o Cloudflare que mata o curl normal. O `make extract` (`scripts/extract_olx.py`) **espelha bit-a-bit** a lógica do parser JS: lê só `props.pageProps.ads`, filtra `categoryName === "Casas"`, produz o mesmo shape que o popup POSTaria.

### 3. Rodar via extensão (Chrome)

1. `chrome://extensions` → ativa "Modo desenvolvedor" → "Carregar sem compactação" → seleciona `./extension/`
2. Clica nos detalhes da extensão → **Opções** → digita `http://localhost:8000` → **Salvar** (concede permissão de host)
3. Abre uma busca real do OLX: `https://www.olx.com.br/imoveis/venda/estado-go?q=casa%20setor%20jao,%20goiania&rfs=115`
4. Badge laranja mostra a contagem de casas. Paginação `&o=2` / `&o=3` re-injeta o parser via `chrome.webNavigation.onHistoryStateUpdated`.
5. Clica no ícone → popup mostra preview de até 8 itens → "Enviar para API"
6. Bloco `ingest.ok` aparece com `session_id` real do banco

### 4. Operações comuns

```bash
docker compose run --rm api pytest                                # roda todos os testes
docker compose run --rm api pytest tests/test_ingest_dynamic.py::test_olx_house_payload_full_normalization

docker compose --profile postgres run --rm liquibase rollback-count 1   # Postgres: reverte
docker compose --profile sqlite  run --rm liquibase-sqlite rollback-count 1   # SQLite: reverte
docker compose --profile postgres run --rm liquibase status --verbose   # pendentes (Postgres)
./scripts/tag_release.sh v3                                       # tag schema (Postgres, default)
./scripts/tag_release.sh --backend sqlite v3                      # tag schema (SQLite)

docker compose exec db psql -U app scraper_dev                    # Postgres: psql interativo
sqlite3 data/scraper.db                                           # SQLite: shell interativo

docker compose logs -f api                                        # tail da API
make down                                                         # para tudo (todos os perfis)
docker compose --profile postgres down -v                         # para Postgres e apaga volumes
```

---

## Arquitetura

```
┌────────────────┐   POST /api/v1/ingest    ┌──────────────────┐    INSERT/UPSERT  ┌─────────────────┐
│ Chrome MV3 ext │ ───────────────────────▶ │ FastAPI          │ ────────────────▶ │ Postgres        │
│ - background.js│  {domain_id, raw_data}   │ - dynamic_validat│  via db dialect   │   ou            │
│ - parsers/*.js │                          │ - normalization/ │  shim (psycopg3   │ SQLite (stdlib) │
│ - popup.html   │                          │ - persistence    │  ou sqlite3)      │ Liquibase       │
└────────────────┘                          └──────────────────┘                   └─────────────────┘
        ▲                                            ▲
        │ chrome.scripting.registerContentScripts   │ schemas/<domain>.json
        │ (re-injeta em pushState do SPA)            │ + pydantic.create_model()
        │                                            │
   ┌────────────────────────────────────────────────────┐
   │  Makefile pipeline (espelha a extensão sem Chrome) │
   │  fetch (curl-impersonate) → extract → ingest        │
   └────────────────────────────────────────────────────┘
```

Detalhes em [`CLAUDE.md`](CLAUDE.md). Layout completo: `extension/` (MV3), `api/app/` (FastAPI + normalizers + schemas), `db/changelog/` (Liquibase modular), `scripts/` (CLI helpers).

## Adicionando um novo domínio

Cinco arquivos em lockstep:

| Arquivo | Propósito |
|---|---|
| `extension/parsers/<domain>_parser.js` | Lê DOM ou `__NEXT_DATA__`, envia `{type:"DOM_COUNT", domain, count, items}` |
| `extension/background.js → DOMAIN_REGISTRY` | URL match para registrar o parser |
| `api/app/schemas/<domain>.json` | JSON Schema (vira modelo Pydantic em runtime) |
| `api/app/normalization/<domain>.py` | Função pura `normalize(items) -> items` |
| `db/changelog/modules/<domain>.sql` | `--changeset` + `--rollback` Postgres; incluir no `master.xml` |
| `db/changelog-sqlite/modules/<domain>.sql` | Espelho SQLite (manter em lockstep com o Postgres) |

Em `api/app/routers/ingest.py` adicionar o domínio em `NORMALIZERS` e em `core/persistence.py` o INSERT/UPSERT correspondente.

## Auto-commit (Claude Code)

Skill `/commit` em `.claude/skills/commit/SKILL.md` gera Conventional Commits 1-linha (≤75 chars) e atualiza `epic/todo.md`. Hook `PostToolUse` em `.claude/settings.json` lembra de invocá-la após cada Edit/Write.

## O que ainda não está aqui

- Auth no `/api/v1/ingest` — qualquer cliente com a URL pode postar.
- Connection pool real (atualmente `psycopg.connect()` por request). Suficiente em escala dev/single-user.
- Ícones de verdade — `extension/icons/*.png` são PNGs 1×1 placeholder.
