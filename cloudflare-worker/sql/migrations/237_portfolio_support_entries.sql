-- 237 — portfolio_support_entries: the support ledger IP3 correctly said did
-- not exist.
--
-- WHY THIS ONE IS A BUILD RATHER THAN A CORRECTION. The five Portfolio and
-- Deals zones before it each carried an `unbuilt` reason that turned out to be
-- false once the schema was read: a scoring run that WAS stored, a vote that
-- COULD be closed, closing templates that DID include the SAFE, a mark history
-- that was ALREADY being served, a KPI rule set arriving on every page load.
-- IP3's three reasons were checked the same way and they are true. Every table
-- in this schema that joins an investor to a company records the investor
-- GAINING ACCESS to one, never doing work for one:
--
--   investor_introductions   an investor REQUESTING an intro to a founder,
--                            against a paid quarterly quota. Its `status` is
--                            written 'pending' by the one INSERT and no
--                            statement anywhere updates it, so a Delivered /
--                            Outstanding split read off that column would
--                            report a state machine that never moves.
--                            `_investorProjectScope` unions it with dealroom
--                            membership to decide which projects an investor
--                            may SEE — which is what it is: an access relation.
--   intro_propositions       the Network warm-intro engine, every licence,
--                            peer-to-peer, spent from a credit balance.
--   intro_credit_ledger      the credits for the above. Not hours.
--   investor_dealroom_members, deal_invitations, data_room_grants
--                            three more ways in.
--   engagements/engagement_hours
--                            a PARTNER's paid delivery, born of a need and a
--                            quote and carrying a price. Reading those hours as
--                            an investor's support would relabel billed
--                            consulting as unpaid help.
--
-- So the desk had nothing to draw and said so. The licence axiom is invest in
-- AND SUPPORT companies; the artboard's own words are that this is "where the
-- second half becomes auditable". It cannot be, without a place to write it.
--
-- `state` DEFAULTS TO 'promised', WHICH IS THE POINT OF THE TABLE. The artboard
-- is explicit — "promised entries stay visible until delivered or withdrawn",
-- and "an intro offered in June and never made is worse than one never
-- offered, and only a record shows the difference". A ledger that recorded
-- only completed work would lose exactly the fact worth keeping. Delivering is
-- therefore a WRITE, not a default: `PATCH /portfolio-support/:uid` moves the
-- row and stamps `delivered_at`. That is the whole difference between this
-- table and `investor_introductions`, whose 'pending' is frozen because
-- nothing ever transitions it.
--
-- 'withdrawn' IS A REAL TERMINAL STATE so a promise can be retired honestly
-- rather than quietly re-labelled delivered, or left pending forever to avoid
-- admitting it. Withdrawn rows stay in the table: the history of what was
-- offered is the audit.
--
-- `hours` IS NULLABLE AND NULL IS NOT ZERO. Most support is not timed, and a
-- summary that reads "0 hours" over entries nobody clocked is a different claim
-- from "no hours were recorded" (D56/D68). The read returns the recorded sum
-- AND the count of entries carrying no hours, so the tile can say both.
--
-- `kind` AND `state` CARRY CHECKS because this is a new table and SQLite will
-- take one. `kind` is the artboard's own vocabulary; 'other' exists so a real
-- piece of work is never lost for want of a category.
--
-- FUND SCOPE MIRRORS `portfolio_positions`: `fund_id` nullable = firm-level.
-- Rows are scoped for reading by the project, through the same
-- `investorProjectIds` predicate every other read in the Portfolio bucket uses.
--
-- No BEGIN/COMMIT — D1 rejects them.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/237_portfolio_support_entries.sql

CREATE TABLE IF NOT EXISTS portfolio_support_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  -- Nullable = firm-level, exactly as portfolio_positions and portfolio_marks.
  fund_id       INTEGER REFERENCES vc_funds(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  kind          TEXT    NOT NULL DEFAULT 'other'
                CHECK (kind IN ('intro', 'board_prep', 'hiring', 'customer',
                                'fundraising', 'other')),
  -- promised → delivered | withdrawn. Nothing moves a row but an explicit
  -- write, and both destinations are terminal.
  state         TEXT    NOT NULL DEFAULT 'promised'
                CHECK (state IN ('promised', 'delivered', 'withdrawn')),
  -- NULL = nobody recorded a duration. Never coalesced to 0 on read.
  hours         REAL,
  -- When it was offered, and when it actually happened. `delivered_at` stays
  -- NULL while the row is promised, so the gap between the two dates is the
  -- age of an unkept promise rather than something a reader has to infer.
  promised_at   TEXT,
  delivered_at  TEXT,
  withdrawn_at  TEXT,
  -- The artboard's "What happened" column. Required: an entry with no
  -- description is a count, and a count of unnamed favours is not a ledger.
  summary       TEXT    NOT NULL,
  -- What came of it, when anything did. Absent means unrecorded, never "no
  -- outcome" — a hire that took six months to show is not a failure.
  outcome       TEXT,
  recorded_by   INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The desk's two reads: everything for a set of projects, newest first, and
-- the outstanding-promise sweep.
CREATE INDEX IF NOT EXISTS idx_support_project
  ON portfolio_support_entries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_state
  ON portfolio_support_entries(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_fund
  ON portfolio_support_entries(fund_id);
