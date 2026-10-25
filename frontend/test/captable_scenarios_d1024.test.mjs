// D1024 (#2861, part 9 of #2432) — Scenarios complete (CT6–CT9): the cards
// with Compare and New scenario, one scenario at /scenarios/<uid> (inputs,
// results, the exit waterfall, the read-backs), Duplicate, Rename and Delete
// in dialogs, and /scenarios/compare. Fixtures follow the Worker's shapes
// (routes/captable.ts, services/captable.ts, services/capTableToday.ts) and
// are worked out by hand: 12,000,000 shares after the Seed, so each payout is
// a whole fraction of the exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { isCyclePath } from '../src/pages/cycles/cyclePaths.js';
import {
  MODEL_LOCKED, READ_SOURCE, SAVED, attachRead, attachedRead, beforeAfter, compareExits, compareHref, compareIds,
  compareRows, conversionPoints, dialogCopy, engineNotes, exitPanels, founderPanels, nameError, newScenarioInputs,
  nextName, paymentReadBack, roundEvents, roundReadBack, runRequest, sameInputs, scenarioCard, scenarioHref,
  scenariosHead, short, shortName, todayBody, todayDraft, toggleCompare, waterfallTable, withNotes,
} from '../src/pages/raise/captable/scenariosModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// ─────────────────────────────────────────────────────────── fixtures

const START = {
  holders: [
    { name: 'Ada Founder', type: 'common', shares: 6000000 },
    { name: 'Ben Cofounder', type: 'common', shares: 2000000 },
    { name: 'Kai Engineer', type: 'options', shares: 300000 },
  ],
  pool_shares: 700000,
};
const RECORD_SAFES = [
  { name: 'Bluefern Capital', amount: 500000, cap: 10000000, basis: 'post_money' },
  { name: 'Northwind Angels', amount: 150000, cap: 8000000, discount: 0.2, basis: 'post_money' },
];
// Today: 9,000,000 shares on record.
const FOUNDING = [
  { holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 66.6667 },
  { holder: 'Ben Cofounder', type: 'founder', shares: 2000000, pct: 22.2222 },
  { holder: 'Kai Engineer', type: 'options', shares: 300000, pct: 3.3333 },
  { holder: 'Option pool', type: 'option_pool', shares: 700000, pct: 7.7778 },
];
const SEED_LEDGER = [
  { holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 46.1538 },
  { holder: 'Ben Cofounder', type: 'founder', shares: 2000000, pct: 15.3846 },
  { holder: 'Kai Engineer', type: 'options', shares: 300000, pct: 2.3077 },
  { holder: 'Option pool', type: 'option_pool', shares: 1000000, pct: 7.6923 },
  { holder: 'Bluefern Capital', type: 'safe', shares: 600000, pct: 4.6154 },
  { holder: 'Northwind Angels', type: 'safe', shares: 300000, pct: 2.3077 },
  { holder: 'Seed Investors', type: 'preferred', shares: 2800000, pct: 21.5385 },
];
const row = (holder, type, shares, payout, source, preference = 0) => ({ holder, type, shares, pct: 0, preference, payout, source });
// At $5M every investor takes its 1× preference ($3.65M); common shares the rest.
const WF_5M = {
  exit_value: 5000000,
  rows: [
    row('Seed Investors', 'preferred', 2800000, 3000000, '1x non-participating preference', 3000000),
    row('Bluefern Capital', 'safe', 600000, 500000, '1x non-participating preference', 500000),
    row('Northwind Angels', 'safe', 300000, 150000, '1x non-participating preference', 150000),
    row('Ada Founder', 'founder', 6000000, 975903.61, 'pro-rata (common)'),
    row('Ben Cofounder', 'founder', 2000000, 325301.2, 'pro-rata (common)'),
    row('Kai Engineer', 'options', 300000, 48795.19, 'pro-rata (common)'),
  ],
  totals: { preference_paid: 3650000, common_pool: 1350000, total_distributed: 5000000 },
};
// At $100M everyone converts: 12,000,000 shares, so each takes shares ÷ 12M of the exit.
const WF_100M = {
  exit_value: 100000000,
  rows: [
    row('Ada Founder', 'founder', 6000000, 50000000, 'pro-rata (common)'),
    row('Seed Investors', 'preferred', 2800000, 23333333.33, 'pro-rata (converted preferred)', 3000000),
    row('Ben Cofounder', 'founder', 2000000, 16666666.67, 'pro-rata (common)'),
    row('Bluefern Capital', 'safe', 600000, 5000000, 'pro-rata (converted preferred)', 500000),
    row('Kai Engineer', 'options', 300000, 2500000, 'pro-rata (common)'),
    row('Northwind Angels', 'safe', 300000, 2500000, 'pro-rata (converted preferred)', 150000),
  ],
  totals: { preference_paid: 0, common_pool: 100000000, total_distributed: 100000000 },
};
const SEED = {
  name: 'Seed', pre_money: 12000000, post_money: 15000000, investment: 3000000, price_per_share: 1.0714,
  shares_pre: 9200000, shares_post: 13000000, ledger: SEED_LEDGER, events: [],
  conversions: [
    { name: 'Bluefern Capital', instrument: 'safe', basis: 'post_money', binding: 'cap', shares: 600000, price_per_share: 0.8333 },
    { name: 'Northwind Angels', instrument: 'safe', basis: 'post_money', binding: 'discount', shares: 300000, price_per_share: 0.5 },
  ],
  post_money_check: { fraction: 0.06875, pct: 6.88, over_100: false },
  top_up: { shares: 300000, payer: 'pre_money' },
};
const RESULT = {
  founding: FOUNDING, rounds: [SEED], waterfall: WF_5M,
  waterfalls: [{ exit_value: 5000000, waterfall: WF_5M }, { exit_value: 100000000, waterfall: WF_100M }],
  warnings: [], post_money_check: { pct: 6.88, over_100: false }, outstanding_instruments: [], over_100: false,
};
const TODAY_INPUTS = { start: START, safes: RECORD_SAFES };
const TODAY = {
  project_id: 3, currency: 'USD',
  today: { available: true, reason: null, source: 'record', inputs: TODAY_INPUTS, result: { founding: FOUNDING, rounds: [], warnings: [] }, not_modelled: [{ name: 'Angel Note', reason: 'basis_not_recorded', sentence: 'Its basis is not recorded.' }] },
  model: null, offer: null,
  assumptions: ['1× non-participating preferred.', 'The unallocated pool takes no proceeds.'],
};
const CANONICAL = {
  uid: 'm1', name: 'My model', is_variant: 0, updated_at: '2026-10-12T08:00:00Z',
  inputs: { founders: [{ name: 'Ada Founder', shares: 6000000 }], option_pool_pct: 10, safes: [], rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000, post_round_pool_pct: 12 }], exit_value: 100000000 },
  result: { founding: [{ holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 90 }], rounds: [{ ...SEED, name: 'Seed', ledger: [{ holder: 'Ada Founder', type: 'founder', shares: 6000000, pct: 70 }] }] },
};
const S_TODAY = {
  uid: 's-today', name: 'Seed · base case', is_variant: 1, project_id: 3, updated_at: '2026-10-22T08:00:00Z',
  inputs: { ...TODAY_INPUTS, rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000, post_round_pool_pct: 12, top_up_payer: 'pre_money' }], exit_values: [5000000, 100000000] },
  result: RESULT,
};
const S_MODEL = {
  uid: 's-model', name: 'Typed bridge', is_variant: 1, project_id: 3, updated_at: '2026-10-20T08:00:00Z',
  inputs: { founders: [{ name: 'Ada Founder', shares: 4000000 }, { name: 'Grace', shares: 4000000 }], option_pool_pct: 10, safes: [], rounds: [{ name: 'Bridge', pre_money: 6000000, investment: 1000000 }], exit_value: 30000000 },
  result: { founding: [{ holder: 'Ada Founder', type: 'founder', shares: 4000000, pct: 45 }, { holder: 'Grace', type: 'founder', shares: 4000000, pct: 45 }], rounds: [] },
};
const COMPARE = { canonical: CANONICAL, variants: [S_TODAY, S_MODEL] };
const MODEL_RESULT = {
  founding: S_MODEL.result.founding,
  rounds: [{ ...SEED, name: 'Bridge', pre_money: 6000000, post_money: 7000000, investment: 1000000, conversions: [], top_up: null, ledger: [
    { holder: 'Ada Founder', type: 'founder', shares: 4000000, pct: 38.57 }, { holder: 'Grace', type: 'founder', shares: 4000000, pct: 38.57 },
    { holder: 'Option pool', type: 'option_pool', shares: 888889, pct: 8.57 }, { holder: 'Bridge Investors', type: 'preferred', shares: 1481481, pct: 14.29 },
  ] }],
  waterfalls: [{ exit_value: 5000000, waterfall: null }, { exit_value: 30000000, waterfall: { exit_value: 30000000, rows: [row('Ada Founder', 'founder', 4000000, 12000000, 'pro-rata (common)'), row('Grace', 'founder', 4000000, 12000000, 'pro-rata (common)'), row('Bridge Investors', 'preferred', 1481481, 6000000, 'pro-rata (converted preferred)', 1000000)], totals: { total_distributed: 30000000 } } }, { exit_value: 100000000, waterfall: null }],
  warnings: ['Exit not calculated at $5M for this fixture.'],
};
const GRANTS = { grants: [], can_change: true, levels: [] };
const OWNER = { id: 2, role: 'founder', subscription_tier: 'studio', name: 'Ada Founder' };
const FREE = { id: 4, role: 'founder', subscription_tier: 'free', name: 'Free Founder' };

