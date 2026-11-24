/**
 * D6221 (#6221, canvas D6220 EW-01 to EW-14): the Exit Waterfall in the
 * Portfolio frame. The real page is mounted against a stubbed `fetch` that
 * answers like the Worker (`fund_simulator.ts`'s engine, reproduced below),
 * in its populated, no-fund, Unreadable, read-only investor, scenario and
 * phone states; then the pure model.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/exit_waterfall_6221.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 * 36 mutations, 36 caught, among them carry read from the fund row and from
 * the LP's own record, the $0 basis read, the input limits, each Not
 * computable reason, running totals, Saved by you, changes since loaded, the
 * name rules, the 403 sentence, compare's differs and holding periods, the
 * CSV first line, an LP's rows and scenario list withheld, Save for a
 * manager only, a failed fund or scenario read drawn as empty, the stale
 * result dropped or saved, delete without confirmation, the list not read
 * again after a save, and the phone terms sheet and column labels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import WaterfallPage from '../src/pages/WaterfallPage.jsx';
import {
  bodyOf, carryOf, changesSince, compareOf, figuresOf, inputErrors, lpsCsvOf, nameError, parseMoney, presetsOf, refusalOf,
  scenarioOf, signedDollars, sourceLineOf, startingInputs, tiersOf,
} from '../src/pages/portfolio/waterfallModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* The Worker's engine (`simulateWaterfall`), so the fixtures add up the way production does. */
function engine({ exit_value, carry_pct = 0.2, hurdle_rate = 0.08, years_held = 5, gp_catchup = true }, lps, fallback = { committed: 0, invested: 0 }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const sumC = lps.reduce((s, l) => s + l.commitment_amount, 0) || fallback.committed;
  const invested = lps.reduce((s, l) => s + l.invested_amount, 0) || fallback.invested;
  let rem = exit_value;
  const roc = Math.min(invested, rem); rem -= roc;
  const pref = Math.min(invested * ((1 + hurdle_rate) ** years_held - 1), rem); rem -= pref;
  let cu = 0;
  if (gp_catchup && carry_pct > 0 && pref > 0) { cu = Math.min((pref * carry_pct) / (1 - carry_pct), rem); rem -= cu; }
  const lpSplit = rem * (1 - carry_pct);
  const gpSplit = rem * carry_pct;
  const toLps = roc + pref + lpSplit;
  const toGp = cu + gpSplit;
  return {
    exit_value,
    tranches: [
      { name: 'Return of capital', to: 'LPs', amount: r2(roc) },
      { name: `Preferred return (hurdle ${(hurdle_rate * 100).toFixed(1)}%)`, to: 'LPs', amount: r2(pref) },
      { name: 'GP catch-up', to: 'GP', amount: r2(cu) },
      { name: `Profit split — LP ${((1 - carry_pct) * 100).toFixed(0)}%`, to: 'LPs', amount: r2(lpSplit) },
      { name: `Profit split — GP carry ${(carry_pct * 100).toFixed(0)}%`, to: 'GP', amount: r2(gpSplit) },
    ],
    totals: {
      to_lps: r2(toLps), to_gp: r2(toGp), total_distributed: r2(toLps + toGp),
      lp_moic: invested > 0 ? Math.round((toLps / invested) * 1000) / 1000 : 0,
      lp_irr_pct: invested > 0 && toLps > 0 && years_held > 0 ? r2(((toLps / invested) ** (1 / years_held) - 1) * 100) : 0,
      total_invested: invested, total_committed: Math.max(invested, sumC), carry_pct, hurdle_rate, years_held,
    },
    lp_rows: lps.map((l) => ({
      name: l.name, commitment_amount: l.commitment_amount, invested_amount: l.invested_amount,
      share_pct: Math.round((l.commitment_amount / sumC) * 100000) / 1000,
      payout: r2((toLps * l.commitment_amount) / sumC), profit: r2((toLps * l.commitment_amount) / sumC - l.invested_amount),
      moic: l.invested_amount > 0 ? Math.round(((toLps * l.commitment_amount) / sumC / l.invested_amount) * 1000) / 1000 : 0,
    })),
    assumptions: ['European waterfall — whole-of-fund, not deal-by-deal.'],
  };
}

