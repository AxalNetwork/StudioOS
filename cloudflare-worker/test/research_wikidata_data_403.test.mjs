import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import research from '../src/routes/research.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { mapCompanySector } from '../src/services/researchTaxonomy.ts';

const read = name => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const sql = read('403_research_company_directory_wikidata.sql');
const seed = read('228_research_company_directory.sql');
const licence = /source_license TEXT NOT NULL DEFAULT '([^']+)'/.exec(seed)[1];
const metricFields = [...read('375_research_company_directory_columns.sql').matchAll(/^ALTER TABLE research_company_directory ADD COLUMN (\w+)/gm)].map(match => match[1]);
const count = db => db.prepare('SELECT COUNT(*) n FROM research_company_directory').get().n;
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(seed);
  db.exec(read('375_research_company_directory_columns.sql'));
  return db;
}
test('committed 403 adds exactly 3000 companies, preserves every seed row and is repeatable', () => {
  const db = database();
  const before = db.prepare('SELECT * FROM research_company_directory ORDER BY uid').all();
  const seedIds = new Set(before.map(row => row.uid));
  assert.equal(before.length, 300);
  assert.equal(sql.split('\n').filter(line => line.startsWith('INSERT OR IGNORE INTO research_company_directory')).length, 3000);
  db.exec(sql);
  assert.equal(count(db), 3300);
  assert.deepEqual(db.prepare('SELECT * FROM research_company_directory ORDER BY uid').all().filter(row => seedIds.has(row.uid)), before);
  db.exec(sql);
  assert.equal(count(db), 3300);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT uid) n FROM research_company_directory').get().n, 3300);
});
test('all committed rows carry identity, mapped industry, entity citation, CC0 and pull date without invented metrics', () => {
  const db = database();
  const seedIds = new Set(db.prepare('SELECT uid FROM research_company_directory').all().map(row => row.uid));
  db.exec(sql);
  const rows = db.prepare('SELECT * FROM research_company_directory').all().filter(row => !seedIds.has(row.uid));
  assert.equal(rows.length, 3000);
  for (const row of rows) {
    assert.match(row.uid, /^q[1-9][0-9]*$/);
    assert.ok(typeof row.name === 'string' && row.name.trim(), `${row.uid}: name`);
    const website = new URL(row.website);
    assert.ok(['https:', 'http:'].includes(website.protocol) && website.hostname && !website.username && !website.password, `${row.uid}: public website`);
    assert.ok(typeof row.country === 'string' && row.country.trim(), `${row.uid}: country`);
    assert.equal(mapCompanySector(row.sector).targets.length, 1, `${row.uid}: mapped industry`);
    assert.equal(row.source_name, 'Wikidata');
    assert.equal(row.source_url, `https://www.wikidata.org/wiki/${row.uid.toUpperCase()}`);
    assert.equal(row.source_license, licence);
    assert.equal(row.as_of, '2026-10-07');
    assert.ok(row.founded_year === null || (Number.isInteger(row.founded_year) && row.founded_year >= 1000 && row.founded_year <= 2026), `${row.uid}: recorded year`);
    for (const field of metricFields) assert.equal(row[field], null, `${row.uid}: ${field}`);
  }
});
test('actual 403 reaches the directory counts, coverage, facets, country filter and non-overlapping pages', async () => {
  const db = database();
  db.exec(read('376_research_taxonomy.sql'));
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT NOT NULL,is_active INTEGER DEFAULT 1,jwt_min_iat INTEGER,name TEXT,email TEXT)');
  db.prepare('INSERT INTO users(id,role,name,email)VALUES(?,?,?,?)').run(11, 'founder', 'Fixture founder', 'fixture@example.test');
  const secret = 'd537-committed-data-local-signing-fixture';
  const token = await new SignJWT({ user_id: 11 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const app = new Hono(); app.route('/api/research', research);
  const request = async query => {
    const response = await app.request(`/api/research/company-directory?${query}`, { headers: { Authorization: `Bearer ${token}` } }, { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' });
    return { status: response.status, body: await response.json() };
  };
  const before = await request('limit=1'); assert.equal(before.status, 200); assert.equal(before.body.total, 300);
  db.exec(sql);
  const first = await request('limit=25&offset=0'); const second = await request('limit=25&offset=25');
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.deepEqual([first.body.total, first.body.coverage.of, second.body.total], [3300, 3300, 3300]);
  assert.deepEqual([first.body.items.length, second.body.items.length], [25, 25]);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(row => row.uid)).size, 50);
  assert.equal(first.body.coverage.fields.website, count(db));
  assert.equal(first.body.coverage.fields.funding, db.prepare('SELECT COUNT(*) n FROM research_company_directory WHERE funding_total IS NOT NULL').get().n);
  assert.equal(first.body.facets.sector_labels.reduce((sum, facet) => sum + facet.count, 0) + first.body.facets.sector_none, count(db));
  const france = await request('country=France&limit=1'); assert.equal(france.status, 200);
  assert.equal(france.body.total, db.prepare("SELECT COUNT(*) n FROM research_company_directory WHERE country='France'").get().n);
});
