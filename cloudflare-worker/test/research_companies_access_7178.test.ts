/**
 * D7178 (#7178, canvas #7044) — Research › Companies on the Worker follows the route's rule: a held Founder or
 * Advisor licence, an active Spin-Out Lab, or an admin reads `/company-directory` and `/company-directory/:uid`;
 * anyone else signed in gets 403 Refused (`companies_licence_required`), and a refusal on a profile never says
 * whether the company exists. Held licences, not the primary role, decide (D4473): an Investor who also holds
 * Founder is admitted, and a revoked grant admits nothing.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_companies_access_7178.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import { admitsCompanies } from '../src/services/researchCompaniesAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const migration = (file: string) => readFileSync(resolve(here, `../sql/migrations/${file}`), 'utf8');
function creates(file: string): string {
  return migration(file)
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => /^CREATE\s+(TABLE|INDEX)/i.test(s))
    .map((s) => `${s};`).join('\n');
}

/** id → [primary role, extra held licences, lab active, grant revoked]. Sample accounts only. */
const PEOPLE: Record<number, [string, string[], number, boolean?]> = {
  1: ['founder', [], 0],
  2: ['advisor', [], 0],
  3: ['investor', [], 0],
  4: ['partner', [], 0],
  5: ['investor', ['founder'], 0],
  6: ['partner', ['advisor'], 0],
  7: ['investor', [], 1],
  8: ['admin', [], 0],
  9: ['exploring', [], 0],
  10: ['investor', ['founder'], 0, true],
};

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER DEFAULT 0);`);
  db.exec(creates('228_research_company_directory.sql'));
  db.exec(migration('375_research_company_directory_columns.sql'));
  db.exec(creates('370_company_research_tables.sql'));
  db.exec(migration('229_research_market_directory.sql'));
  db.exec(migration('376_research_taxonomy.sql'));
  db.exec(migration('202611041822_account_licences.sql'));
  const user = db.prepare('INSERT INTO users (id, role, name, email, spinout_lab_active) VALUES (?, ?, ?, ?, ?)');
  const grant = db.prepare(`INSERT INTO account_licences (user_id, licence, source, revoked_at) VALUES (?, ?, 'test', ?)`);
  for (const [id, [role, extra, lab, revoked]] of Object.entries(PEOPLE)) {
    user.run(Number(id), role, `Sample ${id}`, `sample${id}@example.test`, lab);
    for (const l of extra) grant.run(Number(id), l, revoked ? '2026-11-01 00:00:00' : null);
  }
  db.prepare(`INSERT INTO research_company_directory (uid, name, website, country, sector, source_url, as_of)
              VALUES ('acme', 'Acme Robotics', 'https://acme.example', 'Germany', 'robotics', 'https://www.wikidata.org/wiki/Q1', '2026-10-04')`).run();
  return db;
}

const app = new Hono<any>();
app.route('/api/research', research);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, msg === 'Unauthorized' ? 401 : 500);
});

async function get(db: InstanceType<typeof DatabaseSync>, path: string, userId: number | null) {
  const headers: Record<string, string> = {};
  if (userId !== null) {
    const token = await new SignJWT({ user_id: userId, role: PEOPLE[userId][0] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app.request(`/api/research${path}`, { headers }, { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

const ADMITTED = { founder: 1, advisor: 2, 'investor + founder': 5, 'partner + advisor': 6, 'investor in an active Lab': 7, admin: 8 };
const REFUSED = { investor: 3, partner: 4, exploring: 9, 'investor whose founder grant was revoked': 10 };

test('a held Founder or Advisor licence, an active Lab or an admin reads the directory and a profile', async () => {
  const db = fixture();
  for (const [who, id] of Object.entries(ADMITTED)) {
    const list = await get(db, '/company-directory', id);
    assert.equal(list.status, 200, `${who}: directory`);
    assert.deepEqual(list.body.items.map((i: any) => i.uid), ['acme'], `${who}: directory rows`);
    const one = await get(db, '/company-directory/acme', id);
    assert.equal(one.status, 200, `${who}: profile`);
    assert.equal(one.body.item.name, 'Acme Robotics', `${who}: profile body`);
  }
});

test('every other signed-in account is refused with 403 and the code, and no row', async () => {
  const db = fixture();
  for (const [who, id] of Object.entries(REFUSED)) {
    for (const path of ['/company-directory', '/company-directory/acme', '/company-directory/no-such-company']) {
      const r = await get(db, path, id);
      assert.equal(r.status, 403, `${who}: ${path}`);
      assert.equal(r.body.error, 'companies_licence_required', `${who}: ${path} code`);
      assert.match(r.body.message, /Founder and Advisor licences/, `${who}: ${path} sentence`);
      assert.equal(r.body.items, undefined, `${who}: ${path} carries no rows`);
      assert.equal(r.body.item, undefined, `${who}: ${path} carries no company`);
    }
  }
});

test('a signed-out request is still 401, and an admitted reader still gets 404 for a company that is not there', async () => {
  const db = fixture();
  assert.equal((await get(db, '/company-directory', null)).status, 401);
  assert.equal((await get(db, '/company-directory/acme', null)).status, 401);
  assert.equal((await get(db, '/company-directory/no-such-company', 1)).status, 404);
});

test('the rule reads held licences, the Lab flag and admin, not the primary role alone', () => {
  assert.equal(admitsCompanies({ role: 'investor', licences: ['investor', 'founder'] }), true);
  assert.equal(admitsCompanies({ role: 'partner', licences: ['partner', 'advisor'] }), true);
  assert.equal(admitsCompanies({ role: 'investor', licences: ['investor'] }), false);
  assert.equal(admitsCompanies({ role: 'investor', licences: ['investor'], spinout_lab_active: 1 }), true);
  assert.equal(admitsCompanies({ role: 'investor', licences: ['investor'], spinout_lab_active: 0 }), false);
  assert.equal(admitsCompanies({ role: 'admin', licences: [] }), true);
  // Primary-only objects (no hydrated licences) fall back to the role.
  assert.equal(admitsCompanies({ role: 'founder' }), true);
  assert.equal(admitsCompanies({ role: 'investor' }), false);
});