function handlerFor(o = {}) {
  const at = { compare: COMPARE, today: TODAY, grants: GRANTS, ...o };
  const send = (body) => (body instanceof Error ? response({ detail: body.message }, body.status || 500) : response(body));
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.includes('/captable/scenarios/by-project/3/compare')) return send(at.compare);
    if (url.includes('/captable/scenarios/by-project/3/today')) return send(at.today);
    if (url.includes('/captable/scenarios/by-project/3/simulate')) return o.simulate ? o.simulate(url, options) : response({ source: 'record', inputs: { ...TODAY_INPUTS, ...JSON.parse(options.body || '{}') }, result: RESULT, not_modelled: TODAY.today.not_modelled });
    if (url.includes('/captable/scenarios/by-project/3/variants')) return o.created ? o.created(url, options) : response({ uid: 'made-1' });
    if (/\/captable\/simulate$/.test(url)) return response(MODEL_RESULT);
    const one = /\/captable\/scenarios\/([^/?]+)$/.exec(url);
    if (one) {
      if (method === 'GET') {
        const s = { 's-today': S_TODAY, 's-model': S_MODEL, m1: CANONICAL }[one[1]];
        return o.scenario ? send(o.scenario(one[1])) : s ? response(s) : response({ detail: 'Scenario not found' }, 404);
      }
      if (o.write) return o.write(url, options);
      return response(method === 'DELETE' ? { ok: true } : { ...S_TODAY, ...JSON.parse(options.body || '{}') });
    }
    if (url.includes('/captable/access/3/grants')) return send(at.grants);
    if (url.includes('/cycles/raise/modules/')) return response({ module: { slug: 'cap-table' }, records: [] });
    if (url.includes('/auth/me')) return response(o.user || OWNER);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(o.user || OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const where = { path: url };
  function Spy() { const l = useLocation(); where.path = `${l.pathname}${l.search}`; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Spy), h(Routes, null,
    h(Route, { path: '/raise/cap-table/scenarios/:scenario', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableScenario: true }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const one = (id) => all(id)[0];
  const labelled = (label) => nodes().find((n) => props(n)['aria-label'] === label);
  return {
    requests, flush, by: one, all, props, labelled, where,
    marked: (name) => nodes().filter((n) => props(n)[name]),
    text: (...a) => { const n = a.length ? a[0] : container; assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' '); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(node, value) { assert.ok(node, 'no such node'); await act(async () => { props(node).onChange?.({ target: { value } }); }); await flush(); },
    sent: (re, method) => requests.filter(([u, m]) => re.test(u) && (method ? m === method : m !== 'GET')).map(([u, m, b]) => [u, m, b ? JSON.parse(b) : null]),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ─────────────────────────────────────────────────────────── the model

test('the addresses: a scenario, the compare page with up to three, and both as cycle paths', () => {
  assert.equal(scenarioHref('s-today', '?project_id=3&x=1'), '/raise/cap-table/scenarios/s-today?project_id=3');
  assert.equal(compareHref(['a', 'b', 'c', 'd'], '?project_id=3'), '/raise/cap-table/scenarios/compare?project_id=3&ids=a%2Cb%2Cc');
  assert.deepEqual(compareIds('?ids=a,b,a,../x,c,d'), ['a', 'b', 'c'], 'distinct, safe, at most three');
  assert.ok(isCyclePath('/raise/cap-table/scenarios/s-today'), 'a scenario draws the cycle gutter');
  assert.ok(isCyclePath('/raise/cap-table/scenarios/compare'));
  assert.ok(!isCyclePath('/raise/cap-table/scenarios/s-today/more'), 'one segment only');
  assert.ok(!isCyclePath('/raise/use-of-funds/scenarios/x'), 'only Cap table has scenarios');
  assert.ok(!isCyclePath('/raise/cap-table/proposal/x'), 'the proposal route is unchanged');
});

test('the cards say where each scenario starts; Compare takes up to three; New scenario starts from Today', () => {
  assert.equal(scenarioCard(S_TODAY).start, 'Starts from Today');
  assert.equal(scenarioCard(S_MODEL).start, 'Starts from your model');
  assert.equal(scenarioCard(CANONICAL, { model: true }).name, 'Cap table · model');
  assert.deepEqual(toggleCompare(['a', 'b', 'c'], 'd'), ['a', 'b', 'c'], 'a fourth is not taken');
  assert.deepEqual(toggleCompare(['a', 'b'], 'a'), ['b']);
  assert.equal(nextName(COMPARE), 'Scenario 3');
  assert.equal(scenariosHead(COMPARE, TODAY), '2 scenarios · each new one starts from Today');
  assert.match(scenariosHead(COMPARE, { today: { available: false } }), /nothing is recorded yet/);
  const made = newScenarioInputs(TODAY, CANONICAL);
  assert.equal(made.from, 'today');
  assert.deepEqual(made.inputs.start, START, 'the record’s holders');
  assert.deepEqual(made.inputs.safes, RECORD_SAFES);
  assert.deepEqual(made.inputs.rounds, CANONICAL.inputs.rounds, 'the model’s round, to change');
  assert.deepEqual(made.inputs.exit_values, [100000000]);
  assert.equal(newScenarioInputs({ today: { available: false } }, CANONICAL).from, 'model');
  assert.equal(newScenarioInputs({ today: { available: false } }, null), null, 'neither: nothing to start from');
  for (const kind of ['new', 'duplicate', 'rename', 'attach']) assert.ok(dialogCopy(kind, S_TODAY, { from: 'today' }).lines.some((l) => /main cap table does not change/.test(l)), kind);
  assert.match(dialogCopy('delete', S_TODAY).lines.join(' '), /cannot be undone[\s\S]*record and the main cap table do not change/);
  assert.equal(nameError('  '), 'A scenario needs a name.');
  assert.equal(nameError('x'.repeat(201)), 'A name is at most 200 characters.');
});

test('a Today draft: rounds, who pays for the top-up, the instruments that convert and up to four exits; a blank is never zero', () => {
  const d = todayDraft(S_TODAY);
  assert.equal(d.kind, 'today');
  assert.deepEqual(d.rounds, [{ name: 'Seed', pre_money: '12000000', investment: '3000000', pool: '12', payer: 'pre_money' }]);
  assert.deepEqual(d.exits, ['5000000', '100000000']);
  const out = todayBody({ ...d, holdOut: ['Northwind Angels'] }, RECORD_SAFES);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.body, {
    rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000, post_round_pool_pct: 12, top_up_payer: 'pre_money' }],
    exit_values: [5000000, 100000000],
    converting: ['Bluefern Capital'],
  });
  const noPool = todayBody({ ...d, rounds: [{ ...d.rounds[0], pool: '', payer: 'post_money' }] }, RECORD_SAFES).body.rounds[0];
  assert.ok(!('post_round_pool_pct' in noPool) && !('top_up_payer' in noPool), 'no pool target: nothing tops up, and no payer is sent');
  assert.equal(todayBody({ ...d, rounds: [{ ...d.rounds[0], payer: 'post_money' }] }, RECORD_SAFES).body.rounds[0].top_up_payer, 'post_money');
  assert.deepEqual(todayBody({ ...d, rounds: [{ ...d.rounds[0], pre_money: '' }] }, RECORD_SAFES).errors, ['Seed pre-money is missing.']);
  assert.deepEqual(todayBody({ ...d, rounds: [{ ...d.rounds[0], investment: 'lots' }] }, RECORD_SAFES).errors, ['Seed amount raised is not a number.']);
  assert.deepEqual(todayBody({ ...d, rounds: [{ ...d.rounds[0], pool: '100' }] }, RECORD_SAFES).errors, ['Seed pool target must be under 100%.']);
  assert.deepEqual(todayBody({ ...d, exits: ['-1'] }, RECORD_SAFES).errors, ['Exit value 1 cannot be negative.']);
  assert.deepEqual(todayBody({ ...d, exits: ['1', '2', '3', '4', '5'] }, RECORD_SAFES).errors, ['Up to 4 exit values.']);
  assert.equal(todayBody({ ...d, exits: ['$1,000,000'] }, RECORD_SAFES).body.exit_values[0], 1000000);
});

test('before and after by group and founder, with the change in points; a group nobody holds is left out', () => {
  const rows = beforeAfter(RESULT);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual(rows.map((r) => r.label), ['Founders', 'Ada Founder', 'Ben Cofounder', 'Investors', 'Employees and advisors', 'Pool unallocated', 'Price per share', 'Post-money']);
  assert.deepEqual([by.Founders.before, by.Founders.after, by.Founders.change], ['88.89%', '61.54%', '−27.35']);
  assert.deepEqual([by.Investors.before, by.Investors.after, by.Investors.change], ['—', '28.46%', '—'], 'nobody invested before the round: a dash, never 0%');
  assert.equal(by['Pool unallocated'].change, '−0.09');
  assert.equal(by['Price per share'].after, '$1.0714');
  assert.equal(by['Post-money'].after, '$15,000,000');
  assert.equal(by['Post-money'].before, 'No round modelled');
  const none = beforeAfter({ founding: FOUNDING.slice(0, 2), rounds: [] });
  assert.ok(!none.some((r) => r.label === 'Investors'), 'no investor on either side');
  assert.equal(none[0].after, 'Not recorded', 'no round: nothing after it');
});

test('what happens in the round, and what the engine could not do', () => {
  const [seed] = roundEvents(RESULT);
  assert.equal(seed.round, 'Seed');
  assert.deepEqual(seed.lines, [
    'Option pool topped up by 300,000 shares, paid by the holders before the round',
    'SAFE Bluefern Capital converts at the cap: 600,000 shares at $0.8333',
    'SAFE Northwind Angels converts at the discount: 300,000 shares at $0.5000',
    'New money: 2,800,000 Seed preferred at $1.0714 for $3,000,000',
  ]);
  assert.match(roundEvents({ ...RESULT, rounds: [{ ...SEED, top_up: { shares: 300000, payer: 'post_money' } }] })[0].lines[0], /paid by everyone, the new investors included/);
  const notes = engineNotes({ over_100: true, post_money_check: { pct: 104.5 }, warnings: ['W'], outstanding_instruments: ['Northwind Angels'] });
  assert.deepEqual(notes, ['Post-money caps promise 104.5% of the company. These terms cannot all be honoured, so no exit is calculated.', 'W', 'Northwind Angels stays outstanding: it is set not to convert.']);
});

test('the exit waterfall (CT9): who takes the preference or converts, payouts that add up, and the unallocated pool', () => {
  const low = waterfallTable(WF_5M, SEED_LEDGER);
  assert.deepEqual(low.rows[0], { holder: 'Seed Investors', group: 'Investors', preference: '1× · $3,000,000', takes: 'Takes the preference', payout: '$3,000,000' });
  assert.deepEqual(low.rows[5], { holder: 'Kai Engineer', group: 'Employees and advisors', preference: 'None · options', takes: 'Exercise and take common', payout: '$48,795.19' });
  assert.deepEqual(low.rows[6], { holder: 'Unallocated pool', group: 'Pool', preference: '—', takes: 'Takes no proceeds', payout: '—' });
  assert.equal(low.foot, 'Payouts add up to the $5,000,000 exit.');
  const high = waterfallTable(WF_100M, SEED_LEDGER);
  assert.equal(high.rows[1].takes, 'Converts');
  assert.equal(high.rows[0].preference, 'None · common');
  assert.equal(waterfallTable({ ...WF_100M, totals: { total_distributed: 99000000 } }, []).foot, 'Payouts add up to $99,000,000 of the $100,000,000 exit.');
  assert.equal(waterfallTable(null, SEED_LEDGER), null, 'not calculated is not an empty table');
});

test('the conversion points are the engine’s own test, and the order of payment reads them back', () => {
  const { paidInFull, points } = conversionPoints(WF_100M);
  assert.equal(paidInFull, 3650000);
  // preference × 12,000,000 ÷ shares: Northwind $6M, Bluefern $10M, Seed $12.86M.
  assert.deepEqual(points.map((p) => [p.holder, Math.round(p.at)]), [['Northwind Angels', 6000000], ['Bluefern Capital', 10000000], ['Seed Investors', 12857143]]);
  const pay = paymentReadBack(WF_100M);
  assert.equal(pay.kind, 'payment');
  assert.deepEqual(pay.steps, [
    'First, each investor may take back what it put in: $3,650,000 in all, 1× and non-participating.',
    'Above $6M, Northwind Angels does better converting to common. Above $12.86M, every investor does.',
    'At a $100,000,000 exit everyone converts, so the exit is shared by ownership, leaving out the unallocated pool.',
    'Nothing records a seniority order between the investors. Above $12.86M it does not matter; below it, check the charter.',
  ]);
  assert.match(paymentReadBack(WF_5M).steps[2], /Seed Investors, Bluefern Capital, Northwind Angels take the preference; the rest is shared by ownership/);
  const preRound = { exit_value: 2000000, rows: [{ holder: 'Bluefern Capital', type: 'safe', shares: 0, preference: 500000, payout: 500000, source: 'purchase amount (SAFE liquidity)' }, row('Northwind Angels', 'safe', 300000, 72000, 'as-converted (SAFE liquidity)', 150000), row('Ada Founder', 'founder', 6000000, 1500000, 'pro-rata (common)')], totals: { total_distributed: 2000000 } };
  assert.deepEqual(conversionPoints(preRound).points, [], 'before a round a SAFE chooses cash back; no conversion point is drawn');
  assert.match(paymentReadBack(preRound).steps.join(' '), /Bluefern Capital takes cash back: \$500,000 in all/);
  assert.equal(short(12857142.86), '$12.86M');
  assert.equal(short(950000), '$950K');
});

test('the round read back, every step from the engine’s numbers', () => {
  const r = roundReadBack(RESULT);
  assert.deepEqual(r.steps, [
    'Price: $1.0714 a share, the pre-money of $12,000,000 spread over the 9,200,000 shares before the round.',
    'New money: $3,000,000 at $1.0714 buys 2,800,000 new Seed preferred.',
    'The pool tops up by 300,000 shares to reach 7.69% after the round. The top-up sits in the pre-money, so the holders before the round carry it.',
    'The 2 instruments convert: Bluefern Capital at the cap, 600,000 shares; Northwind Angels at the discount, 300,000 shares.',
    'Founders go from 88.89% before the round to 61.54% after it.',
  ]);
  assert.match(roundReadBack({ ...RESULT, rounds: [{ ...SEED, top_up: { shares: 300000, payer: 'post_money' } }] }).steps[2], /sits in the post-money, so everyone carries it/);
  assert.equal(roundReadBack({ founding: FOUNDING, rounds: [] }), null, 'no round, nothing to read back');
  assert.match(READ_SOURCE, /engine’s numbers/, 'the band says who wrote it');
});

test('compare: Today then each scenario, run at the same exits; a run that failed says so in its column', () => {
  assert.deepEqual(compareExits([S_TODAY, S_MODEL]), [5000000, 30000000, 100000000]);
  const cols = [
    { name: 'Seed · base case', short: 'base case', fromToday: true, result: RESULT, status: 'ready' },
    { name: 'Typed bridge', short: 'Typed bridge', fromToday: false, result: MODEL_RESULT, status: 'ready' },
    { name: 'Broken', short: 'Broken', fromToday: true, result: null, status: 'error' },
  ];
  const rows = compareRows({ founding: FOUNDING }, cols);
  const by = Object.fromEntries(rows.map((r) => [r.label, r.cells]));
  assert.deepEqual(by.Founders, ['88.89%', '61.54%', '77.14%', 'Could not be read']);
  assert.deepEqual(by.Grace, ['Not in this scenario', 'Not in this scenario', '38.57%', 'Could not be read']);
  assert.deepEqual(by['Price per share'].slice(0, 2), ['Not read here yet', '$1.0714']);
  assert.deepEqual(by['Bluefern Capital · shares'].slice(0, 3), ['Not converted', '600,000', 'Not converted']);
  const panels = founderPanels(cols);
  assert.equal(panels.length, 2, 'a failed run draws no panel');
  assert.deepEqual(panels[0].labels, ['Today', 'Seed']);
  assert.equal(panels[0].onRecord, true);
  assert.deepEqual(panels[0].series[0], { label: 'Ada Founder', tone: 'violet', values: [66.67, 46.15] });
  assert.deepEqual(panels[1].labels, ['Start', 'Bridge'], 'a typed model’s start is not Today');
  assert.equal(panels[1].onRecord, false);
  const exits = exitPanels(cols, [5000000, 30000000]);
  assert.equal(exits[0].rows[1].open, true, 'not calculated: a dashed outline, never a zero bar');
  assert.equal(exits[0].rows[1].text, 'Not recorded');
  assert.equal(exits[0].rows[2].open, true);
  assert.deepEqual(exits[0].rows[0].by, { founders: 1301204.81, investors: 3650000, people: 48795.19 });
  assert.equal(exits[0].rows[0].text, 'F $1.3M');
  assert.equal(shortName('Seed · bigger round'), 'bigger round');
});

test('a read attached to a scenario rides with its inputs until they change', () => {
  const read = roundReadBack(RESULT);
  const withRead = attachRead(S_TODAY.inputs, read, '2026-10-25T10:00:00Z');
  assert.deepEqual(attachedRead(withRead, 'round'), { kind: 'round', title: 'Read the round back', steps: read.steps, attached_at: '2026-10-25T10:00:00Z' });
  assert.equal(attachRead(withRead, read).notes.length, 1, 'one per kind');
  assert.ok(sameInputs(withRead, S_TODAY.inputs), 'notes do not change what is computed');
  assert.deepEqual(withNotes(S_TODAY.inputs, withRead, { keep: true }).notes, withRead.notes);
  assert.ok(!('notes' in withNotes(S_TODAY.inputs, withRead, { keep: false })), 'changed inputs take the read off');
  const today = runRequest(S_TODAY);
  assert.deepEqual(today, { kind: 'today', body: { rounds: S_TODAY.inputs.rounds, exit_values: [5000000, 100000000], converting: ['Bluefern Capital', 'Northwind Angels'] } });
  const model = runRequest({ ...S_MODEL, inputs: { ...S_MODEL.inputs, notes: [read] } }, [5000000]);
  assert.equal(model.kind, 'model');
  assert.deepEqual(model.inputs.exit_values, [5000000]);
  assert.ok(!('notes' in model.inputs) && !('exit_value' in model.inputs), 'the engine gets inputs only');
});

// ─────────────────────────────────────────────────────────── mounted

test('Scenarios lists each scenario as a card that opens its page; ticking up to three opens Compare', async () => {
  const v = await mounted('/raise/cap-table/scenarios?project_id=3');
  try {
    assert.equal(v.all('captable-scenario-card').length, 3);
    assert.match(v.text(), /2 scenarios · each new one starts from Today/);
    const hrefs = v.hrefs();
    for (const uid of ['s-today', 's-model', 'm1']) assert.ok(hrefs.includes(`/raise/cap-table/scenarios/${uid}?project_id=3`), uid);
    assert.match(v.text(v.all('captable-scenario-card')[1]), /Starts from Today/);
    assert.ok(!v.ids().includes('captable-scenario-compare'), 'nothing ticked yet');
    const picks = v.all('captable-scenario-pick');
    await v.change(picks[1], true);
    await v.change(picks[2], true);
    assert.ok(v.hrefs().includes('/raise/cap-table/scenarios/compare?project_id=3&ids=s-today%2Cs-model'));
    assert.match(v.text(v.by('captable-scenario-compare')), /Compare selected \( ?2 ?\)/);
  } finally { await v.close(); }
});

test('New scenario opens a dialog that says it starts from Today, and creates it from the record', async () => {
  const v = await mounted('/raise/cap-table/scenarios?project_id=3');
  try {
    await v.press(v.by('captable-scenario-new'));
    const dialog = v.by('captable-scenario-new-dialog');
    assert.match(v.text(dialog), /It starts from Today: the holders and instruments on record now/);
    assert.match(v.text(dialog), /main cap table does not change/);
    assert.equal(v.props(v.by('captable-scenario-new-dialog-name')).value, 'Scenario 3');
    await v.press(v.by('captable-scenario-new-dialog-go'));
    const [[, , body]] = v.sent(/\/by-project\/3\/variants$/, 'POST');
    assert.equal(body.name, 'Scenario 3');
    assert.deepEqual(body.inputs.start, START);
    assert.deepEqual(body.inputs.rounds, CANONICAL.inputs.rounds);
    assert.equal(v.where.path, '/raise/cap-table/scenarios/made-1?project_id=3');
  } finally { await v.close(); }
});

test('a scenario from Today: its inputs re-run from the record, results Modelled beside Today, the waterfall and Save in place', async () => {
  const v = await mounted('/raise/cap-table/scenarios/s-today?project_id=3');
  try {
    const ids = v.ids();
    assert.ok(ids.includes('captable-scenario-page') && ids.includes('captable-tabs'));
    assert.equal(v.props(v.by('captable-tab-scenarios'))['aria-current'], 'page', 'under the Scenarios tab');
    const [[, , first]] = v.sent(/\/by-project\/3\/simulate$/, 'POST');
    assert.deepEqual(first, { rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000, post_round_pool_pct: 12, top_up_payer: 'pre_money' }], exit_values: [5000000, 100000000], converting: ['Bluefern Capital', 'Northwind Angels'] });
    assert.match(v.text(v.by('captable-scenario-results')), /Today is on record\. Everything after the round is Modelled\./);
    assert.ok(v.all('tag-on-record').length >= 1 && v.all('tag-modelled').length >= 1);
    assert.match(v.text(v.by('captable-scenario-results-table')), /Founders 88\.89% 61\.54% −27\.35/);
    assert.equal(v.all('captable-scenario-event').length, 4);
    assert.match(v.text(v.by('captable-scenario-notes')), /Angel Note: Its basis is not recorded\./, 'what the record does not hold is said, not guessed');
    assert.match(v.text(v.by('captable-waterfall')), /Exit waterfall · \$5,000,000 exit/);
    assert.equal(v.all('captable-waterfall-row').length, 7);
    assert.match(v.text(v.by('captable-waterfall')), /Payouts add up to the \$5,000,000 exit\. Assumptions: 1× non-participating preferred\./);
    await v.change(v.by('captable-waterfall-exit'), '1');
    assert.match(v.text(v.by('captable-waterfall')), /\$100,000,000 exit/);
    assert.match(v.text(v.by('captable-ead-payment')), /Above \$12\.86M, every investor does\./);
    // The step chart and its Table toggle.
    assert.ok(v.ids().includes('captable-steps-chart'));
    await v.press(v.by('captable-steps-as-table'));
    assert.match(v.text(v.by('captable-steps-table')), /\$5,000,000 26\.02% 73\.00% 0\.98% \$100,000,000 66\.67% 30\.83% 2\.50%/);
    // Change the pool target: the scenario re-runs from the record.
    await v.change(v.labelled('Round 1 Pool target, % after the round'), '15');
    const runs = v.sent(/\/by-project\/3\/simulate$/, 'POST');
    assert.equal(runs[runs.length - 1][2].rounds[0].post_round_pool_pct, 15);
    // Hold an instrument out.
    await v.change(v.all('captable-scenario-converts')[1], false);
    const held = v.sent(/\/by-project\/3\/simulate$/, 'POST');
    assert.deepEqual(held[held.length - 1][2].converting, ['Bluefern Capital']);
    await v.press(v.by('captable-scenario-save'));
    const [[url, method, body]] = v.sent(/\/captable\/scenarios\/s-today$/, 'PUT');
    assert.equal(method, 'PUT');
    assert.ok(url.endsWith('/captable/scenarios/s-today'));
    assert.equal(body.name, 'Seed · base case');
    assert.deepEqual(body.inputs.start, START, 'the run’s inputs, from the record');
    assert.equal(body.inputs.rounds[0].post_round_pool_pct, 15);
    assert.ok(v.text(v.by('captable-scenario-saved')).includes(SAVED));
  } finally { await v.close(); }
});

