/**
 * D791 part 2 (#2216) — HQ › AI usage at `/admin/platform/ai-usage`, board B5
 * of the "Usage & Billing console" canvas, on part 1's Worker read.
 *
 *   · The model (`pages/hq/aiUsageModel.js`): the five totals, the daily chart
 *     by model, the splits, the Members rows with their flags, pause and cap,
 *     the sort, the history lines, and the reason and cap rules.
 *   · The real page, mounted with the client stubbed: the totals, the members
 *     by ID and email, Paused and Resume AI, the range re-reading, the search,
 *     the member panel, and Pause AI and Set cap each needing a reason.
 *   · The route is HQ-only, sits on the Platform strip after AI allowances, and
 *     docks AI allowances' rail.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_usage_d791.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import AiUsagePage from '../src/pages/hq/AiUsagePage.jsx';
import { adminAiUsageApi } from '../src/lib/api/adminAiUsage.js';
import { adminAiUsageApi as reExported } from '../src/lib/api.js';
import { HQ_STRIPS } from '../src/lib/hqStrips.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import {
  dailyByModel, flagRows, headline, historyLine, memberRows, parseCap, reasonOk, sortRows, splits,
} from '../src/pages/hq/aiUsageModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const L70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GLM = '@cf/zai-org/glm-4.7-flash';
const sums = (o) => ({ runs: 0, refused: 0, cost_microusd: 0, charged_microusd: 0, margin_microusd: 0, not_recorded: 0, ...o });
const M = (id, email, name) => ({ id, email, name });

/** One platform read, as `GET /api/admin/ai-usage?range=7d` answers. */
const READ = {
  ok: true, range: '7d', from: '2026-10-14 00:00:00', to: '2026-10-21 00:00:00',
  totals: sums({ runs: 40, refused: 2, cost_microusd: 8_000_000, charged_microusd: 10_000_000, margin_microusd: 2_000_000, not_recorded: 1 }),
  by_day: [{ day: '2026-10-19', ...sums({ runs: 10, cost_microusd: 3_000_000, charged_microusd: 4_000_000 }) }, { day: '2026-10-20', ...sums({ runs: 30, cost_microusd: 5_000_000, charged_microusd: 6_000_000 }) }],
  by_model: [{ model: L70, ...sums({ runs: 30, cost_microusd: 6_000_000, charged_microusd: 8_000_000 }) }, { model: GLM, ...sums({ runs: 10, cost_microusd: 2_000_000, charged_microusd: 2_000_000 }) }],
  by_day_model: [
    { day: '2026-10-19', model: L70, cost_microusd: 2_000_000, charged_microusd: 3_000_000 },
    { day: '2026-10-19', model: GLM, cost_microusd: 1_000_000, charged_microusd: 1_000_000 },
    { day: '2026-10-20', model: L70, cost_microusd: 4_000_000, charged_microusd: 5_000_000 },
    { day: '2026-10-20', model: GLM, cost_microusd: 1_000_000, charged_microusd: 1_000_000 },
  ],
  by_role: [{ role: 'founder', ...sums({ runs: 30, charged_microusd: 8_000_000 }) }, { role: 'system', ...sums({ runs: 10 }) }],
  by_plan: [{ plan: 'founder:growth', ...sums({ runs: 30, charged_microusd: 8_000_000 }) }],
  topups_microusd: 25_000_000,
  top_charged: [
    { member: M(1042, 'mia@example.test', 'Mia'), role: 'founder', plan: 'founder:growth', ...sums({ runs: 20, cost_microusd: 4_000_000, charged_microusd: 6_000_000, margin_microusd: 2_000_000 }), topups_microusd: 20_000_000 },
    { member: M(931, 'oli@example.test', 'Oli'), role: 'investor', plan: 'investor:pro', ...sums({ runs: 15, cost_microusd: 3_000_000, charged_microusd: 3_000_000, margin_microusd: 0 }), topups_microusd: 5_000_000 },
  ],
  top_velocity: [{ member: M(1042, 'mia@example.test', 'Mia'), today_microusd: 9_000_000, daily_average_microusd: 1_000_000, ratio: 9 }],
  flags: [{ member: M(1042, 'mia@example.test', 'Mia'), flag: 'spike', why: 'Charged $9.00 today, 9.0× the 7-day daily average of $1.00.', since: '2026-10-20 00:00:00' }],
  thresholds: {},
  paused: [{ member: M(931, 'oli@example.test', 'Oli'), reason: 'Card testing pattern seen', paused_at: '2026-10-20 10:00:00', paused_by: M(1, 'owner@example.test', 'Owner') }],
  caps: [{ member: M(1042, 'mia@example.test', 'Mia'), monthly_microusd: 300_000_000, set_at: '2026-10-19 09:00:00', set_by: M(1, 'owner@example.test', 'Owner') }],
};
const DETAIL = {
  ok: true, range: '7d', member: M(1042, 'mia@example.test', 'Mia'), role: 'founder', plan: 'founder:growth', joined: '2026-03-12 10:00:00',
  totals: { ...sums({ runs: 20, cost_microusd: 4_000_000, charged_microusd: 6_000_000, margin_microusd: 2_000_000 }), topups_microusd: 20_000_000 },
  by_model: [{ model: L70, ...sums({ runs: 20, cost_microusd: 4_000_000, charged_microusd: 6_000_000 }) }],
  by_day: [{ day: '2026-10-20', ...sums({ runs: 20, cost_microusd: 4_000_000, charged_microusd: 6_000_000 }) }],
  balance: { state: 'ok', balance_microusd: 12_500_000 },
  allowance: { state: 'unreadable' },
  spend_limit: { state: 'ok', limit_microusd: 500_000_000, charged_microusd: 135_000_000 },
  pause: null, cap: { monthly_microusd: 300_000_000, set_at: '2026-10-19 09:00:00', set_by: M(1, 'owner@example.test', 'Owner') },
  history: [{ action: 'ai_member_cap_set', at: '2026-10-19 09:00:00', actor_id: 1, actor_name: 'Owner', details: { reason: 'Spike on a new account', after_microusd: 300_000_000 } }],
};

