--liquibase formatted sql

--changeset claude:pncp-001-items
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='pncp_items'
CREATE TABLE pncp_items (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id                 INTEGER NOT NULL REFERENCES scrape_sessions(id),
    external_id                TEXT,
    pncp_id                    TEXT,
    numero_edital              TEXT,
    modalidade                 TEXT,
    modo_disputa               TEXT,
    orgao_cnpj                 TEXT,
    orgao_razao_social         TEXT,
    municipio                  TEXT,
    uf                         TEXT,
    objeto                     TEXT,
    valor_total_estimado       NUMERIC,
    valor_total_homologado     NUMERIC,
    situacao                   TEXT,
    srp                        INTEGER,
    amparo_legal               TEXT,
    data_publicacao_pncp       TEXT,
    data_abertura_proposta     TEXT,
    data_encerramento_proposta TEXT,
    link_sistema_origem        TEXT,
    url                        TEXT,
    created_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_pncp_items_data_publicacao ON pncp_items(data_publicacao_pncp);
--rollback DROP INDEX IF EXISTS ix_pncp_items_data_publicacao;
--rollback DROP TABLE IF EXISTS pncp_items;

--changeset claude:pncp-002-external-id-idx
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='index' AND name='uq_pncp_items_external_id'
CREATE UNIQUE INDEX uq_pncp_items_external_id ON pncp_items(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_pncp_items_external_id;
