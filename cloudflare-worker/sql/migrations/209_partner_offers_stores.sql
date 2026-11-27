-- 209 — the stores behind the three Offers zones.
--
-- Companion to 208, which did Pipeline and Delivery. Split by bucket because a
-- rejected statement holds every later migration AND the worker deploy behind
-- it, so two readable files beat one long one.
--
-- ── Offers · Visibility ────────────────────────────────────────────────────
-- The zone's argument is that volume is not the ranking: a directory listing
-- with thousands of views and no engagements reads worse than a referral with
-- two leads and one. That comparison needs each engagement to NAME the surface
-- it came from, and no such column exists on `engagements` or `founder_needs`.
--
-- ATTRIBUTION IS A JOIN, NEVER A MODEL. `source_surface_id` is nullable and
-- stays null for everything that arrived before it existed. Counting joined
-- rows means an unattributed engagement is simply not counted; modelling the
-- gap would make the widest column the least true, which is the exact failure
-- the zone was written to avoid.
--
-- VIEWS ARE NOT HERE. A view count needs an impression pipeline, not a table,
-- and the zone must say "Not recorded" for it rather than divide by a number
-- nobody measures.
CREATE TABLE IF NOT EXISTS partner_surfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- `partners.id`: a surface belongs to the DIRECTORY ENTITY, the same key
  -- `quotes` and `engagements` already use. The other live convention keys on
  -- `users.id` for account-attached facts (perks, service_offerings); mixing
  -- the two in one feature is how a partner ends up seeing half their data.
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'directory'
    CHECK (kind IN ('directory', 'referral', 'outbound', 'content', 'event', 'other')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_surfaces_name
  ON partner_surfaces(partner_id, name);

-- The join itself, as its own table rather than a column on `engagements`.
-- `engagements` is defined three times across schema.sql, t13_t14_t15.sql and
-- the migration set, D1 keeps one table per name, and a column added to the
-- wrong lineage may not exist on the row that won — which is what
-- check-migration-column-shapes.mjs was written for after migration 196.
CREATE TABLE IF NOT EXISTS engagement_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  surface_id INTEGER NOT NULL REFERENCES partner_surfaces(id),
  attributed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_sources_engagement
  ON engagement_sources(engagement_id);
CREATE INDEX IF NOT EXISTS idx_engagement_sources_surface
  ON engagement_sources(surface_id);

-- ── Offers · Proof ─────────────────────────────────────────────────────────
-- The partner half of what migration 204 gave advisors, and deliberately the
-- same shape so the two can be audited by one query. Everything 204's header
-- argues applies here unchanged:
--
--   · PUBLISHED IS DERIVED. "Is this case study publishable" is "a consent row
--     exists with consent_given = 1", computed at read time. A boolean on the
--     item would be a second source of truth, and the two would disagree the
--     first time a consent was withdrawn through a path that forgot the flag.
--   · WITHDRAWAL IS A STATE, NOT A DELETE. `consent_given` back to 0 with
--     `withdrawn_at` set keeps the record that consent was given and taken
--     back. An attestation that can silently vanish is not evidence.
--   · CONSENT IS A GATE, NOT A WARNING. An unconsented outcome has no
--     published form to suppress — it simply is not one.
--
-- The difference from 204 is the provenance: a partner's proof hangs off an
-- ENGAGEMENT, so which work produced it is a foreign key rather than a typed
-- claim, and the client whose consent is being recorded is the counterparty on
-- that engagement rather than a name somebody entered.
CREATE TABLE IF NOT EXISTS partner_proof_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  engagement_id INTEGER REFERENCES engagements(id),
  kind TEXT NOT NULL DEFAULT 'case_study'
    CHECK (kind IN ('case_study', 'outcome', 'testimonial')),
  title TEXT NOT NULL,
  detail TEXT,
  -- The firm's own claim about the result. It is NOT evidence until a consent
  -- row confirms it, and the zone must render it as a claim until then.
  outcome_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_proof_items_partner
  ON partner_proof_items(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_proof_items_engagement
  ON partner_proof_items(engagement_id);

CREATE TABLE IF NOT EXISTS partner_proof_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  proof_item_id INTEGER NOT NULL REFERENCES partner_proof_items(id),
  -- Who is consenting, in their own words rather than resolved from a join:
  -- the person who agrees may not be the account that holds the engagement,
  -- and recording the account would attribute consent to someone who did not
  -- give it.
  consenter_name TEXT NOT NULL,
  consenter_email TEXT,
  consenter_role TEXT,
  requested_at TEXT,
  requested_by INTEGER,
  request_token TEXT UNIQUE,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  -- The exact words agreed to. Consent to "a case study" and consent to "a
  -- case study naming our revenue" are different consents.
  consent_text TEXT,
  consent_captured_by INTEGER,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_proof_consents_item
  ON partner_proof_consents(proof_item_id, consent_given);

-- ── Offers · Audience fit ──────────────────────────────────────────────────
-- The working half of this zone is who the firm is NOT for: a stated budget
-- floor, sectors declined, capabilities honestly absent. It is what lets
-- Pipeline pass a lead with a named reason instead of silence, so it is the
-- one store here that changes a zone that is already live.
--
-- `referred_to` is part of the rule rather than a note on it. Passing quietly
-- wastes the founder's week; passing with a named alternative does not, and a
-- rule that cannot carry the alternative cannot produce that sentence.
CREATE TABLE IF NOT EXISTS partner_fit_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  kind TEXT NOT NULL
    CHECK (kind IN ('budget_floor', 'sector_declined', 'capability_absent', 'best_fit')),
  -- For `budget_floor`. Integer cents, like every new money column in 208.
  -- NULL for the other kinds, which are not amounts.
  floor_cents INTEGER,
  value TEXT,
  -- Why, in the firm's own words. This is the sentence a pass quotes, so an
  -- empty one produces the silence the zone exists to replace.
  statement TEXT,
  referred_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partner_fit_rules_partner
  ON partner_fit_rules(partner_id, kind, is_active);