test('a draft that is not a number stops the run in a sentence, never sends a zero', async () => {
  const v = await mounted('/raise/cap-table/scenarios/s-today?project_id=3');
  try {
    const before = v.sent(/\/by-project\/3\/simulate$/, 'POST').length;
    await v.change(v.labelled('Round 1 Pre-money'), 'twelve');
    assert.match(v.text(v.by('captable-scenario-run-errors')), /Seed pre-money is not a number\./);
    assert.equal(v.sent(/\/by-project\/3\/simulate$/, 'POST').length, before, 'nothing is run');
  } finally { await v.close(); }
  const refused = await mounted('/raise/cap-table/scenarios/s-today?project_id=3', { simulate: () => response({ detail: { code: 'unknown_instrument', message: 'One of the instruments named to convert is not on the record.' } }, 400) });
  try {
    assert.match(refused.text(refused.by('captable-scenario-run-errors')), /not on the record/);
    assert.ok(!refused.ids().includes('captable-waterfall'), 'no waterfall from a refused run');
  } finally { await refused.close(); }
});

test('Duplicate, Rename and Delete each open a dialog; a refusal stays in it', async () => {
  const v = await mounted('/raise/cap-table/scenarios/s-today?project_id=3');
  try {
    await v.press(v.by('captable-scenario-rename'));
    assert.match(v.text(v.by('captable-scenario-rename-dialog')), /Only the name changes/);
    await v.change(v.by('captable-scenario-rename-dialog-name'), 'Seed · final');
    await v.press(v.by('captable-scenario-rename-dialog-go'));
    const [[, , renamed]] = v.sent(/\/captable\/scenarios\/s-today$/, 'PUT');
    assert.equal(renamed.name, 'Seed · final');
    assert.deepEqual(renamed.inputs, S_TODAY.inputs, 'only the name changes');
    await v.press(v.by('captable-scenario-duplicate'));
    assert.equal(v.props(v.by('captable-scenario-duplicate-dialog-name')).value, 'Seed · base case · copy');
    await v.press(v.by('captable-scenario-duplicate-dialog-go'));
    const [[, , copy]] = v.sent(/\/by-project\/3\/variants$/, 'POST');
    assert.deepEqual(copy.inputs, S_TODAY.inputs);
    assert.equal(v.where.path, '/raise/cap-table/scenarios/made-1?project_id=3');
  } finally { await v.close(); }
  const d = await mounted('/raise/cap-table/scenarios/s-today?project_id=3');
  try {
    await d.press(d.by('captable-scenario-delete'));
    assert.match(d.text(d.by('captable-scenario-delete-dialog')), /This cannot be undone/);
    await d.press(d.by('captable-scenario-delete-dialog-go'));
    assert.equal(d.sent(/\/captable\/scenarios\/s-today$/, 'DELETE').length, 1);
    assert.equal(d.where.path, '/raise/cap-table/scenarios?project_id=3');
  } finally { await d.close(); }
  const r = await mounted('/raise/cap-table/scenarios/s-today?project_id=3', { write: () => response({ detail: 'You can read this cap table, but not change it.' }, 403) });
  try {
    await r.press(r.by('captable-scenario-delete'));
    await r.press(r.by('captable-scenario-delete-dialog-go'));
    assert.ok(r.ids().includes('captable-scenario-delete-dialog'), 'the dialog stays');
    assert.match(r.text(r.by('captable-scenario-delete-dialog-refusal')), /not change it/);
    assert.equal(r.where.path, '/raise/cap-table/scenarios/s-today?project_id=3');
  } finally { await r.close(); }
});

