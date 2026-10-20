/**
 * D776 (#2093) PR 2 — HQ › AI allowances, read-only: How members are charged
 * and Models offered (`GET /ai/catalogue/hq`), and inside One member's AI
 * account, that member's month by page and option and each run
 * (`GET /ai-budget/members/:id/runs`). The words are `hqAiModel.js`'s. The
 * Worker's half is cloudflare-worker/test/ai_consumption_d776.test.ts. Each
 * case names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_allowances_d776.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { BillingCard, MemberSpend, ModelsCard } from '../src/pages/hq/HqAiCards.jsx';
import { NEW_MODEL_IDS, billingText, memberMonthView, modelsView, unitUsd } from '../src/pages/hq/hqAiModel.js';
import { ALL_MODELS, NEW_MODELS } from '../src/ui/railModels.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const ready = (data) => ({ status: 'ready', data, reload() {} });
const VR = 'Founder · Validate';
const MODELS = {
  billing: 'cost', markup: 1.25, set_by: 'AI_BILLING',
  models: [
    { id: '@cf/zai-org/glm-4.7-flash', name: 'GLM-4.7 Flash', kind: 'Text Generation', paid_only: false, cost: { tokens_in: 0.06, tokens_out: 0.4 }, billed: { tokens_in: 0.075, tokens_out: 0.5 }, pages: ['Founder · Studio', VR] },
    { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'Qwen3 30B A3B', kind: 'Text Generation', paid_only: true, cost: { tokens_in: 0.051 }, billed: { tokens_in: 0.06375 }, pages: [] },
  ],
};
const MONTH = {
  member_id: 2, month: '2026-10', truncated: false, runs_truncated: false,
  totals: { runs: 2, charged_microusd: 3500, allowance_microusd: 2000, tokens_microusd: 1000, not_recorded: 1 },
  by_option: [
    { page: VR, option: 'fill:pain_tag', runs: 1, charged_microusd: 3500, allowance_microusd: 2000, tokens_microusd: 1000, not_recorded: 0 },
    { page: null, option: null, runs: 1, charged_microusd: null, allowance_microusd: 0, tokens_microusd: 0, not_recorded: 1 },
  ],
  runs: [
    { id: 9, at: '2026-10-14 09:00:00', task: 'rail_chat', model: '@cf/zai-org/glm-4.7-flash', page: null, option: null, record: null, guard_for: null, cost_microusd: 900, charged_microusd: null },
    { id: 8, at: '2026-10-12 10:00:01', task: 'safety', model: '@cf/meta/llama-guard-3-8b', page: VR, option: 'fill:pain_tag', record: null, guard_for: 7, cost_microusd: 400, charged_microusd: 500 },
    { id: 7, at: '2026-10-12 10:00:00', task: 'rail_synth', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', page: VR, option: 'fill:pain_tag', record: null, guard_for: null, cost_microusd: 2400, charged_microusd: 3000 },
  ],
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('the words: the billing mode as the canvas says it, unit prices, New and Paid only, and one member\'s month', () => {
  // Mutations checked: the × markup line for cost; a price rounded to cents; the guard flag dropped; a null charge read as $0.
  assert.equal(billingText({ billing: 'cost', markup: 1.25 }), 'At Cloudflare’s cost');
  assert.equal(billingText({ billing: 'billed', markup: 1.25 }), 'Cloudflare’s cost × 1.25');
  assert.equal(billingText({ billing: 'other' }), null);
  assert.equal(unitUsd(0.06375), '$0.06375');
  assert.equal(unitUsd(0.4), '$0.4');
  assert.equal(unitUsd(-1), null);
  assert.equal(unitUsd(0.000001), '$0.000001', 'never in exponent notation');
  assert.equal(unitUsd(0), '$0');
  const NEW = new Set(['@cf/qwen/qwen3-30b-a3b-fp8']);
  const [glm, qwen] = modelsView(MODELS, NEW);
  assert.deepEqual(glm.prices, [{ unit: 'per 1M input tokens', cost: '$0.06', billed: '$0.075' }, { unit: 'per 1M output tokens', cost: '$0.4', billed: '$0.5' }]);
  assert.equal(glm.paidOnly, false);
  assert.equal(qwen.paidOnly, true);
  assert.equal(qwen.isNew, true, 'a model in the New set');
  // D769 PR 2 (#2192): the name → id pairs live in `ALL_MODELS` now, grouped.
  const pairs = ALL_MODELS.flatMap(([, rows]) => rows);
  for (const id of NEW_MODEL_IDS) assert.ok(pairs.some(([n, x]) => x === id && NEW_MODELS.has(n)), 'New is only a canvas new model the list maps');
  assert.equal(modelsView(MODELS)[1].isNew, NEW_MODEL_IDS.has('@cf/qwen/qwen3-30b-a3b-fp8'), 'by default the badge follows the mapped list, never a guess');
  assert.equal(glm.isNew, false);
  assert.equal(modelsView({}), null);
  const v = memberMonthView(MONTH);
  assert.deepEqual(v.pages.map((p) => [p.key, p.charged]), [[VR, '$0.0035'], ['(none)', null]]);
  assert.deepEqual(v.runs.map((r) => [r.id, r.guard, r.charged]), [[9, false, null], [8, true, '$0.0005'], [7, false, '$0.003']]);
  assert.equal(v.runs[2].model, 'llama-3.3-70b-instruct-fp8-fast');
  assert.equal(v.total.runs, 2);
  assert.equal(memberMonthView({ runs: [] }), null);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('How members are charged says the mode, that the owner sets it through AI_BILLING, and the margin rule', () => {
  // Mutations checked: the AI_BILLING line dropped; an unreadable read drawn as "At Cloudflare's cost".
  const out = html(h(BillingCard, { models: ready(MODELS) }));
  assert.match(out, /data-testid="hq-billing-mode"[^>]*>At Cloudflare’s cost</);
  assert.match(out, /Set by the owner through <span[^>]*>AI_BILLING<\/span>, never on this page\./);
  assert.match(out, /token margin counts token spend only/);
  const charged = html(h(BillingCard, { models: ready({ ...MODELS, billing: 'billed' }) }));
  assert.match(charged, />Cloudflare’s cost × 1\.25</);
  const bad = html(h(BillingCard, { models: { status: 'error', data: null, reload() {} } }));
  assert.doesNotMatch(bad, /hq-billing-mode/);
  assert.match(bad, /The billing mode/);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('Models offered draws each model with cost and billed per unit, Paid only, New, and the pages naming it', () => {
  // Mutations checked: the billed price dropped; the pages line dropped; Paid only drawn for every model; New drawn for every model.
  const out = html(h(ModelsCard, { models: ready(MODELS), newIds: new Set(['@cf/qwen/qwen3-30b-a3b-fp8']) }));
  assert.equal((out.match(/data-testid="hq-model-row"/g) || []).length, 2);
  assert.match(out, /cost \$0\.06 · billed \$0\.075 per 1M input tokens/);
  assert.equal((out.match(/data-testid="hq-model-paid-only"/g) || []).length, 1);
  assert.equal((out.match(/data-testid="hq-model-new"/g) || []).length, 1);
  assert.match(out, /Named on Founder · Studio, Founder · Validate/);
  assert.match(out, /No page’s row names it\./);
  assert.match(html(h(ModelsCard, { models: ready({ ...MODELS, models: [] }) })), /data-testid="hq-models-none"/);
  assert.match(html(h(ModelsCard, { models: { status: 'error', data: null, reload() {} } })), /The models/);
});

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, el)); await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { all, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

// 4 ───────────────────────────────────────────────────────────────────────────
test('one member\'s month reads that member, then draws the pages with their options and each run, the guard check under its run', async () => {
  // Mutations checked: the member id not passed; the options not drawn; the guard check drawn as a run; a null charge drawn as $0.
  const calls = [];
  const api = { memberRuns: async (id, opts) => { calls.push([id, opts?.month]); return MONTH; } };
  const m = await mount(h(MemberSpend, { memberId: 2, api }));
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 2);
    assert.match(calls[0][1], /^\d{4}-\d{2}$/);
    assert.equal(m.text(m.all('hq-member-spend-total')[0]), '2 runs · charged $0.0035');
    assert.equal(m.all('hq-member-spend-page').length, 2);
    assert.match(m.text(m.all('hq-member-spend-option')[0]), /fill:pain_tag · 1 run\$0\.0035/);
    const runs = m.all('hq-member-run').map(m.text);
    assert.equal(runs.length, 3);
    assert.match(runs[0], /glm-4\.7-flash · no page · cost \$0\.0009 · charged not recorded/);
    assert.match(runs[1], /Guard check · Founder · Validate · fill:pain_tag · cost \$0\.0004 · charged \$0\.0005/);
    assert.match(runs[2], /llama-3\.3-70b-instruct-fp8-fast/);
  } finally { await m.unmount(); }
  const failing = await mount(h(MemberSpend, { memberId: 2, api: { memberRuns: async () => { throw Object.assign(new Error('Unreadable'), { status: 503 }); } } }));
  try {
    assert.equal(failing.all('hq-member-spend-total').length, 0, 'an unreadable month is never drawn as no runs');
  } finally { await failing.unmount(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the two calls go to the Worker\'s routes, and the page and the member card mount the cards', async () => {
  // Mutations checked: the month not sent; the cards not mounted; MemberSpend not drawn in the member card.
  const { aiBudgetApi } = await import('../src/lib/api/aiBudget.js');
  const src = readFileSync(new URL('../src/lib/api/aiBudget.js', import.meta.url), 'utf8');
  assert.match(src, /memberRuns: \(userId, \{ month \} = \{\}\) => request\(`\/ai-budget\/members\/\$\{enc\(userId\)\}\/runs\$\{month \? `\?month=\$\{enc\(month\)\}` : ''\}`\)/);
  assert.match(src, /models: \(\) => request\('\/ai\/catalogue\/hq'\)/);
  assert.equal(typeof aiBudgetApi.memberRuns, 'function');
  const page = readFileSync(new URL('../src/pages/hq/PlatformAllowancesPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<BillingCard models=\{models\} \/>/);
  assert.match(page, /<ModelsCard models=\{models\} \/>/);
  const packs = readFileSync(new URL('../src/pages/hq/TokenPacks.jsx', import.meta.url), 'utf8');
  assert.match(packs, /\{found && <MemberSpend key=\{`spend-\$\{found\.id\}`\} memberId=\{found\.id\} \/>\}/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/routes/ai_budget.ts', import.meta.url), 'utf8');
  assert.ok(worker.includes("r.get('/members/:userId/runs'"));
  const ai = readFileSync(new URL('../../cloudflare-worker/src/routes/ai.ts', import.meta.url), 'utf8');
  assert.ok(ai.includes("ai.get('/catalogue/hq'"));
});
