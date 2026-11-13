/**
 * D378 — the AI Matching Engine is gone from the worker, and Best-Fit's
 * summary is not.
 *
 * `routes/matches.ts` served the engine (`/deal-flow`, `/co-invest`,
 * `/referral-scores`, `/score`, `/investor-match`, `/admin/all`) and, under the
 * same prefix, Best-Fit's `/summary`, which the profile's Fit section reads.
 * Only the summary may remain. The engine's institutional-tier gate on
 * `/api/matches/co-invest` went with it, and so did the two investor
 * checklist steps that sent people to `/matches`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/matches_engine_removed_d378.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matches from '../src/routes/matches.ts';
import { CATALOG } from '../src/services/onboardingChecklist.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, '..', rel), 'utf8');

test('the matches router serves Best-Fit\'s summary and nothing else', () => {
  const served = matches.routes.map((r: any) => `${r.method} ${r.path}`);
  assert.deepEqual(served, ['GET /summary'],
    `the engine is back under /api/matches: ${served.join(', ')}`);
});

test('the router is still mounted, and the engine\'s tier gate is not', () => {
  const index = read('src/index.ts');
  assert.match(index, /app\.route\('\/api\/matches', matches\)/,
    'Best-Fit\'s summary lost its mount');
  assert.doesNotMatch(index, /\/api\/matches\/co-invest/,
    'a tier gate guards an endpoint that no longer exists');
});

test('no onboarding step sends anyone to /matches', () => {
  const steps = Object.values(CATALOG).flat();
  const toMatches = steps.filter((s) => s.route === '/matches').map((s) => s.key);
  assert.deepEqual(toMatches, [], `these steps open a route that was deleted: ${toMatches.join(', ')}`);
  const investor = CATALOG.investor.map((s) => s.key);
  assert.ok(!investor.includes('inv.review'), 'inv.review counts deal-flow scores nothing writes');
  assert.ok(!investor.includes('inv.intro'), 'inv.intro asks for an intro no screen can request');
});