test('the read-backs: Attach opens a dialog and saves the read with the scenario; Discard writes nothing', async () => {
  const v = await mounted('/raise/cap-table/scenarios/s-today?project_id=3');
  try {
    const band = v.by('captable-ead-round');
    assert.equal(v.all('captable-ead-round-step').length, 5);
    assert.match(v.text(band), /Read back from the engine’s numbers/);
    await v.press(v.by('captable-ead-round-discard'));
    assert.ok(v.ids().includes('captable-ead-round-discarded'));
    assert.equal(v.sent(/\/captable\/scenarios\/s-today$/).length, 0, 'Discard saves nothing');
    await v.press(v.by('captable-ead-payment-attach'));
    assert.match(v.text(v.by('captable-scenario-attach-dialog')), /saved with the scenario, for anyone who opens it/);
    await v.press(v.by('captable-scenario-attach-dialog-go'));
    const [[, , body]] = v.sent(/\/captable\/scenarios\/s-today$/, 'PUT');
    assert.equal(body.inputs.notes[0].kind, 'payment');
    assert.equal(body.inputs.notes[0].steps[0], 'First, each investor may take back what it put in: $3,650,000 in all, 1× and non-participating.');
    assert.deepEqual(body.inputs.rounds, S_TODAY.inputs.rounds, 'the inputs are kept as they were');
  } finally { await v.close(); }
});

