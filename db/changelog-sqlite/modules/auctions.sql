--liquibase formatted sql

--changeset claude:auctions-001-items
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='auction_items'
CREATE TABLE auction_items (
    id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id          INTEGER  NOT NULL REFERENCES scrape_sessions(id),
    lot_code            TEXT     NOT NULL,
    title               TEXT     NOT NULL,
    current_bid_cents   INTEGER  NOT NULL,
    min_increment_cents INTEGER,
    currency            TEXT     DEFAULT 'BRL',
    auction_end         TEXT     NOT NULL,
    url                 TEXT     NOT NULL,
    created_at          TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_auction_items_end ON auction_items(auction_end);
--rollback DROP INDEX IF EXISTS ix_auction_items_end;
--rollback DROP TABLE IF EXISTS auction_items;


--changeset claude:auctions-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('auction_items') WHERE name='external_id'
ALTER TABLE auction_items ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_auction_items_external_id ON auction_items(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_auction_items_external_id;
--rollback ALTER TABLE auction_items DROP COLUMN external_id;
