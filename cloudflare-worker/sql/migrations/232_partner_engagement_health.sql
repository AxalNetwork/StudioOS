-- 232 — what a firm has written down ABOUT an engagement, beside the work.
--
-- ══ THREE THINGS THE `pd5` ARTBOARD ASKS FOR AND NOTHING RECORDED ═════════
--
-- Delivery · Health reads five stores already — milestones, blockers,
-- deliverables, seats and the retainer record — and rates an engagement from
-- them. Three of the artboard's elements are not readable from any of the five,
-- because none of them is a fact about the WORK; each is a fact the firm or its
-- client STATES about the engagement:
--
--   `Scope state`   — "Within scope" / "Scope drift". A blocker is something
--                     stopping the work; drift is the work quietly becoming a
--                     different job. `engagement_blockers.side` cannot say it.
--   `Satisfaction`  — what the client thinks, which no table held at all.
--   `By owner`      — the fourth chip, prose since it was written because
--                     nothing recorded who at the firm runs an engagement. (The
--                     owner migration 224 added belongs to a book CONTACT — a
--                     person the firm knows — not to work it is running.)
--
-- ══ ONE ROW PER ENGAGEMENT, NOT THREE TABLES ══════════════════════════════
--
-- All three are per-engagement, firm-stated, optional and read together by one
-- page. Three tables would be three joins in one query and three writers for
-- what is one sentence a firm writes about a client. The owner is in here
-- despite not being "health" because the renewal read needs it in the same row
-- it needs the rest of.
--
-- ══ A SCORE WITHOUT A SOURCE IS THE FIRM MARKING ITS OWN HOMEWORK ═════════
--
-- 208:160 established that `opened_at` and `signed_off_at` are the CLIENT'S to
-- set: a partner-side write would be the firm reporting a metric about itself.
-- Satisfaction is nearly that, and the difference is provenance. A number typed
-- by the account manager who wants the renewal, presented on the renewal-risk
-- page as the client's opinion, is exactly the failure that rule exists for. So
-- the CHECK makes a score impossible without a stated source — "quarterly
-- review call, 14 Aug", "written into the renewal email" — and the page prints
-- the source beside the number every time it draws one. It is a RECORDED
-- REMARK, not a measurement, and it has to read as one.
--
-- `satisfaction` is REAL because the artboard draws one decimal (`4.2 / 5`);
-- `check-money-cents` is about money columns and this is not one.
--
-- ══ AN ABSENT ROW IS THE COMMONEST ANSWER AND STAYS A REAL ONE ════════════
--
-- No row means: no owner named, scope not assessed, no score heard. The read
-- keeps all three absent rather than defaulting scope to "within" — an
-- engagement nobody has looked at is not an engagement in scope — and the
-- firm-wide satisfaction average stays refused while any engagement is
-- unscored, because averaging the rest would present a few opinions as a
-- firm-wide fact.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS partner_engagement_health (
  -- The engagement IS the key: one statement per engagement, and a second row
  -- would be a second opinion the read would have to choose between.
  engagement_id INTEGER PRIMARY KEY REFERENCES engagements(id) ON DELETE CASCADE,
  -- Who at the firm runs it. NULL is unassigned, which the zone sorts first
  -- and reads in red rather than hiding.
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- NULL = nobody has assessed it. Not 'within': an engagement nobody has
  -- looked at is not an engagement in scope.
  scope_state TEXT CHECK (scope_state IN ('within', 'drift')),
  -- What drifted, in the firm's words — "requests beyond SOW §2".
  scope_note TEXT,
  satisfaction REAL CHECK (satisfaction IS NULL OR (satisfaction >= 1 AND satisfaction <= 5)),
  -- WHERE THE SCORE CAME FROM. Not optional beside a score: see the header.
  satisfaction_source TEXT,
  satisfaction_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (satisfaction IS NULL OR satisfaction_source IS NOT NULL)
);

-- `By owner` SORTS AND SELECTS ON THIS. Leading with `owner_user_id` keeps the
-- index usable for the unassigned-first read the zone does.
CREATE INDEX IF NOT EXISTS idx_partner_engagement_health_owner
  ON partner_engagement_health(owner_user_id, engagement_id);
-- The `Scope drift` tile counts on this one.
CREATE INDEX IF NOT EXISTS idx_partner_engagement_health_scope
  ON partner_engagement_health(scope_state, engagement_id);
