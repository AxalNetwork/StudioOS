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
// is `pageMonthLine`, pinned with the rest of the per-page states in
// `worker_rail_page_spend_d552.test.mjs`, the unattributed caveat included.

// ── The rail ────────────────────────────────────────────────────────────

test('the rail sends the page it sits on, in the shape the router stores', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /page: pagePath \|\| undefined,/, 'the read-back does not send its page');
  assert.match(src, /const pagePath = String\(pathname \|\| ''\)\.replace\(\/\\\/\+\$\/, ''\)/,
    'the page is not normalised the way normaliseSurface stores it');
  assert.match(src, /\}, \[workspace, stance, coverage, activeModel, scopeBranch, reload, pagePath\]\);/,
    'readBack closes over a stale page');
  const api = codeOnly(read('frontend/src/lib/api.js'));
  const method = api.slice(api.indexOf('aiWorkspaceExplain:'), api.indexOf('aiWorkspaceExplain:') + 400);
  assert.match(method, /JSON\.stringify\(\{[^}]*\bpage\b[^}]*\}\)/, 'the api method drops the page');
});

test('the rail splits the month by page from by_surface, and a failed grouping is Unreadable', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /spend\.by_surface_recorded === false\s*\?\s*\(\s*<div[^>]*>\s*<Unreadable[\s\S]{0,200}?onRetry=\{onRetry\}/,
    'a failed per-page read is not Unreadable with a retry');
  assert.match(src, /splitByPage\(spend\.by_surface, pagePath\)/);
});
