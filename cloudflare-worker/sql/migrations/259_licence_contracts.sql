-- 259 — the licence agreement, instantiated from a master template (D110).
--
-- H3 STEP 5 DRAWS A CONTRACT AND THE LEDGER HAD NOWHERE TO PUT ONE. Migration
-- 187 records the TERMS a licence was agreed on — fee, share, seats, dates —
-- and migration 084's `legal_templates` records the master text HQ authors.
-- Nothing joined them, so "generated from master template vN" had no row: a
-- licence could be activated with no instrument behind it and the screen could
-- not say which version anybody signed.
--
-- THE RENDERED BODY IS STORED, NOT RE-RENDERED ON READ, and that is the whole
-- point of this table. A master template is edited: `legal_template_versions`
-- keeps every prior version precisely because an archived version STAYS
-- BINDING on the contracts that carry it. A row that held only a slug and a
-- number would still be re-rendered from today's merge values, so a licence
-- signed at a €90,000 fee would display tomorrow's €95,000 — a contract that
-- silently restates itself is not a record of anything.
--
-- NOT UNIQUE ON `licence_uid`. Re-terming a licence instantiates a NEW
-- contract; the prior one is superseded, not overwritten, for the same reason
-- `licence_events` is append-only. `superseded_at` marks it and nothing
-- deletes it.
--
-- A PENDING SIGNATURE DOES NOT BLOCK, which the canvas states and
-- `admin_licences.ts` already honours: `status` here is the instrument's own
-- progress and no activation gate reads it. The one thing that does block is a
-- territory conflict, and that is enforced by migration 187's UNIQUE index,
-- not by anything here.
--
-- NO FOREIGN KEY to `territory_licences` or `legal_templates`, matching 256
-- and 258: the uid and the slug are carried as plain values so a contract
-- survives a template being soft-deleted, which is exactly when the stored
-- body is the only remaining copy of what was agreed.

CREATE TABLE IF NOT EXISTS licence_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  licence_uid TEXT NOT NULL,
  -- Which master text, at which version. Both are needed: the slug alone
  -- names a moving target.
  template_slug TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  template_title TEXT NOT NULL,
  -- The instrument as at instantiation. See the header.
  body_md TEXT NOT NULL,
  -- Merge fields the template asked for that the licence could not fill, as a
  -- JSON array. They are LEFT VISIBLE in `body_md` rather than blanked: a
  -- placeholder someone can see is an unfinished contract, and an empty string
  -- in its place is an unfinished contract that reads as done.
  unfilled_fields TEXT NOT NULL DEFAULT '[]',
  --   draft     — instantiated, not sent
  --   sent      — out for signature
  --   signed    — executed
  --   void      — withdrawn before signature
  status TEXT NOT NULL DEFAULT 'draft'
         CHECK (status IN ('draft', 'sent', 'signed', 'void')),
  -- The e-signature envelope once one exists. Null until sent, and null
  -- forever for a contract signed on paper.
  envelope_uid TEXT,
  superseded_at TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  signed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licence_contracts_licence ON licence_contracts(licence_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_licence_contracts_status ON licence_contracts(status);
