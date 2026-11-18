/**
 * D7180 (#7180, D7046) — the Worker half of the Research › Companies profile
 * build, on the fully migrated schema (baseline plus every migration).
 *
 * Pins:
 *   · each metric carries its own publisher, URL, confidence and observed
 *     date; a field citation (`company_sources.field_name`) is the metric's
 *     own publisher, else the directory record's shared source, named as such;
 *   · an unknown observation date is null and never the update date, which
 *     is `updated_on`, kept apart;
 *   · `?part=` reads one evidence collection on its own, refuses a part it
 *     does not know, and reports a failed read as Unreadable on its own;
 *   · peers carry the rule the query ran. (The analysis subject is D7175's,
 *     pinned by competitor_subject_evidence_7175.)
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_profile_7180.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import research from '../src/routes/research.ts';
import competitors from '../src/routes/competitors.ts';
import { citationFor, presentMetrics, PEER_LIMIT } from '../src/services/researchCompanyDirectory.ts';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-7180-0123456789-abcdef';
const USER = 41;

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', 'Fin', 'fin-7180@example.invalid', 1)`).run(USER);
  const ins = db.prepare(
    `INSERT INTO research_company_directory (uid, name, website, country, founded_year, sector, source_url, as_of,
       funding_total, funding_currency, last_funding_amount, last_funding_currency, last_funding_date, last_funding_type,
       revenue, revenue_currency, revenue_as_of, employee_count, employee_as_of,
       metrics_source_name, metrics_source_url, metrics_confidence, metrics_updated_at)
     VALUES (?, ?, ?, ?, 2019, ?, 'https://www.wikidata.org/wiki/Q1', '2026-11-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // A funding total with no observation date, a round with its announcement
  // date, revenue with its own as-of, a headcount with none.
  ins.run('halden', 'Halden Grid', 'https://haldengrid.example', 'Norway', 'energy storage',
    24_000_000, 'USD', 18_000_000, 'USD', '2025-03-14', 'Series A', 38_400_000, 'NOK', '2025-12-31', 64, null,
    'Shared register', 'https://shared.example/r', 'medium', '2026-11-02');
  ins.run('bright', 'Brightwell Storage', 'https://brightwell.example', 'Norway', 'Energy Storage ',
    null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
  ins.run('ampere', 'Ampere Field', 'https://amperefield.example', 'Germany', 'energy storage',
    null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
  const id = (db.prepare(`SELECT id FROM research_company_directory WHERE uid = 'halden'`).get() as any).id as number;
  const cite = db.prepare(`INSERT INTO company_sources (company_id, field_name, source_name, source_type, source_url, publication_date, retrieved_at, confidence)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  cite.run(id, 'funding_total', 'Funding register', 'database', 'https://register.example/h', '2026-10-28', '2026-11-02', 'medium');
  cite.run(id, 'revenue', 'Annual accounts', 'filing', 'https://filings.example/h', '2026-06-18', '2026-06-20', 'high');
  cite.run(id, 'revenue', 'A blog post', 'web', 'https://blog.example/h', '2026-09-01', '2026-09-02', 'low');
  db.prepare(`INSERT INTO company_funding_rounds (company_id, round_type, announcement_date, amount, currency, source_name, source_url)
              VALUES (?, 'Series A', '2025-03-14', 18000000, 'USD', 'Funding register', 'https://register.example/a')`).run(id);
  return { db, id };
}

const app = new Hono<any>();
app.route('/api/research', research);
app.route('/api/competitors', competitors as any);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  return c.json({ detail: msg }, msg === 'Unauthorized' ? 401 : 500);
});

async function call(db: InstanceType<typeof DatabaseSync>, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: USER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, globalThis.fetch];
  console.warn = () => {}; console.error = () => {};
  // No run in this file reaches the web.
  globalThis.fetch = (async () => { throw new Error('no network in tests'); }) as any;
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, globalThis.fetch] = saved as any; }
}

test('a field citation is the metric’s own publisher, URL and confidence', async () => {
  const { db } = fixture();
  const m = (await call(db, 'GET', '/api/research/company-directory/halden')).body.metrics;
  assert.deepEqual([m.funding_total.publisher, m.funding_total.url, m.funding_total.confidence, m.funding_total.provenance],
    ['Funding register', 'https://register.example/h', 'medium', 'field_citation']);
  assert.equal(m.funding_total.citation.publication_date, '2026-10-28');
  assert.deepEqual([m.revenue.publisher, m.revenue.confidence, m.revenue.confidence_basis], ['Annual accounts', 'high', 'field_citation'],
    'the most confident citation wins over a later, weaker one');
});

test('without a citation a metric names the directory record’s shared source as such', async () => {
  const { db } = fixture();
  const m = (await call(db, 'GET', '/api/research/company-directory/halden')).body.metrics;
  assert.deepEqual([m.headcount.publisher, m.headcount.url, m.headcount.provenance, m.headcount.confidence, m.headcount.confidence_basis],
    ['Shared register', 'https://shared.example/r', 'directory_record', 'medium', 'directory_record']);
  assert.equal(m.headcount.citation, null);
});

test('an unknown observation date is null, never the update date, which is kept apart', async () => {
  const { db } = fixture();
  const m = (await call(db, 'GET', '/api/research/company-directory/halden')).body.metrics;
  assert.equal(m.funding_total.observed_on, null, 'funding total has no observation column');
  assert.equal(m.funding_total.as_of, null, 'as_of no longer falls back to metrics_updated_at');
  assert.equal(m.funding_total.updated_on, '2026-11-02');
  assert.equal(m.headcount.observed_on, null, 'a blank employee_as_of stays blank');
  assert.equal(m.headcount.updated_on, '2026-11-02');
  assert.deepEqual([m.last_funding.observed_on, m.last_funding.observed_basis], ['2025-03-14', 'announced']);
  assert.deepEqual([m.revenue.observed_on, m.revenue.observed_basis], ['2025-12-31', 'as_of']);
  assert.equal(m.updated_on, '2026-11-02');
  assert.deepEqual([m.valuation.status, m.valuation.value, m.valuation.observed_on, m.valuation.publisher], ['not_recorded', null, null, null]);
});

test('presentMetrics: a failed citations read falls back to the record, and says so', () => {
  const r = { funding_total: 5, funding_currency: 'USD', metrics_source_name: 'Rec', metrics_updated_at: '2026-01-01' };
  const m = presentMetrics(r, null);
  assert.deepEqual([m.funding_total.publisher, m.funding_total.provenance, m.funding_total.observed_on], ['Rec', 'directory_record', null]);
  assert.equal(citationFor('headcount', [{ field_name: ' Employee_Count ', source_name: 'X' }])?.source_name, 'X', 'field names match without case or spaces');
  assert.equal(citationFor('headcount', [{ field_name: 'revenue', source_name: 'X' }]), null);
});

test('?part= reads one evidence collection on its own', async () => {
  const { db } = fixture();
  const r = await call(db, 'GET', '/api/research/company-directory/halden?part=funding_rounds');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['funding_rounds', 'part', 'source_boundary', 'uid'], 'the company itself is not re-read');
  assert.deepEqual([r.body.funding_rounds.status, r.body.funding_rounds.rows.map((x: any) => x.round_type)], ['ok', ['Series A']]);
  const sources = (await call(db, 'GET', '/api/research/company-directory/halden?part=sources')).body.sources;
  assert.equal(sources.rows.length, 3);
  const bad = await call(db, 'GET', '/api/research/company-directory/halden?part=company_funding_rounds');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'part');
  assert.equal((await call(db, 'GET', '/api/research/company-directory/nope?part=sources')).status, 404);
  db.exec('DROP TABLE company_employment_history');
  const failed = (await call(db, 'GET', '/api/research/company-directory/halden?part=employment')).body.employment;
  assert.deepEqual([failed.status, failed.rows], ['unreadable', []], 'a failed read is Unreadable, never no rows');
});

test('peers carry the rule the query ran', async () => {
  const { db } = fixture();
  const p = (await call(db, 'GET', '/api/research/company-directory/halden')).body.peers;
  assert.deepEqual(p.rows.map((x: any) => x.uid), ['bright', 'ampere'], 'same country first, then by name');
  assert.deepEqual(p.rule, { sector_label: 'energy storage', country: 'Norway', match: 'same_sector_label', order: ['same_country', 'name'], limit: PEER_LIMIT });
});
