--liquibase formatted sql

--changeset claude:core-001-scrape-sessions
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
CREATE TABLE scrape_sessions (
    id          INTEGER     PRIMARY KEY AUTOINCREMENT,
    domain_name TEXT        NOT NULL,
    item_count  INTEGER     NOT NULL DEFAULT 0,
    created_at  TEXT        NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_scrape_sessions_domain ON scrape_sessions(domain_name);
--rollback DROP INDEX IF EXISTS ix_scrape_sessions_domain;
--rollback DROP TABLE IF EXISTS scrape_sessions;