const LPS = [
  { name: 'Alder Pension Plan', commitment_amount: 3000000, invested_amount: 2400000 },
  { name: 'Birchway Trust', commitment_amount: 2000000, invested_amount: 1600000 },
];
const GP_FUND = { id: 42, name: 'Cedar Fund', vintage_year: 2024, status: 'active', can_manage: true, relationship: 'gp', carried_interest: 0.25 };
const LP_FUND = { id: 42, name: 'Cedar Fund', vintage_year: 2024, status: 'active', can_manage: false, relationship: 'lp' };
const saved = (uid, name, exit, years, by = 7) => ({
  uid, name, kind: 'waterfall', fund_id: 42, created_by_user_id: by, created_at: '2026-11-03T10:12:00Z',
  inputs: { exit_value: exit, carry_pct: 0.25, hurdle_rate: 0.08, years_held: years, gp_catchup: true },
  result: engine({ exit_value: exit, carry_pct: 0.25, years_held: years }, LPS),
});

/** Mount the page; `answer({ path, query, method, body })` answers each request, anything else gets `{}` (the rail's reads). */
async function mount(answer, { phone = false } = {}) {
  const restore = installDocument();
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, search: url.search, method, body });
    return (await answer({ path: url.pathname, query: url.searchParams, method, body })) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (n) => (n.nodeType === 3 ? n.textContent : (n.childNodes || []).map(textOf).join('') || n.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/waterfall'] }, h(WaterfallPage))));
  await settle();
  return {
    calls,
    sims: () => calls.filter((c) => c.path.endsWith('/waterfall/simulate')),
    text: (id) => (id ? (byId(id) ? textOf(byId(id)) : null) : textOf(box)),
    has: (id) => Boolean(byId(id)),
    props: (id) => props(byId(id) || {}),
    all: (id) => nodes().filter((n) => props(n)['data-testid'] === id),
    tds: () => nodes().filter((n) => n.tagName === 'TD').map((n) => props(n)),
    async click(id) {
      const n = byId(id);
      if (!n) throw new Error(`no ${id}`);
      if (props(n).disabled) throw new Error(`disabled ${id}`);
      await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async type(id, value) {
      const n = byId(id);
      if (!n) throw new Error(`no ${id}`);
      await act(async () => { props(n).onChange({ target: { value, checked: value } }); });
      await settle();
    },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; delete globalThis.matchMedia; restore(); },
  };
}

/** A Worker for one fund: funds list, simulate, scenarios, delete, save. */
function worker({ fund = GP_FUND, lps = LPS, scenarios = [], portal, fail = {}, onSave } = {}) {
  const state = { scenarios: [...scenarios], fails: { ...fail } };
  const failing = (key) => { if (state.fails[key] > 0) { state.fails[key] -= 1; return true; } return false; };
  const answer = async ({ path, method, body }) => {
    if (path === '/api/funds') return failing('funds') ? json({ detail: 'database detail' }, 503) : json({ items: fund ? [fund] : [] });
    if (path === '/api/funds/lp-portal') return failing('portal') ? json({ detail: 'x' }, 503) : json(portal ?? { funds: {} });
    if (path === '/api/fund-sim/funds/42/waterfall/simulate') return failing('sim') ? json({ detail: 'x' }, 503) : json(engine(body, lps));
    if (path === '/api/fund-sim/funds/42/scenarios' && method === 'GET') return failing('scenarios') ? json({ detail: 'database detail' }, 503) : json({ items: state.scenarios });
    if (path === '/api/fund-sim/funds/42/scenarios' && method === 'POST') {
      if (onSave) { const r = onSave(body); if (r) return r; }
      const row = { ...body, uid: `new-${state.scenarios.length}`, fund_id: 42, created_by_user_id: 7, created_at: '2026-11-14T14:40:00Z' };
      state.scenarios.unshift(row);
      return json(row, 201);
    }
    if (path.startsWith('/api/fund-sim/scenarios/') && method === 'DELETE') {
      const uid = path.split('/').pop();
      state.scenarios = state.scenarios.filter((s) => s.uid !== uid);
      return new Response(null, { status: 204 });
    }
    return null;
  };
  return { answer, state };
}

