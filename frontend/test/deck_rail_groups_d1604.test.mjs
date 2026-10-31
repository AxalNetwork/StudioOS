/**
 * D1604 (#3716, aird1, aird3, aird5) — the AIRail on the pitch pages: models
 * and consumption only.
 *
 *   · every option key `deckRailGroups.js` names is a Pitch deck option in
 *     `lib/railOptions/founder.js`; a group with none reads unavailable from
 *     the adapter (#3754); Safety is the guard, never picked;
 *   · "Held now" is read from `GET /api/ai-budget/holds`, and the deck's
 *     estimate and spend (#3776) are not drawn while the adapter says they
 *     are off, never as $0.00; the presets are "Coming later" (#3796);
 *   · `WorkerRail` with `groups`: one block per group, a group's models read
 *     only when it is opened, at most three suggestions, a pick stored for
 *     each option of the group, and no button that runs a model, takes words
 *     or acts on the page; without `groups`, the rail draws as before;
 *   · the three pitch pages pass `groups`.
 *
 * Every model, price and amount here is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import WorkerRail from '../src/ui/WorkerRail.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { __resetRailPrefsSyncForTest } from '../src/ui/railModelChoice.js';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';
import { DECK_RAIL_GROUPS, DECK_RAIL_PAGE, PRESETS, deckRail, heldNow, usedBy } from '../src/pages/raise/pitch/deckRailGroups.js';
import { SURFACES } from '../src/pages/raise/pitch/deckV2Adapter.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ------------------------------------------------------------------ *
 * The pure data
 * ------------------------------------------------------------------ */

test('every option a group names is a Pitch deck option on main; a group with none waits on #3754; Safety is never picked', () => {
  const deckKeys = new Set(FOUNDER_OPTIONS.filter((o) => o.page === DECK_RAIL_PAGE).map((o) => o.key));
  assert.ok(deckKeys.size > 5, 'the founder options are read');
  for (const g of DECK_RAIL_GROUPS) {
    for (const k of g.options) assert.ok(deckKeys.has(k), `${g.id}: ${k} is not a Pitch deck rail option`);
    if (!g.options.length && !g.safety) {
      assert.equal(g.unavailable?.issue, 3754, `${g.id} waits on per-element routing`);
      assert.equal(g.unavailable.issue, SURFACES.elementModels.issue);
    }
  }
  assert.deepEqual(DECK_RAIL_GROUPS.map((g) => g.label), ['Text', 'Images', 'Graphics', 'Data', 'Diagrams', 'Venture records', 'Vision and checks', 'Safety']);
  assert.deepEqual(DECK_RAIL_GROUPS.find((g) => g.id === 'images').options, ['deck:image']);
  assert.deepEqual(DECK_RAIL_GROUPS.find((g) => g.id === 'data').options, ['deck:chart', 'deck:table', 'deck:timeline']);
  assert.ok(DECK_RAIL_GROUPS.find((g) => g.id === 'safety').safety);
  assert.equal(usedBy(['text']), 'Title, Kicker, Body, Bullets…');
  assert.equal(usedBy(['nothing']), null);
  assert.deepEqual([...PRESETS.options], ['Fast', 'Balanced', 'Best', 'Custom']);
});

test('Held now is the holds read summed; a reply that is not a list is not $0.00', () => {
  assert.equal(heldNow({ holds: [{ included_microusd: 40000, topup_microusd: 0 }, { included_microusd: 10000, topup_microusd: 10000 }] }), '$0.06 · 2 runs in progress');
  assert.equal(heldNow({ holds: [] }), 'Nothing held · no run in progress');
  assert.equal(heldNow({}), null);
  assert.equal(heldNow(null), null);
});

test('the deck\'s estimate and spend read the adapter and are off on this base', async () => {
  const rail = deckRail(31);
  const rows = Object.fromEntries(rail.usage.map((r) => [r.id, r]));
  assert.ok(rows.estimated.hideUnavailable && rows.spent.hideUnavailable, 'not drawn while off');
  assert.deepEqual(await rows.estimated.read(), { available: false, reason: 'Not switched on yet.', issue: 3776 });
  assert.deepEqual(await rows.spent.read(), { available: false, reason: 'Not switched on yet.', issue: 3776 });
  assert.equal((await PRESETS.read()).issue, 3796);
});

