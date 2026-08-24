/**
 * `/lp/founder` (FounderHomePage.jsx) is a real, routed page — App.jsx:207,
 * App.jsx:1844 — built for external campaign traffic rather than site nav
 * (there is no in-app link to it, deliberately — see api.js's comment on the
 * `/lp/*` family). It is NOT a stub or an orphan; it is simply unlinked.
 *
 * It WAS, however, internally inconsistent about its own core claim. The hero
 * metric, the timeline, and one FAQ answer correctly said "28 days / four
 * weeks" — matching `SPRINT_DAYS = 28` in
 * cloudflare-worker/src/routes/spinout_lab.ts and the Spin-Out Lab's actual
 * 4-week milestone catalog (spinoutLabCatalog.ts). Three OTHER spots on the
 * exact same page said "30 days" instead: the metrics-strip number shown
 * directly under the "28 days" hero line, the flagship pillar description,
 * and the FAQ question itself. A founder reading top to bottom would hit both
 * numbers before reaching the pricing page.
 *
 * This pins two things: the page no longer contradicts itself, and it says
 * the same number the rest of the public site (LandingPage.jsx) and the
 * worker's SPRINT_DAYS already agree on — so a future edit to one and not the
 * other fails loudly instead of silently reintroducing the split.
 *
 * Run with:  node --test frontend/test/founder_lp_duration_consistency.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const LP_PAGE = read('../src/pages/templates/FounderHomePage.jsx');
const LANDING = read('../src/pages/LandingPage.jsx');
const WORKER = read('../../cloudflare-worker/src/routes/spinout_lab.ts');

test('the worker still defines a 28-day sprint — the number this test pins', () => {
  // If this ever changes, every "28" below needs to change with it, not just
  // this one line.
  assert.match(WORKER, /const SPRINT_DAYS = 28;/);
});

test('/lp/founder no longer contradicts itself on program length', () => {
  assert.doesNotMatch(LP_PAGE, /30[\s-]days?\b/i, 'a stray "30 day(s)" would reintroduce the split');
  assert.doesNotMatch(LP_PAGE, /\b30\b[^0-9]{0,12}day/i);
});

test('/lp/founder states 28 days in the three places that matter', () => {
  // Hero metrics strip — the number shown directly under the hero headline.
  assert.match(LP_PAGE, /\{\s*value:\s*28\s*,\s*label:\s*'Days Average'\s*\}/);
  // The flagship "Spin-Out Lab" pillar description.
  assert.match(LP_PAGE, /28-day structured sprint/);
  // The FAQ question a skimming founder actually reads.
  assert.match(LP_PAGE, /What happens after 28 days\?/);
});

test('the public LandingPage and the /lp/founder campaign page agree', () => {
  // Both are founder-facing entry points; they must not quote different
  // sprint lengths to two different audiences.
  assert.match(LANDING, /28-day/);
  assert.match(LP_PAGE, /28-day/);
});
