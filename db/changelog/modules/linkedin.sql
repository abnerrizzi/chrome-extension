--liquibase formatted sql

--changeset claude:linkedin-001-jobs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='linkedin_jobs'
CREATE TABLE linkedin_jobs (
    id          BIGSERIAL     PRIMARY KEY,
    session_id  BIGINT        NOT NULL REFERENCES scrape_sessions(id),
    title       VARCHAR(512)  NOT NULL,
    company     VARCHAR(256),
    location    VARCHAR(256),
    url         VARCHAR(1024) NOT NULL,
    posted_at   TIMESTAMPTZ,
    source_view VARCHAR(16),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_linkedin_jobs_company ON linkedin_jobs(company);
--rollback DROP INDEX IF EXISTS ix_linkedin_jobs_company;
--rollback DROP TABLE IF EXISTS linkedin_jobs;


--changeset claude:linkedin-002-jobs-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_jobs' AND column_name='external_id'
ALTER TABLE linkedin_jobs ADD COLUMN external_id VARCHAR(64);
CREATE UNIQUE INDEX uq_linkedin_jobs_external_id ON linkedin_jobs(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_jobs_external_id;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN IF EXISTS external_id;


--changeset claude:linkedin-003-details
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='linkedin_job_details'
CREATE TABLE linkedin_job_details (
    id              BIGSERIAL     PRIMARY KEY,
    session_id      BIGINT        NOT NULL REFERENCES scrape_sessions(id),
    title           VARCHAR(512)  NOT NULL,
    company         VARCHAR(256),
    location        VARCHAR(256),
    url             VARCHAR(1024) NOT NULL,
    description     TEXT,
    seniority       VARCHAR(128),
    employment_type VARCHAR(128),
    applicants      INTEGER,
    source_view     VARCHAR(16),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_linkedin_job_details_seniority ON linkedin_job_details(seniority);
--rollback DROP INDEX IF EXISTS ix_linkedin_job_details_seniority;
--rollback DROP TABLE IF EXISTS linkedin_job_details;


--changeset claude:linkedin-004-details-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='linkedin_job_details' AND column_name='external_id'
ALTER TABLE linkedin_job_details ADD COLUMN external_id VARCHAR(64);
CREATE UNIQUE INDEX uq_linkedin_job_details_external_id ON linkedin_job_details(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_job_details_external_id;
--rollback ALTER TABLE linkedin_job_details DROP COLUMN IF EXISTS external_id;
