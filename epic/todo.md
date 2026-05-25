# Epic / Story Tracker

> Marque `[x]` ao concluir. A skill `/commit` é instruída a atualizar este arquivo quando um arquivo do escopo correspondente for alterado.

## EPIC-001 — Integração e Modulação Core MV3
- [ ] ST-001 Arquitetura Core e Permissões Globais Nativas do MV3
- [ ] ST-002 Lógica Sensorial e Feedback Assíncrono (TabId Badge Rendering)
- [ ] ST-003 Depuração Dinâmica do Escopo (hide badge em zero / domínios sem regra)
- [ ] ST-004 Painel Gráfico Visual Modulado (Popup Intercept)

## EPIC-002 — Lógica Modular Desacoplada dos Extractors
- [ ] ST-005 Motor Dinâmico de Modulação Injetada (Content Scripts Orchestrator)
- [ ] ST-006 Módulo LinkedIn de Extrações Profissionais
- [ ] ST-007 Módulo OLX Classificados
- [ ] ST-007b Módulo Auctions (extensão lógica do EPIC-002)

## EPIC-003 — Backend Modular com Validação Dinâmica
- [ ] ST-008 Interceptação Segura API Gateway (Ingest Endpoint + CORS chrome-extension://*)
- [ ] ST-009 Factory Generation Pydantic `create_model`
- [ ] ST-010 Normalização Purificada (transformações puras por domínio)

## EPIC-004 — Construção e Modulação Relacional Liquibase
- [ ] ST-011 Configurações Core Operacionais XML (master + properties)
- [ ] ST-012 Manifestos Modulares (`<include>` descentralizado)
- [ ] ST-013 Modelagem do Módulo Core + rollbacks
- [ ] ST-014 Processos Imutáveis CI/CD (tagging + `<preCondition>`)

## Infraestrutura transversal
- [ ] Docker Compose orquestrando db + api + liquibase
- [ ] Skill `/commit` Conventional Commits (1-linha ≤75 chars)
- [ ] Hook `PostToolUse` invocando `/commit`
- [ ] `epic/todo.md` mantido em sincronia com o progresso
