/**
 * D5875 (#5875): the assignment read is scoped to the items asked about, and
 * reviewer workload is counted in SQL, so a long assignment record no longer
 * makes the inbox's assignees and tiles unreadable.
 *
 * The database is the baseline plus every migration (schema only). Every
 * person and posting is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/approval_assignment_scope_5875.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import { ASSIGNMENTS_UNREADABLE, WORKLOAD_UNREADABLE, readAssignmentState, readWorkload } from '../src/services/approvalAssignments.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const ADA = 2, BEA = 3, HOST = 4;
const OPEN_JOBS = 30;
/** More rows than the old whole-table read took (5,000). */
const STALE_ROWS = 5_200;

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

/**
 * 30 open postings, oldest first: 1..10 are over the SLA (created 2026-01), the
 * rest are fresh (created today, by SQLite's own clock). Ada holds 1..4 (two of
 * them past), Bea holds 5 and 26. And 5,200 assignment rows for postings that
 * are no longer waiting: they are in the record, and none of them is workload.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, ?, 1, 1, ?)');
  u.run(ADA, 'u2', 'admin', 'Ada Admin', 'ada@example.test', 'verified');
  u.run(BEA, 'u3', 'admin', 'Bea Admin', 'bea@example.test', 'verified');
  u.run(HOST, 'u4', 'founder', 'Hal Host', 'hal@example.test', 'verified');
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
    .run(ADA, `totp-${ADA}`);
  const old = db.prepare("INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (?, ?, ?, ?, 'pending_review', ?)");
  const fresh = db.prepare("INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (?, ?, ?, ?, 'pending_review', datetime('now', ?))");
  for (let i = 1; i <= OPEN_JOBS; i += 1) {
    if (i <= 10) old.run(i, `role-${i}`, HOST, `Role ${i}`, `2026-01-01 00:${String(i).padStart(2, '0')}:00`);
    else fresh.run(i, `role-${i}`, HOST, `Role ${i}`, `-${120 - i} minutes`);
  }
  const a = db.prepare("INSERT INTO approval_assignments (lane, item_id, assignee_user_id, assigned_by_user_id) VALUES ('jobs', ?, ?, ?)");
  db.exec('BEGIN');
  for (const [id, who] of [[1, ADA], [2, ADA], [3, ADA], [4, ADA], [5, BEA], [26, BEA]]) a.run(id, who, ADA);
  for (let i = 1; i <= STALE_ROWS; i += 1) a.run(10_000 + i, i % 2 ? ADA : BEA, ADA);
  db.exec('COMMIT');
  return db;
}

/** A D1 binding over `db` whose statements matching `fail` throw, as a failed D1 read does. */
function failing(db: DatabaseSync, fail: RegExp) {
  const d1 = d1Over(db) as any;
  return {
    ...d1,
    prepare(sql: string) {
      if (fail.test(sql)) throw new Error('D1_ERROR: simulated failure');
      return d1.prepare(sql);
    },
    batch: d1.batch?.bind(d1),
  };
}
const WORKLOAD_SQL = /GROUP BY a\.assignee_user_id/;
const PAGE_SQL = /SELECT a\.lane AS lane, a\.item_id AS item_id/;