/* ------------------------------------------------------------- the page */

test('populated: the fund’s terms, the presets, the split, the figures and the per-LP rows in the Portfolio frame', async () => {
  const w = worker();
  const m = await mount(w.answer);
  try {
    assert.equal(document.title, 'Exit Waterfall · Portfolio · Axal VC');
    assert.match(m.text(), /Account›Portfolio›Exit Waterfall/);
    assert.equal(m.text('waterfall-carry-source'), 'From the fund’s terms');
    assert.equal(m.props('input-waterfall-carry').value, '25');
    assert.match(m.text('waterfall-hurdle-source'), /Assumption · not recorded on the fund/);
    // Nothing typed yet: the page asks at $0 for the fund's totals and draws no split.
    assert.equal(m.sims().length, 1);
    assert.deepEqual(m.sims()[0].body, { exit_value: 0, carry_pct: 0.25, hurdle_rate: 0.08, years_held: 5, gp_catchup: true });
    assert.ok(m.has('waterfall-type-exit'));
    assert.ok(!m.has('waterfall-lp-rows'));
    assert.match(m.text('button-preset-2x'), /2× invested · \$8,000,000/);
    await m.click('button-preset-2x');
    assert.equal(m.sims().at(-1).body.exit_value, 8000000);
    assert.match(m.text('waterfall-result'), /Modelled split at \$8,000,000/);
    assert.match(m.text('waterfall-result'), /Model · provisional · not a distribution/);
    const expected = engine({ exit_value: 8000000, carry_pct: 0.25 }, LPS);
    assert.match(m.text('metric-to-lps'), new RegExp(`To LPs\\$${Math.round(expected.totals.to_lps).toLocaleString('en-US')}`));
    assert.match(m.text('metric-lp-multiple'), new RegExp(`${expected.totals.lp_moic.toFixed(2)}×`));
    assert.match(m.text('waterfall-source-line'), /from 2 LP rows.*Total distributed \$8,000,000 = exit value/);
    assert.match(m.text('waterfall-legend'), /Profit split · LP 75%/);
    assert.equal(m.all('waterfall-lp-row').length, 2);
    assert.match(m.text('waterfall-lp-rows'), /Alder Pension Plan.*Birchway Trust.*2 LPs/);
    assert.ok(m.has('button-waterfall-export') && m.has('button-waterfall-print'));
    assert.ok(!m.has('waterfall-tier-table'));
    await m.click('button-view-table');
    assert.match(m.text('waterfall-tier-table'), /Running total.*Total distributed/);
    assert.equal(m.props('button-view-table')['aria-checked'], true);
    // A typed value that is not a number says so and runs nothing.
    const before = m.sims().length;
    await m.type('input-waterfall-exit', 'lots');
    assert.equal(m.sims().length, before);
    assert.match(m.text(), /Type the exit value in US dollars/);
  } finally { await m.close(); }
});

test('nothing invested: the multiple and the annualised return read Not computable, never 0× or 0%', async () => {
  const w = worker({ lps: [{ name: 'Alder Pension Plan', commitment_amount: 1000000, invested_amount: 0 }] });
  const m = await mount(w.answer);
  try {
    assert.ok(!m.has('button-preset-1x'), 'no presets on nothing invested');
    await m.type('input-waterfall-exit', '1,000,000');
    assert.match(m.text('metric-lp-multiple'), /Not computable: nothing invested/);
    assert.match(m.text('metric-lp-return'), /Not computable: nothing invested/);
    assert.doesNotMatch(m.text('metric-lp-multiple'), /0\.00×/);
  } finally { await m.close(); }
});

test('no fund: says what is missing and asks nothing else', async () => {
  const m = await mount(worker({ fund: null }).answer);
  try {
    assert.match(m.text('waterfall-no-fund'), /No fund is visible to you yet/);
    assert.equal(m.sims().length, 0);
    assert.ok(!m.calls.some((c) => c.path.includes('/fund-sim/')));
    assert.ok(!m.has('waterfall-inputs'));
  } finally { await m.close(); }
});

