/**
 * The Spin-Out Lab home page for a founder who has ALREADY applied.
 *
 * `GET /spinout-lab/state` has always returned the founder's latest
 * `spinout_applications` row (`latestApplication`, spinout_lab.ts) and this
 * page has always dropped it on the floor. A founder who applied on Tuesday
 * came back on Thursday to the identical marketing page and the identical
 * "Apply Now" button, with nothing anywhere confirming their application had
 * been received.
 *
 * Pressing that button is not a harmless no-op: `POST /spinout-lab/apply`
 * guards on `WHERE NOT EXISTS (… status = 'pending')` and 409s "You already
 * have an application in review", so the only feedback the product offered a
 * waiting founder was an error message.
 *
 * The asymmetry between the two states is load-bearing and is what most of
 * this file pins:
 *   • pending  → status REPLACES the apply CTA (re-applying is what 409s)
 *   • refused  → status sits ABOVE a still-live CTA, because the insert only
 *                blocks a second *pending* row, so re-applying genuinely works
 *
 * `parseSqliteUtc` is React-free and imported for real. The rendering paths
 * are asserted at source level — the frontend has no React test runner, the
 * same constraint the other frontend/test/*.mjs suites work under.
 *
 * Run with:  node --test frontend/test/spinout_application_status.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(
  fileURLToPath(new URL('../src/pages/SpinoutLabPage.jsx', import.meta.url)),
  'utf8',
);

// ---------------------------------------------------------------------------
// parseSqliteUtc — the real function, not a source assertion.
//
// SQLite hands us "2026-08-06 10:30:00": no `T`, no `Z`, and therefore not a
// valid ISO-8601 date-time. `new Date()` behaviour on it is
// implementation-defined — V8 reads it as LOCAL time, Safari returns Invalid
// Date — so every timestamp this page renders was either offset by the
// viewer's timezone or blank, depending on the browser.
// ---------------------------------------------------------------------------

// Extracted rather than imported: the module imports React and react-router,
// which this bare node:test runner has no loader for. The function is copied
// by evaluating the real source text, so it cannot drift from the page.
const parseSqliteUtc = (() => {
  const src = PAGE.slice(PAGE.indexOf('export function parseSqliteUtc'));
  const body = src.slice(0, src.indexOf('\n}\n') + 3).replace(/^export /, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return parseSqliteUtc;`)();
})();

test('a bare SQLite timestamp is read as UTC, not as local time', () => {
  const d = parseSqliteUtc('2026-08-06 10:30:00');
  assert.ok(d instanceof Date);
  // The whole point: this must be 10:30 UTC regardless of the runner's zone.
  assert.equal(d.toISOString(), '2026-08-06T10:30:00.000Z');
});

test('an already-zoned timestamp is left alone rather than double-suffixed', () => {
  assert.equal(parseSqliteUtc('2026-08-06T10:30:00Z').toISOString(), '2026-08-06T10:30:00.000Z');
  // A real offset must survive — appending Z here would shift it by 5 hours.
  assert.equal(parseSqliteUtc('2026-08-06T10:30:00-05:00').toISOString(), '2026-08-06T15:30:00.000Z');
  assert.equal(parseSqliteUtc('2026-08-06T10:30:00+0200').toISOString(), '2026-08-06T08:30:00.000Z');
});

test('unusable input returns null, never an Invalid Date', () => {
  // Callers branch on the null to omit the sentence entirely; an Invalid Date
  // would reach toLocaleDateString and print the literal "Invalid Date".
  for (const bad of [null, undefined, '', 'not a date', {}, NaN]) {
    assert.equal(parseSqliteUtc(bad), null, `expected null for ${String(bad)}`);
  }
});

test('decided_at being null (an undecided application) parses to null', () => {
  assert.equal(parseSqliteUtc(null), null);
});

// ---------------------------------------------------------------------------
// The page no longer carries three different parsers for one format.
// ---------------------------------------------------------------------------

test('every timestamp on the page goes through the one parser', () => {
  // Two callers used `new Date(s.replace(' ', 'T'))` with no `Z` — the
  // local-time misreading above. Neither may come back.
  const naive = PAGE.match(/new Date\(String\([^)]*\)\.replace\(' ', 'T'\)\)/g) || [];
  assert.deepEqual(naive, [], 'a raw SQLite parse bypassing parseSqliteUtc reappeared');
});

// ---------------------------------------------------------------------------
// Pending vs refused — the asymmetry.
// ---------------------------------------------------------------------------

test('a pending application replaces the apply CTA', () => {
  assert.match(
    PAGE,
    /status \|\| ''\)\.toLowerCase\(\) === 'pending'\s*\?\s*null\s*:\s*<ApplyCtaSection/,
    'a pending founder must not be shown a button that 409s',
  );
});

test('a refused application still gets the apply CTA', () => {
  // The component renders for both statuses, but only pending suppresses the
  // CTA — so refused necessarily falls through to it.
  const gate = PAGE.slice(PAGE.indexOf('<ApplicationStatusSection'));
  assert.match(gate.slice(0, 400), /<ApplyCtaSection/, 'refused founders may re-apply');
  assert.match(
    PAGE,
    /if \(status !== 'pending' && status !== 'refused'\) return null/,
    'only these two statuses render — accepted founders are on the workspace path',
  );
});

test('the status section reads the application off state, not a second fetch', () => {
  assert.match(PAGE, /<ApplicationStatusSection application=\{state\?\.application\}/);
});

test('an investor never sees a cohort application status', () => {
  // POST /spinout-lab/apply hard-403s investors; the LP route is the fund.
  assert.match(
    PAGE,
    /investorView \? <LpCtaSection \/> : \(/,
    'the investor branch must short-circuit before the founder application UI',
  );
});

// ---------------------------------------------------------------------------
// Content contract — what a waiting founder is actually told.
// ---------------------------------------------------------------------------

test('a pending founder is told not to re-apply', () => {
  assert.match(PAGE, /you’ll get an email either way — you don’t need to apply again/);
});

test('a refused founder is given the capacity reason, not a bare rejection', () => {
  assert.match(PAGE, /capped at 8 companies/);
});

test('the status block is addressable for e2e and analytics', () => {
  assert.match(PAGE, /data-testid="application-status"/);
  assert.match(PAGE, /data-status=\{status\}/);
});

test('missing optional fields degrade instead of rendering "undefined"', () => {
  // company_name, created_at, decided_at and cohort are each independently
  // nullable on the row — every one is behind its own guard.
  assert.match(PAGE, /application\.company_name \?/, 'company name guarded');
  assert.match(PAGE, /submitted \?/, 'submitted date guarded');
  assert.match(PAGE, /decided \?/, 'decided date guarded');
  assert.match(PAGE, /application\.cohort \?/, 'cohort guarded');
});
