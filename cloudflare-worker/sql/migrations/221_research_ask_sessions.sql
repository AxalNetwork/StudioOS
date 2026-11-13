-- 221 — Research · Ask keeps what it answered.
--
-- WHY THIS EXISTS. `POST /api/research/ask` retrieved, answered and returned,
-- and wrote nothing down. Everything the `pr1` artboard in
-- `design/incoming/Pages · Partner Research.dc.html` draws below the question
-- box is downstream of that one absence:
--
--   · the four header chips — `This session`, `All history`, `Cited`,
--     `Unanswered` — all four of which sat in `partnerZoneFilters.js` as
--     `unbuilt:` prose, two of them against the same sentence: "no answer is
--     saved, so nothing records a past question or whether one went
--     unanswered".
--   · the `New session` and `Saved answers` ops, same table, same reason.
--   · the Q&A thread itself: the artboard draws THREE exchanges on one screen,
--     which is not a thing a page holding one answer in React state can show.
--   · the `Answered`, `No source` and `Session spend` tiles. D56 forbids
--     drawing a tile with no store, so the strip rendered one tile out of four.
--
-- A NO-SOURCE ANSWER IS A ROW, NOT A DISCARD. It is the row `Unanswered`
-- selects on, and the artboard's third exchange — "What is Thornfield's current
-- burn?" — is the composition's whole point: a question the cache could not
-- answer, kept, named, and charged nothing. Dropping it would delete the
-- evidence the page is about. So `reason` is stored and every outcome writes a
-- row, including `model_unavailable`, which is a different failure and must not
-- be counted as the library's.
--
-- THE COST FIGURES ARE THE ROUTER'S RECEIPT, NOT A RE-COMPUTATION. `run()` in
-- `services/aiRouter.ts` returns `usage: UsageMeta` — model, prompt tokens,
-- completion tokens, cached flag, `est_cost_usd` — already written to
-- `ai_usage_logs` for the admin dashboard. Those same numbers land here so the
-- per-answer cost on the thread and the session total in the strip are the
-- charge that was actually recorded, not this page's own arithmetic over a
-- published rate. `ui/assistCost.js` exists because two functions drifting
-- apart is how a user is quoted one price and shown another; copying the
-- receipt is the same argument one table further out.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS research_ask_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Stamped by the first answer written into the session, so an empty session
  -- opened and abandoned sorts below one that was used. NULL means "opened,
  -- never asked", which the list reports rather than hides.
  last_asked_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The only read is "my sessions, newest first". As with `research_documents`,
