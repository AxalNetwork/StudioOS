-- 268 — HQ's master template library, as a branch's dated copy (D147).
--
-- WHY A `branch_*` TABLE AND NOT COLUMNS ON `legal_templates`. A branch already
-- HAS `legal_templates` and `legal_template_versions`: both are in
-- `schema_baseline.sql`, so a bootstrapped branch gets them empty, and
-- `services/legalTemplateStore.ts` carries a lazy `CREATE TABLE IF NOT EXISTS`
-- on top of that. Adding `source` and `pushed_at` there would have meant
-- editing a migration AND a runtime bootstrap in lockstep, which is the
-- `metrics_snapshots` collision (#183, #202) — one table with two definitions
-- that disagree depending on which ran first. It would also have put HQ's copy
-- in the table a branch is refused write access to (D106
-- `requireHqAuthoring`), so the refusal would be the only thing separating the
-- two. Migration 256 already set the rule this follows: a pushed copy lives in
-- its own `branch_*` table with its own `pushed_at` — `branch_licence`,
-- `branch_promo_ceiling`, `branch_benchmarks`, and now this.
--
-- ONE ROW PER SLUG, NOT A VERSION HISTORY. S10 draws "archived versions visible
-- and unusable", and on a branch that resolves to `is_active = 0` — because
-- HQ's own code says the current version is the only one it will ever offer:
-- `admin_licences.ts`, on the contract-instantiate route, "THE VERSION IS READ,
-- NOT PASSED … the current version is the only one HQ is offering today."
-- Pushing every historical row so a picker could grey them out would model a
-- choice HQ refuses to make.
--
-- THERE IS DELIBERATELY NO `is_active` EITHER, and the reason is the same rule
-- read the other way. S10 draws archived versions as "visible and unusable",
-- and HQ cannot produce that state: `listTemplates` filters `is_active = 1`, so
-- HQ's OWN library shows only active templates, and the contract route offers
-- only the current version. A column here could therefore only ever hold 1, and
-- the page branch that rendered a 0 would be code production never reaches. The
-- true statement — that older versions exist at HQ in `legal_template_versions`
-- and are not offerable — is carried by `version`, and the page says the rest.
--
-- THERE IS DELIBERATELY NO `body_md`. Nothing on a branch renders or
-- instantiates a template body: S5's picker shows the library, and
-- `licence_contracts` (migration 259) is HQ's table. A body column with no
-- reader is the store-built-so-a-page-looks-complete mistake this programme has
-- now deleted four times (D129's seat store, D131's six blocks, D140's
-- adjustable dates, D141's invented bindings). When instantiation lands on a
-- branch it is one additive ALTER.

CREATE TABLE IF NOT EXISTS branch_templates (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  -- HQ's own vocabulary, copied verbatim: gp | fund | portfolio | compliance
  -- (migration 084). No CHECK here on purpose — a branch must not refuse a
  -- category HQ adds later, because the copy's job is to say what HQ said.
  category   TEXT,
  -- The version HQ is offering. Travels onto a contract row that instantiates
  -- it, which is what makes an archived version stay binding on the contracts
  -- already carrying it.
  version    INTEGER NOT NULL DEFAULT 1,
  pushed_at  TEXT NOT NULL,
  -- NO DEFAULT. `pushed_at` above is HQ's stamp and this one is the branch's
  -- write time; only `applyTemplateCopy` ever writes either, and it always
  -- binds both. A `DEFAULT (datetime('now'))` would put SQL-format stamps
  -- (`2026-09-17 15:00:00`) in the same column as the ISO strings the writer
  -- binds, and the two compare as strings with a space sorting BELOW a `T` —
  -- the bound-parameter timestamp class this repo has been bitten by four
  -- times. One writer, one format, and nothing to get wrong.
  updated_at TEXT NOT NULL
);


-- The push's own stamp, one row, on `branch_promo_ceiling`'s shape.
--
-- IT EXISTS SO "HQ PUSHED AN EMPTY LIBRARY" AND "HQ HAS NEVER PUSHED" ARE
-- DIFFERENT SENTENCES. `branch_templates` alone cannot tell them apart — both
-- read as zero rows — and only one of them is a statement about HQ. The page
-- renders them differently, and D106's `licence_not_pushed` is the precedent:
-- an empty copy and an absent copy are two claims, not one.
CREATE TABLE IF NOT EXISTS branch_templates_sync (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  pushed_at  TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  -- No default, for the reason above: one writer, one format.
  updated_at TEXT NOT NULL
);
