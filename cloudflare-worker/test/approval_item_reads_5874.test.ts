/**
 * D5874 (#5874): one approval item is read, and an assignment target checked,
 * by lane and id, not looked for in a lane's first 1,000 rows.
 *
 * The database is the baseline plus every migration (schema only), so every
 * lane's one-row read runs against production's columns. Every person and
 * posting is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/approval_item_reads_5874.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import { APPROVAL_SOURCES, approvalItem, itemSqlOf } from '../src/services/approvalSources.ts';
import { HQ_APPROVAL_SOURCES } from '../src/services/hqApprovalSources.ts';
import { INBOX_LANE_CAP, assignReviewers } from '../src/services/approvalAssignments.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADA = 2, BEA = 3, HOST = 4;
const OPEN_JOBS = INBOX_LANE_CAP + 5; // ids 1..1005, oldest first

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'u1', 'admin', 'Sam Super', 'sam@example.test', 'verified');
  u.run(ADA, 'u2', 'admin', 'Ada Admin', 'ada@example.test', 'verified');
  u.run(BEA, 'u3', 'admin', 'Bea Admin', 'bea@example.test', 'verified');
  u.run(HOST, 'u4', 'founder', 'Hal Host', 'hal@example.test', 'verified');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADA, BEA]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  // 1,005 open postings in one lane, the oldest first, so ids above 1,000 sit
  // past the inbox's per-lane cap.
  const job = db.prepare("INSERT INTO job_postings (id, slug, host_user_id, title, status, created_at) VALUES (?, ?, ?, ?, 'pending_review', ?)");
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  db.exec('BEGIN');
  for (let i = 1; i <= OPEN_JOBS; i += 1) {
    job.run(i, `role-${i}`, HOST, `Role ${i}`, new Date(t0 + i * 60_000).toISOString().replace('T', ' ').slice(0, 19));
  }
  db.exec('COMMIT');
  db.exec(`INSERT INTO hq_escalations (id, uid, branch_code, kind, subject, raised_by_name, status, created_at)
    VALUES (401, 'e-g', 'fr', 'program_grant', 'Founder circles', 'Studio Admin', 'open', '2026-10-02 00:00:00')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/approvals', approvalsRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/approvals${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const assign = (db: DatabaseSync, who: number, items: Array<{ lane: string; item_id: number }>) =>
  call(db, who, 'POST', '/assignments', { assignee_user_id: BEA, items });

test('every lane has a one-row read that prepares against the schema and keeps the lane\'s own query', () => {
  const db = fixture();
  for (const s of [...APPROVAL_SOURCES, ...HQ_APPROVAL_SOURCES]) {
    const sql = itemSqlOf(s);
    assert.ok(sql.includes(s.rowsSql.replace(/ LIMIT \?$/, '')), `${s.key}: the lane's rows query, whole, minus its cap`);
    assert.match(sql, /\) WHERE id = \? LIMIT 1$/, s.key);
    assert.doesNotThrow(() => db.prepare(sql), s.key);
  }
  assert.throws(() => itemSqlOf({ ...APPROVAL_SOURCES[0], rowsSql: 'SELECT 1 AS id' }), /does not end with LIMIT \?/,
    'a lane without the cap is refused, never queried with a stray placeholder');
});

test('the inbox caps the lane at 1,000, and the item read still finds rows 1,001 and beyond', async () => {
  const db = fixture();
  const inbox = await call(db, ADA, 'GET', '?page=1');
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.total, OPEN_JOBS, 'the total is counted past the cap (HQ\'s grant is not a plain admin\'s)');
  for (const id of [INBOX_LANE_CAP + 1, OPEN_JOBS]) {
    const r = await call(db, ADA, 'GET', `/items/jobs/${id}`);
    assert.equal(r.status, 200, `item ${id}: ${JSON.stringify(r.body)}`);
    assert.deepEqual([r.body.item.lane, r.body.item.id, r.body.item.what.includes(`Role ${id}`)], ['jobs', id, true]);
    assert.equal(r.body.item.who, 'Hal Host');
    assert.equal(r.body.item.assignee, null);
  }
  // The first row is read the same way.
  assert.equal((await call(db, ADA, 'GET', '/items/jobs/1')).status, 200);
});

test('an item past the cap can be assigned, and the item read shows its assignee', async () => {
  const db = fixture();
  const id = INBOX_LANE_CAP + 3;
  const r = await assign(db, ADA, [{ lane: 'jobs', item_id: id }, { lane: 'jobs', item_id: 2 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.assigned.map((a: any) => a.item_id).sort((a: number, b: number) => a - b), [2, id]);
  const item = await call(db, ADA, 'GET', `/items/jobs/${id}`);
  assert.deepEqual(item.body.item.assignee, { user_id: BEA, name: 'Bea Admin' });
  assert.deepEqual(item.body.history.items.map((h: any) => [h.kind, h.actor_user_id, h.assignee_user_id]), [['assigned', ADA, BEA]]);
});

test('an item no longer waiting is still not found, and is not assigned', async () => {
  const db = fixture();
  const id = INBOX_LANE_CAP + 2;
  db.prepare("UPDATE job_postings SET status = 'published' WHERE id = ?").run(id);
  const gone = await call(db, ADA, 'GET', `/items/jobs/${id}`);
  assert.deepEqual([gone.status, gone.body?.error], [404, 'item_not_waiting']);
  assert.deepEqual([(await call(db, ADA, 'GET', '/items/jobs/99999')).status], [404], 'never there');
  const r = await assign(db, ADA, [{ lane: 'jobs', item_id: 1 }, { lane: 'jobs', item_id: id }]);
  assert.deepEqual([r.status, r.body?.error], [400, 'not_on_board']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_assignments').get()!.n, 0, 'all or nothing: the waiting one was not written either');
});

test('a lane whose read fails is unreadable on both routes, never not found', async () => {
  const db = fixture();
  db.exec('DROP TABLE job_postings');
  const r = await call(db, ADA, 'GET', `/items/jobs/${INBOX_LANE_CAP + 1}`);
  assert.deepEqual([r.status, r.body?.error], [503, 'lane_unreadable']);
  const a = await assign(db, ADA, [{ lane: 'jobs', item_id: INBOX_LANE_CAP + 1 }]);
  assert.deepEqual([a.status, a.body?.error], [503, 'lane_unreadable']);
  assert.match(String(a.body?.message ?? ''), /Jobs could not be read.*Nothing was assigned\./);
});

test('a caller whose sources do not include the lane is still refused', async () => {
  const db = fixture();
  // A plain admin naming HQ's grants lane: not told it exists, not allowed to assign on it.
  const hidden = await call(db, ADA, 'GET', '/items/grants/401');
  assert.deepEqual([hidden.status, hidden.body?.error], [404, 'item_not_found']);
  assert.deepEqual([(await assign(db, ADA, [{ lane: 'grants', item_id: 401 }])).body?.error], ['bad_item']);
  // The Super Admin reads and assigns it.
  assert.equal((await call(db, SUPER, 'GET', '/items/grants/401')).status, 200);
  assert.equal((await assign(db, SUPER, [{ lane: 'grants', item_id: 401 }])).status, 200);
  // And the service itself, handed sources without the lane (a branch board), refuses it before any write.
  const svc = await assignReviewers({ DB: d1Over(db) } as any, ADA, BEA, [{ lane: 'grants', item_id: 401 }], { sources: APPROVAL_SOURCES });
  assert.deepEqual([svc.ok, (svc as any).code], [false, 'not_on_board']);
});

test('the branch board assigns past its old 100-row read too (same service)', async () => {
  const db = fixture();
  const env = { DB: d1Over(db) } as any;
  const r = await assignReviewers(env, ADA, BEA, [{ lane: 'jobs', item_id: 150 }], { sources: APPROVAL_SOURCES });
  assert.equal(r.ok, true, JSON.stringify(r));
  const jobs = APPROVAL_SOURCES.find((s) => s.key === 'jobs')!;
  assert.equal((await approvalItem(env, jobs, 150))?.id, 150);
  assert.equal(await approvalItem(env, jobs, 0), null);
});
