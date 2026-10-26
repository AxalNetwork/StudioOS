/**
 * D1303 (#3400, part 4 of #2377) — All accounts' smaller writes, through the
 * real routers over SQLite (the baseline and every later migration):
 *
 *   · full access without an identity check needs a reason, kept on the case
 *     event and out of the activity text; a reviewed submission does not;
 *   · the bulk resend: capped, a dry run that sends nothing, verified,
 *     deactivated, missing and (for a plain Admin) administrator accounts
 *     skipped, each send recorded, the single resend unchanged;
 *   · saved views: only me, or every admin of this studio; names unique per
 *     reader; only the list's keys; changed by their owner, a studio view also
 *     by a Super Admin;
 *   · the export: a reason, the list's own fields, the audit row written
 *     first and no file without it, a formula cell neutralised;
 *   · who saved an account's notes, and when, on the save and the profile.
 *
 * `fetch` is stubbed and counted, and none is made. Every name is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/accounts_writes_d1303.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import admin from '../src/routes/admin.ts';
import adminAccounts, { EXPORT_COLUMNS, RESEND_CAP, accountsCsv } from '../src/routes/admin_accounts.ts';
import kyc from '../src/routes/kyc.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const MIGRATIONS = readdirSync(resolve(ROOT, 'cloudflare-worker/sql/migrations')).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const f of MIGRATIONS) if (migrationNumber(f) > BASELINE_CUTOFF) db.exec(read(`cloudflare-worker/sql/migrations/${f}`));
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
})();
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-d1303';

const app = new Hono<any>();
app.route('/api/admin/accounts', adminAccounts);
app.route('/api/admin', admin);
app.route('/api/kyc', kyc);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D1303'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const SUPER = 1, ADMIN = 2, OTHER_ADMIN = 3, BYPASS = 10, SUBMITTED = 11, UNVERIFIED_A = 12, UNVERIFIED_B = 13, VERIFIED = 14, GONE = 15, FORMULA = 16;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  DDL.forEach((s) => db.exec(s));
  db.exec(`
    INSERT INTO users (id, uid, role, name, email, is_active, email_verified, kyc_status, kyc_submitted_at, created_at) VALUES
      (1, 'u-super', 'admin', 'Sue Super', 'sue@example.test', 1, 1, 'approved', NULL, '2026-01-01 09:00:00'),
      (2, 'u-ada', 'admin', 'Ada Admin', 'ada@example.test', 1, 1, 'approved', NULL, '2026-01-02 09:00:00'),
      (3, 'u-otto', 'admin', 'Otto Other', 'otto@example.test', 1, 0, 'approved', NULL, '2026-01-03 09:00:00'),
      (10, 'u-bea', 'investor', 'Bea Bypass', 'bea@example.test', 1, 1, 'not_started', NULL, '2026-02-01 09:00:00'),
      (11, 'u-sam', 'founder', 'Sam Submitted', 'sam@example.test', 1, 1, 'pending', '2026-10-01 09:00:00', '2026-02-02 09:00:00'),
      (12, 'u-una', 'exploring', 'Una Unverified', 'una@example.test', 1, 0, 'not_started', NULL, '2026-03-01 09:00:00'),
      (13, 'u-ulf', 'partner', 'Ulf Unverified', 'ulf@example.test', 1, 0, 'not_started', NULL, '2026-03-02 09:00:00'),
      (14, 'u-vic', 'advisor', 'Vic Verified', 'vic@example.test', 1, 1, 'approved', NULL, '2026-03-03 09:00:00'),
      (15, 'u-gil', 'founder', 'Gil Gone', 'gil@example.test', 0, 0, 'not_started', NULL, '2026-03-04 09:00:00'),
      (16, 'u-fox', 'founder', '=HYPERLINK("x")', 'fox@example.test', 1, 1, 'rejected', NULL, '2026-03-05 09:00:00');
    INSERT INTO super_admins (user_id) VALUES (1);
    INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES
      ('fresh-1', 1, 'totp', datetime('now'), datetime('now')), ('fresh-2', 2, 'totp', datetime('now'), datetime('now')),
      ('fresh-3', 3, 'totp', datetime('now'), datetime('now'));
  `);
  return db;
}

const makeEnv = (db: DatabaseSync, over: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...over } as any);
async function call(env: any, method: string, path: string, as: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: as, jti: `fresh-${as}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
}
const all = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const one = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).get() ?? null));

/* ------------------------------------------------------------------ *
 * Full access without an identity check
 * ------------------------------------------------------------------ */

