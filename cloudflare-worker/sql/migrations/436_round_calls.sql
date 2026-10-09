-- D653 / #1465. Additive stores; ROUND_CALLS_ENABLED remains off.
CREATE TABLE round_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  company_id INTEGER,
  round_id INTEGER REFERENCES raise_rounds(id),
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  instrument TEXT NOT NULL CHECK (instrument IN ('safe','equity','convertible_note')),
  terms TEXT NOT NULL,
  minimum_cheque_cents INTEGER NOT NULL CHECK (minimum_cheque_cents > 0 AND minimum_cheque_cents <= amount_cents),
  target_close TEXT NOT NULL,
  deck_id INTEGER REFERENCES pitch_decks(id),
  deck_version INTEGER,
  data_room_project_uid TEXT,
  stage TEXT,
  sector TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sent','closed')),
  terms_hash TEXT NOT NULL,
  counsel_approved_hash TEXT,
  counsel_approval_reference TEXT,
  counsel_approved_by INTEGER REFERENCES users(id),
  counsel_approved_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  closed_at TEXT
);
CREATE INDEX idx_round_calls_project ON round_calls(project_id, state, created_at);

CREATE TABLE round_call_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES round_calls(id),
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  origin TEXT NOT NULL CHECK (origin IN ('chosen','match')),
  match_reasons_json TEXT NOT NULL DEFAULT '[]',
  opened_at TEXT,
  data_room_requested_at TEXT,
  commitment_cents INTEGER CHECK (commitment_cents IS NULL OR commitment_cents > 0),
  responded_at TEXT,
  last_response_at TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','notified','not_delivered')),
  notified_at TEXT,
  UNIQUE(call_id, investor_user_id)
);
CREATE INDEX idx_round_call_recipients_investor ON round_call_recipients(investor_user_id, call_id);

CREATE TABLE round_call_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  call_id INTEGER NOT NULL REFERENCES round_calls(id),
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  question TEXT NOT NULL,
  answer TEXT,
  asked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,
  answered_by INTEGER REFERENCES users(id)
);
CREATE INDEX idx_round_call_questions_call ON round_call_questions(call_id, asked_at);
