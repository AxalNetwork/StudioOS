/**
 * D701 (#1663) — `GET /api/eadwyn/conversations/mine`: every conversation the
 * caller has, for the Conversations list on Studio's phone page.
 *
 * On a real SQLite database: the rail tables from migration 444's own file,
 * and `advisor_conversations` / `advisor_messages` from the schema baseline.
 *   1. caller only, both stores, newest first, with the fields the page reads;
 *   2. one profiling row: the active one, else the newest of any state;
 *   3. "mine" is not a uid (the route is registered before `/:uid`);
 *   4. titles, and a tie in time puts the rail row first;
 *   5. at most 20 rail rows, and the profiling row is never pushed out;
 *   6. each half is read on its own and named when it cannot be;
 *   7. the read writes nothing.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_conversations_d701.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { createJWT } from '../src/auth.ts';
import eadwyn from '../src/routes/eadwyn.ts';

const EADWYN_SCHEMA_SQL = readFileSync(new URL('../sql/migrations/444_eadwyn_conversations.sql', import.meta.url), 'utf8');
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const A = 2, B = 3;
const uid = (n: number) => n.toString(16).padStart(32, '0');

function world(opts: { noProfiling?: boolean; noRail?: boolean } = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${A}', ${A}), ('jti-${B}', ${B});
  `);
  if (!opts.noRail) db.exec(EADWYN_SCHEMA_SQL);
  if (!opts.noProfiling) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'advisor_conversations')));
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'advisor_messages')));
  }
  return { env: { JWT_SECRET, DB } as any, db };
}

function rail(db: any, id: number, user: number, workspace: string, title: string, updated: string, messages = 0) {
  db.prepare('INSERT INTO eadwyn_conversations (id, uid, user_id, workspace, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, uid(id), user, workspace, title, updated, updated);
  for (let i = 0; i < messages; i += 1) {
    db.prepare('INSERT INTO eadwyn_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(id, i % 2 ? 'assistant' : 'user', `m${i}`);
  }
}

function profiling(db: any, id: number, user: number, state: string, updated: string, answered: number, total: number, roles: string[] = []) {
  db.prepare(`INSERT INTO advisor_conversations (id, uid, user_id, persona, state, answered_count, total_questions, created_at, updated_at)
              VALUES (?, ?, ?, 'founder', ?, ?, ?, ?, ?)`).run(id, uid(1000 + id), user, state, answered, total, updated, updated);
  for (const r of roles) db.prepare('INSERT INTO advisor_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(id, r, r);
}

/** Mounted as index.ts mounts it, with the global handler's auth-error mapping. */
const app = new Hono();
app.route('/', eadwyn);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function get(env: any, path: string, user: number | null = A) {
  const headers: Record<string, string> = {};
  if (user !== null) headers.authorization = `Bearer ${await createJWT(env, user, `u${user}@example.test`, 'founder', undefined, `jti-${user}`)}`;
  const res = await app.request(path, { method: 'GET', headers }, env);
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** Founder A: two rail rows in two workspaces, an active profiling row and a newer complete one. Founder B: one of each. */
function seeded(opts?: { noProfiling?: boolean; noRail?: boolean }) {
  const w = world(opts);
  if (!opts?.noRail) {
    rail(w.db, 1, A, 'build', 'How do I price the pilot?', '2026-10-14 09:00:00', 4);
    rail(w.db, 2, A, 'raise', 'Who should I ask first?', '2026-10-12 09:00:00', 2);
    rail(w.db, 3, B, 'build', 'Somebody else', '2026-10-15 09:00:00', 1);
  }
  if (!opts?.noProfiling) {
    profiling(w.db, 10, A, 'active', '2026-10-13 09:00:00', 8, 14, ['user', 'assistant', 'tool', 'system', 'assistant']);
    profiling(w.db, 11, A, 'complete', '2026-10-15 08:00:00', 14, 14, ['user']);
    profiling(w.db, 12, B, 'active', '2026-10-15 10:00:00', 1, 14, ['assistant']);
  }
  return w;
}

test('1. caller only: both stores, newest first, with the fields the page reads', async () => {
  const { env } = seeded();
  const r = await get(env, '/conversations/mine');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.unreadable, []);
  assert.deepEqual(r.json.conversations, [
    { id: uid(1), kind: 'eadwyn', title: 'How do I price the pilot?', workspace: 'build', updated_at: '2026-10-14 09:00:00', messages: 4, answered: null, total: null, active: false },
    { id: uid(1010), kind: 'profiling', title: 'Profiling questions', workspace: null, updated_at: '2026-10-13 09:00:00', messages: 3, answered: 8, total: 14, active: true },
    { id: uid(2), kind: 'eadwyn', title: 'Who should I ask first?', workspace: 'raise', updated_at: '2026-10-12 09:00:00', messages: 2, answered: null, total: null, active: false },
  ]);
  // A's complete row is not listed: the active one is the one /start resumes.
  assert.ok(!r.json.conversations.some((x: any) => x.id === uid(1011)));
  const rb = await get(env, '/conversations/mine', B);
  const bIds = rb.json.conversations.map((x: any) => x.id);
  assert.deepEqual(bIds.sort(), [uid(3), uid(1012)].sort());
  for (const id of [uid(1), uid(2), uid(1010), uid(1011)]) assert.ok(!bIds.includes(id), `B sees A's ${id}`);
  for (const id of [uid(3), uid(1012)]) assert.ok(!r.json.conversations.some((x: any) => x.id === id), `A sees B's ${id}`);
});

