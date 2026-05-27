--liquibase formatted sql

--changeset claude:linkedin-001-jobs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='linkedin_jobs'
CREATE TABLE linkedin_jobs (
    id         BIGSERIAL    PRIMARY KEY,
    session_id BIGINT       NOT NULL REFERENCES scrape_sessions(id),
    job_title  VARCHAR(256) NOT NULL,
    company    VARCHAR(256),
    location   VARCHAR(256),
    seniority  VARCHAR(64),
    skills     JSONB,
    posted_at  TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
--rollback DROP TABLE IF EXISTS linkedin_jobs;


--changeset claude:linkedin-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_jobs' AND column_name='external_id'
ALTER TABLE linkedin_jobs ADD COLUMN external_id VARCHAR(64);
CREATE UNIQUE INDEX uq_linkedin_jobs_external_id ON linkedin_jobs(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_jobs_external_id;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS external_id;


--changeset claude:linkedin-003-url
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_jobs' AND column_name='url'
ALTER TABLE linkedin_jobs ADD COLUMN url VARCHAR(512);
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS url;


--changeset claude:linkedin-004-detail-fields
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_jobs' AND column_name='description'
ALTER TABLE linkedin_jobs ADD COLUMN description TEXT;
ALTER TABLE linkedin_jobs ADD COLUMN workplace_type VARCHAR(32);
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS description;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS workplace_type;


--changeset claude:linkedin-005-detail-extra
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_jobs' AND column_name='employment_type'
ALTER TABLE linkedin_jobs ADD COLUMN employment_type VARCHAR(64);
ALTER TABLE linkedin_jobs ADD COLUMN job_function VARCHAR(128);
ALTER TABLE linkedin_jobs ADD COLUMN industries VARCHAR(256);
ALTER TABLE linkedin_jobs ADD COLUMN raw_json JSONB;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS employment_type;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS job_function;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS industries;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS raw_json;
