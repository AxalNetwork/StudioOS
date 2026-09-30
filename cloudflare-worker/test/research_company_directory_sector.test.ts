/**
 * The company directory answers per sector, and it says how many it has.
 *
 * WHY THIS EXISTS. `/research/markets` cards carry an Axal taxonomy count and
 * nothing behind it: opening a sector showed the supplied number and an empty
 * universe, because the directory could only be searched by name and country
 * and every seeded row carried `sector = NULL`. The filter added here is what
 * makes a sector card's universe reachable, and it has three ways to be
 * silently wrong:
 *
 *   1. CASE. The stored label is the taxonomy name verbatim ("AI", "AR/VR",
 *      "ClimateTech/CleanTech"). An exact-case comparison turns one
 *      capitalisation change in the taxonomy into an empty sector page that
 *      looks like an empty universe.
 *   2. THE TOTAL. `items` is a page. If `total` were the page length, a sector
 *      with 1,400 records would report 200 and the page would read as a fact.
 *   3. THE EMPTY LABEL. `?sector=` with no label must mean "every sector", not
 *      "the sector whose label is the empty string" — which matches nothing and
 *      would hide the whole directory.
 *
 * Real SQLite: the table is cut from migration 228, so the route's own SQL
 * decides every outcome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import research from '../src/routes/research.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 1;

/**
 * The CREATE TABLE for `table`, cut from whichever migration declares it.
 *
 * BY TABLE, NOT BY NUMBER. Migration numbers are reused in this repo — there
 * are two `228_` files — so resolving by number alone cut the wrong one and
 * failed with "no longer declares", which reads like a schema deletion rather
 * than a lookup that found the wrong file.
 */
function tableFrom(table: string): string {
  for (const file of readdirSync(MIGRATIONS)) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    if (start >= 0) return stripForeignKeys(sql.slice(start, sql.indexOf('\n);', start) + 3));
  }
  assert.fail(`no migration declares ${table}`);
}

const ROWS: Array<[string, string, string, string | null, number, string | null]> = [
  ['q1', 'Aurelia Analytics', 'https://aurelia.example', 'United States', 2015, 'AI'],
  ['q2', 'Brightline Robotics', 'https://brightline.example', 'Germany', 2018, 'AI'],
  ['q3', 'Cinder Freight', 'https://cinder.example', 'France', 2012, 'Logistics'],
  ['q4', 'Delta Threads', 'https://delta.example', null, 2020, null],
];

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
  );`);
  db.exec(tableFrom('research_company_directory'));
  const insert = db.prepare(
    `INSERT INTO research_company_directory
       (uid, name, website, country, founded_year, sector, source_name, source_url, source_license, as_of)
     VALUES (?, ?, ?, ?, ?, ?, 'Wikidata', ?, 'CC0 (Wikidata data); website links are references', '2026-10-01')`
  );
  for (const [uid, name, website, country, founded, sector] of ROWS) {
    insert.run(uid, name, website, country, founded, sector, `https://www.wikidata.org/wiki/${uid.toUpperCase()}`);
  }
  db.exec(`INSERT INTO users (id, role) VALUES (${OWNER}, 'founder')`);
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, path: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(OWNER)}` };
  const res = await research.fetch(
    new Request(`http://x${path}`, { method: 'GET', headers }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('a sector filter returns that sector’s records and the count behind the page', async () => {
  const db = freshDb();
  const ai = await call(db, '/company-directory?sector=AI');
  assert.equal(ai.status, 200);
  assert.deepEqual(ai.body.items.map((x: any) => x.uid), ['q1', 'q2']);
  assert.equal(ai.body.total, 2);
  assert.equal(ai.body.sector, 'AI');
  // A label the taxonomy spells in one case must not need that case typed.
  const lower = await call(db, '/company-directory?sector=ai');
  assert.deepEqual(lower.body.items.map((x: any) => x.uid), ['q1', 'q2'], 'the sector label matched case-sensitively');
  const other = await call(db, '/company-directory?sector=Logistics');
  assert.deepEqual(other.body.items.map((x: any) => x.uid), ['q3']);
  assert.equal(other.body.total, 1);
});

test('an empty sector label means every sector, not the empty one', async () => {
  const db = freshDb();
  const all = await call(db, '/company-directory');
  assert.equal(all.body.items.length, 4);
  assert.equal(all.body.total, 4);
  assert.equal(all.body.sector, null);
  const blank = await call(db, '/company-directory?sector=');
  assert.equal(blank.body.items.length, 4, 'a blank sector label hid the directory');
  // A row with no label is reachable only through the unfiltered read.
  assert.equal(all.body.items.some((x: any) => x.sector === null), true);
});

test('the page is a page: total counts the sector, and limit/offset move through it', async () => {
  const db = freshDb();
  const first = await call(db, '/company-directory?limit=1');
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.total, 4, 'total reported the page rather than the match');
  const second = await call(db, '/company-directory?limit=1&offset=1');
  assert.notEqual(second.body.items[0].uid, first.body.items[0].uid);
  // Filters and paging compose: search inside a sector with a one-row page.
  const scoped = await call(db, '/company-directory?sector=AI&q=Bright&limit=1');
  assert.equal(scoped.body.total, 1);
  assert.equal(scoped.body.items[0].uid, 'q2');
});

test('an unknown sector is an empty page, not the whole directory', async () => {
  const db = freshDb();
  const none = await call(db, '/company-directory?sector=Quantum%20Teapots');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.items, []);
  assert.equal(none.body.total, 0);
});
