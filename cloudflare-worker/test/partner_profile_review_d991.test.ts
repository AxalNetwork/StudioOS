/**
 * D991 (#2802) — Partner profiles part 2, through the real routes on
 * `node:sqlite`: `POST /api/profiling/admin/:email/verify` (the decision path),
 * `POST /api/admin/partner-profiles/:ref/reopen` and `GET …/:ref/history`, with
 * the baseline's `partner_profiles` and migrations 275, 556 and 557 run as
 * written.
 *
 *   1. Migration 557: the columns, the history table and its checks.
 *   2. A verdict records who and when; a rejection needs a reason of at least
 *      10 characters, refused before anything is written; the member reads it.
 *   3. The member is told by email and in their inbox; without an account, by
 *      email alone.
 *   4. Reopen: back in the queue, the verdict kept in the history, nobody told;
 *      a profile with no verdict has nothing to reopen.
 *   5. Captures by source join the history; one landing after a verdict keeps
 *      the verdict and sets the changed-after flag, which the next verdict clears.
 *   6. The history read, newest first; the list row's review fields, the
 *      `reviewed` sort and the `reviewed_by` filter.
 *   7. Refusals: a member 403, an unknown reference 404, a D1 error 503.
 *
 * Every person and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/partner_profile_review_d991.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import profiling from '../src/routes/profiling.ts';
import partnerProfiles from '../src/routes/admin_partner_profiles.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { PROFILE_NOTICE_TYPE, recordCapture, rejectReasonProblem } from '../src/services/partnerProfileReview.ts';
import { tableFromBaseline } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d991-0123456789-abcdef';
const ADMIN = 900, OTHER_ADMIN = 905, MEMBER = 901, PARTNER = 902;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const M275 = read('cloudflare-worker/sql/migrations/275_partner_profiles_columns.sql');
const M556 = read('cloudflare-worker/sql/migrations/556_partner_profiles_ref.sql');
const M557 = read('cloudflare-worker/sql/migrations/557_partner_profile_review.sql');

function makeD1(db: InstanceType<typeof DatabaseSync>, failing: RegExp[] = []) {
  const check = (sql: string) => { for (const f of failing) if (f.test(sql)) throw new Error('D1_ERROR: synthetic failure'); };
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
      async first() { check(sql); return db.prepare(sql).get(...b) ?? null; },
      async all() { check(sql); return { results: db.prepare(sql).all(...b) }; },
      async run() {
        check(sql);
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

/** Three profiles: a member with an account, a partner with an account, an invitee with none. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partner_profiles', 'user_role_review', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M275);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  u.run(OTHER_ADMIN, 'admin', 'Otto Admin', 'otto@example.test');
  u.run(MEMBER, 'exploring', 'Cleo Chat', 'chat@example.test');
  u.run(PARTNER, 'partner', 'Ed Eadwyn', 'eadwyn@example.test');
  const p = db.prepare(`INSERT INTO partner_profiles (email, user_id, chat_history, persona, admin_status, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  p.run('chat@example.test', MEMBER, '[{"role":"user","content":"hi"}]', 'Founder', 'pending', '2026-10-01 09:00:00');
  p.run('eadwyn@example.test', PARTNER, null, null, 'pending', '2026-10-02 09:00:00');
  db.prepare(`INSERT INTO partner_profiles (email, invitation_id, full_name, motivation, admin_status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run('inv@example.test', 7, 'Iris Invited', 'Deals', '2026-10-03 09:00:00');
  db.exec(M556);
  db.exec(M557);
  return { db, env: envOf(db) };
}
const envOf = (db: InstanceType<typeof DatabaseSync>, failing: RegExp[] = []): any =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://example.test', DB: makeD1(db, failing) });

const APP = new Hono<any>().route('/api/profiling', profiling as any).route('/api/admin/partner-profiles', partnerProfiles as any);
APP.onError((err: any, c: any) => {
  const m = String(err?.message || '');
  return c.json({ error: m }, (AUTH_ERROR_STATUSES[m] || (m === 'Unauthorized' ? 401 : m === 'Admin required' ? 403 : 500)) as any);
});

async function call(env: any, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await APP.fetch(new Request(`http://x${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), env);
  let body: any = null;
  try { body = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body };
}
const verify = (env: any, email: string, body: Record<string, unknown>, who = ADMIN) =>
  call(env, who, `/api/profiling/admin/${encodeURIComponent(email)}/verify`, { method: 'POST', body });
const quiet = async <T>(fn: () => Promise<T>) => { const s = console.error; const w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = s; console.warn = w; } };

const profileOf = (db: InstanceType<typeof DatabaseSync>, email: string) =>
  ({ ...(db.prepare('SELECT * FROM partner_profiles WHERE email = ?').get(email) as any) });
const events = (db: InstanceType<typeof DatabaseSync>, ref: string) =>
  db.prepare('SELECT kind, source, admin_user_id, reason FROM partner_profile_events WHERE profile_ref = ? ORDER BY id').all(ref)
    .map((r: any) => ({ ...r }));
const inbox = (db: InstanceType<typeof DatabaseSync>, userId: number) => {
  try { return db.prepare('SELECT type, title, body, link, payload FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[]; }
  catch { return []; }
};
const REASON = 'The entity named in the chat does not match the signatory.';

// ---------------------------------------------------------------------------
// 1. Migration 557
// ---------------------------------------------------------------------------

test('557 adds the review columns and an append-only history whose source is set only on a capture', () => {
  const { db } = fixture();
  const cols = (db.prepare('PRAGMA table_info(partner_profiles)').all() as any[]).map((r) => r.name);
  for (const c of ['reviewed_at', 'reviewed_by', 'reject_reason', 'changed_after_review_at']) assert.ok(cols.includes(c), c);
  for (const r of db.prepare('SELECT reviewed_at, reviewed_by, reject_reason, changed_after_review_at FROM partner_profiles').all() as any[]) {
    assert.deepEqual({ ...r }, { reviewed_at: null, reviewed_by: null, reject_reason: null, changed_after_review_at: null }, 'no verdict before 557 is given a date');
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM partner_profile_events').get() as any).n, 0, 'nothing is invented');
  const ins = db.prepare('INSERT INTO partner_profile_events (profile_ref, kind, source, created_at) VALUES (?, ?, ?, ?)');
  assert.doesNotThrow(() => ins.run('pp_0000000000', 'captured', 'chat', 'x'));
  assert.throws(() => ins.run('pp_0000000000', 'captured', null, 'x'), /CHECK/, 'a capture names its source');
  assert.throws(() => ins.run('pp_0000000000', 'verified', 'chat', 'x'), /CHECK/, 'a decision has no source');
  assert.throws(() => ins.run('pp_0000000000', 'approved', null, 'x'), /CHECK/);
  assert.throws(() => ins.run('pp_0000000000', 'captured', 'email', 'x'), /CHECK/);
  assert.doesNotThrow(() => db.exec(M557.replace(/^ALTER TABLE[^\n]*\n/gm, '')), 'the table and index are IF NOT EXISTS');
});

// ---------------------------------------------------------------------------
// 2–3. The verdict, its reason and the member's notice
// ---------------------------------------------------------------------------

test('a rejection without a reason of at least 10 characters is refused before anything is written', async () => {
  const { db, env } = fixture();
  const before = profileOf(db, 'chat@example.test');
  for (const reject_reason of [undefined, '', 'too short', '         a']) {
    const r = await verify(env, 'chat@example.test', { status: 'rejected', reject_reason });
    assert.equal(r.status, 400, String(reject_reason));
    assert.equal(r.body.error, 'reject_reason_required');
    assert.match(r.body.message, /at least 10 characters/);
  }
  assert.deepEqual(profileOf(db, 'chat@example.test'), before);
  assert.deepEqual(events(db, before.ref), []);
  assert.equal(rejectReasonProblem('x'.repeat(10)), null);
  assert.match(String(rejectReasonProblem('x'.repeat(2001))), /at most 2000/);
});

test('a rejection records who and when and the reason the member reads, and tells them in their inbox and by email', async () => {
  const { db, env } = fixture();
  const r = await quiet(() => verify(env, 'chat@example.test', { status: 'rejected', reject_reason: `  ${REASON}  ` }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = profileOf(db, 'chat@example.test');
  assert.equal(row.admin_status, 'rejected');
  assert.equal(row.reviewed_by, ADMIN);
  assert.match(row.reviewed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.body.reviewed_at, row.reviewed_at);
  assert.equal(row.reject_reason, REASON, 'trimmed');
  assert.deepEqual(events(db, row.ref), [{ kind: 'rejected', source: null, admin_user_id: ADMIN, reason: REASON }]);
  const notes = inbox(db, MEMBER);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].type, PROFILE_NOTICE_TYPE);
  assert.match(notes[0].title, /not verified/);
  assert.ok(notes[0].body.includes(REASON), 'the member reads the reason');
  assert.equal(notes[0].link, '/inbox');
  assert.doesNotMatch(String(notes[0].payload), /@/, 'the notice names the profile by reference');
  assert.deepEqual(r.body.member_notified, { in_app: true, email: 'by_settings' });
});

test('a verification clears any reason and the flag, and an invitee with no account is told by email alone', async () => {
  const { db, env } = fixture();
  await quiet(() => verify(env, 'inv@example.test', { status: 'rejected', reject_reason: REASON }));
  db.prepare('UPDATE partner_profiles SET changed_after_review_at = ? WHERE email = ?').run('2026-10-20T00:00:00Z', 'inv@example.test');
  const r = await quiet(() => verify(env, 'inv@example.test', { status: 'verified', reject_reason: 'A stray reason the form left behind.' }, OTHER_ADMIN));
  assert.equal(r.status, 200);
  const row = profileOf(db, 'inv@example.test');
  assert.deepEqual([row.admin_status, row.reviewed_by, row.reject_reason, row.changed_after_review_at], ['verified', OTHER_ADMIN, null, null]);
  assert.deepEqual(events(db, row.ref).map((e) => [e.kind, e.admin_user_id, e.reason]),
    [['rejected', ADMIN, REASON], ['verified', OTHER_ADMIN, null]], 'both verdicts stay in the history');
  // No account, so no inbox; the email has no transport in tests, so it says it was not sent.
  assert.deepEqual(r.body.member_notified, { in_app: false, email: 'not_sent' });
});

test('a member cannot reach the decision path, and a failed notice leaves the verdict standing', async () => {
  const { db, env } = fixture();
  const r = await verify(env, 'chat@example.test', { status: 'verified' }, MEMBER);
  assert.equal(r.status, 403);
  assert.equal(profileOf(db, 'chat@example.test').admin_status, 'pending');
  const failing = envOf(db, [/INSERT INTO notifications_inbox/, /CREATE TABLE IF NOT EXISTS notifications_inbox/]);
  const ok = await quiet(() => verify(failing, 'chat@example.test', { status: 'verified' }));
  assert.equal(ok.status, 200);
  assert.equal(profileOf(db, 'chat@example.test').admin_status, 'verified');
  assert.equal(ok.body.member_notified, null, 'null, never a claim it was sent');
});

// ---------------------------------------------------------------------------
// 4. Reopen
// ---------------------------------------------------------------------------

test('Reopen puts a verdict back in the queue, keeps it in the history, and tells nobody', async () => {
  const { db, env } = fixture();
  await quiet(() => verify(env, 'chat@example.test', { status: 'rejected', reject_reason: REASON }));
  const ref = profileOf(db, 'chat@example.test').ref;
  const told = inbox(db, MEMBER).length;
  const r = await call(env, OTHER_ADMIN, `/api/admin/partner-profiles/${ref}/reopen`, { method: 'POST', body: { reason: '  The signatory sent new papers. ' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'pending');
  const row = profileOf(db, 'chat@example.test');
  assert.deepEqual([row.admin_status, row.reviewed_at, row.reviewed_by, row.reject_reason, row.changed_after_review_at], ['pending', null, null, null, null]);
  assert.deepEqual(events(db, ref).map((e) => [e.kind, e.admin_user_id, e.reason]),
    [['rejected', ADMIN, REASON], ['reopened', OTHER_ADMIN, 'The signatory sent new papers.']]);
  assert.equal(inbox(db, MEMBER).length, told, 'nobody is told (PRF5d)');
  const log = db.prepare("SELECT details FROM activity_logs WHERE action = 'partner_profile_reopened'").all() as any[];
  assert.equal(log.length, 1);
  assert.match(log[0].details, new RegExp(`ref=${ref}`));
  assert.doesNotMatch(log[0].details, /@/);
  // Nothing left to reopen, and no reason at all is fine.
  const again = await call(env, ADMIN, `/api/admin/partner-profiles/${ref}/reopen`, { method: 'POST', body: {} });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'not_reviewed');
  assert.equal(events(db, ref).length, 2);
});

test('Reopen refuses a member, an unknown reference, an over-long reason; a suspended branch is not frozen, like the verdicts', async () => {
  const { db, env } = fixture();
  await quiet(() => verify(env, 'chat@example.test', { status: 'verified' }));
  const ref = profileOf(db, 'chat@example.test').ref;
  assert.equal((await call(env, MEMBER, `/api/admin/partner-profiles/${ref}/reopen`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await call(env, ADMIN, '/api/admin/partner-profiles/pp_ffffffffff/reopen', { method: 'POST', body: {} })).status, 404);
  assert.equal((await call(env, ADMIN, '/api/admin/partner-profiles/chat@example.test/reopen', { method: 'POST', body: {} })).status, 404, 'never by email');
  const long = await call(env, ADMIN, `/api/admin/partner-profiles/${ref}/reopen`, { method: 'POST', body: { reason: 'x'.repeat(2001) } });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'reason_too_long');
  db.exec(`CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT NOT NULL, suspended_at TEXT, suspended_note TEXT)`);
  db.exec(`INSERT INTO branch_licence (id, status) VALUES (1, 'suspended')`);
  const branch = { ...envOf(db), BRANCH_CODE: 'fr', APP_URL: 'https://fr.example.test', PUBLIC_BASE_URL: 'https://fr.example.test' };
  const s = await call(branch, ADMIN, `/api/admin/partner-profiles/${ref}/reopen`, { method: 'POST', body: {} });
  assert.equal(s.status, 200, 'Partner profiles are not frozen on a suspended branch (branchFreeze.js, D260)');
  assert.equal(profileOf(db, 'chat@example.test').admin_status, 'pending');
});

test('a pending status through the verify route is a reopen too, kept in the history', async () => {
  const { db, env } = fixture();
  await quiet(() => verify(env, 'chat@example.test', { status: 'verified' }));
  await quiet(() => verify(env, 'chat@example.test', { status: 'pending' }));
  const row = profileOf(db, 'chat@example.test');
  assert.deepEqual([row.admin_status, row.reviewed_at, row.reviewed_by], ['pending', null, null]);
  assert.deepEqual(events(db, row.ref).map((e) => e.kind), ['verified', 'reopened']);
});

// ---------------------------------------------------------------------------
// 5. Captures and the changed-after flag
// ---------------------------------------------------------------------------

test('each capture joins the history by source; after a verdict it keeps the verdict and sets the flag', async () => {
  const { db, env } = fixture();
  const ref = profileOf(db, 'chat@example.test').ref;
  await recordCapture(env, 'chat@example.test', 'chat');
  assert.equal(profileOf(db, 'chat@example.test').changed_after_review_at, null, 'no verdict, no flag');
  await quiet(() => verify(env, 'chat@example.test', { status: 'verified' }));
  await recordCapture(env, 'CHAT@example.test', 'chat');
  const row = profileOf(db, 'chat@example.test');
  assert.equal(row.admin_status, 'verified', 'the verdict stays');
  assert.match(row.changed_after_review_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(events(db, ref).map((e) => [e.kind, e.source]), [['captured', 'chat'], ['verified', null], ['captured', 'chat']]);
  // A rejection is a verdict too.
  await quiet(() => verify(env, 'inv@example.test', { status: 'rejected', reject_reason: REASON }));
  await recordCapture(env, 'inv@example.test', 'invitation');
  assert.ok(profileOf(db, 'inv@example.test').changed_after_review_at);
  await recordCapture(env, 'eadwyn@example.test', 'eadwyn');
  assert.deepEqual(events(db, profileOf(db, 'eadwyn@example.test').ref).map((e) => e.source), ['eadwyn']);
  // The next verdict clears it.
  await quiet(() => verify(env, 'chat@example.test', { status: 'verified' }));
  assert.equal(profileOf(db, 'chat@example.test').changed_after_review_at, null);
  // An address with no profile, or a failing store, never throws into the writer.
  await recordCapture(env, 'nobody@example.test', 'chat');
  await quiet(() => recordCapture(envOf(db, [/partner_profile_events/]), 'chat@example.test', 'chat'));
});

test('the three writers call the capture, each with its own source', () => {
  const src = (p: string) => read(`cloudflare-worker/src/${p}`);
  assert.match(src('routes/profiling.ts'), /recordCapture\(c\.env, email, 'chat'\)/);
  assert.match(src('routes/partner_onboarding.ts'), /recordCapture\(c\.env, gate\.inv\.recipient_email, 'invitation'\)/);
  assert.match(src('services/advisor/writeRouter.ts'), /recordCapture\(env, profile\.email, 'eadwyn'\)/);
});

// ---------------------------------------------------------------------------
// 6. The history read and the list row
// ---------------------------------------------------------------------------

test('the history read is newest first, names who decided, pages, and never carries an email', async () => {
  const { db, env } = fixture();
  const ref = profileOf(db, 'chat@example.test').ref;
  await recordCapture(env, 'chat@example.test', 'chat');
  await new Promise((r) => setTimeout(r, 3));
  await quiet(() => verify(env, 'chat@example.test', { status: 'rejected', reject_reason: REASON }));
  const h = await call(env, ADMIN, `/api/admin/partner-profiles/${ref}/history`);
  assert.equal(h.status, 200);
  assert.equal(h.body.total, 2);
  assert.deepEqual(h.body.items.map((i: any) => [i.kind, i.source, i.reason, i.by]), [
    ['rejected', null, REASON, { user_id: ADMIN, name: 'Ada Admin' }],
    ['captured', 'chat', null, null],
  ]);
  assert.doesNotMatch(JSON.stringify(h.body), /@/);
  const page = await call(env, ADMIN, `/api/admin/partner-profiles/${ref}/history?limit=1&offset=1`);
  assert.deepEqual([page.body.items.length, page.body.items[0].kind, page.body.limit], [1, 'captured', 1]);
  assert.equal((await call(env, ADMIN, `/api/admin/partner-profiles/${ref}/history?limit=5000`)).body.limit, 100);
  assert.equal((await call(env, MEMBER, `/api/admin/partner-profiles/${ref}/history`)).status, 403);
  assert.equal((await call(env, ADMIN, '/api/admin/partner-profiles/pp_ffffffffff/history')).status, 404);
  const bad = await quiet(() => call(envOf(db, [/FROM partner_profile_events/]), ADMIN, `/api/admin/partner-profiles/${ref}/history`));
  assert.equal(bad.status, 503);
  assert.equal(bad.body.error, 'partner_profile_history_unreadable');
  assert.equal('items' in bad.body, false, 'never an empty history');
});

test('the list row carries the review and the flag; the reviewed sort and the reviewed_by filter work', async () => {
  const { db, env } = fixture();
  await quiet(() => verify(env, 'inv@example.test', { status: 'verified' }));
  await new Promise((r) => setTimeout(r, 3));
  await quiet(() => verify(env, 'chat@example.test', { status: 'rejected', reject_reason: REASON }, OTHER_ADMIN));
  await recordCapture(env, 'chat@example.test', 'chat');
  // A verdict from before 557: no reviewer recorded.
  db.prepare("UPDATE partner_profiles SET admin_status = 'verified' WHERE email = 'eadwyn@example.test'").run();
  const list = await call(env, ADMIN, '/api/admin/partner-profiles?sort=reviewed');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const by = new Map(list.body.rows.map((r: any) => [r.email, r]));
  assert.deepEqual((by.get('chat@example.test') as any).reviewed_by, { user_id: OTHER_ADMIN, name: 'Otto Admin' });
  assert.ok((by.get('chat@example.test') as any).changed_after_review_at, 'PRF2\'s amber dot');
  assert.equal((by.get('inv@example.test') as any).changed_after_review_at, null);
  assert.equal((by.get('eadwyn@example.test') as any).reviewed_at, null, 'Not recorded, never a made-up date');
  assert.deepEqual(list.body.rows.map((r: any) => r.email), ['chat@example.test', 'inv@example.test', 'eadwyn@example.test'],
    'newest verdict first, unreviewed last');
  const mine = await call(env, ADMIN, `/api/admin/partner-profiles?reviewed_by=${ADMIN}`);
  assert.deepEqual(mine.body.rows.map((r: any) => r.email), ['inv@example.test']);
  const unknown = await call(env, ADMIN, '/api/admin/partner-profiles?reviewed_by=not_recorded');
  assert.deepEqual(unknown.body.rows.map((r: any) => r.email), ['eadwyn@example.test']);
  const one = await call(env, ADMIN, `/api/admin/partner-profiles/${profileOf(db, 'chat@example.test').ref}`);
  assert.equal(one.body.reject_reason, REASON, 'the admin reads the reason on the profile');
});