test('2. with no active profiling row, the newest of any state is listed, not active', async () => {
  const { env, db } = seeded();
  db.prepare("UPDATE advisor_conversations SET state = 'paused' WHERE id = 10").run();
  const r = await get(env, '/conversations/mine');
  const prof = r.json.conversations.filter((x: any) => x.kind === 'profiling');
  assert.equal(prof.length, 1);
  assert.equal(prof[0].id, uid(1011));
  assert.equal(prof[0].active, false);
  assert.equal(prof[0].answered, 14);
});

test('3. "mine" is not a uid: 200 with a session, 401 without, and another member\'s uid is still 404', async () => {
  const { env } = seeded();
  const r = await get(env, '/conversations/mine');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.conversations));
  assert.equal((await get(env, '/conversations/mine', null)).status, 401);
  assert.equal((await get(env, `/conversations/${uid(3)}`)).status, 404);
});

test('4. titles: an empty rail title reads "<workspace> conversation"; a stored one as stored; a tie puts the rail row first', async () => {
  const { env, db } = world();
  rail(db, 1, A, 'validate', '', '2026-10-14 09:00:00');
  rail(db, 2, A, 'build', '  Stored title  ', '2026-10-13 09:00:00');
  // Stored in the same second as rail row 2: the rail row comes first.
  profiling(db, 10, A, 'active', '2026-10-13 09:00:00', 0, 0);
  const r = await get(env, '/conversations/mine');
  assert.deepEqual(r.json.conversations.map((x: any) => x.title), ['validate conversation', 'Stored title', 'Profiling questions']);
});

test('5. 20 newest rail rows, merged newest first with the profiling row, which is never pushed out', async () => {
  const { env, db } = world();
  for (let i = 1; i <= 25; i += 1) {
    rail(db, i, A, 'build', `Q${i}`, `2026-10-${String(i).padStart(2, '0')} 09:00:00`);
  }
  // Older than all but five rail rows: newer than day 20, older than day 21.
  profiling(db, 10, A, 'active', '2026-10-20 12:00:00', 3, 14);
  const r = await get(env, '/conversations/mine');
  const titles = r.json.conversations.map((x: any) => x.title);
  assert.equal(titles.length, 21);
  assert.deepEqual(titles.slice(0, 6), ['Q25', 'Q24', 'Q23', 'Q22', 'Q21', 'Profiling questions']);
  assert.equal(titles.at(-1), 'Q6');
  assert.ok(!titles.includes('Q5'));
});

test('6. each half is read on its own, and a half that cannot be read is named', async () => {
  const noProf = seeded({ noProfiling: true });
  const r1 = await get(noProf.env, '/conversations/mine');
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.json.unreadable, ['profiling']);
  assert.deepEqual(r1.json.conversations.map((x: any) => x.kind), ['eadwyn', 'eadwyn']);

  const noRail = seeded({ noRail: true });
  const r2 = await get(noRail.env, '/conversations/mine');
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.json.unreadable, ['eadwyn']);
  assert.deepEqual(r2.json.conversations.map((x: any) => x.kind), ['profiling']);
});

test('7. the read writes nothing: a stranded send stays sending and no updated_at moves', async () => {
  const { env, db } = seeded();
  db.prepare(`INSERT INTO eadwyn_pending_actions (uid, conversation_id, user_id, integration_id, provider_key, target_label, payload_json, payload_hash, status, decided_at)
              VALUES (?, 1, ?, 1, 'hubspot', 'x', '{}', 'h', 'sending', datetime('now', '-30 minutes'))`).run(uid(500), A);
  const before = JSON.stringify([
    db.prepare('SELECT id, updated_at FROM eadwyn_conversations ORDER BY id').all(),
    db.prepare('SELECT id, updated_at, state FROM advisor_conversations ORDER BY id').all(),
  ]);
  assert.equal((await get(env, '/conversations/mine')).status, 200);
  assert.equal(db.prepare('SELECT status FROM eadwyn_pending_actions WHERE uid = ?').get(uid(500)).status, 'sending');
  assert.equal(JSON.stringify([
    db.prepare('SELECT id, updated_at FROM eadwyn_conversations ORDER BY id').all(),
    db.prepare('SELECT id, updated_at, state FROM advisor_conversations ORDER BY id').all(),
  ]), before);
});
