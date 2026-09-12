-- 242 — the advisor's own note about a period, and the one thing D4's AI band
-- needs that nothing stored.
--
-- WHY THIS EXISTS. D4 draws an AI band inside Earnings — "Proposal · quarter
-- narrated", with the cost shown before it runs and **Accept / Edit /
-- Discard** under it. Three of those four are client-side and were already
-- possible: the draft comes from `POST /api/ai/workspace/explain`, the cost
-- from the same price table the rail quotes from, Edit is a textarea and
-- Discard clears it.
--
-- ACCEPT IS THE ONE THAT NEEDED A STORE, and shipping it without one would
-- have been a button that says a thing was filed and files nothing. Every
-- existing candidate was read first:
--
--   `advisor_engagements` (238) — a client relationship, not a period. A
--      quarter spans several and outlives most.
--   `advisor_deliverables` (239) — a work product SENT to a client. This note
--      is the advisor's own and is sent to nobody.
--   `research_library` — indexed, retrievable, cited. A private note about
--      one's own takings is none of those, and putting it there would make it
--      a candidate answer to somebody's question.
--   `user_settings` / `cohort_settings` — a preference and a cohort's config.
--      Neither is a dated record.
--
-- ONE NOTE PER PERIOD, keyed by a PERIOD STRING and not a date range.
-- `period_key` is '2026-Q3', '2026' or 'all' — the same four windows the
-- page's chips ask for. A range would let two notes overlap on the same
-- quarter with no way to say which the reader meant; a key cannot.
--
-- THE PERIOD KEY IS A CALENDAR LABEL, NOT AN INSTANT. '2026-Q3' names three
-- months in the advisor's own reckoning; it is never parsed into a Date and
-- never compared with `created_at`. The same distinction 240 and 241 draw
-- between a blackout day and a slot time, and between a scheduled payout day
-- and the moment it settled.
--
-- `source` RECORDS WHO WROTE IT, because a narrative a model drafted and a
-- sentence the advisor typed are different objects and the page has to be
-- able to say which it is showing. A note accepted from a draft and then
-- edited is 'edited' — not 'ai', which would over-credit the model, and not
-- 'advisor', which would hide that a model started it.
--
-- NO BEGIN/COMMIT — D1 rejects transaction statements in a migration.

CREATE TABLE IF NOT EXISTS advisor_period_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT    NOT NULL UNIQUE,
  advisor_id   INTEGER NOT NULL,
  -- '2026-Q3' | '2026' | 'all'. Validated in the route against the four
  -- windows the page offers, so a key nothing can ask for cannot be stored.
  period_key   TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'advisor'
               CHECK (source IN ('advisor', 'ai', 'edited')),
  -- What the numbers WERE when the note was accepted, as JSON. A narrative
  -- reads "Q3 gross is $18,450, up on Q2" and the page shows today's figure
  -- beside it; if a session is priced afterwards the two silently disagree
  -- and the reader cannot tell which is stale. This is what lets the page say
  -- "written when gross was $18,450" instead of quietly implying the sentence
  -- still describes the table.
  figures_json TEXT,
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UNIQUE on the pair, which is what makes the upsert one note per period
-- rather than an append-only pile the page would have to choose between.
CREATE UNIQUE INDEX IF NOT EXISTS idx_advisor_period_notes_one
  ON advisor_period_notes(advisor_id, period_key);
