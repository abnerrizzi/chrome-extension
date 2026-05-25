# Ecossistema Modular de Extração de Dados Web

Stack: **Chrome Extension MV3** + **FastAPI (validação dinâmica via Pydantic `create_model`)** + **PostgreSQL** orquestrado por **Liquibase XML modular**.

Tudo (exceto o navegador) roda em containers via `docker compose`.

## Pré-requisitos

- Docker + Docker Compose v2
- Google Chrome (para carregar a extensão desempacotada)

## Quickstart

```bash
cp .env.example .env

# 1. sobe Postgres
docker compose up -d db

# 2. aplica migrações
docker compose run --rm liquibase update

# 3. sobe a API
docker compose up -d api
# API em http://localhost:8000  |  docs em /docs

# 4. carrega a extensão
# Chrome → chrome://extensions → "Modo do desenvolvedor" → "Carregar sem compactação" → ./extension
```

## Operações comuns

```bash
# rollback até a tag mais recente
docker compose run --rm liquibase rollback v1

# status de migrações pendentes
docker compose run --rm liquibase status --verbose

# tag de release
./scripts/tag_release.sh v2

# testes da API
docker compose run --rm api pytest

# psql interativo
docker compose exec db psql -U app scraper_dev
```

## Arquitetura

- `extension/` — MV3, badge tabId-scoped, parsers estáticos por domínio
- `api/` — FastAPI, `POST /api/v1/ingest`, valida via modelo Pydantic gerado em runtime a partir do JSON Schema do domínio
- `db/changelog/` — `master.xml` apenas com `<include>`; cada domínio em seu próprio módulo
- `agents/` — prompt original do Claude Code CLI usado como referência do scaffold
- `epic/todo.md` — checklist por Épico/Story

## Auto-commit

Skill `/commit` em `.claude/skills/commit/` faz commits Conventional 1-linha (≤75 chars). Hook `PostToolUse` em `.claude/settings.json` dispara após cada `Edit`/`Write`/`MultiEdit`.

## Próximos passos (fora do scaffold inicial)

- Persistência real (INSERT) ligando `normalization/*.py` ao Postgres via SQLAlchemy/asyncpg.
- Ícones da extensão reais (atualmente são PNGs placeholder).
- Auth/JWT no endpoint de ingestão.
