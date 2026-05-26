# Domain: LinkedIn

**What this is.** Current state of the LinkedIn module (a stub) plus a brief
for fleshing it out properly. This doc is the natural input prompt for the
next module work.

**When to use it.** Hand this to a fresh Claude Code session along with
[`architecture.md`](architecture.md), [`add-domain-module.md`](add-domain-module.md),
and [`domain-olx.md`](domain-olx.md) (gold reference) when starting the
fleshout.

---

## Current state (as of writing)

The module is **scaffolded but minimal**. The five files exist, the
end-to-end flow works on simple cases, but the captured field list is small
and the parser is fragile.

| File                                            | Lines | Notes                                       |
|-------------------------------------------------|-------|---------------------------------------------|
| `extension/parsers/linkedin_parser.js`          | 29    | DOM-only, two selectors, no date/salary     |
| `api/app/schemas/linkedin.json`                 | 13    | 5 properties (`job_title`, `company`, …)    |
| `api/app/normalization/linkedin.py`             | 15    | Near pass-through (strip + nullify empty)   |
| `db/changelog/modules/linkedin.sql`             | 28    | Table `linkedin_jobs`, has unused columns   |
| `db/changelog-sqlite/modules/linkedin.sql`      | (parallel) | Same shape as Postgres                 |
| `api/app/core/persistence.py:54`                | -     | Branch in `_insert_items`                   |

Compare with OLX (parser 161 lines, schema 27 lines, normalizer 122 lines)
to see the gap.

### What works today

- Parser keys off `li.jobs-search-results__list-item` or `[data-job-id]`.
- Captures: `external_id`, `job_title`, `company`, `location`, `url`.
- Dedup via `linkedin_jobs.external_id` partial unique index
  (changeset `linkedin-002`).
- Round-trip through `/api/v1/ingest` persists rows.

### What doesn't work / is missing

- **`linkedin_jobs` table has unused columns.** The initial DDL declared
  `seniority VARCHAR(64)`, `skills JSONB`, `posted_at TIMESTAMPTZ` — none of
  which the parser, schema, or normalizer populate. They were aspirational.
  Either populate them or drop them (clean up the migration trail) when
  fleshing out.
- **No `posted_at` capture.** LinkedIn shows relative times
  (`"2 days ago"`, `"3 weeks ago"`) — needs a normalizer similar to OLX's
  `_date_to_iso` but for relative durations.
- **No salary / compensation.** Many cards expose a salary range; not
  captured.
- **No employment type / remote-onsite flag.** Available in the card metadata
  but not parsed.
- **No applicant count / seniority.** Visible in card body when present.
- **Class-name fragility.** LinkedIn rotates DOM class names. Today's
  selectors (`.job-card-list__title`, `.job-card-container__primary-description`,
  `.job-card-container__metadata-item`) will break without notice.
- **No auth-protected pages handled.** Search results work logged-out but
  detail pages typically require login.

---

## Fleshout brief

A future Claude Code session should be able to read this and start the work.

### Goal

Bring LinkedIn parity with OLX in field coverage and robustness:

- Capture the additional fields listed above.
- Reduce class-name fragility (consider the Voyager API trade-off below).
- Clean up dead columns or populate them.
- Add tests covering the new normalizer paths.

### Decision to make first: DOM vs. Voyager API

LinkedIn's frontend talks to an internal GraphQL-ish API (`voyager`) whose
responses contain richer, more stable data. Two viable approaches:

1. **DOM parsing (current path).** Keeps the parser purely client-side,
   no auth complexity. Brittle to class rotation. Workable if the parser
   captures by **stable structural patterns** rather than class names
   (e.g. `[data-job-id] a[href*="/jobs/view/"]`, attribute-based selectors).
2. **XHR/fetch interception.** Hook `chrome.webRequest` (or content-script
   `fetch` wrapper) to read Voyager responses as they fly by. Richer data,
   resilient to UI changes. More complex; potentially against LinkedIn's
   ToS depending on use case. Confirm with the requester before going this
   route.

Recommendation: start with hardened DOM selectors (attribute-based, fewer
class names), document the selectors heavily; add Voyager interception only
if the user explicitly opts in.

### Suggested field additions

| Field              | Source                                                       | Normalizer                                 |
|--------------------|--------------------------------------------------------------|--------------------------------------------|
| `posted_at`        | Relative time text (`"2 days ago"`, `"há 3 semanas"`)        | Subtract from `now()`, output ISO-8601     |
| `salary_min`       | Card salary text (`"R$ 8.000 - R$ 12.000/mês"`)              | Strip currency, parse min                  |
| `salary_max`       | Same source                                                   | Parse max                                  |
| `salary_currency`  | Symbol from same string                                       | Map (`R$`→BRL, `$`→USD, etc.)              |
| `salary_period`    | Same source (`"/mês"`, `"/yr"`)                              | Enum: `month`/`year`/`hour`                |
| `employment_type`  | Card metadata pill                                            | Enum: `full_time`/`contract`/`internship`  |
| `remote_status`    | Card metadata (`"Remoto"`, `"Híbrido"`, `"Presencial"`)      | Enum: `remote`/`hybrid`/`onsite`           |
| `seniority`        | Card title or metadata                                        | Heuristic from title                       |
| `applicants`       | Card body text (`"50 candidatos"`)                            | Extract integer                            |

### Files to change (mirror the recipe)

1. **`api/app/schemas/linkedin.json`** — add the new fields with
   `_raw` suffix where they need normalization.
2. **`extension/parsers/linkedin_parser.js`** — broaden selectors, add the
   new field extractions. Header comment documenting every selector.
3. **`api/app/normalization/linkedin.py`** — add the date / salary / enum
   normalizers. Pure functions, copy the OLX style.
4. **`db/changelog/modules/linkedin.sql`** + parallel SQLite — new
   changeset `linkedin-003-fields` adding the columns (split into multiple
   `ALTER TABLE` statements on SQLite per the type-mapping table). Optional
   `linkedin-004-cleanup` to drop or repurpose `seniority`/`skills`/`posted_at`
   if you decide they were misnamed.
5. **`api/app/core/persistence.py:54`** — extend the `linkedin` branch's
   column list and parameter tuple.
6. **`api/tests/`** — add `test_linkedin_normalization.py` covering each
   normalizer (relative date, salary range, enum mappings).

### Verification

Run the full checklist from
[`add-domain-module.md`](add-domain-module.md#verification-checklist). In
particular: load the extension, open a logged-out LinkedIn search results
page, confirm badge count and the new fields appear in the popup preview and
in the response from `GET /api/v1/sessions/{id}`.
