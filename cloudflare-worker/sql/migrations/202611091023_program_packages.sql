-- 202611091023 — D5022 (#5022, part 1 of #5021): the durable, versioned package catalogue for Axal VC
-- franchise offers. Named by its UTC minute (D4106).
--
-- TWO NEW TABLES. Nothing existing changes shape.
--
--   program_packages        one row per PACKAGE VERSION: `package_key` names the commercial product
--                           (`core_network`, `talent_learning`, `venture_building`, `full_axal_vc` — the keys
--                           `services/agreementTemplates.ts` already names its package agreement templates
--                           with, D5049/#5049), `version` is a new row every time, never an edit. The lifecycle
--                           is `draft -> active -> retired`; the trigger below freezes every commercial and
--                           identifying field once a version leaves `draft`, so publishing a change means
--                           inserting the next version, never rewriting this one (D5022's acceptance criteria).
--   program_package_items   the programs one package VERSION bundles, by `program_key` (the stable keys
--                           `services/programRegistry.ts` already owns, never a display label). Composed only
--                           while its package version is a draft; the triggers below freeze the composition
--                           the moment that version is published, same as the package row itself.
--
-- WHY `package_key` IS NOT A FOREIGN KEY HERE EITHER. `licence_program_agreements.package_key`
-- (migration 202611082025, D5048) already carries this exact value with its own CHECK, written before this
-- table existed ("free columns until #5021's package store exists"). It stays a free column: a licence's
-- agreement names the package key and version it was drafted for, and that pairing must survive a package
-- row this table never deletes, not depend on one staying reachable by FK.
--
-- WHAT THIS FILE DOES NOT BUILD (left to #5021's later parts, named so nobody re-invents them here):
--   · country-adjusted pricing, bundle floor/ceiling application, rounding or calculation trace — #5023.
--   · a package OFFER or ACCEPTANCE, and the program grants it would orchestrate — #5024. No table here
--     links a package version to a licence; `licence_agreement_policy_holdings` (D5052, migration
--     202611090840) is a different thing — a legal-policy holding, not a commercial acceptance — and its own
--     file already says package acceptance lands here only once this store exists, which it now does.
--   · upgrade/downgrade/renewal/proration rules — #5025.
--   · HQ's package UI and the franchisee read surface — #5026.
--
-- NO LICENCE-TO-PACKAGE LINK TABLE EXISTS YET (scoping boundary, not an oversight): `territory_licences` has
-- no package column, and #5024 is where a licence's held package is recorded. So "retiring a package does
-- not alter licences that already hold it" is true today for the only reason that matters right now — nothing
-- yet points at a package row to be altered — and stays true once #5024 lands only because that table will
-- hold a FROZEN package_key + version per licence, read-through, never live off this catalogue's current row.

CREATE TABLE IF NOT EXISTS program_packages (
  uid                     TEXT PRIMARY KEY,
  package_key             TEXT NOT NULL CHECK (length(package_key) BETWEEN 1 AND 60 AND package_key NOT GLOB '*[^a-z0-9_-]*'),
  version                 INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  name                    TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description             TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  currency                TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3 AND currency = upper(currency)),
  base_annual_fee_cents   INTEGER NOT NULL CHECK (typeof(base_annual_fee_cents) = 'integer' AND base_annual_fee_cents >= 0),
  guidance_min_cents      INTEGER CHECK (guidance_min_cents IS NULL OR (typeof(guidance_min_cents) = 'integer' AND guidance_min_cents >= 0)),
  guidance_max_cents      INTEGER CHECK (guidance_max_cents IS NULL OR (typeof(guidance_max_cents) = 'integer' AND guidance_max_cents >= 0)),
  floor_multiplier_ppm    INTEGER CHECK (floor_multiplier_ppm IS NULL OR (typeof(floor_multiplier_ppm) = 'integer' AND floor_multiplier_ppm >= 0)),
  ceiling_multiplier_ppm  INTEGER CHECK (ceiling_multiplier_ppm IS NULL OR (typeof(ceiling_multiplier_ppm) = 'integer' AND ceiling_multiplier_ppm >= 0)),
  effective_from          TEXT NOT NULL,
  effective_to            TEXT,
  created_at              TEXT NOT NULL,
  created_by              TEXT,
  UNIQUE (package_key, version),
  CHECK (guidance_min_cents IS NULL OR guidance_max_cents IS NULL OR guidance_max_cents >= guidance_min_cents),
  CHECK (floor_multiplier_ppm IS NULL OR ceiling_multiplier_ppm IS NULL OR ceiling_multiplier_ppm >= floor_multiplier_ppm),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- At most one ACTIVE version per package key: "the active Core Network version" is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_packages_one_active ON program_packages (package_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_program_packages_key_status ON program_packages (package_key, status, version);

-- An active or retired version's identity, composition-adjacent and commercial-default fields are frozen.
-- Only the status may move on (draft -> active -> retired), with retiring free to set effective_to.
CREATE TRIGGER IF NOT EXISTS trg_program_packages_frozen
BEFORE UPDATE ON program_packages
WHEN OLD.status <> 'draft' AND (
  NEW.uid IS NOT OLD.uid OR NEW.package_key IS NOT OLD.package_key OR NEW.version IS NOT OLD.version
  OR NEW.name IS NOT OLD.name OR NEW.description IS NOT OLD.description OR NEW.currency IS NOT OLD.currency
  OR NEW.base_annual_fee_cents IS NOT OLD.base_annual_fee_cents OR NEW.guidance_min_cents IS NOT OLD.guidance_min_cents
  OR NEW.guidance_max_cents IS NOT OLD.guidance_max_cents OR NEW.floor_multiplier_ppm IS NOT OLD.floor_multiplier_ppm
  OR NEW.ceiling_multiplier_ppm IS NOT OLD.ceiling_multiplier_ppm OR NEW.effective_from IS NOT OLD.effective_from
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
  OR (OLD.status = 'retired' AND NEW.status <> 'retired')
  OR (OLD.status = 'active' AND NEW.status = 'draft')
)
BEGIN
  SELECT RAISE(ABORT, 'program_package_immutable');
END;

-- A published (active or retired) version is history and is never deleted; only a draft may be, before it is ever offered.
CREATE TRIGGER IF NOT EXISTS trg_program_packages_no_delete
BEFORE DELETE ON program_packages
WHEN OLD.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'program_package_immutable');
END;

CREATE TABLE IF NOT EXISTS program_package_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  package_uid           TEXT NOT NULL REFERENCES program_packages(uid),
  program_key           TEXT NOT NULL CHECK (length(program_key) BETWEEN 1 AND 60 AND program_key NOT GLOB '*[^a-z0-9-]*'),
  included_by_default   INTEGER NOT NULL DEFAULT 1 CHECK (included_by_default IN (0, 1)),
  position              INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
  -- Package-specific metadata (e.g. a capacity cap this package grants a program at), never a second source
  -- of truth for a program's own fields in `programs` (migration 560).
  metadata_json         TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  UNIQUE (package_uid, program_key)
);
CREATE INDEX IF NOT EXISTS idx_program_package_items_package ON program_package_items (package_uid, position);

-- Composition is written only while the package version is a draft. The moment it is published (active) or
-- later retired, every insert, update and delete here is refused — the same freeze `program_packages` itself
-- enforces, read through the row it belongs to, so a version's composition can never drift from what a
-- licence that accepted it (#5024) would have been shown.
CREATE TRIGGER IF NOT EXISTS trg_program_package_items_insert_locked
BEFORE INSERT ON program_package_items
WHEN COALESCE((SELECT status FROM program_packages WHERE uid = NEW.package_uid), 'draft') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'program_package_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_program_package_items_update_locked
BEFORE UPDATE ON program_package_items
WHEN COALESCE((SELECT status FROM program_packages WHERE uid = OLD.package_uid), 'draft') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'program_package_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_program_package_items_delete_locked
BEFORE DELETE ON program_package_items
WHEN COALESCE((SELECT status FROM program_packages WHERE uid = OLD.package_uid), 'draft') <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'program_package_immutable');
END;

-- ---------------------------------------------------------------------------------------------------------
-- Seed v1: the four packages the issue names, each published (status 'active') from the day this migration
-- runs. Written the way a publish really happens — inserted as a DRAFT, its items composed, then activated
-- by the same UPDATE the write bar's publish route would run — so the triggers above are exercised by this
-- seed, not bypassed by it: an insert straight into an 'active' row would have its items blocked by the
-- items-lock trigger, since a package row would already exist and already read as not-draft.
--
-- `effective_from` is today's date; `created_by` is NULL — this is the catalogue's own seed, not an admin's
-- write, so there is no actor to name. Base fees and guidance ranges are #5021's own figures, in minor units
-- (EUR cents). The Full Axal VC program list is PINNED to the ten keys `PROGRAM_KEYS`
-- (`services/programRegistry.ts`) names as of this migration — spin-out-lab through influencer — the same
-- ten `services/agreementTemplates.ts` (D5049) already licenses one by one. It is written here as a literal
-- list, not a query over `programs`, exactly as the issue requires: a program added to the registry after
-- this migration runs reaches no existing package version, Full Axal VC included.
-- ---------------------------------------------------------------------------------------------------------

INSERT INTO program_packages
  (uid, package_key, version, name, description, status, currency, base_annual_fee_cents,
   guidance_min_cents, guidance_max_cents, effective_from, created_at, created_by)
VALUES
  ('pkg_core_network_v1', 'core_network', 1, 'Core Network',
   'Referral Partners, Refer & Earn, Perks and Influencers.',
   'draft', 'EUR', 1000000, 800000, 1200000, date('now'), datetime('now'), NULL),
  ('pkg_talent_learning_v1', 'talent_learning', 1, 'Talent & Learning',
   'Learning, Mentor cohort access and Investor cohort access.',
   'draft', 'EUR', 1500000, 1200000, 1800000, date('now'), datetime('now'), NULL),
  ('pkg_venture_building_v1', 'venture_building', 1, 'Venture Building',
   'Spin-Out Lab, AI-native Venture and Product Testing.',
   'draft', 'EUR', 3750000, 3000000, 4500000, date('now'), datetime('now'), NULL),
  ('pkg_full_axal_vc_v1', 'full_axal_vc', 1, 'Full Axal VC operating system',
   'Every program Axal VC currently grants, pinned as of this package version.',
   'draft', 'EUR', 5250000, 4500000, 6000000, date('now'), datetime('now'), NULL);

INSERT INTO program_package_items (package_uid, program_key, included_by_default, position) VALUES
  -- Core Network
  ('pkg_core_network_v1', 'referral-partners', 1, 1),
  ('pkg_core_network_v1', 'refer-and-earn',     1, 2),
  ('pkg_core_network_v1', 'perks',              1, 3),
  ('pkg_core_network_v1', 'influencer',         1, 4),
  -- Talent & Learning
  ('pkg_talent_learning_v1', 'learning',         1, 1),
  ('pkg_talent_learning_v1', 'mentor-cohorts',   1, 2),
  ('pkg_talent_learning_v1', 'investor-cohorts', 1, 3),
  -- Venture Building
  ('pkg_venture_building_v1', 'spinout-lab',       1, 1),
  ('pkg_venture_building_v1', 'ai-native-venture', 1, 2),
  ('pkg_venture_building_v1', 'product-testing',   1, 3),
  -- Full Axal VC operating system — PROGRAM_KEYS (services/programRegistry.ts), pinned, in registry order.
  ('pkg_full_axal_vc_v1', 'spinout-lab',       1, 1),
  ('pkg_full_axal_vc_v1', 'ai-native-venture', 1, 2),
  ('pkg_full_axal_vc_v1', 'mentor-cohorts',    1, 3),
  ('pkg_full_axal_vc_v1', 'investor-cohorts',  1, 4),
  ('pkg_full_axal_vc_v1', 'referral-partners', 1, 5),
  ('pkg_full_axal_vc_v1', 'refer-and-earn',    1, 6),
  ('pkg_full_axal_vc_v1', 'perks',             1, 7),
  ('pkg_full_axal_vc_v1', 'learning',          1, 8),
  ('pkg_full_axal_vc_v1', 'product-testing',   1, 9),
  ('pkg_full_axal_vc_v1', 'influencer',        1, 10);

-- Publish v1 of all four: the same draft -> active transition the write bar's publish route performs,
-- exercised here rather than bypassed.
UPDATE program_packages SET status = 'active'
 WHERE uid IN ('pkg_core_network_v1', 'pkg_talent_learning_v1', 'pkg_venture_building_v1', 'pkg_full_axal_vc_v1');
