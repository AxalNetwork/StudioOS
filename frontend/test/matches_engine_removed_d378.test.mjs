/**
 * D378 — the AI Matching Engine page (`/matches`) is deleted, and nothing
 * still points at it.
 *
 * The page, its card, its six `api.match*` methods, its route and every link
 * to it came out together. A route that stayed would render nothing; a link
 * that stayed would land on the not-found page; a method that stayed would
 * call an endpoint the worker no longer serves. Best-Fit's
 * `api.matches.summary()` is a different feature under the same prefix and
 * stays.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/matches_engine_removed_d378.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('the page, its card and its route are gone', () => {
  for (const f of ['frontend/src/pages/MatchesPage.jsx', 'frontend/src/components/ScoredDealCard.jsx']) {
    assert.ok(!existsSync(resolve(root, f)), `${f} is back`);
  }
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.doesNotMatch(app, /path="\/matches"/, '/matches is mounted again');
  assert.doesNotMatch(app, /MatchesPage/, 'App.jsx still imports the deleted page');
});

test('api.js calls no engine endpoint, and keeps Best-Fit\'s summary', () => {
  const api = codeOnly(read('frontend/src/lib/api.js'));
  const calls = [...api.matchAll(/['`]\/matches\/([^'`?$]*)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['summary'], `api.js calls /matches/${calls.join(', /matches/')}`);
  assert.doesNotMatch(api, /\bmatch(DealFlow|CoInvest|ReferralScores|Score|AdminAll|Investors)\s*:/,
    'an engine method is back on the api object');
});

test('no nav, launcher, persona or tab entry points at /matches', () => {
  for (const f of [
    'frontend/src/sidebarConfig.js',
    'frontend/src/lib/adminPlacement.js',
    'frontend/src/lib/personas.js',
    'frontend/src/lib/advisor/router.js',
    'frontend/src/pages/partner/PartnerWorkspaceTabs.jsx',
    'frontend/src/workspaces/investorZoneActions.js',
    'frontend/src/workspaces/founderZoneActions.js',
    'cloudflare-worker/src/personas.ts',
    'cloudflare-worker/src/services/advisor/tools.ts',
    'cloudflare-worker/src/services/onboardingChecklist.ts',
  ]) {
    assert.doesNotMatch(codeOnly(read(f)), /['"`]\/matches['"`?#]/, `${f} still points at /matches`);
  }
});

test('"Request an intro" is a stated gap on both desks, not a link', () => {
  for (const f of ['frontend/src/workspaces/investorZoneActions.js', 'frontend/src/workspaces/founderZoneActions.js']) {
    const line = codeOnly(read(f)).split('\n').find((l) => l.includes("label: 'Request an intro'"));
    assert.ok(line, `${f} lost the canvas label`);
    assert.match(line, /unbuilt: '/, `${f}'s Request an intro is not a stated gap`);
    assert.doesNotMatch(line, /\bto: /, `${f}'s Request an intro links somewhere`);
  }
});
