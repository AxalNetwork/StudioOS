/**
 * D208 — a content escalation names what it concerns, in the branch's own
 * words, and HQ reads those words byte for byte.
 *
 * WHAT THIS FILE HOLDS, each a way the label goes quietly wrong:
 *
 *   1. ONE FORMAT. `concernLabel` builds both what the drawer lists and what the
 *      route stores. A second format — one for the menu, one for the row — is
 *      how a pick and its record drift apart, so the headline test here follows
 *      one label from the GET, through HQ's own `recordEscalation`, into the
 *      branch's row and back out of the 201, and asserts it never changed.
 *   2. THE LIST NEVER THROWS, AND NEVER LIES ABOUT EMPTINESS. Each source is read
 *      in its own try and answers for itself. A source that cannot be read is
 *      its own state with its reason — never `listed: 0`, which would claim the
 *      branch holds nothing to name — and neither failure takes the lane down.
 *   3. THE PICK IS READ AGAIN AT THE RAISE, NEVER TAKEN FROM THE CLIENT. A title
 *      changed after the list was read goes out under its new name; a label the
 *      client sends is ignored; an item removed since is refused.
 *   4. EVERY REFUSAL SENDS NOTHING AND STORES NOTHING — the D206 rule for a
 *      refusal, applied to a lookup. Each case asserts HQ was not called and the
 *      lane holds no row, which is also what proves the resolution runs BEFORE
 *      HQ is called: moved after it, every one of these would reach HQ.
 *
 * Every table comes off disk — the baseline's `articles`, migration 268's
 * `branch_templates`, the four migrations that shaped the licence copy, 261's
 * lane, and HQ's 258/259/279 — so a fixture narrower than the schema (the D133
 * trap) cannot make a read fail and pass for the behaviour under test.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_concerns_d208.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import branchEscalationRoutes from '../src/routes/branch_escalations.ts';
import { recordEscalation } from '../src/rpc/hqOps.ts';
import {
  concernLabel, listConcerns, parseConcern, CONCERN_ARTICLE_CAP, CONCERN_LABEL_MAX, CONCERNS_NOTE,
} from '../src/services/escalationConcerns.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (name: string) => read(`cloudflare-worker/sql/migrations/${name}.sql`);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;
const PUSHED = '2026-09-20T00:00:00Z';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/** A D1 over `node:sqlite`, recording every statement it was asked to run. */
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const reads: string[] = [];
  return {
    reads,
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { reads.push(sql); return db.prepare(sql).get(...b) ?? null; },
        async all() { reads.push(sql); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          reads.push(sql);
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/* ------------------------------------------------------------------ *
 * Fixtures, production-shaped                                         *
 * ------------------------------------------------------------------ */

/**
 * A branch: its licence copy (256, 257, 265, 284), its lane (261), HQ's template
 * library as pushed to it (268) and its own articles (the baseline's table),
 * each of the last three removable to prove a missing one answers for itself.
 */
function branchDb(opts: {
  kind?: string | null; lane?: boolean; templates?: boolean; articles?: boolean;
} = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(ADMIN, 'admin', 'Claire Dubois', 'claire@fr.example');
  for (const m of ['256_branch_local_copies', '257_branch_licence_ref', '265_branch_licence_entity', '284_branch_licence_kind']) {
    run(db, migration(m));
  }
  db.prepare(
    `INSERT INTO branch_licence (id, licence_uid, licence_ref, status, kind, pushed_at)
     VALUES (1, 'lic_fr', 'AXL-001', 'active', ?, ?)`,
  ).run(opts.kind === undefined ? 'subsidiary' : opts.kind, PUSHED);
  if (opts.lane !== false) {
    run(db, migration('259_hq_escalations'));
    run(db, migration('261_branch_escalations'));
    run(db, migration('288_escalation_delivery'));
  }
  if (opts.templates !== false) run(db, migration('268_branch_templates'));
  if (opts.articles !== false) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'articles')));
  return db;
}

/**
 * Four templates, chosen so the order proves the collation and the tiebreak:
 * under BINARY, 'Licence' and 'Service' sort above 'addendum' (upper case is
 * lower in ASCII); under NOCASE, 'addendum' comes first. And two share a title,
 * so their slugs are what orders them — and what tells them apart in a label.
 */
