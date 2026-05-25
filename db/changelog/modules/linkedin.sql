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
