/**
 * Moving a card on the roadmap board writes the week history `/build/this-week`
 * reads — and a reorder does not.
 *
 * `okr_weeks.test.ts` covers the arithmetic without a database. This covers the
 * two things only the route can be wrong about: WHEN a row is written, and that
 * failing to write one never fails the move.
 *
 * THE ASSERTION THAT MATTERS MOST is the reorder. A drag within one column arrives
 * at the same endpoint with the same `kanban_status`, and logging it would put a
 * "committed to Now" row in every week a founder tidied their board — so
 * `Carried only` would find nothing carried, because every card would have a
 * commitment in the current week. The chip would be live, selectable, and always
 * empty, which is the failure mode `zoneFilterBuilder.js` opens its docblock with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import progress from '../src/routes/progress.ts';
import { weekStartOf } from '../src/services/okrWeeks.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATION = readFileSync(`${SQL}/migrations/252_okr_column_moves.sql`, 'utf8');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');

/**
 * `roadmap_okrs` TAKEN FROM THE BASELINE, not hand-written — and a failing test is
 * why. The first version of this fixture spelled the column `key_results`; it is
 * `key_results_json`, so every route call died on `no such column`. A hand-copied
 * DDL that drifts makes every assertion above it true of a schema production does
 * not have, which is the whole of #203, and it happened here on the first attempt.
 */
function tableFromBaseline(name: string): string {
  const re = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?"?${name}"?\\s*\\(`, 'im');
  const m = re.exec(BASELINE);
  if (!m) throw new Error(`schema_baseline.sql has no ${name}`);
  const end = BASELINE.indexOf(');', m.index);
  if (end < 0) throw new Error(`unterminated CREATE TABLE for ${name}`);
  return BASELINE.slice(m.index, end + 2);
}
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OWNER = 90;
const OUTSIDER = 91;
const PROJECT = 9301;
const OTHER_PROJECT = 9302;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, blockInsertInto?: string) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          // A writer that refuses one table, so "the log never fails the move" can
          // be asserted rather than assumed.
          if (blockInsertInto && sql.includes(blockInsertInto) && /^\s*INSERT/i.test(sql)) {
            throw new Error('no such table: ' + blockInsertInto);
          }
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function applySql(db: InstanceType<typeof DatabaseSync>, sql: string) {
  for (const stmt of sql.replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) db.exec(stmt);
}

function freshDb(withMigration = true) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      name TEXT, email TEXT, founder_id INTEGER, spinout_lab_active INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, founder_id INTEGER, sector TEXT,
      company_id INTEGER
    );
  `);
  db.exec(tableFromBaseline('roadmap_okrs'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?,?,?)');
  u.run(OWNER, 'founder', OWNER);
  u.run(OUTSIDER, 'founder', OUTSIDER);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?,?,?)');
  p.run(PROJECT, 'Bellwether', OWNER);
  p.run(OTHER_PROJECT, 'Somebody else', OUTSIDER);
  if (withMigration) applySql(db, MIGRATION);
  return db;
}

function addOkr(db: InstanceType<typeof DatabaseSync>, project: number, objective: string, status = 'next'): number {
  const r = db.prepare(
    'INSERT INTO roadmap_okrs (project_id, objective, kanban_status, key_results_json) VALUES (?,?,?,?)',
  ).run(project, objective, status, JSON.stringify([{ text: 'Ship it', target: 1 }]));
  return Number(r.lastInsertRowid);
}

const AUTH_ERROR_STATUSES: Record<string, 401 | 403> = { Unauthorized: 401, Forbidden: 403 };
const app = new Hono();
app.route('/', progress);
// The same mapping `index.ts` attaches. See `metric_definitions_route.test.ts` for
// why driving the sub-router alone turns a 403 into a 500.
app.onError((err: any, c) => {
  const mapped = AUTH_ERROR_STATUSES[(err?.message ?? '') as string];
  if (mapped) return c.json({ detail: err.message }, mapped);
  throw err;
});