function seedTemplates(db: InstanceType<typeof DatabaseSync>) {
  const t = db.prepare(
    'INSERT INTO branch_templates (slug, title, category, version, pushed_at, updated_at) VALUES (?,?,?,?,?,?)',
  );
  t.run('service-agreement', 'Service agreement', 'portfolio', 2, PUSHED, PUSHED);
  t.run('licence-agreement-fr', 'Licence agreement', 'gp', 1, PUSHED, PUSHED);
  t.run('licence-agreement', 'Licence agreement', 'gp', 4, PUSHED, PUSHED);
  t.run('dpa-addendum', 'addendum on data processing', 'compliance', 1, PUSHED, PUSHED);
}

/** Three articles inserted out of id order, so "newest first" is by id, not by insertion. */
function seedArticles(db: InstanceType<typeof DatabaseSync>) {
  const a = db.prepare('INSERT INTO articles (id, slug, title, author_user_id) VALUES (?,?,?,?)');
  a.run(7, 'launch-post', 'Launch post', ADMIN);
  a.run(11, 'q3-portfolio-letter', 'Q3 portfolio letter', ADMIN);
  a.run(3, 'hello-lyon', 'Hello, Lyon', ADMIN);
}

const lane = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM branch_escalations').all() as any[];

/**
 * HQ, for the one test that follows a label all the way into HQ's ledger: the
 * licence ledger from the baseline with 279's `kind`, the deployment registry,
 * and 259's escalation table. `content` is a gated kind (D206), so HQ reads the
 * licence's kind before recording — a subsidiary, so it records.
 */
