-- 246 — "AI fills the blanks" stops being one workspace's feature, and a
-- researched figure learns to say where it came from.
--
-- Migration 214 built the proposal contract for founder Validate: pending /
-- accepted / discarded, `payload_json` read once on accept, discards never
-- deleted, and `model` taken from the router's usage metadata so the name on a
-- proposal is the model that actually ran. That contract is right and none of
-- it changes here. What changes is its reach.
--
-- WHY THIS IS NOT A COPY-PASTE ACROSS SURFACES, which is the whole reason this
-- migration needs a header rather than four ALTER lines.
--
-- D46's honesty mechanism is MATCH-BACK: "every item is matched back against
-- something that exists in the project before it can become a row".
-- `parseTagProposals` refuses a phrase that is not in the project's own
-- ungrouped set and a `pain_group_id` that is not in its own groups;
-- `parseDraftProposals` refuses a claim that restates one already on file. That
-- works because both of Validate's fills are RESTATEMENTS of evidence the
-- founder logged themselves.
--
-- A market size is not in the project. The entire point of asking for TAM is
-- that it comes from outside, so match-back cannot apply to it — and with no
-- replacement, filling TAM means writing an unsourced number into a column a
-- founder-DERIVED figure occupies. `SpinoutLabMarketPage` computes TAM from an
-- addressable population and an ACV the founder supplied. The moment a model
-- can write to `projects.tam`, that column stops distinguishing a figure
-- somebody reasoned to from one a model produced, silently and forever.
--
-- So the generalisation needs a second guarantee, and these two columns are it.
--
-- THREE FILL CLASSES, THREE GUARANTEES. Naming them is what keeps this honest,
-- because they are not interchangeable and only the first is built today:
--
--   restatement   pain tags, hypotheses, a segment drawn from logged customers.
--                 Guarantee: matched back against an existing row. Unchanged.
--   sourced       TAM/SAM, a competitor set, a jurisdiction from a registry.
--                 Guarantee: a citation naming where it came from. NO CITATION
--                 MEANS THE PROPOSAL IS DROPPED — not written with a null, not
--                 written with a hedge. Exactly as an unmatched phrase is
--                 dropped today.
--   composition   a tagline, positioning copy. It cites nothing because it
--                 claims nothing, and it may never occupy a column a MEASURED
--                 value occupies.
--
-- THE TABLE KEEPS ITS NAME, and that is a deliberate trade rather than an
-- oversight. `validate_proposals` will hold a brand-copy proposal and read
-- oddly. Renaming it means rewriting the baseline, both index names and every
-- reference while `scripts/check-baseline-drift.mjs` verifies production
-- against that baseline — a real operation with a real half-applied state. The
-- name records where the table started, not what it serves. Renaming it is its
-- own task if the name ever costs more than the risk of moving it.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a migration
-- file — migration 200 shipped with them and failed the production deploy at
-- the migration step (see `scripts/check-sql-migrations.mjs`).

-- ---------------------------------------------------------------------------
-- Part 1 — `validate_proposals` grows the four columns a second surface needs.
-- ---------------------------------------------------------------------------

-- Which surface asked for this. A zone key — 'validate/pain-map',
-- 'grow/market', 'build/brand' — so the list read can scope to the page the
-- reader is on rather than returning another workspace's suggestions into it.
-- Nullable because the rows that already exist predate it; the backfill below
-- gives every one of them a real value, so the column is meaningful the moment
-- it lands rather than after the next run.
ALTER TABLE validate_proposals ADD COLUMN surface TEXT;

-- restatement | sourced | composition. Unconstrained TEXT for the same reason
-- `kind` is: D1 cannot enforce the enum, so the routes do, and a CHECK here
-- would need a migration every time a fourth class is named.
ALTER TABLE validate_proposals ADD COLUMN fill_class TEXT;

-- WHERE A SOURCED VALUE CAME FROM, and the column this migration exists for.
-- Two shapes, both carrying a quote so a reader can judge the source rather
-- than trust the label:
--
--   {"kind":"library","document_id":41,"title":"…","chunk":3,"quote":"…"}
--   {"kind":"research","task":"research_ask","query":"…","source":"…","quote":"…"}
--
-- NULL for restatement and composition, and NOT NULL for sourced — enforced in
-- the route rather than by a constraint, because a CHECK cannot see
-- `fill_class`. The library is tried first: `research_documents` (213) through
-- `services/vectorize.ts` already returns cited snippets and costs no external
-- call. A live `research_ask` runs only when the library cannot answer.
ALTER TABLE validate_proposals ADD COLUMN citation_json TEXT;

