/**
 * D1232 (#3240) — KYC & KYB part 4, on node:sqlite with migration 617:
 * the renewals read (KYC9), the renewal periods (KYC17c), the studio audit read
 * (KYC10) and the Super Admin export (KYC17d).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/kyc_governance_d1232.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import kycGovernance from '../src/routes/kyc_governance.ts';
import kyc from '../src/routes/kyc.ts';
import { DEFAULT_PERIOD_MONTHS, RENEWAL_PERIOD_KEYS, ensureTrustSchema, monthsToMs, renewalPeriods, resyncKycKyb, ttlForObligation } from '../src/services/trust.ts';
import { auditDetail } from '../src/services/kycGovernance.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-kyc-d1232';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const ddl = (name: string) => { const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`); assert.ok(at >= 0, name); return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2); };
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const SUPER = 1, ADMIN = 2, MEMBER = 3;
const REASON_TEXT = 'Photo shows a private address on Secret Road';

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    jwt_min_iat INTEGER, kyc_status TEXT, kyc_data TEXT, kyc_provider TEXT, kyc_submitted_at TEXT, kyc_reviewed_at TEXT,
    kyc_reviewed_by INTEGER, kyc_rejection_reason TEXT
  ); CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  for (const t of ['activity_logs', 'admin_audit_log', 'user_sessions']) db.exec(ddl(t));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/617_kyc_renewal_periods.sql', 'utf8'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, kyc_status) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'sue@axal.test', 'Sue Super', 'admin', null);
  u.run(ADMIN, 'ada@axal.test', 'Ada Admin', 'admin', null);
  u.run(MEMBER, 'member@secret.test', 'Pat Member', 'investor', 'approved');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES
    ('fresh', 1, 'totp', datetime('now'), datetime('now')), ('stale', 1, 'totp', datetime('now', '-90 minutes'), datetime('now', '-90 minutes'))`);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  await ensureTrustSchema(env);
  return { db, env };
}

const app = new Hono();
app.route('/api/kyc', kycGovernance as any);
app.route('/api/kyc', kyc as any);
app.onError((err: any, c) => {
  const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return st ? c.json({ detail: err.message }, st) : c.json({ detail: String(err?.message || 'Internal server error') }, 500);
});

async function call(env: any, id: number | null, path: string, init: { method?: string; body?: unknown; jti?: string; env?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (id !== null) {
    headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: id, ...(init.jti ? { jti: init.jti } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  }
  const res = await app.fetch(new Request(`http://x/api/kyc${path}`, { method: init.method || 'GET', headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) }), { ...env, ...(init.env || {}) });
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}
const logs = (db: DatabaseSync, action: string) => db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action) as any[];

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

test('the default periods are the ROLE_MATRIX windows, month for month', () => {
  for (const k of RENEWAL_PERIOD_KEYS) assert.equal(monthsToMs(DEFAULT_PERIOD_MONTHS[k]), ttlForObligation(k), k);
});

test('a period change applies to the next approval only: an existing date never moves', async () => {
  // Mutation checked: resyncKycKyb stamping with the 24-month constant → the new approval is 730 days out.
  const { db, env } = await fixture();
  try {
    const kept = '2027-03-01T00:00:00.000Z';
    db.prepare(`INSERT INTO users (id, email, name, role, kyc_status) VALUES (10, 'old@x.test', 'Old Approval', 'investor', 'approved'), (11, 'new@x.test', 'New Approval', 'investor', 'approved')`).run();
    db.prepare(`INSERT INTO legal_obligations (user_id, obligation_key, status, expires_at) VALUES (10, 'kyc_v1', 'satisfied', ?), (11, 'kyc_v1', 'pending', NULL)`).run(kept);
    const put = await call(env, SUPER, '/admin/periods', { method: 'PUT', jti: 'fresh', body: { periods: { kyc_v1: 18, kyb_v1: 24 } } });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.body.changes, [{ key: 'kyc_v1', from: 24, to: 18 }], 'an unchanged period is not a change');
    assert.equal(put.body.periods.find((p: any) => p.key === 'kyc_v1').updated_by, 'Sue Super');
    const before = Date.now();
    await resyncKycKyb(env);
    const rows = Object.fromEntries((db.prepare('SELECT user_id, expires_at FROM legal_obligations').all() as any[]).map((r) => [r.user_id, r.expires_at]));
    assert.equal(rows[10], kept, 'the earlier approval keeps its date');
    const days = (Date.parse(rows[11]) - before) / DAY;
    assert.ok(Math.abs(days - 18 * 365 / 12) < 1, `the new approval is 18 months out (${days} days)`);
    assert.deepEqual(logs(db, 'kyc_periods_changed').map((r) => [r.details, r.user_id]), [['kyc_v1 24->18 months', SUPER]]);
  } finally { db.close(); }
});

test('periods: any admin reads them; only a stepped-up Super Admin at HQ changes them, within 1 to 120 whole months', async () => {
  // Mutation checked: PUT without requireStepUp → the stale session saves.
  const { db, env } = await fixture();
  try {
    const read = await call(env, ADMIN, '/admin/periods');
    assert.equal(read.status, 200);
    assert.equal(read.body.can_change, false);
    assert.deepEqual(read.body.periods.map((p: any) => [p.key, p.months, p.set_by_hq, p.applied]), [['kyc_v1', 24, false, true], ['kyb_v1', 24, false, true], ['accreditation_v1', 12, false, false]]);
    assert.match(read.body.periods[2].reason, /No route approves accreditation evidence yet/);
    assert.equal((await call(env, SUPER, '/admin/periods')).body.can_change, true);
    for (const [id, jti, extra] of [[ADMIN, 'fresh', {}], [SUPER, 'stale', {}], [SUPER, 'fresh', { BRANCH_CODE: 'lisbon' }], [null, undefined, {}]] as const) {
      const r = await call(env, id, '/admin/periods', { method: 'PUT', jti, body: { periods: { kyc_v1: 12 } }, env: extra });
      assert.ok([401, 403].includes(r.status), `${id}/${jti}/${JSON.stringify(extra)} → ${r.status}`);
    }
    for (const body of [{}, { periods: {} }, { periods: { kyc_v1: 0 } }, { periods: { kyc_v1: 121 } }, { periods: { kyc_v1: 12.5 } }, { periods: { tos_v1: 12 } }]) {
      assert.equal((await call(env, SUPER, '/admin/periods', { method: 'PUT', jti: 'fresh', body })).status, 400, JSON.stringify(body));
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM kyc_renewal_periods').get()!.n, 0, 'nothing refused was written');
    assert.equal(logs(db, 'kyc_periods_changed').length, 0);
    assert.equal((await renewalPeriods(env)).kyc_v1.months, 24);
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Renewals
 * ------------------------------------------------------------------ */

