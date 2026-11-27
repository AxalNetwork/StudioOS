-- 620 — Due diligence part 2 (D1246, #3261, part 2 of #2385): a case can be
-- led, given its deal context, decided, archived and handed to IC, a section
-- can be blocking, and the deal team keeps an encrypted memo. Assigned to
-- #3261 by S21 (D1244 §6).
--
-- dd_cases:
--   lead_user_id       who runs the case (#2385: "Case lead: who opened the
--                      case and runs it"). Backfilled to owner_user_id, which
--                      is that fact for every case opened before this file:
--                      the opener has run it, and the opener is the owner.
--   target_ic_date     YYYY-MM-DD, the date the deal team aims to reach IC.
--   round_label        the round, in the deal team's words ("Series A").
--   cheque_cents       our cheque, money as *_cents INTEGER, with
--   cheque_currency    its ISO 4217 code.
--   deal_id            the linked Deal Flow deal (`deals.id`).
--   decision           proceed | proceed_with_conditions | do_not_proceed |
--                      withdrawn. Recording one sets status 'completed', which
--                      the CHECK has allowed since 008 and nothing wrote.
--   decision_reason_enc  the reason, required, column-cipher ciphertext like
--                      every other free text on a case (`notes_enc`).
--   decided_by, decided_at
--   archived_reason_enc, archived_by, archived_at — archive with a reason.
-- dd_sections.blocking — 1 when an open High or Critical flag in the section
--   refuses "Proceed" (#2385 owner question 4). It is the template's rule, not
--   a recorded fact: the canvas's template board (DDL13) marks Corporate &
--   Legal, Financial Health and Compliance / AML blocking, and existing
--   sections take the same rule a case opened today takes.
-- dd_case_memos — the deal team's memo (DDL10): summary, what we verified,
--   what we take on trust, conditions to close. One row per case, each field
--   column-cipher ciphertext keyed to the memo row.
--
-- NO OTHER BACKFILL. A case decided before this file has no decision, and
-- reads "Not recorded".
--
-- Grep first (D689 D-t): none of these columns exists on dd_cases or
-- dd_sections in an earlier migration or in schema_baseline.sql, and no
-- dd_case_memos table exists.

ALTER TABLE dd_cases ADD COLUMN lead_user_id INTEGER REFERENCES users(id);
ALTER TABLE dd_cases ADD COLUMN target_ic_date TEXT;
ALTER TABLE dd_cases ADD COLUMN round_label TEXT;
ALTER TABLE dd_cases ADD COLUMN cheque_cents INTEGER CHECK (cheque_cents IS NULL OR cheque_cents >= 0);
ALTER TABLE dd_cases ADD COLUMN cheque_currency TEXT;
ALTER TABLE dd_cases ADD COLUMN deal_id INTEGER REFERENCES deals(id);
ALTER TABLE dd_cases ADD COLUMN decision TEXT
  CHECK (decision IS NULL OR decision IN ('proceed', 'proceed_with_conditions', 'do_not_proceed', 'withdrawn'));
ALTER TABLE dd_cases ADD COLUMN decision_reason_enc TEXT;
ALTER TABLE dd_cases ADD COLUMN decided_by INTEGER REFERENCES users(id);
ALTER TABLE dd_cases ADD COLUMN decided_at TEXT;
ALTER TABLE dd_cases ADD COLUMN archived_reason_enc TEXT;
ALTER TABLE dd_cases ADD COLUMN archived_by INTEGER REFERENCES users(id);
ALTER TABLE dd_cases ADD COLUMN archived_at TEXT;

UPDATE dd_cases SET lead_user_id = owner_user_id WHERE lead_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_dd_cases_lead ON dd_cases(lead_user_id, status);

ALTER TABLE dd_sections ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1));
UPDATE dd_sections SET blocking = 1 WHERE section_key IN ('corporate_legal', 'financial_health', 'compliance_aml');

CREATE TABLE IF NOT EXISTS dd_case_memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL UNIQUE REFERENCES dd_cases(id) ON DELETE CASCADE,
  summary_enc TEXT,
  verified_enc TEXT,
  on_trust_enc TEXT,
  conditions_enc TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