// ------------------------------------------------------------------ the model

test('the five totals: runs, Cloudflare cost, charged, margin as a share of cost, and AI tokens bought', () => {
  // Mutations checked: the margin share over the charge; the tokens total read from the top members.
  const t = Object.fromEntries(headline(READ).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(t), ['runs', 'cost', 'charged', 'margin', 'topups']);
  assert.deepEqual([t.runs.value, t.cost.value, t.charged.value, t.margin.value, t.topups.value], ['40', '$8.00', '$10.00', '$2.00', '$25.00']);
  assert.equal(t.margin.note, '25% of Cloudflare cost');
  assert.equal(t.charged.note, '1 run not recorded', 'an unrecorded charge is said, not hidden');
  assert.equal(headline({ ...READ, topups_microusd: undefined }).find((x) => x.key === 'topups').value, null, 'a missing total is not $0');
});

test('the daily chart is the whole range, stacked by model, on the toggle\'s metric', () => {
  // Mutations checked: the metric ignored; the empty days dropped.
  const charged = dailyByModel(READ, 'charged');
  assert.equal(charged.columns.length, 7, 'every day of the range, busy or not');
  const d20 = charged.columns.find((c) => c.day === '2026-10-20');
  assert.deepEqual(d20.parts.map((p) => [p.model, p.value]), [[L70, 5_000_000], [GLM, 1_000_000]]);
  assert.equal(charged.max, 6_000_000);
  assert.equal(dailyByModel(READ, 'cost').columns.find((c) => c.day === '2026-10-20').total, 5_000_000);
  assert.equal(charged.columns.find((c) => c.day === '2026-10-14').total, 0);
  assert.deepEqual(splits(READ).map((s) => s.title), ['By model', 'By role', 'By plan']);
  assert.equal(splits(READ)[1].rows[1].label, 'System');
});

test('the members: flags, Paused, the cap, the sort, and the history lines', () => {
  // Mutations checked: a paused member not marked; the sort direction ignored; the actor's name dropped.
  const rows = memberRows(READ);
  const mia = rows.find((r) => r.id === 1042);
  const oli = rows.find((r) => r.id === 931);
  assert.deepEqual(mia.flags.map((f) => f.label), ['Spike']);
  assert.equal(mia.cap, 300_000_000);
  assert.equal(oli.paused, true);
  assert.deepEqual(oli.flags.map((f) => f.label), ['Paused']);
  assert.deepEqual(sortRows(rows, 'charged', 'desc').map((r) => r.id), [1042, 931]);
  assert.deepEqual(sortRows(rows, 'charged', 'asc').map((r) => r.id), [931, 1042]);
  assert.deepEqual(sortRows(rows, 'email', 'asc').map((r) => r.id), rows.map((r) => r.id), 'only money and counts sort');
  assert.equal(flagRows(READ)[0].label, 'Spike');
  assert.deepEqual(historyLine(DETAIL.history[0]), { when: '19 Oct, 09:00 UTC', what: 'Cap set to $300.00 a month', who: 'Owner', why: 'Spike on a new account' });
  assert.equal(reasonOk('too short'), false);
  assert.equal(reasonOk('Card testing pattern seen'), true);
  assert.deepEqual([parseCap('300'), parseCap('12.50'), parseCap('-1'), parseCap('100001'), parseCap('abc')], [300, 12.5, null, null, null]);
});

