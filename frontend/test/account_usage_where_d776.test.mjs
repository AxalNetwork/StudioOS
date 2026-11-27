/**
 * D776 (#2093) PR 1 — "Where it went", charged, on /account/usage: what the
 * member paid this month by the rail's page and option within it, with the
 * allowance and token split, from a stubbed `GET /ai-budget/runs?group=option`.
 * The Worker's half is cloudflare-worker/test/ai_consumption_d776.test.ts.
 * Each case names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_usage_where_d776.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { chargedPages } from '../src/pages/account/usageModel.js';
import { ChargedView, WhereCard } from '../src/pages/account/AccountUsage.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/usage'] }, el));
const ready = (data) => ({ status: 'ready', data, reload() {} });
const VR = 'founder.validate.customer-research';
const row = (page, option, charged, extra = {}) => ({
  page, option, runs: 1, charged_microusd: charged, allowance_microusd: charged ?? 0, tokens_microusd: 0, not_recorded: charged == null ? 1 : 0, ...extra,
});
const READ = {
  group: 'option', month: '2026-10', truncated: false,
  rows: [
    row(VR, 'fill:pain_tag', 3_000_000, { allowance_microusd: 2_000_000, tokens_microusd: 1_000_000, runs: 3 }),
    row('/build/roadmap', 'draft:roadmap', 4_500_000),
    row(VR, null, 500_000),
    row(VR, 'draft:research/ask', 1_250_000, { allowance_microusd: 0, tokens_microusd: 1_250_000 }),
    row(null, null, null, { runs: 2, not_recorded: 2 }),
  ],
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('chargedPages folds options into pages, sums the charge and split, and orders by charge with Not recorded last', () => {
  // Mutations checked: the no-page row sorted with the rest; the page charge not summed; the split dropped.
  const v = chargedPages(READ);
  assert.deepEqual(v.pages.map((p) => [p.key, p.runs, p.charged]), [
    [VR, 5, '$4.75'], ['/build/roadmap', 1, '$4.50'], ['(none)', 2, null],
  ]);
  const vr = v.pages[0];
  assert.equal(vr.allowance, '$2.50');
  assert.equal(vr.tokens, '$2.25');
  assert.deepEqual(vr.options.map((o) => [o.label, o.charged]), [['fill:pain_tag', '$3.00'], ['draft:research/ask', '$1.25'], [null, '$0.50']]);
  assert.equal(vr.options[2].noOption, true, 'the option-less runs come last');
  assert.equal(v.pages[2].noPage, true);
  assert.equal(v.pages[2].charged, null, 'a NULL charge is not $0.00');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a page links only when its key is an app path; a D720 page key is shown as written', () => {
  // Mutations checked: every page linked; a protocol-relative path accepted.
  const v = chargedPages(READ);
  assert.equal(v.pages[1].href, '/build/roadmap');
  assert.equal(v.pages[1].label, 'Build › Roadmap');
  assert.equal(v.pages[0].href, null);
  assert.equal(v.pages[0].label, VR);
  for (const bad of ['//evil.test/x', 'https://evil.test', 'javascript:alert(1)']) {
    assert.equal(chargedPages({ rows: [row(bad, null, 1)] }).pages[0].href, null, bad);
  }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the view: each page, its options and its split; Not recorded instead of a charge', () => {
  // Mutations checked: Not recorded drawn as $0.00; the link left out.
  const out = html(h(ChargedView, { runs: ready(READ) }));
  assert.equal((out.match(/data-testid="usage-charged-page"/g) || []).length, 2);
  assert.match(out, /data-testid="usage-charged-nopage"/);
  assert.match(out, /href="\/build\/roadmap"[^>]*>Build › Roadmap</);
  assert.match(out, /From your allowance \$2\.50 · from tokens \$2\.25/);
  assert.match(out, /No option recorded/);
  assert.equal((out.match(/data-testid="usage-charged-option"/g) || []).length, 4);
  assert.match(out, /Not recorded/);
  const nopage = out.slice(out.indexOf('data-testid="usage-charged-nopage"'));
  assert.match(nopage, /Not recorded/);
  assert.ok(!/\$/.test(nopage), 'the unrecorded row shows no amount: no invented zero, and no split');
  assert.match(out, /from tokens \$0\.00/, 'a real zero split is shown as one');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('loading, empty, unreadable and a malformed read; truncated says so', () => {
  // Mutation checked: a malformed read drawn as empty.
  assert.match(html(h(ChargedView, { runs: { status: 'loading', reload() {} } })), /account-loading/);
  assert.match(html(h(ChargedView, { runs: ready({ rows: [] }) })), /No AI runs yet this month\./);
  for (const runs of [{ status: 'unreadable', reload() {} }, ready({ rows: 'nope' }), ready(null)]) {
    const out = html(h(ChargedView, { runs }));
    assert.match(out, /What you were charged could not be read\./);
    assert.match(out, /This is not a claim that you were charged nothing\./);
  }
  assert.match(html(h(ChargedView, { runs: ready({ ...READ, truncated: true }) })), /Only the 200 largest are listed\./);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the Where card offers Charged, which reads /ai-budget/runs grouped by option only once opened', () => {
  // Mutations checked: the read made with the card closed; another group asked for.
  const SPEND = { month: { calls: 0 }, by_surface: [], by_surface_recorded: true, by_task: [], by_task_recorded: true };
  const out = html(h(WhereCard, { spend: ready(SPEND) }));
  assert.match(out, /data-testid="usage-tab-charged"/);
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/pages/account/AccountUsage.jsx'), 'utf8');
  assert.match(src, /useAccountRead\(\(\) => aiBudgetApi\.runs\(\{ group: 'option' \}\), \{ enabled: tab === 'charged' \}\)/);
  const api = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api/aiBudget.js'), 'utf8');
  assert.match(api, /request\(`\/ai-budget\/runs\?\$\{q\}`\)/);
  const charged = html(h(WhereCard, { spend: ready(SPEND), initialTab: 'charged' }));
  assert.match(charged, /What you paid for each run, as its hold settled\./);
});
