/**
 * `/build/kpi`'s two new endpoints: what a metric MEANS, and a spreadsheet import.
 *
 * `metrics_csv.test.ts` covers the parser line by line without a database. This
 * file covers what only a route can be wrong about: who may write, what the upsert
 * does on a second call, and — the one that matters most — that an import cannot
 * overwrite a figure a founder entered by hand.
 *
 * THE FIXTURE APPLIES MIGRATIONS 249 AND 251, never a hand-written DDL. A
 * hand-copied `project_metrics` is exactly how a suite passes while production has
 * a different schema, which is the whole of #203.
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

/**
 * The router MOUNTED THE WAY PRODUCTION MOUNTS IT, which a test found out the hard
 * way.
 *
 * `progress.ts`'s gates refuse by `throw new Error('Forbidden')`, and nothing in
 * that file turns the throw into a status — `index.ts`'s app-level `onError` does,
 * via a table whose own comment says why: "Without this, RBAC failures surface as
 * 500s and the frontend can't distinguish 'log in again' from 'the server
 * crashed'." Driving the sub-router alone therefore returns 500 for a refusal that
 * is a 403 in production, and a test that accepted either would be asserting the
 * harness rather than the gate.
 *
 * So the same mapping is attached here. It is a second copy of three lines, which
 * is worth it for the alternative: every access assertion in this file would have
 * to accept `500` as a pass, and a genuine crash would then read as a refusal.
 */
const AUTH_ERROR_STATUSES: Record<string, 401 | 403> = {
  Unauthorized: 401,
  Forbidden: 403,
  'Admin required': 403,
};
const app = new Hono();
app.route('/', progress);
app.onError((err: any, c) => {
  const mapped = AUTH_ERROR_STATUSES[(err?.message ?? '') as string];
  if (mapped) return c.json({ detail: err.message }, mapped);
  throw err;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
const DEFS_MIGRATION = migration('251_metric_definitions');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OWNER = 80;
const OUTSIDER = 81;
const ADMIN = 82;
const PROJECT = 9201;
const OTHER_PROJECT = 9202;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

function applySql(db: InstanceType<typeof DatabaseSync>, sql: string) {
  for (const stmt of sql.replace(/^\s*--.*$/gm, '').split(';')) if (stmt.trim()) db.exec(stmt);
}

function freshDb() {
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
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?,?,?)');
  u.run(OWNER, 'founder', OWNER);
  u.run(OUTSIDER, 'founder', OUTSIDER);
  u.run(ADMIN, 'admin', null);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?,?,?)');
  p.run(PROJECT, 'Bellwether', OWNER);
  p.run(OTHER_PROJECT, 'Somebody else', OUTSIDER);
  applySql(db, migration('249_project_metrics'));
  applySql(db, DEFS_MIGRATION);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({
  JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db),
} as any);

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
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
const admin = { user: ADMIN, role: 'admin' };

// ── migration 251 ─────────────────────────────────────────────────────────────

test('migration 251 carries no transaction statement', () => {
  const code = DEFS_MIGRATION.replace(/^\s*--.*$/gm, '');
  for (const kw of ['BEGIN', 'COMMIT', 'ROLLBACK', 'END TRANSACTION']) {
    assert.ok(!new RegExp(`\\b${kw}\\b`, 'i').test(code),
      `migration 251 contains ${kw} — D1 rejects it`);
  }
});

test('a definition does not require a target', () => {
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(metric_definitions)').all() as any[];
  const notNull = new Set(cols.filter((c) => c.notnull).map((c) => c.name));
  // THE WHOLE REASON THIS IS NOT A COLUMN ON `metric_targets`, whose `target_value`
  // is NOT NULL: defining "net burn" without committing to a plan number for it
  // would otherwise have to invent one, and "4 of 6 against target" would then
  // count a metric nobody set a target for.
  assert.ok(notNull.has('definition'));
  assert.ok(!cols.some((c) => c.name === 'target_value'));
});

// ── definitions ───────────────────────────────────────────────────────────────

