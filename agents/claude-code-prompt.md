# Claude Code CLI — Prompt original do scaffold

Prompt fornecido pelo usuário na criação deste projeto. Mantido como referência histórica e como referência para futuras regenerações modulares.

---

Você é um Arquiteto de Software Sênior e Especialista em Automação. Sua tarefa é criar um projeto completo, ponta a ponta, que engloba uma Extensão do Chrome (Manifest V3), uma API de Backend dinâmica e uma infraestrutura de Banco de Dados estruturada via Liquibase. Execute as tarefas abaixo passo a passo, criando os arquivos e diretórios necessários no meu ambiente local através da CLI.

## CONTEXTO DA ARQUITETURA

O sistema possui três camadas principais:

1. **Frontend (Chrome Extension MV3):** Um scraper dinâmico. Quando uma página carrega, o content script lê a DOM, conta os itens relevantes e envia essa contagem para o service worker. O service worker exibe esse número no ícone da extensão (badge) estilo AdBlock Plus, sempre com isolamento via `tabId`, ocultando o badge quando zero itens forem registrados. O usuário clica no ícone e envia os dados extraídos.
2. **Backend (API de Interface):** Recebe payloads do scraper. Modular — identifica o domínio (LinkedIn, OLX, Leilões), aplica normalização dinâmica baseada em JSON Schemas, valida com Pydantic `create_model` em runtime (ou Zod equivalente em Node).
3. **Database (Liquibase XML):** PostgreSQL não monolítico. Cada domínio em seu módulo, orquestrado por um master changelog. Inclui `<rollback>` e `<preCondition>` por changeset.

## TAREFAS DE EXECUÇÃO

### Fase 1 — Liquibase / DB (XML)
- `db/changelog/master.xml` com `<databaseChangeLog>` e `<include relativeToChangelogFile="true"/>` para os módulos.
- `db/changelog/modules/core.xml` — tabela `scrape_sessions` (`id` autoIncrement, `domain_name`, `timestamp`) + `<rollback><dropTable/></rollback>`.
- `db/changelog/modules/linkedin.xml`, `olx.xml`, `auctions.xml` — `<createTable>` com colunas hipotéticas do domínio + `<preCondition>`.

### Fase 2 — Extensão Chrome (MV3)
- `manifest.json` v3, `activeTab` + `scripting` + `host_permissions`, `background.service_worker`, `web_accessible_resources` como matriz de objetos restritos por domínio.
- `background.js` — listener `chrome.runtime.onMessage` → `chrome.action.setBadgeText({text, tabId: sender.tab.id})` + `setBadgeBackgroundColor({color: '#FF0000'})`. Contagem nula → `setBadgeText({text: '', tabId})`.
- `content.js` — lê `window.location.hostname`, faz mock de extração **sem strings executáveis**, envia `chrome.runtime.sendMessage` com o total.
- `popup.html` + `popup.js` — botão "Enviar para API" que captura dados e `fetch` POST para o backend.

### Fase 3 — Backend API
- Estrutura base FastAPI.
- Rota `POST /api/v1/ingest`.
- Função dinâmica que, dado `domain_id`, carrega JSON Schema e gera modelo Pydantic em runtime via `create_model`.
- Normalização purificada por domínio em funções puras antes da persistência.

## REGRAS DE ESTILO E RESTRIÇÕES
- Código limpo, SOLID, comentários explicando transformações dinâmicas.
- XMLs do Liquibase com namespace W3C completo, **sem changelog SQL formatado**.
- MV3 estrito — **proibido** `chrome.tabs.executeScript` ou execução de strings; apenas arquivos referenciados por path em `chrome.scripting.registerContentScripts`.

## Como o scaffold inicial respondeu

Ver árvore do projeto em `README.md`. Tudo containerizado via `docker-compose.yml`; extensão carregada manualmente em `chrome://extensions`. Backend escolhido: Python + FastAPI + Pydantic.
