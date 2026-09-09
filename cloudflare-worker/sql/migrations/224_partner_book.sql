-- 224 — the firm relationship book, and the interactions strength is derived from.
--
-- ══ WHAT WAS THERE, AND WHY IT IS NOT THIS ════════════════════════════════
--
-- `/network/relationships` reads `partner_relationships`, and that table is a
-- PARTNER-TO-PARTNER EDGE: `partner_a_id`, `partner_b_id`,
-- `CHECK (partner_a_id < partner_b_id)`, a `relationship_type` from a fixed
-- five, and `strength_score REAL DEFAULT 50`. It models "these two partners
-- know each other".
--
-- The `pn1` artboard is a FIRM'S BOOK OF PEOPLE: "every contact belongs to
-- Studio Vireo and someone at the firm owns it", with columns `Contact ·
-- Organization · Firm owner · Last interaction · Strength`. Its rows are people
-- at client companies. Those are different objects, and the page showed it —
-- a card grid with a 0-100 slider, asking for a raw "Partner User ID (e.g. 42)".
--
-- ══ `strength_score` IS THE THING THE ARTBOARD REFUSES ═════════════════════
--
-- It defaults to 50, a person drags it on a slider, and the page draws it as a
-- gradient bar reading "62/100". The artboard's fourth tile is `Firm-wide
-- warmth score · Not recorded · no such score exists — strength is per-row and
-- shows its derivation`, and its instNote is explicit: "Strength is never a
-- warmth number presented as fact; each row states the interaction count and
-- recency it was derived from."
--
-- So strength is not stored here at all. It is computed from
-- `partner_book_interactions` — how many, how recently — and every row prints
-- the two numbers it came from. A contact with no dated interaction reads "Not
-- recorded" rather than "Thin", because two touches and no dates is not enough
-- to call anything.
--
-- ══ A NEW TABLE RATHER THAN AN ALTER, AND THE REASON IS ORDERING ═══════════
--
-- `partner_relationships` is created by `ensureSchema` in `routes/partnernet.ts`
-- at request time, not by a numbered migration — it is in `schema_baseline.sql`
-- and nowhere in `sql/migrations/`. An `ALTER TABLE` here would run before that
-- bootstrap on a fresh build and fail on a table that does not exist yet. The
-- partner graph keeps its table; the book gets its own.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

CREATE TABLE IF NOT EXISTS partner_book_contacts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE,
  -- The firm's account. Every read is `WHERE owner_user_id = ?`; a book is one
  -- firm's and there is no cross-firm listing in this feature by construction.
  owner_user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  email                TEXT,
  -- Their title where they work — "Co-founder", "Head of Design". The
  -- artboard prints it under the name.
  role_title           TEXT,
  -- WHERE THEY WORK, AS TEXT AND ON THE CONTACT. `contacts` has no
  -- organisation column at all, which is why the founder and investor
  -- Organizations roll-up is permanently empty (task #94). This one has it,
  -- which is what lets `pn3`'s intended-shape table group by employer.
  organization         TEXT,
  -- THE ARTBOARD'S ORGANISING PRINCIPLE. "The failure mode this page exists to
  -- surface is an owned relationship with no owner — so unassigned rows sort to
  -- the top and read in red." NULL is that case, and it is the default: a
  -- contact arrives unowned until someone takes it.
  firm_owner_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- 'ours'     — someone at the firm entered it.
  -- 'platform' — it arrived through the product, and `source_label` says how:
  --              "Marketplace need", "Portfolio value-add", "Lab cohort 4".
  --              Read-only to the firm, and seam-marked, the same asymmetry
  --              the research library draws for a client's document.
  source               TEXT NOT NULL DEFAULT 'ours',
  source_label         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "My book" is the only read, and the artboard sorts it unassigned-first then
-- coldest — which is done in the page over the loaded rows, because coldness is
-- derived from the interactions table below and not stored.
CREATE INDEX IF NOT EXISTS idx_partner_book_contacts_owner
  ON partner_book_contacts(owner_user_id, id);

-- `Unassigned` and `By owner` both narrow on this.
CREATE INDEX IF NOT EXISTS idx_partner_book_contacts_firm_owner
  ON partner_book_contacts(owner_user_id, firm_owner_user_id);

CREATE TABLE IF NOT EXISTS partner_book_interactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  contact_id     INTEGER NOT NULL REFERENCES partner_book_contacts(id) ON DELETE CASCADE,
  -- Denormalised from the contact, for the same reason `research_ask_answers`
  -- carries it: every read here is a predicate on the owner, and a join to
  -- prove ownership would be the one place that rule is expressed as a join.
  owner_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- WHEN IT HAPPENED, NOT WHEN IT WAS LOGGED. A call last month recorded today
  -- is a month-old touch, and `created_at` would call it fresh — the same trap
  -- `MarketZone` avoids by reading a reading's run date rather than its
  -- `updated_at`.
  happened_at    TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'note',
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "How many, and how recently" — the two numbers strength is derived from and
-- the two the row prints beside it.
CREATE INDEX IF NOT EXISTS idx_partner_book_interactions_contact
  ON partner_book_interactions(contact_id, happened_at DESC);
