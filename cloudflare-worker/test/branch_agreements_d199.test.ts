/**
 * #308 / D199 — the Studio card's expiring agreements, read from THIS
 * database's own contract stores.
 *
 * WHAT THIS FILE PINS, AND WHY EACH ONE EXISTS
 *
 *  1. THE FORMAT BOUNDARY, both ways. `valid_until` and `expires_at` are
 *     written from JavaScript as ISO strings; SQLite's own stamps are
 *     `YYYY-MM-DD HH:MM:SS`. Compared bare, the two decide at position 10,
 *     where 'T' sorts above ' ' — so an agreement that ended THIS MORNING
 *     reads as still running, and one ending THIS EVENING can read as over.
 *     Only a same-day pair in each format can see either half, so the fixture
 *     is exactly that 2×2, against a fixed `now` rather than the wall clock
 *     (D177: a relative fixture is right for one hour a day by accident).
 *  2. THE WINDOW'S EDGES, and that it is the HANDLER'S `now`. A row dated
 *     relative to a `now` in 2020 must count, which it cannot if the query
 *     quietly reads SQLite's clock instead.
 *  3. UNREADABLE IS NOT ZERO. A missing source makes the total `null` with a
 *     reason naming it — never a smaller number that looks measured.
 *  4. THE UNDATED CLAIM IS TRUE. The payload says e-sign envelopes and signed
 *     documents record no end date. That sentence is asserted against the
 *     baseline's own DDL, so the day either table gains one, this fails and
 *     the count is widened rather than the sentence going stale.
 *
 * Tables are built from `schema_baseline.sql` itself — never hand-typed — so a
 * fixture narrower than production cannot pass a query production would fail.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_agreements_d199.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { branchHome, AGREEMENT_WINDOW_DAYS } from '../src/services/branchHome.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

function db(...tables: string[]) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of tables) d.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  return d;
}

/** Midday, so both same-day neighbours exist on the same UTC date. */
const NOW = Date.parse('2026-09-16T12:00:00Z');
const DAY = 86_400_000;
const sqlStamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const isoStamp = (ms: number) => new Date(ms).toISOString();

let ndaSeq = 0;
function nda(d: InstanceType<typeof DatabaseSync>, validUntil: string | null, status = 'active') {
  ndaSeq += 1;
  d.prepare(
    'INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status, valid_until) VALUES (?, ?, ?, ?)',
  ).run(ndaSeq, ndaSeq + 100_000, status, validUntil);
}
function deal(d: InstanceType<typeof DatabaseSync>, expiresAt: string | null, status = 'active') {
  d.prepare(
    "INSERT INTO partner_deals (deal_type, proposal_json, status, expires_at) VALUES ('services_partnership', '{}', ?, ?)",
  ).run(status, expiresAt);
}

async function agreementsOf(d: InstanceType<typeof DatabaseSync>, now = NOW) {
  const home = await branchHome({ DB: makeD1(d) } as any, now);
  return home.agreements;
}

test('the window is the one the card prints', () => {
  assert.equal(AGREEMENT_WINDOW_DAYS, 60);
});

test('a same-day end is decided by the instant, in either stored format', async () => {
  // THE 2×2. Six hours before `now` has ENDED; six hours after has NOT. Each in
  // the ISO shape the writers use and in SQLite's own shape.
  const d = db('pairwise_ndas', 'partner_deals');
  nda(d, isoStamp(NOW - 6 * 3_600_000));   // ended this morning — ISO
  nda(d, sqlStamp(NOW - 6 * 3_600_000));   // ended this morning — SQL
  nda(d, isoStamp(NOW + 6 * 3_600_000));   // ends this evening  — ISO
  nda(d, sqlStamp(NOW + 6 * 3_600_000));   // ends this evening  — SQL
  const a = await agreementsOf(d);
  assert.equal(a.by_source.pairwise_ndas, 2,
    'only the two that end LATER today are expiring; a bare comparison miscounts one side');
});

test('the same boundary holds for partner deals', async () => {
  const d = db('pairwise_ndas', 'partner_deals');
  deal(d, isoStamp(NOW - 6 * 3_600_000));
  deal(d, sqlStamp(NOW - 6 * 3_600_000));
  deal(d, isoStamp(NOW + 6 * 3_600_000));
  deal(d, sqlStamp(NOW + 6 * 3_600_000));
  const a = await agreementsOf(d);
  assert.equal(a.by_source.partner_deals, 2);
});

