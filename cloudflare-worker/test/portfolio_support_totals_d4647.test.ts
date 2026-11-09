/**
 * D4647 (#4647) — the support ledger's totals count the whole authorized
 * population, and an outstanding promise stays reachable.
 *
 * WHAT WAS WRONG. `GET /api/portfolio-support` read the ledger with a bare
 * `LIMIT 400` and then accumulated every figure it reports — `totals`, the
 * per-company rollup, and `untouched` — from those rows in JavaScript. There
 * was no `COUNT(*)` anywhere in the file. So on a book with more than 400
 * entries every one of those figures silently understated the work, on the one
 * desk whose stated purpose is to make that work auditable. The page beside
 * them printed `entries.length` as "N recorded entries", which was the page's
 * length, not the ledger's.
 *
 * The order was `created_at DESC` alone. `created_at` is a second-resolution
 * stamp, so entries written in one request tie and the order is not total: a
 * reader paging back could miss a row or see it twice. And there was no way to
 * ask for one state, so an outstanding promise older than the newest page
 * could not be reached at all — which is the same defect, in effect, as the
 * "status written once and never updated" that this route's own header says it
 * exists to end.
 *
 * Both are driven here against real SQLite with MORE ENTRIES THAN ONE PAGE,
 * because that is the only shape in which the old code was wrong.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_support_totals_d4647.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import support from '../src/routes/portfolio_support.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MINE = 41, OTHER = 42, LONER = 43, ADMIN = 44;
const PROJ_A = 7, PROJ_B = 8, PROJ_C = 9;

/**
 * THE REAL SCHEMA, as `test/README.md` requires: the baseline plus every
 * numbered migration, built once and replayed per test. A handler that would
 * fail on D1 because of an unknown column fails here too, so the grouped
 * rollup below is held to the table as it is actually deployed rather than to
 * a copy of migration 237 that could drift from it.
 */
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as Array<{ sql: string }>).map(r => r.sql);
})();

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const stmt of BUILT_DDL) { try { db.exec(stmt); } catch { /* a view or trigger naming an object replayed later */ } }
  // Every column the real table requires, and nothing it does not: a column
  // left out takes the schema's own default, which is what a real row does.
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(MINE, 'investor', 'Mine Investor', 'mine@example.test');
  u.run(OTHER, 'investor', 'Other Investor', 'other@example.test');
  u.run(LONER, 'investor', 'Loner Investor', 'loner@example.test');
  u.run(ADMIN, 'admin', 'Ada Admin', 'admin@example.test');
  db.prepare("UPDATE users SET investor_tier = 'institutional' WHERE role = 'investor'").run();
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)');
  p.run(PROJ_A, 'p-alpha', 'Alpha', 1);
  p.run(PROJ_B, 'p-beta', 'Beta', 2);
  p.run(PROJ_C, 'p-gamma', 'Gamma', 3);
  const d = db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)');
  d.run(71, 'd-a', PROJ_A); d.run(72, 'd-b', PROJ_B); d.run(73, 'd-c', PROJ_C);
  const m = db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, ?)');
  m.run(MINE, 71); m.run(MINE, 73); m.run(OTHER, 72);
  const pos = db.prepare('INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, ?, ?)');
  pos.run('pos-a', PROJ_A, 'Seed', 500000);
  pos.run('pos-b', PROJ_B, 'Seed', 400000);
  pos.run('pos-c', PROJ_C, 'Seed', 300000);
  return db;
}

/**
 * `n` entries on `project`, all stamped the same second so the order is only
 * total if it breaks the tie by id, and cycling through the three states with
 * one hour each on every third so some hours are unrecorded.
 */
function seed(db: InstanceType<typeof DatabaseSync>, project: number, n: number, prefix: string, stamp = '2026-10-01 09:00:00') {
  const ins = db.prepare(
    `INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
     VALUES (?, ?, 'intro', ?, ?, ?, ?, ?, ?)`,
  );
  const states = ['promised', 'delivered', 'withdrawn'];
  for (let i = 0; i < n; i += 1) {
    ins.run(`${prefix}-${i}`, project, states[i % 3], i % 3 === 0 ? null : 1, `Entry ${i}`, MINE, stamp, stamp);
  }
}

