/**
 * D7651 (#7651, canvas D7039 board RMP-12) — the Eadwyn summary of one market
 * reading, to the cent.
 *
 * Held here, against the real router on the migrated schema:
 *   - amounts leave as the stored cents and as two-decimal text, and that text
 *     reads back through `lib/money.js` to the same cents: 99.50, 99.99,
 *     4500.00 and 6000.00 survive the round trip exactly, and the line writes
 *     $99.50 – $99.99 and $4,500.00 – $6,000.00, never a rounded dollar;
 *   - the catalog price is a separate fact: recorded for a priced service line,
 *     Not recorded for an unpriced one, Not applicable without a service line;
 *   - an investor-only account is refused before anything is read (D6273 Q2);
 *   - another member's reading is a 404, the same as a missing one;
 *   - the summary is computed from the stored row: the handler calls no model.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_market_summary_7651.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import clientPrep from '../src/routes/research_client_prep.ts';
import { readingSummary, readingUsd } from '../src/services/marketReadingRead.ts';
import { parseMinor } from '../../frontend/src/lib/money.js';

const JWT_SECRET = 'unit-test-jwt-secret-d7651-summary-0123456789';
const ME = 81, OTHER = 82, INVESTOR = 83;

function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ME, 'partner', 'Pat Partner', 'pat@example.test');
  u.run(OTHER, 'partner', 'Oli Other', 'oli@example.test');
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test');
  const o = db.prepare(
    `INSERT INTO service_offerings (id, uid, owner_user_id, title, category, summary, price_usd, price_cents, is_active)
     VALUES (?, ?, ?, ?, 'advisory', '', ?, ?, 1)`,
  );
  o.run(1, 'off-priced', ME, 'Seed financial model build', 4500, 450000);
  o.run(2, 'off-unpriced', ME, 'Board-pack preparation', null, null);
  return db;
}

const app = new Hono<any>();
app.route('/api/research', clientPrep as any);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = ME) {
  const token = await new SignJWT({ user_id: who, role: 'partner' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  } finally { [console.warn, console.error] = saved; }
}

async function record(db: DatabaseSync, reading: Record<string, unknown>, who = ME): Promise<string> {
  const res = await call(db, 'POST', '/api/research/market-readings', reading, who);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item.uid;
}

const back = (text: string) => {
  const p = parseMinor(text, 'USD') as { ok: boolean; minor?: number };
  assert.ok(p.ok, `${text} does not read back as money`);
  return p.minor;
};

test('99.50 – 99.99 leaves as cents and two-decimal text, and reads back to the same cents', async () => {
  const db = world();
  const uid = await record(db, {
    metric: 'Investor-update edit · per update', scope: 'One investor update, one revision round',
    range_low_cents: 9950, range_high_cents: 9999, comparable_count: 7, ran_at: '2026-11-16',
  });
  const res = await call(db, 'GET', `/api/research/market-readings/${uid}/summary`);
  assert.equal(res.status, 200);
  const s = res.body.summary;
  assert.deepEqual(s.range, { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '99.50', high_usd: '99.99' });
  assert.equal(back(s.range.low_usd), 9950);
  assert.equal(back(s.range.high_usd), 9999);
  assert.equal(
    s.line,
    'Investor-update edit · per update (One investor update, one revision round): $99.50 – $99.99, from 7 comparables, run 2026-11-16',
  );
  assert.equal(s.service_line, false);
  assert.equal(s.catalog_price.status, 'not_applicable');
  assert.equal(s.comparable_count, 7);
  assert.equal(s.ran_at, '2026-11-16');
  assert.equal(s.basis, 'stored_reading');
});

test('4500.00 – 6000.00 on a priced service line keeps the catalog price beside the range, to the cent', async () => {
  const db = world();
  const uid = await record(db, {
    offering_uid: 'off-priced', range_low_cents: 450000, range_high_cents: 600000, comparable_count: 12, ran_at: '2026-09-02',
  });
  const s = (await call(db, 'GET', `/api/research/market-readings/${uid}/summary`)).body.summary;
  assert.equal(s.metric, 'Seed financial model build');
  assert.equal(s.range.low_usd, '4500.00');
  assert.equal(s.range.high_usd, '6000.00');
  assert.equal(back(s.range.low_usd), 450000);
  assert.equal(back(s.range.high_usd), 600000);
  assert.equal(s.line, 'Seed financial model build: $4,500.00 – $6,000.00, from 12 comparables, run 2026-09-02');
  assert.equal(s.service_line, true);
  assert.deepEqual(s.catalog_price, { status: 'recorded', cents: 450000, usd: '4500.00' });
  assert.equal(back(s.catalog_price.usd), 450000);
});

test('an unpriced service line says Not recorded for its catalog price, never $0.00', async () => {
  const db = world();
  const uid = await record(db, {
    offering_uid: 'off-unpriced', range_low_cents: 0, range_high_cents: 0, comparable_count: 1, ran_at: '2026-10-20',
  });
  const s = (await call(db, 'GET', `/api/research/market-readings/${uid}/summary`)).body.summary;
  assert.equal(s.catalog_price.status, 'not_recorded');
  assert.equal(s.catalog_price.usd, undefined);
  // A $0.00 range is a stored range, written to the cent, from 1 comparable.
  assert.equal(s.line, 'Board-pack preparation: $0.00 – $0.00, from 1 comparable, run 2026-10-20');
});

test('an investor-only account is refused before the reading is read (D6273 Q2)', async () => {
  const db = world();
  const uid = await record(db, { metric: 'Retainer', range_low_cents: 100, range_high_cents: 200, comparable_count: 2, ran_at: '2026-11-01' });
  // The investor's own row, so the refusal is not a 404 in disguise.
  db.prepare('UPDATE research_market_readings SET owner_user_id = ? WHERE uid = ?').run(INVESTOR, uid);
  const res = await call(db, 'GET', `/api/research/market-readings/${uid}/summary`, undefined, INVESTOR);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'readings_hidden_for_investors');
  assert.equal(res.body.summary, undefined);
});

test('another member’s reading is a 404, the same as a missing one', async () => {
  const db = world();
  const uid = await record(db, { metric: 'Retainer', range_low_cents: 9950, range_high_cents: 9999, comparable_count: 3, ran_at: '2026-11-01' }, OTHER);
  const theirs = await call(db, 'GET', `/api/research/market-readings/${uid}/summary`);
  assert.equal(theirs.status, 404);
  assert.equal(theirs.body.error, 'not_found');
  assert.equal(theirs.body.summary, undefined);
  const missing = await call(db, 'GET', '/api/research/market-readings/nope/summary');
  assert.equal(missing.status, 404);
  // The owner still reads it.
  assert.equal((await call(db, 'GET', `/api/research/market-readings/${uid}/summary`, undefined, OTHER)).status, 200);
});

test('readingSummary: a range that does not read forward is Not recorded and has no line', () => {
  const base = { uid: 'u', metric: 'M', scope: '  ', comparable_count: 4, ran_at: '2026-11-16T00:00:00Z', offering_uid: null, price_cents: null, price_usd: null };
  const backwards = readingSummary({ ...base, range_low_cents: 9999, range_high_cents: 9950 });
  assert.equal(backwards.range.status, 'not_recorded');
  assert.equal(backwards.line, null);
  const ok = readingSummary({ ...base, range_low_cents: 1, range_high_cents: 1 });
  assert.equal(ok.scope, null, 'a blank scope is Not recorded');
  assert.equal(ok.ran_at, '2026-11-16');
  assert.equal(ok.line, 'M: $0.01 – $0.01, from 4 comparables, run 2026-11-16');
  assert.equal(readingUsd(-5), null);
  assert.equal(readingUsd(1.5), null);
  assert.equal(readingUsd(450000), '4500.00');
});

test('the summary handler calls no model and converts through the money layer only', () => {
  const src = readFileSync(new URL('../src/routes/research_client_prep.ts', import.meta.url), 'utf8');
  const at = src.indexOf("research.get('/market-readings/:uid/summary'");
  assert.ok(at > 0, 'the summary route is not registered');
  const handler = src.slice(at, src.indexOf('// Brief notes', at));
  assert.match(handler, /holdsOnlyLicence\(user, 'investor'\)/);
  assert.match(handler, /r\.owner_user_id = \?/);
  assert.doesNotMatch(handler, /env\.AI|runAi|callModel|anthropic|openai|\/ 100|Math\.round/i);
  const service = readFileSync(new URL('../src/services/marketReadingRead.ts', import.meta.url), 'utf8');
  const fn = service.slice(service.indexOf('export function readingSummary'));
  assert.doesNotMatch(fn, /\/ 100|Math\.round|toFixed/);
});
