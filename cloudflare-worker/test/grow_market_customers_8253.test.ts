/**
 * D8253 (#8253, Grow Markets) — customers and prospects by country.
 *
 *   1  The migration adds a nullable `contacts.country` and its index, and a fresh row is untagged.
 *   2  A prospect is added with a country (upper-cased), tagged, re-tagged and cleared; a code Research does not list
 *      and a non-code are refused (400); a reader of the venture is refused (403); another venture's prospect is 404.
 *   3  The Markets list and record count tagged prospects and customers only, per country: tagged, untagged (Not
 *      recorded, `tagged: null`, never 0), mixed (the untagged are not counted), no country attached, and another
 *      venture's rows never counted.
 *   4  A failed read is `unreadable` with `tagged: null`, never a count.
 *
 * Mutation checked (each broke a test below, then was restored): the count ignoring `country IS NOT NULL` (3); the
 *   count dropping `project_id` (3); a failed read returning an empty map (4); the Research check skipped (2).
 *
 * Every name and value is made up. The database is the baseline plus every migration, in memory.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_market_customers_8253.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import prospects from '../src/routes/grow_prospects.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'market', 'customers', '8253'].join('-');
const FOUNDER = 10, ADVISOR = 12, OTHER = 13;
const A = 1, B = 2;

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, name] of [[FOUNDER, 'Ana Wren'], [ADVISOR, 'Dee Advisor'], [OTHER, 'Oli Other']] as const) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, 'founder', name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Other Venture', ${OTHER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('PT', 'Portugal', 'Europe'), ('ES', 'Spain', 'Europe'), ('CL', 'Chile', 'Americas')`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, state, geography_ref, created_by) VALUES
    (1, 'mkp', ${A}, 'Portugal', 'considering', 'PT', ${FOUNDER}), (2, 'mks', ${A}, 'Spain', 'considering', 'ES', ${FOUNDER}),
    (3, 'mkc', ${A}, 'Chile', 'considering', 'CL', ${FOUNDER}), (4, 'mkn', ${A}, 'Nowhere', 'considering', NULL, ${FOUNDER})`);
  return db;
}

const app = new Hono<any>();
app.route('/api/grow/prospects', prospects);
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const addP = (db: DatabaseSync, body: Record<string, unknown> = {}, who = FOUNDER, project = A) =>
  call(db, who, 'POST', '/api/grow/prospects', { project, name: 'Pat Prospect', email: `p${Math.random().toString(36).slice(2)}@example.test`, basis: 'none', ...body });
const setC = (db: DatabaseSync, uid: string, country: unknown, who = FOUNDER, project = A) =>
  call(db, who, 'PATCH', `/api/grow/prospects/${uid}/country`, { project, country });
const country = (db: DatabaseSync, uid: string) => (db.prepare('SELECT country FROM contacts WHERE uid = ?').get(uid) as any).country;
const list = async (db: DatabaseSync) => Object.fromEntries((await call(db, FOUNDER, 'GET', `/api/cycles/grow/modules/market-expansion?project=${A}`)).body.records.rows.map((r: any) => [r.name, r.customers]));
const rec = async (db: DatabaseSync, uid: string) => (await call(db, FOUNDER, 'GET', `/api/cycles/grow/modules/market-expansion/records/${uid}?project=${A}`)).body.parts.market.customers;

test('1: contacts.country exists, is nullable and indexed; a new row is untagged', async () => {
  const db = fixture();
  const col = (db.prepare("PRAGMA table_info('contacts')").all() as any[]).find((c) => c.name === 'country');
  assert.ok(col && col.notnull === 0 && col.dflt_value == null, JSON.stringify(col));
  assert.ok((db.prepare("PRAGMA index_list('contacts')").all() as any[]).some((i) => i.name === 'idx_contacts_project_country'));
  const made = await addP(db);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(country(db, made.body.uid), null);
});

test('2: a prospect takes a country, can be re-tagged and cleared; bad codes, readers and other ventures are refused', async () => {
  const db = fixture();
  const made = await addP(db, { country: 'pt' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(country(db, made.body.uid), 'PT');
  assert.equal((await setC(db, made.body.uid, 'es')).status, 200);
  assert.equal(country(db, made.body.uid), 'ES');
  assert.equal((await call(db, FOUNDER, 'GET', `/api/grow/prospects/${made.body.uid}?project=${A}`)).body.country, 'ES');
  assert.equal((await setC(db, made.body.uid, '')).status, 200);
  assert.equal(country(db, made.body.uid), null);
  for (const bad of ['ZZ', 'Portugal', '1', 'P']) {
    const r = await setC(db, made.body.uid, bad);
    assert.equal(r.status, 400, bad); assert.equal(r.body.field, 'country');
  }
  assert.equal((await addP(db, { country: 'ZZ' })).status, 400);
  assert.equal((await call(db, FOUNDER, 'PATCH', `/api/grow/prospects/${made.body.uid}/country`, { project: A })).status, 400, 'a body without a country is not a clear');
  assert.equal((await setC(db, made.body.uid, 'PT', ADVISOR)).status, 403, 'a reader of the venture cannot tag');
  assert.equal((await setC(db, made.body.uid, 'PT', OTHER, B)).status, 404, 'another venture\'s prospect is not found');
  assert.equal(country(db, made.body.uid), null);
});

test('3: counts come from tagged rows only; none tagged is Not recorded, never 0', async () => {
  const db = fixture();
  // Portugal: two tagged and three untagged. Spain: only untagged. Chile: none. Another venture tags Chile.
  for (const c of ['PT', 'PT', null, null, null]) assert.equal((await addP(db, c ? { country: c } : {})).status, 201);
  assert.equal((await addP(db)).status, 201);
  assert.equal((await addP(db, { country: 'CL' }, OTHER, B)).status, 201);
  db.prepare("INSERT INTO contacts (uid, project_id, audience, routed_to, email, country) VALUES ('inv', ?, 'investor', 'raise', 'inv@example.test', 'ES')").run(A);
  const l = await list(db);
  assert.deepEqual(l.Portugal, { state: 'ok', tagged: 2, reason: null });
  for (const name of ['Spain', 'Chile']) { assert.equal(l[name].state, 'not_recorded', name); assert.equal(l[name].tagged, null, name); }
  assert.equal(l.Nowhere.state, 'not_recorded');
  assert.match(l.Nowhere.reason, /No country is attached/);
  assert.deepEqual(await rec(db, 'mkp'), l.Portugal);
  assert.equal((await rec(db, 'mks')).tagged, null, 'an investor contact tagged Spain is not a customer');
  assert.equal((await rec(db, 'mkc')).tagged, null, 'another venture\'s Chile rows are not counted');
});

test('4: a failed read is unreadable with no count', async () => {
  const db = fixture();
  assert.equal((await addP(db, { country: 'PT' })).status, 201);
  db.exec('DROP INDEX idx_contacts_project_country; ALTER TABLE contacts DROP COLUMN country');
  const l = await list(db);
  assert.equal(l.Portugal.state, 'unreadable'); assert.equal(l.Portugal.tagged, null);
  assert.equal((await rec(db, 'mkp')).state, 'unreadable');
});
