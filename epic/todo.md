# Epic / Story Tracker

> Marque `[x]` ao concluir. A skill `/commit` é instruída a atualizar este arquivo quando um arquivo do escopo correspondente for alterado.

## EPIC-001 — Integração e Modulação Core MV3
- [x] ST-001 Arquitetura Core e Permissões Globais Nativas do MV3
- [x] ST-002 Lógica Sensorial e Feedback Assíncrono (TabId Badge Rendering)
- [x] ST-003 Depuração Dinâmica do Escopo (hide badge em zero / domínios sem regra)
- [x] ST-004 Painel Gráfico Visual Modulado (Popup Intercept)

## EPIC-002 — Lógica Modular Desacoplada dos Extractors
- [x] ST-005 Motor Dinâmico de Modulação Injetada (Content Scripts Orchestrator)
- [x] ST-006 Módulo LinkedIn de Extrações Profissionais
- [x] ST-007 Módulo OLX Classificados
- [x] ST-007b Módulo Auctions (extensão lógica do EPIC-002)

## EPIC-003 — Backend Modular com Validação Dinâmica
- [x] ST-008 Interceptação Segura API Gateway (Ingest Endpoint + CORS chrome-extension://*)
- [x] ST-009 Factory Generation Pydantic `create_model`
- [x] ST-010 Normalização Purificada (transformações puras por domínio)

## EPIC-004 — Construção e Modulação Relacional Liquibase
- [x] ST-011 Configurações Core Operacionais XML (master + properties)
- [x] ST-012 Manifestos Modulares (`<include>` descentralizado)
- [x] ST-013 Modelagem do Módulo Core + rollbacks
- [x] ST-014 Processos Imutáveis CI/CD (tagging + `<preCondition>`)

## Infraestrutura transversal
- [x] Docker Compose orquestrando db + api + liquibase
- [x] Skill `/commit` Conventional Commits (1-linha ≤75 chars)
- [x] Hook `PostToolUse` invocando `/commit`
- [x] `epic/todo.md` mantido em sincronia com o progresso
