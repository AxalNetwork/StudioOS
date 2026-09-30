/**
 * A market is a record with observations, not a label with a number beside it.
 *
 * WHY THIS EXISTS. The markets page used to be 82 taxonomy labels; the only
 * number anywhere was a supplied count in a column, and nothing could tell a
 * reader where it came from or when it was true. Migration 368 makes the market
 * a record and every figure an observation with a citation. Two rules carry the
 * whole design and both are easy to lose silently:
 *
 *   1. A NUMBER ARRIVES WITH A SOURCE, OR IT DOES NOT ARRIVE. If the write
 *      route accepted `{ metric_name: 'tam', metric_value: 42 }`, the dataset
 *      would fill with figures nobody can check, which is the exact failure it
 *      exists to prevent. `axal_taxonomy` is the one source allowed to have no
 *      URL, because it is Axal's own assertion rather than a publication.
 *   2. OBSERVATIONS ARE APPEND-ONLY. A corrected market size must not delete the
 *      figure it corrects: the earlier one was true on its publication date, and
 *      the movement between them is itself the signal. Re-ingesting the same
 *      publication is a no-op; a new period is a new row.
 *
 * Real SQLite: the tables are cut from migration 368 by name, so the route's own
 * SQL decides every outcome.
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
 * BY TABLE, NOT BY NUMBER. Migration numbers are reused in this repo, so
 * resolving by number alone cuts the wrong file and fails with "no longer
 * declares", which reads like a schema deletion rather than a bad lookup.
 */
