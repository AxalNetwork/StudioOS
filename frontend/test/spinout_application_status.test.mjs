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
 * `parseSqliteUtc` is React-free and evaluated from its source. Since D384 the
 * status card is RENDERED (react-dom/server) from the same `applicant` shape
 * `/state` returns; the page's gate around it is still read at source level.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_application_status.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { ApplicationStatusCard } from '../src/components/spinout/ApplicationStatus.jsx';
import { applicantFromLegacy } from '../src/lib/applicationLifecycle.js';

const PAGE = readFileSync(
  fileURLToPath(new URL('../src/pages/SpinoutLabPage.jsx', import.meta.url)),
  'utf8',
);
// parseSqliteUtc moved OUT of the page and into lib/spinoutLab.js when the Lab
// intro was rebuilt: both surfaces of /spinout-lab now render one shared
// component, and it could not reach back up into a page without closing an
// import cycle. Same function, same extraction technique, new home — the
// assertions below are unchanged.
const LIB = readFileSync(
  fileURLToPath(new URL('../src/lib/spinoutLab.js', import.meta.url)),
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
  const src = LIB.slice(LIB.indexOf('export function parseSqliteUtc'));
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
  // Both files now, since the parser and its callers live either side of the
  // page/lib line: checking only one of them would let the bypass return in
  // the other.
  const re = /new Date\(String\([^)]*\)\.replace\(' ', 'T'\)\)/g;
  assert.deepEqual(PAGE.match(re) || [], [], 'a raw SQLite parse bypassing parseSqliteUtc reappeared in the page');
  assert.deepEqual(LIB.match(re) || [], [], 'a raw SQLite parse bypassing parseSqliteUtc reappeared in lib/spinoutLab.js');
});

/** The card as `/spinout-lab` renders it, from a legacy row plus any D383 fields. */
const card = (application, company = null, extra = {}) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(ApplicationStatusCard, {
    applicant: { ...applicantFromLegacy(application), ...extra }, company,
  })),
);

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
  // The card renders for pending and refused, but only pending suppresses the
  // CTA — so refused necessarily falls through to it.
  const gate = PAGE.slice(PAGE.indexOf('<ApplicationStatusCard'));
  assert.match(gate.slice(0, 600), /<ApplyCtaSection/, 'refused founders may re-apply');
  assert.equal(card({ status: 'accepted' }), '', 'an accepted founder is on the workspace path, not shown a status card');
  assert.equal(card({ status: 'withdrawn' }), '', 'a withdrawn application is not shown as in review');
  assert.match(card({ status: 'refused', decided_at: '2026-08-06 10:30:00' }), /data-status="refused"/);
});
test('the status card reads the applicant off state, not a second fetch', () => {
  // D384: the card and the full screen on /spinout-lab/apply read the same
  // `applicant` block, falling back to the legacy row before migration 315.
  assert.match(PAGE, /<ApplicationStatusCard\s+applicant=\{state\?\.applicant \?\? applicantFromLegacy\(state\?\.application\)\}/);
  assert.doesNotMatch(PAGE, /function ApplicationStatusSection/, 'the retired status block came back beside the card');
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

test('a pending founder is told not to re-apply, and where to see the application', () => {
  const html = card({ status: 'pending', created_at: '2026-08-06 10:30:00' }, 'Northwind');
  const text = renderedText(html);
  assert.match(text, /You don’t need to apply again/);
  assert.match(text, /for Northwind/);
  assert.match(html, /href="\/spinout-lab\/apply"/);
});
test('a refused founder is pointed at the note written for them, never an internal reason', () => {
  // The generic capacity sentence is retired (D384): the decline now carries
  // the note an admin writes for the applicant, printed on the full screen.
  const withNote = renderedText(card({ status: 'refused' }, null, { note: { text: 'x', asks: [], at: null } }));
  assert.match(withNote, /The team wrote you a note/);
  const without = renderedText(card({ status: 'refused' }));
  assert.doesNotMatch(without, /wrote you a note/);
  assert.doesNotMatch(PAGE, /capped at \d/);
});
test('the status block is addressable for e2e and analytics', () => {
  assert.match(card({ status: 'pending' }), /data-testid="application-status"/);
  assert.match(card({ status: 'pending' }), /data-status="pending"/);
});
test('missing optional fields degrade instead of rendering "undefined"', () => {
  const text = renderedText(card({ status: 'pending', company_name: null, created_at: null, cohort: null }));
  assert.doesNotMatch(text, /undefined|null|Invalid Date/);
  assert.doesNotMatch(text, / for \./, 'an absent company name left a dangling "for"');
});