test('full access without an identity check is refused without a reason, and the reason is kept on the case', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    for (const b of [undefined, {}, { reason: 'too short' }, { reason: 'x'.repeat(501) }, { note: 'Checked their passport on a call' }]) {
      const r = await call(env, 'PATCH', `/api/kyc/admin/${BYPASS}/approve`, ADMIN, b);
      assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(r.body.error, 'reason_required');
    }
    assert.equal(one(db, `SELECT kyc_status FROM users WHERE id = ${BYPASS}`).kyc_status, 'not_started', 'nothing changed');
    const ok = await call(env, 'PATCH', `/api/kyc/admin/${BYPASS}/approve`, ADMIN, { reason: 'Checked their passport on a video call' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(one(db, `SELECT kyc_status FROM users WHERE id = ${BYPASS}`).kyc_status, 'approved');
    const ev = one(db, `SELECT kind, note, actor_user_id FROM kyc_case_events WHERE user_id = ${BYPASS} ORDER BY id DESC LIMIT 1`);
    assert.deepEqual(ev, { kind: 'approved', note: 'Checked their passport on a video call', actor_user_id: ADMIN });
    const log = one(db, `SELECT details FROM activity_logs WHERE action = 'kyc_bypass_granted'`).details;
    assert.match(log, /reason recorded on the case/);
    assert.ok(!log.includes('passport'), 'the reason is not copied into the activity text');
    // A reviewed submission is approved without a reason, as before.
    assert.equal((await call(env, 'PATCH', `/api/kyc/admin/${SUBMITTED}/approve`, ADMIN, {})).status, 200);
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Bulk resend
 * ------------------------------------------------------------------ */

test('bulk resend: capped; a dry run sends nothing; verified, deactivated, missing and another admin’s accounts are skipped', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const many = Array.from({ length: RESEND_CAP + 1 }, (_, i) => 1000 + i);
    const cap = await call(env, 'POST', '/api/admin/accounts/resend-verification', ADMIN, { user_ids: many });
    assert.equal(cap.status, 400); assert.equal(cap.body.error, 'too_many_accounts'); assert.equal(cap.body.cap, 50);
    for (const b of [{}, { user_ids: [] }, { user_ids: [0] }, { user_ids: ['x'] }, { user_ids: 'all' }]) {
      assert.equal((await call(env, 'POST', '/api/admin/accounts/resend-verification', ADMIN, b)).status, 400, JSON.stringify(b));
    }
    const ids = [UNVERIFIED_A, UNVERIFIED_B, VERIFIED, GONE, OTHER_ADMIN, 999, UNVERIFIED_A];
    const dry = await call(env, 'POST', '/api/admin/accounts/resend-verification', ADMIN, { user_ids: ids, dry_run: true });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual([dry.body.asked, dry.body.to_send, dry.body.skipped], [6, 2, { verified: 1, deactivated: 1, administrator: 1, not_found: 1 }]);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM users WHERE verification_token IS NOT NULL').n, 0, 'a dry run rotates nothing');
    const sent = await call(env, 'POST', '/api/admin/accounts/resend-verification', ADMIN, { user_ids: ids });
    assert.equal(sent.status, 200, sent.text);
    assert.deepEqual([sent.body.sent, sent.body.emailed, sent.body.not_emailed], [2, 0, 2], 'no mail credentials here: rotated, not emailed');
    assert.deepEqual(sent.body.skipped_ids, { verified: [VERIFIED], deactivated: [GONE], administrator: [OTHER_ADMIN], not_found: [999] });
    assert.deepEqual(all(db, 'SELECT id FROM users WHERE verification_token IS NOT NULL ORDER BY id').map((x: any) => x.id), [UNVERIFIED_A, UNVERIFIED_B]);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'admin_resent_verification'").n, 2);
    const summary = one(db, "SELECT details, user_id FROM activity_logs WHERE action = 'admin_bulk_resent_verification'");
    assert.equal(summary.user_id, ADMIN);
    for (const pii of ['una@', 'ulf@', 'Una', 'Ulf']) assert.ok(!JSON.stringify(all(db, "SELECT details FROM activity_logs WHERE action LIKE '%resent%'")).includes(pii), pii);
    // A Super Admin reaches another administrator's account; nothing eligible is a 409.
    const su = await call(env, 'POST', '/api/admin/accounts/resend-verification', SUPER, { user_ids: [OTHER_ADMIN] });
    assert.equal(su.status, 200, su.text); assert.equal(su.body.sent, 1);
    const none = await call(env, 'POST', '/api/admin/accounts/resend-verification', ADMIN, { user_ids: [VERIFIED] });
    assert.equal(none.status, 409); assert.equal(none.body.error, 'nothing_to_send');
    // The single resend shares the service.
    const single = await call(env, 'POST', `/api/admin/users/${UNVERIFIED_B}/resend-verification`, ADMIN);
    assert.deepEqual([single.status, single.body.already_verified, single.body.emailed], [200, false, false]);
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'admin_resent_verification'").n, 4);
    assert.equal(sent.headers.get('Cache-Control'), 'private, no-store');
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Saved views
 * ------------------------------------------------------------------ */

test('saved views: only me or the whole studio, read back; unique names; only the list’s keys; changed by their owner', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    const mine = await call(env, 'POST', '/api/admin/accounts/views', ADMIN, { name: 'Unverified over 7 days', scope: 'admin', query: { email: 'unverified', joined: '7d', profile: ['founder', 'investor'] } });
    assert.equal(mine.status, 201, mine.text);
    const studio = await call(env, 'POST', '/api/admin/accounts/views', ADMIN, { name: 'Testers available', scope: 'studio', query: { sub_account: 'tester' } });
    assert.equal(studio.status, 201, studio.text);
    const back = await call(env, 'GET', '/api/admin/accounts/views', ADMIN);
    assert.deepEqual(back.body.views.map((v: any) => [v.name, v.scope, v.mine, v.can_change]).sort(),
      [['Testers available', 'studio', true, true], ['Unverified over 7 days', 'admin', true, true]]);
    assert.deepEqual(back.body.views.find((v: any) => v.scope === 'admin').query, { email: 'unverified', joined: '7d', profile: ['founder', 'investor'] });
    const other = await call(env, 'GET', '/api/admin/accounts/views', OTHER_ADMIN);
    assert.deepEqual(other.body.views.map((v: any) => [v.name, v.mine, v.can_change, v.owner.name]), [['Testers available', false, false, 'Ada Admin']], 'another admin sees the studio view only');
    for (const [b, code] of [
      [{ name: 'Unverified over 7 days', scope: 'admin', query: {} }, 'name_taken'],
      [{ name: 'x', scope: 'everyone', query: {} }, 'invalid_scope'],
      [{ name: '', scope: 'admin' }, 'invalid_name'],
      [{ name: 'Bad', scope: 'admin', query: { "1=1; DROP TABLE users": 'x' } }, 'invalid_query'],
      [{ name: 'Bad', scope: 'admin', query: { country: { nested: true } } }, 'invalid_query'],
    ] as const) {
      const r = await call(env, 'POST', '/api/admin/accounts/views', ADMIN, b);
      assert.equal(r.body.error, code, JSON.stringify(b));
    }
    // The same name is free for another admin's own view, never for a second studio view.
    assert.equal((await call(env, 'POST', '/api/admin/accounts/views', OTHER_ADMIN, { name: 'Unverified over 7 days', scope: 'admin', query: {} })).status, 201);
    assert.equal((await call(env, 'POST', '/api/admin/accounts/views', OTHER_ADMIN, { name: 'testers AVAILABLE', scope: 'studio', query: {} })).body.error, 'name_taken');
    // Change and delete: the owner; another admin's own view is no view; a studio view is a Super Admin's too.
    assert.equal((await call(env, 'PUT', `/api/admin/accounts/views/${mine.body.view.uid}`, OTHER_ADMIN, { name: 'Mine now' })).status, 404);
    assert.equal((await call(env, 'DELETE', `/api/admin/accounts/views/${studio.body.view.uid}`, OTHER_ADMIN)).status, 403);
    const renamed = await call(env, 'PUT', `/api/admin/accounts/views/${mine.body.view.uid}`, ADMIN, { name: 'Unverified, a week', query: { email: 'unverified' } });
    assert.deepEqual([renamed.status, renamed.body.view.name, renamed.body.view.query], [200, 'Unverified, a week', { email: 'unverified' }]);
    assert.equal((await call(env, 'DELETE', `/api/admin/accounts/views/${studio.body.view.uid}`, SUPER)).status, 200);
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM account_saved_views').n, 2);
  } finally { db.close(); }
});

test('saved views: at most thirty per admin', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    for (let i = 0; i < 30; i += 1) db.exec(`INSERT INTO account_saved_views (name, scope, owner_user_id) VALUES ('v${i}', 'admin', ${ADMIN})`);
    const r = await call(env, 'POST', '/api/admin/accounts/views', ADMIN, { name: 'One more', scope: 'admin', query: {} });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'too_many_views');
  } finally { db.close(); }
});

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

