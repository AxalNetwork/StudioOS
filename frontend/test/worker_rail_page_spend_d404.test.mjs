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
import { pageSpendLine } from '../src/ui/assistCost.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

const BY = [
  { surface: '/validate/interviews', calls: 2, spend_usd: 0.004 },
  { surface: '/build/board', calls: 1, spend_usd: 0.002 },
  { surface: null, calls: 3, spend_usd: 0.01 },
];

// ── The line ────────────────────────────────────────────────────────────

test('a page with runs reads its own spend and run count', () => {
  assert.equal(pageSpendLine(BY, '/validate/interviews'), 'This page this month: $0.0040 over 2 runs.');
  assert.equal(pageSpendLine(BY, '/build/board'), 'This page this month: $0.0020 over 1 run.');
});

test('a page with none says so, and names the month\'s runs that carry no page', () => {
  // Those may include this page's own runs from before migration 319, so
  // "nothing from this page" alone would be a claim the log cannot make.
  const line = pageSpendLine(BY, '/grow/focus');
  assert.match(line, /^No runs recorded from this page this month\. 3 runs this month carry no page/);
  assert.doesNotMatch(line, /\$0\.0000/);
});

test('with no unattributed runs, "no runs" is the whole answer', () => {
  assert.equal(pageSpendLine(BY.slice(0, 2), '/grow/focus'), 'No runs from this page this month.');
  assert.equal(pageSpendLine([], '/grow/focus'), 'No runs from this page this month.');
});

test('the unattributed entry is never read as a page, and an empty path matches nothing', () => {
  assert.doesNotMatch(pageSpendLine(BY, ''), /This page this month:/);
  assert.doesNotMatch(pageSpendLine(BY, null), /This page this month:/);
});

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

test('the rail draws this page\'s spend from by_surface, and a failed read as Unreadable', () => {
  const src = codeOnly(read(RAIL));
  assert.match(src, /spend\.by_surface_recorded === false\s*\?\s*\(\s*<div[^>]*>\s*<Unreadable[\s\S]{0,200}?onRetry=\{reload\}/,
    'a failed per-page read is not Unreadable with a retry');
  assert.match(src, /pageSpendLine\(spend\.by_surface, pagePath\)/);
});