test('the window is (now, now + 60 days], inclusive at the far edge only', async () => {
  const d = db('pairwise_ndas', 'partner_deals');
  nda(d, sqlStamp(NOW + 30 * DAY));   // in
  nda(d, sqlStamp(NOW + 60 * DAY));   // in — the edge is inclusive
  nda(d, sqlStamp(NOW + 61 * DAY));   // out
  nda(d, sqlStamp(NOW + 90 * DAY));   // out
  nda(d, sqlStamp(NOW));              // out — ending exactly now is not "inside"
  const a = await agreementsOf(d);
  assert.equal(a.by_source.pairwise_ndas, 2);
});

test('only an ACTIVE agreement with a recorded end can be expiring', async () => {
  const d = db('pairwise_ndas', 'partner_deals');
  const inWindow = sqlStamp(NOW + 10 * DAY);
  for (const s of ['pending', 'partially_signed', 'expired', 'revoked']) nda(d, inWindow, s);
  nda(d, null);                        // active, but nothing says when it ends
  for (const s of ['proposed', 'awaiting_signature', 'terminated', 'expired']) deal(d, inWindow, s);
  deal(d, null);
  const a = await agreementsOf(d);
  assert.equal(a.expiring, 0);
  assert.deepEqual(a.by_source, { pairwise_ndas: 0, partner_deals: 0 });
});

test('the total is the two dated sources added, with no reason when both answered', async () => {
  const d = db('pairwise_ndas', 'partner_deals');
  nda(d, sqlStamp(NOW + 5 * DAY));
  nda(d, isoStamp(NOW + 40 * DAY));
  deal(d, sqlStamp(NOW + 20 * DAY));
  const a = await agreementsOf(d);
  assert.equal(a.expiring, 3);
  assert.equal(a.window_days, 60);
  assert.equal(a.reason, undefined);
});

test('a measured zero is a zero, not a missing answer', async () => {
  const a = await agreementsOf(db('pairwise_ndas', 'partner_deals'));
  assert.equal(a.expiring, 0);
  assert.equal(a.reason, undefined);
});

test('the window is measured from the handler\'s now, never SQLite\'s clock', async () => {
  // Six years in the past. By the wall clock this agreement ended long ago;
  // measured from the `now` the handler was given, it ends in 30 days.
  const then = Date.parse('2020-03-01T12:00:00Z');
  const d = db('pairwise_ndas', 'partner_deals');
  nda(d, sqlStamp(then + 30 * DAY));
  const a = await agreementsOf(d, then);
  assert.equal(a.expiring, 1, 'the query read a clock other than the one it was handed');
});

test('an unreadable source makes the total unknown, never smaller', async () => {
  // partner_deals is missing. The NDA count is still real and still reported,
  // but a total that left partner deals out would look measured and be wrong.
  const d = db('pairwise_ndas');
  nda(d, sqlStamp(NOW + 5 * DAY));
  const a = await agreementsOf(d);
  assert.equal(a.expiring, null, 'a partial total was returned as if it were the whole');
  assert.equal(a.by_source.pairwise_ndas, 1);
  assert.equal(a.by_source.partner_deals, null);
  assert.match(a.reason || '', /partner deals/, 'the reason must name what could not be read');
  assert.doesNotMatch(a.reason || '', /mutual NDAs/, 'the reason names a source that answered');

  const none = await agreementsOf(db());
  assert.equal(none.expiring, null);
  assert.match(none.reason || '', /mutual NDAs and partner deals/);
});

test('what is not counted is named on every answer, and the claim is true', async () => {
  const a = await agreementsOf(db('pairwise_ndas', 'partner_deals'));
  assert.deepEqual(a.undated.sources, ['esign_envelopes', 'documents']);
  assert.match(a.undated.reason, /signed, not when it ends/);

  // THE SENTENCE IS CHECKED AGAINST THE SCHEMA, not trusted. If either table
  // gains an end date, this fails, and the right response is to count it —
  // not to leave a sentence saying it cannot be counted.
  const END = /\b(expires?_(at|on)|valid_until|ends?_(at|on)|term_ends?_(at|on)|renews?_(at|on)|renewal_(at|on)|end_date)\b/i;
  for (const t of a.undated.sources) {
    const ddl = tableFromBaseline(BASELINE, t);
    assert.ok(ddl, `${t} is not in the baseline`);
    assert.doesNotMatch(ddl, END, `${t} now records an end date — count it instead of calling it undated`);
  }
  // And the two it DOES count really carry theirs.
  assert.match(tableFromBaseline(BASELINE, 'pairwise_ndas'), /\bvalid_until\b/);
  assert.match(tableFromBaseline(BASELINE, 'partner_deals'), /\bexpires_at\b/);
});
