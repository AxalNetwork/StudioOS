/**
 * D960 (#2793) — Programs part 7: mentor cohort access fixes, and Lab reads
 * that report a failure.
 *
 * The real advisors and admin routers on node:sqlite over the baseline's own
 * tables, with migrations 367 and 565 run as written:
 *
 *   1. THE GATES. The four /admin/cohort-assignments routes are `requireAdmin`:
 *      a non-admin keeps its 403 body; a frozen admin may read but not assign or
 *      end (423 admin_frozen); a suspended branch refuses both writes (423
 *      branch_suspended).
 *   2. ACCOUNT STATE. A deactivated advisor is left out of the picker, flagged
 *      on the list, and refused by the POST (400 account_inactive).
 *   3. HISTORY (565). A re-assign keeps both episodes; a second DELETE is 409
 *      already_ended and moves nothing; a re-post of an open pair is 409
 *      already_assigned and writes nothing; the backfill recovers what the
 *      stores still hold.
 *   4. AUDIT. Assign and end each write one admin audit row.
 *   5. HIDDEN COUNTS, counts only: a founder hidden from two mentors counts
 *      once in the total.
 *   6. founders_notified is null when the notice sweep fails.
 *   7. THE LAB READS answer 503 on a D1 failure, count applications uncapped,
 *      and say when an inner read failed or the list was cut.
 *
 * Every name and address here is invented. A refusal written through `refuse`
 * carries its code in `error`; the two auth refusals carry `code`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mentor_access_d960.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import advisors from '../src/routes/advisors.ts';
import admin from '../src/routes/admin.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const M367 = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const M565 = read('cloudflare-worker/sql/migrations/565_advisor_cohort_assignment_events.sql');
const noComments = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, '');
const JWT_SECRET = 'unit-test-jwt-secret-d960-0123456789-abcdef';

const ADMIN = 1; const FROZEN = 2; const FOUNDER_USER = 3;
const AVA = 10; const ALF = 11; const OFF = 12; // OFF: an advisor whose account is deactivated
const FAY = 20; const FIN = 21; const FLO = 22;
const CYCLE = 1; const OTHER = 2;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function sqliteCall(sql: string, binds: any[]) {
  // D1 treats `?1` as one parameter however often it appears; node:sqlite does not.
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return { sql: values.length ? rewritten : sql, values: values.length ? values : binds };
}
/** A D1 over node:sqlite; a statement whose SQL matches one of `failing` throws, as a D1 failure would. */
function makeD1(db: InstanceType<typeof DatabaseSync>, failing: RegExp[] = []) {
  const check = (sql: string) => { for (const f of failing) if (f.test(sql)) throw new Error('D1_ERROR: synthetic failure'); };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { check(sql); const q = sqliteCall(sql, b); return db.prepare(q.sql).get(...q.values) ?? null; },
        async all() { check(sql); const q = sqliteCall(sql, b); return { results: db.prepare(q.sql).all(...q.values) }; },
        async run() {
          check(sql);
          const q = sqliteCall(sql, b);
          const r = db.prepare(q.sql).run(...q.values);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'advisor_cohort_assignments', 'notifications_inbox',
    'user_settings', 'week_windows', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(noComments(M367));
  db.exec(noComments(M565));
  // The advisor profiles the picker joins (t13_t14_t15.sql); none here has one.
  db.exec('CREATE TABLE advisors (id INTEGER PRIMARY KEY, user_id INTEGER)');
  db.exec(`CREATE TABLE admin_notices (id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, subject TEXT, respond_by TEXT, status TEXT)`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(ADMIN, 'ada@example.test', 'Ada Admin', 'admin', 1);
  u.run(FROZEN, 'fred@example.test', 'Fred Frozen', 'admin', 1);
  u.run(FOUNDER_USER, 'nia@example.test', 'Nia Founder', 'founder', 1);
  u.run(AVA, 'ava@example.test', 'Ava Advisor', 'advisor', 1);
  u.run(ALF, 'alf@example.test', 'Alf Advisor', 'advisor', 1);
  u.run(OFF, 'otto@example.test', 'Otto Offline', 'advisor', 0);
  for (const [id, n] of [[FAY, 'Fay'], [FIN, 'Fin'], [FLO, 'Flo']] as const) u.run(id, `${n.toLowerCase()}@example.test`, `${n} Founder`, 'founder', 1);
  // Fred has an overdue compliance notice: frozen until he answers it (D135).
  db.prepare(`INSERT INTO admin_notices (uid, user_id, subject, respond_by, status) VALUES ('n1', ?, 'Licence review', '2026-01-01', 'overdue')`).run(FROZEN);
  const c = db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES (?, ?, ?, ?, ?)');
  c.run(CYCLE, 2026, 9, '2026-09-01', '2026-11-30');
  c.run(OTHER, 2026, 10, '2026-10-01', '2026-12-31');
  const w = db.prepare('INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, ?, ?)');
  for (const f of [FAY, FIN]) w.run(f, CYCLE, 1, 'done');
  w.run(FLO, OTHER, 1, 'pending');
  return db;
}

type Env = Record<string, unknown>;
const envOf = (db: InstanceType<typeof DatabaseSync>, extra: Env = {}, failing: RegExp[] = []) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failing), ...extra } as any);