test('a definition round-trips and its keys come from the route', async () => {
  const e = env(freshDb());
  const before = await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner);
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.items, []);
  // The picker's options are the route's own list, so a form cannot offer a key the
  // write refuses — the convention #194's targets editor set.
  assert.ok(before.body.keys.includes('net_burn'));
  assert.deepEqual(before.body.sources, ['manual', 'stripe', 'derived']);

  const put = await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, {
    metric_key: 'net_burn', definition: 'Operating cash out minus cash in.', source_kind: 'manual',
  });
  assert.equal(put.status, 200);
  const after = (await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body;
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].metric_key, 'net_burn');
  assert.equal(after.items[0].definition, 'Operating cash out minus cash in.');
  assert.equal(after.items[0].updated_at, null);
});

test('a second write to one metric edits the same row and stamps updated_at', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'net_burn', definition: 'First.' });
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'net_burn', definition: 'Second, clearer.' });
  const after = (await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body;
  // ONE ROW. `UNIQUE (project_id, metric_key)` says there is exactly one definition
  // per metric; two would be two answers to the same question, and the page would
  // show whichever the ORDER BY happened to pick.
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].definition, 'Second, clearer.');
  assert.ok(after.items[0].updated_at);
});

test('definition: null clears it, and a blank string is a 400', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'mrr', definition: 'Recurring only.' });
  // A blank string cannot double as "clear": `trim()` would make a founder who typed
  // only spaces indistinguishable from one deleting the row.
  const blank = await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'mrr', definition: '   ' });
  assert.equal(blank.status, 400);
  assert.equal((await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body.items.length, 1);

  const cleared = await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'mrr', definition: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body.items, []);
});

test('an unknown metric_key is refused with the list that would work', async () => {
  const e = env(freshDb());
  const r = await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, {
    metric_key: 'vibes', definition: 'Good.',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /Unknown metric_key: vibes/);
  // The 400 carries the keys, so the caller can correct itself rather than guess.
  assert.ok(Array.isArray(r.body.keys) && r.body.keys.includes('mrr'));
});

test('an unrecognised source_kind falls back to manual rather than being stored', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, {
    metric_key: 'mrr', definition: 'Recurring only.', source_kind: 'telepathy',
  });
  const item = (await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body.items[0];
  // Storing 'telepathy' would put a value in the column that no reader knows how to
  // draw, and the comparison against `project_metrics.source` — the finding this
  // column exists for — would silently never match.
  assert.equal(item.source_kind, 'manual');
});

test('an outsider cannot read or write another venture’s definitions', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'mrr', definition: 'Ours.' });
  // 403 EXACTLY, not "403 or 404 or 500". A refusal that arrives as a 500 is a
  // crash as far as the SPA is concerned, and the app-level mapping above is what
  // makes the difference — see its note.
  assert.equal((await call(e, 'GET', `/metrics/${PROJECT}/definitions`, outsider)).status, 403);
  assert.equal((await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, outsider, {
    metric_key: 'mrr', definition: 'Theirs now.',
  })).status, 403);
  // And the row is untouched, which is the assertion a status code alone does not make.
  const item = (await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body.items[0];
  assert.equal(item.definition, 'Ours.');
});

test('an admin may write a definition', async () => {
  const e = env(freshDb());
  const r = await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, admin, {
    metric_key: 'mrr', definition: 'Set by the studio.',
  });
  assert.equal(r.status, 200);
});

test('definitions are per project and do not leak across them', async () => {
  const e = env(freshDb());
  await call(e, 'PUT', `/metrics/${PROJECT}/definitions`, owner, { metric_key: 'mrr', definition: 'Ours.' });
  await call(e, 'PUT', `/metrics/${OTHER_PROJECT}/definitions`, outsider, { metric_key: 'mrr', definition: 'Theirs.' });
  assert.equal((await call(e, 'GET', `/metrics/${PROJECT}/definitions`, owner)).body.items[0].definition, 'Ours.');
  assert.equal((await call(e, 'GET', `/metrics/${OTHER_PROJECT}/definitions`, outsider)).body.items[0].definition, 'Theirs.');
});

// ── the CSV import ────────────────────────────────────────────────────────────

const CSV = 'month,MRR,Net burn,Headcount\n2026-07,98400,58000,4\n2026-08,"104,800","61,200",5\n';