test('export: a reason; the list’s own fields; the audit row first, and no file without it', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    for (const [b, code] of [[{}, 'reason_required'], [{ reason: 'short' }, 'reason_required'],
      [{ reason: 'Quarterly accounts review', columns: ['email', 'password_hash'] }, 'invalid_columns'],
      [{ reason: 'Quarterly accounts review', user_ids: [] }, 'invalid_selection'],
      [{ reason: 'Quarterly accounts review', q: 'x' }, 'invalid_search']] as const) {
      const r = await call(env, 'POST', '/api/admin/accounts/export', ADMIN, b);
      assert.equal(r.body.error, code, JSON.stringify(b));
    }
    assert.equal(one(db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'accounts_export'")?.n ?? 0, 0, 'a refused export records nothing');
    const sel = await call(env, 'POST', '/api/admin/accounts/export', ADMIN, { reason: 'Send the unverified list to support', user_ids: [UNVERIFIED_A, UNVERIFIED_B], columns: ['name', 'email', 'email_verified', 'profile'] });
    assert.equal(sel.status, 200, sel.text);
    assert.equal(sel.body.csv, 'Name,Email,Email,Profile\r\nUlf Unverified,ulf@example.test,Not verified,Operating Partner\r\nUna Unverified,una@example.test,Not verified,Explorer\r\n');
    const audit = one(db, "SELECT admin_user_id, report_type, format, filters_json FROM admin_audit_log WHERE action = 'accounts_export'");
    assert.deepEqual({ ...audit, filters_json: JSON.parse(audit.filters_json) }, {
      admin_user_id: ADMIN, report_type: 'accounts', format: 'csv',
      filters_json: { reason: 'Send the unverified list to support', mode: 'selected', rows: 2, columns: ['name', 'email', 'email_verified', 'profile'] },
    });
    const search = await call(env, 'POST', '/api/admin/accounts/export', ADMIN, { reason: 'Everyone called Fox for the audit', q: 'fox@' });
    assert.equal(search.body.rows, 1);
    assert.ok(search.body.csv.includes(`"'=HYPERLINK(""x"")"`), 'a formula cell is neutralised');
    assert.deepEqual(search.body.csv.split('\r\n')[0].split(','), EXPORT_COLUMNS.map((c) => c.head));
    const every = await call(env, 'POST', '/api/admin/accounts/export', ADMIN, { reason: 'Full list for the annual review', columns: ['uid', 'status', 'identity', 'access', 'joined'] });
    assert.equal(every.body.rows, 10);
    assert.ok(every.body.csv.includes('u-gil,Deactivated,Not started,,2026-03-04 09:00:00'));
    assert.ok(every.body.csv.includes('u-sam,Active,Waiting,'));
    for (const secret of ['verification_token', 'admin_notes', 'kyc_data']) assert.ok(!every.text.includes(secret), secret);
    // An export that cannot be recorded is not made.
    const broken = makeEnv(db);
    const prepare = broken.DB.prepare.bind(broken.DB);
    broken.DB = { ...broken.DB, prepare: (sql: string) => { if (/INSERT INTO admin_audit_log/.test(sql)) throw new Error('disk full'); return prepare(sql); } };
    const unrecorded = await call(broken, 'POST', '/api/admin/accounts/export', ADMIN, { reason: 'Full list for the annual review' });
    assert.equal(unrecorded.status, 503); assert.equal(unrecorded.body.error, 'unrecorded');
    assert.equal(unrecorded.body.csv, undefined); assert.ok(!unrecorded.text.includes('example.test'));
  } finally { db.close(); }
});