test('Unreadable with Retry: the fund list, the scenarios and the model each fail on their own', async () => {
  const w = worker({ fail: { funds: 1, scenarios: 1 } });
  const m = await mount(w.answer);
  try {
    assert.match(m.text('status-waterfall-funds-unreadable'), /Your funds could not be read/);
    assert.ok(!m.has('waterfall-no-fund'), 'a failed read is not "no funds"');
    assert.doesNotMatch(m.text(), /database detail/);
    await m.click('button-retry-waterfall-funds');
    assert.ok(m.has('waterfall-inputs'));
    assert.match(m.text('status-waterfall-scenarios-unreadable'), /Scenarios could not be read/);
    assert.ok(!m.has('waterfall-no-scenarios'));
    await m.click('button-retry-waterfall-scenarios');
    assert.match(m.text('waterfall-no-scenarios'), /No scenarios saved for this fund/);
    await m.type('input-waterfall-exit', '10,000,000');
    assert.match(m.text('waterfall-result'), /\$10,000,000/);
    w.state.fails.sim = 1;
    await m.type('input-waterfall-exit', '12,000,000');
    assert.match(m.text('status-waterfall-model-unreadable'), /Not current · the model could not be run/);
    assert.equal(m.props('input-waterfall-exit').value, '12,000,000', 'the inputs are kept');
    assert.match(m.text('waterfall-result'), /Modelled split at \$10,000,000/, 'the last result stays, marked not current');
    assert.ok(!m.has('button-waterfall-save') || m.props('button-waterfall-save').disabled, 'a result that is not current cannot be saved');
    await m.click('button-retry-waterfall-model');
    assert.ok(!m.has('status-waterfall-model-unreadable'));
    assert.match(m.text('waterfall-result'), /Modelled split at \$12,000,000/);
  } finally { await m.close(); }
});

test('read-only investor: carry from their own record, no Save, no scenario list, no other LP’s row', async () => {
  const w = worker({ fund: LP_FUND, portal: { funds: { 42: { fund_id: 42, carried_interest: 0.15 } } } });
  const m = await mount(w.answer);
  try {
    assert.equal(m.text('waterfall-relation'), 'You are an LP of this fund');
    assert.match(m.text('waterfall-carry-source'), /From the fund’s terms · your LP record/);
    assert.equal(m.sims()[0].body.carry_pct, 0.15);
    assert.ok(!m.has('button-waterfall-save'));
    assert.match(m.text('waterfall-read-only'), /only the fund’s GP of record or an admin can save/);
    assert.ok(!m.calls.some((c) => c.path.endsWith('/scenarios')), 'an LP reads no scenario list');
    assert.ok(m.has('waterfall-no-scenario-list'));
    await m.type('input-waterfall-exit', '9,000,000');
    assert.match(m.text('waterfall-lp-not-recorded'), /Your row: not recorded/);
    assert.doesNotMatch(m.text(), /Alder Pension Plan|Birchway Trust/);
    assert.ok(!m.has('button-waterfall-export'));
  } finally { await m.close(); }
});

test('read-only investor whose record carries no carry: Not recorded, with 20% as a labelled assumption', async () => {
  const m = await mount(worker({ fund: LP_FUND, portal: { funds: {} } }).answer);
  try {
    assert.match(m.text('waterfall-carry-source'), /Not recorded · using 20% as an assumption/);
    assert.equal(m.sims()[0].body.carry_pct, 0.2);
  } finally { await m.close(); }
});

