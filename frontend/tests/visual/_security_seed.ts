/**
 * D4803 (#4803, browser pass) — the HQ Security scenario the visual server
 * seeds next to the deck matrix, so `security.a11y.spec.mjs` reads exactly
 * what the real routes answer (`routes/admin_security.ts`, the MFA policy and
 * the Trust Center), with nothing stubbed by path.
 *
 * It is the live 2026-11-07 picture the canvas was drawn from, moved to the
 * suite's pinned clock: three HQ administrators and two have no second factor
 * (the viewer signs in with TOTP, so the write acts can be opened and checked);
 * the restore drill failed at the `restore` step six days ago while the
 * nightly export is fresh; three active sessions; one deletion request five
 * days from its due date and one closed; a few ledger rows from three of the
 * five stores; and a Trust Center block whose draft differs from what is
 * published. Every name and address is made up.
 */
import { createJWT } from '../../../cloudflare-worker/src/auth.ts';

/** The suite's pinned clock (`server.ts` NOW), as SQL and ISO stamps `hours` before it. */
const at = (now: number, hours: number) => new Date(now - hours * 3_600_000);
const sql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export const SECURITY_ADMIN = { id: 9001, name: 'Admin A', email: 'admin.a@example.invalid' };

/** The BACKUPS bucket's three markers: the D1 and KV heartbeats, and the failed drill. */
export function securityBackups(now: number) {
  const objects: Record<string, unknown> = {
    'heartbeat-d1.json': { schema_version: 1, kind: 'd1', at: iso(at(now, 8)), source: 'gha', key: 'd1/studioos-db/backup-nightly.sql', size_bytes: 48_120_331 },
    'heartbeat-kv.json': { schema_version: 1, kind: 'kv', at: iso(at(now, 7.8)), source: 'cron' },
    'drill-d1.json': {
      schema_version: 1, at: iso(at(now, 6 * 24 + 7)), outcome: 'failed', duration_s: 252, source: 'gha', step: 'restore', exit_code: 1,
      backup_key: 'd1/studioos-db/backup-drill.sql', run_id: '18822', rpo_met: null, rto_met: true,
      reason: 'restore failed at chunk 2/7 (data)', recovery_point: iso(at(now, 6 * 24 + 8)), tables: 214,
    },
  };
  return {
    async get(key: string) {
      if (!(key in objects)) return null;
      const v = objects[key];
      return { async json() { return v; }, async text() { return JSON.stringify(v); } };
    },
    async head() { return null; },
    async list() { return { objects: [], truncated: false, delimitedPrefixes: [] }; },
  };
}

/** Seeds the users, sessions, requests, ledger rows and Trust Center block; answers the Super Admin's token. */
export async function seedSecurity(db: any, env: any, now: number) {
  const user = db.prepare('INSERT INTO users (id, role, name, email, is_active, tfa_methods, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  user.run(9001, 'admin', 'Admin A', 'admin.a@example.invalid', '["totp"]', '2026-01-05 09:00:00');
  user.run(9002, 'admin', 'Admin B', 'admin.b@example.invalid', '[]', '2026-02-11 09:00:00');
  user.run(9005, 'admin', 'Admin C', 'admin.c@example.invalid', '[]', '2026-05-20 09:00:00');
  user.run(9003, 'founder', 'Person C', 'person.c@example.invalid', '[]', '2026-03-02 09:00:00');
  user.run(9004, 'founder', 'Person D', 'person.d@example.invalid', '[]', '2026-04-14 09:00:00');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (9001)').run();

  const session = db.prepare('INSERT INTO user_sessions (user_id, jti, user_agent, ip, created_at, last_seen_at, factor, assurance_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  session.run(9001, 'visual-security-admin-a', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '203.0.113.7', sql(at(now, 5)), sql(at(now, 0.2)), 'totp', 'totp');
  session.run(9002, 'visual-security-admin-b', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', '198.51.100.23', sql(at(now, 20)), sql(at(now, 3)), 'password', 'password');
  session.run(9003, 'visual-security-person-c', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', '192.0.2.44', sql(at(now, 9)), sql(at(now, 1)), 'magic', 'password');

  // One open erasure request, due five days from the pinned clock; one closed last week.
  db.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = 9003').run(sql(at(now, 25 * 24)));
  db.prepare('INSERT INTO dsr_requests (user_id, requested_at, created_at) VALUES (9003, ?, ?)').run(sql(at(now, 25 * 24)), sql(at(now, 25 * 24)));
  db.prepare("INSERT INTO dsr_requests (user_id, requested_at, outcome, closed_at, closed_by_user_id, close_reason, created_at) VALUES (9004, ?, 'fulfilled', ?, 9001, 'Erasure carried out by hand and checked.', ?)")
    .run(sql(at(now, 40 * 24)), sql(at(now, 8 * 24)), sql(at(now, 40 * 24)));

  // Ledger rows: refusals and a step-up (security_events), an export (admin_audit_log), a sign-in (activity_logs).
  const event = db.prepare('INSERT INTO security_events (kind, factor, outcome, detail, user_id, subject_key, ip_prefix, minute, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  event.run('gate', 'totp', 'refused', 'factor_required', 9001, 'u:9001', '203.0.113', sql(at(now, 0.3)).slice(0, 16), sql(at(now, 0.3)));
  event.run('step_up', 'totp', 'refused', 'invalid_code', 9002, 'u:9002', '198.51.100', sql(at(now, 2)).slice(0, 16), sql(at(now, 2)));
  event.run('signin', 'magic', 'refused', 'unknown_account', null, 'e:hash', '192.0.2', sql(at(now, 4)).slice(0, 16), sql(at(now, 4)));
  db.prepare("INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, exported_at) VALUES (9001, 'analytics_export', 'users', 'csv', ?)").run(sql(at(now, 1.5)));
  db.prepare("INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (9002, 'login', 'Signed in', ?)").run(sql(at(now, 3)));

  // A Trust Center block whose draft differs from the published revision.
  const block = db.prepare("INSERT INTO trust_content_blocks (key, state, body_json, checked_at, published_at, published_by, change_note, change_uid, updated_at, updated_by) VALUES ('security', ?, ?, ?, ?, ?, ?, ?, ?, 9001)");
  block.run('published', JSON.stringify({ items: ['Data is encrypted at rest and in transit.', 'Administrators sign in with a second factor.'] }), '2026-10-01', sql(at(now, 20 * 24)), 9001, 'First published security summary.', 'visual-security-change-1', sql(at(now, 20 * 24)));
  block.run('draft', JSON.stringify({ items: ['Data is encrypted at rest and in transit.', 'Administrators are asked to enrol a second factor.'] }), '2026-10-01', null, null, null, null, sql(at(now, 2)));

  const token = await createJWT(env, SECURITY_ADMIN.id, SECURITY_ADMIN.email, 'admin', undefined, 'visual-security-admin-a');
  return { token };
}
