/**
 * D5028 — Revenue tells the operator what D4855 built: a configured ceiling is enforced at checkout, atomically.
 * It keeps five facts apart per ceiling and never derives a remaining from an issued figure HQ does not have.
 *
 * Mutations checked: the stale sentence put back ("Nothing at checkout checks a code against it yet"); pushed taken
 * from `pushed_at` alone (an old push counted for a re-saved figure); enforced shown for a ceiling of another quarter;
 * remaining shown without an issued figure; the "no ceiling allows discounts" line removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CEILING_ENFORCEMENT, CeilingEditor, ceilingFacts } from '../src/pages/hq/RevenuePage.jsx';
import { codeOnly } from './_codeOnly.mjs';
import { revenuePageSource } from './_revenuePage.mjs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const PAGE = codeOnly(revenuePageSource());
const NOW = '2026-Q4';
const row = (o = {}) => ({
  licence_uid: 'lic_fr', period: NOW, ceiling_cents: 500000, currency: 'EUR', issued_cents: null, issued_available: false,
  remaining_cents: null, issued_reported_at: null, pushed_at: null, updated_at: '2026-11-08T10:00:00.000Z', ...o,
});

test('the stale claim is gone from the page, in code and in copy', () => {
  const stale = [
    /Nothing at checkout (checks|enforces)/i, /checks a code against it yet/i, /issue past its ceiling and no payment is refused/i,
    /no payment is refused because of it/i, /CEILING_NOT_ENFORCED/, /ceiling-not-enforced/,
  ];
  for (const re of stale) assert.doesNotMatch(PAGE, re, String(re));
  for (const line of CEILING_ENFORCEMENT) for (const re of stale) assert.doesNotMatch(line, re);
  const html = renderToStaticMarkup(React.createElement(CeilingEditor, { currentPeriod: NOW, onSave: async () => ({}), licences: [] }));
  for (const re of stale) assert.doesNotMatch(html, re);
});

test('the copy states the D4855 contract, point by point', () => {
  const all = CEILING_ENFORCEMENT.join('\n');
  assert.match(all, /enforced at checkout, atomically/);
  assert.match(all, /refuses a discount above what is left/);
  assert.match(all, /two checkouts cannot both take the last of it/);
  assert.match(all, /no ceiling for the current quarter, discounts are allowed until HQ sets one/, 'option B for no ceiling recorded');
  assert.match(all, /neither 0 nor unlimited/);
  assert.match(all, /ceiling it cannot read, the discount is refused/, 'an unreadable configured ceiling refuses');
  assert.match(all, /two facts, and the push can fail on its own/, 'saved and pushed stay separate');
  assert.match(all, /does not receive that figure automatically/, 'HQ depends on branch reporting');
  assert.match(all, /Not recorded until it does/);
});

test('saved, pushed, enforced, issued and remaining are five separate facts', () => {
  // Saved but never pushed: the branch has nothing, so it enforces nothing and allows discounts.
  const unpushed = ceilingFacts(row(), NOW);
  assert.equal(unpushed.saved.yes, true);
  assert.equal(unpushed.pushed.yes, false);
  assert.equal(unpushed.pushed.label, 'Not pushed to the branch');
  assert.equal(unpushed.enforced.state, 'not_checked');
  assert.match(unpushed.enforced.label, /needs a branch checkout read-back/);

  // Pushed with the latest save: enforced.
  const pushed = ceilingFacts(row({ pushed_at: '2026-11-08T10:00:00.000Z' }), NOW);
  assert.equal(pushed.pushed.yes, true);
  assert.equal(pushed.pushed.label, 'Push accepted 2026-11-08');
  assert.equal(pushed.enforced.state, 'not_checked');

  // Saved again, push failed: the branch holds the EARLIER figure, and HQ says so rather than "pushed".
  const stale = ceilingFacts(row({ pushed_at: '2026-11-01T09:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z' }), NOW);
  assert.equal(stale.pushed.yes, false);
  assert.equal(stale.pushed.label, 'The latest figure was not pushed');
  assert.equal(stale.enforced.state, 'not_checked');
  assert.match(stale.enforced.label, /push acceptance is a separate fact/);

  // A ceiling for another quarter governs no checkout now, pushed or not.
  for (const pushed_at of [null, '2026-11-08T10:00:00.000Z']) {
    const old = ceilingFacts(row({ period: '2026-Q3', pushed_at }), NOW);
    assert.equal(old.enforced.state, 'other_period');
    assert.match(old.enforced.label, /read-back covers current checkout only/);
  }
  assert.equal(ceilingFacts(row(), undefined).enforced.state, 'other_period', 'an unknown current quarter is not assumed');
});

test('no issued figure means Not reported and no remaining; a reported one gives both', () => {
  for (const issued of [{ issued_cents: null, issued_available: false }, { issued_cents: 0, issued_available: false }, { issued_cents: undefined }, { issued_cents: 'x', issued_available: true }]) {
    const f = ceilingFacts(row({ ...issued, remaining_cents: 500000 }), NOW);
    assert.equal(f.issued.known, false, JSON.stringify(issued));
    assert.equal(f.issued.label, 'Not reported to HQ');
    assert.equal(f.remaining.known, false, 'a remaining is never shown when no issued figure was reported, even if one is supplied');
    assert.match(f.remaining.label, /no issued figure was reported/);
  }
  const zero = ceilingFacts(row({ issued_cents: 0, issued_available: true, remaining_cents: 500000, issued_reported_at: '2026-11-07T00:00:00Z' }), NOW);
  assert.equal(zero.issued.known, true, 'a reported zero is a figure, unlike an absent one');
  assert.equal(zero.issued.label, 'Reported 2026-11-07');
  assert.equal(zero.remaining.known, true);
  const some = ceilingFacts(row({ issued_cents: 120000, issued_available: true, remaining_cents: 380000 }), NOW);
  assert.equal(some.remaining.known, true);
  assert.equal(ceilingFacts(row({ issued_cents: 120000, issued_available: true, remaining_cents: null }), NOW).remaining.known, false);
});

test('the list shows these facts and works no remaining out of the ceiling itself', () => {
  assert.match(PAGE, /const facts = ceilingFacts\(x, ceilings\?\.current_period\);/);
  assert.match(PAGE, /facts\.pushed\.label/);
  assert.match(PAGE, /facts\.enforced\.label/);
  assert.match(PAGE, /facts\.issued\.known \?/);
  // D5039: the absent figures are drawn with the cockpit's value states (a word and a shape), not the bare italic.
  assert.match(PAGE, /facts\.remaining\.known \? money\(x\.remaining_cents, x\.currency\) : <StateMark state="not_recorded" \/>/);
  assert.doesNotMatch(PAGE, /ceiling_cents\s*-\s*[\w.]*issued/, 'a remaining must come from the worker, only when an issued figure exists');
  assert.doesNotMatch(PAGE, /issued_cents\s*\?\?\s*0|issued_cents\s*\|\|\s*0/, 'an absent issued figure is never coerced to zero');
});