test('a dry run writes nothing and reports what it would do', async () => {
  const db = freshDb();
  const e = env(db);
  const r = await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: CSV, dry_run: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.written, 0);
  assert.equal(r.body.would_write, 2);
  assert.equal(r.body.dry_run, true);
  // NOTHING IN THE TABLE. A "preview" that writes is not a preview, and this is the
  // one assertion that distinguishes them.
  const count = db.prepare('SELECT COUNT(*) n FROM project_metrics').get() as any;
  assert.equal(count.n, 0);
});

test('a real import writes one row per month, with source csv', async () => {
  const db = freshDb();
  const e = env(db);
  const r = await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: CSV });
  assert.equal(r.status, 200);
  assert.equal(r.body.written, 2);
  assert.deepEqual(r.body.months, ['2026-07-01', '2026-08-01']);
  const rows = db.prepare(
    'SELECT snapshot_date, mrr, net_burn, headcount, source FROM project_metrics ORDER BY snapshot_date',
  ).all() as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[1].mrr, 104800);
  assert.equal(rows[1].net_burn, 61200);
  assert.equal(rows[1].headcount, 5);
  // `csv` and not `manual`. The unique index is `(project_id, snapshot_date,
  // source)`, so this is what keeps an import out of the founder's own rows.
  assert.equal(rows[1].source, 'csv');
});

test('an import cannot overwrite a figure the founder entered by hand', async () => {
  const db = freshDb();
  const e = env(db);
  // A hand entry for August, through the route the KPI form uses.
  const manual = await call(e, 'POST', `/metrics/${PROJECT}`, owner, {
    snapshot_date: '2026-08-01', mrr: 99999, source: 'manual',
  });
  assert.equal(manual.status, 200);

  await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: CSV });
  const rows = db.prepare(
    "SELECT source, mrr FROM project_metrics WHERE snapshot_date = '2026-08-01' ORDER BY source",
  ).all() as any[];
  // TWO ROWS FOR AUGUST, and that is correct: a founder's figure and an import's
  // figure are two claims, kept apart by `source`. The hand-entered 99999 survives.
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.source, r.mrr]), [['csv', 104800], ['manual', 99999]]);
});

test('re-importing a corrected file updates the import’s own rows rather than adding a set', async () => {
  const db = freshDb();
  const e = env(db);
  await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: CSV });
  await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, {
    csv: 'month,MRR\n2026-08,111000\n',
  });
  const rows = db.prepare(
    "SELECT snapshot_date, mrr, net_burn FROM project_metrics WHERE source = 'csv' ORDER BY snapshot_date",
  ).all() as any[];
  assert.equal(rows.length, 2);
  const august = rows.find((r) => r.snapshot_date === '2026-08-01');
  assert.equal(august.mrr, 111000);
  // AND THE BURN THE FIRST FILE CARRIED SURVIVES. `DO UPDATE` uses COALESCE, so a
  // second file covering only MRR does not blank the columns it does not mention —
  // which is the difference between a correction and a truncation.
  assert.equal(august.net_burn, 61200);
});

test('a file with one good row and one bad reports both and writes one', async () => {
  const db = freshDb();
  const e = env(db);
  const r = await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, {
    csv: 'month,MRR\n2026-07,98400\nnonsense,1\n',
  });
  assert.equal(r.body.written, 1);
  assert.equal(r.body.rejected.length, 1);
  assert.equal(r.body.rejected[0].line, 3);
  const count = db.prepare('SELECT COUNT(*) n FROM project_metrics').get() as any;
  assert.equal(count.n, 1);
});

test('a file nothing can be read from writes nothing and still returns the reason', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: 'a,b\n1,2\n' });
  assert.equal(r.status, 200);
  assert.equal(r.body.written, 0);
  // A 200 with a reason rather than a 400: nothing about the REQUEST was malformed,
  // and the founder needs the sentence, not a status code.
  assert.ok(r.body.rejected.length >= 1);
  assert.match(r.body.rejected[0].reason, /no month column/);
});

test('an oversized paste is refused before it is parsed', async () => {
  const e = env(freshDb());
  const r = await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, owner, { csv: 'x'.repeat(512_001) });
  assert.equal(r.status, 413);
});

test('an outsider cannot import into another venture’s ledger', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal((await call(e, 'POST', `/metrics/${PROJECT}/import-csv`, outsider, { csv: CSV })).status, 403);
  const count = db.prepare('SELECT COUNT(*) n FROM project_metrics').get() as any;
  assert.equal(count.n, 0);
});
