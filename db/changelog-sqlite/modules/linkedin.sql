--liquibase formatted sql

--changeset claude:linkedin-001-jobs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='linkedin_jobs'
CREATE TABLE linkedin_jobs (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER  NOT NULL REFERENCES scrape_sessions(id),
    title       TEXT     NOT NULL,
    company     TEXT,
    location    TEXT,
    url         TEXT     NOT NULL,
    posted_at   TEXT,
    source_view TEXT,
    created_at  TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_linkedin_jobs_company ON linkedin_jobs(company);
--rollback DROP INDEX IF EXISTS ix_linkedin_jobs_company;
--rollback DROP TABLE IF EXISTS linkedin_jobs;


--changeset claude:linkedin-002-jobs-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('linkedin_jobs') WHERE name='external_id'
ALTER TABLE linkedin_jobs ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_linkedin_jobs_external_id ON linkedin_jobs(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_jobs_external_id;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN external_id;


--changeset claude:linkedin-003-details
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='linkedin_job_details'
CREATE TABLE linkedin_job_details (
    id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER  NOT NULL REFERENCES scrape_sessions(id),
    title           TEXT     NOT NULL,
    company         TEXT,
    location        TEXT,
    url             TEXT     NOT NULL,
    description     TEXT,
    seniority       TEXT,
    employment_type TEXT,
    applicants      INTEGER,
    source_view     TEXT,
    created_at      TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_linkedin_job_details_seniority ON linkedin_job_details(seniority);
--rollback DROP INDEX IF EXISTS ix_linkedin_job_details_seniority;
--rollback DROP TABLE IF EXISTS linkedin_job_details;


--changeset claude:linkedin-004-details-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('linkedin_job_details') WHERE name='external_id'
ALTER TABLE linkedin_job_details ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_linkedin_job_details_external_id ON linkedin_job_details(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_job_details_external_id;
--rollback ALTER TABLE linkedin_job_details DROP COLUMN external_id;
