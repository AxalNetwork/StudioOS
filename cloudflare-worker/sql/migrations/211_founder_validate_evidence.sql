-- 211 — the hypothesis board, and the four facts about an interview that make
-- its numbers mean anything.
--
-- WHAT WAS ALREADY TRUE, and was understated when this was planned.
-- `/validate/hypotheses` shipped a card reading "No table in the product stores
-- one today". True of a TABLE. Misleading about the product:
-- `discovery_interviews.hypotheses_json` has held per-interview hypotheses all
-- along, shaped {hypothesis, status, evidence}, and TWO shipped surfaces read
-- them — `signalsSlider` (routes/progress.ts) scores discovery off the
-- validated/invalidated counts, and the Spin-Out demo-day deck builder quotes
-- them. Nothing here migrates, rewrites or deprecates that column. Both
-- readers keep working, untouched, off the same bytes.
--
-- WHAT IS GENUINELY ABSENT is a hypothesis as ONE object across many
-- interviews. A claim typed into three interviews is three unrelated strings
-- today; there is no id to hang a verdict, an evidence count or a link on.
--
-- THE SHAPE IS COPIED, NOT INVENTED. `pain_groups` + `pain_group_aliases`
-- (schema.sql:598) solved this exact problem for pains, and the comment there
-- states the rule: "Logged pains stay plain strings in
-- discovery_interviews.pains_json; these tables hold only the curation layer."
-- Same division here. The raw sentence stays in the JSON; these tables hold the
-- curation on top. Promoting hypotheses into a table of their own would make
-- one sentence exist in two places, and the two disagree the first time either
-- is edited.
--
-- ============================================================================
-- PART 1 — the facts about an interview this board needs
-- ============================================================================
--
-- These are captured when a conversation is LOGGED. There is no way to add them
-- from a board afterwards, which is why this migration reaches into the write
-- surface rather than staying in its own corner.
--
-- ICP FIT IS NOT ADDED HERE, BECAUSE IT ALREADY EXISTS. Migration 161 added
-- `discovery_interviews.icp_fit` (strong / partial / none, NULL = not yet
-- assessed), `routes/progress.ts` reads and writes it with a preserve-on-omit
-- rule, and it states the same NULL rule this file does: "consumers must not
-- fold null into 'none', or unassessed interviews would read as rejections."
-- The first draft of this migration re-added it. It would have failed the
-- production deploy with "duplicate column name: icp_fit" — the runner aborts
-- on the first bad statement — and it got as far as it did because the test
-- built the table from `schema.sql`, which does not carry migration 161's
-- ALTER. The test now builds the fourteen columns production actually has.
--
-- The lesson is recorded so the next person checks `PRAGMA table_info` against
-- production, not `CREATE TABLE` in `schema.sql`: that file is the shape the
-- table was BORN with, and every ALTER since lives only in the migrations.
--
-- EVERY COLUMN HERE IS NULLABLE, AND NULL MEANS "NOT RECORDED". Not false, not
-- zero, not "no". `quote_consent` is the one where the difference bites
-- hardest: a DEFAULT 0 would assert "this person declined to be quoted" on
-- every interview ever logged, which is a claim nobody made about anybody. "We
-- never asked" and "they said no" are different facts and the schema keeps
-- them different.
--
-- `users` is at D1's 100-column limit and an ALTER against it fails for an
-- existing column as readily as a new one. `discovery_interviews` has eleven
-- columns and is nowhere near it — which is the only reason these are columns
-- rather than another side table.
--
-- IDEMPOTENCY CAVEAT, stated the way migration 007 states it: D1's
-- `ALTER TABLE … ADD COLUMN` does NOT support IF NOT EXISTS. Re-running this
-- file after it has applied reports "duplicate column name: icp_fit" and stops.
-- That is expected and is why the runner keeps a ledger: each migration is
-- applied once, and `--baseline` records non-idempotent files without executing
-- them. Everything below this block IS idempotent (IF NOT EXISTS throughout),
-- so a re-run fails at the first ALTER and changes nothing.
--
-- This is the reason the test for this file does NOT assert replayability the
-- way `partner_delivery_stores.test.mjs` does for 208/209 — those two are
-- CREATE TABLE only. Asserting it here would be asserting something false.

ALTER TABLE discovery_interviews ADD COLUMN quote_consent INTEGER;
ALTER TABLE discovery_interviews ADD COLUMN interviewee_company TEXT;