test('scenarios: save needs a name, load replaces the inputs, changes show, compare two, delete asks first', async () => {
  let refuse = false;
  const w = worker({
    scenarios: [saved('base', 'Base case', 10000000, 5), saved('up', 'Upside', 12000000, 6, 9)],
    onSave: () => (refuse ? json({ detail: 'Forbidden' }, 403) : null),
  });
  const m = await mount(w.answer);
  try {
    assert.match(m.text('waterfall-scenario-base'), /Base case.*Saved by another user/);
    // Load: the inputs become the saved ones.
    await m.click('button-load-base');
    assert.equal(m.props('input-waterfall-exit').value, '10,000,000');
    assert.match(m.text('waterfall-loaded'), /Loaded: Base case · saved 3 Nov 2026/);
    assert.equal(m.sims().at(-1).body.exit_value, 10000000);
    // Changed since loaded.
    await m.type('input-waterfall-exit', '11,000,000');
    assert.match(m.text('waterfall-changed'), /Changed since loaded · exit \$10,000,000 → \$11,000,000/);
    // Save: no name, nothing is sent.
    await m.click('button-save-as-new');
    assert.ok(m.has('waterfall-save'));
    await m.click('button-save-confirm');
    assert.equal(m.text('scenario-name-error'), 'Give the scenario a name.');
    assert.ok(!m.calls.some((c) => c.method === 'POST' && c.path.endsWith('/scenarios')));
    // A refusal keeps the sheet and the name.
    refuse = true;
    await m.type('input-scenario-name', 'Stretch');
    await m.click('button-save-confirm');
    assert.match(m.text('waterfall-save-error'), /Only the fund’s GP of record or an admin can save/);
    assert.equal(m.props('input-scenario-name').value, 'Stretch');
    refuse = false;
    await m.click('button-save-confirm');
    const post = m.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/scenarios')).at(-1);
    assert.equal(post.body.kind, 'waterfall');
    assert.equal(post.body.name, 'Stretch');
    assert.equal(post.body.inputs.exit_value, 11000000);
    assert.equal(post.body.result.exit_value, 11000000);
    assert.ok(!m.has('waterfall-save'));
    assert.equal(m.text('waterfall-toast'), 'Saved “Stretch”');
    assert.ok(m.has('waterfall-scenario-new-2'), 'the list is read again');
    // Compare two as saved.
    await m.click('button-compare-up');
    assert.ok(m.has('waterfall-compare'));
    const rows = m.all('waterfall-compare-row');
    assert.ok(rows.length >= 10);
    assert.match(m.text('waterfall-compare'), /Exit value · differs\$11,000,000\$12,000,000\+\$1,000,000/);
    assert.match(m.text('waterfall-compare'), /holding periods differ/);
    await m.click('button-compare-back');
    // Delete asks first; Cancel sends nothing.
    await m.click('button-delete-base');
    assert.match(m.text(), /Delete saved scenario\?/);
    await m.click('button-delete-cancel');
    assert.ok(!m.calls.some((c) => c.method === 'DELETE'));
    await m.click('button-delete-base');
    await m.click('button-delete-confirm');
    assert.deepEqual(m.calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/api/fund-sim/scenarios/base']);
    assert.ok(!m.has('waterfall-scenario-base'));
  } finally { await m.close(); }
});

test('phone width: the terms open in a sheet and the tables carry their labels for stacked rows', async () => {
  const m = await mount(worker().answer, { phone: true });
  try {
    assert.ok(m.has('button-waterfall-terms'));
    assert.ok(!m.has('input-waterfall-carry'), 'the terms are not inline on a phone');
    await m.type('input-waterfall-exit', '8,000,000');
    assert.ok(m.tds().length > 0 && m.tds().every((p) => typeof p['data-label'] === 'string'), 'every cell names its column');
    await m.click('button-waterfall-terms');
    assert.equal(m.props('input-waterfall-carry').value, '25');
    await m.type('input-waterfall-years', '7');
    assert.equal(m.sims().at(-1).body.years_held, 7);
    await m.click('button-terms-done');
    assert.ok(!m.has('input-waterfall-carry'));
  } finally { await m.close(); }
});

/* ------------------------------------------------------------- the model */

test('model: money parsing, input limits and the simulate body', () => {
  assert.equal(parseMoney('19,500,000'), 19500000);
  assert.equal(parseMoney('$2.5m'), 2500000);
  assert.equal(parseMoney('abc'), null);
  const ok = { ...startingInputs('20'), exit: '1,000' };
  assert.deepEqual(inputErrors(ok), {});
  assert.ok(inputErrors({ ...ok, carry: '51' }).carry);
  assert.ok(inputErrors({ ...ok, hurdle: '-1' }).hurdle);
  assert.ok(inputErrors({ ...ok, years: '21' }).years);
  assert.equal(bodyOf({ ...ok, years: '21' }), null);
  assert.deepEqual(bodyOf(ok), { exit_value: 1000, carry_pct: 0.2, hurdle_rate: 0.08, years_held: 5, gp_catchup: true });
  assert.deepEqual(presetsOf(0), []);
  assert.deepEqual(presetsOf(1000).map((p) => p.value), [1000, 2000, 3000]);
});

test('model: Not computable for each reason, and a measured zero stays zero', () => {
  const at = (exit, invested, years = 5) => engine({ exit_value: exit, years_held: years }, [], { committed: invested, invested });
  const zeroExit = figuresOf(at(0, 1000000));
  assert.equal(zeroExit[0].value, '$0');
  assert.equal(zeroExit[2].value, '0.00×', 'a computed zero multiple');
  assert.equal(zeroExit[3].value, 'Not computable: nothing returned to LPs');
  assert.equal(figuresOf(at(500, 0))[2].value, 'Not computable: nothing invested');
  assert.equal(figuresOf(at(2000000, 1000000, 0))[3].value, 'Not computable: no holding period');
  const flat = figuresOf(at(1000000, 1000000));
  assert.equal(flat[3].value, '0.00%', 'an annualised return of exactly 0 is a value');
  assert.equal(sourceLineOf(at(0, 1000000))[0], 'Committed $1,000,000 · invested $1,000,000 · from the fund’s committed and deployed figures');
  const tiers = tiersOf(engine({ exit_value: 3000000 }, LPS));
  assert.equal(tiers.at(-1).running, 3000000);
  assert.deepEqual(tiers.map((t) => t.kind), ['lp', 'lp2', 'gp', 'lp', 'gp']);
});

test('model: carry by relationship, scenarios, changes, compare, refusals and the CSV first line', () => {
  assert.equal(carryOf(GP_FUND, null).state, 'fund');
  assert.equal(carryOf({ ...GP_FUND, carried_interest: null }, null).state, 'not_recorded');
  assert.equal(carryOf(LP_FUND, null).state, 'loading');
  assert.equal(carryOf(LP_FUND, { state: 'unreadable' }).pct, '20');
  assert.equal(carryOf(LP_FUND, { state: 'ready', data: { funds: { 42: { carried_interest: 0.1 } } } }).pct, '10');
  assert.equal(scenarioOf(saved('a', 'A', 1, 5, 7), 7).by, 'Saved by you');
  assert.equal(scenarioOf(saved('a', 'A', 1, 5, 7), 8).by, 'Saved by another user · name not recorded');
  const b = bodyOf({ ...startingInputs('20'), exit: '100' });
  assert.deepEqual(changesSince(b, b), []);
  assert.deepEqual(changesSince(b, { ...b, years_held: 6, gp_catchup: false }), ['years held 5.0 → 6.0', 'catch-up on → off']);
  assert.equal(nameError('  '), 'Give the scenario a name.');
  assert.equal(nameError('x'.repeat(121)), '1 character over the 120 limit.');
  assert.equal(nameError('x'.repeat(120)), null);
  assert.match(refusalOf({ status: 402 }, 'save'), /institutional investor tier/);
  assert.match(refusalOf({ status: 403 }, 'delete'), /Only the person who saved it/);
  assert.equal(signedDollars(-300), '−$300');
  const cmp = compareOf(saved('a', 'A', 10000000, 5), saved('b', 'B', 10000000, 5));
  assert.ok(cmp.sections.flatMap((s) => s.rows).every((r) => !r.differs), 'identical scenarios differ nowhere');
  assert.equal(cmp.periodsDiffer, false);
  const cmp2 = compareOf(saved('a', 'A', 10000000, 5), saved('b', 'B', 10000000, 6));
  assert.deepEqual(cmp2.sections[0].rows.filter((r) => r.differs).map((r) => r.label), ['Years held · assumption']);
  const csv = lpsCsvOf({ fund: GP_FUND, body: b, result: engine({ exit_value: 100 }, LPS) });
  assert.deepEqual(csv.header, ['Model, not a distribution']);
  assert.equal(csv.rows.length, 3);
});