const env = (db: InstanceType<typeof DatabaseSync>, block?: string) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, block),
} as any);

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const owner = { user: OWNER, role: 'founder' };
const outsider = { user: OUTSIDER, role: 'founder' };
const THIS_WEEK = weekStartOf(new Date().toISOString().slice(0, 10));

const logRows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT okr_id, from_status, to_status, week_start, moved_by FROM okr_column_moves ORDER BY id').all() as any[];

// ── the migration ─────────────────────────────────────────────────────────────

test('migration 252 carries no transaction statement', () => {
  const code = MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!new RegExp(`\\b${kw}\\b`, 'i').test(code), `migration 252 contains ${kw}`);
  }
});

test('the log is append-only: no unique index pins one move per week', () => {
  const db = freshDb();
  const idx = db.prepare("SELECT name, \"unique\" FROM pragma_index_list('okr_column_moves')").all() as any[];
  // An OKR may leave Now and come back in the same week, and both are facts.
  // Deduplicating them would erase the one case a founder most wants to see.
  assert.ok(idx.length >= 1, 'the log has no index at all');
  assert.ok(idx.every((i) => Number(i.unique) === 0), 'a unique index would collapse two real moves into one');
});

// ── the writer ────────────────────────────────────────────────────────────────

test('moving a card between columns logs the transition, with both ends', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addOkr(db, PROJECT, 'Ship the digest', 'next');
  const r = await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'now', sort_order: 0 });
  assert.equal(r.status, 200);
  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].okr_id, id);
  // BOTH ENDS. Without `from_status` a departure from Now is indistinguishable from
  // an arrival, and half of what the history is for is gone.
  assert.equal(rows[0].from_status, 'next');
  assert.equal(rows[0].to_status, 'now');
  assert.equal(rows[0].week_start, THIS_WEEK);
  assert.equal(rows[0].moved_by, OWNER);
});

test('a reorder inside one column logs nothing', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addOkr(db, PROJECT, 'Ship the digest', 'now');
  // Same status, different order — a drag within the Now column.
  await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'now', sort_order: 3 });
  await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'now', sort_order: 1 });
  // ZERO ROWS. A logged reorder would give every tidied card a commitment in the
  // current week, and `Carried only` would then be permanently empty — live,
  // selectable, and always wrong.
  assert.deepEqual(logRows(db), []);
  // And the reorder still took effect, so nothing was refused to achieve this.
  const okr = db.prepare('SELECT sort_order FROM roadmap_okrs WHERE id = ?').get(id) as any;
  assert.equal(okr.sort_order, 1);
});

test('leaving Now and coming back in one week logs both moves', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addOkr(db, PROJECT, 'Ship the digest', 'now');
  await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'next' });
  await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'now' });
  const rows = logRows(db);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.from_status, r.to_status]), [['now', 'next'], ['next', 'now']]);
});

test('a failed log write does not fail the move', async () => {
  const db = freshDb();
  // A D1 whose log table is missing — a preview Worker, a drifted migration ledger.
  const e = env(db, 'okr_column_moves');
  const id = addOkr(db, PROJECT, 'Ship the digest', 'next');
  const r = await call(e, 'POST', `/roadmap/okr/${id}/move`, owner, { kanban_status: 'now' });
  // 200, AND THE CARD MOVED. A card that moved on the board and then reported an
  // error is a card the founder drags again; the history is worth less than the
  // move it describes.
  assert.equal(r.status, 200);
  const okr = db.prepare('SELECT kanban_status FROM roadmap_okrs WHERE id = ?').get(id) as any;
  assert.equal(okr.kanban_status, 'now');
});

test('an outsider cannot move another venture’s card, so nothing is logged', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addOkr(db, PROJECT, 'Ours', 'next');
  const r = await call(e, 'POST', `/roadmap/okr/${id}/move`, outsider, { kanban_status: 'now' });
  assert.ok(r.status === 403 || r.status === 404, `outsider move got ${r.status}`);
  assert.deepEqual(logRows(db), []);
  const okr = db.prepare('SELECT kanban_status FROM roadmap_okrs WHERE id = ?').get(id) as any;
  assert.equal(okr.kanban_status, 'next');
});