test('a scenario from the model edits in place with the variants page’s form, run through the engine', async () => {
  const v = await mounted('/raise/cap-table/scenarios/s-model?project_id=3');
  try {
    assert.ok(v.ids().includes('variant-editor'), 'the variants page’s editor, folded in');
    assert.doesNotMatch(v.text(v.by('variant-editor')), /Variant name/, 'renaming is a dialog here');
    const [[, , run]] = v.sent(/\/captable\/simulate$/, 'POST');
    assert.deepEqual(run.inputs.founders, S_MODEL.inputs.founders);
    assert.deepEqual(run.inputs.exit_values, [30000000]);
    assert.match(v.text(v.by('captable-scenario-results')), /The start is your typed model, not the record/);
    assert.ok(!v.all('tag-on-record').length, 'nothing here is on record');
    await v.change(v.labelled('Founder 2 shares'), '5000000');
    const runs = v.sent(/\/captable\/simulate$/, 'POST');
    assert.equal(runs[runs.length - 1][2].inputs.founders[1].shares, 5000000);
    const form = v.by('variant-editor');
    await act(async () => { v.props(form).onSubmit({ preventDefault() {} }); });
    await v.flush();
    const [[, , body]] = v.sent(/\/captable\/scenarios\/s-model$/, 'PUT');
    assert.equal(body.name, 'Typed bridge');
    assert.equal(body.inputs.founders[1].shares, 5000000);
    assert.ok(v.ids().includes('variant-saved'));
  } finally { await v.close(); }
});

