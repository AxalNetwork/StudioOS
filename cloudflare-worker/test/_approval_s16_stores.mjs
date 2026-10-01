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
export const S16_STORES_SQL = `
  CREATE TABLE partner_profiles (
    email TEXT PRIMARY KEY, user_id INTEGER, persona TEXT, legal_entity_name TEXT,
    admin_status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE user_role_review (
    user_id INTEGER PRIMARY KEY, suggested_role TEXT, onboarded_at TEXT);
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

const USER_COLUMNS = [
  ['role', 'TEXT'],
  ['kyc_status', "TEXT DEFAULT 'not_started'"],
  ['kyc_submitted_at', 'TIMESTAMP'],
  ['created_at', 'TEXT'],
];

/** Create the seven stores on a `node:sqlite` DatabaseSync that already has `users`. */
export function addS16Stores(d) {
  d.exec(S16_STORES_SQL);
  const have = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  for (const [name, type] of USER_COLUMNS) {
    if (!have.has(name)) d.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
}