function tableFrom(table: string): string {
  for (const file of readdirSync(MIGRATIONS)) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    if (start >= 0) return stripForeignKeys(sql.slice(start, sql.indexOf('\n);', start) + 3));
  }
  assert.fail(`no migration declares ${table}`);
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
  );`);
  db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);');
  for (const table of [
    'research_markets', 'research_market_metrics', 'research_market_facets',
    'research_market_companies', 'research_market_funds', 'research_market_investments',
    'research_market_sources', 'research_company_directory',
  ]) db.exec(tableFrom(table));

  db.exec(`INSERT INTO users (id, role) VALUES (${OWNER}, 'admin')`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${OWNER})`);
  db.exec(
    `INSERT INTO research_markets (market_id, market_name, canonical_name, market_type, source_id, source_name, source_type, retrieved_at)
     VALUES ('ai', 'AI', 'AI', 'sector', 'axal_taxonomy', 'Axal taxonomy', 'axal', '2026-09-30')`
  );
  db.exec(
    `INSERT INTO research_market_metrics (market_metric_id, market_id, metric_name, metric_value, metric_unit, base_year, geography, source_id, source_name, retrieved_at)
     VALUES ('axal_taxonomy:ai:supplied_company_count:2026-09-30', 'ai', 'supplied_company_count', 3083, 'companies', 2026, 'Global', 'axal_taxonomy', 'Axal taxonomy', '2026-09-30')`
  );
  db.exec(
    `INSERT INTO research_market_facets (id, market_id, kind, label, detail, value, unit, observed_at, source_id, source_url, confidence)
     VALUES ('industry:ai:Q11660', 'ai', 'industry_resolution', 'artificial intelligence', 'Wikidata industry item used to resolve this market''s company universe.', 889, 'companies', '2026-09-30', 'wikidata', 'https://www.wikidata.org/wiki/Q11660', 0.7)`
  );
  db.exec(
    `INSERT INTO research_market_sources (source_id, name, source_type, homepage, license, quality_weight)
     VALUES ('axal_taxonomy', 'Axal sector taxonomy', 'axal', NULL, NULL, NULL),
            ('wikidata', 'Wikidata (CC0 entity records)', 'primary', 'https://www.wikidata.org', 'CC0 for Wikidata data', 0.7)`
  );
  const company = db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, founded_year, sector, source_name, source_url, source_license, as_of)
     VALUES (?, ?, ?, ?, ?, 'AI', 'Wikidata', ?, 'CC0 (Wikidata data); website links are references', '2026-10-01')`
  );
  company.run('q1', 'Aurelia Analytics', 'https://aurelia.example', 'United States', 2015, 'https://www.wikidata.org/wiki/Q1');
  company.run('q2', 'Brightline Robotics', 'https://brightline.example', 'Germany', 2018, 'https://www.wikidata.org/wiki/Q2');
  const link = db.prepare(
    `INSERT INTO research_market_companies (id, market_id, company_uid, relationship_type, primary_market, source_id, source_url, verified_at, confidence)
     VALUES (?, 'ai', ?, ?, 1, 'wikidata', ?, '2026-10-01', 0.7)`
  );
  link.run('universe:ai:q1', 'q1', 'core', 'https://www.wikidata.org/wiki/Q1');
  link.run('universe:ai:q2', 'q2', 'core', 'https://www.wikidata.org/wiki/Q2');
  link.run('supplier:ai:q2', 'q2', 'supplier', 'https://www.wikidata.org/wiki/Q2');
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(OWNER)}`,
    ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  const res = await research.fetch(
    new Request(`http://x${path}`, {
      method: init.method || 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('a market reads back whole: its record, its observations, its graph and their sources', async () => {
  const db = freshDb();
  const res = await call(db, '/markets/ai');
  assert.equal(res.status, 200);
  assert.equal(res.body.market.market_name, 'AI');
  assert.equal(res.body.metrics.length, 1);
  assert.equal(res.body.facets.length, 1);
  assert.equal(res.body.companies.total, 3, 'the graph counts every relationship');
  assert.equal(res.body.companies.items.length, 2, 'core companies, one row each');
  assert.equal(res.body.companies.items[0].name, 'Aurelia Analytics', 'the company row is joined, not just an id');
  // The source list is the sources the returned rows lean on — not the whole
  // registry, which would print a longer list than the page can show.
  assert.deepEqual(res.body.sources.map((s: any) => s.source_id).sort(), ['axal_taxonomy', 'wikidata']);
  assert.match(res.body.boundary, /observation with its source and date/);
});

test('an unknown market is a 404, not an empty record', async () => {
  const db = freshDb();
  const res = await call(db, '/markets/quantum-teapots');
  assert.equal(res.status, 404);
  // And a write to one is refused before it can create a market by accident.
  const write = await call(db, '/markets/quantum-teapots/metrics', {
    method: 'POST',
    body: { metric_name: 'tam', metric_value: 10, source_id: 'axal_taxonomy' },
  });
  assert.equal(write.status, 404);
});

test('a number without a citation is refused, and a cited one is appended', async () => {
  const db = freshDb();
  const uncited = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: { metric_name: 'tam', metric_value: 4200, metric_unit: 'USD_bn', base_year: 2026 },
  });
  assert.equal(uncited.status, 400, 'an unsourced market size was accepted');
  assert.match(uncited.body.detail, /source_url/);

  const cited = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: {
      metric_name: 'tam', metric_value: 4200, metric_unit: 'USD_bn', base_year: 2026,
      source_id: 'analyst_report', source_name: 'Example Research', source_url: 'https://example.invalid/tam-2026',
      publication_date: '2026-06-01', retrieved_at: '2026-09-30',
    },
  });
  assert.equal(cited.status, 201);
  assert.equal(cited.body.appended, true);

  // Re-ingesting the same publication is a no-op: one row, not two.
  const again = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: {
      metric_name: 'tam', metric_value: 4200, metric_unit: 'USD_bn', base_year: 2026,
      source_id: 'analyst_report', source_name: 'Example Research', source_url: 'https://example.invalid/tam-2026',
      publication_date: '2026-06-01', retrieved_at: '2026-09-30',
    },
  });
  assert.equal(again.status, 201);
  const list = await call(db, '/markets/ai/metrics?metric=tam');
  assert.equal(list.body.items.length, 1, 'the same observation was stored twice');

  // A NEWER FIGURE IS A NEW ROW, and the old one stands.
  const revised = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: {
      metric_name: 'tam', metric_value: 5100, metric_unit: 'USD_bn', base_year: 2027,
      source_id: 'analyst_report', source_name: 'Example Research', source_url: 'https://example.invalid/tam-2027',
      publication_date: '2027-01-15', retrieved_at: '2027-01-20',
    },
  });
  assert.equal(revised.status, 201);
  const both = await call(db, '/markets/ai/metrics?metric=tam');
  assert.equal(both.body.items.length, 2, 'the revised figure overwrote the one it corrects');
  assert.deepEqual(both.body.items.map((m: any) => m.metric_value).sort(), [4200, 5100]);
  // Newest first, so the page leads with the current figure.
  assert.equal(both.body.items[0].metric_value, 5100);
});

