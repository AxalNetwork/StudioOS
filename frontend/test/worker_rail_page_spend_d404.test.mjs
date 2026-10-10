/**
 * D404 — "This page this month": the rail's per-page spend.
 *
 * Migration 319 gives `ai_usage_logs` a nullable `surface` (the app path a
 * run was asked from), the router records it, `/api/ai/me/spend` returns a
 * `by_surface` breakdown, and the rail draws this page's share of it. The
 * Worker half is pinned on real SQLite in `cloudflare-worker/test/
 * ai_spend_self.test.ts` and through the route in `ai_workspace_explain.test.ts`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_page_spend_d404.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

// The line this file used to pin, `pageSpendLine` over `by_surface`, is gone:
// D552 step 3 reads the page's month directly (`?surface=`) and its sentence
// is drawn by `RailPageUsage`, pinned with the rest of the per-page states in
// `worker_rail_page_spend_d552.test.mjs`, the unattributed caveat included.

// ── The rail ────────────────────────────────────────────────────────────

test('the rail reads the page it sits on, in the shape the router stores', () => {
  // The rail no longer runs a model (owner, 2026-10-10), so it sends no page;
  // it still READS this page's spend, keyed the way normaliseSurface stores it.
  const src = codeOnly(read(RAIL));
  assert.match(src, /const pagePath = String\(pathname \|\| ''\)\.replace\(\/\\\/\+\$\/, ''\)/,
    'the page is not normalised the way normaliseSurface stores it');
  assert.match(src, /useAiSpend\(\{ page: pagePath \}\)/, 'the rail does not read this page\'s spend');
  // The read-back route keeps the page for any caller.
  const api = codeOnly(read('frontend/src/lib/api.js'));
  const method = api.slice(api.indexOf('aiWorkspaceExplain:'), api.indexOf('aiWorkspaceExplain:') + 400);
  assert.match(method, /JSON\.stringify\(\{[^}]*\bpage\b[^}]*\}\)/, 'the api method drops the page');
});

test('the rail draws no spend-by-page list: the AIRail canvas has none', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /list-worker-rail-by-page|splitByPage/, 'the by-page list is drawn again');
});
