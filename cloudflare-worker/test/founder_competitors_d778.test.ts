/**
 * D778 part 9 (#2103) — Research · Companies' five presses through the run
 * path: `analyse:competitors` (Analyze competitors), `analyse:again` (Re-run),
 * `analyse:sources` (Refresh sources), `extract:candidate` (Add, with a site to
 * crawl) and `extract:site` (Crawl site). Each run names the page and option
 * D771's inventory gives it, where before every one logged `research` /
 * `scan:competitors`; a mounted rail's page and the press's option win, so the
 * advisor's board logs its own keys (D773); the record is the analysis the
 * route scoped, never the browser's label.
 *
 * Real SQLite (the baseline plus every migration above BASELINE_CUTOFF), a
 * stubbed, guarded model, a stubbed public web, made-up data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_competitors_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import competitors from '../src/routes/competitors.ts';
import { COMPANIES_OPTIONS, COMPANIES_PAGE } from '../src/services/competitorAnalysis.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d778-competitors-0123456789';
const FOUNDER = 1;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10);
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000);`);
  return db;
}

/** The public web, stubbed: every page is the same small marketing page. Restored after each call. */
async function withWeb<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    '<html><head><title>Ledgerline</title><meta name="description" content="Freight invoice reconciliation."></head>'
    + '<body><h1>Reconcile freight invoices</h1><p>Plans from $99 a month. We reconcile carrier invoices for freight teams.</p></body></html>',
    { status: 200, headers: { 'content-type': 'text/html' } },
  )) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = prev; }
}

