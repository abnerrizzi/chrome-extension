# Epic / Story Tracker

> Marque `[x]` ao concluir. A skill `/commit` é instruída a atualizar este arquivo quando um arquivo do escopo correspondente for alterado.

## EPIC-001 — Integração e Modulação Core MV3
- [x] ST-001 Arquitetura Core e Permissões Globais Nativas do MV3
- [x] ST-002 Lógica Sensorial e Feedback Assíncrono (TabId Badge Rendering)
- [x] ST-003 Depuração Dinâmica do Escopo (hide badge em zero / domínios sem regra)
- [x] ST-004 Painel Gráfico Visual Modulado (Popup Intercept)

## EPIC-002 — Lógica Modular Desacoplada dos Extractors
- [x] ST-005 Motor Dinâmico de Modulação Injetada (Content Scripts Orchestrator)
- [ ] ST-006 Módulo LinkedIn de Extrações Profissionais — **reconstruído em EPIC-006**
- [x] ST-007 Módulo OLX Classificados
- [x] ST-007b Módulo Auctions (extensão lógica do EPIC-002)
- [x] ST-007c Refinamento OLX (kind venda/aluguel, neighbourhood, observabilidade __NEXT_DATA__)

## EPIC-003 — Backend Modular com Validação Dinâmica
- [x] ST-008 Interceptação Segura API Gateway (Ingest Endpoint + CORS chrome-extension://*)
- [x] ST-009 Factory Generation Pydantic `create_model`
- [x] ST-010 Normalização Purificada (transformações puras por domínio)

## EPIC-004 — Construção e Modulação Relacional Liquibase
- [x] ST-011 Configurações Core Operacionais XML (master + properties)
- [x] ST-012 Manifestos Modulares (`<include>` descentralizado)
- [x] ST-013 Modelagem do Módulo Core + rollbacks
- [x] ST-014 Processos Imutáveis CI/CD (tagging + `<preCondition>`)

## EPIC-005 — Backend SQLite paralelo ao Postgres
- [x] ST-015 Shim de dialeto `api/app/core/db.py` (postgres/sqlite)
- [x] ST-016 `persistence.py` usa shim (placeholders `?`, upsert genérico)
- [x] ST-017 Espelho `db/changelog-sqlite/` com pré-condições `sqlite_master`/`pragma_table_info`
- [x] ST-018 Perfis Compose `postgres`/`sqlite` + imagem Liquibase com sqlite-jdbc
- [x] ST-019 Targets `make up-postgres`/`up-sqlite`/`down` e `tag_release.sh --backend`
- [x] ST-020 Cobertura de testes (`test_db_dialect.py` + dedup via shim)

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

## Infraestrutura transversal
- [x] Docker Compose orquestrando db + api + liquibase
- [x] Skill `/commit` Conventional Commits (1-linha ≤75 chars)
- [x] Skill `/feature-branch` posiciona branch a partir da base escolhida
- [x] Skill `/epic-sync` registra Epics/Stories do plano e mantém `epic/todo.md` em sincronia
- [x] Hook `PostToolUse` invocando `/commit`
- [x] `epic/todo.md` mantido em sincronia com o progresso
