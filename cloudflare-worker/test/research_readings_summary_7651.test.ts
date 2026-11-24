/**
 * D7651 part 2 (#7651, canvas D7039 board RMP-12) — the Eadwyn summary of all
 * of a member's market readings, to the cent, from the stored rows only.
 *
 * Held here, against the real router on the migrated schema:
 *   - `GET /api/research/market-readings/summary` answers with the summary, not
 *     `GET /market-readings/:uid`'s 404 for a reading called "summary";
 *   - each line leaves as the stored cents and two-decimal text, and that text
 *     reads back through `lib/money.js` to the same cents: 99.50, 99.99,
 *     4500.00 and 6000.00 survive the round trip exactly;
 *   - the lines are the card's rows: the newest reading per active service line
 *     and every reading not on one; an older run counts as stored, not as a line;
 *   - current, ageing and stale are counted by the page's bands (30 and 90
 *     days), and the newest run date is the lines' newest;
 *   - only the caller's own rows; an investor-only account refused; an empty
 *     list is a zero count with no lines, never a made-up line;
 *   - the handler calls no model and divides nothing by 100.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_readings_summary_7651.test.ts
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
import { AGE_AT, STALE_AT, readingAgeBand, readingsSummary } from '../src/services/marketReadingRead.ts';
import { AGE_AT as PAGE_AGE_AT, STALE_AT as PAGE_STALE_AT } from '../../frontend/src/pages/research/marketReadingRead.js';
import { parseMinor } from '../../frontend/src/lib/money.js';

const JWT_SECRET = 'unit-test-jwt-secret-d7651-readings-summary-0123';
const ME = 91, OTHER = 92, INVESTOR = 93;
const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10); // clock-ok: relative

function world() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ME, 'partner', 'Pat Partner', 'pat@example.test');
  u.run(OTHER, 'partner', 'Oli Other', 'oli@example.test');
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test');
  const o = db.prepare(
    `INSERT INTO service_offerings (id, uid, owner_user_id, title, category, summary, price_usd, price_cents, is_active)
     VALUES (?, ?, ?, ?, 'advisory', '', ?, ?, ?)`,
  );
  o.run(1, 'off-model', ME, 'Seed financial model build', 4500, 450000, 1);
  o.run(2, 'off-retired', ME, 'Retired line', null, null, 0);
  o.run(3, 'off-other', OTHER, 'Their line', null, null, 1);
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

const summary = async (db: DatabaseSync, who = ME) => call(db, 'GET', '/api/research/market-readings/summary', undefined, who);

test('99.50 – 99.99 and 4500.00 – 6000.00 leave as cents and two-decimal text and read back to the same cents', async () => {
  const db = world();
  const edit = await record(db, {
    metric: 'Investor-update edit · per update', scope: 'One investor update',
    range_low_cents: 9950, range_high_cents: 9999, comparable_count: 7, ran_at: ago(3),
  });
  const model = await record(db, {
    offering_uid: 'off-model', range_low_cents: 450000, range_high_cents: 600000, comparable_count: 12, ran_at: ago(75),
  });
  const res = await summary(db);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body.summary;
  assert.equal(s.basis, 'stored_readings');
  assert.equal(s.readings, 2);
  assert.deepEqual(s.lines.map((l: any) => l.uid), [edit, model], 'newest run first');

  const [a, b] = s.lines;
  assert.deepEqual(a.range, { status: 'recorded', low_cents: 9950, high_cents: 9999, low_usd: '99.50', high_usd: '99.99' });
  assert.equal(back(a.range.low_usd), 9950);
  assert.equal(back(a.range.high_usd), 9999);
  assert.equal(a.line, `Investor-update edit · per update (One investor update): $99.50 – $99.99, from 7 comparables, run ${ago(3)}`);
  assert.equal(a.age, 'current');
  assert.equal(a.age_days, 3);

  assert.deepEqual(b.range, { status: 'recorded', low_cents: 450000, high_cents: 600000, low_usd: '4500.00', high_usd: '6000.00' });
  assert.equal(back(b.range.low_usd), 450000);
  assert.equal(back(b.range.high_usd), 600000);
  assert.equal(b.line, `Seed financial model build: $4,500.00 – $6,000.00, from 12 comparables, run ${ago(75)}`);
  assert.deepEqual(b.catalog_price, { status: 'recorded', cents: 450000, usd: '4500.00' });
  assert.equal(b.age, 'ageing');

  assert.deepEqual(s.age, { current: 1, ageing: 1, stale: 0, undated: 0 });
  assert.equal(s.newest_ran_at, ago(3));
});

test('the lines are the card’s rows: an older run is stored but not a line, a retired line is not summarised, stale is counted', async () => {
  const db = world();
  await record(db, { offering_uid: 'off-model', range_low_cents: 100000, range_high_cents: 200000, comparable_count: 2, ran_at: ago(200) });
  const newest = await record(db, { offering_uid: 'off-model', range_low_cents: 450000, range_high_cents: 600000, comparable_count: 4, ran_at: ago(10) });
  await record(db, { offering_uid: 'off-retired', range_low_cents: 5000, range_high_cents: 6000, comparable_count: 3, ran_at: ago(1) });
  const stale = await record(db, { metric: 'Retainer · monthly', range_low_cents: 320000, range_high_cents: 480000, comparable_count: 5, ran_at: ago(138) });
  // A second run on the same day as `newest`: the later save is the newest, as on the list.
  const sameDay = await record(db, { offering_uid: 'off-model', range_low_cents: 450001, range_high_cents: 600001, comparable_count: 4, ran_at: ago(10) });

  const s = (await summary(db)).body.summary;
  assert.equal(s.readings, 5, 'every stored reading is counted');
  assert.deepEqual(s.lines.map((l: any) => l.uid), [sameDay, stale]);
  assert.ok(!s.lines.some((l: any) => l.uid === newest), 'an older run of a service line is not a line');
  assert.deepEqual(s.age, { current: 1, ageing: 0, stale: 1, undated: 0 });
  assert.equal(s.lines[1].age, 'stale');
  assert.equal(s.lines[1].range.low_usd, '3200.00');
  assert.equal(s.newest_ran_at, ago(10), 'the retired line’s newer run is not the newest on the card');

  // The card above lists the same newest run for the service line.
  const list = (await call(db, 'GET', '/api/research/market-readings')).body.items;
  assert.equal(list.find((r: any) => r.offering_uid === 'off-model').uid, sameDay);
});

test('only the caller’s own readings are summarised', async () => {
  const db = world();
  const mine = await record(db, { metric: 'Mine', range_low_cents: 9950, range_high_cents: 9999, comparable_count: 1, ran_at: ago(0) });
  await record(db, { metric: 'Theirs', range_low_cents: 1, range_high_cents: 2, comparable_count: 1, ran_at: ago(0) }, OTHER);
  await record(db, { offering_uid: 'off-other', range_low_cents: 3, range_high_cents: 4, comparable_count: 1, ran_at: ago(0) }, OTHER);
  const s = (await summary(db)).body.summary;
  assert.equal(s.readings, 1);
  assert.deepEqual(s.lines.map((l: any) => l.uid), [mine]);
  assert.equal(s.lines[0].line, `Mine: $99.50 – $99.99, from 1 comparable, run ${ago(0)}`);
  const theirs = (await summary(db, OTHER)).body.summary;
  assert.equal(theirs.readings, 2);
  assert.ok(!theirs.lines.some((l: any) => l.uid === mine));
});

test('an investor-only account is refused before anything is read (D6273 Q2)', async () => {
  const db = world();
  await record(db, { metric: 'Retainer', range_low_cents: 100, range_high_cents: 200, comparable_count: 2, ran_at: ago(1) });
  db.prepare('UPDATE research_market_readings SET owner_user_id = ?').run(INVESTOR);
  const res = await summary(db, INVESTOR);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'readings_hidden_for_investors');
  assert.equal(res.body.summary, undefined);
});

test('no readings is a zero count with no lines and no run date, never a made-up line', async () => {
  const db = world();
  const res = await summary(db);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.summary, {
    readings: 0, lines: [], age: { current: 0, ageing: 0, stale: 0, undated: 0 }, newest_ran_at: null, basis: 'stored_readings',
  });
});

test('readingsSummary: the page’s age bands, an undated row, and a backwards range left Not recorded', () => {
  assert.equal(AGE_AT, PAGE_AGE_AT, 'the Worker and the page age readings alike');
  assert.equal(STALE_AT, PAGE_STALE_AT);
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(readingAgeBand('2026-10-20', now), 'current');
  assert.equal(readingAgeBand('2026-10-19', now), 'ageing');
  assert.equal(readingAgeBand('2026-08-21', now), 'ageing');
  assert.equal(readingAgeBand('2026-08-20', now), 'stale');
  assert.equal(readingAgeBand('not a date', now), null);
  const row = {
    uid: 'u', offering_id: null, metric: 'M', scope: null, range_low_cents: 9999, range_high_cents: 9950,
    comparable_count: 2, ran_at: null, offering_uid: null, offering_active: null, price_cents: null, price_usd: null,
  };
  const s = readingsSummary([row], 1, now);
  assert.deepEqual(s.age, { current: 0, ageing: 0, stale: 0, undated: 1 });
  assert.equal(s.lines[0].range.status, 'not_recorded');
  assert.equal(s.lines[0].line, null);
  assert.equal(s.newest_ran_at, null);
  assert.equal(readingsSummary([row], 0, now).readings, 1, 'never fewer stored than summarised');
});

test('the handler is registered ahead of /:uid, calls no model and converts through the money layer only', () => {
  const src = readFileSync(new URL('../src/routes/research_client_prep.ts', import.meta.url), 'utf8');
  const at = src.indexOf("research.get('/market-readings/summary'");
  assert.ok(at > 0, 'the summary route is not registered');
  assert.ok(at < src.indexOf("research.get('/market-readings/:uid'"), 'registered after /:uid, which would answer it');
  const handler = src.slice(at, src.indexOf('\n});', at));
  assert.match(handler, /holdsOnlyLicence\(user, 'investor'\)/);
  assert.match(handler, /WHERE r\.owner_user_id = \?/);
  assert.doesNotMatch(handler, /env\.AI|runAi|callModel|anthropic|openai|\/ 100|Math\.round/i);
  const service = readFileSync(new URL('../src/services/marketReadingRead.ts', import.meta.url), 'utf8');
  const fn = service.slice(service.indexOf('export function readingsSummary'));
  assert.doesNotMatch(fn, /\/ 100|Math\.round|toFixed/);
});
