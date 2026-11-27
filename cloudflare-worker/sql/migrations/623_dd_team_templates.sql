-- 623 — Due diligence part 5 (D1249, #3264, part 5 of #2385): the team's
-- conflicts and invitation expiry, and HQ's versioned templates. Assigned to
-- #3264 by S21 (D1244 §6).
--
-- dd_reviewers:
--   conflicts            NULL until the reviewer answers (DDL9's "not
--                        answered"), then 'none' or 'declared'.
--   conflicts_note_enc   what they declared, column-cipher ciphertext.
--   conflicts_at         when they answered.
--   expires_at           when the invitation link stops working: 14 days from
--                        the invitation or its resend. NULL on rows invited
--                        before this file, whose links were sent without one
--                        and stay as they were sent.
--   The `role` CHECK has allowed 'observer' since 008; part 5 is its first
--   writer. An observer reads the section and never works it.
-- dd_cases.template_id — the template version the case was opened with. NULL
--   is the built-in catalog in services/dueDiligence.ts, which is what every
--   case opened before this file used.
-- dd_templates — HQ's templates (#2385 owner question 3: HQ owns them; a
--   studio picks one). One row per depth and version; a new version applies
--   to new cases only. `body_json` holds each section's weight, blocking and
--   items, keyed to the catalog.
--
-- NO BACKFILL: no existing reviewer is marked as having answered, and no
-- existing case is given a template it was not opened with.
--
-- Grep first (D689 D-t): none of these columns exists on dd_reviewers or
-- dd_cases in an earlier migration or in schema_baseline.sql, and no
-- dd_templates table exists.

ALTER TABLE dd_reviewers ADD COLUMN conflicts TEXT CHECK (conflicts IS NULL OR conflicts IN ('none', 'declared'));
ALTER TABLE dd_reviewers ADD COLUMN conflicts_note_enc TEXT;
ALTER TABLE dd_reviewers ADD COLUMN conflicts_at TEXT;
ALTER TABLE dd_reviewers ADD COLUMN expires_at TEXT;

CREATE TABLE IF NOT EXISTS dd_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  depth TEXT NOT NULL CHECK (depth IN ('lite', 'standard', 'deep')),
  version INTEGER NOT NULL CHECK (version >= 1),
  body_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (depth, version)
);

ALTER TABLE dd_cases ADD COLUMN template_id INTEGER REFERENCES dd_templates(id);