function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'territory_licences')));
  for (const m of ['258_licence_deployments', '259_hq_escalations', '261_branch_escalations', '279_licence_kind', '288_escalation_delivery']) run(db, migration(m));
  db.prepare(
    `INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind)
     VALUES (1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active', 'subsidiary')`,
  ).run();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'live')`,
  ).run();
  return db;
}

/** A stub HQ: records each call and mints its own uid per raise (261's `hq_uid` is UNIQUE). */
function stubHq() {
  const seen: Array<{ code: string; item: any }> = [];
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        return { uid: `esc_${seen.length}`, due_at: '2026-09-25T00:00:00Z', status: 'open' };
      },
    },
  };
}

/** HQ for real: the binding hands the item to `recordEscalation` over HQ's own database. */
function realHq(hq: InstanceType<typeof DatabaseSync>) {
  const seen: Array<{ code: string; item: any }> = [];
  const env = { DB: makeD1(hq) } as any;
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        return recordEscalation(env, code, item);
      },
    },
  };
}

async function bearer() {
  return new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function branchApp(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.route('/api/branch', branchEscalationRoutes);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
  return async (path: string, init: RequestInit = {}) => {
    const res = await app.request(`/api/branch${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await bearer()}` },
    }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

const BRANCH = { JWT_SECRET, BRANCH_CODE: 'fr' };

const raise = (kind: string, subject: string, extra: Record<string, unknown> = {}) =>
  ({ method: 'POST', body: JSON.stringify({ kind, subject, ...extra }) });

/* ------------------------------------------------------------------ *
 * 1 · The one label format                                            *
 * ------------------------------------------------------------------ */

test('a label says what the item is: its kind, title, version where it has one, and slug', () => {
  assert.equal(
    concernLabel('template', { title: 'Licence agreement', slug: 'licence-agreement', version: 4 }),
    'HQ template · Licence agreement · v4 · licence-agreement',
  );
  // An article has no version in its label, whatever a row carries.
  assert.equal(
    concernLabel('article', { title: 'Launch post', slug: 'launch-post', version: 9 }),
    'Article · Launch post · launch-post',
  );
});

test('whitespace collapses, a missing title says so, and a version that is not a positive whole number is left out', () => {
  assert.equal(
    concernLabel('template', { title: '  Licence \n\t agreement  ', slug: ' licence-agreement ', version: 4 }),
    'HQ template · Licence agreement · v4 · licence-agreement',
  );
  for (const title of [null, undefined, '', '   ']) {
    assert.equal(concernLabel('article', { title, slug: 'draft' }), 'Article · (untitled) · draft',
      `${JSON.stringify(title)} was not named as missing`);
  }
  for (const version of [0, -1, 1.5, 'x', null, undefined, Number.NaN]) {
    assert.equal(
      concernLabel('template', { title: 'Licence agreement', slug: 'licence-agreement', version }),
      'HQ template · Licence agreement · licence-agreement',
      `${String(version)} was written as a version the row does not have`,
    );
  }
  // A missing slug is left out rather than written as an empty segment.
  assert.equal(concernLabel('article', { title: 'Launch post', slug: '' }), 'Article · Launch post');
});

test('a long title gives way — the slug never does — and the label fits the 300 both tables keep', () => {
  const label = concernLabel('template', { title: 'A'.repeat(400), slug: 'licence-agreement', version: 4 });
  assert.equal(label.length, CONCERN_LABEL_MAX, 'the label is not filled to the limit it was cut to');
  assert.ok(label.startsWith('HQ template · AAA'));
  assert.ok(label.endsWith('… · v4 · licence-agreement'),
    'the title was not the part that gave way — the slug is what a person acts on');

  // The boundary: a title that exactly fits is not shortened.
  const room = CONCERN_LABEL_MAX - 'HQ template ·  · v4 · licence-agreement'.length;
  const fits = concernLabel('template', { title: 'B'.repeat(room), slug: 'licence-agreement', version: 4 });
  assert.equal(fits.length, CONCERN_LABEL_MAX);
  assert.ok(!fits.includes('…'), 'a title that fitted was shortened anyway');

  // A slug that could not fit on its own is the one case the final clip exists for.
  const huge = concernLabel('article', { title: 'Launch post', slug: 's'.repeat(400) });
  assert.ok(huge.length <= CONCERN_LABEL_MAX, `a ${huge.length}-character label would be stored as something else`);
});

/* ------------------------------------------------------------------ *
 * 2 · What a raise may send                                           *
 * ------------------------------------------------------------------ */

test('a pick is { type, id }: a template by its slug, an article by its number', () => {
  assert.deepEqual(parseConcern({ type: 'template', id: 'licence-agreement' }), { type: 'template', id: 'licence-agreement' });
  assert.deepEqual(parseConcern({ type: ' Template ', id: ' licence-agreement ' }), { type: 'template', id: 'licence-agreement' });
  assert.deepEqual(parseConcern({ type: 'article', id: 7 }), { type: 'article', id: 7 });
  assert.deepEqual(parseConcern({ type: 'article', id: '7' }), { type: 'article', id: 7 });
  assert.deepEqual(parseConcern({ type: 'article', id: ' 7 ' }), { type: 'article', id: 7 });
});

test('anything else is not a pick', () => {
  const bad: unknown[] = [
    null, undefined, 'licence-agreement', 7, [], [{ type: 'template', id: 'x' }], {},
    { type: 'template' }, { type: 'template', id: '' }, { type: 'template', id: '   ' },
    { type: 'template', id: 7 }, { type: 'template', id: 't'.repeat(201) },
    { type: 'article', id: 0 }, { type: 'article', id: -1 }, { type: 'article', id: 1.5 },
    { type: 'article', id: '7a' }, { type: 'article', id: '' }, { type: 'article', id: 'launch-post' },
    { type: 'article', id: Number.MAX_SAFE_INTEGER + 2 },
    { type: 'publication', id: 1 }, { id: 'licence-agreement' },
  ];
  for (const raw of bad) assert.equal(parseConcern(raw), null, `${JSON.stringify(raw)} was read as a pick`);
});

/* ------------------------------------------------------------------ *
 * 3 · The list                                                        *
 * ------------------------------------------------------------------ */

test('the list: HQ’s templates by title with case ignored, then this branch’s articles newest first', async () => {
  const db = branchDb(); seedTemplates(db); seedArticles(db);
  const block = await listConcerns({ DB: makeD1(db) } as any);
  assert.equal(block.available, true);
  assert.ok(!('reason' in block), 'a readable list carried a reason for being unreadable');
  assert.deepEqual(block.items.map((i) => `${i.type}:${i.id}`), [
    'template:dpa-addendum', 'template:licence-agreement', 'template:licence-agreement-fr', 'template:service-agreement',
    'article:11', 'article:7', 'article:3',
  ]);
  // Every label is the one format, built from the row it names.
  for (const it of block.items) {
    const row = it.type === 'template'
      ? db.prepare('SELECT slug, title, version FROM branch_templates WHERE slug = ?').get(it.id)
      : db.prepare('SELECT id, slug, title FROM articles WHERE id = ?').get(it.id);
    assert.equal(it.label, concernLabel(it.type, row as any), `${it.type}:${it.id} was listed under a second format`);
  }
  // Two templates share a title; the slug is what tells their labels apart.
  const same = block.items.filter((i) => i.type === 'template' && String(i.id).startsWith('licence-agreement'));
  assert.notEqual(same[0].label, same[1].label);
  assert.equal(typeof block.items.find((i) => i.type === 'article')!.id, 'number');
  assert.deepEqual(block.sources, [
    { type: 'template', available: true, listed: 4, truncated: false },
    { type: 'article', available: true, listed: 3, truncated: false },
  ]);
  assert.equal(block.truncated, false);
  assert.equal(block.cap, CONCERN_ARTICLE_CAP);
  assert.equal(block.note, CONCERNS_NOTE);
  assert.match(block.note, /not a link/);
});

test('a branch holding nothing lists nothing — and says both sources were read', async () => {
  const block = await listConcerns({ DB: makeD1(branchDb()) } as any);
  assert.equal(block.available, true, 'an empty branch read as an unreadable one');
  assert.deepEqual(block.items, []);
  assert.deepEqual(block.sources.map((s) => [s.type, s.available, (s as any).listed]), [
    ['template', true, 0], ['article', true, 0],
  ]);
});

test('articles past the cap are cut to the newest hundred, and the list says it was cut', async () => {
  const db = branchDb();
  const a = db.prepare('INSERT INTO articles (id, slug, title, author_user_id) VALUES (?,?,?,?)');
  for (let i = 1; i <= CONCERN_ARTICLE_CAP; i += 1) a.run(i, `post-${i}`, `Post ${i}`, ADMIN);
  const exact = await listConcerns({ DB: makeD1(db) } as any);
  assert.equal(exact.items.length, CONCERN_ARTICLE_CAP);
  assert.equal(exact.truncated, false, 'a list of exactly the cap said it was cut');

  a.run(CONCERN_ARTICLE_CAP + 1, `post-${CONCERN_ARTICLE_CAP + 1}`, 'Newest post', ADMIN);
  const cut = await listConcerns({ DB: makeD1(db) } as any);
  assert.equal(cut.items.length, CONCERN_ARTICLE_CAP);
  assert.equal(cut.truncated, true, 'a cut list read as the whole of this branch’s articles');
  assert.deepEqual(cut.sources.find((s) => s.type === 'article'),
    { type: 'article', available: true, listed: CONCERN_ARTICLE_CAP, truncated: true });
  assert.equal(cut.items[0].id, CONCERN_ARTICLE_CAP + 1, 'the newest article was not first');
  assert.ok(!cut.items.some((i) => i.id === 1), 'the oldest article survived a cut that kept the newest');
});

test('a source that cannot be read is its own state with its reason — never an empty list', async () => {
  const noTemplates = branchDb({ templates: false }); seedArticles(noTemplates);
  const t = await listConcerns({ DB: makeD1(noTemplates) } as any);
  const tSrc = t.sources.find((s) => s.type === 'template') as any;
  assert.equal(tSrc.available, false);
  assert.ok(!('listed' in tSrc), 'an unreadable library was counted — that says it holds nothing');
  assert.match(tSrc.reason, /branch_templates, migration 268/);
  assert.equal(t.available, true, 'one unreadable source took the other down');
  assert.deepEqual(t.items.map((i) => i.type), ['article', 'article', 'article']);

  const noArticles = branchDb({ articles: false }); seedTemplates(noArticles);
  const a = await listConcerns({ DB: makeD1(noArticles) } as any);
  const aSrc = a.sources.find((s) => s.type === 'article') as any;
  assert.equal(aSrc.available, false);
  assert.ok(!('listed' in aSrc));
  assert.match(aSrc.reason, /articles could not be read/);
  assert.equal(a.available, true);
  assert.equal(a.items.length, 4);
});

test('neither source readable: the block says so, and does not throw', async () => {
  const block = await listConcerns({ DB: makeD1(branchDb({ templates: false, articles: false })) } as any);
  assert.equal(block.available, false);
  assert.match(block.reason!, /can still be raised without one/);
  assert.deepEqual(block.items, []);
  assert.deepEqual(block.sources.map((s) => s.available), [false, false]);
  assert.equal(block.truncated, false);
});

test('the lane reads without the concern tables, and the concerns read without the lane', async () => {
  const bare = await branchApp({ ...BRANCH, DB: makeD1(branchDb({ templates: false, articles: false })) })('/escalations');
  assert.equal(bare.status, 200);
  assert.equal(bare.body.available, true, 'a branch without migration 268 lost its lane');
  assert.equal(bare.body.concerns.available, false);

  const noLane = branchDb({ lane: false }); seedTemplates(noLane);
  const r = await branchApp({ ...BRANCH, DB: makeD1(noLane) })('/escalations');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.match(r.body.reason, /migration 261/);
  assert.equal(r.body.concerns.available, true, 'an unreadable lane took the concerns down with it');
  assert.equal(r.body.concerns.items.length, 4);
  assert.equal(r.body.concerns.note, CONCERNS_NOTE);
});

/* ------------------------------------------------------------------ *
 * 4 · The raise — one label, all the way to HQ                        *
 * ------------------------------------------------------------------ */

test('a picked template’s label is the same bytes in the list, at HQ, on the lane row and in the 201', async () => {
  const db = branchDb(); seedTemplates(db);
  const hqdb = hqDb();
  const hq = realHq(hqdb);
  const call = branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ });

  const listed = (await call('/escalations')).body.concerns.items
    .find((i: any) => i.type === 'template' && i.id === 'licence-agreement');
  assert.equal(listed.label, 'HQ template · Licence agreement · v4 · licence-agreement');

  // A label sent by the client is not read: the route reads the row again.
  const r = await call('/escalations', raise('content', 'French version of the licence agreement', {
    concerns: { type: 'template', id: 'licence-agreement', label: 'Something the client made up' },
  }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'open');
  assert.equal(r.body.subject_ref, listed.label, 'the 201 echoed a different label from the one listed');
  assert.equal(hq.seen.length, 1);
  assert.equal(hq.seen[0].item.subject_ref, listed.label, 'HQ was sent a different label from the one listed');
  assert.equal(lane(db)[0].subject_ref, listed.label, 'the lane row stored a different label');
  const atHq = (hqdb.prepare('SELECT subject_ref FROM hq_escalations').all() as any[]).map((row) => row.subject_ref);
  assert.deepEqual(atHq, [listed.label], 'HQ’s ledger holds a different label from the one listed');
});

test('an article is picked by its id, as a number or as the string a form sends', async () => {
  for (const id of [7, '7', ' 7 ']) {
    const db = branchDb(); seedArticles(db);
    const hq = stubHq();
    const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })(
      '/escalations', raise('content', 'Localised launch post', { concerns: { type: 'article', id } }),
    );
    assert.equal(r.status, 201, `${JSON.stringify(id)}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.subject_ref, 'Article · Launch post · launch-post');
    assert.equal(hq.seen[0].item.subject_ref, 'Article · Launch post · launch-post');
    assert.equal(lane(db)[0].subject_ref, 'Article · Launch post · launch-post');
  }
});