const app = new Hono<any>().route('/api/advisors', advisors).route('/api/admin', admin);
app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

async function call(env: any, userId: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const A = '/api/advisors/admin/cohort-assignments';
const assign = (env: any, who: number, advisor: number, cycle: number, note?: string) =>
  call(env, who, A, { method: 'POST', body: { advisor_user_id: advisor, cohort_cycle_id: cycle, note } });
const end = (env: any, who: number, id: number) => call(env, who, `${A}/${id}`, { method: 'DELETE' });
const events = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note FROM advisor_cohort_assignment_events ORDER BY id').all() as any[];
const started = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM cohort_advisor_notices WHERE kind = 'started'`).get() as any).n;

// ---------------------------------------------------------------------------
// 1. The gates
// ---------------------------------------------------------------------------

test('a non-admin keeps its 403 body on all four routes', async () => {
  const env = envOf(freshDb());
  for (const r of [
    await call(env, FOUNDER_USER, A), await call(env, FOUNDER_USER, `${A}/assignable`),
    await assign(env, FOUNDER_USER, AVA, CYCLE), await end(env, FOUNDER_USER, 1),
    await call(env, FOUNDER_USER, `${A}/history`),
  ]) {
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { detail: 'Admin required' });
  }
});

test('a frozen admin reads the lists but cannot assign or end: 423 admin_frozen, and nothing is written', async () => {
  const db = freshDb();
  const env = envOf(db);
  const ok = await assign(env, ADMIN, AVA, CYCLE);
  assert.equal(ok.status, 200);
  assert.equal((await call(env, FROZEN, A)).status, 200, 'the freeze never gates a read');
  assert.equal((await call(env, FROZEN, `${A}/assignable`)).status, 200);
  assert.equal((await call(env, FROZEN, `${A}/history`)).status, 200);
  const a = await assign(env, FROZEN, ALF, CYCLE);
  assert.equal(a.status, 423);
  assert.equal(a.body.code, 'admin_frozen');
  const d = await end(env, FROZEN, ok.body.id);
  assert.equal(d.status, 423);
  assert.equal(d.body.code, 'admin_frozen');
  assert.equal(events(db).length, 1, 'only the unfrozen admin\'s grant');
  assert.equal((db.prepare('SELECT is_active FROM advisor_cohort_assignments WHERE id = ?').get(ok.body.id) as any).is_active, 1);
});

test('a suspended branch refuses assign and end with 423 branch_suspended, and still serves the reads', async () => {
  const db = freshDb();
  db.exec(`CREATE TABLE branch_licence (id INTEGER PRIMARY KEY, status TEXT NOT NULL, suspended_at TEXT, suspended_note TEXT)`);
  db.exec(`INSERT INTO branch_licence (id, status) VALUES (1, 'active')`);
  const branch = { BRANCH_CODE: 'fr', APP_URL: 'https://fr.example.test', PUBLIC_BASE_URL: 'https://fr.example.test' };
  const env = envOf(db, branch);
  const ok = await assign(env, ADMIN, AVA, CYCLE);
  assert.equal(ok.status, 200, 'an active branch assigns');
  db.exec(`UPDATE branch_licence SET status = 'suspended'`);
  const a = await assign(env, ADMIN, ALF, CYCLE);
  assert.equal(a.status, 423);
  assert.equal(a.body.code, 'branch_suspended');
  const d = await end(env, ADMIN, ok.body.id);
  assert.equal(d.status, 423);
  assert.equal(d.body.code, 'branch_suspended');
  assert.equal((await call(env, ADMIN, A)).status, 200);
  assert.equal(events(db).length, 1);
});

// ---------------------------------------------------------------------------
// 2. Account state
// ---------------------------------------------------------------------------

test('a deactivated advisor is left out of the picker, flagged on the list, and refused by the POST', async () => {
  const db = freshDb();
  const env = envOf(db);
  const picker = await call(env, ADMIN, `${A}/assignable`);
  assert.deepEqual(picker.body.items.map((r: any) => r.id).sort(), [AVA, ALF].sort());
  const r = await assign(env, ADMIN, OFF, CYCLE);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'account_inactive');
  assert.equal(events(db).length, 0);
  // An assignment made while the account was on, then the account is switched off.
  await assign(env, ADMIN, AVA, CYCLE);
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(AVA);
  const list = await call(env, ADMIN, A);
  assert.equal(list.body.items[0].advisor_is_active, false);
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(AVA);
  assert.equal((await call(env, ADMIN, A)).body.items[0].advisor_is_active, true);
});

// ---------------------------------------------------------------------------
// 3. History, and the two 409s
// ---------------------------------------------------------------------------

test('a re-assign keeps both episodes, and the history read names no admin', async () => {
  const db = freshDb();
  const env = envOf(db);
  const first = await assign(env, ADMIN, AVA, CYCLE, 'September batch');
  await end(env, ADMIN, first.body.id);
  const again = await assign(env, ADMIN, AVA, CYCLE);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id, 'one row per pair (206)');
  assert.deepEqual(events(db).map((e) => [e.kind, e.assignment_id, e.admin_user_id]),
    [['assigned', first.body.id, ADMIN], ['ended', first.body.id, ADMIN], ['assigned', first.body.id, ADMIN]]);
  assert.equal(events(db)[0].note, 'September batch');
  const h = await call(env, ADMIN, `${A}/history?assignment_id=${first.body.id}`);
  assert.equal(h.status, 200);
  assert.equal(h.body.total, 3);
  const at = h.body.items.map((r: any) => r.created_at);
  assert.deepEqual(at, [...at].sort().reverse(), 'newest first');
  assert.ok(at[0] > at[2], 'the re-assign is first, the first grant last');
  for (const r of h.body.items) {
    assert.deepEqual(Object.keys(r).sort(), ['advisor_user_id', 'assignment_id', 'by_admin', 'cohort_cycle_id', 'created_at', 'kind']);
    assert.equal(r.by_admin, true);
  }
  assert.doesNotMatch(JSON.stringify(h.body), /Ada|ada@|admin_user_id/);
  const paged = await call(env, ADMIN, `${A}/history?limit=1&offset=1`);
  assert.deepEqual([paged.body.items.length, paged.body.total, paged.body.items[0].kind], [1, 3, 'ended']);
  const other = await call(env, ADMIN, `${A}/history?cohort_cycle_id=${OTHER}`);
  assert.deepEqual([other.body.items.length, other.body.total], [0, 0]);
  // A backfilled row has no admin recorded: by_admin is false, not a guess.
  db.prepare(`INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, created_at)
              VALUES (?, ?, ?, 'ended', NULL, '2026-01-01T00:00:00Z')`).run(first.body.id, AVA, CYCLE);
  const all = await call(env, ADMIN, `${A}/history`);
  assert.equal(all.body.items.at(-1).by_admin, false);
  assert.equal(all.body.items.filter((r: any) => r.by_admin).length, 3);
});

test('a second DELETE answers 409 already_ended and moves nothing', async () => {
  const db = freshDb();
  const env = envOf(db);
  const a = await assign(env, ADMIN, AVA, CYCLE);
  const first = await end(env, ADMIN, a.body.id);
  assert.equal(first.status, 200);
  const before = db.prepare('SELECT unassigned_at, updated_at FROM advisor_cohort_assignments WHERE id = ?').get(a.body.id) as any;
  await new Promise((r) => setTimeout(r, 5));
  const second = await end(env, ADMIN, a.body.id);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'already_ended');
  assert.deepEqual({ ...db.prepare('SELECT unassigned_at, updated_at FROM advisor_cohort_assignments WHERE id = ?').get(a.body.id) as any }, { ...before });
  assert.deepEqual(events(db).map((e) => e.kind), ['assigned', 'ended']);
  assert.equal((await end(env, ADMIN, 999)).status, 404);
});

test('a re-post of an open pair answers 409 already_assigned: no note change, no history row, no notice', async () => {
  const db = freshDb();
  const env = envOf(db);
  const a = await assign(env, ADMIN, AVA, CYCLE, 'first note');
  assert.equal(a.body.founders_notified, 2, 'Fay and Fin are told');
  const before = { ...db.prepare('SELECT * FROM advisor_cohort_assignments WHERE id = ?').get(a.body.id) as any };
  const inbox = (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n;
  await new Promise((r) => setTimeout(r, 5));
  const r = await assign(env, ADMIN, AVA, CYCLE, 'second note');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already_assigned');
  assert.deepEqual({ ...db.prepare('SELECT * FROM advisor_cohort_assignments WHERE id = ?').get(a.body.id) as any }, before);
  assert.equal(events(db).length, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n, inbox, 'no "can see you", no false "has ended"');
  assert.equal(started(db), 2);
});

test('565 applies to a fresh database and backfills what the stores still hold, inventing nothing', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'advisor_cohort_assignments']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(noComments(M367));
  const a = db.prepare(`INSERT INTO advisor_cohort_assignments (id, uid, advisor_user_id, cohort_cycle_id, assigned_by_admin_id, assigned_at, unassigned_at, note, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  a.run(1, 'a1', AVA, CYCLE, ADMIN, '2026-10-05T00:00:00Z', null, 'now open', 1);   // re-assigned on 5 Oct
  a.run(2, 'a2', ALF, CYCLE, null, '2026-09-02T00:00:00Z', '2026-09-20T00:00:00Z', null, 0); // ended
  const n = db.prepare(`INSERT INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at) VALUES (?, ?, ?, ?)`);
  n.run(1, FAY, 'started', '2026-09-02T00:00:00Z'); // the episode the re-assign overwrote
  n.run(1, FIN, 'started', '2026-09-02T00:00:00Z'); // same episode, another founder: one row
  n.run(1, FAY, 'ended', '2026-09-02T00:00:00Z');   // an end notice is not a grant
  n.run(1, FIN, 'ended', '2026-08-01T00:00:00Z');   // nor is one whose episode no start notice names
  n.run(1, FAY, 'started', '2026-10-05T00:00:00Z'); // the current episode: already the row's own
  db.exec(noComments(M565));
  const rows = db.prepare('SELECT assignment_id, kind, admin_user_id, created_at FROM advisor_cohort_assignment_events ORDER BY assignment_id, created_at').all()
    .map((r: any) => [r.assignment_id, r.kind, r.admin_user_id, r.created_at]);
  assert.deepEqual(rows, [
    [1, 'assigned', null, '2026-09-02T00:00:00Z'],
    [1, 'assigned', ADMIN, '2026-10-05T00:00:00Z'],
    [2, 'assigned', null, '2026-09-02T00:00:00Z'],
    [2, 'ended', null, '2026-09-20T00:00:00Z'],
  ]);
  assert.throws(() => db.exec(`INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, created_at) VALUES (1, 1, 1, 'peeked', 'x')`), /CHECK/);
  const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'advisor_cohort_assignment_events' ORDER BY name`).all() as any[]).map((r) => r.name);
  assert.deepEqual(idx, ['idx_advisor_cohort_assignment_events_assignment', 'idx_advisor_cohort_assignment_events_cycle']);
});

// ---------------------------------------------------------------------------
// 4. Audit rows
// ---------------------------------------------------------------------------

test('assign and end each write one admin audit row naming the advisor, the assignment and the cycle', async () => {
  const db = freshDb();
  const env = envOf(db);
  const a = await assign(env, ADMIN, AVA, CYCLE);
  await end(env, ADMIN, a.body.id);
  await end(env, ADMIN, a.body.id); // refused: no row
  const rows = db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'advisor_cohort.%' ORDER BY id`).all() as any[];
  assert.deepEqual(rows.map((r) => [r.action, r.user_id, JSON.parse(r.details)]), [
    ['advisor_cohort.assigned', ADMIN, { target_user_id: AVA, assignment_id: a.body.id, cohort_cycle_id: CYCLE }],
    ['advisor_cohort.ended', ADMIN, { target_user_id: AVA, assignment_id: a.body.id, cohort_cycle_id: CYCLE }],
  ]);
});

