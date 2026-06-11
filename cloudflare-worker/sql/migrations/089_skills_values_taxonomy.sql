-- Task #10 — Skills & Values Taxonomy (canonical reference data).
--
-- Introduces the normalized, queryable taxonomy that every downstream
-- feature reads from (skill profiles, radar/spider graph, co-founder /
-- partner / investor matching, deck spider autofill). Today "skills" only
-- exist as free text — the 12-axis SKILL_CATALOG constant in
-- services/networkProfilesSchema.ts (mirrored in AdminNetworkProfiles.jsx),
-- the network_profiles.skills_json blob, and the SUGGESTED_SKILLS list in
-- routes/cofounder.ts. This migration makes the tables the single source of
-- truth. Seed content lives in 090_seed_skills_values_taxonomy.sql.
--
-- Additive only, every statement is `IF NOT EXISTS`, so re-applying is a
-- clean no-op. The worker carries a lazy bootstrap mirror in
-- services/skillsTaxonomySchema.ts (CREATE TABLE IF NOT EXISTS on the cold
-- path + the canonical RADAR_AXES / SENIORITY_LEVELS constants) so routes
-- self-heal on a D1 that has not yet had this migration applied — same
-- pattern as ensureNetworkProfilesSchema / ensureTeamMembersSchema.
--
-- Apply (verified shape — D1 "studioos-db" is bound as DB in the repo-root
-- wrangler.toml; target it by name with --remote):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/089_skills_values_taxonomy.sql
-- then apply 090 the same way to load the seed.
--
-- ============================================================================
-- CANONICAL 8-AXIS RADAR SET (skill_categories.is_radar_axis = 1)
-- ----------------------------------------------------------------------------
--   slug               label              weight   legacy 12-axis it absorbs
--   product            Product             1.0     Product
--   engineering        Engineering         1.0     Engineering, Technical DD
--   design             Design              1.0     Design
--   gtm_sales          GTM / Sales         1.0     GTM, Sales
--   marketing_brand    Marketing / Brand   1.0     Marketing
--   finance_ops        Finance / Ops       1.0     Finance, Operations
--   legal_compliance   Legal / Compliance  1.0     Legal
--   capital_network    Capital / Network   1.0     Fundraising, Recruiting
-- ----------------------------------------------------------------------------
-- The 8 axes are chosen to cleanly absorb the legacy 12-axis list so the
-- old free-text catalog can be reconciled onto them in a later task
-- (out of scope here). Weights are equal (1.0) by default; a radar service
-- may override per consumer. Exactly these 8 rows carry is_radar_axis = 1.
--
-- CANONICAL SENIORITY LADDER (skills.seniority_levels_json default)
-- ----------------------------------------------------------------------------
--   index 0..4 == proficiency rank 1..5:
--     aware < working < proficient < advanced < expert
-- Per-user proficiency (which level a person holds for a skill) is stored by
-- downstream per-user tables — NOT here. A skill may override the ladder by
-- carrying a different JSON array (e.g. a binary skill), but every seeded
-- skill uses the default 5-rung ladder.
--
-- VALUE DIMENSIONS (value_dimensions.family)
-- ----------------------------------------------------------------------------
--   'schwartz' — 10 unipolar Schwartz basic human values (importance scale).
--   'founder'  — 5 bipolar founder-specific spectrums (pole_low <-> pole_high),
--                e.g. Mission-vs-Profit, Speed-vs-Quality, Risk-Appetite.
-- ============================================================================

-- Skill categories — the 8 radar axes (plus room for future non-radar
-- groupings). slug is the stable join key used by skills.category_slug and
-- by downstream radar code; never rename a slug.
CREATE TABLE IF NOT EXISTS skill_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT,
  is_radar_axis INTEGER NOT NULL DEFAULT 0,   -- 1 == one of the 8 canonical axes
  radar_weight  REAL    NOT NULL DEFAULT 1.0,  -- default contribution to the radar
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skill_categories_radar
  ON skill_categories (is_radar_axis, display_order);

-- Skills — category-linked catalog. category_slug references
-- skill_categories.slug (soft link, no hard FK, matching house style —
-- enforced by the seed order + the radar code, not by PRAGMA foreign_keys).
-- seniority_levels_json documents the proficiency ladder a skill supports.
CREATE TABLE IF NOT EXISTS skills (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT NOT NULL UNIQUE,
  category_slug        TEXT NOT NULL,
  label                TEXT NOT NULL,
  description          TEXT,
  seniority_levels_json TEXT NOT NULL DEFAULT '["aware","working","proficient","advanced","expert"]',
  display_order        INTEGER NOT NULL DEFAULT 0,
  is_active            INTEGER NOT NULL DEFAULT 1,   -- 0 = retired from the catalog
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_category
  ON skills (category_slug, display_order);
CREATE INDEX IF NOT EXISTS idx_skills_active
  ON skills (is_active);

-- Value dimensions — Schwartz basic values (unipolar) + founder-specific
-- spectrums (bipolar). For bipolar rows pole_low/pole_high name the two ends
-- of the spectrum; for unipolar Schwartz rows they are NULL.
CREATE TABLE IF NOT EXISTS value_dimensions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT,
  family        TEXT NOT NULL DEFAULT 'schwartz',  -- 'schwartz' | 'founder'
  is_bipolar    INTEGER NOT NULL DEFAULT 0,         -- 1 == pole_low <-> pole_high spectrum
  pole_low      TEXT,                               -- low end label (bipolar only)
  pole_high     TEXT,                               -- high end label (bipolar only)
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_value_dimensions_family
  ON value_dimensions (family, display_order);
