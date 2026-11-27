-- D5048 (#5048, part 1 of #5047) — the canonical store for package and program
-- legal agreements, beside (never inside) `licence_contracts`.
--
-- WHY A NEW TABLE. `licence_contracts` is the territory licence's MASTER
-- agreement, and it holds exactly one current row per licence
-- (`idx_licence_contracts_one_current`, D4671). A program or package agreement
-- written there would supersede the master agreement. So nothing in this file,
-- and nothing that writes the table below, touches `licence_contracts`.
--
-- `licence_uid` IS THE TERRITORY LICENCE'S uid FOR NOW. The shared licence
-- identity (#5057: operator and user licence families) is not built. Until it
-- is, `licence_uid` holds `territory_licences.uid`. It carries no foreign key on
-- purpose, so #5057 can repoint it at the shared identity's uid with one UPDATE
-- and no table rebuild (D5048 §2).
--
-- ONE AGREEMENT SLOT, MANY VERSIONS. `slot_key` names what an agreement is FOR
-- on its licence, derived from the kind and its scope and held to that by a
-- CHECK, so the application cannot store a slot that disagrees with the row:
--
--   program_licence    program_licence:<program_key>
--   program_schedule   program_schedule:<program_key>
--   program_addendum   program_addendum:<program_key>:<addendum_key>
--   package_master     package_master
--   package_addendum   package_addendum:<addendum_key>
--
-- A slot holds at most ONE IN-FLIGHT version (draft, ready, sent,
-- partially_signed) and at most ONE EXECUTED version that nothing has
-- superseded. They are two indexes, not one, so an amendment can be drafted and
-- sent while the executed version stays in force: the executed one is
-- superseded only when its replacement is executed (D5048 §3). Superseded and
-- voided versions are history: any number of them coexist.
--
-- FROZEN ONCE SENT. The trigger below refuses, at the database: changing the
-- template, its version or the body hash after the version left draft/ready;
-- changing an envelope once linked; changing a signed hash or signature time
-- once recorded; moving a version to another licence, slot or scope; and
-- leaving a terminal state; sending a sent version back to draft. `revision` goes up by one on every write, and every
-- write names the revision it read (services/programAgreements.ts).
--
-- THE HISTORY. `licence_agreement_events` is append-only (the two triggers
-- after it, as migration 269 seals `licence_events`), one row per write, in the
-- same batch as the write.
--
-- THE SCHEDULE BACKFILL. Every program-schedule envelope already sent
-- (`program_grant_schedules`, D4805, and any `program_grants.schedule_contract_uid`
-- that table does not name) gets one canonical row, status read from its
-- envelope and its schedule row. `program_grants.schedule_contract_uid` is NOT
-- dropped or changed: it stays the read-through the grant routes, the branch
-- copy and the completion hook use until they move to this table. Each insert
-- skips an envelope already on file, so the file can be applied twice.

CREATE TABLE IF NOT EXISTS licence_program_agreements (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                     TEXT NOT NULL UNIQUE,
  -- territory_licences.uid until #5057's shared licence identity exists.
  licence_uid             TEXT NOT NULL,
  agreement_kind          TEXT NOT NULL
                          CHECK (agreement_kind IN ('program_licence', 'program_schedule', 'program_addendum',
                                                    'package_master', 'package_addendum')),
  slot_key                TEXT NOT NULL,
  program_key             TEXT CHECK (program_key IS NULL OR (length(program_key) BETWEEN 1 AND 60 AND program_key NOT GLOB '*[^a-z0-9-]*')),
  program_grant_id        INTEGER REFERENCES program_grants(id) ON DELETE SET NULL,
  package_offer_uid       TEXT,
  package_key             TEXT CHECK (package_key IS NULL OR (length(package_key) BETWEEN 1 AND 60 AND package_key NOT GLOB '*[^a-z0-9_-]*')),
  package_version         INTEGER CHECK (package_version IS NULL OR (typeof(package_version) = 'integer' AND package_version >= 1)),
  addendum_key            TEXT CHECK (addendum_key IS NULL OR (length(addendum_key) BETWEEN 1 AND 60 AND addendum_key NOT GLOB '*[^a-z0-9_-]*')),
  template_slug           TEXT NOT NULL CHECK (length(template_slug) BETWEEN 1 AND 120),
  template_version        INTEGER CHECK (template_version IS NULL OR (typeof(template_version) = 'integer' AND template_version >= 1)),
  status                  TEXT NOT NULL
                          CHECK (status IN ('draft', 'ready', 'sent', 'partially_signed', 'executed', 'voided', 'superseded')),
  envelope_uuid           TEXT,
  body_sha256             TEXT CHECK (body_sha256 IS NULL OR length(body_sha256) = 64),
  signed_document_sha256  TEXT CHECK (signed_document_sha256 IS NULL OR length(signed_document_sha256) = 64),
  effective_from          TEXT,
  effective_to            TEXT,
  -- How the row came to exist: written by the application, or by this file's backfill.
  origin                  TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'backfill_d5048')),
  created_at              TEXT NOT NULL,
  created_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_at                 TEXT,
  signed_at               TEXT,
  voided_at               TEXT,
  superseded_at           TEXT,
  superseded_by_uid       TEXT,
  updated_at              TEXT,
  revision                INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  -- The scope each kind needs, and nothing it does not.
  CHECK (agreement_kind NOT IN ('program_licence', 'program_schedule', 'program_addendum') OR program_key IS NOT NULL),
  CHECK (agreement_kind NOT IN ('package_master', 'package_addendum') OR package_key IS NOT NULL),
  CHECK ((agreement_kind IN ('program_addendum', 'package_addendum')) = (addendum_key IS NOT NULL)),
  -- The slot is the kind and its scope, never a free label.
  CHECK (slot_key = CASE agreement_kind
                      WHEN 'program_licence'  THEN 'program_licence:' || program_key
                      WHEN 'program_schedule' THEN 'program_schedule:' || program_key
                      WHEN 'program_addendum' THEN 'program_addendum:' || program_key || ':' || addendum_key
                      WHEN 'package_master'   THEN 'package_master'
                      WHEN 'package_addendum' THEN 'package_addendum:' || addendum_key
                    END),
  -- A version past draft/ready has its envelope; an executed one its signature time.
  CHECK (status IN ('draft', 'ready', 'voided', 'superseded') OR envelope_uuid IS NOT NULL),
  CHECK (status <> 'executed' OR signed_at IS NOT NULL),
  CHECK (status <> 'superseded' OR superseded_at IS NOT NULL)
);

