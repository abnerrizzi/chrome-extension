--liquibase formatted sql

--changeset claude:olx-001-listings
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='olx_listings'
CREATE TABLE olx_listings (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER  NOT NULL REFERENCES scrape_sessions(id),
    title       TEXT     NOT NULL,
    price_cents INTEGER,
    currency    TEXT     DEFAULT 'BRL',
    category    TEXT,
    city        TEXT,
    state       TEXT,
    latitude    NUMERIC,
    longitude   NUMERIC,
    images      TEXT,
    url         TEXT     NOT NULL,
    posted_at   TEXT,
    created_at  TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_olx_listings_category ON olx_listings(category);
--rollback DROP INDEX IF EXISTS ix_olx_listings_category;
--rollback DROP TABLE IF EXISTS olx_listings;


--changeset claude:olx-002-house-attrs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='olx_listings'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='bedrooms'
ALTER TABLE olx_listings ADD COLUMN listing_kind  TEXT;
ALTER TABLE olx_listings ADD COLUMN bedrooms      INTEGER;
ALTER TABLE olx_listings ADD COLUMN bathrooms     INTEGER;
ALTER TABLE olx_listings ADD COLUMN garage_spaces INTEGER;
ALTER TABLE olx_listings ADD COLUMN area_m2       INTEGER;
ALTER TABLE olx_listings ADD COLUMN iptu_cents    INTEGER;
ALTER TABLE olx_listings ADD COLUMN image_url     TEXT;
CREATE INDEX ix_olx_listings_bedrooms ON olx_listings(bedrooms);
--rollback DROP INDEX IF EXISTS ix_olx_listings_bedrooms;
--rollback ALTER TABLE olx_listings DROP COLUMN image_url;
--rollback ALTER TABLE olx_listings DROP COLUMN iptu_cents;
--rollback ALTER TABLE olx_listings DROP COLUMN area_m2;
--rollback ALTER TABLE olx_listings DROP COLUMN garage_spaces;
--rollback ALTER TABLE olx_listings DROP COLUMN bathrooms;
--rollback ALTER TABLE olx_listings DROP COLUMN bedrooms;
--rollback ALTER TABLE olx_listings DROP COLUMN listing_kind;


--changeset claude:olx-003-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='external_id'
ALTER TABLE olx_listings ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_olx_listings_external_id ON olx_listings(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_olx_listings_external_id;
--rollback ALTER TABLE olx_listings DROP COLUMN external_id;


--changeset claude:olx-004-modules
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='neighbourhood'
ALTER TABLE olx_listings ADD COLUMN neighbourhood    TEXT;
ALTER TABLE olx_listings ADD COLUMN kind             TEXT;
ALTER TABLE olx_listings ADD COLUMN real_estate_type TEXT;
CREATE INDEX ix_olx_listings_kind ON olx_listings(kind);
CREATE INDEX ix_olx_listings_neighbourhood ON olx_listings(neighbourhood);
--rollback DROP INDEX IF EXISTS ix_olx_listings_neighbourhood;
--rollback DROP INDEX IF EXISTS ix_olx_listings_kind;
--rollback ALTER TABLE olx_listings DROP COLUMN real_estate_type;
--rollback ALTER TABLE olx_listings DROP COLUMN kind;
--rollback ALTER TABLE olx_listings DROP COLUMN neighbourhood;


--changeset claude:olx-005-price-amount
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='price_cents'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='price'
ALTER TABLE olx_listings ADD COLUMN price NUMERIC;
ALTER TABLE olx_listings ADD COLUMN iptu  NUMERIC;
UPDATE olx_listings SET
    price = CAST(price_cents AS REAL) / 100.0,
    iptu  = CAST(iptu_cents  AS REAL) / 100.0;
ALTER TABLE olx_listings DROP COLUMN price_cents;
ALTER TABLE olx_listings DROP COLUMN iptu_cents;
--rollback ALTER TABLE olx_listings ADD COLUMN price_cents INTEGER;
--rollback ALTER TABLE olx_listings ADD COLUMN iptu_cents  INTEGER;
--rollback UPDATE olx_listings SET
--rollback     price_cents = CAST(price * 100 AS INTEGER),
--rollback     iptu_cents  = CAST(iptu  * 100 AS INTEGER);
--rollback ALTER TABLE olx_listings DROP COLUMN price;
--rollback ALTER TABLE olx_listings DROP COLUMN iptu;


--changeset claude:olx-006-drop-unused-columns
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM pragma_table_info('olx_listings') WHERE name='latitude'
ALTER TABLE olx_listings DROP COLUMN latitude;
ALTER TABLE olx_listings DROP COLUMN longitude;
ALTER TABLE olx_listings DROP COLUMN images;
--rollback ALTER TABLE olx_listings ADD COLUMN latitude  NUMERIC;
--rollback ALTER TABLE olx_listings ADD COLUMN longitude NUMERIC;
--rollback ALTER TABLE olx_listings ADD COLUMN images    TEXT;
