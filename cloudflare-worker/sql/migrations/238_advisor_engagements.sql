-- 238 — advisor_engagements: the contract behind the sessions, and whether it renewed.
--
-- WHAT THE ARTBOARD ASKS FOR. `Advisor Detail · Practice.dc.html`'s PR2 frame
-- draws a contract board (Drafting / Proposed / Signed / Ended), a renewal
-- history it marks "Only here · the number that judges a practice", and a
-- scope card whose exclusions are written out in their own colour. Its blurb
-- names the reason all three exist: "including the two that ended, because a
-- practice is judged on renewals."
--
-- WHY A NEW TABLE, TABLE BY TABLE. The rule this repo runs on is that a store
-- gets built only after every existing one has been read and found wanting,
-- because the last series found five of six "nothing stores this" claims to be
-- false. All five candidates were read:
--
--   `engagements` — the PARTNER licence, and unusable rather than merely
--   wrong. `need_id` and `quote_id` are NOT NULL and `quote_id` is UNIQUE, so
--   an advisory relationship would need a fabricated need AND a fabricated
--   quote, and a sentinel quote row could not even be reused twice. `price`
--   is NOT NULL, which the artboard's own equity engagement contradicts.
--   `partner_id`, `founder_id` and `project_id` are all NOT NULL and there is
--   no advisor column; no migration has relaxed any of it. It is also defined
--   twice (schema_baseline and historical/t13_t14_t15), which drags in
--   `check-migration-column-shapes.mjs` — not touching it avoids that too.
--
--   `partner_retainers` (208) — the right SHAPE and the wrong owner: keyed
--   `engagement_id REFERENCES engagements(id)`, so unreachable from an
--   advisor. Its `shape` / `renews_at` / `ended_at` are copied below rather
--   than reinvented, which is the useful half of the precedent.
--
--   `partner_engagement_health` (232) — `scope_state` and `scope_note`, also
--   keyed on `engagements(id)`, and carrying no renewal decision or cycle
--   count even for partners.
--
--   `advisor_client_grants` (218) — has `status` and `expires_at` and looks
--   reusable. It is a DATA-ROOM ACCESS relation: `scope_project`,
--   `scope_data_room`, `scope_sessions`. Reading its `expires_at` as a
--   contract term is exactly the mislabel 237's header warns about.
--
--   `advisor_state` (048) — the name is a trap. It is
--   `(user_id, question_id, last_asked_at, answer_count)`, the AI advisor's
--   question cadence.
--
-- TWO COLUMNS HERE EXIST NOWHERE IN THE PRODUCT, not even on the partner
-- side: a renewal decision and a cycle count. Those are genuinely new rather
-- than ported, which is worth stating plainly — everything else below has a
-- precedent somewhere.
--
-- THE CLIENT IS A NAME FIRST AND A USER SECOND. `founder_user_id` is NULLABLE
-- and `client_name` is NOT NULL, which inverts how `advisor_bookings` keys a
-- counterparty, deliberately. A booking cannot exist without a platform user
-- because someone had to click Book. A CONTRACT can: the artboard's clients
-- are companies, an advisor's retainer may predate their client joining, and a
-- store that could not record Meridian Labs until Meridian Labs had an account
-- would be unusable for the exact rows the artboard draws. When the client IS
-- a user, the link is recorded and the board can join to them.
--
-- `lane` CARRIES FIVE VALUES AND THE BOARD DRAWS FOUR. `renewal_due` is a
-- state, not a column: the canvas folds it into the Signed lane and marks it
-- amber rather than giving it a fifth lane. Storing it separately is what lets
-- the "Renewal due" tile and chip be exact instead of a date comparison that
-- drifts with the clock.
--
-- `shape` IS WHAT MAKES THE ACTIVE TILE HONEST, and it is load-bearing across
-- artboards. The tile's note reads "2 retainers, 1 sprint, 1 equity, 1
-- per-call", which is a breakdown of this column. It also settles a
-- cross-artboard contract: PR5/Earnings excludes the equity client BY DESIGN,
-- because a cash gross cannot span a client who bills no cash. Without a
-- stored shape, Earnings would have to guess which clients to leave out.
--
-- MONEY IS INTEGER CENTS AND NULLABLE, AND IT HAS A READER ON ANOTHER
-- ARTBOARD. Same rule as 203/205/237: `scripts/check-money-cents.mjs` exists
-- so the float half of this schema stops growing, and NULL means nobody
-- recorded an amount — never zero, which would assert the work was free. The
-- reader is PR5/Earnings, whose per-client table carries a `retainer` figure
-- alongside a session count (`CASH` in the canvas: Meridian 13500 over 6
-- sessions). That figure cannot come from `advisor_bookings.amount_cents`,
-- which is per session and is already the other column of the same row — so
-- the cycle amount has to live here or nowhere. An equity engagement is the
-- ordinary case of a row with no cents.
--
-- CHECKS ON EVERY ENUMERATED COLUMN, because this is a new table and SQLite
-- will take them. `outcome` is nullable with a guarded CHECK, and this is the
-- one place the store deliberately DIVERGES FROM THE CANVAS FIXTURE. That
-- fixture stamps `outcome:'Active'` on a draft that was never sent, and its
-- own comment calls the field "the placeholder outcome field" and routes the
-- Active tile around it. A column whose stored value the artboard has to work
-- around is a column with the wrong default: here a row has no outcome until
-- it is signed, so an unsent draft cannot reach the renewal rate at all.
--
-- No BEGIN/COMMIT — D1 rejects them.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/238_advisor_engagements.sql