const env = (db: unknown): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
async function call(route: any, db: unknown, who: { user: number; role: string }, path: string) {
  const jwt = await new SignJWT({ user_id: who.user, role: who.role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await route.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' } }), env(db));
  return { status: r.status, body: await r.json() as any };
}

// ── The totals ──────────────────────────────────────────────────────────────

test('every total counts the whole authorized ledger, not the page that is listed', async () => {
  const db = freshDb();
  // 450 entries on one company and 30 on another: more than one page of 400.
  seed(db, PROJ_A, 450, 'a');
  seed(db, PROJ_C, 30, 'c');
  seed(db, PROJ_B, 12, 'b');           // another firm's book: counted by nobody here
  const r = await call(support, db, { user: MINE, role: 'investor' }, '/');
  assert.equal(r.status, 200);
  // 480 of mine: 160 promised, 160 delivered, 160 withdrawn (450 and 30 are
  // both multiples of 3), and a third of them carry no hours.
  assert.equal(r.body.totals.entries_total, 480, 'the total is the ledger’s, not the page’s');
  assert.deepEqual([r.body.totals.promised, r.body.totals.delivered, r.body.totals.withdrawn], [160, 160, 160]);
  assert.equal(r.body.totals.entries_without_hours, 160, 'an entry with no hours is counted, never summed as zero');
  assert.equal(r.body.totals.hours_recorded, 320, 'and the hours that ARE recorded are all of them');
  assert.equal(r.body.entries.length, 400, 'the page itself stays bounded');
  assert.equal(r.body.page.has_more, true);
  // The per-company rollup is grouped in SQL too, so neither company is short.
  const byId = new Map(r.body.companies.map((x: any) => [x.project_id, x]));
  assert.equal(byId.get(PROJ_A).entries, 450);
  assert.equal(byId.get(PROJ_C).entries, 30);
  assert.equal(byId.get(PROJ_B), undefined, 'another firm’s company is not in the rollup');
  assert.equal(r.body.totals.companies_in_book, 2);
  assert.equal(r.body.totals.companies_supported, 2);
  db.close();
});

test('a company in the book with no entry is still reported untouched, with a full ledger', async () => {
  const db = freshDb();
  seed(db, PROJ_A, 420, 'a');
  const r = await call(support, db, { user: MINE, role: 'investor' }, '/');
  assert.deepEqual(r.body.untouched.map((x: any) => x.project_id), [PROJ_C]);
  assert.equal(r.body.totals.companies_in_book, 2);
  assert.equal(r.body.totals.companies_supported, 1);
  assert.equal(r.body.totals.entries_total, 420);
  db.close();
});

test('an empty accessible set is answered before the query, with the same shape', async () => {
  const db = freshDb();
  seed(db, PROJ_A, 5, 'a');
  const r = await call(support, db, { user: LONER, role: 'investor' }, '/');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.entries, r.body.companies, r.body.untouched], [[], [], []]);
  assert.equal(r.body.totals.entries_total, 0);
  assert.deepEqual(Object.keys(r.body.totals).sort(), ['companies_in_book', 'companies_supported', 'delivered',
    'entries_total', 'entries_without_hours', 'hours_recorded', 'promised', 'withdrawn']);
  assert.deepEqual(r.body.page, { limit: 400, state: null, returned: 0, has_more: false, next_before: null });
  db.close();
});

// ── Reaching every record ───────────────────────────────────────────────────

