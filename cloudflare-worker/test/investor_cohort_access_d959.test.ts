/**
 * D959 (#2792, Programs part 6) — Investor cohort access: the routes, mounted
 * as the Worker mounts them, over the baseline's tables and migration 564 as
 * written, on an in-memory SQLite.
 *
 * What it proves: the verified rule (O-VER A) on every list, write and read;
 * one open grant per pair, an earlier grant's dates kept; `already_active`
 * sends no notice; ending twice keeps the first end; a deactivated or no
 * longer verified investor reads nothing and is not offered; the investor's
 * read holds no founder email; a hidden founder is left out and cannot be
 * asked; a second hide keeps the first date; a founder decides an intro once;
 * the cohort NDA gates the read, is sent only from HQ's published template,
 * and is recorded once by the completion hook; grants past their last day
 * close and founders are told; the audit rows name the cohort, never a person.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_cohort_access_d959.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminInvestorCohorts from '../src/routes/admin_investor_cohorts.ts';
import investorCohorts from '../src/routes/investor_cohorts.ts';
import {
  VERIFIED_SQL, grantStateOf, isVerifiedInvestor, onCohortNdaEnvelopeCompleted, parseScope, syncInvestorCohortNotices, validEndDate,
} from '../src/services/investorCohortAccess.ts';
import { programActivity, PROGRAM_ACTIVITY_ACTIONS } from '../src/services/programActivity.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M564 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/564_investor_cohort_access.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1, INV = 10, INV2 = 11, UNVERIFIED = 12, F1 = 20, F2 = 21, F3 = 22, OTHER_FOUNDER = 30;
const CYCLE = 5, CYCLE2 = 6;
const FAR = '2099-12-31';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'investor_profiles', 'projects', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M564);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, kyc_status, founder_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 1, 'approved', null);
  u.run(INV, 'investor', 'Ivy Investor', 'ivy@example.test', 1, 'approved', null);
  u.run(INV2, 'investor', 'Ian Investor', 'ian@example.test', 1, 'approved', null);
  u.run(UNVERIFIED, 'investor', 'Una Unverified', 'una@example.test', 1, 'pending', null);
  u.run(F1, 'founder', 'Fay Founder', 'fay@example.test', 1, 'approved', 201);
  u.run(F2, 'founder', 'Finn Founder', 'finn@example.test', 1, 'approved', 202);
  u.run(F3, 'founder', 'Flo Founder', 'flo@example.test', 1, 'approved', 203);
  u.run(OTHER_FOUNDER, 'founder', 'Oz Other', 'oz@example.test', 1, 'approved', 204);
  db.exec(`INSERT INTO investor_profiles (user_id, firm_name) VALUES (${INV}, 'North Fund'), (${INV2}, 'South Fund')`);
  db.exec(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES
    (${CYCLE}, 2026, 10, '2026-10-01', '2026-12-31'), (${CYCLE2}, 2026, 11, '2026-11-01', '2027-01-31')`);
  const w = db.prepare('INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status, deliverables_done, deliverables_required) VALUES (?, ?, ?, ?, ?, ?)');
  w.run(F1, CYCLE, 1, 'passed', 3, 3);
  w.run(F1, CYCLE, 2, 'pending', 1, 4);
  w.run(F2, CYCLE, 1, 'passed', 2, 3);
  w.run(F3, CYCLE, 1, 'pending', 0, 3);
  w.run(OTHER_FOUNDER, CYCLE2, 1, 'pending', 0, 3);
  db.exec(`INSERT INTO projects (name, tagline, sector, stage, founder_id, contact_email, mrr) VALUES
    ('Kestrel Labs', 'Books closed in a day', 'fintech', 'mvp', 201, 'hello@kestrel.example.test', 12000),
    ('Osprey Works', NULL, 'climate', 'idea', 202, NULL, NULL)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/investor-cohorts', adminInvestorCohorts);
app.route('/api/investor-cohorts', investorCohorts);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any)?.role;
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error, console.info] = saved; }
}

const A = '/api/admin/investor-cohorts';
const M = '/api/investor-cohorts';
const give = (db: DatabaseSync, body: Record<string, unknown> = {}) =>
  call(db, ADMIN, 'POST', A, { investor_user_id: INV, cohort_cycle_id: CYCLE, ends_at: FAR, ...body });
const inbox = (db: DatabaseSync, userId?: number) =>
  (db.prepare(`SELECT user_id, title, body, payload FROM notifications_inbox ${userId ? 'WHERE user_id = ?' : ''} ORDER BY id`)
    .all(...(userId ? [userId] : [])) as any[]);
const signNda = (db: DatabaseSync, uid: string) => db.prepare("UPDATE investor_cohort_access SET nda_signed_at = datetime('now') WHERE uid = ?").run(uid);

// ---------------------------------------------------------------------------
// The rule and the helpers, alone
// ---------------------------------------------------------------------------

test('O-VER A: role investor, an active account and approved KYC; the SQL rule says the same at every site', () => {
  assert.equal(isVerifiedInvestor({ role: 'investor', is_active: 1, kyc_status: 'approved' }), true);
  assert.equal(isVerifiedInvestor({ role: 'Investor', is_active: 1, kyc_status: 'approved' }), true);
  for (const bad of [{ role: 'founder', is_active: 1, kyc_status: 'approved' }, { role: 'investor', is_active: 0, kyc_status: 'approved' },
    { role: 'investor', is_active: 1, kyc_status: 'pending' }, null]) assert.equal(isVerifiedInvestor(bad as any), false);
  // The rule is written out at each SQL site, never interpolated: each file carries it the times it is used.
  const count = (file: string) => readFileSync(resolve(ROOT, file), 'utf8').split(VERIFIED_SQL).length - 1;
  assert.equal(count('cloudflare-worker/src/services/investorCohortAccess.ts'), 3, 'the constant, the start sweep and the founder list');
  assert.equal(count('cloudflare-worker/src/routes/admin_investor_cohorts.ts'), 5, 'the grants list (twice), assignable, the two tiles (one shared text) and the hidden count');
});

test('the end date, the scope and the access state', () => {
  assert.equal(validEndDate('2026-10-26', '2026-10-26'), true, 'today is a last day');
  assert.equal(validEndDate('2026-10-25', '2026-10-26'), false);
  assert.equal(validEndDate('2026-02-30', '2026-01-01'), false);
  assert.deepEqual(parseScope(undefined), { ok: true, scope: ['summary', 'weekly_progress'] });
  assert.deepEqual(parseScope(['weekly_progress']), { ok: true, scope: ['weekly_progress'] });
  assert.deepEqual(parseScope(['summary', 'pitch_deck']), { ok: false, code: 'scope_unavailable', asked: ['pitch_deck'] });
  assert.equal((parseScope(['demo_day']) as any).code, 'scope_unavailable');
  assert.equal((parseScope(['email']) as any).code, 'invalid_scope');
  assert.equal((parseScope([]) as any).code, 'invalid_scope');
  const g = { ended_at: null, ends_at: '2026-12-31', nda_signed_at: '2026-10-20' };
  assert.equal(grantStateOf(g, true, '2026-10-26'), 'active');
  assert.equal(grantStateOf(g, false, '2026-10-26'), 'waits_for_verification');
  assert.equal(grantStateOf({ ...g, nda_signed_at: null }, true, '2026-10-26'), 'waits_for_nda');
  assert.equal(grantStateOf(g, true, '2027-01-01'), 'ended', 'past its last day');
  assert.equal(grantStateOf({ ...g, ended_at: '2026-10-21' }, true, '2026-10-26'), 'ended');
});

// ---------------------------------------------------------------------------
// The admin's routes
// ---------------------------------------------------------------------------

test('assignable lists verified investors only, by name or fund, paged with a total, and marks an open grant on a cycle', async () => {
  const db = fixture();
  try {
    let r = await call(db, ADMIN, 'GET', `${A}/assignable`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.items.map((x: any) => [x.id, x.firm]), [[INV2, 'South Fund'], [INV, 'North Fund']]);
    assert.equal(r.body.total, 2, 'the unverified investor is not offered');
    assert.ok(!JSON.stringify(r.body).includes('@'), 'no email');
    r = await call(db, ADMIN, 'GET', `${A}/assignable?q=north`);
    assert.deepEqual(r.body.items.map((x: any) => x.id), [INV], 'by fund');
    r = await call(db, ADMIN, 'GET', `${A}/assignable?q=a_b`);
    assert.equal(r.body.total, 0, 'the LIKE wildcard is escaped');
    assert.equal((await call(db, ADMIN, 'GET', `${A}/assignable?q=x`)).status, 400);
    await give(db);
    r = await call(db, ADMIN, 'GET', `${A}/assignable?cycle_id=${CYCLE}`);
    assert.deepEqual(r.body.items.map((x: any) => [x.id, x.has_open_grant]), [[INV2, false], [INV, true]]);
    r = await call(db, ADMIN, 'GET', `${A}/assignable?limit=1&offset=1`);
    assert.deepEqual([r.body.items.map((x: any) => x.id), r.body.total], [[INV], 2]);
    // A deactivated investor is not offered.
    db.exec(`UPDATE users SET is_active = 0 WHERE id = ${INV2}`);
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}/assignable`)).body.items.map((x: any) => x.id), [INV]);
    assert.equal((await call(db, INV, 'GET', `${A}/assignable`)).status, 403, 'admins only');
  } finally { db.close(); }
});

test('give: one open grant per pair; already_active writes and sends nothing; founders are told once; the audit names the cohort', async () => {
  const db = fixture();
  try {
    const r = await give(db, { note: '  For the Q4 round  ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const g = r.body.grant;
    assert.deepEqual([g.investor.id, g.cohort.id, g.cohort.label, g.state, g.nda_state, g.scope, g.note, g.ends_at, g.verified_now],
      [INV, CYCLE, 'October 2026 cohort', 'waits_for_nda', 'not_sent', ['summary', 'weekly_progress'], 'For the Q4 round', FAR, true]);
    assert.equal(r.body.founders_notified, 3, 'every founder in the cohort');
    assert.equal(r.body.nda_template, 'missing', 'no cohort NDA template is published');
    const told = inbox(db);
    assert.deepEqual(told.map((n) => n.user_id).sort(), [F1, F2, F3]);
    assert.match(told[0].title, /Ivy Investor \(North Fund\) can see your venture/);
    assert.match(told[0].body, /never your email address/);
    // Again: refused, no second row, no second notice.
    const again = await give(db);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_active');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM investor_cohort_access').get() as any).n, 1);
    assert.equal(inbox(db).length, 3, 'already_active sends nothing');
    const audit = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'investor_cohort.%'").all() as any[];
    assert.deepEqual(audit.map((a) => a.action), ['investor_cohort.granted']);
    assert.equal(JSON.parse(audit[0].filters_json).cohort_cycle_id, CYCLE);
  } finally { db.close(); }
});

test('give: the refusals', async () => {
  const db = fixture();
  try {
    const code = async (body: Record<string, unknown>) => { const r = await give(db, body); return [r.status, r.body.error]; };
    assert.deepEqual(await code({ investor_user_id: 'ten' }), [400, 'invalid_ids']);
    assert.deepEqual(await code({ cohort_cycle_id: 1.5 }), [400, 'invalid_ids']);
    assert.deepEqual(await code({ investor_user_id: 999 }), [404, 'user_not_found']);
    assert.deepEqual(await code({ investor_user_id: UNVERIFIED }), [400, 'not_verified']);
    assert.deepEqual(await code({ investor_user_id: F1 }), [400, 'not_verified'], 'a founder is not an investor');
    assert.deepEqual(await code({ cohort_cycle_id: 999 }), [404, 'cycle_not_found']);
    assert.deepEqual(await code({ ends_at: '2020-01-01' }), [400, 'invalid_end_date']);
    assert.deepEqual(await code({ ends_at: 'soon' }), [400, 'invalid_end_date']);
    assert.deepEqual(await code({ scope: ['summary', 'pitch_deck'] }), [400, 'scope_unavailable']);
    assert.deepEqual(await code({ scope: ['demo_day'] }), [400, 'scope_unavailable']);
    assert.deepEqual(await code({ note: 'x'.repeat(1001) }), [400, 'note_too_long']);
    db.exec(`UPDATE users SET is_active = 0 WHERE id = ${INV}`);
    assert.deepEqual(await code({}), [400, 'not_verified'], 'a deactivated investor');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM investor_cohort_access').get() as any).n, 0);
    assert.equal((await call(db, INV2, 'POST', A, { investor_user_id: INV2, cohort_cycle_id: CYCLE, ends_at: FAR })).status, 403, 'admins only');
  } finally { db.close(); }
});

test('end: records who and when; ending twice keeps the first end; a new grant is a new row and the earlier keeps its dates', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    const r = await call(db, ADMIN, 'POST', `${A}/${uid}/end`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.grant.state, r.body.grant.end_reason, r.body.founders_notified], ['ended', 'admin', 3]);
    const first = (db.prepare('SELECT ended_at, ended_by_admin_id FROM investor_cohort_access WHERE uid = ?').get(uid) as any);
    assert.equal(first.ended_by_admin_id, ADMIN);
    db.prepare("UPDATE investor_cohort_access SET ended_at = '2026-10-01 09:00:00' WHERE uid = ?").run(uid);
    const twice = await call(db, ADMIN, 'POST', `${A}/${uid}/end`);
    assert.deepEqual([twice.status, twice.body.error], [409, 'already_ended']);
    assert.equal((db.prepare('SELECT ended_at FROM investor_cohort_access WHERE uid = ?').get(uid) as any).ended_at, '2026-10-01 09:00:00', 'the first end is kept');
    assert.equal(inbox(db).filter((n) => /no longer/.test(n.title)).length, 3, 'one end notice per founder, not two');
    // Given again: a second row; the first keeps its grant and end dates.
    const again = await give(db);
    assert.equal(again.status, 201);
    assert.notEqual(again.body.grant.uid, uid);
    const rows = db.prepare('SELECT uid, ended_at FROM investor_cohort_access ORDER BY id').all() as any[];
    assert.deepEqual(rows.map((x) => [x.uid, x.ended_at]), [[uid, '2026-10-01 09:00:00'], [again.body.grant.uid, null]]);
    assert.equal(inbox(db).filter((n) => /can see your venture/.test(n.title)).length, 6, 'the new grant tells each founder again');
    assert.deepEqual([(await call(db, ADMIN, 'POST', `${A}/nope/end`)).status], [404]);
    // An open grant past its last day closes first, so it never blocks a new one.
    db.prepare("UPDATE investor_cohort_access SET ends_at = '2020-01-01' WHERE uid = ?").run(again.body.grant.uid);
    const third = await give(db);
    assert.equal(third.status, 201, JSON.stringify(third.body));
    assert.equal((db.prepare('SELECT end_reason FROM investor_cohort_access WHERE uid = ?').get(again.body.grant.uid) as any).end_reason, 'expired');
  } finally { db.close(); }
});

test('a suspended branch refuses each of the three writes with 423, and still reads', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    db.exec("CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT NOT NULL); INSERT INTO branch_licence (id, status) VALUES (1, 'suspended')");
    const fr = { BRANCH_CODE: 'fr' };
    const statuses = [
      (await call(db, ADMIN, 'POST', A, { investor_user_id: INV2, cohort_cycle_id: CYCLE, ends_at: FAR }, fr)).status,
      (await call(db, ADMIN, 'POST', `${A}/${uid}/end`, undefined, fr)).status,
      (await call(db, ADMIN, 'POST', `${A}/${uid}/nda`, undefined, fr)).status,
    ];
    assert.deepEqual(statuses, [423, 423, 423]);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM investor_cohort_access WHERE ended_at IS NULL').get() as any).n, 1, 'nothing written');
    assert.equal((await call(db, ADMIN, 'GET', A, undefined, fr)).status, 200, 'a read is never frozen');
  } finally { db.close(); }
});

test('the grants list: state, NDA state, intro counts, filters, search and paging; the summary tiles', async () => {
  const db = fixture();
  try {
    const a = (await give(db)).body.grant.uid;
    const b = (await give(db, { investor_user_id: INV2, cohort_cycle_id: CYCLE2 })).body.grant.uid;
    signNda(db, a);
    // INV2 stops being verified: the grant stays and waits.
    db.exec(`UPDATE users SET kyc_status = 'rejected' WHERE id = ${INV2}`);
    let r = await call(db, ADMIN, 'GET', A);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.items.map((x: any) => [x.uid, x]));
    assert.deepEqual([by[a].state, by[a].nda_state, by[a].verified_now], ['active', 'signed', true]);
    assert.deepEqual([by[b].state, by[b].nda_state, by[b].verified_now], ['waits_for_verification', 'not_sent', false]);
    assert.equal(r.body.total, 2);
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}?state=active`)).body.items.map((x: any) => x.uid), [a]);
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}?nda=not_sent`)).body.items.map((x: any) => x.uid), [b]);
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}?cycle_id=${CYCLE2}`)).body.items.map((x: any) => x.uid), [b]);
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}?q=south`)).body.items.map((x: any) => x.uid), [b], 'by fund');
    assert.deepEqual((await call(db, ADMIN, 'GET', `${A}?q=ivy`)).body.items.map((x: any) => x.uid), [a], 'by investor');
    r = await call(db, ADMIN, 'GET', `${A}?limit=1&offset=1`);
    assert.deepEqual([r.body.items.length, r.body.total], [1, 2]);
    assert.equal((await call(db, ADMIN, 'GET', `${A}?state=open`)).status, 400);
    assert.equal((await call(db, ADMIN, 'GET', `${A}?limit=101`)).status, 400);
    // An intro, then the counts and the tiles.
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F1 })).status, 201);
    const intro = (db.prepare('SELECT uid FROM investor_cohort_intro_requests').get() as any).uid;
    assert.equal((await call(db, F1, 'POST', `${M}/founder/intros/${intro}/decide`, { accepted: true })).status, 200);
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F3 })).status, 201);
    const declined = (db.prepare('SELECT uid FROM investor_cohort_intro_requests WHERE founder_user_id = ?').get(F3) as any).uid;
    assert.equal((await call(db, F3, 'POST', `${M}/founder/intros/${declined}/decide`, { accepted: false })).status, 200);
    await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: false });
    // A founder of another cohort who hid from INV (after an earlier grant there) is not counted against this one.
    const elsewhere = (await give(db, { cohort_cycle_id: CYCLE2 })).body.grant.uid;
    await call(db, ADMIN, 'POST', `${A}/${elsewhere}/end`);
    assert.equal((await call(db, OTHER_FOUNDER, 'PUT', `${M}/founder/access/${INV}`, { visible: false })).status, 200);
    r = await call(db, ADMIN, 'GET', `${A}?state=active`);
    assert.deepEqual([r.body.items[0].intro_requests, r.body.items[0].intros_accepted], [2, 1]);
    const s = await call(db, ADMIN, 'GET', `${A}/summary`);
    assert.deepEqual(s.body, {
      investors_with_access: 1, cohorts_open: 1, founders_hidden: 1,
      intro_requests: 2, intros_accepted: 1, intros_pending: 0, nda_template: 'missing',
    }, 'the unverified holder is not counted; a hidden founder is a count, never a name');
    assert.equal((await call(db, INV, 'GET', `${A}/summary`)).status, 403);
  } finally { db.close(); }
});

test('the cohort NDA: refused while no template is published; sent from it once published; the completion hook records the signature once', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    let r = await call(db, ADMIN, 'POST', `${A}/${uid}/nda`);
    assert.deepEqual([r.status, r.body.error], [409, 'nda_template_missing']);
    assert.equal((db.prepare('SELECT nda_envelope_uuid FROM investor_cohort_access').get() as any).nda_envelope_uuid, null);
    // HQ publishes the template (its wording here is a test stand-in, not the NDA).
    db.prepare(`INSERT INTO legal_templates (slug, title, body_md, category, is_active, is_stub) VALUES (?, ?, ?, 'compliance', 1, 0)`)
      .run('investor_cohort_nda_v1', 'Cohort NDA', 'TEST STAND-IN. {{investor_name}} of {{firm_name}} reads the {{cohort}} until {{ends_at}}.');
    r = await call(db, ADMIN, 'POST', `${A}/${uid}/nda`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.grant.nda_state, 'sent');
    const env = db.prepare('SELECT envelope_uuid, document_type, document_body FROM esign_envelopes').get() as any;
    assert.equal(env.document_type, 'investor_cohort_nda');
    assert.equal(env.document_body, `TEST STAND-IN. Ivy Investor of North Fund reads the October 2026 cohort until ${FAR}.`);
    assert.equal(r.body.envelope.uuid, env.envelope_uuid);
    const twice = await call(db, ADMIN, 'POST', `${A}/${uid}/nda`);
    assert.deepEqual([twice.status, twice.body.error], [409, 'already_sent']);
    // Signed: the grant records it once.
    assert.deepEqual(await onCohortNdaEnvelopeCompleted({ DB: d1Over(db) } as any, env.envelope_uuid), { changed: true });
    db.prepare("UPDATE investor_cohort_access SET nda_signed_at = '2026-10-20 10:00:00' WHERE uid = ?").run(uid);
    assert.deepEqual(await onCohortNdaEnvelopeCompleted({ DB: d1Over(db) } as any, env.envelope_uuid), { changed: false });
    assert.equal((db.prepare('SELECT nda_signed_at FROM investor_cohort_access').get() as any).nda_signed_at, '2026-10-20 10:00:00', 'a second completion changes nothing');
    assert.deepEqual([(await call(db, ADMIN, 'POST', `${A}/${uid}/nda`)).body.error], ['already_signed']);
    assert.deepEqual(db.prepare("SELECT action FROM admin_audit_log WHERE action LIKE 'investor_cohort.%' ORDER BY id").all().map((a: any) => a.action),
      ['investor_cohort.granted', 'investor_cohort.nda_sent']);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// The investor's read
// ---------------------------------------------------------------------------

test('the investor reads summary and weekly progress after the NDA, with no founder email; every read checks verified, assigned and signed', async () => {
  const db = fixture();
  try {
    const path = `${M}/me/${CYCLE}/ventures`;
    assert.deepEqual([(await call(db, INV, 'GET', path)).body.error], ['not_assigned']);
    const uid = (await give(db)).body.grant.uid;
    assert.deepEqual([(await call(db, INV, 'GET', path)).body.error], ['nda_required']);
    signNda(db, uid);
    const r = await call(db, INV, 'GET', path);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.cohort, { id: CYCLE, label: 'October 2026 cohort' });
    const fay = r.body.ventures.find((v: any) => v.founder_user_id === F1);
    assert.deepEqual(fay.venture, { name: 'Kestrel Labs', tagline: 'Books closed in a day', sector: 'fintech', stage: 'mvp' });
    assert.deepEqual(fay.weeks, [
      { week: 1, status: 'passed', deliverables_done: 3, deliverables_required: 3 },
      { week: 2, status: 'pending', deliverables_done: 1, deliverables_required: 4 },
    ]);
    assert.equal(r.body.ventures.find((v: any) => v.founder_user_id === F3).venture, null, 'no venture recorded is null, not invented');
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes('@'), 'no email address of any kind');
    assert.ok(!text.includes('12000'), 'no figure beyond the summary');
    assert.ok(!r.body.ventures.some((v: any) => v.founder_user_id === OTHER_FOUNDER), 'only this cohort');
    // Every read checks again.
    db.exec(`UPDATE users SET kyc_status = 'pending' WHERE id = ${INV}`);
    assert.deepEqual([(await call(db, INV, 'GET', path)).status, (await call(db, INV, 'GET', path)).body.error], [403, 'not_verified']);
    assert.equal((await call(db, INV, 'GET', `${M}/me`)).body.error, 'not_verified');
    db.exec(`UPDATE users SET kyc_status = 'approved', is_active = 0 WHERE id = ${INV}`);
    assert.equal((await call(db, INV, 'GET', path)).status, 401, 'a deactivated account is refused at sign-in, so reads nothing');
    db.exec(`UPDATE users SET is_active = 1 WHERE id = ${INV}`);
    db.prepare("UPDATE investor_cohort_access SET ends_at = '2020-01-01' WHERE uid = ?").run(uid);
    assert.equal((await call(db, INV, 'GET', path)).body.error, 'not_assigned', 'past its last day');
    assert.equal((await call(db, INV2, 'GET', path)).body.error, 'not_assigned');
    assert.equal((await call(db, F1, 'GET', path)).body.error, 'not_verified', 'a founder is not an investor');
  } finally { db.close(); }
});

test('the scope decides what the read holds; /me lists open grants with their state', async () => {
  const db = fixture();
  try {
    const uid = (await give(db, { scope: ['weekly_progress'] })).body.grant.uid;
    let me = await call(db, INV, 'GET', `${M}/me`);
    assert.deepEqual(me.body.items.map((x: any) => [x.uid, x.state, x.nda_state, x.scope]), [[uid, 'waits_for_nda', 'not_sent', ['weekly_progress']]]);
    signNda(db, uid);
    const r = await call(db, INV, 'GET', `${M}/me/${CYCLE}/ventures`);
    assert.deepEqual(r.body.scope, ['weekly_progress']);
    assert.ok(r.body.ventures.every((v: any) => !('venture' in v) && Array.isArray(v.weeks)), 'no summary when the scope leaves it out');
    me = await call(db, INV, 'GET', `${M}/me`);
    assert.equal(me.body.items[0].state, 'active');
    db.prepare("UPDATE investor_cohort_access SET ends_at = '2020-01-01' WHERE uid = ?").run(uid);
    assert.deepEqual((await call(db, INV, 'GET', `${M}/me`)).body.items, [], 'a grant past its last day is not listed');
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// The founder: told, hiding, and intros
// ---------------------------------------------------------------------------

test('a hidden founder is left out and cannot be asked; a second hide keeps the first date; showing again tells them', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    signNda(db, uid);
    let r = await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items[0].can_see, false);
    const first = (db.prepare('SELECT opted_out_at FROM investor_cohort_optouts').get() as any).opted_out_at;
    db.prepare("UPDATE investor_cohort_optouts SET opted_out_at = '2026-10-01 08:00:00'").run();
    await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: false });
    assert.deepEqual(db.prepare('SELECT opted_out_at, withdrawn_at FROM investor_cohort_optouts').all().map((x: any) => [x.opted_out_at, x.withdrawn_at]),
      [['2026-10-01 08:00:00', null]], 'hiding again keeps the first hide');
    assert.ok(first);
    r = await call(db, INV, 'GET', `${M}/me/${CYCLE}/ventures`);
    assert.ok(!r.body.ventures.some((v: any) => v.founder_user_id === F2), 'left out of the read');
    const ask = await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F2 });
    assert.deepEqual([ask.status, ask.body.error], [404, 'founder_not_in_cohort']);
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: OTHER_FOUNDER })).body.error, 'founder_not_in_cohort');
    // Shown again: a new hide later is a new row; the old row keeps its dates.
    await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: true });
    r = await call(db, INV, 'GET', `${M}/me/${CYCLE}/ventures`);
    assert.ok(r.body.ventures.some((v: any) => v.founder_user_id === F2));
    await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: false });
    const rows = db.prepare('SELECT opted_out_at, withdrawn_at FROM investor_cohort_optouts ORDER BY id').all() as any[];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].opted_out_at, '2026-10-01 08:00:00');
    assert.ok(rows[0].withdrawn_at);
    assert.equal((await call(db, F2, 'PUT', `${M}/founder/access/${INV2}`, { visible: false })).status, 404, 'an investor with no grant on their cohort');
    assert.equal((await call(db, F2, 'PUT', `${M}/founder/access/${INV}`, { visible: 'no' })).status, 400);
  } finally { db.close(); }
});

test('a founder hidden before the grant is never told it started; one who shows again is told then', async () => {
  const db = fixture();
  try {
    // A grant ended earlier makes INV known to the founder's cohort, so the hide is accepted.
    const old = (await give(db)).body.grant.uid;
    await call(db, ADMIN, 'POST', `${A}/${old}/end`);
    await call(db, F3, 'PUT', `${M}/founder/access/${INV}`, { visible: false });
    const before = inbox(db, F3).length;
    await give(db);
    assert.equal(inbox(db, F3).length, before, 'hidden: no start notice');
    await call(db, F3, 'PUT', `${M}/founder/access/${INV}`, { visible: true });
    assert.equal(inbox(db, F3).length, before + 1);
  } finally { db.close(); }
});

test('intro requests: the founder is told, decides once, and sees the investor email only after accepting; the investor never gets the founder email', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F1 })).body.error, 'nda_required');
    signNda(db, uid);
    const ask = await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F1, message: 'Keen to talk about the Q4 round.' });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.equal(ask.body.intro.state, 'pending');
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F1 })).body.error, 'already_requested');
    assert.match(inbox(db, F1).at(-1).title, /Ivy Investor \(North Fund\) asks for an introduction/);
    let list = await call(db, F1, 'GET', `${M}/founder/intros`);
    assert.deepEqual([list.body.items[0].state, list.body.items[0].investor.email, list.body.items[0].message], ['pending', null, 'Keen to talk about the Q4 round.']);
    const d = await call(db, F1, 'POST', `${M}/founder/intros/${ask.body.intro.uid}/decide`, { accepted: true });
    assert.deepEqual([d.status, d.body.intro.state], [200, 'accepted']);
    const again = await call(db, F1, 'POST', `${M}/founder/intros/${ask.body.intro.uid}/decide`, { accepted: false });
    assert.deepEqual([again.status, again.body.error], [409, 'already_decided']);
    assert.equal((db.prepare('SELECT decision FROM investor_cohort_intro_requests').get() as any).decision, 'accepted', 'decided once');
    list = await call(db, F1, 'GET', `${M}/founder/intros`);
    assert.equal(list.body.items[0].investor.email, 'ivy@example.test', 'the founder writes first');
    const told = inbox(db, INV).at(-1);
    assert.match(told.title, /Fay Founder accepted your introduction request/);
    assert.ok(!JSON.stringify(inbox(db, INV)).includes('fay@example.test'), 'never the founder email');
    const read = await call(db, INV, 'GET', `${M}/me/${CYCLE}/ventures`);
    assert.deepEqual(read.body.ventures.find((v: any) => v.founder_user_id === F1).intro.state, 'accepted');
    assert.ok(!JSON.stringify(read.body).includes('@'));
    assert.equal((await call(db, F2, 'POST', `${M}/founder/intros/${ask.body.intro.uid}/decide`, { accepted: true })).status, 404, 'only the founder asked');
    assert.equal((await call(db, INV, 'POST', `${M}/me/${CYCLE}/intros`, { founder_user_id: F2, message: 'x'.repeat(1001) })).body.error, 'message_too_long');
  } finally { db.close(); }
});

test('the sweep: a grant past its last day closes as expired and its founders are told; a no longer verified investor gets no start notice', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    db.prepare("UPDATE investor_cohort_access SET ends_at = '2026-10-10' WHERE uid = ?").run(uid);
    const env = { DB: d1Over(db) } as any;
    const saved = console.warn; console.warn = () => {};
    try {
      const r = await syncInvestorCohortNotices(env, { today: '2026-10-11' });
      assert.deepEqual(r, { started: 0, ended: 3, expired: 1 });
      assert.deepEqual({ ...(db.prepare('SELECT ended_at, end_reason FROM investor_cohort_access').get() as any) }, { ended_at: '2026-10-11 00:00:00', end_reason: 'expired' });
      assert.deepEqual(await syncInvestorCohortNotices(env, { today: '2026-10-12' }), { started: 0, ended: 0, expired: 0 }, 'idempotent');
      // A verified-then-not investor: the grant opens no start notice.
      db.exec(`UPDATE users SET kyc_status = 'pending' WHERE id = ${INV2}`);
      db.exec(`INSERT INTO investor_cohort_access (uid, investor_user_id, cohort_cycle_id, ends_at) VALUES ('g2', ${INV2}, ${CYCLE}, '${FAR}')`);
      assert.equal((await syncInvestorCohortNotices(env, { today: '2026-10-12' })).started, 0);
      db.exec(`UPDATE users SET kyc_status = 'approved' WHERE id = ${INV2}`);
      assert.equal((await syncInvestorCohortNotices(env, { today: '2026-10-12' })).started, 3, 'verified again: told then');
    } finally { console.warn = saved; }
  } finally { db.close(); }
});

test('the sweep works through a small limit: notices already sent never fill the window', async () => {
  const db = fixture();
  try {
    db.exec(`INSERT INTO investor_cohort_access (uid, investor_user_id, cohort_cycle_id, ends_at) VALUES ('g1', ${INV}, ${CYCLE}, '${FAR}')`);
    const env = { DB: d1Over(db) } as any;
    const runs = [];
    for (let i = 0; i < 4; i += 1) runs.push((await syncInvestorCohortNotices(env, { limit: 1, today: '2026-10-12' })).started);
    assert.deepEqual(runs, [1, 1, 1, 0], 'one founder a pass, each told once');
    assert.deepEqual(inbox(db).map((n) => n.user_id), [F1, F2, F3]);
    db.exec("UPDATE investor_cohort_access SET ended_at = '2026-10-12 09:00:00', end_reason = 'admin'");
    const ends = [];
    for (let i = 0; i < 4; i += 1) ends.push((await syncInvestorCohortNotices(env, { limit: 1, today: '2026-10-12' })).ended);
    assert.deepEqual(ends, [1, 1, 1, 0], 'the same for the end notices');
  } finally { db.close(); }
});

test('the founder list says who can see them, with the investor and fund', async () => {
  const db = fixture();
  try {
    const uid = (await give(db)).body.grant.uid;
    let r = await call(db, F1, 'GET', `${M}/founder/access`);
    assert.deepEqual(r.body.items.map((x: any) => [x.investor_user_id, x.firm, x.cohort_label, x.can_see]), [[INV, 'North Fund', 'October 2026 cohort', false]], 'not before the NDA');
    signNda(db, uid);
    r = await call(db, F1, 'GET', `${M}/founder/access`);
    assert.equal(r.body.items[0].can_see, true);
    assert.deepEqual((await call(db, OTHER_FOUNDER, 'GET', `${M}/founder/access`)).body.items, [], 'another cohort sees none');
  } finally { db.close(); }
});

test("Programs' Activity lists the three writes under Investor cohorts, naming the cohort and never the investor", async () => {
  const db = fixture();
  try {
    assert.deepEqual([...PROGRAM_ACTIVITY_ACTIONS['investor-cohorts']], ['investor_cohort.granted', 'investor_cohort.ended', 'investor_cohort.nda_sent']);
    db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY)');
    const uid = (await give(db)).body.grant.uid;
    await call(db, ADMIN, 'POST', `${A}/${uid}/end`);
    const act = await programActivity({ DB: d1Over(db) } as any, 'investor-cohorts', { id: ADMIN, superAdmin: true }, { before: null, limit: 10 });
    assert.deepEqual(act.rows.map((r: any) => [r.kind, r.by, r.concerns]), [
      ['investor_cohort.ended', 'admin', { cohort_cycle_id: CYCLE }],
      ['investor_cohort.granted', 'admin', { cohort_cycle_id: CYCLE }],
    ]);
  } finally { db.close(); }
});