test('Axal’s own taxonomy is the one source that needs no URL', async () => {
  const db = freshDb();
  const res = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: { metric_name: 'supplied_company_count', metric_value: 3100, metric_unit: 'companies', base_year: 2026, source_id: 'axal_taxonomy', source_name: 'Axal taxonomy' },
  });
  assert.equal(res.status, 201);
  // Anything else claiming the same privilege is still refused.
  const other = await call(db, '/markets/ai/metrics', {
    method: 'POST',
    body: { metric_name: 'market_size', metric_value: 10, source_id: 'analyst_report' },
  });
  assert.equal(other.status, 400);
});

test('a PATCH sets the record’s own fields and nothing else', async () => {
  const db = freshDb();
  const refused = await call(db, '/markets/ai', {
    method: 'PATCH',
    body: { market_id: 'something-else', injected: 'x', fetch: 'sql' },
  });
  assert.equal(refused.status, 400, 'a patch with no known field was accepted');
  const ok = await call(db, '/markets/ai', {
    method: 'PATCH',
    body: { definition: 'Systems that learn from data.', adoption_stage: 'growth' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.item.definition, 'Systems that learn from data.');
  const read = await call(db, '/markets/ai');
  assert.equal(read.body.market.adoption_stage, 'growth');
  // The identity the route is keyed by is not patchable.
  assert.equal(read.body.market.market_id, 'ai');
});

test('the graph is a graph: relationships are filtered, and the total is the market’s own', async () => {
  const db = freshDb();
  const core = await call(db, '/markets/ai/companies?limit=1');
  assert.equal(core.body.items.length, 1);
  assert.equal(core.body.total, 2, 'total reported the page rather than the market');
  const suppliers = await call(db, '/markets/ai/companies?relationship=supplier');
  assert.equal(suppliers.body.items.length, 1);
  assert.equal(suppliers.body.items[0].company_uid, 'q2');
  assert.equal(suppliers.body.total, 1);
  // An unknown relationship name falls back to the default rather than
  // returning an empty page that reads like an empty market.
  const unknown = await call(db, '/markets/ai/companies?relationship=partner-ish');
  assert.equal(unknown.body.relationship, 'core');
  assert.equal(unknown.body.total, 2);
});

test('a recorded statement needs a citation too, and industry resolution reads back', async () => {
  const db = freshDb();
  const uncited = await call(db, '/markets/ai/facets', {
    method: 'POST', body: { kind: 'trend', label: 'Consolidation', detail: 'Everyone says so.' },
  });
  assert.equal(uncited.status, 400);

  const cited = await call(db, '/markets/ai/facets', {
    method: 'POST',
    body: {
      kind: 'trend', label: 'On-device inference', detail: 'Smaller models shipping to the edge.',
      observed_at: '2026-09-01', source_id: 'hn_discussion', source_url: 'https://news.ycombinator.com/item?id=1',
    },
  });
  assert.equal(cited.status, 201);

  const resolved = await call(db, '/markets/ai/facets?kind=industry_resolution');
  assert.equal(resolved.body.items.length, 1);
  assert.equal(resolved.body.items[0].source_url, 'https://www.wikidata.org/wiki/Q11660');
  const trends = await call(db, '/markets/ai/facets?kind=trend');
  assert.equal(trends.body.items.length, 1);
});

test('funds and rounds read as empty with a reason, not as zero', async () => {
  const db = freshDb();
  const funds = await call(db, '/markets/ai/funds');
  assert.equal(funds.status, 200);
  assert.deepEqual(funds.body.items, []);
  assert.match(funds.body.boundary, /no licensed fund or deal register/i);
  const rounds = await call(db, '/markets/ai/investments');
  assert.deepEqual(rounds.body.items, []);
  assert.match(rounds.body.boundary, /no licensed deal feed/i);
});