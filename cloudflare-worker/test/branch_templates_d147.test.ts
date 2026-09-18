/**
 * D147 — HQ's master template library reaches a branch, and the branch says
 * what the copy is.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT "a table gets rows". `branch_benchmarks`
 * has sat in migration 256 since D106 with no writer and no reader (#252), and
 * `publishTemplate` was specified in F.5 and never built — so the failure mode
 * this programme keeps hitting is a producer that exists and is never called,
 * or a store that exists and is never read. These assertions run the real
 * writer against real SQLite through the `makeD1` shim, because the three
 * things that can go wrong here are all SQL-shaped: a withdrawal that does not
 * withdraw, a stamp that reads as this database's clock rather than HQ's, and
 * an empty push that cannot be told apart from no push at all.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_templates_d147.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { applyTemplateCopy } from '../src/rpc/branchOps.ts';
import branchTemplates from '../src/routes/branch_templates.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

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
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // THE BATCH RETURNS EACH STATEMENT'S RESULT, IN ORDER, because the writer
    // reads `meta.changes` off the LAST one to report what it withdrew. A shim
    // that returned `[]` — or that swallowed a throw into `{}` — would make the
    // withdrawal assertions pass vacuously, which is the trap D145 hit when two
    // assertions exercised a malformed env instead of the path they named.
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/**
 * The DDL sliced OFF MIGRATION 268 rather than retyped.
 *
 * A fixture narrower than the schema does not fail honestly — it makes the
 * route answer `available: false` about a table that is sitting right there,
 * which is the exact defect D133 and D138 each hit once. Slicing is the
 * `admin_impersonation_session.test.ts` precedent.
 */
function ddl(): string {
  const sql = readFileSync(new URL('../sql/migrations/268_branch_templates.sql', import.meta.url), 'utf8');
  const out = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim();
  assert.match(out, /CREATE TABLE IF NOT EXISTS branch_templates\b/, 'migration 268 must create the library table');
  assert.match(out, /CREATE TABLE IF NOT EXISTS branch_templates_sync\b/, 'migration 268 must create the sync row');
  return out;
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  ${ddl()}
`;

function db(withLibrary = true) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(withLibrary ? SCHEMA : `
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  d.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(ADMIN, 'admin', 'Sue', 'sue@axal.example');
  return d;
}

const base = { JWT_SECRET, ENVIRONMENT: 'development' };
const FR = { ...base, BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU', APP_URL: 'https://fr.axal.vc' };
const HQ = { ...base, APP_URL: 'https://axal.vc' };

const T = (slug: string, version = 1) => ({ slug, title: `${slug} title`, category: 'gp', version });

const app = new Hono<any>();
app.route('/branch', branchTemplates);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function get(env: Record<string, unknown>) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/branch/templates', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('the push stores the library and stamps it with HQ\'s time, not this database\'s', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  const out = await applyTemplateCopy(env, {
    templates: [T('operating_agreement', 4), T('side_letter', 2)],
    pushed_at: '2026-09-14T22:10:00Z',
  });
  assert.deepEqual(out, { ok: true, stored: 2, withdrawn: 0 });

  const rows = d.prepare('SELECT slug, title, category, version, pushed_at, updated_at FROM branch_templates ORDER BY slug').all() as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].slug, 'operating_agreement');
  assert.equal(rows[0].version, 4);
  // THE STAMP IS HQ'S. A copy whose age reads as its own write time lets a
  // week-old library render as live — migration 256's rule, and the one thing
  // every branch surface shows.
  assert.equal(rows[0].pushed_at, '2026-09-14T22:10:00Z');
  assert.notEqual(rows[0].updated_at, rows[0].pushed_at,
    'updated_at is this database\'s clock and must not be confused with HQ\'s stamp');
});

test('a template HQ no longer sends is WITHDRAWN, not left behind', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  await applyTemplateCopy(env, { templates: [T('a'), T('b'), T('c')], pushed_at: '2026-09-14T00:00:00Z' });
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM branch_templates').get()!.n, 3);

  // HQ drops `b` and adds `d`: a push that both adds AND withdraws, which is
  // the case a before/after difference reports as zero.
  const out = await applyTemplateCopy(env, {
    templates: [T('a'), T('c'), T('d')], pushed_at: '2026-09-15T00:00:00Z',
  });
  assert.equal(out.stored, 3);
  assert.equal(out.withdrawn, 1, 'exactly one slug fell out of the push');
  const slugs = (d.prepare('SELECT slug FROM branch_templates ORDER BY slug').all() as any[]).map((r) => r.slug);
  assert.deepEqual(slugs, ['a', 'c', 'd'], 'b must be gone and d must be here');
});