CREATE TABLE IF NOT EXISTS advisor_engagements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT    NOT NULL UNIQUE,
  advisor_id        INTEGER NOT NULL REFERENCES advisors(id),
  -- The client. NULL user = a client who is not (or not yet) on the platform;
  -- the name is what the board renders either way. See the header.
  founder_user_id   INTEGER REFERENCES users(id),
  client_name       TEXT    NOT NULL,
  -- Five states, four lanes. `renewal_due` renders inside Signed, in amber.
  lane              TEXT    NOT NULL DEFAULT 'drafting'
                    CHECK (lane IN ('drafting', 'proposed', 'signed',
                                    'renewal_due', 'ended')),
  -- Mirrors partner_retainers.shape, extended to the four the artboard's
  -- Active tile counts. Also tells Earnings which clients bill no cash.
  shape             TEXT    NOT NULL DEFAULT 'retainer'
                    CHECK (shape IN ('retainer', 'sprint', 'equity', 'per_call')),
  -- The board card's one line ("2 sessions/mo", "Sprint, 6 weeks"). Short by
  -- design; the full text lives in the two scope columns below.
  scope_label       TEXT,
  -- Inclusions and exclusions are SEPARATE columns because the artboard makes
  -- the exclusion first-class: "Exclusions are stored as first-class text, not
  -- as an absence. 'Not in scope: fundraising introductions' is the sentence
  -- that prevents the conversation." Folding them into one field would lose
  -- exactly the half that does the work.
  scope_includes    TEXT,
  scope_excludes    TEXT,
  -- What the cycle is worth. NULL = not recorded; an equity engagement has no
  -- cents and that is not a zero.
  amount_cents      INTEGER,
  -- THREE STAMPS, ONE PER LANE TRANSITION, because the board's date line says
  -- something different in each lane and no one column can mean all of them:
  -- "Sent Aug 21" on a proposal, "Renews Nov 4" / "Ends Aug 29" on a signed
  -- row, "Ended Jun 30" once it is over. `proposed_at` exists only because the
  -- fixture's Aperture card reads "Sent Aug 21" — folding that into
  -- `started_at` would file the day a proposal went out as the day the work
  -- began, which is the mislabel 237's header warns about. A drafting row has
  -- none of the three and the card reads "Not sent".
  --
  -- `term_ends_at` is what "Renews" and "Ends" BOTH read from; which of the
  -- two it means is `lane`'s job, not a fourth date's.
  proposed_at       TEXT,
  started_at        TEXT,
  term_ends_at      TEXT,
  ended_at          TEXT,
  -- Terms run, INCLUDING the one in progress — the fixture is explicit
  -- ("Fifth cycle" at cycles:5, "First cycle ending" at cycles:1), so this
  -- counts terms rather than renewals behind them. 0 while unsigned, 1 on
  -- signing, +1 on each renewal. The renewal history lists every row with
  -- cycles > 0, which is every engagement that was ever signed — an unsent
  -- draft is the only thing it leaves out, and 0 is what leaves it out.
  cycles            INTEGER NOT NULL DEFAULT 0,
  -- The renewal decision. NULL until there is one to record — a draft that was
  -- never sent is not an 'active' engagement, and counting it as one would
  -- inflate the denominator of the renewal rate.
  outcome           TEXT
                    CHECK (outcome IS NULL
                           OR outcome IN ('active', 'renewed', 'ended')),
  -- The renewal history's "Note" column, and there is DELIBERATELY NO SECOND
  -- `end_reason` BESIDE IT. An earlier draft of this file carried one, on the
  -- reasoning that "they hired in-house" and "wrong fit" are different kinds
  -- of ending. The fixture settles it the other way: Solano's note is "Two
  -- cycles, then they hired in-house. Good outcome." and Brackish's is "One
  -- cycle. Wrong fit — they wanted execution." Both endings arrive as one
  -- sentence in one column, the artboard draws exactly one Note column, and a
  -- second field would have had no reader anywhere on the canvas.
  renewal_note      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The board read: one advisor's engagements, most recently touched first.
CREATE INDEX IF NOT EXISTS idx_advisor_engagements_advisor
  ON advisor_engagements(advisor_id, updated_at DESC);
-- The four tiles and the lane counts, which filter on state before anything else.
CREATE INDEX IF NOT EXISTS idx_advisor_engagements_lane
  ON advisor_engagements(advisor_id, lane);
-- The "By client" chip, and the join back to a booking history when the client
-- is a platform user.
CREATE INDEX IF NOT EXISTS idx_advisor_engagements_client
  ON advisor_engagements(founder_user_id);
