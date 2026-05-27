# `agents/` — specs for handing off module work to Claude Code

Stable input briefs for future Claude Code sessions. Each file is self-contained
enough to be pasted as the opening prompt of a new session ("Build this module
following this contract"), but they cross-reference each other so the set is
also browsable end-to-end.

This is **not** the day-to-day orientation doc — `CLAUDE.md` at the repo root
remains the canonical "how this codebase works" reference. The files here are
for one specific use case: starting a new piece of work on a fresh context,
where reading the entire codebase first would be wasteful.

## Contents

- [`architecture.md`](architecture.md) — three-layer system spec (extension, API, DB), end-to-end data flow, invariants that must not be broken, and what is intentionally out of scope.
- [`add-domain-module.md`](add-domain-module.md) — the reusable contract for adding a new domain module. Five files in lockstep, type-mapping table (Postgres ↔ SQLite), verification checklist. Hand this to a session along with the domain-specific brief.
- [`domain-olx.md`](domain-olx.md) — reference implementation notes. OLX is the gold standard; read this when designing a new domain that needs `__NEXT_DATA__`-style extraction or non-trivial normalization.
- [`domain-auctions.md`](domain-auctions.md) — placeholder module against a non-existent host; scaffolding only. Reuse when a real auctions site is targeted.
- [`claude-code-prompt.md`](claude-code-prompt.md) — historical record of the original scaffold prompt. Kept for context, not for direct reuse.

## How to use these when starting new module work

1. Open a fresh Claude Code session in this repo.
2. Hand it `architecture.md` + `add-domain-module.md` + the relevant `domain-<name>.md`.
3. Add the domain-specific inputs the recipe asks for (URL pattern, data source, field list).
4. Let it implement against the five-files-in-lockstep contract.
5. Run the verification checklist from `add-domain-module.md` before declaring done.
