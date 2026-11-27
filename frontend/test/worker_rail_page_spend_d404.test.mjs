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
// D552 step 3 read the page's month directly (`?surface=`), and D698 took
// the page's month off the rail; `/account/usage` draws spend by page.

// ── The rail ────────────────────────────────────────────────────────────

test('the rail reads no page spend (D698); the read-back route keeps the page', () => {
  // D698: "This page this month" and its last run left the rail for
  // `/account/usage`, and so did the `?surface=` read behind them. The rail
  // calls the hook without a page.
  const src = codeOnly(read(RAIL));
  assert.match(src, /= useAiSpend\(\);/, 'the rail reads a page spend again');
  assert.doesNotMatch(src, /useAiSpend\(\{ page/, 'the rail reads a page spend again');
  // The read-back route keeps the page for any caller.
  const api = codeOnly(read('frontend/src/lib/api.js'));
  const method = api.slice(api.indexOf('aiWorkspaceExplain:'), api.indexOf('aiWorkspaceExplain:') + 400);
  assert.match(method, /JSON\.stringify\(\{[^}]*\bpage\b[^}]*\}\)/, 'the api method drops the page');
});

test('the rail draws no spend-by-page list: the AIRail canvas has none', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /list-worker-rail-by-page|splitByPage/, 'the by-page list is drawn again');
});
