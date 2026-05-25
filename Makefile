# Pipeline end-to-end equivalente ao parser da extensão:
#   fetch  → extract → ingest → sessions
# Tudo containerizado (curl-impersonate via Docker contorna o Cloudflare do OLX).

SHELL       := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

API         ?= http://localhost:8000
URL         ?= https://www.olx.com.br/imoveis/venda/estado-go?q=casa%20setor%20jao,%20goiania&rfs=115
URL	    ?= https://www.olx.com.br/imoveis/aluguel/estado-go/grande-goiania-e-anapolis?pe=4500&q=setor%20jao
OUT_DIR     := tmp
HTML        := $(OUT_DIR)/olx_live.html
RAW         := $(OUT_DIR)/olx_next_data.json
PAYLOAD     := $(OUT_DIR)/olx_payload.json
IMPERSONATE := lwthiker/curl-impersonate:0.5-chrome
BROWSER     := curl_chrome110

.DEFAULT_GOAL := help

help:  ## mostra os targets disponíveis
	@awk 'BEGIN{FS=":.*?## "} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

$(OUT_DIR):
	@mkdir -p $(OUT_DIR)

fetch: | $(OUT_DIR)  ## baixa a página OLX (URL=...) via curl-impersonate (bypassa Cloudflare)
	@echo "→ fetch  $(URL)"
	@docker run --rm -v "$(CURDIR)/$(OUT_DIR):/out" $(IMPERSONATE) \
		$(BROWSER) -sL -o /out/$(notdir $(HTML)) \
		-w 'http=%{http_code} size=%{size_download}\n' "$(URL)"
	@grep -q '__NEXT_DATA__' $(HTML) || (echo "✘ __NEXT_DATA__ ausente — Cloudflare provavelmente bloqueou"; exit 1)

raw: $(RAW)  ## extrai apenas o JSON cru do <script id="__NEXT_DATA__">
$(RAW): $(HTML)
	@python3 scripts/dump_next_data.py $(HTML) $(RAW)

extract: $(RAW)  ## extrai casas a partir do __NEXT_DATA__ cru (mesma lógica do parser JS)
	@python3 scripts/extract_olx.py $(RAW) $(PAYLOAD)

ingest: $(PAYLOAD)  ## envia o payload extraído para a API e formata o resultado
	@echo "→ POST   $(API)/api/v1/ingest"
	@curl -sS -X POST $(API)/api/v1/ingest \
		-H 'Content-Type: application/json' \
		--data @$(PAYLOAD) | python3 -m json.tool

run: fetch extract ingest  ## pipeline completo: fetch → extract → ingest

sessions:  ## lista as últimas sessões persistidas
	@curl -sS $(API)/api/v1/sessions?limit=10 | python3 -m json.tool

session-%:  ## detalha uma sessão (uso: make session-25)
	@curl -sS $(API)/api/v1/sessions/$* | python3 -m json.tool

clean:  ## limpa artefatos intermediários
	@rm -rf $(HTML) $(RAW) $(PAYLOAD)
	@echo "✓ tmp/olx_*.{html,json} removidos"

up-postgres:  ## sobe stack Postgres (db + liquibase update + api)
	@docker compose --profile postgres up -d db
	@docker compose --profile postgres run --rm liquibase update
	@docker compose up -d api

up-sqlite:  ## sobe stack SQLite (liquibase-sqlite update + api)
	@mkdir -p data
	@docker compose --profile sqlite run --rm liquibase-sqlite update
	@DATABASE_URL=$${DATABASE_URL:-sqlite:////data/scraper.db} docker compose up -d api

down:  ## para todos os serviços de todos os perfis
	@docker compose --profile postgres --profile sqlite down

.PHONY: help fetch raw extract ingest run sessions clean up-postgres up-sqlite down