test('a content raise without a pick names nothing, and says so as null', async () => {
  const db = branchDb(); seedTemplates(db);
  const hq = stubHq();
  const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })(
    '/escalations', raise('content', 'A question about our brand guidelines'),
  );
  assert.equal(r.status, 201);
  assert.equal(r.body.subject_ref, null);
  assert.equal(hq.seen[0].item.subject_ref, null, 'HQ was sent a label nobody picked');
  assert.equal(lane(db)[0].subject_ref, null);
});

test('the pick is read again at the raise: a retitled template goes out under its new name, a removed one is refused', async () => {
  const db = branchDb(); seedTemplates(db);
  const hq = stubHq();
  const call = branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ });
  const before = (await call('/escalations')).body.concerns.items
    .find((i: any) => i.type === 'template' && i.id === 'licence-agreement');

  // HQ's next push lands between the list and the raise.
  db.prepare("UPDATE branch_templates SET title = 'Licence agreement (2027)', version = 5 WHERE slug = 'licence-agreement'").run();
  const r = await call('/escalations', raise('content', 'x', { concerns: { type: 'template', id: 'licence-agreement' } }));
  assert.equal(r.status, 201);
  assert.equal(r.body.subject_ref, 'HQ template · Licence agreement (2027) · v5 · licence-agreement');
  assert.notEqual(r.body.subject_ref, before.label, 'the raise sent the name the list showed a minute ago');

  db.prepare("DELETE FROM branch_templates WHERE slug = 'service-agreement'").run();
  const gone = await call('/escalations', raise('content', 'y', { concerns: { type: 'template', id: 'service-agreement' } }));
  assert.equal(gone.status, 400);
  assert.equal(gone.body.error, 'concerns_not_found');
  assert.match(gone.body.message, /Nothing was sent to HQ/);
  assert.equal(hq.seen.length, 1, 'a withdrawn template was sent to HQ under its old name');
  assert.equal(lane(db).length, 1);
});