test('the model is read, never written: no Rename or Delete, and a line saying where it is changed', async () => {
  const v = await mounted('/raise/cap-table/scenarios/m1?project_id=3');
  try {
    assert.match(v.text(v.by('captable-scenario-name')), /Cap table · model/);
    assert.ok(v.text(v.by('captable-scenario-model-locked')).includes(MODEL_LOCKED.slice(0, 30)));
    const ids = v.ids();
    assert.ok(ids.includes('captable-scenario-duplicate'), 'it can be copied into a scenario');
    assert.ok(!ids.includes('captable-scenario-rename') && !ids.includes('captable-scenario-delete'));
    assert.ok(!ids.includes('captable-ead-round-attach'), 'nothing is attached to the main cap table');
  } finally { await v.close(); }
});

test('Compare (CT7): Today dotted, each scenario run at the same exits, two charts with Table toggles, and the round read back', async () => {
  const v = await mounted('/raise/cap-table/scenarios/compare?project_id=3&ids=s-today,s-model');
  try {
    assert.ok(v.ids().includes('captable-compare-page'));
    const [[, , today]] = v.sent(/\/by-project\/3\/simulate$/, 'POST');
    assert.deepEqual(today.exit_values, [5000000, 30000000, 100000000], 'the same exits for every column');
    const [[, , model]] = v.sent(/\/captable\/simulate$/, 'POST');
    assert.deepEqual(model.inputs.exit_values, [5000000, 30000000, 100000000]);
    const table = v.text(v.by('captable-compare-table'));
    assert.match(table, /┊ Today · on record Seed · base case Typed bridge/);
    assert.match(table, /Founders 88\.89% 61\.54% 77\.14%/);
    assert.match(v.text(v.by('captable-compare-table-block')), /The Today column is the record\. The 2 scenario columns are Modelled\./);
    assert.equal(v.all('captable-compare-panel').length, 2);
    assert.equal(v.marked('data-on-record').length, 2, 'Today is the on-record point for each founder of the scenario from Today, and for none of the typed model');
    assert.equal(v.all('captable-compare-exit').length, 3);
    await v.press(v.by('captable-compare-exits-as-table'));
    assert.match(v.text(v.by('captable-compare-exits-table')), /\$5,000,000 · Typed bridge not recorded not recorded not recorded/);
    await v.press(v.by('captable-compare-founders-as-table'));
    assert.match(v.text(v.by('captable-compare-founders-table')), /Seed · base case · Ada Founder Today 66\.67% → Seed 46\.15%/);
    assert.match(v.text(v.by('captable-compare-exits')), /Assumptions: 1× non-participating preferred\./);
    assert.match(v.text(v.by('captable-ead-compare')), /Read the round back · Seed · base case/);
  } finally { await v.close(); }
  const none = await mounted('/raise/cap-table/scenarios/compare?project_id=3');
  try {
    assert.ok(none.ids().includes('captable-compare-none'));
  } finally { await none.close(); }
});