-- One envelope is one agreement version.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_program_agreements_envelope
  ON licence_program_agreements (envelope_uuid) WHERE envelope_uuid IS NOT NULL;
-- At most one version in flight per slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_program_agreements_one_in_flight
  ON licence_program_agreements (licence_uid, slot_key) WHERE status IN ('draft', 'ready', 'sent', 'partially_signed');
-- At most one executed version in force per slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_program_agreements_one_executed
  ON licence_program_agreements (licence_uid, slot_key) WHERE status = 'executed';
CREATE INDEX IF NOT EXISTS idx_licence_program_agreements_licence
  ON licence_program_agreements (licence_uid, slot_key, id);
CREATE INDEX IF NOT EXISTS idx_licence_program_agreements_grant
  ON licence_program_agreements (program_grant_id) WHERE program_grant_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS licence_program_agreements_frozen
BEFORE UPDATE ON licence_program_agreements
WHEN OLD.uid IS NOT NEW.uid
  OR OLD.licence_uid IS NOT NEW.licence_uid
  OR OLD.agreement_kind IS NOT NEW.agreement_kind
  OR OLD.slot_key IS NOT NEW.slot_key
  OR OLD.program_key IS NOT NEW.program_key
  OR OLD.package_key IS NOT NEW.package_key
  OR OLD.addendum_key IS NOT NEW.addendum_key
  OR OLD.origin IS NOT NEW.origin
  OR OLD.created_at IS NOT NEW.created_at
  OR NEW.revision <> OLD.revision + 1
  OR (OLD.status NOT IN ('draft', 'ready')
      AND (OLD.template_slug IS NOT NEW.template_slug
           OR OLD.template_version IS NOT NEW.template_version
           OR OLD.body_sha256 IS NOT NEW.body_sha256
           OR OLD.package_version IS NOT NEW.package_version
           OR OLD.package_offer_uid IS NOT NEW.package_offer_uid))
  OR (OLD.envelope_uuid IS NOT NULL AND OLD.envelope_uuid IS NOT NEW.envelope_uuid)
  OR (OLD.signed_document_sha256 IS NOT NULL AND OLD.signed_document_sha256 IS NOT NEW.signed_document_sha256)
  OR (OLD.signed_at IS NOT NULL AND OLD.signed_at IS NOT NEW.signed_at)
  OR (OLD.status IN ('voided', 'superseded') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'executed' AND NEW.status NOT IN ('executed', 'superseded'))
  OR (OLD.status IN ('sent', 'partially_signed') AND NEW.status NOT IN ('sent', 'partially_signed', 'executed', 'voided', 'superseded'))