/* ------------------------------------------------------------------ *
 * WorkerRail with and without groups
 * ------------------------------------------------------------------ */

const M = (n) => `@cf/synthetic/model-${n}`;
const ANSWER = (option) => ({
  ok: true, page: DECK_RAIL_PAGE, kind: 'write', options: [], pick: null, mode: null, billing: 'cost', guard: { every_run: false },
  models: [1, 2, 3, 4].map((n) => ({ id: M(`${option}-${n}`), name: `Synthetic ${n}`, role: n === 1 ? 'Default' : 'Alternative', line: '', price: { cost: {}, billed: {} } })),
  more: [],
});
const BUDGET = {
  licence: 'founder:growth', daily_microusd: 1000000, monthly_microusd: 5000000, day_spend_microusd: 1, month_spend_microusd: 2,
  balance_microusd: 4200000, day_reserved_microusd: 0, month_reserved_microusd: 30000, topup_reserved_microusd: 0, held_for_review: [],
};

async function mount(el, { holds = { holds: [{ included_microusd: 60000, topup_microusd: 0 }, { included_microusd: 0, topup_microusd: 0 }] }, pick = () => Promise.resolve({ ok: true }) } = {}) {
  __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
  const restore = installDocument();
  const real = { ...api, ...{} };
  const realBudget = { ...aiBudgetApi };
  const realPrefs = { ...railPrefsApi };
  const calls = { page: [], pick: [] };
  api.myAiSpend = async () => ({ recorded: true, month: { spend_usd: 1, calls: 1 }, by_task: [] });
  aiBudgetApi.mine = async () => BUDGET;
  aiBudgetApi.topUp = async () => ({ configured: true, state: 'ready', product: { price_id: 'price_Synthetic', currency: 'usd', unit_amount: 1000 } });
  aiBudgetApi.rates = async () => ({ ok: true, billing: 'cost', models: [] });
  aiBudgetApi.holds = async () => holds;
  railPrefsApi.read = async () => ({ ok: true, modes: {}, models: {} });
  railPrefsApi.page = async (page, option) => { calls.page.push([page, option ?? null]); return ANSWER(option || 'page'); };
  railPrefsApi.setPagePick = (page, model, option) => { calls.pick.push([page, model, option]); return pick(option); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/edit'] }, h(RailPageProvider, { role: 'founder' }, el))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    calls, by, pr, nodes,
    text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    buttons: () => nodes().filter((n) => n.tagName === 'BUTTON'),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      Object.assign(api, real); Object.assign(aiBudgetApi, realBudget); Object.assign(railPrefsApi, realPrefs);
      __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
    },
  };
}

test('with groups: one block per group, no model read until a group opens, at most three suggestions, Held now from the holds read', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }));
  try {
    for (const g of DECK_RAIL_GROUPS) assert.ok(m.by(`worker-rail-group-${g.id}`), `${g.id} is drawn`);
    assert.ok(!m.by('text-worker-rail-model-note'), 'the page\'s one block is not drawn beside the groups');
    assert.deepEqual(m.calls.page.filter(([, o]) => o), [], 'no group\'s models are read before it is opened');
    assert.equal(m.text(m.by('text-worker-rail-group-off-graphics')), 'Not set up yet');
    assert.match(m.text(m.by('worker-rail-group-safety')), /Required Always on\. Not pickable\./);
    assert.match(m.text(m.by('worker-rail-presets')), /Fast Balanced Best Custom Coming later/);
    assert.equal(m.pr(m.by('text-worker-rail-preset-fast'))['aria-disabled'], 'true');
    // Usage: Held now from the holds read; the deck's estimate and spend are off, so not drawn at all.
    assert.equal(m.text(m.by('text-worker-rail-usage-held')), 'Held now $0.06 · 2 runs in progress');
    assert.ok(!m.by('text-worker-rail-usage-estimated') && !m.by('text-worker-rail-usage-spent'));
    assert.doesNotMatch(m.text(m.by('worker-rail-usage')), /Estimated for this deck|Spent on this deck|Held by runs in progress/);
    await m.click('button-worker-rail-group-text');
    assert.deepEqual(m.calls.page.filter(([, o]) => o), [[DECK_RAIL_PAGE, 'deck:rewrite']], 'the lead option, once opened');
    const cards = m.nodes().filter((n) => /^card-worker-rail-group-text-/.test(String(m.pr(n)['data-testid'] || '')));
    assert.equal(cards.length, 3, 'Suggested shows at most three models');
    assert.match(m.text(m.by('worker-rail-group-text')), /Used by: Title, Kicker, Body, Bullets…/);
  } finally { await m.unmount(); }
});