test('the states: a plan that does not include scenarios reads only; a scenario that cannot be read says so; nothing recorded', async () => {
  const free = await mounted('/raise/cap-table/scenarios?project_id=3', { user: FREE });
  try {
    assert.match(free.text(free.by('captable-scenarios-plan')), /Raise \+ Grow plan\. Everything here still reads\./);
    assert.ok(!free.ids().includes('captable-scenario-new'));
  } finally { await free.close(); }
  const reader = await mounted('/raise/cap-table/scenarios/s-today?project_id=3', { grants: Object.assign(new Error('Forbidden'), { status: 403 }) });
  try {
    assert.ok(reader.ids().includes('captable-scenario-read-only'));
    assert.ok(!reader.ids().includes('captable-scenario-save') && !reader.ids().includes('captable-scenario-delete'));
  } finally { await reader.close(); }
  const gone = await mounted('/raise/cap-table/scenarios/s-x?project_id=3');
  try {
    assert.ok(gone.ids().includes('captable-scenario-refused'), 'a missing scenario is refused, not empty');
  } finally { await gone.close(); }
  const broken = await mounted('/raise/cap-table/scenarios/s-today?project_id=3', { scenario: () => Object.assign(new Error('boom'), { status: 500 }) });
  try {
    assert.ok(broken.ids().includes('captable-scenario-unreadable'));
  } finally { await broken.close(); }
  const empty = await mounted('/raise/cap-table/scenarios?project_id=3', { today: { ...TODAY, today: { available: false, reason: 'nothing_recorded', sentence: 'Nothing is recorded on the cap table yet.' } } });
  try {
    assert.match(empty.text(empty.by('captable-scenarios-no-today')), /Nothing is recorded on the cap table yet\. A new scenario starts from your saved model/);
  } finally { await empty.close(); }
});

// ─────────────────────────────────────────────────────────── the source

test('the wiring: the scenario route under the module guard, the cycle path, the reads the Worker serves, and no pop-ups', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/raise\/cap-table\/scenarios\/:scenario" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <CycleRoute cycle="raise" slug="cap-table" capTableScenario \/>\)\} \/>/);
  const worker = read('cloudflare-worker/src/routes/captable.ts');
  for (const path of ["'/scenarios/by-project/:projectId/today'", "'/scenarios/by-project/:projectId/simulate'", "'/scenarios/by-project/:projectId/variants'", "'/scenarios/:uid'", "'/simulate'"]) assert.ok(worker.includes(path), path);
  const client = read('frontend/src/lib/api/capTableScenarios.js');
  assert.match(client, /\/today`/);
  assert.match(client, /\/simulate`, \{ method: 'POST'/);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/capTableScenarios\.js';/);
  for (const f of ['ScenariosPages.jsx', 'scenariosModel.js', 'ScenarioModelEditor.jsx']) assert.doesNotMatch(read(`frontend/src/pages/raise/captable/${f}`), /\b(alert|confirm|prompt)\(/, f);
});