test('an EMPTY push is a real push: it clears the library and still records that HQ spoke', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  await applyTemplateCopy(env, { templates: [T('a')], pushed_at: '2026-09-14T00:00:00Z' });
  const out = await applyTemplateCopy(env, { templates: [], pushed_at: '2026-09-15T00:00:00Z' });
  assert.equal(out.stored, 0);
  assert.equal(out.withdrawn, 1);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM branch_templates').get()!.n, 0);
  // AND THE SYNC ROW SURVIVES, which is the whole reason it exists: an empty
  // table alone cannot say whether HQ sent nothing or has never sent.
  const sync = d.prepare('SELECT pushed_at, count FROM branch_templates_sync WHERE id = 1').get() as any;
  assert.equal(sync.pushed_at, '2026-09-15T00:00:00Z');
  assert.equal(sync.count, 0);
});

test('the push refuses to run on HQ', async () => {
  const d = db();
  await assert.rejects(
    () => applyTemplateCopy({ ...HQ, DB: makeD1(d) } as any, { templates: [T('a')], pushed_at: '2026-09-14T00:00:00Z' }),
    /only live on a branch/,
    'HQ authors the library; a push into HQ\'s own database would be a copy of itself',
  );
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM branch_templates').get()!.n, 0, 'and it wrote nothing');
});

test('a row with no slug or no title is dropped rather than stored blank', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  const out = await applyTemplateCopy(env, {
    templates: [T('good'), { slug: '', title: 'no slug' }, { slug: 'no_title', title: '   ' }],
    pushed_at: '2026-09-14T00:00:00Z',
  });
  assert.equal(out.stored, 1, 'only the usable row is stored');
  const slugs = (d.prepare('SELECT slug FROM branch_templates').all() as any[]).map((r) => r.slug);
  assert.deepEqual(slugs, ['good']);
});

test('the version is clamped to at least 1, so a malformed push cannot store v0', async () => {
  const d = db();
  const env = { ...FR, DB: makeD1(d) } as any;
  await applyTemplateCopy(env, {
    templates: [{ slug: 'a', title: 'A', category: 'gp', version: 0 }],
    pushed_at: '2026-09-14T00:00:00Z',
  });
  assert.equal((d.prepare('SELECT version FROM branch_templates WHERE slug = ?').get('a') as any).version, 1);
});

test('the branch route serves the copy with HQ\'s stamp and what the copy leaves behind', async () => {
  const d = db();
  await applyTemplateCopy({ ...FR, DB: makeD1(d) } as any, {
    templates: [T('operating_agreement', 4)], pushed_at: '2026-09-14T22:10:00Z',
  });
  const { status, body } = await get({ ...FR, DB: makeD1(d) });
  assert.equal(status, 200);
  assert.equal(body.branch, 'fr');
  assert.equal(body.available, true);
  assert.equal(body.pushed_at, '2026-09-14T22:10:00Z');
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].slug, 'operating_agreement');
  assert.equal(body.items[0].version, 4);
  assert.ok(!('never_pushed_reason' in body), 'a library that HAS been pushed must not claim otherwise');
  // THE ABSENCES TRAVEL WITH THE DATA. A page holding its own copy of these
  // reasons is a second place to update the day HQ starts sending a field, and
  // the one that does not get updated is the one that lies (D131's rule).
  const fields = (body.not_carried || []).map((n: any) => n.field);
  assert.deepEqual(fields, ['body_md', 'archived versions']);
  for (const n of body.not_carried) assert.ok(String(n.reason).length > 20, `${n.field} must carry a reason`);
});

test('NEVER PUSHED and PUSHED-BUT-EMPTY are different sentences', async () => {
  const fresh = db();
  {
    const { body } = await get({ ...FR, DB: makeD1(fresh) });
    assert.equal(body.available, true, 'the table is readable');
    assert.equal(body.pushed_at, null);
    assert.match(String(body.never_pushed_reason), /has not pushed/,
      'an untouched copy must say HQ has not pushed, not that HQ has nothing');
  }
  await applyTemplateCopy({ ...FR, DB: makeD1(fresh) } as any, { templates: [], pushed_at: '2026-09-15T00:00:00Z' });
  {
    const { body } = await get({ ...FR, DB: makeD1(fresh) });
    assert.equal(body.items.length, 0);
    assert.equal(body.pushed_at, '2026-09-15T00:00:00Z', 'a push happened and the stamp proves it');
    assert.ok(!('never_pushed_reason' in body),
      'once HQ has pushed, the page must stop claiming it has not');
  }
});

test('an UNREADABLE table is not an empty library', async () => {
  const { status, body } = await get({ ...FR, DB: makeD1(db(false)) });
  assert.equal(status, 200, 'the page still renders; only this block is unknown');
  assert.equal(body.available, false);
  assert.match(String(body.reason), /migration 268/);
  assert.match(String(body.reason), /not the same as HQ having pushed nothing/,
    'the reason must refuse to be read as a claim about HQ');
  assert.deepEqual(body.items, []);
});

test('the route refuses on HQ, where the library itself lives', async () => {
  const { status, body } = await get({ ...HQ, DB: makeD1(db()) });
  assert.equal(status, 403);
  assert.match(String(body.detail), /branch/i);
});