test('with groups: a pick is stored for every option of the group; one that refuses keeps its own and the block says so', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }), {
    pick: (option) => (option === 'deck:timeline' ? Promise.reject(Object.assign(new Error('model_not_offered'), { status: 400 })) : Promise.resolve({ ok: true })),
  });
  try {
    await m.click('button-worker-rail-group-data');
    await m.click('card-worker-rail-group-data-model-deck:chart-2');
    assert.deepEqual(m.calls.pick, [
      [DECK_RAIL_PAGE, M('deck:chart-2'), 'deck:chart'], [DECK_RAIL_PAGE, M('deck:chart-2'), 'deck:table'], [DECK_RAIL_PAGE, M('deck:chart-2'), 'deck:timeline'],
    ]);
    assert.equal(m.text(m.by('text-worker-rail-group-kept-data')), 'Kept its own model: deck:timeline.');
  } finally { await m.unmount(); }
});

test('with groups the rail has no button that runs a model, takes words or acts on the page', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }));
  try {
    for (const g of DECK_RAIL_GROUPS) if (m.by(`button-worker-rail-group-${g.id}`)) await m.click(`button-worker-rail-group-${g.id}`);
    const allowed = /^(button-worker-rail-(toggle|group-[a-z]+|all-models|fab|add-tokens)|switch-worker-rail-ai-off|card-worker-rail-group-.+)$/;
    for (const b of m.buttons()) {
      const id = String(m.pr(b)['data-testid'] || '');
      assert.match(id, allowed, `a button the rail should not have: ${id || m.text(b)}`);
      assert.doesNotMatch(m.text(b), /\b(Generate|Run|Build|Send|Fill|Ask|Apply|Rewrite)\b/, `a button that acts: ${m.text(b)}`);
    }
    assert.equal(m.nodes().filter((n) => ['TEXTAREA', 'INPUT'].includes(n.tagName)).length, 0, 'no field to type into');
  } finally { await m.unmount(); }
});

test('without groups the rail draws as before: the page\'s one block, its safety line and the held row', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Raise' }));
  try {
    assert.ok(!m.by('worker-rail-groups'), 'no group blocks');
    assert.ok(!m.by('worker-rail-presets'));
    assert.ok(m.by('text-worker-rail-safety'));
    assert.match(m.text(m.by('text-worker-rail-usage-held')), /^Held by runs in progress/);
    assert.match(m.text(m.by('worker-rail-suggestions')), /Suggested for this page/);
  } finally { await m.unmount(); }
});

test('the three pitch pages pass the deck\'s groups, and the shared rail runs nothing', () => {
  for (const f of ['PitchStudio.jsx', 'NewDeck.jsx', 'PitchEditor.jsx']) {
    const src = read(`frontend/src/pages/raise/pitch/${f}`);
    assert.match(src, /<WorkerRail\s[^>]*groups=\{(railGroups|groups)\}/, `${f} passes groups`);
    assert.match(src, /deckRail\(/, `${f} builds them`);
  }
  const rail = read('frontend/src/ui/RailGroups.jsx');
  assert.doesNotMatch(rail, /\b(deckAssistApi|deckImagesApi|newDeckApi|railPressHeaders|request\()/, 'the rail runs nothing');
  assert.doesNotMatch(read('frontend/src/ui/RailGroups.jsx'), /from '\.\.\/pages\//, 'the shared rail reads no page module');
});