// ── the read ──────────────────────────────────────────────────────────────────

test('the weeks endpoint returns id sets, this week, and where the history starts', async () => {
  const db = freshDb();
  const e = env(db);
  const a = addOkr(db, PROJECT, 'A', 'next');
  const b = addOkr(db, PROJECT, 'B', 'next');
  await call(e, 'POST', `/roadmap/okr/${a}/move`, owner, { kanban_status: 'now' });
  await call(e, 'POST', `/roadmap/okr/${b}/move`, owner, { kanban_status: 'now' });

  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, owner);
  assert.equal(r.status, 200);
  assert.deepEqual([...r.body.last_four].sort(), [a, b].sort());
  assert.deepEqual([...r.body.ever_committed].sort(), [a, b].sort());
  // Both were committed THIS week, so neither is carried.
  assert.deepEqual(r.body.carried, []);
  assert.deepEqual(r.body.weeks, [THIS_WEEK]);
  assert.equal(r.body.history_since, THIS_WEEK);
  assert.equal(r.body.week_start, THIS_WEEK);
});

test('history_since is the OLDEST week, not the newest', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addOkr(db, PROJECT, 'A', 'now');
  // Two weeks written directly, because the route can only ever stamp today.
  const ins = db.prepare(
    'INSERT INTO okr_column_moves (project_id, okr_id, to_status, week_start, moved_at) VALUES (?,?,?,?,?)',
  );
  ins.run(PROJECT, id, 'now', '2026-08-24', '2026-08-24T09:00:00Z');
  ins.run(PROJECT, id, 'now', '2026-09-07', '2026-09-07T09:00:00Z');
  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, owner);
  // `weeks` is newest-first, so the oldest is the LAST element. Taking `weeks[0]`
  // would tell a founder their history starts two weeks ago when it starts five.
  assert.deepEqual(r.body.weeks, ['2026-09-07', '2026-08-24']);
  assert.equal(r.body.history_since, '2026-08-24');
});

test('an objective in Now with no logged move is under This week only', async () => {
  const db = freshDb();
  const e = env(db);
  addOkr(db, PROJECT, 'Committed before the log existed', 'now');
  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, owner);
  // The seam migration 252 refuses to paper over with a guessed backfill.
  assert.deepEqual(r.body.last_four, []);
  assert.deepEqual(r.body.ever_committed, []);
  assert.deepEqual(r.body.carried, []);
  assert.equal(r.body.history_since, null);
});

test('the weeks endpoint answers empty rather than 500 when the log is absent', async () => {
  // A database that never got migration 252 and cannot create the table either.
  const db = freshDb(false);
  const e = env(db);
  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, owner);
  assert.equal(r.status, 200);
  // The zone degrades to the Now column, which is what it was before FB1 — not to
  // an error page.
  assert.deepEqual(r.body.last_four, []);
  assert.equal(r.body.week_start, THIS_WEEK);
});

test('one venture’s weeks never include another’s moves', async () => {
  const db = freshDb();
  const e = env(db);
  const mine = addOkr(db, PROJECT, 'Ours', 'next');
  const theirs = addOkr(db, OTHER_PROJECT, 'Theirs', 'next');
  await call(e, 'POST', `/roadmap/okr/${mine}/move`, owner, { kanban_status: 'now' });
  await call(e, 'POST', `/roadmap/okr/${theirs}/move`, outsider, { kanban_status: 'now' });
  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, owner);
  assert.deepEqual(r.body.ever_committed, [mine]);
});

test('an outsider cannot read another venture’s weeks', async () => {
  const db = freshDb();
  const e = env(db);
  const r = await call(e, 'GET', `/roadmap/${PROJECT}/weeks`, outsider);
  assert.ok(r.status === 403 || r.status === 404, `outsider read got ${r.status}`);
});
