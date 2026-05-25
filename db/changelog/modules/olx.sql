--liquibase formatted sql

--changeset claude:olx-001-listings
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='olx_listings'
CREATE TABLE olx_listings (
    id          BIGSERIAL     PRIMARY KEY,
    session_id  BIGINT        NOT NULL REFERENCES scrape_sessions(id),
    title       VARCHAR(512)  NOT NULL,
    price_cents BIGINT,
    currency    CHAR(3)       DEFAULT 'BRL',
    category    VARCHAR(128),
    city        VARCHAR(128),
    state       VARCHAR(64),
    latitude    NUMERIC(9,6),
    longitude   NUMERIC(9,6),
    images      JSONB,
    url         VARCHAR(1024) NOT NULL,
    posted_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_olx_listings_category ON olx_listings(category);
--rollback DROP INDEX IF EXISTS ix_olx_listings_category;
--rollback DROP TABLE IF EXISTS olx_listings;