test('accountsCsv: the words the list uses, in the order asked', () => {
  const row = { id: 1, uid: 'u-1', email: 'a@example.test', name: '+cmd', role: 'partner', is_active: 1, email_verified: 0, kyc_status: 'needs_info', access_level: 'limited', created_at: '2026-01-01' };
  assert.equal(accountsCsv([row], ['identity', 'access', 'profile', 'name']), "Identity check,Limited access,Profile,Name\r\nNeeds information,Limited access,Operating Partner,'+cmd\r\n");
});

/* ------------------------------------------------------------------ *
 * Notes metadata
 * ------------------------------------------------------------------ */

test('notes: each save records who and when; the profile reads it; another admin’s notes are the Super Admin’s', async () => {
  const db = freshDb(); const env = makeEnv(db);
  try {
    db.exec(`UPDATE users SET admin_notes = 'Old note' WHERE id = ${VERIFIED}`);
    const before = await call(env, 'GET', `/api/admin/users/${VERIFIED}/profile`, ADMIN);
    assert.equal(before.status, 200, before.text);
    assert.deepEqual(before.body.notes_saved, { recorded: false, reason: 'Not recorded: these notes were saved before who saved them was kept.' });
    const empty = await call(env, 'GET', `/api/admin/users/${UNVERIFIED_A}/profile`, ADMIN);
    assert.deepEqual(empty.body.notes_saved, { recorded: false, reason: 'No notes saved yet.' });
    const saved = await call(env, 'POST', `/api/admin/users/${VERIFIED}/notes`, ADMIN, { admin_notes: 'Met at the Lisbon demo day' });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.notes_saved.recorded, true);
    assert.deepEqual([saved.body.notes_saved.by, saved.body.notes_saved.chars], [{ id: ADMIN, name: 'Ada Admin' }, 26]);
    assert.match(saved.body.notes_saved.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const after = await call(env, 'GET', `/api/admin/users/${VERIFIED}/profile`, SUPER);
    assert.deepEqual(after.body.notes_saved.by, { id: ADMIN, name: 'Ada Admin' });
    assert.ok(!JSON.stringify(all(db, 'SELECT * FROM account_note_saves')).includes('Lisbon'), 'the metadata never holds the text');
    const refused = await call(env, 'POST', `/api/admin/users/${OTHER_ADMIN}/notes`, ADMIN, { admin_notes: 'x' });
    assert.equal(refused.status, 403); assert.equal(refused.body.code, 'super_admin_required');
    assert.equal(one(db, `SELECT admin_notes FROM users WHERE id = ${OTHER_ADMIN}`).admin_notes, null);
    assert.equal((await call(env, 'POST', `/api/admin/users/${OTHER_ADMIN}/notes`, SUPER, { admin_notes: 'HQ note' })).status, 200);
    assert.equal((await call(env, 'POST', `/api/admin/users/9999/notes`, ADMIN, { admin_notes: 'x' })).status, 404);
  } finally { db.close(); }
});

test('wiring: mounted ahead of admin.ts; every statement bound; the client spells each route', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.indexOf("app.route('/api/admin/accounts', adminAccounts);") > 0);
  assert.ok(index.indexOf("app.route('/api/admin/accounts', adminAccounts);") < index.indexOf("app.route('/api/admin', admin);"));
  const src = read('cloudflare-worker/src/routes/admin_accounts.ts') + read('cloudflare-worker/src/services/accountNotes.ts') + read('cloudflare-worker/src/services/verificationResend.ts');
  assert.ok(!/prepare\(`[^`]*\$\{/.test(src), 'no interpolated SQL');
  const client = read('frontend/src/lib/api/adminAccountWrites.js');
  for (const p of ["'/admin/accounts/resend-verification'", "'/admin/accounts/views'", '/admin/accounts/views/', "'/admin/accounts/export'"]) assert.ok(client.includes(p), p);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/adminAccountWrites\.js';/);
});
