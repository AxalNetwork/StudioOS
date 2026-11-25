-- D6704 (#6704): immutable comparison evidence; no catalogue facts or activation.
CREATE TABLE IF NOT EXISTS formation_case_suggestions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uid TEXT NOT NULL UNIQUE,
 case_id INTEGER NOT NULL REFERENCES formation_cases(id),
 answers_uid TEXT NOT NULL REFERENCES formation_case_answers(uid),
 catalogue_version_id INTEGER NOT NULL REFERENCES formation_catalogue_versions(id),
 output_json TEXT NOT NULL CHECK(json_valid(output_json)),
 notice_key TEXT NOT NULL,
 notice_version TEXT NOT NULL,
 notice_hash TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS formation_case_suggestions_case ON formation_case_suggestions(case_id,id);
CREATE TABLE IF NOT EXISTS formation_case_memos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uid TEXT NOT NULL UNIQUE,
 case_id INTEGER NOT NULL REFERENCES formation_cases(id),
 answers_uid TEXT NOT NULL REFERENCES formation_case_answers(uid),
 document TEXT NOT NULL CHECK(length(trim(document)) BETWEEN 1 AND 20000),
 author_name TEXT NOT NULL CHECK(length(trim(author_name)) BETWEEN 1 AND 200),
 firm TEXT NOT NULL CHECK(length(trim(firm)) BETWEEN 1 AND 200),
 licensing_body TEXT NOT NULL CHECK(length(trim(licensing_body)) BETWEEN 1 AND 200),
 country TEXT NOT NULL CHECK(length(country)=2),
 memo_date TEXT NOT NULL,
 partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
 acknowledged_by INTEGER NOT NULL REFERENCES users(id),
 partner_acknowledgement TEXT NOT NULL CHECK(length(trim(partner_acknowledgement)) BETWEEN 1 AND 2000),
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS formation_case_choices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uid TEXT NOT NULL UNIQUE,
 case_id INTEGER NOT NULL REFERENCES formation_cases(id),
 suggestion_uid TEXT NOT NULL REFERENCES formation_case_suggestions(uid),
 form_key TEXT NOT NULL,
 was_among_options INTEGER NOT NULL CHECK(was_among_options IN(0,1)),
 own_reason TEXT NOT NULL CHECK(length(trim(own_reason)) BETWEEN 1 AND 4000),
 confirmation TEXT NOT NULL CHECK(confirmation IN('self','structure_memo','waiver')),
 memo_uid TEXT REFERENCES formation_case_memos(uid),
 notice_hash TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(confirmation <> 'structure_memo' OR memo_uid IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS formation_case_choices_case ON formation_case_choices(case_id,id);
CREATE TRIGGER IF NOT EXISTS formation_case_suggestions_no_update BEFORE UPDATE ON formation_case_suggestions
BEGIN SELECT RAISE(ABORT, 'formation_case_suggestions: immutable evidence (D6704)'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_suggestions_no_delete BEFORE DELETE ON formation_case_suggestions
BEGIN SELECT RAISE(ABORT, 'formation_case_suggestions: immutable evidence (D6704)'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_memos_no_update BEFORE UPDATE ON formation_case_memos
BEGIN SELECT RAISE(ABORT, 'formation_case_memos: immutable evidence (D6704)'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_memos_no_delete BEFORE DELETE ON formation_case_memos
BEGIN SELECT RAISE(ABORT, 'formation_case_memos: immutable evidence (D6704)'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_choices_no_update BEFORE UPDATE ON formation_case_choices
BEGIN SELECT RAISE(ABORT, 'formation_case_choices: immutable evidence (D6704)'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_choices_no_delete BEFORE DELETE ON formation_case_choices
BEGIN SELECT RAISE(ABORT, 'formation_case_choices: immutable evidence (D6704)'); END;
-- Explicit opt-in, unlike the generic flags service's default-on behavior.
INSERT OR IGNORE INTO feature_flags(key,scope,scope_id,enabled) VALUES('formation_options','global','',0);