async function call(db: any, method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
  const AI: any = withGuard({
    run: async (_m: string, input: any) => {
      const sys = String(input?.messages?.[0]?.content || '');
      if (sys.includes('competitive-intelligence analyst')) {
        return { response: JSON.stringify([{ name: 'Ledgerline', domain: 'ledgerline.example', category: 'direct', why: 'Reconciles freight invoices.' }]) };
      }
      if (sys.includes('positioning/messaging')) return { response: JSON.stringify({ positioning: 'Freight invoice reconciliation for mid-size carriers.' }) };
      return { response: JSON.stringify({ market_summary: 'A crowded back office.', gaps: ['Carrier disputes'], wedge: 'Disputes first.', next_actions: ['Interview five carriers'] }) };
    },
  });
  const app = new Hono<any>();
  app.route('/api/competitors', competitors);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withWeb(() => app.fetch(new Request(`http://t/api/competitors${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
/** The answered runs' own usage rows, oldest first (the guard's rows name theirs in `guard_for`). */
const runsSince = (db: any, after: number) => (db.prepare(
  'SELECT id, user_id, rail_page, rail_option, record_ref FROM ai_usage_logs WHERE guard_for IS NULL AND id > ? ORDER BY id',
).all(after) as any[]).map((r) => ({ ...r }));
const lastRun = (db: any) => Number((db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM ai_usage_logs').get() as any).n);
const at = (id: string) => `competitor_analysis:${id}`;

/** Each press, in order, from one analysis: what it called and the option it falls back to. */
async function pressAll(db: any, headersFor: (option: string) => Record<string, string> = () => ({})) {
  const out: Array<{ option: string; rows: any[]; id: string }> = [];
  let mark = lastRun(db);
  const made = await call(db, 'POST', '/analyze', { market: 'Freight invoice reconciliation', depth: 'quick' }, headersFor(COMPANIES_OPTIONS.analyze));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = String(made.body.id);
  out.push({ option: COMPANIES_OPTIONS.analyze, rows: runsSince(db, mark), id });
  for (const [option, path, json] of [
    [COMPANIES_OPTIONS.again, `/${id}/rerun`, { keep_manual: true }],
    [COMPANIES_OPTIONS.sources, `/${id}/refresh`, {}],
    [COMPANIES_OPTIONS.candidate, `/${id}/candidates`, { name: 'Tallyfreight', url: 'https://tallyfreight.example', crawl: true }],
  ] as const) {
    mark = lastRun(db);
    const r = await call(db, 'POST', path, json, headersFor(option));
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
    out.push({ option, rows: runsSince(db, mark), id });
  }
  const full = await call(db, 'GET', `/${id}`);
  const added = (full.body.candidates as any[]).find((c) => c.name === 'Tallyfreight');
  assert.ok(added?.url, 'the added company has its site');
  mark = lastRun(db);
  const crawled = await call(db, 'POST', `/${id}/candidates/${added.id}/crawl`, {}, headersFor(COMPANIES_OPTIONS.site));
  assert.equal(crawled.status, 200, JSON.stringify(crawled.body));
  out.push({ option: COMPANIES_OPTIONS.site, rows: runsSince(db, mark), id });
  return out;
}

test('D778: Companies\' five presses fall back to the page and options D771\'s inventory gives them', () => {
  const rows = FOUNDER_OPTIONS.filter((o: any) => o.page === COMPANIES_PAGE && o.handler !== 'none');
  assert.deepEqual(rows.map((o: any) => o.key).sort(), Object.values(COMPANIES_OPTIONS).sort());
});

test('D778: each press with no rail context names its inventoried option, and the record is its analysis', async () => {
  // Mutations checked: the old fixed rail in runJson (every row reads `research`
  // / `scan:competitors`); each route's railFor dropped or given another
  // option; the crawl's rail not passed to the positioning run.
  const db = fixture();
  for (const press of await pressAll(db)) {
    assert.ok(press.rows.length > 0, `${press.option}: no run was logged`);
    for (const r of press.rows) {
      assert.deepEqual([r.rail_page, r.rail_option, r.record_ref], [COMPANIES_PAGE, press.option, at(press.id)], press.option);
      assert.equal(r.user_id, FOUNDER, 'charged to the member who pressed');
    }
  }
});

test('D778: a mounted rail\'s page and the press\'s option win; the browser\'s record label never does', async () => {
  // Mutations checked: a route passing the fixed fallback instead of railFor; the
  // browser's X-Rail-Record winning over the scoped analysis.
  const db = fixture();
  // The advisor's Companies board (D773) presses the same routes with its own keys.
  const ADVISOR_KEYS: Record<string, string> = {
    [COMPANIES_OPTIONS.analyze]: 'analyze:competitors',
    [COMPANIES_OPTIONS.again]: 'rerun:analysis',
    [COMPANIES_OPTIONS.sources]: 'refresh:sources',
  };
  const page = 'Advisor · Research · Companies';
  const sent = (option: string) => ADVISOR_KEYS[option] ?? option;
  const presses = await pressAll(db, (option) => ({
    'X-Rail-Page': encodeURIComponent(page), 'X-Rail-Option': encodeURIComponent(sent(option)), 'X-Rail-Record': 'project:999',
  }));
  for (const press of presses) {
    assert.ok(press.rows.length > 0, press.option);
    for (const r of press.rows) assert.deepEqual([r.rail_page, r.rail_option, r.record_ref], [page, sent(press.option), at(press.id)], press.option);
  }
});

test('D778: adding a company without a crawl runs no model, and a fill\'s add still never crawls', async () => {
  // A plain Add is a manual row: no page is fetched and no run is logged.
  const db = fixture();
  const made = await call(db, 'POST', '/analyze', { market: 'Freight invoice reconciliation', depth: 'quick' });
  const mark = lastRun(db);
  const r = await call(db, 'POST', `/${made.body.id}/candidates`, { name: 'Plainrow', crawl: false });
  assert.equal(r.status, 200);
  assert.deepEqual(runsSince(db, mark), []);
  const registry = readFileSync(resolve(here, '../src/services/fills/registry.ts'), 'utf8');
  assert.match(registry, /crawl: false/, 'an accepted fill adds the row without crawling');
});
