--liquibase formatted sql

--changeset claude:auctions-001-items
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='auction_items'
CREATE TABLE auction_items (
    id                  BIGSERIAL     PRIMARY KEY,
    session_id          BIGINT        NOT NULL REFERENCES scrape_sessions(id),
    lot_code            VARCHAR(64)   NOT NULL,
    title               VARCHAR(512)  NOT NULL,
    current_bid_cents   BIGINT        NOT NULL,
    min_increment_cents BIGINT,
    currency            CHAR(3)       DEFAULT 'BRL',
    auction_end         TIMESTAMPTZ   NOT NULL,
    url                 VARCHAR(1024) NOT NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_auction_items_end ON auction_items(auction_end);
--rollback DROP INDEX IF EXISTS ix_auction_items_end;
--rollback DROP TABLE IF EXISTS auction_items;


--changeset claude:auctions-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='auction_items' AND column_name='external_id'
ALTER TABLE auction_items ADD COLUMN external_id VARCHAR(64);
CREATE UNIQUE INDEX uq_auction_items_external_id ON auction_items(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_auction_items_external_id;
--rollback ALTER TABLE auction_items DROP COLUMN IF EXISTS external_id;
