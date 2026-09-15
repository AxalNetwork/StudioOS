-- 241 — the advisory money model: a configurable take rate, a payout account,
-- a payout ledger, and the per-line cut that reconciles them.
--
-- ══ WHAT 205 SAID, WHAT WAS TRUE, AND WHAT CHANGES ═══════════════════════
--
-- Migration 205's header reads, in capitals: "RECORD ONLY. NO MONEY MOVES
-- THROUGH AXAL." That sentence is about `advisor_bookings.billing_state`, and
-- ABOUT THAT COLUMN IT IS STILL TRUE after this migration — 205's state is an
-- advisor's own bookkeeping note, nothing here turns it into a transaction,
-- and nothing here issues an invoice.
--
-- What was never true is the broader reading, and it is worth writing down
-- because a reader arriving at 205 today will take the sentence for a
-- statement about the platform. Money has moved through Axal since task #4:
-- `services/wellbeing/bookings.ts` creates a Stripe **destination charge**
-- with `application_fee_amount` and `transfer_data[destination]`, settling to
-- an expert's connected account, and `routes/wellbeing.ts` runs the full
-- Connect Express onboarding and account-status refresh behind it. The
-- platform's shipped default application fee there is **15%**
-- (`DEFAULT_APPLICATION_FEE_PCT`), overridable per expert and by
-- `EXPERT_APPLICATION_FEE_PCT`.
--
-- So this migration is not reopening something the codebase forbids; it is
-- giving the ADVISORY practice the model the WELLBEING directory has had all
-- along, over its own tables and its own population. `experts` (052) is the
-- wellbeing directory matched by `services/wellbeing/match.ts` — writing an
-- advisor into it would put an advisory practice in the wellbeing match pool,
-- which is why 240 built beside it rather than into it, and why this does too.
--
-- WHAT IS STILL FALSE AFTER THIS MIGRATION, and must stay visibly false:
-- nothing in the ADVISORY path charges anybody. This adds the record — a rate,
-- an account state, a payout row, a per-line cut — and the service leg that
-- would act on it is PR5b, wired to test keys with production charging behind
-- a flag routed through `util/paymentMode.ts`. Until that flag flips, every
-- number these tables produce is a projection of what a charge WOULD take, and
-- the surfaces that render them say so. D75.
--
-- ══ BASIS POINTS, NOT A PERCENTAGE AND NOT A FLOAT ═══════════════════════
--
-- `advisor_take_rate_bps` is an INTEGER in basis points: 1500 is 15%. Two
-- reasons, and the second is the one that matters.
--
--   * `scripts/check-money-cents.mjs` exists because the float half of this
--     schema kept growing. A rate is not money, but a float rate produces
--     exactly the rounding it was written to stop.
--   * The cut must reconcile EXACTLY. `cut = floor(gross * bps / 10000)` in
--     integer arithmetic, so `gross - cut = net` with no residue anywhere,
--     per line and in every total. FLOOR rather than round, deliberately: a
--     rounded cut can exceed the stated percentage by a cent, and a platform
--     fee that is occasionally 15.0002% of gross is a fee the terms do not
--     describe. Rounding down can only ever favour the advisor.
--
-- ══ THE RATE IS STORED PER LINE, NOT ONLY IN THE SETTING ═════════════════
--
-- `advisor_bookings.take_rate_bps` repeats what the setting said AT THE TIME,
-- and this is the whole reason the setting can be changed safely. An admin who
-- moves the rate from 15% to 12% must not silently restate last quarter's
-- ledger — an advisor who reconciled a quarter against a number has to find
-- that number still there. Reading the live setting to recompute a historical
-- line would rewrite history every time an operator touched a form.
--
-- ══ THE THREE PAYOUT STATES ARE THE ARTBOARD'S, AND THEY GATE ════════════
--
-- D4 (`design/canvases/backlog/Detail Layer Canvas II.dc.html`) draws all
-- three with the gate each implies, and they are not decoration:
--
--   verified  Paid sessions bookable and chargeable.
--   pending   Bookable, held uncharged until verification clears.
--   blocked   Paid slots hidden from the profile. Free intros still bookable.
--
-- `pending` is what 240's `payment_state = 'held_unpaid'` is FOR: a slot taken
-- while the account was still verifying. The two columns are one mechanism
-- described from two ends, and this migration is where the other end lands.
--
-- ══ NO INDEX ON advisor_bookings ═════════════════════════════════════════
--
-- Same trap 205 documented: `advisor_bookings` carries TWO definitions —
-- `sql/schema_baseline.sql:1002` and the live `sql/historical/t13_t14_t15.sql`
-- — and `advisor_id` exists only in the second. An index naming it is the
-- mistake `scripts/check-migration-column-shapes.mjs` was written to stop.
-- The two ALTERs below add columns, which both lineages tolerate.
--
-- NO BEGIN/COMMIT — D1 rejects transaction statements in a migration.

