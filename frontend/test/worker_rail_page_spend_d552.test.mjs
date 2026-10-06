/**
 * D552 step 3 — the rail shows THIS page's month and last run, and the month
 * split by page.
 *
 * `/api/ai/me/spend?surface=<page>` (the Worker half, pinned on real SQLite in
 * `cloudflare-worker/test/ai_surface_d552.test.ts`) answers one page's month
 * and last run from the caller's own rows. `useAiSpend({ page })` makes that
 * read, and `RailPageUsage` draws it beside the account's `by_surface` split.
 * Each honest state is rendered here, not matched in source.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_page_spend_d552.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { RailPageUsage } from '../src/ui/WorkerRail.jsx';
import { RECORDABLE_PAGE_RE, isRecordablePage, pageMonthLine, splitByPage } from '../src/ui/assistCost.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = '/research/funds/catalog/fund-42';

const RUN = {
  task: 'workspace_explain', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  cost_usd: 0.0005, prompt_tokens: 120, completion_tokens: 40,
  cached: false, fallback_used: false, refusal: null, at: '2026-10-06 09:00:00',
};
const ACCOUNT_RUN = { ...RUN, model: '@cf/other/model', prompt_tokens: 900, completion_tokens: 300 };

const SPEND = {
  recorded: true,
  month: { spend_usd: 0.02, calls: 9 },
  last_run: ACCOUNT_RUN, last_run_recorded: true,
  by_surface: [
    { surface: '/validate', calls: 3, spend_usd: 0.009 },
    { surface: null, calls: 2, spend_usd: 0.006 },
    { surface: PAGE, calls: 1, spend_usd: 0.0005 },
    { surface: '/research/ask', calls: 3, spend_usd: 0.0045 },
  ],
  by_surface_recorded: true,
};

const report = (over = {}) => ({
  surface: PAGE, recorded: true, reason: null,
  month: { key: '2026-10', spend_usd: 0.0005, calls: 1 },
  unattributed: { calls: 2, spend_usd: 0.006 },
  last_run: RUN, last_run_recorded: true, last_run_reason: null,
  ...over,
});

const render = (props) => renderToStaticMarkup(React.createElement(RailPageUsage, {
  spend: SPEND, pagePath: PAGE, pageSpend: report(), pageSpendError: null, onRetry: () => {}, ...props,
}));
const text = (props) => renderedText(render(props));
/** The rendered text of one `data-testid`'s element. */
function part(html, id) {
  const at = html.indexOf(`data-testid="${id}"`);
  if (at < 0) return null;
  const open = html.lastIndexOf('<', at);
  const tag = html.slice(open + 1).match(/^[a-z]+/)[0];
  const close = html.indexOf(`</${tag}>`, at);
  return renderedText(html.slice(open, close));
}

// ── This page's month ───────────────────────────────────────────────────

test('a page with runs this month reads its own spend and run count', () => {
  const h = render();
  assert.equal(part(h, 'text-worker-rail-page-spend'), 'This page this month: $0.0005 over 1 run.');
  assert.equal(pageMonthLine(report({ month: { spend_usd: 0.012, calls: 3 } })), 'This page this month: $0.0120 over 3 runs.');
});

test('a page with no run ever says "No run on this page yet", and names the runs with no page', () => {
  const h = render({ pageSpend: report({ month: { calls: 0, spend_usd: 0 }, last_run: null, last_run_reason: 'x' }) });
  const line = part(h, 'text-worker-rail-page-spend');
  assert.match(line, /^No run on this page yet\. 2 runs this month carry no page/);
  assert.doesNotMatch(line, /\$0\.0000/, 'a zero page drew a $0 figure');
  assert.equal(part(h, 'text-worker-rail-last-run'), null, 'no run, and a receipt was drawn anyway');
});

test('"yet" is said only when the last-run read found none', () => {
  // Runs before this month: the page has a last run, so "yet" would be false.
  assert.equal(pageMonthLine(report({ month: { calls: 0, spend_usd: 0 }, unattributed: null })),
    'No run on this page this month.');
  // The last run could not be read: "yet" would be a claim.
  assert.equal(pageMonthLine(report({ month: { calls: 0, spend_usd: 0 }, unattributed: null, last_run: null, last_run_recorded: false })),
    'No run on this page this month.');
  assert.equal(pageMonthLine(report({ month: { calls: 0, spend_usd: 0 }, unattributed: { calls: 0, spend_usd: 0 }, last_run: null })),
    'No run on this page yet.');
  assert.match(pageMonthLine(report({ month: { calls: 0, spend_usd: 0 }, unattributed: { calls: 1, spend_usd: 0.001 }, last_run: null })),
    /^No run on this page yet\. 1 run this month carries no page/);
});