BEGIN
  SELECT RAISE(ABORT,
    'licence_program_agreements: a sent or signed agreement version is frozen (D5048). Its template, version, body hash, envelope and signature cannot change, a terminal version cannot reopen, and every write moves revision by exactly one.');
END;

CREATE TRIGGER IF NOT EXISTS licence_program_agreements_block_delete
BEFORE DELETE ON licence_program_agreements
BEGIN
  SELECT RAISE(ABORT,
    'licence_program_agreements keeps every version (D5048). Void or supersede a version; never delete it.');
END;

CREATE TABLE IF NOT EXISTS licence_agreement_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_uid   TEXT NOT NULL,
  licence_uid     TEXT NOT NULL,
  action          TEXT NOT NULL
                  CHECK (action IN ('drafted', 'readied', 'sent', 'partially_signed', 'executed', 'voided',
                                    'superseded', 'signed_after_supersede', 'backfilled')),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  revision        INTEGER NOT NULL,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail_json     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licence_agreement_events_agreement ON licence_agreement_events (agreement_uid, id);
CREATE INDEX IF NOT EXISTS idx_licence_agreement_events_licence ON licence_agreement_events (licence_uid, id);

CREATE TRIGGER IF NOT EXISTS licence_agreement_events_block_update
BEFORE UPDATE ON licence_agreement_events
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_events is append-only (D5048). Append the correcting event.');
END;

CREATE TRIGGER IF NOT EXISTS licence_agreement_events_block_delete
BEFORE DELETE ON licence_agreement_events
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_events is append-only (D5048). An agreement transition that happened stays recorded.');
END;

-- ─────────────────────────────────────────────── the schedule backfill
--
-- A schedule row's agreement status, from the envelope and the schedule row:
--   signed (schedule row or envelope completed)  executed, or superseded when a
--                                                newer revision replaced it or a
--                                                newer executed row exists
--   envelope void / rejected                     voided
--   otherwise                                    sent / partially_signed, or
--                                                superseded when replaced
-- Only the newest row per grant of each kind (in flight, executed) may stay
-- current, so the two one-per-slot indexes always hold.

INSERT INTO licence_program_agreements
  (uid, licence_uid, agreement_kind, slot_key, program_key, program_grant_id, template_slug, template_version,
   status, envelope_uuid, body_sha256, signed_document_sha256, origin, created_at, created_by_user_id,
   sent_at, signed_at, voided_at, superseded_at, updated_at, revision)
SELECT lower(hex(randomblob(16))), l.uid, 'program_schedule', 'program_schedule:' || g.program_key, g.program_key, g.id,
       'program_schedule', e.template_version,
       CASE x.state
         WHEN 'executed' THEN CASE WHEN x.current = 1 THEN 'executed' ELSE 'superseded' END
         WHEN 'voided' THEN 'voided'
         ELSE CASE WHEN x.current = 1 THEN x.state ELSE 'superseded' END
       END,
       s.envelope_uuid, CASE WHEN length(e.body_sha256) = 64 THEN e.body_sha256 END,
       (SELECT f.file_sha256 FROM legal_document_files f
         WHERE f.envelope_id = e.id AND f.kind IN ('signed_copy', 'docusign_signed') ORDER BY f.id DESC LIMIT 1),
       'backfill_d5048', s.sent_at, e.created_by, s.sent_at,
       CASE WHEN x.state = 'executed' THEN x.signed END,
       CASE WHEN x.state = 'voided' THEN s.sent_at END,
       CASE WHEN x.state <> 'voided' AND x.current = 0 THEN COALESCE(s.superseded_at, s.sent_at) END,
       s.sent_at, 0
  FROM program_grant_schedules s
  JOIN program_grants g ON g.id = s.grant_id
  JOIN territory_licences l ON l.id = g.licence_id
  LEFT JOIN esign_envelopes e ON e.envelope_uuid = s.envelope_uuid
  JOIN (
    SELECT s1.id AS sid, st.state, st.signed,
           CASE WHEN s1.superseded_at IS NULL AND s1.id = (
             SELECT MAX(s2.id) FROM program_grant_schedules s2
               LEFT JOIN esign_envelopes e2 ON e2.envelope_uuid = s2.envelope_uuid
              WHERE s2.grant_id = s1.grant_id AND s2.superseded_at IS NULL
                AND (CASE WHEN s2.signed_at IS NOT NULL OR e2.status = 'completed' THEN 'executed'
                          WHEN e2.status IN ('void', 'rejected') THEN 'voided'
                          ELSE 'open' END)
                  = (CASE WHEN st.state = 'executed' THEN 'executed' WHEN st.state = 'voided' THEN 'voided' ELSE 'open' END)
           ) THEN 1 ELSE 0 END AS current
      FROM program_grant_schedules s1
      JOIN (
        SELECT s0.id AS sid,
               CASE WHEN s0.signed_at IS NOT NULL OR e0.status = 'completed' THEN 'executed'
                    WHEN e0.status IN ('void', 'rejected') THEN 'voided'
                    WHEN e0.status = 'partially_signed' THEN 'partially_signed'
                    ELSE 'sent' END AS state,
               COALESCE(s0.signed_at, e0.completed_at, s0.sent_at) AS signed
          FROM program_grant_schedules s0
          LEFT JOIN esign_envelopes e0 ON e0.envelope_uuid = s0.envelope_uuid
      ) st ON st.sid = s1.id
  ) x ON x.sid = s.id
 WHERE NOT EXISTS (SELECT 1 FROM licence_program_agreements a WHERE a.envelope_uuid = s.envelope_uuid)
 ORDER BY s.id;

