/**
 * D4357 (#4357) — the Incorporate quote, line by line, before the founder commits.
 *
 *   1. The real route (`GET /api/legal/incorporation/itemised-quote`) on a
 *      seeded catalog: the state filing fee reads null with its official
 *      source and no checked day; Axal VC's service fee is the catalog price
 *      the one-price quote (and so the order) charges, dated by the mirror's
 *      sync; the registered agent and a tagged add-on are optional lines; the
 *      total is the known lines only and names the unknown one.
 *   2. A full quote: every line in the total known, the total their sum and
 *      complete. A figure without the day it was checked, or a zero, is never
 *      shown as known.
 *   3. Nothing configured: no line in the total is known, the total is null,
 *      never 0; an unknown jurisdiction is refused.
 *   4. The table: one entry per jurisdiction the Worker forms, each naming an
 *      official https source, and no amount without its checked day.
 *
 * Every principal and price is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/incorporation_quote_d4357.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import legal, { JURISDICTIONS } from '../src/routes/legal.ts';
import legalIncorporationQuote from '../src/routes/legal_incorporation_quote.ts';
import { STATE_FILING_FEES, quoteOf } from '../src/services/incorporationQuote.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d4357-incorporation-quote-0123';
const FOUNDER = 10;
const SERVICE = 50000, AGENT = 24900, ADDON = 9900;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture({ catalog = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('users'));
  db.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'alacarte',
    active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL DEFAULT (datetime('now')), livemode INTEGER)`);
  const p = db.prepare('INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, synced_at, livemode) VALUES (?, ?, ?, 1, ?, ?, ?, 0)');
  const price = (id: string, amount: number, interval: string | null) => JSON.stringify([{ id: `price_${id}`, product: id, unit_amount: amount, currency: 'usd', type: interval ? 'recurring' : 'one_time', interval, active: true }]);
  if (catalog) {
    p.run('prod_de', 'Synthetic incorporation Delaware', 'alacarte', JSON.stringify({ jurisdiction_id: 'us_de_ccorp' }), price('prod_de', SERVICE, null), '2026-11-02 10:00:00');
    p.run('prod_ra', 'Synthetic registered agent', 'subscription', JSON.stringify({ category: 'registered_agent' }), price('prod_ra', AGENT, 'year'), '2026-11-01 08:30:00');
    p.run('prod_ein', 'Synthetic EIN filing', 'alacarte', JSON.stringify({ category: 'incorporation_addon' }), price('prod_ein', ADDON, null), '2026-10-30 12:00:00');
  } else {
    // An unrelated product, so the mirror is not empty and nothing tries to sync.
    p.run('prod_other', 'Synthetic other', 'alacarte', '{}', price('prod_other', 100, null), '2026-11-02 10:00:00');
  }
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001)").run(FOUNDER);
  return db;
}

const app = new Hono<any>();
app.route('/api/legal', legalIncorporationQuote);
app.route('/api/legal', legal);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  return c.json({ detail: String(err?.message || '') }, s || 500);
});

async function call(db: any, path: string, as: number | null = FOUNDER) {
  const headers: Record<string, string> = {};
  if (as) headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await app.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: 'sk_test_fixture', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const byKey = (body: any, key: string) => body.lines.find((l: any) => l.key === key);

test('D4357 1: the route itemises the quote; the unknown state fee reads null and the total says so', async () => {
  const db = fixture();
  const r = await call(db, '/api/legal/incorporation/itemised-quote?jurisdiction_id=us_de_ccorp');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.jurisdiction_id, 'us_de_ccorp');
  assert.deepEqual(r.body.lines.map((l: any) => l.key), ['state_filing_fee', 'service_fee', 'registered_agent', 'add_on:prod_ein']);

  const state = byKey(r.body, 'state_filing_fee');
  assert.equal(state.amount_cents, null, 'never 0');
  assert.equal(state.source, 'Delaware Division of Corporations, fee schedule');
  assert.equal(state.source_url, 'https://corp.delaware.gov/fee/');
  assert.equal(state.checked_on, null);
  assert.equal(state.paid, 'at_filing');
  assert.equal(state.optional, false);

  const service = byKey(r.body, 'service_fee');
  const one = await call(db, '/api/legal/incorporation/quote?jurisdiction_id=us_de_ccorp');
  assert.equal(service.amount_cents, one.body.amount_cents, 'the service fee is the price the order charges');
  assert.equal(service.amount_cents, SERVICE);
  assert.equal(service.checked_on, '2026-11-02', 'dated by the mirror\'s sync');
  assert.equal(service.paid, 'with_order');

  const agent = byKey(r.body, 'registered_agent');
  assert.deepEqual([agent.amount_cents, agent.interval, agent.optional, agent.checked_on, agent.label], [AGENT, 'year', true, '2026-11-01', 'Synthetic registered agent']);
  const addOn = byKey(r.body, 'add_on:prod_ein');
  assert.deepEqual([addOn.amount_cents, addOn.optional, addOn.label], [ADDON, true, 'Synthetic EIN filing']);

  assert.deepEqual(r.body.total, { amount_cents: SERVICE, currency: 'usd', complete: false, unknown: ['State filing fee'] },
    'the known lines only, the optional ones left out, the unknown one named');
});

test('D4357 2: a full quote: every line in the total known, their sum, complete; no figure without its day', () => {
  const table = { us_de_ccorp: { amount_cents: 8900, currency: 'usd', source: 'Synthetic schedule', source_url: 'https://example.test/fees', checked_on: '2026-11-04' } };
  const q = quoteOf({ jurisdictionId: 'us_de_ccorp', stateFees: table, service: { amount_cents: SERVICE, currency: 'USD', synced_at: '2026-11-02T10:00:00Z' }, agent: { amount_cents: AGENT, currency: 'usd', interval: 'year', name: 'RA' } });
  assert.deepEqual(q.total, { amount_cents: 8900 + SERVICE, currency: 'usd', complete: true, unknown: [] });
  assert.equal(q.lines[0].checked_on, '2026-11-04');

  const undated = quoteOf({ jurisdictionId: 'us_de_ccorp', stateFees: { us_de_ccorp: { ...table.us_de_ccorp, checked_on: null } }, service: { amount_cents: SERVICE, currency: 'usd' }, agent: null });
  assert.equal(undated.lines[0].amount_cents, null, 'a figure nobody dated is not shown');
  assert.equal(undated.total.complete, false);
  const zero = quoteOf({ jurisdictionId: 'us_de_ccorp', stateFees: { us_de_ccorp: { ...table.us_de_ccorp, amount_cents: 0 } }, service: { amount_cents: 0, currency: 'usd' }, agent: null });
  assert.deepEqual([zero.lines[0].amount_cents, zero.lines[1].amount_cents, zero.total.amount_cents], [null, null, null], 'a zero is not a known fee');
  const otherCurrency = quoteOf({ jurisdictionId: 'uk_ltd', stateFees: { uk_ltd: { amount_cents: 5000, currency: 'gbp', source: 'Synthetic', source_url: 'https://example.test', checked_on: '2026-11-04' } }, service: { amount_cents: SERVICE, currency: 'usd' }, agent: null });
  assert.deepEqual(otherCurrency.total, { amount_cents: SERVICE, currency: 'usd', complete: false, unknown: ['State filing fee'] }, 'a fee in another currency is not added in');
});

test('D4357 3: nothing configured is null, never 0; an unknown jurisdiction is refused; nobody signed in reads nothing', async () => {
  const db = fixture({ catalog: false });
  const r = await call(db, '/api/legal/incorporation/itemised-quote?jurisdiction_id=us_de_ccorp');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(byKey(r.body, 'service_fee').amount_cents, null);
  assert.equal(byKey(r.body, 'registered_agent').amount_cents, null);
  assert.equal(byKey(r.body, 'registered_agent').source, 'Not recorded');
  assert.deepEqual(r.body.total, { amount_cents: null, currency: 'usd', complete: false, unknown: ['State filing fee', 'Axal VC service fee'] });
  assert.equal(r.body.lines.some((l: any) => l.amount_cents === 0), false);
  const bad = await call(db, '/api/legal/incorporation/itemised-quote?jurisdiction_id=mars_llc');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'unknown_jurisdiction');
  const anon = await call(db, '/api/legal/incorporation/itemised-quote?jurisdiction_id=us_de_ccorp', null);
  assert.equal(anon.status, 401, 'nobody signed in is refused');
});

test('D4357 4: one fee entry per jurisdiction, each with an official https source, and no amount without its day', () => {
  assert.deepEqual(Object.keys(STATE_FILING_FEES).sort(), JURISDICTIONS.map((j) => j.id).sort());
  for (const [id, fee] of Object.entries(STATE_FILING_FEES)) {
    assert.match(fee.source_url, /^https:\/\//, `${id}: an https source`);
    assert.ok(fee.source.trim(), `${id}: the source is named`);
    if (fee.amount_cents != null) assert.match(String(fee.checked_on), /^\d{4}-\d{2}-\d{2}$/, `${id}: an amount comes with the day it was checked`);
  }
  assert.match(readFileSync('cloudflare-worker/src/routes/legal_incorporation_quote.ts', 'utf8'),
    /export const mount: RouteMount = \{ path: '\/api\/legal', router: legalIncorporationQuote, before: \[legal\] \};/);
});
