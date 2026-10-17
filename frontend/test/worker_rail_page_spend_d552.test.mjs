/**
 * D552 step 3 — one page's month and last run, read from
 * `/api/ai/me/spend?surface=<page>`.
 *
 * The Worker half is pinned on real SQLite in
 * `cloudflare-worker/test/ai_surface_d552.test.ts`. `useAiSpend({ page })`
 * makes that read. The rail drew it until D698 (#1660) moved the page's month
 * and its receipts to `/account/usage`; what stays pinned here is the read:
 * the path pattern, the client method and the hook.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_page_spend_d552.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { RECORDABLE_PAGE_RE, isRecordablePage } from '../src/ui/assistCost.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = '/research/funds/catalog/fund-42';

// ── The read ────────────────────────────────────────────────────────────

test('the recordable-path pattern is the router\'s SURFACE_RE, character for character', () => {
  const router = read('cloudflare-worker/src/services/aiRouter.ts');
  const m = router.match(/export const SURFACE_RE = (\/.+\/);/);
  assert.ok(m, 'SURFACE_RE not found in aiRouter.ts');
  assert.equal(String(RECORDABLE_PAGE_RE), m[1]);
  assert.equal(isRecordablePage(PAGE), true);
  assert.equal(isRecordablePage('/'), true);
  for (const bad of ['', null, undefined, 'research', '/a b', `/${'x'.repeat(160)}`]) assert.equal(isRecordablePage(bad), false, String(bad));
});

test('api.myAiSpend sends the page as ?surface=, encoded, and nothing without one', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.myAiSpend();
    await api.myAiSpend(PAGE);
    // An empty page is a caller's mistake: it reaches the route and is
    // refused, rather than silently answering for the whole account.
    await api.myAiSpend('');
  } finally { globalThis.fetch = realFetch; }
  assert.match(calls[2], /\/ai\/me\/spend\?surface=$/);
  assert.match(calls[0], /\/ai\/me\/spend$/);
  assert.match(calls[1], /\/ai\/me\/spend\?surface=%2Fresearch%2Ffunds%2Fcatalog%2Ffund-42$/);
});

test('the hook reads the page only for a recordable path, keeps its error apart, and re-reads on a new page', () => {
  const src = codeOnly(read('frontend/src/hooks/useAiSpend.js'));
  assert.match(src, /const pageKey = isRecordablePage\(page\) \? page : null;/);
  assert.match(src, /pageKey \? api\.myAiSpend\(pageKey\)\.catch\(\(e\) => \(\{ __err: e \}\)\) : null,/);
  assert.match(src, /else if \(ps && !ps\.__err\) \{ setPageSpend\(ps\); setPageSpendError\(null\); \}\s*else \{ setPageSpend\(null\); setPageSpendError\(/,
    'a failed page read is dropped rather than recorded');
  assert.match(src, /\}, \[enabled, attempt, pageKey\]\);/, 'moving to another page keeps the last page\'s figures');
  assert.match(src, /return \{[^}]*\bpageSpend\b[^}]*\bpageSpendError\b[^}]*\}/);
});

test('the page\'s month and last run left the rail (D698); the hook keeps its page read', () => {
  // D698 decision 9: the Eadwyn AI rail draws the allowance ledger, and
  // `/account/usage` keeps this page's month and its receipts. The rail calls
  // `useAiSpend()` without a page, so no `?surface=` read is sent from it.
  const src = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.doesNotMatch(src, /useAiSpend\(\{ page/);
  assert.doesNotMatch(src, /RailPageUsage|This page this month|pagePath/);
});