-- Severity is per PAIN, not per interview — one conversation can name a
-- must-have and a nice-to-have in the same breath — so it cannot be a column
-- above. Keyed on the phrase for the same reason `pain_group_aliases` is:
-- pains are plain strings by design and this must not reopen that.
CREATE TABLE IF NOT EXISTS interview_pain_severities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id INTEGER NOT NULL REFERENCES discovery_interviews(id) ON DELETE CASCADE,
    phrase_norm TEXT NOT NULL,
    severity TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_pain_sev_unique
    ON interview_pain_severities (interview_id, phrase_norm);

-- ============================================================================
-- PART 2 — the board
-- ============================================================================

CREATE TABLE IF NOT EXISTS hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The founder-facing handle ("H1"). Stored rather than derived from row
    -- order: the canvas prints it on every card and in every receipts panel, so
    -- it is an identifier a person reads and repeats, and renumbering it when a
    -- sibling is retired would silently rewrite what they wrote down.
    code TEXT NOT NULL,
    claim TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- Retired, not deleted. The canvas draws "Retired" and "Retired claims"
    -- filters; a filter over a fact nothing stores is a control that does
    -- nothing. A hypothesis that was abandoned is also evidence about how the
    -- venture thought, which a DELETE would throw away.
    retired_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_project
    ON hypotheses (project_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hypotheses_project_code
    ON hypotheses (project_id, code);

-- The signed link is what makes "For" and "Against" two different numbers
-- rather than one count printed twice. Without a direction the whole summary
-- collapses into "interviews that mentioned this", which is not a verdict.
CREATE TABLE IF NOT EXISTS hypothesis_pain_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    pain_group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hypothesis_pain_links_unique
    ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction);

CREATE INDEX IF NOT EXISTS idx_hypothesis_pain_links_group
    ON hypothesis_pain_links (pain_group_id);

-- ============================================================================
-- PART 3 — the founder's own decision
-- ============================================================================
--
-- SEPARATE FROM THE SUMMARY, AND THAT IS THE POINT. The canvas's verdicts are
-- per hypothesis and COMPUTED — "a work board whose lanes the founder cannot
-- drag; every card sits where its evidence count puts it". This table is the
-- other thing: what the venture DECIDED, which no amount of evidence computes.
-- The two live side by side because one is a reading of the interviews and the
-- other is a choice a person made in front of it.
--
-- IT IS ALSO THE ONE ROW HERE WITH A NARROWER AUDIENCE. The board and summary
-- are derived from interviews and are read by whoever may read the interviews
-- (admin and partner). A founder writing "we are stopping" into a row an
-- outside service firm can read is a founder with a reason not to write it
-- honestly, so its route admits the founder and admins only. That check lives
-- in routes/founder_validate.ts, not here — SQL cannot express it — which is
-- why the worker test for it is the first one written.
--
-- SUPERSEDED, NEVER OVERWRITTEN. A decision that silently vanishes when the
-- next one is taken is not a record of a decision; it is a record of the
-- current mood. Same reasoning as migration 209's consent rows, which keep a
-- withdrawal rather than deleting the grant.
CREATE TABLE IF NOT EXISTS validation_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    reasoning TEXT,
    decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    superseded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_validation_decisions_project
    ON validation_decisions (project_id, superseded_at);

-- ============================================================================
-- WHAT IS DELIBERATELY NOT HERE
-- ============================================================================
--
-- NOTHING DERIVED. No verdict column, no lane, no for/against count, no
-- deck-ready flag, no utilisation-style rollup. Every one is computable from
-- the rows above plus the interviews, and storing one makes it a second answer
-- to a question three tables already answer — which disagrees the first moment
-- an interview is edited. `signalsSlider` already counts validated/invalidated
-- from `hypotheses_json`; a stored count here would be a THIRD number for one
-- fact.
--
-- NO VALIDATION-BAR SETTINGS ROW. The bar is five supporting ICP interviews,
-- and it is a constant the code applies rather than a per-project setting.
-- A settings table nobody can write to is a table pretending to be a feature;
-- the pages say the bar is five and say it is not configurable yet.
--
-- NO VERDICT HISTORY, NO PERSISTED AI SUMMARY, NO SCREENING STATE. The canvas
-- draws all three ("As of last week", "Changed this month", the proposal panel,
-- the Screened badge). They are real and they are not in this pass, so the
-- pages state their absence instead of shipping filter chips that filter
-- nothing.
