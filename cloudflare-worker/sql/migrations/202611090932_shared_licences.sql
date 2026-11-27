-- D5057 (#5057, part 1 of #5047's user-licence series) — one licence identity
-- for both licence families.
--
-- WHAT THIS IS. `licences` is the registry of every Axal VC licence, whichever
-- family it belongs to:
--
--   operator  territory (the subsidiary/franchise licence), white_label,
--             master_franchise
--   user      founder, investor, operating_partner, advisor
--
-- Administrator is NOT a family: it stays a binding (`licence_admins`) on a
-- licence, and the family CHECK below refuses it.
--
-- WHAT IT IS NOT. It is an identity, not a second copy of the territory
-- licence. `territory_licences` stays authoritative for everything specific to
-- an operator licence: the entity and signatory, territories, seats, fees,
-- revenue share, terms, contracts and invoices. None of those columns is
-- copied here. A user licence never gets a `territory_licences` row (the
-- `territory_licence_id` CHECK refuses a user licence that points at one).
--
-- THE MAPPING: SAME UID, AND AN EXPLICIT POINTER. A shared row for a territory
-- licence takes the territory licence's own `uid` and `licence_ref`, and names
-- it by `territory_licence_id` (UNIQUE, so the mapping is one-to-one). This is
-- the least invasive relation there is:
--   - `territory_licences` takes no ALTER, and every route, URL and row that
--     names a territory uid keeps working, because that uid IS the shared uid;
--   - `licence_program_agreements.licence_uid` (D5048) already holds
--     territory uids, so it now names shared licences with no row rewritten.
--     Its freeze trigger refuses moving `licence_uid` and any update that does
--     not move `revision` by one, so a rewrite would have to bump the revision
--     of every executed agreement; the same uid makes that unnecessary.
-- `licences_territory_identity` below holds the uid and ref to the territory
-- row's at insert, so the two can never name different licences.
--
-- STATUS AND DATES FOLLOW THE TERRITORY ROW. `status` is NOT NULL so every
-- family can be read the same way. For a territory-backed row it is written by
-- the territory row's own writes, in the same statement
-- (`territory_licences_shared_mirror`): status, starts_on and renews_on, and the
-- type when `kind` changes. Nothing else writes them for such a row. `ends_on`
-- stays NULL for these rows: a territory licence records no end date (it
-- renews or is terminated). The vocabulary is a shape here, not a list: the
-- territory row's own CHECK closes it for operator licences, and the user
-- licence lifecycle is #5058's to define.
--
-- THE HOLDER. An operator licence is held by an entity. `holder_id` is the
-- territory row's `entity_id` when it names one; a territory licence that names
-- its party only by legal name (no `entities` row, `entity_id` NULL) holds
-- `territory_licence:<uid>`, i.e. "the party named on that territory licence",
-- rather than an invented entity id.
--
-- ONE-TO-ONE FOR NEW LICENCES. `territory_licences_shared_identity` writes the
-- shared row in the same statement as any INSERT into `territory_licences`, by
-- whichever path (the HQ create route, a seed, a fixture), so no territory
-- licence ever exists without its shared identity.
--
-- AGREEMENTS ANCHOR ON IT. From this file on, a `licence_program_agreements`
-- row must name a shared licence (`licence_program_agreements_shared_licence`).
-- Every writer today passes a territory uid, which has a shared row by the
-- backfill or the insert trigger, so no reader or writer changes.
--
-- THE BACKFILL. One shared row per existing territory licence, skipped when it
-- already has one, so the file applies twice with no change. It writes nothing
-- to `territory_licences`, `licence_contracts`, `licence_fee_invoices`,
-- `licence_terms` or `licence_program_agreements`.
--
-- No BEGIN/COMMIT: D1 rejects transaction control in a migration file (#26).

CREATE TABLE IF NOT EXISTS licences (
  uid                   TEXT PRIMARY KEY,
  licence_ref           TEXT NOT NULL UNIQUE CHECK (length(licence_ref) BETWEEN 1 AND 60),
  licence_family        TEXT NOT NULL CHECK (licence_family IN ('operator', 'user')),
  licence_type          TEXT NOT NULL
                        CHECK (licence_type IN ('territory', 'white_label', 'master_franchise',
                                                'founder', 'investor', 'operating_partner', 'advisor')),
  holder_type           TEXT NOT NULL CHECK (holder_type IN ('entity', 'user')),
  holder_id             TEXT NOT NULL CHECK (length(holder_id) BETWEEN 1 AND 120),
  status                TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 40 AND status NOT GLOB '*[^a-z_]*'),
  starts_on             TEXT,
  ends_on               TEXT,
  renews_on             TEXT,
  revision              INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  -- The operator licence's detail row, when it has one. UNIQUE: one shared
  -- licence per territory licence, and the other way round.
  territory_licence_id  INTEGER UNIQUE REFERENCES territory_licences(id),
  -- How the row came to exist: this file's backfill, the territory insert
  -- trigger, or the application (user licences, #5058).
  origin                TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'territory_licence', 'backfill_d5057')),
  created_at            TEXT NOT NULL,
  created_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TEXT,
  updated_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- The family is the type's, never a free label.
  CHECK ((licence_family = 'operator') = (licence_type IN ('territory', 'white_label', 'master_franchise'))),
  -- An operator licence is held by an entity.
  CHECK (licence_family <> 'operator' OR holder_type = 'entity'),
  -- Only a territory or white-label operator licence has a territory row; a
  -- user licence is never a territory.
  CHECK (territory_licence_id IS NULL OR (licence_family = 'operator' AND licence_type IN ('territory', 'white_label')))
);