// ---------------------------------------------------------------------------
// 5. Hidden counts
// ---------------------------------------------------------------------------

test('hidden founders are counted per row and once in the total, as counts only', async () => {
  const db = freshDb();
  const env = envOf(db);
  const ava = await assign(env, ADMIN, AVA, CYCLE);
  const alf = await assign(env, ADMIN, ALF, CYCLE);
  const o = db.prepare('INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id, withdrawn_at) VALUES (?, ?, ?)');
  o.run(FAY, AVA, null); o.run(FAY, ALF, null); // Fay hides from both: counted once in the total
  o.run(FIN, ALF, '2026-10-01');                 // withdrawn: Fin is visible again
  o.run(FLO, AVA, null);                         // Flo is in another cycle: not this row's
  const list = await call(env, ADMIN, A);
  const by = new Map(list.body.items.map((r: any) => [r.id, r.founders_hidden]));
  assert.equal(by.get(ava.body.id), 1);
  assert.equal(by.get(alf.body.id), 1);
  assert.equal(list.body.founders_hidden_total, 1, 'a founder hidden from two mentors counts once');
  // An ended row keeps its count; it leaves the total, which counts open holders.
  await end(env, ADMIN, ava.body.id);
  await end(env, ADMIN, alf.body.id);
  const after = await call(env, ADMIN, A);
  assert.ok(after.body.items.every((r: any) => r.founders_hidden === 1));
  assert.equal(after.body.founders_hidden_total, 0);
  assert.doesNotMatch(JSON.stringify(after.body.items.map((r: any) => r.founders_hidden)), /Fay|fay@/);
  // A deactivated holder is not an active holder either.
  await assign(env, ADMIN, AVA, CYCLE);
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(AVA);
  assert.equal((await call(env, ADMIN, A)).body.founders_hidden_total, 0);
});