test('renewals: expired first, then the soonest, over 12 months, with the warnings sent for the current date', async () => {
  // Mutation checked: ordering by date alone → the expired row is not first; a pending row listed → Eve appears;
  // a warning matched without its expires_at → the renewed row shows a stale warning.
  const { db, env } = await fixture();
  try {
    const now = Date.now();
    const u = db.prepare("INSERT INTO users (id, email, name, role, kyc_status) VALUES (?, ?, ?, 'investor', ?)");
    u.run(20, 'a@x.test', 'Alma Soon', 'approved'); u.run(21, 'b@x.test', 'Bea Lapsed', 'expired'); u.run(22, 'c@x.test', 'Cy Later', 'approved');
    u.run(23, 'd@x.test', 'Dee Far', 'approved'); u.run(24, 'e@x.test', 'Eve Pending', 'pending'); u.run(25, 'f@x.test', 'Fay Firm', 'approved');
    const o = db.prepare('INSERT INTO legal_obligations (id, user_id, obligation_key, status, expires_at) VALUES (?, ?, ?, ?, ?)');
    o.run(1, 20, 'kyc_v1', 'satisfied', iso(now + 10 * DAY));
    o.run(2, 21, 'kyc_v1', 'expired', iso(now - 3 * DAY));
    o.run(3, 22, 'kyc_v1', 'satisfied', iso(now + 100 * DAY));
    o.run(4, 23, 'kyc_v1', 'satisfied', iso(now + 400 * DAY));
    o.run(5, 24, 'kyc_v1', 'pending', iso(now + 15 * DAY)); // rejected on re-check: back to pending, its old date kept
    o.run(6, 25, 'kyb_v1', 'satisfied', iso(now + 20 * DAY));
    o.run(7, 20, 'accreditation_v1', 'satisfied', iso(now + 5 * DAY));
    const n = db.prepare("INSERT INTO renewal_notices (user_id, subject_kind, subject_id, threshold_days, expires_at, notified_at) VALUES (?, 'obligation', ?, ?, ?, '2026-10-20 09:00:00')");
    n.run(20, 1, 30, iso(now + 10 * DAY)); n.run(20, 1, 14, iso(now + 10 * DAY));
    n.run(25, 6, 30, '2025-01-01T00:00:00.000Z'); // a warning for an earlier date of a renewed check
    const r = await call(env, ADMIN, '/admin/renewals');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.items.map((i: any) => i.who.name), ['Bea Lapsed', 'Alma Soon', 'Fay Firm', 'Cy Later'], 'expired first, then soonest; beyond 12 months, never-satisfied and accreditation are out');
    assert.deepEqual(r.body.items.map((i: any) => i.kind), ['person', 'person', 'business', 'person']);
    assert.equal(r.body.items[0].expired, true);
    assert.deepEqual(r.body.items[1].warned.map((w: any) => [w.days, !!w.sent_at]), [[30, true], [14, true], [7, false]]);
    assert.deepEqual(r.body.items[2].warned.map((w: any) => !!w.sent_at), [false, false, false], 'a renewed date has no warning yet');
    assert.equal(r.body.counts.expire_30.count, 2);
    assert.equal(r.body.counts.expired, 1);
    assert.equal(r.body.counts.rechecks.recorded, false, 'nothing records a re-check yet: not 0');
    assert.equal(r.body.months.length, 12);
    assert.equal(r.body.months.reduce((t: number, m: any) => t + m.people + m.businesses, 0), 3, 'the chart counts what is still to expire');
    assert.deepEqual((await call(env, ADMIN, '/admin/renewals?filter=expired')).body.items.map((i: any) => i.who.name), ['Bea Lapsed']);
    assert.deepEqual((await call(env, ADMIN, '/admin/renewals?filter=soon')).body.items.map((i: any) => i.who.name), ['Alma Soon', 'Fay Firm']);
    assert.deepEqual((await call(env, ADMIN, '/admin/renewals?q=cy')).body.items.map((i: any) => i.who.name), ['Cy Later']);
    assert.equal((await call(env, ADMIN, '/admin/renewals?filter=bogus')).status, 400);
    assert.equal(logs(db, 'kyc_renewals_access')[0].details, 'KYC renewals read count=4');
    assert.equal((await call(env, MEMBER, '/admin/renewals')).status, 403);
    db.exec('DROP TABLE legal_obligations');
    assert.equal((await call(env, ADMIN, '/admin/renewals')).status, 503, 'unreadable, never an empty list');
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

function seedAudit(db: DatabaseSync) {
  const a = db.prepare("INSERT INTO activity_logs (action, details, actor, user_id, created_at) VALUES (?, ?, 'h', ?, ?)");
  a.run('kyc_queue_access', 'KYC queue read count=10', ADMIN, '2026-10-20 09:00:00');
  a.run('kyc_record_access', `Admin read KYC record for user_id=${MEMBER}`, ADMIN, '2026-10-20 09:01:00');
  a.run('kyc_field_shown', `Admin showed date_of_birth on the KYC record for user_id=${MEMBER}`, ADMIN, '2026-10-20 09:02:00');
  a.run('kyc_rejected_by_admin', `Admin Ada rejected KYC for Pat Member — reason: ${REASON_TEXT} (document purged: true)`, SUPER, '2026-10-21 10:00:00');
  // The member's own twin, which names the member in user_id: never an admin row.
  a.run('kyc_rejected', `Your KYC submission was rejected. Reason: ${REASON_TEXT}.`, MEMBER, '2026-10-21 10:00:00');
  a.run('kyc_approved_by_admin', `Admin approved KYC for Pat Member (user_id=${MEMBER})`, SUPER, '2026-09-01 10:00:00');
}

test('the audit is names and actions only: words, admins and cases, never a typed reason or the sentence', async () => {
  // Mutation checked: returning details as the row's detail → the reason text leaks; reading member twins → Pat as an admin.
  const { db, env } = await fixture();
  try {
    seedAudit(db);
    const r = await call(env, ADMIN, '/admin/audit?from=2026-10-01&to=2026-10-25');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.items.map((i: any) => [i.word, i.admin.name, i.case?.name ?? null, i.detail]), [
      ['Rejected', 'Sue Super', null, 'Document deleted'],
      ['Showed a value', 'Ada Admin', 'Pat Member', 'Date of birth'],
      ['Opened a case', 'Ada Admin', 'Pat Member', null],
      ['Opened the list', 'Ada Admin', null, '10 rows'],
    ]);
    assert.doesNotMatch(r.text, /Secret Road|private address|Your KYC/, 'no reason, no member twin');
    assert.equal(r.body.per_day.find((d: any) => d.day === '2026-10-20').looks, 3);
    assert.equal(r.body.per_day.find((d: any) => d.day === '2026-10-21').decisions, 1);
    assert.deepEqual(r.body.admins.map((a: any) => a.name).sort(), ['Ada Admin', 'Sue Super']);
    assert.deepEqual((await call(env, ADMIN, '/admin/audit?from=2026-10-01&to=2026-10-25&action=kyc_field_shown')).body.items.map((i: any) => i.word), ['Showed a value']);
    assert.equal((await call(env, ADMIN, `/admin/audit?from=2026-10-01&to=2026-10-25&admin=${SUPER}`)).body.total, 1);
    assert.equal((await call(env, ADMIN, `/admin/audit?from=2026-10-01&to=2026-10-25&case=${MEMBER}`)).body.total, 2);
    assert.equal((await call(env, ADMIN, '/admin/audit?from=2026-08-01&to=2026-10-25')).body.total, 5, 'the window decides');
    for (const q of ['from=2026-10-25&to=2026-10-01', 'from=2025-01-01&to=2026-10-25', 'from=bad', 'action=kyc_rejected', 'admin=0'])
      assert.equal((await call(env, ADMIN, `/admin/audit?${q}`)).status, 400, q);
    assert.ok(logs(db, 'kyc_audit_access').length >= 1);
    assert.equal((await call(env, MEMBER, '/admin/audit')).status, 403);
  } finally { db.close(); }
});

test('auditDetail rebuilds only what this code wrote', () => {
  assert.equal(auditDetail('kyc_periods_changed', 'kyc_v1 24->18 months; accreditation_v1 12->18 months'), 'Identity (KYC): 24 → 18 months; Accreditation evidence: 12 → 18 months');
  assert.equal(auditDetail('kyc_field_shown', 'Admin showed password on'), null, 'an unknown field names nothing');
  assert.equal(auditDetail('kyc_document_access', 'Admin viewed KYC document for user_id=3 (legacy D1 storage)'), 'Document (older storage)');
  assert.equal(auditDetail('kyc_rejected_by_admin', 'reason: anything'), null);
});

test('the export: a Super Admin at HQ with a reason, recorded first; the file holds names and actions only', async () => {
  // Mutation checked: export without requireSuperAdmin → the plain Admin exports; the audit row written after the file → an unrecorded export.
  const { db, env } = await fixture();
  try {
    seedAudit(db);
    db.prepare("UPDATE users SET name = '=HYPERLINK(1)' WHERE id = ?").run(ADMIN);
    const body = { from: '2026-10-01', to: '2026-10-25', reason: 'Quarterly review for the compliance file.' };
    for (const [id, extra] of [[ADMIN, {}], [SUPER, { BRANCH_CODE: 'lisbon' }], [null, {}]] as const)
      assert.ok([401, 403].includes((await call(env, id, '/admin/audit/export', { method: 'POST', body, env: extra })).status), String(id));
    assert.equal((await call(env, SUPER, '/admin/audit/export', { method: 'POST', body: { ...body, reason: 'because' } })).status, 400);
    assert.equal((await call(env, SUPER, '/admin/audit/export', { method: 'POST', body: { reason: body.reason } })).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_audit_log').get()!.n, 0, 'a refused export is not recorded');
    const r = await call(env, SUPER, '/admin/audit/export', { method: 'POST', body });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.rows, 4);
    assert.equal(r.body.filename, 'kyc-audit_2026-10-01_2026-10-25.csv');
    const lines = r.body.csv.trim().split('\r\n');
    assert.equal(lines[0], 'When (UTC),Admin,Action,Case,Detail');
    assert.equal(lines.length, 5);
    assert.match(r.body.csv, /'=HYPERLINK\(1\)/, 'a formula cell is neutralised');
    assert.doesNotMatch(r.body.csv, /Secret Road|private address|member@secret|date_of_birth/);
    const audit = db.prepare('SELECT admin_user_id, action, report_type, format, filters_json FROM admin_audit_log').all() as any[];
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].admin_user_id, audit[0].action, audit[0].report_type, audit[0].format], [SUPER, 'kyc_audit_export', 'kyc_audit', 'csv']);
    assert.deepEqual(JSON.parse(audit[0].filters_json), { ...body, rows: 4 });
    db.exec('DROP TABLE admin_audit_log');
    const unrecorded = await call(env, SUPER, '/admin/audit/export', { method: 'POST', body });
    assert.equal(unrecorded.status, 503);
    assert.equal(unrecorded.body.csv, undefined, 'no file leaves unrecorded');
  } finally { db.close(); }
});

test('the governance routes answer ahead of kyc.ts: "renewals" is never read as an account id', async () => {
  const { db, env } = await fixture();
  try {
    assert.equal((await call(env, ADMIN, '/admin/renewals')).status, 200);
    assert.equal((await call(env, ADMIN, `/admin/${MEMBER}`)).status, 200, 'the case read still answers');
  } finally { db.close(); }
});