-- Which blank this fills, as the surface addresses it — a column name, a row
-- id, or a compound key the registry entry knows how to read. Opaque to the
-- table on purpose: one text column beats a nullable foreign key per surface.
ALTER TABLE validate_proposals ADD COLUMN target_ref TEXT;

-- The rows that predate the column are Validate's, and which zone each belongs
-- to is decided by its kind. Done here rather than left to a COALESCE in the
-- reader: a default that lives in one query is a default the next reader has to
-- rediscover.
UPDATE validate_proposals SET surface = 'validate/pain-map',  fill_class = 'restatement' WHERE kind = 'pain_tag'   AND surface IS NULL;
UPDATE validate_proposals SET surface = 'validate/hypotheses', fill_class = 'restatement' WHERE kind = 'hypothesis' AND surface IS NULL;

-- The list read is "this project's pending proposals, for this surface".
-- `idx_validate_proposals_project_status` (214) already covers the
-- surface-blind case and stays; this one serves the scoped read the generic
-- route makes.
CREATE INDEX IF NOT EXISTS idx_validate_proposals_surface
    ON validate_proposals (project_id, surface, status, id DESC);

-- ---------------------------------------------------------------------------
-- Part 2 — `fill_provenance`: what a filled value is, after it is filled.
-- ---------------------------------------------------------------------------
--
-- The proposal is a suggestion and stops being interesting the moment it is
-- decided. This is the other half: one row per ACCEPTED fill, saying which
-- value in which row of which table a model put there, what it was before a
-- person edited it, and what it was drawn from.
--
-- WHY A SIDE TABLE RATHER THAN A COLUMN PAIR PER FIELD. `projects.tam` is one
-- REAL column. A `tam_source` beside it would answer the question for TAM and
-- for nothing else, and the same question is about to be asked of `sam`, `som`,
-- a legal name, a jurisdiction, a positioning line and a competitor row — a
-- migration each, none of them generalising. One address triple answers it for
-- every surface, including the ones not built yet.
--
-- NO FOREIGN KEY ON THE ADDRESS, and this is the cost of that choice rather
-- than a corner cut: the target is a different table per surface and SQLite has
-- no polymorphic reference. A deleted target row leaves a provenance row
-- pointing nowhere. That is survivable — the row is a historical statement
-- about a decision that was made, and it stays true after the value it
-- described is gone — and the alternative is a nullable FK column per surface,
-- which is the per-field design this table exists to avoid.
CREATE TABLE IF NOT EXISTS fill_provenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- THE ADDRESS. Which value, in three parts. `target_table` is the physical
    -- table name so a reader can find the row without knowing the surface.
    target_table  TEXT NOT NULL,
    target_row_id INTEGER NOT NULL,
    target_column TEXT NOT NULL,

    -- WHICH PROPOSAL PUT IT THERE. SET NULL rather than CASCADE: a proposal
    -- should never be deleted (214 is explicit that discards are kept), but if
    -- one ever is, losing the record that a value was AI-filled is a worse
    -- outcome than an orphaned reference.
    proposal_id INTEGER REFERENCES validate_proposals(id) ON DELETE SET NULL,

    -- restatement | sourced | composition — the guarantee that was met before
    -- this value was allowed to be written. Stored rather than looked up
    -- through `proposal_id`, because it must survive that reference going null.
    fill_class TEXT NOT NULL,

    -- BOTH VALUES, AND THIS IS THE POINT. A founder who edits a proposed figure
    -- before accepting it has produced something that is neither the model's
    -- answer nor an unaided human one, and a store that keeps only the result
    -- cannot say which happened. `edited` is the flag a reader checks;
    -- `proposed_value` is what to show them when they ask what changed.
    proposed_value TEXT,
    written_value  TEXT,
    edited INTEGER NOT NULL DEFAULT 0,

    -- Copied from the proposal at accept time rather than joined, for the same
    -- reason `fill_class` is: this row has to stay readable on its own.
    citation_json TEXT,
    model TEXT,
    task  TEXT,

    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The page read: "what, on this row, did Eadwyn fill in?" — asked once per
-- render by any surface that marks a sourced value.
CREATE INDEX IF NOT EXISTS idx_fill_provenance_target
    ON fill_provenance (target_table, target_row_id, target_column);

-- The audit read: one project's fills, newest first, through the proposal.
CREATE INDEX IF NOT EXISTS idx_fill_provenance_proposal
    ON fill_provenance (proposal_id);