test('hidden counts that cannot be read are null, not 0, and the list still answers', async () => {
  const db = freshDb();
  await assign(envOf(db), ADMIN, AVA, CYCLE);
  const r = await call(envOf(db, {}, [/FROM advisor_cohort_assignments a\s+JOIN (users u ON u.id = a.advisor_user_id\s+JOIN )?cohort_advisor_optouts/]), ADMIN, A);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].founders_hidden, null);
  assert.equal(r.body.founders_hidden_total, null);
});

// ---------------------------------------------------------------------------
// 6. founders_notified
// ---------------------------------------------------------------------------

test('founders_notified is null, not 0, when the notice sweep fails, and the write still stands', async () => {
  const db = freshDb();
  const env = envOf(db, {}, [/FROM advisor_cohort_assignments a\s+JOIN users u ON u.id = a.advisor_user_id\s+LEFT JOIN cohort_cycles/, /FROM cohort_advisor_notices n/]);
  const a = await assign(env, ADMIN, AVA, CYCLE);
  assert.equal(a.status, 200);
  assert.equal(a.body.founders_notified, null);
  const d = await end(env, ADMIN, a.body.id);
  assert.equal(d.status, 200);
  assert.equal(d.body.founders_notified, null);
  assert.deepEqual(events(db).map((e) => e.kind), ['assigned', 'ended']);
});