const app = new Hono<any>();
app.route('/api/admin/approvals', approvalsRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(DB: unknown, path: string) {
  const token = await new SignJWT({ user_id: ADA, jti: `totp-${ADA}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/approvals${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}

const assigneeOf = (body: any, id: number) => body.items.find((it: any) => it.lane === 'jobs' && it.id === id)?.assignee;

test('with more than 5,000 assignment rows, each row on the page still shows its assignee', async () => {
  const db = fixture();
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM approval_assignments').get() as any).n > 5_000);
  const r = await call(d1Over(db), '?page=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.assignments, { available: true });
  assert.deepEqual(assigneeOf(r.body, 1), { user_id: ADA, name: 'Ada Admin' });
  assert.deepEqual(assigneeOf(r.body, 5), { user_id: BEA, name: 'Bea Admin' });
  assert.equal(assigneeOf(r.body, 6), null, 'an item nobody holds says nobody');
  // Page 2 reads its own rows' assignees (item 26 is on it).
  const p2 = await call(d1Over(db), '?page=2');
  assert.deepEqual(assigneeOf(p2.body, 26), { user_id: BEA, name: 'Bea Admin' });
  assert.equal(assigneeOf(p2.body, 27), null);
});

test('the tiles count workload in SQL over the items still waiting, not the whole record', async () => {
  const db = fixture();
  const r = await call(d1Over(db), '?page=1');
  const t = r.body.tiles;
  assert.equal(t.complete, true);
  assert.equal(t.assigned_to_me, 4);
  assert.deepEqual(t.per_admin, [{ id: ADA, name: 'Ada Admin', count: 4 }, { id: BEA, name: 'Bea Admin', count: 2 }],
    'the 5,200 rows for decided postings are not anybody\'s workload');
  assert.equal(t.over_72h, 10);
  assert.equal(t.unassigned, OPEN_JOBS - 6);
  assert.equal(t.overdue_unassigned, 10 - 5, 'items 1..5 are past and held');
  assert.equal(t.reason, undefined);
});

test('an assigned filter reads every row\'s assignee, still past the old cap', async () => {
  const db = fixture();
  const mine = await call(d1Over(db), '?assigned=me');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.items.map((it: any) => it.id), [1, 2, 3, 4]);
  assert.equal(mine.body.total, 4);
  const bea = await call(d1Over(db), `?assigned=${BEA}`);
  assert.deepEqual(bea.body.items.map((it: any) => it.id), [5, 26]);
  const none = await call(d1Over(db), '?assigned=none');
  assert.equal(none.body.total, OPEN_JOBS - 6);
});

test('a workload count that fails answers null with its reason, never 0, and the rows keep their assignees', async () => {
  const db = fixture();
  const r = await call(failing(db, WORKLOAD_SQL), '?page=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.tiles;
  assert.deepEqual([t.assigned_to_me, t.per_admin, t.unassigned, t.overdue_unassigned], [null, null, null, null]);
  assert.equal(t.reason, WORKLOAD_UNREADABLE);
  assert.equal(t.over_72h, 10, 'a count that does not need the record is still shown');
  assert.deepEqual(r.body.assignments, { available: true }, 'the page read is a different read, and it answered');
  assert.deepEqual(assigneeOf(r.body, 1), { user_id: ADA, name: 'Ada Admin' });
  const svc = await readWorkload({ DB: failing(db, WORKLOAD_SQL) } as any, [{ lane: 'jobs', id: 1 }]);
  assert.deepEqual(svc, { ok: false, reason: WORKLOAD_UNREADABLE });
});

test('a real read failure is still "the assignment record could not be read"', async () => {
  const db = fixture();
  // The page's assignee read fails: the rows carry no assignee (not "nobody").
  const page = await call(failing(db, PAGE_SQL), '?page=1');
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.assignments, { available: false, reason: ASSIGNMENTS_UNREADABLE });
  assert.equal(page.body.items[0].assignee, undefined);
  // The table itself is gone: every assignment figure is unread.
  db.exec('DROP TABLE approval_assignments');
  const gone = await call(d1Over(db), '?page=1');
  assert.deepEqual(gone.body.assignments, { available: false, reason: ASSIGNMENTS_UNREADABLE });
  assert.deepEqual([gone.body.tiles.assigned_to_me, gone.body.tiles.per_admin, gone.body.tiles.unassigned], [null, null, null]);
  assert.equal(gone.body.tiles.reason, ASSIGNMENTS_UNREADABLE);
  const refused = await call(d1Over(db), '?assigned=me');
  assert.deepEqual([refused.status, refused.body?.error], [503, 'assigned_unreadable']);
  const item = await call(d1Over(db), '/items/jobs/1');
  assert.equal(item.body.assignee_reason, ASSIGNMENTS_UNREADABLE);
});

test('the service reads only the items it is given', async () => {
  const db = fixture();
  const env = { DB: d1Over(db) } as any;
  const one = await readAssignmentState(env, [{ lane: 'jobs', id: 5 }]);
  assert.equal(one.available, true);
  assert.deepEqual([...one.assignees.keys()], ['jobs:5']);
  const stale = await readAssignmentState(env, [{ lane: 'jobs', id: 10_000 + STALE_ROWS }]);
  assert.deepEqual([...stale.assignees.values()], [{ user_id: BEA, name: 'Bea Admin' }], 'a row far past 5,000 is read by its key');
  const none = await readAssignmentState(env, []);
  assert.deepEqual([none.available, none.assignees.size], [true, 0]);
  const item = await call(d1Over(db), '/items/jobs/26');
  assert.deepEqual(item.body.item.assignee, { user_id: BEA, name: 'Bea Admin' });
});
