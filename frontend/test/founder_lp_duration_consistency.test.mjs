/**
 * The Spin-Out Lab's length, one number everywhere: 28 days, the Worker's
 * `SPRINT_DAYS` in cloudflare-worker/src/routes/spinout_lab.ts and the Lab's
 * 4-week milestone catalog (spinoutLabCatalog.ts).
 *
 * This test once pinned `/lp/founder` (FounderHomePage.jsx), a campaign page
 * that said "28 days" in its hero and "30 days" three times further down.
 * #2297 removed the `/lp/*` pages, FounderHomePage among them; what remains is
 * the public LandingPage agreeing with the Worker, so a future edit to one and
 * not the other fails loudly.
 *
 * Run with:  node --test frontend/test/founder_lp_duration_consistency.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const LANDING = read('../src/pages/LandingPage.jsx');
const WORKER = read('../../cloudflare-worker/src/routes/spinout_lab.ts');

test('the worker still defines a 28-day sprint — the number this test pins', () => {
  // If this ever changes, every "28" below needs to change with it, not just
  // this one line.
  assert.match(WORKER, /const SPRINT_DAYS = 28;/);
});

test('the public LandingPage says 28 days, as the Worker does', () => {
  assert.match(LANDING, /28-day/);
  assert.doesNotMatch(LANDING, /\b30[\s-]days?\b/i);
});