/* ------------------------------------------------------------------ *
 * 5 · Refusals — nothing sent, nothing stored                         *
 * ------------------------------------------------------------------ */

const REFUSALS: Array<{ name: string; body: Record<string, unknown>; error: string }> = [
  {
    name: 'a typed subject_ref on content — even the exact label the list would give',
    body: { kind: 'content', subject: 'x', subject_ref: 'HQ template · Licence agreement · v4 · licence-agreement' },
    error: 'subject_ref_not_accepted',
  },
  {
    name: 'a typed subject_ref beside a pick',
    body: { kind: 'content', subject: 'x', subject_ref: 'Mine', concerns: { type: 'template', id: 'licence-agreement' } },
    error: 'subject_ref_not_accepted',
  },
  {
    name: 'a pick on a kind that names nothing',
    body: { kind: 'moderation', subject: 'x', concerns: { type: 'template', id: 'licence-agreement' } },
    error: 'concerns_not_for_kind',
  },
  {
    name: 'a malformed pick',
    body: { kind: 'content', subject: 'x', concerns: { type: 'publication', id: 1 } },
    error: 'bad_concern',
  },
  {
    name: 'an empty pick',
    body: { kind: 'content', subject: 'x', concerns: {} },
    error: 'bad_concern',
  },
  {
    name: 'a template this branch does not hold',
    body: { kind: 'content', subject: 'x', concerns: { type: 'template', id: 'no-such-template' } },
    error: 'concerns_not_found',
  },
  {
    name: 'an article this branch does not hold',
    body: { kind: 'content', subject: 'x', concerns: { type: 'article', id: 999 } },
    error: 'concerns_not_found',
  },
];