// ------------------------------------------------------------------ the page

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mountPage({ read = async () => READ } = {}) {
  const original = { ...adminAiUsageApi };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  const calls = [];
  const log = (name, answer) => async (...args) => { calls.push([name, ...args]); return typeof answer === 'function' ? answer(...args) : answer; };
  Object.assign(adminAiUsageApi, {
    read: log('read', read),
    search: log('search', { ok: true, members: [READ.top_charged[1]] }),
    member: log('member', DETAIL),
    pause: log('pause', { ok: true, paused: true }),
    resume: log('resume', { ok: true, paused: false }),
    setCap: log('setCap', { ok: true }),
  });
  const m = await mountContracts(React.createElement(AiUsagePage), '/admin/platform/ai-usage');
  const settle = async () => { for (let i = 0; i < 5; i += 1) await m.flush(); };
  await settle();
  const nodes = () => m.nodes();
  const byTest = (id) => nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const button = (label, within) => (within ? [within, ...within.childNodes.flatMap(function walk(n) { return [n, ...(n.childNodes || []).flatMap(walk)]; })] : nodes())
    .find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const press = async (label, within) => { const b = button(label, within); assert.ok(b, `button ${label}`); await act(async () => { m.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  const type = async (el, value) => { await act(async () => { m.props(el).onChange({ target: { value } }); }); await settle(); };
  return {
    ...m, calls, settle, byTest, button, press, type, text: () => textOf(byTest('hq-ai-usage-page') || nodes()[0]),
    async close() { await m.unmount(); Object.assign(adminAiUsageApi, original); globalThis.fetch = realFetch; },
  };
}

test('the page draws the totals and names each member by user ID and email, with Paused and Resume AI', async () => {
  // Mutations checked: the email column dropped; a paused row offering Pause AI.
  const p = await mountPage();
  try {
    assert.deepEqual(p.calls[0], ['read', '30d'], 'the default range is 30 days');
    const text = p.text();
    for (const s of ['Runs', 'Cloudflare cost', 'Charged to customers', 'Margin', 'AI tokens bought', '$25.00', 'Daily, by model', 'By model', 'By role', 'By plan', '#1042', 'mia@example.test', '#931', 'oli@example.test', 'Founder · Growth', 'Spike', 'Paused']) {
      assert.ok(text.includes(s), `the page does not say ${s}`);
    }
    const rows = p.nodes().filter((n) => p.props(n)?.['data-testid'] === 'ai-usage-member-row');
    const oli = rows.find((n) => p.props(n)['data-member'] === 931);
    assert.ok(p.button('Resume AI', oli) && !p.button('Pause AI', oli), 'a paused member is resumed, not paused again');
    assert.doesNotMatch(text, /prompt|output/i);
  } finally { await p.close(); }
});

test('the range re-reads, the search asks the Worker, and a row opens the member panel', async () => {
  // Mutations checked: the range not passed; the search not sent; the panel reading another range.
  const p = await mountPage();
  try {
    await p.press('7 days');
    assert.deepEqual(p.calls.filter((c) => c[0] === 'read').at(-1), ['read', '7d']);
    const input = p.nodes().find((n) => n.tagName === 'INPUT' && p.props(n)?.placeholder === 'Search by email or user ID');
    await p.type(input, 'oli@');
    const form = p.nodes().find((n) => n.tagName === 'FORM' && p.props(n)?.role === 'search');
    await act(async () => { await p.props(form).onSubmit({ preventDefault() {} }); });
    await p.settle();
    assert.deepEqual(p.calls.find((c) => c[0] === 'search'), ['search', 'oli@', '7d']);
    assert.ok(p.text().includes('1 found for “oli@”'));
    await p.press('Fastest rising');
    const rising = textOf(p.byTest('ai-usage-rising'));
    for (const s of ['#1042', '$9.00', '$1.00', '×9', 'Spike']) assert.ok(rising.includes(s), `rising does not say ${s}`);
  } finally { await p.close(); }
});

test('a row opens the member panel for the page\'s range, and an unreadable read is said, never $0', async () => {
  const p = await mountPage();
  try {
    await p.press('7 days');
    const row = p.nodes().find((n) => p.props(n)?.['data-member'] === 1042);
    await act(async () => { p.props(row).onClick(); });
    await p.settle();
    assert.deepEqual(p.calls.find((c) => c[0] === 'member'), ['member', 1042, '7d'], 'the panel reads the page\'s range');
    const panel = p.byTest('ai-usage-panel');
    const t = textOf(panel);
    for (const s of ['Mia', '#1042 · mia@example.test', 'Founder · Growth · joined 12 Mar', '$12.50', 'Unreadable', '$135.00 of $500.00', 'Cap set to $300.00 a month', 'Owner', 'Spike on a new account']) {
      assert.ok(t.includes(s), `the panel does not say ${s}: ${t}`);
    }
    assert.equal(textOf(p.byTest('ai-usage-panel-state')), 'Cap · $300.00 a month');
    assert.doesNotMatch(t, /Founder · Founder/, 'the role said twice');
  } finally { await p.close(); }
});

test('Pause AI and Set cap each need a reason; the write goes to the Worker and the page re-reads', async () => {
  // Mutations checked: Pause enabled without a reason; the cap sent as text; the page not re-reading after a write.
  const p = await mountPage();
  try {
    const rows = p.nodes().filter((n) => p.props(n)?.['data-testid'] === 'ai-usage-member-row');
    const mia = rows.find((n) => p.props(n)['data-member'] === 1042);
    await p.press('Pause AI', mia);
    const dialog = p.byTest('ai-usage-dialog-pause');
    assert.ok(dialog, 'the Pause AI dialog');
    const submit = p.button('Pause AI', dialog);
    assert.equal(p.props(submit).disabled, true, 'Pause AI with no reason');
    const area = p.nodes().find((n) => n.tagName === 'TEXTAREA');
    await p.type(area, 'Spike on a new account, checking');
    assert.equal(p.props(p.button('Pause AI', p.byTest('ai-usage-dialog-pause'))).disabled, false);
    const form = p.nodes().find((n) => n.tagName === 'FORM' && p.byTest('ai-usage-dialog-pause')?.childNodes.includes(n));
    const reads = p.calls.filter((c) => c[0] === 'read').length;
    await act(async () => { await p.props(form).onSubmit({ preventDefault() {} }); });
    await p.settle();
    assert.deepEqual(p.calls.find((c) => c[0] === 'pause'), ['pause', 1042, 'Spike on a new account, checking']);
    assert.ok(p.calls.filter((c) => c[0] === 'read').length > reads, 'the page re-reads after the write');
    assert.equal(textOf(p.byTest('ai-usage-done')), 'AI paused for #1042.');

    // Set cap: a bad amount holds the button; an empty one clears the cap.
    const again = p.nodes().filter((n) => p.props(n)?.['data-testid'] === 'ai-usage-member-row').find((n) => p.props(n)['data-member'] === 1042);
    await p.press('Set cap', again);
    const capDialog = p.byTest('ai-usage-dialog-cap');
    const amount = p.nodes().find((n) => n.tagName === 'INPUT' && p.props(n)?.inputMode === 'decimal');
    assert.equal(p.props(amount).value, '300', 'the current cap is filled in');
    await p.type(amount, 'lots');
    await p.type(p.nodes().find((n) => n.tagName === 'TEXTAREA'), 'Lift the cap after review');
    assert.equal(p.props(p.button('Save cap', p.byTest('ai-usage-dialog-cap'))).disabled, true, 'an amount that is not one');
    await p.type(amount, '');
    const capForm = p.nodes().find((n) => n.tagName === 'FORM' && p.byTest('ai-usage-dialog-cap')?.childNodes.includes(n));
    assert.ok(capDialog);
    await act(async () => { await p.props(capForm).onSubmit({ preventDefault() {} }); });
    await p.settle();
    assert.deepEqual(p.calls.find((c) => c[0] === 'setCap'), ['setCap', 1042, null, 'Lift the cap after review']);
  } finally { await p.close(); }
});

test('a run log that cannot be read is said, and no figure is drawn', async () => {
  // Mutation checked: the totals drawn from nothing.
  const p = await mountPage({ read: async () => { throw new Error('Unreadable: AI usage could not be read.'); } });
  try {
    assert.ok(p.text().includes('The run log could not be read.'));
    assert.equal(p.byTest('ai-usage-totals'), undefined);
  } finally { await p.close(); }
});

// ------------------------------------------------------------------ the route

test('the route is HQ-only, on the Platform strip after AI allowances, and docks AI allowances\' rail', () => {
  // Mutations checked: the route without hqOnly; the strip link dropped; the alias pointing elsewhere.
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/admin\/platform\/ai-usage" element=\{guard\(\['admin'\], hqOnly\(<HqAiUsagePage \/>\)\)\} \/>/);
  assert.match(app, /<StripLink to="\/admin\/platform\/allowances">AI allowances<\/StripLink>\s*<StripLink to="\/admin\/platform\/ai-usage">AI usage<\/StripLink>/);
  const platform = HQ_STRIPS.Platform.map((i) => i.route);
  assert.equal(platform.indexOf('/admin/platform/ai-usage'), platform.indexOf('/admin/platform/allowances') + 1);
  assert.equal(pageKeyFor('/admin/platform/ai-usage', 'super_admin'), pageKeyFor('/admin/platform/allowances', 'super_admin'));
  assert.match(readFileSync('frontend/src/pages/hq/PlatformAllowancesPage.jsx', 'utf8'), /<Link to="\/admin\/platform\/ai-usage"/);
  assert.equal(reExported, adminAiUsageApi, 'api.js re-exports the module (D527)');
});
