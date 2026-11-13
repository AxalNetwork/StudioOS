-- Build queue #128 — Due Diligence checklists + information requests.
--
-- Two additions to the DD engine (008_due_diligence.sql):
--
--   1. dd_checklist_items — a per-case working checklist seeded from
--      CHECKLIST_CATALOG (services/dueDiligence.ts) at case-open time,
--      scoped to the case's sections. Items carry a depth tag
--      (lite/standard/deep) chosen via dd_cases.template_depth, a
--      pass/flag/fail status, an optional severity (flag/fail only)
--      that feeds the composite risk score, an owner, a due date, and
--      an encrypted note (columnCipher, rowId as AAD — same discipline
--      as dd_findings.detail_enc).
--
--   2. dd_requests — information requests sent from the diligence team
--      to the subject's founder. INVARIANT: dd_requests carries NO
--      diligence content (no verdicts, findings, severities, or notes
--      from the case) — rows are founder-visible by design, so the
--      "founders NEVER read DD" rule (routes/dd.ts header) holds.
--      Diligence conclusions stay in dd_findings/dd_sections; requests
--      only say "please provide X".

ALTER TABLE dd_cases ADD COLUMN template_depth TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS dd_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES dd_sections(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,             -- CHECKLIST_CATALOG key, e.g. 'corporate_legal.cap_table_clean'
  title TEXT NOT NULL,
  depth TEXT NOT NULL DEFAULT 'lite', -- lite | standard | deep (catalog tier that seeded it)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | pass | flag | fail | n_a
  severity TEXT,                      -- info|low|medium|high|critical — only meaningful with status flag/fail
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,                      -- ISO date (YYYY-MM-DD); TEXT for D1 portability
  note_enc TEXT,                      -- columnCipher('dd_checklist_items','note', id)
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_dd_checklist_case_status ON dd_checklist_items(case_id, status);
CREATE INDEX IF NOT EXISTS idx_dd_checklist_owner_due ON dd_checklist_items(owner_user_id, due_date);

CREATE TABLE IF NOT EXISTS dd_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES dd_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,                -- founder-visible: what is being requested
  details TEXT,                       -- founder-visible: plain-text elaboration (NO diligence content)
  state TEXT NOT NULL DEFAULT 'requested', -- requested | received | reviewed
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responded_at TEXT,
  response_note TEXT,                 -- founder's own words (their data, not case data)
  response_url TEXT,                  -- founder-provided link to the document/data room
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dd_requests_case_state ON dd_requests(case_id, state);
