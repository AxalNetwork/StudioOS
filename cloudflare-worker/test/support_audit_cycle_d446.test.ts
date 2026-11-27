/**
 * D446 — the support-session audit line, and assessment runs for one cycle.
 *
 * A missing impersonation_sessions table is unreadable. An empty table is
 * empty. A cycle that cannot bound a window is not answered with every run.
 * Run on node:sqlite. No live branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import supportSessions, { SUPPORT_AUDIT_UNREADABLE } from '../src/routes/branch_support_sessions.ts';
import adminAssessment from '../src/routes/admin_assessment.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d446-0123456789-abcdef';
const ADMIN_ID = 7;
const FOUNDER_ID = 9;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('users'));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test', 1);
  u.run(FOUNDER_ID, 'founder', 'Ada Founder', 'ada@example.test', 1);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = [];
      for (const stmt of stmts) out.push(await stmt.run());
      return out;
    },
  };
}

async function token(userId: number) {
  return new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function callSupport(db: InstanceType<typeof DatabaseSync>, userId: number, branch: string | null) {
  const jwt = await token(userId);
  const env: Record<string, unknown> = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
  if (branch) env.BRANCH_CODE = branch;
  const res = await supportSessions.fetch(
    new Request('http://x/support-sessions', { headers: { Authorization: `Bearer ${jwt}` } }),
    env as any,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function callSessions(db: InstanceType<typeof DatabaseSync>, userId: number, query = '') {
  const jwt = await token(userId);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), BRANCH_CODE: 'fr' };
  const res = await adminAssessment.fetch(
    new Request(`http://x/sessions${query}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    env as any,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

function cycles(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`CREATE TABLE cohort_cycles (
    id INTEGER PRIMARY KEY,
    year INTEGER,
    month INTEGER,
    start_at TEXT,
    end_at TEXT,
    status TEXT
  )`);
}

function insertRun(
  db: InstanceType<typeof DatabaseSync>,
  publicId: string,
  startedAt: string,
  version: number,
  archetype: string | null,
) {
  db.prepare(
    `INSERT INTO assessment_sessions
       (public_id, user_id, game_id, game_slug, game_version, status, started_at)
     VALUES (?, ?, 1, 'founder-fit', ?, 'completed', ?)`,
  ).run(publicId, FOUNDER_ID, version, startedAt);
  const row = db.prepare('SELECT id FROM assessment_sessions WHERE public_id = ?').get(publicId) as { id: number };
  if (archetype) {
    db.prepare(
      `INSERT INTO assessment_results
         (session_id, user_id, game_id, track, archetype_label)
       VALUES (?, ?, 1, 'founder', ?)`,
    ).run(row.id, FOUNDER_ID, archetype);
  }
  return row.id;
}

test('a missing impersonation_sessions table is unreadable, not an empty audit', async () => {
  const db = freshDb();
  const r = await callSupport(db, ADMIN_ID, 'fr');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.equal(r.body.reason, SUPPORT_AUDIT_UNREADABLE);
  assert.equal(r.body.items, undefined);
  assert.doesNotMatch(r.text, /no such table|no such column|SQLITE/i);
  assert.doesNotMatch(r.body.reason, /The record exists and is empty/);
});

test('an empty impersonation_sessions table is empty, and a support row is parsed', async () => {
  const db = freshDb();
  db.exec(ddl('impersonation_sessions'));
  const empty = await callSupport(db, ADMIN_ID, 'fr');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.available, true);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.truncated, false);
  assert.match(empty.body.reads_unrecorded_reason, /not a row/);
  assert.match(empty.body.mirror_unrecorded_reason, /this database only/i);

  db.prepare(
    `INSERT INTO impersonation_sessions
       (admin_user_id, target_user_id, context, started_at, ended_at)
     VALUES (0, ?, 'hq_support:T. Okafor|ticket 14', '2026-09-02 09:00:00', NULL)`,
  ).run(FOUNDER_ID);
  db.prepare(
    `INSERT INTO impersonation_sessions
       (admin_user_id, target_user_id, context, started_at, ended_at)
     VALUES (0, ?, 'hq_support:|', '2026-09-01 09:00:00', '2026-09-01 09:30:00')`,
  ).run(FOUNDER_ID);
  db.prepare(
    `INSERT INTO impersonation_sessions
       (admin_user_id, target_user_id, context, started_at)
     VALUES (4, ?, 'hq_support:Not A Support Row|no', '2026-09-03 09:00:00')`,
  ).run(FOUNDER_ID);
  const r = await callSupport(db, ADMIN_ID, 'fr');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items[0].actor_name, 'T. Okafor');
  assert.equal(r.body.items[0].reason, 'ticket 14');
  assert.equal(r.body.items[0].ended_at, null);
  assert.equal(r.body.items[0].target_name, 'Ada Founder');
  assert.equal(r.body.items[0].target_email, 'ada@example.test');
  assert.equal(r.body.items[0].target_role, 'founder');
  assert.equal(r.body.items[1].actor_name, null);
  assert.equal(r.body.items[1].reason, null);
  assert.equal(r.body.items[1].ended_at, '2026-09-01 09:30:00');
  assert.doesNotMatch(r.text, /no such table|no such column|SQLITE/i);
});

test('HQ is refused, and the route does not create the table', async () => {
  const db = freshDb();
  const r = await callSupport(db, ADMIN_ID, null);
  assert.equal(r.status, 403);
  assert.equal(r.body.detail, 'Branch only');
  const founder = await callSupport(db, FOUNDER_ID, 'fr');
  assert.equal(founder.status, 403);
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/branch_support_sessions.ts'), 'utf8');
  assert.doesNotMatch(src, /CREATE TABLE|ensureCohortTimingSchema/);
  const index = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(index, /app\.route\('\/api\/branch', branchSupportSessionRoutes\)/);
});

test('a missing cohort calendar is unreadable, and a bad cycle id lists nothing', async () => {
  const db = freshDb();
  const missing = await callSessions(db, ADMIN_ID, '?cycle=4');
  assert.equal(missing.status, 200);
  assert.equal(missing.body.available, false);
  assert.match(missing.body.reason, /cohort calendar could not be read/);
  assert.equal(missing.body.items, undefined);
  assert.doesNotMatch(missing.text, /no such table|no such column|SQLITE/i);

  const bad = await callSessions(db, ADMIN_ID, '?cycle=abc');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'cycle_invalid');
  assert.equal(bad.body.message, 'Name a cycle by its id. Nothing was listed.');
  assert.doesNotMatch(bad.text, /no such table|SQLITE/i);

  cycles(db);
  const unknown = await callSessions(db, ADMIN_ID, '?cycle=4');
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.available, true);
  assert.equal(unknown.body.cycle_found, false);
  assert.deepEqual(unknown.body.items, []);
  assert.match(unknown.body.reason, /No cycle with that id/);
});

test('a cycle with no end is not the unfiltered population', async () => {
  const db = freshDb();
  cycles(db);
  db.prepare(
    `INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status)
     VALUES (1, 2026, 9, '2026-09-01 00:00:00', NULL, 'active')`,
  ).run();
  const boot = await callSessions(db, ADMIN_ID);
  assert.equal(boot.status, 200);
  insertRun(db, 'inside', '2026-09-15 12:00:00', 3, 'Operator');
  const r = await callSessions(db, ADMIN_ID, '?cycle=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.cycle_found, true);
  assert.equal(r.body.filterable, false);
  assert.deepEqual(r.body.items, []);
  assert.match(r.body.reason, /not the unfiltered population/);
  assert.doesNotMatch(r.text, /"public_id"|Operator/);
});

test('a cycle keeps a run whose start falls inside it, and omits the ones outside', async () => {
  const db = freshDb();
  cycles(db);
  db.prepare(
    `INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status)
     VALUES (2, 2026, 9, '2026-09-01 00:00:00', '2026-10-01 00:00:00', 'active')`,
  ).run();
  await callSessions(db, ADMIN_ID);
  insertRun(db, 'at-start', '2026-09-01 00:00:00', 0, null);
  insertRun(db, 'inside', '2026-09-15 12:00:00', 3, 'Operator');
  insertRun(db, 'at-end', '2026-10-01 00:00:00', 1, 'Builder');
  insertRun(db, 'before', '2026-08-31 23:59:59', 1, 'Earlier');
  const filtered = await callSessions(db, ADMIN_ID, '?cycle=2');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.filtered, true);
  assert.equal(filtered.body.cycle_found, true);
  assert.equal(filtered.body.filterable, true);
  assert.equal(filtered.body.truncated, false);
  const ids = filtered.body.items.map((row: { public_id: string }) => row.public_id);
  assert.deepEqual(ids, ['inside', 'at-start']);
  const inside = filtered.body.items[0];
  assert.equal(inside.game_version, 3);
  assert.equal(inside.archetype_label, 'Operator');
  assert.equal(inside.user_name, 'Ada Founder');
  assert.equal(inside.user_email, 'ada@example.test');
  const atStart = filtered.body.items[1];
  assert.equal(atStart.game_version, 0);
  assert.equal(atStart.archetype_label, null);
  const all = await callSessions(db, ADMIN_ID);
  assert.equal(all.body.filtered, false);
  assert.equal(all.body.cycle_id, null);
  assert.equal(all.body.items.length, 4);
  assert.equal(all.body.cycle_found, undefined);
  const founder = await callSessions(db, FOUNDER_ID, '?cycle=2');
  assert.equal(founder.status, 403);
  assert.doesNotMatch(filtered.text, /no such table|SQLITE/i);
});
