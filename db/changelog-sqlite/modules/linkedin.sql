--liquibase formatted sql

--changeset claude:linkedin-001-jobs
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:1 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='scrape_sessions'
--precondition-sql-check expectedResult:0 SELECT count(*) FROM sqlite_master WHERE type='table' AND name='linkedin_jobs'
CREATE TABLE linkedin_jobs (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER  NOT NULL REFERENCES scrape_sessions(id),
    job_title  TEXT     NOT NULL,
    company    TEXT,
    location   TEXT,
    seniority  TEXT,
    skills     TEXT,
    posted_at  TEXT,
    created_at TEXT     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--rollback DROP TABLE IF EXISTS linkedin_jobs;


--changeset claude:linkedin-002-external-id
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('linkedin_jobs') WHERE name='external_id'
ALTER TABLE linkedin_jobs ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX uq_linkedin_jobs_external_id ON linkedin_jobs(external_id) WHERE external_id IS NOT NULL;
--rollback DROP INDEX IF EXISTS uq_linkedin_jobs_external_id;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN external_id;


--changeset claude:linkedin-003-url
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('linkedin_jobs') WHERE name='url'
ALTER TABLE linkedin_jobs ADD COLUMN url TEXT;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN url;


--changeset claude:linkedin-004-detail-fields
--preconditions onFail:HALT onError:HALT
--precondition-sql-check expectedResult:0 SELECT count(*) FROM pragma_table_info('linkedin_jobs') WHERE name='description'
ALTER TABLE linkedin_jobs ADD COLUMN description TEXT;
ALTER TABLE linkedin_jobs ADD COLUMN workplace_type TEXT;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN description;
--rollback ALTER TABLE linkedin_jobs DROP COLUMN workplace_type;
