/**
 * D545 — GET /api/community-tasks: the approved tasks for the caller's
 * persona, and the caller's own suggestions with their review state.
 *
 * The real router over node:sqlite, with `tickets` and `users` from
 * `schema_baseline.sql` and D544's migration 383 (its triggers write the
 * pending rows, as in production).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_tasks_d545.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import communityTasks, { audienceFor } from '../src/routes/community_tasks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 10, INVESTOR = 11, EXPLORING = 12, ADMIN = 1;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [INVESTOR]: 'investor', [EXPLORING]: 'exploring', [ADMIN]: 'admin' };
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, name);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'tickets']) db.exec(ddl(t));
  db.exec(read('cloudflare-worker/sql/migrations/383_community_tasks.sql'));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `U${id}`, `u${id}@example.test`);
  return db;
}
/** A task suggested by `user`, then decided as given. */
function task(db: any, user: number, title: string, decided?: { status: 'approved' | 'declined'; audience?: string; reason?: string; at?: string }) {
  const tid = Number(db.prepare(`INSERT INTO tickets (title, description, type, user_id) VALUES (?, 'How to do it', 'task', ?)`).run(title, user).lastInsertRowid);
  const row = db.prepare('SELECT id FROM community_tasks WHERE ticket_id = ?').get(tid) as any;
  if (decided) {
    db.prepare(`UPDATE community_tasks SET status = ?, audience = ?, decline_reason = ?, decided_by = ?, decided_at = ? WHERE id = ?`)
      .run(decided.status, decided.audience ?? 'all', decided.reason ?? null, ADMIN, decided.at ?? '2026-10-04T10:00:00.000Z', row.id);
  }
  return row.id as number;
}

function makeD1(db: InstanceType<typeof DatabaseSync>, failOn?: RegExp) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() {
          if (failOn && failOn.test(sql)) throw new Error('D1_ERROR: disk I/O error');
          return { results: db.prepare(sql).all(...b) };
        },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
}
async function list(db: any, who: number, failOn?: RegExp) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await communityTasks.request('/', { headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failOn) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('a signed-in user sees the approved tasks for their persona and for everyone, newest first', async () => {
  const db = freshDb();
  task(db, INVESTOR, 'For everyone', { status: 'approved', audience: 'all', at: '2026-10-01T10:00:00.000Z' });
  task(db, INVESTOR, 'For founders', { status: 'approved', audience: 'founder', at: '2026-10-03T10:00:00.000Z' });
  task(db, INVESTOR, 'For investors', { status: 'approved', audience: 'investor' });
  task(db, INVESTOR, 'Still pending');
  task(db, INVESTOR, 'Declined one', { status: 'declined', reason: 'Not useful to others' });
  const r = await list(db, FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.audience, 'founder');
  assert.deepEqual(r.body.tasks.map((t: any) => t.title), ['For founders', 'For everyone']);
  assert.deepEqual(Object.keys(r.body.tasks[0]).sort(), ['audience', 'body', 'id', 'published_at', 'title']);
  const inv = await list(db, INVESTOR);
  assert.deepEqual(inv.body.tasks.map((t: any) => t.title).sort(), ['For everyone', 'For investors']);
});

test('an exploring account reads the explorer audience; an admin sees every approved task', async () => {
  const db = freshDb();
  task(db, FOUNDER, 'For explorers', { status: 'approved', audience: 'explorer' });
  task(db, FOUNDER, 'For founders', { status: 'approved', audience: 'founder' });
  assert.deepEqual((await list(db, EXPLORING)).body.tasks.map((t: any) => t.title), ['For explorers']);
  const admin = await list(db, ADMIN);
  assert.equal(admin.body.audience, 'admin');
  assert.equal(admin.body.tasks.length, 2);
  assert.equal(audienceFor('admin'), null);
  assert.equal(audienceFor('lp'), null);
});

test('my suggestions show each review state, with the reason on a decline only', async () => {
  const db = freshDb();
  const p = task(db, FOUNDER, 'Pending idea');
  const a = task(db, FOUNDER, 'Approved idea', { status: 'approved', audience: 'all' });
  const d = task(db, FOUNDER, 'Declined idea', { status: 'declined', reason: 'Decks are private by default here' });
  task(db, INVESTOR, 'Someone else\'s idea');
  const r = await list(db, FOUNDER);
  const by = Object.fromEntries(r.body.my_suggestions.map((s: any) => [s.id, s]));
  assert.deepEqual(Object.keys(by).map(Number).sort((x, y) => x - y), [p, a, d], 'only my own');
  assert.deepEqual([by[p].status, by[p].decline_reason], ['pending', null]);
  assert.deepEqual([by[a].status, by[a].decline_reason], ['approved', null]);
  assert.deepEqual([by[d].status, by[d].decline_reason], ['declined', 'Decks are private by default here']);
});

test('nothing yet is an empty list; a failed read is a refusal, never an empty list', async () => {
  const db = freshDb();
  const empty = await list(db, FOUNDER);
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.tasks, empty.body.my_suggestions], [[], []]);
  for (const failOn of [/WHERE status = 'approved'/, /WHERE t\.user_id = \?/]) {
    const r = await quiet(() => list(db, FOUNDER, failOn));
    assert.equal(r.status, 500, String(failOn));
    assert.equal(r.body.error, 'community_tasks_unreadable');
    assert.equal('tasks' in r.body, false);
    assert.doesNotMatch(JSON.stringify(r.body), /disk I\/O/);
  }
});

test('signed out is refused', async () => {
  const db = freshDb();
  const res = await communityTasks.request('/', {}, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  assert.equal(res.status, 401);
});