// ---------------------------------------------------------------------------
// 7. The Lab reads
// ---------------------------------------------------------------------------

function labDb() {
  const db = freshDb();
  for (const t of ['user_spinout_flags', 'spinout_lab_milestones', 'projects']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(noComments(read('cloudflare-worker/sql/migrations/155_spinout_applications.sql')));
  return db;
}

test('Lab applications: a D1 failure answers 503 lab_applications_unreadable; counts are by status and uncapped', async () => {
  const db = labDb();
  const app1 = db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea, status, created_at) VALUES (?, ?, 'An idea', ?, ?)`);
  for (let i = 0; i < 203; i++) app1.run(FAY, `Co ${i}`, i < 201 ? 'pending' : 'approved', `2026-10-${String((i % 28) + 1).padStart(2, '0')} 00:00:00`);
  const ok = await call(envOf(db), ADMIN, '/api/admin/spinout-applications');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.applications.length, 200, 'the list stays at 200');
  assert.deepEqual(ok.body.counts, { pending: 201, approved: 2 }, 'the figure is exact');
  const bad = await call(envOf(db, {}, [/FROM spinout_applications/]), ADMIN, '/api/admin/spinout-applications');
  assert.equal(bad.status, 503);
  assert.equal(bad.body.error, 'lab_applications_unreadable');
  assert.equal('applications' in bad.body, false, 'no empty list to draw as nobody');
  assert.doesNotMatch(JSON.stringify(bad.body), /D1_ERROR|synthetic/);
});

test('Lab participants: 503 on a failed list, a flag for each failed inner read, and truncated when the page is full', async () => {
  const db = labDb();
  db.prepare('INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted) VALUES (?, 1)').run(FAY);
  db.prepare(`INSERT INTO spinout_lab_milestones (user_id, milestone_key, week, completed_at) VALUES (?, 'incorporation_completed', 4, '2026-10-01 00:00:00')`).run(FAY);
  db.prepare('INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted) VALUES (?, 1)').run(FIN);

  const ok = await call(envOf(db), ADMIN, '/api/admin/spinout-participants');
  assert.equal(ok.status, 200);
  const st = new Map(ok.body.participants.map((p: any) => [p.user_id, p.status]));
  assert.deepEqual([st.get(FAY), st.get(FIN)], ['graduated', 'admitted']);
  assert.equal(ok.body.truncated, false);
  assert.equal('milestones_unreadable' in ok.body, false);

  const noMs = await call(envOf(db, {}, [/FROM spinout_lab_milestones\s+WHERE user_id IN/]), ADMIN, '/api/admin/spinout-participants');
  assert.equal(noMs.status, 200);
  assert.equal(noMs.body.milestones_unreadable, true);
  const fay = noMs.body.participants.find((p: any) => p.user_id === FAY);
  assert.equal(fay.status, null, 'a graduate is not turned into "admitted" by a failed read');
  assert.equal(fay.milestones, null);

  const noApps = await call(envOf(db, {}, [/FROM spinout_applications\s+WHERE user_id IN/]), ADMIN, '/api/admin/spinout-participants');
  assert.equal(noApps.body.applications_unreadable, true);
  assert.equal(noApps.body.participants.length, 2);

  const bad = await call(envOf(db, {}, [/FROM users u\s+LEFT JOIN user_spinout_flags/]), ADMIN, '/api/admin/spinout-participants');
  assert.equal(bad.status, 503);
  assert.equal(bad.body.error, 'lab_participants_unreadable');
  assert.equal('participants' in bad.body, false);

  // 400 user-and-project rows fill the page: the list says it may be cut.
  const many = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  const flag = db.prepare('INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted) VALUES (?, 1)');
  for (let i = 0; i < 400; i++) { many.run(1000 + i, `p${i}@example.test`, `P ${i}`, 'founder'); flag.run(1000 + i); }
  const full = await call(envOf(db), ADMIN, '/api/admin/spinout-participants');
  assert.equal(full.body.truncated, true);
});