for (const c of REFUSALS) {
  test(`refused, with nothing sent and nothing stored: ${c.name}`, async () => {
    const db = branchDb(); seedTemplates(db); seedArticles(db);
    const hq = stubHq();
    const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })(
      '/escalations', { method: 'POST', body: JSON.stringify(c.body) },
    );
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, c.error);
    assert.ok(typeof r.body.message === 'string' && r.body.message.length > 20, 'a refusal with no sentence');
    assert.equal(hq.seen.length, 0, 'HQ was called for a raise the branch refused');
    assert.equal(lane(db).length, 0, 'a refused raise left a row');
  });
}

test('a pick whose source cannot be read is a 503 — it says nothing about the item — and nothing is sent', async () => {
  const cases: Array<[Parameters<typeof branchDb>[0], Record<string, unknown>]> = [
    [{ templates: false }, { type: 'template', id: 'licence-agreement' }],
    [{ articles: false }, { type: 'article', id: 7 }],
  ];
  for (const [shape, pick] of cases) {
    const db = branchDb(shape);
    const hq = stubHq();
    const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })(
      '/escalations', raise('content', 'x', { concerns: pick }),
    );
    assert.equal(r.status, 503, `${JSON.stringify(shape)}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'concerns_unreadable');
    assert.match(r.body.message, /could not be read on this branch/);
    assert.equal(hq.seen.length, 0);
    assert.equal(lane(db).length, 0);
  }
});

test('every other kind keeps the free-text subject_ref migration 259 gave it', async () => {
  for (const kind of ['other', 'moderation', 'seat_increase']) {
    const db = branchDb();
    const hq = stubHq();
    const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })(
      '/escalations', raise(kind, 'A question', { subject_ref: 'Invoice INV-2026-042' }),
    );
    assert.equal(r.status, 201, `${kind}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.subject_ref, 'Invoice INV-2026-042');
    assert.equal(hq.seen[0].item.subject_ref, 'Invoice INV-2026-042');
    assert.equal(lane(db)[0].subject_ref, 'Invoice INV-2026-042');
  }
});

test('a white-label’s content pick is refused for its kind before the pick is read', async () => {
  // Even with the library unreadable: the kind refusal is the first answer, so
  // this is D206's 400, not the 503 the unreadable source would give.
  const db = branchDb({ kind: 'white_label', templates: false });
  const hq = stubHq();
  const d1 = makeD1(db);
  const r = await branchApp({ ...BRANCH, DB: d1, HQ: hq.HQ })(
    '/escalations', raise('content', 'x', { concerns: { type: 'template', id: 'licence-agreement' } }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'kind_not_available');
  assert.ok(!d1.reads.some((s) => s.includes('branch_templates')), 'the pick was read for a kind the licence hides');
  assert.equal(hq.seen.length, 0);
  assert.equal(lane(db).length, 0);
});