test('a failed page read is Unreadable with a retry, never a zero', () => {
  for (const props of [
    { pageSpend: null, pageSpendError: new Error('500') },
    // A figure left from an earlier read is not shown beside a failed one.
    { pageSpend: report(), pageSpendError: new Error('500') },
    { pageSpend: report({ recorded: false, month: { calls: null, spend_usd: null }, last_run: null, last_run_recorded: false }) },
  ]) {
    const h = render(props);
    const line = part(h, 'text-worker-rail-page-spend');
    assert.match(line, /This page's spend could not be read\. That is not a claim that this page has cost nothing\./);
    assert.match(line, /Retry/);
    assert.doesNotMatch(line, /No run|\$0/);
    assert.equal(part(h, 'text-worker-rail-last-run'), null);
  }
});

// ── This page's last run ────────────────────────────────────────────────

test('the receipt is this page\'s last run, labelled as this page\'s', () => {
  const line = part(render(), 'text-worker-rail-last-run');
  assert.match(line, /^Last run · this page/);
  assert.match(line, /120 in \/ 40 out · \$0\.0005/);
  assert.doesNotMatch(line, /900 in/, 'the account\'s last run was drawn as this page\'s');
});

test('an unreadable page last run is Unreadable, not "no run"', () => {
  const h = render({ pageSpend: report({ last_run: null, last_run_recorded: false }) });
  assert.match(part(h, 'text-worker-rail-last-run'), /This page's last run could not be read\. That is not a claim that it has none\.\s*Retry/);
  assert.match(part(h, 'text-worker-rail-page-spend'), /^This page this month:/);
});

test('a path the router does not record is not read, and falls back to the account receipt, labelled so', () => {
  const h = render({ pagePath: '/research/a b', pageSpend: null });
  assert.match(part(h, 'text-worker-rail-page-spend'), /^Runs from this page are not recorded against it/);
  assert.match(part(h, 'text-worker-rail-last-run'), /^Last run · your account, any page.*900 in \/ 300 out/);
  const unreadable = render({ pagePath: '', pageSpend: null, spend: { ...SPEND, last_run: null, last_run_recorded: false } });
  assert.match(part(unreadable, 'text-worker-rail-last-run'), /Your last run could not be read/);
});

// ── The split by page ───────────────────────────────────────────────────

test('the month is split by page, costliest first, this page marked, runs with no page their own row', () => {
  const h = render();
  const list = h.slice(h.indexOf('data-testid="list-worker-rail-by-page"'));
  const rows = [...list.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attrs: m[1], text: renderedText(m[2]) }));
  assert.deepEqual(rows.map((r) => r.text), [
    '/validate$0.0090 · 3 runs',
    'No page recorded$0.0060 · 2 runs',
    '/research/ask$0.0045 · 3 runs',
    `${PAGE}$0.0005 · 1 run`,
  ]);
  assert.deepEqual(rows.map((r) => /aria-current="page"/.test(r.attrs)), [false, false, false, true]);
});

test('beyond the limit the rest is one row that keeps the total, and this page is never folded into it', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ surface: `/p${i}`, calls: 1, spend_usd: (10 - i) / 1000 }));
  const { rows, rest } = splitByPage([...many, { surface: PAGE, calls: 2, spend_usd: 0.0001 }], PAGE);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].surface, PAGE, 'this page fell into "more pages"');
  assert.equal(rest.pages, 4);
  assert.equal(rest.calls, 4);
  assert.ok(Math.abs(rest.spend_usd - 0.018) < 1e-12, `rest spend ${rest.spend_usd}`);
  const total = rows.reduce((n, r) => n + r.spend_usd, 0) + rest.spend_usd;
  assert.ok(Math.abs(total - (many.reduce((n, r) => n + r.spend_usd, 0) + 0.0001)) < 1e-12, 'the rows do not add up to the month');
  assert.deepEqual(splitByPage(many.slice(0, 3), PAGE).rest, null);
  const h = render({ spend: { ...SPEND, by_surface: many } });
  const list = h.slice(h.indexOf('data-testid="list-worker-rail-by-page"'));
  const items = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => renderedText(m[1]));
  assert.equal(items.length, 6);
  assert.equal(items[5], '3 more pages$0.0120 · 3 runs', 'the folded pages were dropped from the split');
  assert.equal(splitByPage([{ surface: null, calls: 1, spend_usd: 1 }], null).rows[0].current, false,
    'the no-page row matched an empty page');
});

test('a failed grouping is Unreadable; an empty month draws no list', () => {
  const failed = part(render({ spend: { ...SPEND, by_surface: [], by_surface_recorded: false } }), 'list-worker-rail-by-page');
  assert.match(failed, /Spend by page could not be read\. That is not a claim that no page has spent\./);
  assert.equal(part(render({ spend: { ...SPEND, by_surface: [] } }), 'list-worker-rail-by-page'), null);
});

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

test('the rail asks for the page it sits on and hands the read to RailPageUsage', () => {
  const src = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.match(src, /useAiSpend\(\{ page: pagePath \}\)/);
  assert.match(src, /<RailPageUsage\s+spend=\{spend\}\s+pagePath=\{pagePath\}\s+pageSpend=\{pageSpend\}\s+pageSpendError=\{pageSpendError\}\s+onRetry=\{reload\}/);
});
