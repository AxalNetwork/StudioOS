-- 214 — what the machine proposed, who decided, and which model wrote it.
--
-- The rail's second mode — "AI fills the blanks" — has been drawn on every
-- canvas and refused in code since DECISIONS D17, on a rule worth restating
-- because this migration is what retires it: "no page branches on an assist
-- mode. Turning the switch off would change nothing any of the six surfaces
-- does, so shipping it puts a control on screen that cannot affect the
-- product." This table is the branch. With it, off means no proposal is ever
-- written and nothing is spent; on means Eadwyn reads the evidence already in
-- `discovery_interviews` and writes rows here for a person to accept or throw
-- away.
--
-- WHAT IT PROPOSES, AND WHAT IT STILL CANNOT. Two of the three things the
-- canvas's mode note promises are backed by stores that already exist:
-- tagging a logged pain phrase into a theme (`pain_group_aliases`, migration
-- 106) and drafting a hypothesis card (`hypotheses`, migration 211). The
-- third, "transcribes uploads", is NOT: `discovery_interviews` has no
-- transcript, no recording key, no duration and no audio column, and no R2
-- allowlist in this worker admits an audio MIME. It is a separate migration
-- and a separate task class, and until it lands the mode note names two
-- things rather than three. A note that promises a third is the same class of
-- lie as a button posting to a route the worker never declared.
--
-- THE SHAPE IS COPIED FROM `decision_gates`, WITH THE COLUMNS IT LACKS.
-- `routes/pipeline.ts` already has the only genuine AI-proposes /
-- human-decides table in this product, and its accept path's optimistic
-- concurrency (`WHERE id = ? AND status = 'pending'`) is the right idiom and
-- is reused. What it does not have is any record of WHICH MODEL wrote the
-- proposal: it returns a hardcoded model string in the HTTP response and
-- stores nothing, so the name can drift from what actually ran and no
-- accepted row can be traced to a run. Since the rail now lets a founder
-- CHOOSE the model, "which one wrote this" stops being trivia — a claim
-- drafted by the 3b and one drafted by the 70b are not the same artefact.
-- Hence `model` and `task`, written from the router's own usage metadata
-- rather than from a literal.
--
-- NOTHING HERE IS A SECOND COPY OF AN ANSWER. `payload_json` holds the
-- proposal ONLY while it is pending. Accepting writes through the same
-- functions the manual routes use — `insertHypothesis` and `upsertPainAlias`
-- in `_founder_validate_writes.ts` — so an accepted proposal and a
-- hand-typed one produce byte-identical rows, and the server-side `H1, H2 …`
-- allocation cannot be bypassed by the accept path. A second writer is
-- exactly how that allocation would quietly start handing out duplicate
-- codes.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a
-- migration file — migration 200 shipped with them and failed the production
-- deploy at the migration step (see `scripts/check-sql-migrations.mjs`).

CREATE TABLE IF NOT EXISTS validate_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- 'pain_tag' | 'hypothesis'. Not an enum D1 can enforce, so the routes
    -- validate it and `_founder_validate_proposals.ts` is the only writer.
    kind TEXT NOT NULL,
    -- The proposal itself, shaped per kind. Read once, on accept, and never
    -- rendered as a stored record: a pending proposal is a suggestion, and the
    -- moment it is accepted the real row is the record.
    payload_json TEXT NOT NULL,
    -- Provenance. `model` is the model that ACTUALLY ran, taken from the
    -- router's usage metadata — which is not always the model that was asked
    -- for, because the router falls back to a smaller sibling under load.
    -- Recording the request rather than the run is how a founder ends up
    -- reading one model's name over another model's sentence.
    model TEXT,
    task TEXT,
    -- pending | accepted | discarded. Never deleted: a discarded proposal is
    -- evidence about what the machine suggested and what a person rejected,
    -- and the next run should be able to avoid re-proposing it.
    status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TEXT
);

-- The list query: one project's pending proposals, newest first.
CREATE INDEX IF NOT EXISTS idx_validate_proposals_project_status
    ON validate_proposals (project_id, status, id DESC);

-- Re-proposing something a founder already threw away is the fastest way to
-- make an assistant feel broken, so the propose path reads back what it has
-- already suggested for this project and kind.
CREATE INDEX IF NOT EXISTS idx_validate_proposals_project_kind
    ON validate_proposals (project_id, kind);