test('an outstanding promise older than the newest page is still reachable by state', async () => {
  const db = freshDb();
  // The oldest entry is the only promise; 500 delivered rows were written after.
  db.prepare(`INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
    VALUES ('old-promise', ?, 'intro', 'promised', NULL, 'Promised an intro to a buyer at Northwind', ?, '2026-01-01 09:00:00', '2026-01-01 09:00:00')`)
    .run(PROJ_A, MINE);
  const ins = db.prepare(`INSERT INTO portfolio_support_entries (uid, project_id, kind, state, hours, summary, recorded_by, created_at, updated_at)
    VALUES (?, ?, 'hiring', 'delivered', 1, 'Later work', ?, '2026-10-01 09:00:00', '2026-10-01 09:00:00')`);
  for (let i = 0; i < 500; i += 1) ins.run(`later-${i}`, PROJ_A, MINE);

  const all = await call(support, db, { user: MINE, role: 'investor' }, '/');
  assert.ok(!all.body.entries.some((x: any) => x.uid === 'old-promise'), 'it is off the newest page, as it was before');
  assert.equal(all.body.totals.promised, 1, 'and the totals have always counted it');

  const open = await call(support, db, { user: MINE, role: 'investor' }, '/?state=promised');
  assert.deepEqual(open.body.entries.map((x: any) => x.uid), ['old-promise'], 'asking for the state reaches it');
  assert.equal(open.body.page.state, 'promised');
  assert.equal(open.body.page.has_more, false);
  // Narrowing the page never narrows what is counted.
  assert.equal(open.body.totals.entries_total, 501);
  assert.equal(open.body.totals.delivered, 500);
  db.close();
});

test('the page is ordered by id too, so entries stamped the same second page back without loss', async () => {
  const db = freshDb();
  seed(db, PROJ_A, 12, 'a');           // all one second apart: nothing but id breaks the tie
  const first = await call(support, db, { user: MINE, role: 'investor' }, '/?limit=5');
  assert.equal(first.body.entries.length, 5);
  assert.equal(first.body.page.has_more, true);
  const second = await call(support, db, { user: MINE, role: 'investor' }, `/?limit=5&before=${first.body.page.next_before}`);
  const third = await call(support, db, { user: MINE, role: 'investor' }, `/?limit=5&before=${second.body.page.next_before}`);
  const seen = [...first.body.entries, ...second.body.entries, ...third.body.entries].map((x: any) => x.uid);
  assert.equal(new Set(seen).size, seen.length, 'no entry is listed twice across the pages');
  assert.equal(seen.length, 12, 'and none is skipped');
  assert.equal(third.body.page.has_more, false);
  assert.equal(third.body.page.next_before, null);
  // Descending by id: the newest first, the oldest last.
  assert.deepEqual([seen[0], seen[seen.length - 1]], ['a-11', 'a-0']);
  db.close();
});

test('the page width is bounded and a bad one falls back rather than failing', async () => {
  const db = freshDb();
  seed(db, PROJ_A, 9, 'a');
  const wide = await call(support, db, { user: MINE, role: 'investor' }, '/?limit=100000');
  assert.equal(wide.body.page.limit, 400);
  for (const bad of ['0', '-3', 'nine', '2.5']) {
    const r = await call(support, db, { user: MINE, role: 'investor' }, `/?limit=${bad}`);
    assert.equal(r.body.page.limit, 400, bad);
  }
  const junkCursor = await call(support, db, { user: MINE, role: 'investor' }, '/?before=not-a-number');
  assert.equal(junkCursor.body.entries.length, 9, 'an unreadable cursor reads the newest page, never none');
  const badState = await call(support, db, { user: MINE, role: 'investor' }, '/?state=pending');
  assert.equal(badState.status, 400, 'an unknown state is refused rather than silently ignored');
  db.close();
});

test('an admin is not narrowed, and still gets whole-ledger totals', async () => {
  const db = freshDb();
  seed(db, PROJ_A, 6, 'a');
  seed(db, PROJ_B, 6, 'b');
  const r = await call(support, db, { user: ADMIN, role: 'admin' }, '/');
  assert.equal(r.body.totals.entries_total, 12);
  assert.equal(r.body.companies.length, 3, 'every company in the firm’s book');
  db.close();
});

// ── Mutation and restoration ────────────────────────────────────────────────

const SELF = new URL(import.meta.url).pathname;
function childEnv() {
  const env2 = { ...process.env };
  for (const key of Object.keys(env2)) if (key.startsWith('NODE_TEST')) delete env2[key];
  return env2;
}
const run = (pattern: string) => spawnSync(process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    '--test', '--test-name-pattern', pattern, SELF],
  { cwd: resolve(ROOT), encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...childEnv(), D4647_SKIP_MUTATIONS: '1' } });

