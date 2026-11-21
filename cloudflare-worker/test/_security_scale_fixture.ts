/**
 * #4708 part 2 (D4708-p2) — a representative LARGE HQ Security ledger: about two years of the five stores
 * `/api/admin/security/governance` unions, over the real migrated schema in node:sqlite. It is what the
 * evidence reads' query plans are pinned on (`security_evidence_scale_4708.test.ts`) and what
 * `scripts/perf/security-bench.mjs` times.
 *
 * The sizes are chosen so that a full-history scan and sort shows in a query plan and in the time, not so
 * that they match production. Every row is synthetic and made from a fixed seed, so two builds are the same
 * rows. No person is real.
 *
 *   admin_audit_log         30,000 (a third of them exports; a fifth stamped ISO 8601, D124)
 *   activity_logs          100,000 (about one in twelve an admin-side action the feed reads)
 *   security_events         40,000
 *   licence_events           6,000 over 60 licences
 *   impersonation_sessions   4,000 (a few still open)
 *   users                    2,000
 */
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import { ACTOR_SIDE_ACTIONS } from '../src/services/adminSecurity/governanceFeed.ts';

/** The fixture's own clock: Tuesday 10 November 2026, noon UTC. */
export const SECURITY_SCALE_NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const SPAN_DAYS = 2 * 365;

export const SECURITY_SCALE = Object.freeze({
  users: 2000, audit: 30000, activity: 100000, security: 40000, licences: 60, licenceEvents: 6000, impersonations: 4000,
});

/** The indexes migration `202611151527_4708_security_evidence_indexes.sql` adds, by name. */
export const EVIDENCE_INDEXES = Object.freeze([
  'idx_admin_audit_feed_at', 'idx_admin_audit_exported', 'idx_licence_events_feed_at',
  'idx_security_events_feed_at', 'idx_impersonation_feed_at', 'idx_impersonation_started',
]);

/** A small deterministic generator (mulberry32), so the fixture is the same rows on every build. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SQLite's own `YYYY-MM-DD HH:MM:SS`, the format `datetime('now')` writes. */
export const sqlAt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** ISO 8601 with a T and a Z, which some writers store (D124). */
export const isoAt = (ms: number) => new Date(ms).toISOString();

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const AUDIT_ACTIONS = ['analytics_export', 'members_export', 'user_view', 'force_reauth', 'integration_key_rotated', 'job_approved'] as const;
const OTHER_ACTIVITY = ['page_view', 'login', 'your_role_changed', 'kyc_approved', 'profile_updated', 'deal_viewed'] as const;
const LICENCE_EVENTS = ['created', 'territory_changed', 'seats_changed', 'terms_changed', 'activated', 'suspended', 'reinstated', 'renewed', 'terminated'] as const;
const SEC_KINDS = [['signin', 'password'], ['signin', 'totp'], ['step_up', 'totp'], ['gate', 'totp'], ['recovery', 'email']] as const;

/** The database, filled. `close()` when done. */
export async function securityScale(seed = 4708) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  await loadSchema(db);
  const r = rng(seed);
  const back = () => SECURITY_SCALE_NOW - Math.floor(r() * SPAN_DAYS * DAY);

  db.exec('BEGIN');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (let i = 1; i <= SECURITY_SCALE.users; i++) {
    u.run(i, i <= 40 ? 'admin' : 'founder', `Synthetic ${i}`, `synthetic${i}@example.invalid`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  const admin = () => 1 + Math.floor(r() * 40);
  const anyone = () => 1 + Math.floor(r() * SECURITY_SCALE.users);

  const audit = db.prepare(
    `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, viewed_user_id, exported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 1; i <= SECURITY_SCALE.audit; i++) {
    const ms = back();
    const action = i % 3 === 0 ? pick(r, AUDIT_ACTIONS.slice(0, 2)) : pick(r, AUDIT_ACTIONS);
    audit.run(admin(), action, action.includes('export') ? 'users' : null, action.includes('export') ? 'csv' : null,
      '{}', r() < 0.3 ? anyone() : null, r() < 0.2 ? isoAt(ms) : sqlAt(ms));
  }

  const activity = db.prepare('INSERT INTO activity_logs (action, details, actor, user_id, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= SECURITY_SCALE.activity; i++) {
    const adminSide = r() < 1 / 12;
    activity.run(adminSide ? pick(r, ACTOR_SIDE_ACTIONS) : pick(r, OTHER_ACTIVITY), `Synthetic detail ${i}`, 'hash',
      adminSide ? admin() : anyone(), sqlAt(back()));
  }

  const sec = db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, detail, user_id, subject_key, ip_prefix, branch_code, minute, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'hq', ?, ?)`,
  );
  for (let i = 1; i <= SECURITY_SCALE.security; i++) {
    const [kind, factor] = pick(r, SEC_KINDS);
    const at = sqlAt(back());
    sec.run(kind, factor, r() < 0.4 ? 'refused' : 'ok', r() < 0.4 ? 'invalid_code' : null, r() < 0.7 ? anyone() : null,
      `subject-${i}`, `198.51.100.${i % 250}/32`, at.slice(0, 16), at);
  }

  const lic = db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, ?, ?, ?, ?, 'active')`,
  );
  for (let i = 1; i <= SECURITY_SCALE.licences; i++) lic.run(i, `uid-${i}`, `AXL-${String(i).padStart(3, '0')}`, `Synthetic ${i} SAS`, `Synthetic Brand ${i}`);
  const le = db.prepare('INSERT INTO licence_events (licence_id, event, note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= SECURITY_SCALE.licenceEvents; i++) {
    le.run(1 + Math.floor(r() * SECURITY_SCALE.licences), pick(r, LICENCE_EVENTS), r() < 0.5 ? `Synthetic note ${i}` : null, admin(), sqlAt(back()));
  }

  const imp = db.prepare(
    'INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 1; i <= SECURITY_SCALE.impersonations; i++) {
    const ms = back();
    imp.run(admin(), anyone(), `Synthetic ticket ${i}`, sqlAt(ms), i % 400 === 0 ? null : sqlAt(ms + 20 * 60_000));
  }
  db.exec('COMMIT');
  return db;
}
