import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import research from '../src/routes/research.ts';
import researchMarkets from '../src/routes/research_markets.ts';
import { EUR_SOURCE } from '../src/services/researchFundDirectory.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';

const dir = new URL('../sql/migrations/', import.meta.url);
const read = prefix => readFileSync(new URL(prefix.endsWith('.sql') ? prefix : readdirSync(dir).find(name => name.startsWith(`${prefix}_`)), dir), 'utf8');
const review = read('413');
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const SHAI = 'Shai Goldman — new VC funds at/below $200M';
const TERMS = 'https://hello-tomorrow.org/website-terms-and-conditions/';
const secret = 'd597-local-reviewed-terms-signing-fixture';
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(stripForeignKeys(tableFromBaseline(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'), 'users')));
  db.prepare("INSERT INTO users(id,role,name,email) VALUES(11,'founder','Fixture founder','fixture@example.test')").run();
  db.exec(read('365')); db.exec(read('378')); db.exec(read('406')); db.exec(read('376'));
  for (const [prefix, table] of [['228_research_company_directory.sql', 'research_company_directory'], ['229_research_market_directory.sql', 'research_market_directory'], ['136', 'signals'], ['136', 'signal_companies'], ['037', 'market_intel_rows'], ['037', 'market_intel_indexes']]) {
    const ddl = splitStatements(read(prefix)).find(sql => sql.startsWith('CREATE TABLE ') && sql.slice(0, sql.indexOf('(')).trim().endsWith(` ${table}`));
    if (!ddl) throw new Error(`Missing migration DDL for ${table}`);
    db.exec(stripForeignKeys(ddl));
  }
  db.exec(read('375')); db.exec(read('379'));
  return db;
}
async function request(db, path) {
  const token = await new SignJWT({ user_id: 11 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const app = new Hono(); app.route('/api/research', research); app.route('/api/research', researchMarkets);
  app.onError((_err, c) => c.json({ detail: 'Unreadable' }, 500));
  const response = await app.request(`/api/research${path}`, { headers: { Authorization: `Bearer ${token}` } }, { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' });
  return { status: response.status, body: await response.json() };
}
function reviews(db) { return db.prepare('SELECT * FROM research_fund_sources ORDER BY source_name').all(); }

test('actual 413 records the fetched evidence and precise three-source verdicts without contact data or handles', () => {
  const db = database(); db.exec(review);
  const rows = reviews(db); assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.reviewed_on, '2026-10-07');
    assert.match(row.terms_quote, /\S/); assert.match(row.evidence_url, /^https:\/\//);
    assert.doesNotMatch(row.terms_quote + row.evidence, /[\w.+-]+@[\w.-]+\.[A-Za-z]+/);
  }
  const deep = rows.find(row => row.source_name === DEEP);
  assert.deepEqual([deep.verdict, deep.terms_status, deep.evidence_url], ['not allowed', 'found', TERMS]);
  assert.match(deep.terms_quote, /media channel.*related, linked, or otherwise connected/);
  assert.match(deep.terms_quote, /republished.*commercial purpose.*express prior written permission/);
  assert.match(deep.verdict_reason, /removed/);
  const euro = rows.find(row => row.source_name === EUR_SOURCE);
  assert.deepEqual([euro.verdict, euro.terms_status], ['cite only', 'not found']);
  assert.match(euro.terms_quote, /All info is publicly available/);
  assert.match(euro.terms_quote, /won't share editing rights/);
  const shai = rows.find(row => row.source_name === SHAI);
  assert.deepEqual([shai.verdict, shai.terms_status, shai.publisher], ['cite only', 'not found', 'Shai Goldman']);
  assert.match(shai.terms_quote, /resource for founders who are raising capital/);
  assert.doesNotMatch(shai.title + shai.publisher + shai.terms_quote, /@|linkedin\.com|brex\.com/);
  assert.equal(shai.repo_copy, null);
  db.close();
});

test('413 replay and old 406 preserve this review and a subsequent publisher decision', () => {
  const db = database(); db.exec(review); const before = reviews(db);
  db.exec(review); db.exec(read('406')); assert.deepEqual(reviews(db), before);
  db.prepare("UPDATE research_fund_sources SET verdict='not allowed', reviewed_on='2026-10-08', verdict_reason='Later publisher decision' WHERE source_name=?").run(EUR_SOURCE);
  const later = reviews(db); db.exec(review); assert.deepEqual(reviews(db), later);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM research_fund_directory').get().n, 2616);
  db.close();
});

test('actual dataset becomes 1076 served funds, with 1540 withheld, cited pages and a removed profile', async () => {
  const db = database();
  const before = await request(db, '/fund-directory?limit=1'); assert.equal(before.status, 200); assert.equal(before.body.total, 2616);
  const removedUid = db.prepare('SELECT uid FROM research_fund_directory WHERE source_name=? LIMIT 1').get(DEEP).uid;
  db.exec(review);
  const first = await request(db, '/fund-directory?limit=25&offset=0'); const second = await request(db, '/fund-directory?limit=25&offset=25');
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.deepEqual([first.body.total, first.body.coverage.total, second.body.total], [1076, 1076, 1076]);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(row => row.uid)).size, 50);
  for (const row of [...first.body.items, ...second.body.items]) {
    assert.equal(row.source.name, EUR_SOURCE); assert.equal(row.source.verdict, 'cite only');
    assert.equal(row.source.reviewed_on, '2026-10-07'); assert.match(row.source.url, /docs\.google\.com\/spreadsheets/);
  }
  const removed = first.body.removed_sources.find(row => row.name === DEEP);
  assert.equal(removed.funds_withheld, 1540); assert.equal(removed.evidence_url, TERMS); assert.match(removed.reason, /written permission/);
  assert.ok(!first.body.sources.some(row => row.name === DEEP));
  const profile = await request(db, `/fund-directory/${encodeURIComponent(removedUid)}`);
  assert.equal(profile.status, 410); assert.equal(profile.body.detail, 'Removed'); assert.equal(profile.body.item, undefined);
  const missing = await request(db, '/fund-directory?q=Gamma%27%25&limit=100'); assert.equal(missing.status, 200); assert.ok(missing.body.items.every(row => row.source.name !== DEEP));
  db.close();
});

test('market and geography rows, totals and facets withhold the actual forbidden source', async () => {
  const db = database(); db.exec('DELETE FROM research_fund_directory');
  db.prepare("INSERT INTO research_market_directory(slug,name,company_count,source_name,source_boundary,as_of)VALUES('fintech','FinTech',1,'Fixture','Fixture','2026-10-07')").run();
  const add = db.prepare("INSERT INTO research_fund_directory(uid,name,hq,sector_focus,source_name,source_url,as_of)VALUES(?,?,'UK','Fintech',?,'https://fixture.example/list','2026-10-07')");
  for (const [uid, source] of [['eu', EUR_SOURCE], ['dt', DEEP], ['sg', SHAI]]) add.run(uid, `Fixture ${uid}`, source);
  const before = await request(db, '/markets/fintech'); assert.equal(before.status, 200); assert.equal(before.body.fund_count, 3);
  db.exec(review);
  const market = await request(db, '/markets/fintech'); assert.equal(market.status, 200);
  assert.equal(market.body.fund_count, 2); assert.deepEqual(market.body.funds.map(row => row.uid).sort(), ['eu', 'sg']);
  assert.equal(market.body.sub_markets.fund_focus.reduce((n, row) => n + row.count, 0), 2);
  const country = await request(db, '/geographies/GB'); assert.equal(country.status, 200);
  assert.deepEqual([country.body.fund_count, country.body.totals.funds], [2, 2]); assert.deepEqual(country.body.funds.map(row => row.uid).sort(), ['eu', 'sg']);
  const countries = await request(db, '/geographies?with_data=1'); assert.equal(countries.status, 200);
  assert.equal(countries.body.items.find(row => row.code === 'GB').fund_count, 2);
  db.exec('DROP TABLE research_fund_sources');
  for (const path of ['/markets/fintech', '/geographies/GB', '/geographies']) assert.ok((await request(db, path)).status >= 500);
  const directory = await request(db, '/fund-directory'); assert.equal(directory.status, 503); assert.equal(directory.body.detail, 'Unreadable');
  db.close();
});
