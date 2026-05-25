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


--changeset claude:olx-002-house-attrs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='olx_listings'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='olx_listings' AND column_name='bedrooms'
ALTER TABLE olx_listings
    ADD COLUMN listing_kind  VARCHAR(64),
    ADD COLUMN bedrooms      INTEGER,
    ADD COLUMN bathrooms     INTEGER,
    ADD COLUMN garage_spaces INTEGER,
    ADD COLUMN area_m2       INTEGER,
    ADD COLUMN iptu_cents    BIGINT,
    ADD COLUMN image_url     VARCHAR(1024);
CREATE INDEX ix_olx_listings_bedrooms ON olx_listings(bedrooms);
--rollback DROP INDEX IF EXISTS ix_olx_listings_bedrooms;
--rollback ALTER TABLE olx_listings
--rollback     DROP COLUMN IF EXISTS image_url,
--rollback     DROP COLUMN IF EXISTS iptu_cents,
--rollback     DROP COLUMN IF EXISTS area_m2,
--rollback     DROP COLUMN IF EXISTS garage_spaces,
--rollback     DROP COLUMN IF EXISTS bathrooms,
--rollback     DROP COLUMN IF EXISTS bedrooms,
--rollback     DROP COLUMN IF EXISTS listing_kind;
