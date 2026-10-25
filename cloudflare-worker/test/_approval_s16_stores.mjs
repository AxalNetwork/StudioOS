/**
 * The seven approval stores S16 (D215) added to `APPROVAL_SOURCES`, for
 * fixtures that seed the approval queues.
 *
 * ONE HELPER RATHER THAN SEVEN TABLES PASTED INTO FOUR FIXTURES. Every fixture
 * that reads the backlog must hold every store `laneCounts` reads, or the
 * backlog is (correctly) unreadable. A copy per fixture is a copy that goes
 * stale the next time a lane is added.
 *
 * Column sets are trimmed to what the read model touches, in the baseline's
 * shapes. `users` is widened in place, because each fixture declares its own:
 * KYC and Exploring read `users.role`, `kyc_status`, `kyc_submitted_at` and
 * `created_at`, and only the missing ones are added.
 */
import { readFileSync } from 'node:fs';

export const S16_STORES_SQL = `
  CREATE TABLE partner_profiles (
    email TEXT PRIMARY KEY, user_id INTEGER, persona TEXT, legal_entity_name TEXT,
    admin_status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  -- D990: lane 7 leaves Drafts out, and a Draft is read off every answer
  -- column and the chat, so this table carries them (the baseline's and 275's).
  ALTER TABLE partner_profiles ADD COLUMN entity_type TEXT;
  ALTER TABLE partner_profiles ADD COLUMN ein TEXT;
  ALTER TABLE partner_profiles ADD COLUMN signatory_name TEXT;
  ALTER TABLE partner_profiles ADD COLUMN signatory_title TEXT;
  ALTER TABLE partner_profiles ADD COLUMN company_established INTEGER;
  ALTER TABLE partner_profiles ADD COLUMN chat_history TEXT;
  ALTER TABLE partner_profiles ADD COLUMN extracted_data TEXT;
  ALTER TABLE partner_profiles ADD COLUMN founder_track TEXT;
  ALTER TABLE partner_profiles ADD COLUMN current_stage TEXT;
  ALTER TABLE partner_profiles ADD COLUMN partnership_goal TEXT;
  ALTER TABLE partner_profiles ADD COLUMN existing_jurisdiction TEXT;
  ALTER TABLE partner_profiles ADD COLUMN product_strategy TEXT;
  ALTER TABLE partner_profiles ADD COLUMN existing_investors TEXT;
  CREATE TABLE user_role_review (
    user_id INTEGER PRIMARY KEY, suggested_role TEXT, onboarded_at TEXT, binding_envelope_id INTEGER);
  -- D1039: the Exploring lane counts an Explorer whose binding agreement is signed.
  CREATE TABLE esign_envelopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT NOT NULL DEFAULT 'sent', completed_at TEXT);
  CREATE TABLE job_postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, host_user_id INTEGER, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, host_user_id INTEGER, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE admin_consultation_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, topic TEXT,
    status TEXT NOT NULL DEFAULT 'requested', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE dd_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, subject_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', owner_user_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
`;

/**
 * D1041 (#2889): the eight stores the canvas's new lanes read, trimmed the same
 * way. IF NOT EXISTS, because some fixtures already hold `projects` or
 * `partners` in their own shape.
 */
export const D1041_STORES_SQL = `
  CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT);
  CREATE TABLE IF NOT EXISTS company_kyb_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, status TEXT NOT NULL DEFAULT 'not_started',
    entity_name TEXT, submitted_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE IF NOT EXISTS comarketing_pitches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER, submitter_user_id INTEGER, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed', published_at TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS experts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, user_id INTEGER, name TEXT, headline TEXT,
    verified INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
    profile_completion_pct INTEGER, hidden_by_admin INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS perks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, partner_user_id INTEGER, partner_name TEXT, offer TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
  CREATE TABLE IF NOT EXISTS referral_strategic_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'requested',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS lab_host_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, host_kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  CREATE TABLE IF NOT EXISTS score_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, tier TEXT,
    admin_review_status TEXT NOT NULL DEFAULT 'auto_approved', is_sandbox INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft', submitted_at TEXT, created_at TEXT DEFAULT (datetime('now')));
`;

const USER_COLUMNS = [
  ['role', 'TEXT'],
  ['kyc_status', "TEXT DEFAULT 'not_started'"],
  ['kyc_submitted_at', 'TIMESTAMP'],
  ['created_at', 'TEXT'],
];

/**
 * D1039: give an Explorer a signed binding agreement, so the Exploring lane
 * counts them (a holding-role account with none is not ready for a role).
 */
export function signBinding(d, userId) {
  d.exec(`CREATE TABLE IF NOT EXISTS esign_envelopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT NOT NULL DEFAULT 'sent', completed_at TEXT)`);
  d.exec('CREATE TABLE IF NOT EXISTS user_role_review (user_id INTEGER PRIMARY KEY, suggested_role TEXT, onboarded_at TEXT, binding_envelope_id INTEGER)');
  if (!d.prepare('PRAGMA table_info(user_role_review)').all().some((c) => c.name === 'binding_envelope_id')) {
    d.exec('ALTER TABLE user_role_review ADD COLUMN binding_envelope_id INTEGER');
  }
  const env = d.prepare("INSERT INTO esign_envelopes (user_id, status, completed_at) VALUES (?, 'completed', '2026-01-01 00:00:00')").run(userId);
  const id = Number(env.lastInsertRowid);
  const has = d.prepare('SELECT 1 FROM user_role_review WHERE user_id = ?').get(userId);
  if (has) d.prepare('UPDATE user_role_review SET binding_envelope_id = ? WHERE user_id = ?').run(id, userId);
  else d.prepare('INSERT INTO user_role_review (user_id, binding_envelope_id) VALUES (?, ?)').run(userId, id);
}

/** Create the seven stores, and D1041's eight, on a `node:sqlite` DatabaseSync that already has `users`. */
export function addS16Stores(d) {
  d.exec(S16_STORES_SQL);
  d.exec(D1041_STORES_SQL);
  d.exec(readFileSync(new URL('../sql/migrations/275_partner_profiles_columns.sql', import.meta.url), 'utf8'));
  d.exec(readFileSync(new URL('../sql/migrations/546_events_review_columns.sql', import.meta.url), 'utf8'));
  const have = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const [name, type] of USER_COLUMNS) {
    if (!have.has(name)) d.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
}