-- there is no cross-user listing anywhere in this feature by construction.
CREATE INDEX IF NOT EXISTS idx_research_ask_sessions_owner
  ON research_ask_sessions(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_ask_answers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  session_id         INTEGER NOT NULL REFERENCES research_ask_sessions(id) ON DELETE CASCADE,
  -- Denormalised from the session on purpose: every read in `research.ts` is
  -- `WHERE owner_user_id = ?`, and a join to prove ownership would be the one
  -- place that rule is expressed as a join rather than a predicate.
  owner_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question           TEXT NOT NULL,
  -- NULL for both failure reasons. The page distinguishes them; a single
  -- "no answer" would collapse "your library has nothing on this" into "the
  -- model did not respond", which sends the reader to upload a document that
  -- would not have helped.
  answer             TEXT,
  reason             TEXT NOT NULL,           -- answered | no_source | model_unavailable
  -- What the closest passage actually scored, and the floor it had to clear.
  -- The page prints both so a reader can see how near it came.
  best_score         REAL,
  score_floor        REAL,
  -- JSON array of { n, title, chunk, score } — the passages the answer drew
  -- on, frozen as they were cited. Re-running retrieval later would answer a
  -- different question: what the library says NOW, not what this answer used.
  citations          TEXT NOT NULL DEFAULT '[]',
  -- The router's receipt. `model` is nullable because a `no_source` outcome
  -- never reaches a model — and that is exactly why it costs nothing.
  model              TEXT,
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  cached             INTEGER NOT NULL DEFAULT 0,
  -- MICRO-DOLLARS, AND AN INTEGER, because `check-money-cents` is right and
  -- both obvious alternatives are wrong. A REAL `cost_usd` is a float money
  -- column, which that gate refuses and whose legacy list of fifty is closed —
  -- `ai_usage_logs.est_cost_usd` is on it, which is how the sibling receipt got
  -- to be a float and not a licence for a second one. And `_cents` would round
  -- this away entirely: a question costs about $0.0002, which is zero cents.
  -- 1e-6 USD is finer than any published per-1M-token rate needs, and it is
  -- exact. The API converts back to dollars once, on the way out.
  cost_micro_usd     INTEGER NOT NULL DEFAULT 0,
  -- `Saved answers` in the ops row. Kept on the answer rather than in a side
  -- table: it is one bit owned by the same reader, and a join table for a
  -- boolean is a row nobody can explain in a year.
  saved              INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The thread, in the order it was asked.
CREATE INDEX IF NOT EXISTS idx_research_ask_answers_session
  ON research_ask_answers(session_id, id);

-- `All history`, and the session-spend rollup.
CREATE INDEX IF NOT EXISTS idx_research_ask_answers_owner
  ON research_ask_answers(owner_user_id, created_at DESC);

-- `Saved answers`, which reads a narrow slice of a potentially long history.
CREATE INDEX IF NOT EXISTS idx_research_ask_answers_saved
  ON research_ask_answers(owner_user_id, saved, created_at DESC);

-- ── The artboard's AI band, and why it gets one table rather than seven ──────
--
-- Every artboard in `Pages · Partner {Research,Network}.dc.html` ends with the
-- same block: an accent label, a cost, a drafted paragraph, and three controls
-- — `Accept …`, `Edit first`, `Discard`. Seven surfaces, one anatomy, and the
-- same lifecycle `validate_proposals` already models for Founder Validate:
-- nothing is written until a person presses the run button, and nothing is kept
-- until they press accept.
--
-- ONE TABLE, KEYED BY SURFACE. This repo carries three copies of one CSV
-- escaper that disagree with each other, which is the argument. A draft is a
-- paragraph about a scope with a receipt attached; the surface it was drafted
-- on is a value, not a schema. `scope_key` is whatever identifies the thing
-- drafted over — an Ask session's uid today, a client's uid on Client prep, a
-- reading scope on Market — kept as opaque text so a surface can define its own
-- without a migration.
--
-- A TABLE IS NOT CONFIG. `ui_assist_rail_and_sidebar` refuses a rail surface
-- with no mount behind it, and that rule is right: a model card naming a page
-- that never calls one is a lie on screen. A store with one writer is not the
-- same thing — it is a shape the second writer will not have to re-migrate.
CREATE TABLE IF NOT EXISTS research_zone_drafts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The artboard this was drafted on: 'research/ask' today. Free text for the
  -- same reason `ai_usage_logs.task` is — a new surface must not need a
  -- migration to draft on.
  surface         TEXT NOT NULL,
  -- What it was drafted OVER. NULL when the surface has one scope per reader.
  scope_key       TEXT,
  body            TEXT NOT NULL,
  -- The router's receipt again, in the same unit and for the same reason as
  -- `research_ask_answers.cost_micro_usd` above.
  model           TEXT,
  cost_micro_usd  INTEGER NOT NULL DEFAULT 0,
  -- NULL means drafted and not yet decided. `Discard` deletes the row rather
  -- than setting a third state: a discarded draft is not a record anyone reads
  -- back, and keeping it would make "one pending draft" a query with a caveat.
  accepted_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "The pending and accepted drafts for this surface and scope, newest first" is
-- the only read.
CREATE INDEX IF NOT EXISTS idx_research_zone_drafts_scope
  ON research_zone_drafts(owner_user_id, surface, created_at DESC);
