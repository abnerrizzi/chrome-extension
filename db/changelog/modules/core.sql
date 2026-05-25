--liquibase formatted sql

--changeset claude:core-001-scrape-sessions
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
CREATE TABLE scrape_sessions (
    id          BIGSERIAL    PRIMARY KEY,
    domain_name VARCHAR(64)  NOT NULL,
    item_count  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_scrape_sessions_domain ON scrape_sessions(domain_name);
--rollback DROP INDEX IF EXISTS ix_scrape_sessions_domain;
--rollback DROP TABLE IF EXISTS scrape_sessions;