-- ── The first platform-wide operator setting ──────────────────────────────
-- THERE WAS NO SUCH STORE, and `routes/admin_platform.ts` says so in its own
-- docblock: "Flags NOT RECORDED. There is no feature-flag store. What exists
-- under that name is per-user settings, which is a different thing: a user's
-- own preference, not a platform switch an operator can throw."
--
-- That remains true of FLAGS — this is not a flag registry and no panel is
-- being drawn over it. It is one typed, audited, platform-wide number, shaped
-- after `cohort_settings` (schema_baseline.sql:926), which is the same
-- key/value/updated_by pattern scoped to a cohort. `updated_by` is here from
-- the first row because a rate that decides what a platform charges is a thing
-- someone must be answerable for having changed.
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by  TEXT
);

-- SEEDED, NOT HARD-CODED. 1500 bps = 15%, which is the platform's existing
-- default application fee for its other paid-session product rather than a
-- number taken off a canvas fixture. Every surface reads it from here; no
-- component multiplies by a literal.
--
-- INSERT OR IGNORE so a replay cannot reset a rate an operator has since
-- changed. A migration that silently restored a default would be a rate change
-- nobody made.
INSERT OR IGNORE INTO platform_settings (key, value, updated_by)
  VALUES ('advisor_take_rate_bps', '1500', 'migration_241');

-- ── The payout account, one per advisor ───────────────────────────────────
-- Modelled on the columns `experts` already carries for the same job
-- (`stripe_account_id`, `stripe_charges_enabled`, `stripe_payouts_enabled`),
-- because the Connect mechanics are identical and a second vocabulary for the
-- same three facts is how two halves of a product come to disagree.
--
-- `state` is DERIVED but STORED, and both halves are deliberate. Derived,
-- because Stripe's `charges_enabled`/`payouts_enabled` are the truth. Stored,
-- because the page must render a state when the provider cannot be reached,
-- and "we could not ask" is not "blocked" — `last_checked_at` is how a reader
-- tells a fresh answer from a stale one.
CREATE TABLE IF NOT EXISTS advisor_payout_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  -- UNIQUE: one payout account per advisor. The upsert depends on it.
  advisor_id          INTEGER NOT NULL UNIQUE,
  state               TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending', 'verified', 'blocked')),
  -- Named rather than assumed. The service leg is Stripe Connect, but a
  -- column called `stripe_account_id` makes the provider unchangeable without
  -- a migration, and 052 already shows what that costs.
  provider            TEXT NOT NULL DEFAULT 'stripe',
  provider_account_id TEXT,
  charges_enabled     INTEGER NOT NULL DEFAULT 0,
  payouts_enabled     INTEGER NOT NULL DEFAULT 0,
  -- Why an account is blocked, in the provider's words where there are any.
  -- Absent is "not blocked", never "blocked for no reason".
  blocked_reason      TEXT,
  -- NULL means never asked. Distinct from "asked and got nothing", which
  -- leaves the timestamp and the previous state in place (D56/D68).
  last_checked_at     TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_payout_accounts_advisor
  ON advisor_payout_accounts(advisor_id);

-- ── The payout ledger ─────────────────────────────────────────────────────
-- D4's "Payout history · Audit trail · only here": a date, an amount, a state.
--
-- MIGRATION 175 RETIRED A PAYOUT LEDGER and 205's header cites it. This is not
-- that table returning: 175's belonged to a rewards/referral scheme paying
-- platform credit, and this one records money settling from a client's card to
-- an advisor's connected account. Same noun, different transaction, and the
-- distinction is why this carries `provider_payout_id` — a row here is
-- reconcilable against the processor or it is not a record of a payout.
CREATE TABLE IF NOT EXISTS advisor_payouts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  advisor_id          INTEGER NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'usd',
  -- 'scheduled' is the artboard's own second state, and it is a FUTURE-tense
  -- row: the money has not moved. Only 'paid' asserts that it has.
  state               TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (state IN ('scheduled', 'paid', 'failed', 'reversed')),
  -- A CALENDAR DAY (YYYY-MM-DD), not an instant: "Sep 1" is a banking day in
  -- the advisor's own reckoning, and `new Date('2026-09-01')` is midnight UTC.
  -- `paid_at` beside it IS an instant, because a settlement happens at a
  -- moment. `sessionGrid.js`'s header draws the same distinction for the same
  -- reason; the two columns are typed apart so the page cannot confuse them.
  scheduled_for       TEXT,
  paid_at             TEXT,
  provider_payout_id  TEXT,
  failure_reason      TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advisor_payouts_advisor
  ON advisor_payouts(advisor_id, created_at);

-- ── The cut, per line ─────────────────────────────────────────────────────
-- SQLite/D1 has no ADD COLUMN IF NOT EXISTS. Additive, and the runner
-- tolerates a duplicate-column error on replay, same as 205 and 240.
--
-- BOTH COLUMNS ARE NULL BY DEFAULT and that is the honest default: no existing
-- booking has had a cut computed against it, and backfilling zeros would
-- assert that a few hundred sessions were charged at nothing. A NULL cut is
-- "not computed", which the Earnings page renders as an absence rather than
-- as a free quarter (D56/D68).
ALTER TABLE advisor_bookings ADD COLUMN platform_cut_cents INTEGER;

-- The rate this line was computed at, in basis points. See the header: the
-- setting is what the NEXT line will use; this is what THIS line used, and a
-- historical quarter must not move when an operator changes the former.
ALTER TABLE advisor_bookings ADD COLUMN take_rate_bps INTEGER;