CREATE INDEX IF NOT EXISTS idx_licences_family ON licences (licence_family, licence_type, status);
CREATE INDEX IF NOT EXISTS idx_licences_holder ON licences (holder_type, holder_id);

-- A shared row for a territory licence carries that licence's uid and ref.
CREATE TRIGGER IF NOT EXISTS licences_territory_identity
BEFORE INSERT ON licences
WHEN NEW.territory_licence_id IS NOT NULL
 AND (NEW.uid IS NOT (SELECT t.uid FROM territory_licences t WHERE t.id = NEW.territory_licence_id)
      OR NEW.licence_ref IS NOT (SELECT t.licence_ref FROM territory_licences t WHERE t.id = NEW.territory_licence_id))
BEGIN
  SELECT RAISE(ABORT, 'licences: a territory licence''s shared identity takes its uid and licence_ref (D5057).');
END;

-- The identity never changes: uid, ref, family, holder, the territory row it
-- maps, and where it came from.
CREATE TRIGGER IF NOT EXISTS licences_identity_frozen
BEFORE UPDATE OF uid, licence_ref, licence_family, holder_type, holder_id, territory_licence_id, origin, created_at ON licences
WHEN OLD.uid IS NOT NEW.uid
  OR OLD.licence_ref IS NOT NEW.licence_ref
  OR OLD.licence_family IS NOT NEW.licence_family
  OR OLD.holder_type IS NOT NEW.holder_type
  OR OLD.holder_id IS NOT NEW.holder_id
  OR OLD.territory_licence_id IS NOT NEW.territory_licence_id
  OR OLD.origin IS NOT NEW.origin
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'licences: a licence''s identity (uid, ref, family, holder, territory row) never changes (D5057).');
END;

-- Every change to what a licence is moves its revision by exactly one.
CREATE TRIGGER IF NOT EXISTS licences_revision_moves
BEFORE UPDATE OF licence_type, status, starts_on, ends_on, renews_on, revision ON licences
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'licences: every write moves revision by exactly one (D5057).');
END;

CREATE TRIGGER IF NOT EXISTS licences_block_delete
BEFORE DELETE ON licences
BEGIN
  SELECT RAISE(ABORT, 'licences keeps every licence (D5057). End or terminate a licence; never delete it.');
END;

-- ─────────────────────────────────────────────── the backfill

INSERT INTO licences
  (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, ends_on, renews_on,
   revision, territory_licence_id, origin, created_at, created_by_user_id)
SELECT t.uid, t.licence_ref, 'operator',
       CASE t.kind WHEN 'white_label' THEN 'white_label' ELSE 'territory' END,
       'entity',
       CASE WHEN t.entity_id IS NOT NULL THEN CAST(t.entity_id AS TEXT) ELSE 'territory_licence:' || t.uid END,
       t.status, t.starts_on, NULL, t.renews_on,
       0, t.id, 'backfill_d5057', COALESCE(t.created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), t.created_by_user_id
  FROM territory_licences t
 WHERE NOT EXISTS (SELECT 1 FROM licences s WHERE s.territory_licence_id = t.id)
 ORDER BY t.id;

-- ─────────────────────────────────────────────── new territory licences

CREATE TRIGGER IF NOT EXISTS territory_licences_shared_identity
AFTER INSERT ON territory_licences
BEGIN
  INSERT INTO licences
    (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, ends_on, renews_on,
     revision, territory_licence_id, origin, created_at, created_by_user_id)
  SELECT NEW.uid, NEW.licence_ref, 'operator',
         CASE NEW.kind WHEN 'white_label' THEN 'white_label' ELSE 'territory' END,
         'entity',
         CASE WHEN NEW.entity_id IS NOT NULL THEN CAST(NEW.entity_id AS TEXT) ELSE 'territory_licence:' || NEW.uid END,
         NEW.status, NEW.starts_on, NULL, NEW.renews_on,
         0, NEW.id, 'territory_licence', COALESCE(NEW.created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), NEW.created_by_user_id
   WHERE NOT EXISTS (SELECT 1 FROM licences s WHERE s.territory_licence_id = NEW.id);
END;

-- The territory row's status, dates and kind, followed in the same statement.
CREATE TRIGGER IF NOT EXISTS territory_licences_shared_mirror
AFTER UPDATE OF status, starts_on, renews_on, kind ON territory_licences
WHEN OLD.status IS NOT NEW.status
  OR OLD.starts_on IS NOT NEW.starts_on
  OR OLD.renews_on IS NOT NEW.renews_on
  OR OLD.kind IS NOT NEW.kind
BEGIN
  UPDATE licences
     SET status = NEW.status, starts_on = NEW.starts_on, renews_on = NEW.renews_on,
         licence_type = CASE NEW.kind WHEN 'white_label' THEN 'white_label' ELSE 'territory' END,
         revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
   WHERE territory_licence_id = NEW.id;
END;

-- ─────────────────────────────────────────────── agreements anchor on the shared uid

CREATE TRIGGER IF NOT EXISTS licence_program_agreements_shared_licence
BEFORE INSERT ON licence_program_agreements
WHEN NOT EXISTS (SELECT 1 FROM licences s WHERE s.uid = NEW.licence_uid)
BEGIN
  SELECT RAISE(ABORT, 'licence_program_agreements: licence_uid names a shared licence (licences.uid, D5057).');
END;
