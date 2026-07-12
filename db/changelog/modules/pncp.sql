--liquibase formatted sql

--changeset claude:pncp-001-items
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='pncp_items'
CREATE TABLE pncp_items (
    id                         BIGSERIAL PRIMARY KEY,
    session_id                 BIGINT NOT NULL REFERENCES scrape_sessions(id),
    external_id                VARCHAR(128),
    pncp_id                    VARCHAR(128),
    numero_edital              VARCHAR(64),
    modalidade                 VARCHAR(128),
    modo_disputa               VARCHAR(64),
    orgao_cnpj                 VARCHAR(20),
    orgao_razao_social         VARCHAR(512),
    municipio                  VARCHAR(128),
    uf                         VARCHAR(2),
    objeto                     TEXT,
    valor_total_estimado       NUMERIC(18,2),
    valor_total_homologado     NUMERIC(18,2),
    situacao                   VARCHAR(64),
    srp                        BOOLEAN,
    amparo_legal               VARCHAR(128),
    data_publicacao_pncp       TIMESTAMPTZ,
    data_abertura_proposta     TIMESTAMPTZ,
    data_encerramento_proposta TIMESTAMPTZ,
    link_sistema_origem        VARCHAR(1024),
    url                        VARCHAR(1024),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_pncp_items_data_publicacao ON pncp_items(data_publicacao_pncp);
--rollback DROP INDEX IF EXISTS ix_pncp_items_data_publicacao;
--rollback DROP TABLE IF EXISTS pncp_items;

--changeset claude:pncp-002-external-id-idx
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'pncp_items' AND indexname = 'uq_pncp_items_external_id'
CREATE UNIQUE INDEX uq_pncp_items_external_id ON pncp_items(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_pncp_items_external_id;