-- A grant naming an envelope that no schedule row names (none should exist after
-- D4805's own backfill; this keeps any such envelope reachable all the same). It
-- is current only when its slot has no current row of the same kind already.
INSERT INTO licence_program_agreements
  (uid, licence_uid, agreement_kind, slot_key, program_key, program_grant_id, template_slug, template_version,
   status, envelope_uuid, body_sha256, origin, created_at, created_by_user_id,
   sent_at, signed_at, voided_at, superseded_at, updated_at, revision)
SELECT lower(hex(randomblob(16))), z.licence_uid, 'program_schedule', z.slot_key, z.program_key, z.grant_id,
       'program_schedule', z.template_version, z.st, z.envelope_uuid, z.body_sha256, 'backfill_d5048',
       z.set_at, z.created_by, z.set_at,
       CASE WHEN z.signed = 1 THEN z.signed_at END,
       CASE WHEN z.st = 'voided' THEN z.set_at END,
       CASE WHEN z.st = 'superseded' THEN z.set_at END,
       z.set_at, 0
  FROM (
    SELECT l.uid AS licence_uid, 'program_schedule:' || g.program_key AS slot_key, g.program_key, g.id AS grant_id,
           e.template_version, g.schedule_contract_uid AS envelope_uuid,
           CASE WHEN length(e.body_sha256) = 64 THEN e.body_sha256 END AS body_sha256,
           g.set_at, e.created_by,
           CASE WHEN g.schedule_signed_at IS NOT NULL OR e.status = 'completed' THEN 1 ELSE 0 END AS signed,
           COALESCE(g.schedule_signed_at, e.completed_at, g.set_at) AS signed_at,
           CASE
             WHEN g.schedule_signed_at IS NOT NULL OR e.status = 'completed' THEN
               CASE WHEN EXISTS (SELECT 1 FROM licence_program_agreements a WHERE a.licence_uid = l.uid
                                  AND a.slot_key = 'program_schedule:' || g.program_key AND a.status = 'executed')
                    THEN 'superseded' ELSE 'executed' END
             WHEN e.status IN ('void', 'rejected') THEN 'voided'
             WHEN EXISTS (SELECT 1 FROM licence_program_agreements a WHERE a.licence_uid = l.uid
                           AND a.slot_key = 'program_schedule:' || g.program_key
                           AND a.status IN ('draft', 'ready', 'sent', 'partially_signed')) THEN 'superseded'
             WHEN e.status = 'partially_signed' THEN 'partially_signed'
             ELSE 'sent'
           END AS st
      FROM program_grants g
      JOIN territory_licences l ON l.id = g.licence_id
      LEFT JOIN esign_envelopes e ON e.envelope_uuid = g.schedule_contract_uid
     WHERE g.schedule_contract_uid IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM licence_program_agreements a WHERE a.envelope_uuid = g.schedule_contract_uid)
  ) z;

-- One history row per backfilled version, once.
INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
SELECT a.uid, a.licence_uid, 'backfilled', NULL, a.status, a.revision, NULL,
       json_object('envelope_uuid', a.envelope_uuid, 'program_key', a.program_key, 'program_grant_id', a.program_grant_id,
                   'source', 'program_grant_schedules / program_grants.schedule_contract_uid'),
       a.created_at
  FROM licence_program_agreements a
 WHERE a.origin = 'backfill_d5048'
   AND NOT EXISTS (SELECT 1 FROM licence_agreement_events v WHERE v.agreement_uid = a.uid AND v.action = 'backfilled');