const ROUTE = 'cloudflare-worker/src/routes/portfolio_support.ts';
const CHECKS = [
  { name: 'the totals are grouped over the whole population, not the page', file: ROUTE,
    before: '    for (const g of rollupRows) {', after: '    for (const g of rows.map(() => ({ project_id: 0, entries: 0, delivered: 0, withdrawn: 0, promised: 0, entries_without_hours: 0, hours: 0, project_uid: null, project_name: null }))) {',
    pattern: 'whole authorized ledger' },
  { name: 'the rollup ignores the page’s cursor and state', file: ROUTE,
    before: `          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
          GROUP BY s.project_id\`,`,
    after: `          WHERE (? IS NULL OR instr(',' || ? || ',', ',' || CAST(s.project_id AS TEXT) || ',') > 0)
            AND s.state = 'promised'
          GROUP BY s.project_id\`,`,
    pattern: 'still reachable by state' },
  { name: 'the order breaks ties by id', file: ROUTE,
    before: '          ORDER BY s.created_at DESC, s.id DESC', after: '          ORDER BY s.created_at DESC',
    pattern: 'page back without loss' },
  { name: 'the cursor narrows the page', file: ROUTE,
    before: '            AND (? IS NULL OR s.id < ?)', after: '            AND (? IS NULL OR ? > 0)',
    pattern: 'page back without loss' },
  { name: 'a state narrows the listing in SQL', file: ROUTE,
    before: '            AND (? IS NULL OR s.state = ?)', after: '            AND (? IS NULL OR ? IS NOT NULL)',
    pattern: 'still reachable by state' },
  { name: 'has_more comes from the extra row read', file: ROUTE,
    before: '    const hasMore = read.length > page.limit;', after: '    const hasMore = false;',
    pattern: 'whole authorized ledger' },
  { name: 'the page width is capped', file: ROUTE,
    before: '  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, PAGE_MAX) : PAGE_DEFAULT;',
    after: '  const limit = Number.isInteger(asked) && asked > 0 ? asked : PAGE_DEFAULT;',
    pattern: 'width is bounded' },
  { name: 'an unknown state is refused', file: ROUTE,
    before: "    if (page.stateAsked != null && page.state == null) return c.json({ detail: 'state must be promised, delivered or withdrawn' }, 400);",
    after: '', pattern: 'width is bounded' },
  { name: 'the empty answer carries the same totals', file: ROUTE,
    before: '        entries: [], companies: [], untouched: [], totals: { ...NO_TOTALS },',
    after: '        entries: [], companies: [], untouched: [], totals: { delivered: 0, promised: 0, withdrawn: 0 },',
    pattern: 'answered before the query' },
];

if (!process.env.D4647_SKIP_MUTATIONS) {
  test('every check’s tests pass against the source before any mutation', () => {
    for (const pattern of new Set(CHECKS.map(c => c.pattern))) {
      const r = run(pattern);
      assert.equal(r.status, 0, `${pattern} did not pass unmutated: ${(r.stdout ?? '').slice(-1500)}`);
      assert.match(r.stdout ?? '', /# fail 0/, pattern);
      assert.doesNotMatch(r.stdout ?? '', /# pass 0\n/, `${pattern} matched no test`);
    }
  });

  for (const check of CHECKS) test(`Mutation and restoration: ${check.name}`, () => {
    const file = resolve(ROOT, check.file);
    const original = readFileSync(file, 'utf8');
    assert.ok(original.includes(check.before), `mutation_target_missing: ${check.name}`);
    assert.equal(original.split(check.before).length - 1, 1, `mutation target is not unique: ${check.name}`);
    let result;
    try {
      writeFileSync(file, original.replace(check.before, check.after));
      result = run(check.pattern);
    } finally { writeFileSync(file, original); }
    assert.notEqual(result.status, 0, `the mutation went unnoticed by "${check.pattern}": ${(result.stdout ?? '').slice(-1500)}`);
    assert.equal(readFileSync(file, 'utf8'), original, 'the source was not restored');
  });
}
