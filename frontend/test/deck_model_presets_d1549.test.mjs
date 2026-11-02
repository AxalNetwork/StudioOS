/**
 * D1549 (#3796, deck v2 C1) — the deck's presets and HQ's lock in the AIRail,
 * and HQ's org default and lock table (aird6b).
 *
 *   · `deckV2Adapter.presets` and `.orgLocks` answer through
 *     `deckModelPresetsApi.read` (orgLocks: its `locks`); a 404 is still off,
 *     anything else unreadable, never empty;
 *   · on a deck the presets segment shows the preset in force pressed; a
 *     press stores it and the groups read again; a refused press says why;
 *   · a group HQ locked says "🔒 Set by Axal VC HQ" under its name and
 *     offers no pick; the others do;
 *   · `DeckModelsCard`: Element group | Model ▾ | Lock, from the Worker's
 *     answer; nothing is written until Save; a lock needs a model; a read
 *     that fails says it could not be read, with Retry; it is drawn on HQ › AI usage.
 *
 * Every model id and name here is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_model_presets_d1549.test.mjs
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
import { deckElementModelsApi } from '../src/lib/api/deckElementModels.js';
import { deckModelPresetsApi } from '../src/lib/api/deckModelPresets.js';
import { adminDeckModelsApi } from '../src/lib/api/adminDeckModels.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { deckRail, presetsFor, PRESETS } from '../src/pages/raise/pitch/deckRailGroups.js';
import DeckModelsCard, { saveBody, storedOf } from '../src/pages/hq/DeckModelsCard.jsx';

const h = React.createElement;
const M = (n) => `@cf/synthetic/model-${n}`;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LOCK = { group: 'images', label: 'Images', model: M('images-1'), name: 'Synthetic images 1', line: 'Set by Axal VC HQ' };
const PRESETS_REPLY = (preset = 'balanced', locks = [LOCK]) => ({ deck_id: 31, project_id: 1, preset, stored: preset === 'custom' ? null : preset, options: [], groups: [], locks });

// ------------------------------------------------------------------ the adapter

test('presets and orgLocks answer through deckModelPresetsApi.read; a 404 is off, anything else unreadable', async () => {
  // Mutation checked: orgLocks passing the whole reply instead of its locks → the value assert fails.
  const real = { ...deckModelPresetsApi };
  try {
    const seen = [];
    deckModelPresetsApi.read = async (id) => { seen.push(id); return PRESETS_REPLY('fast'); };
    assert.deepEqual(await adapter.presets(31), { available: true, value: PRESETS_REPLY('fast') });
    assert.deepEqual(await adapter.orgLocks(31), { available: true, value: [LOCK] });
    assert.deepEqual(seen, [31, 31]);
    deckModelPresetsApi.read = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.orgLocks(31), { available: false, reason: adapter.NOT_ON, issue: 3786 });
    deckModelPresetsApi.read = async () => { throw Object.assign(new Error('Unreadable: picks'), { status: 503 }); };
    assert.equal((await adapter.presets(31)).unreadable, true);
    assert.equal(adapter.availability('presets'), null); assert.equal(adapter.availability('orgLocks'), null);
    assert.deepEqual([adapter.SURFACES.presets.issue, adapter.SURFACES.orgLocks.issue], [3796, 3786], 'each row keeps its issue');
  } finally { Object.assign(deckModelPresetsApi, real); }
  // With no deck nothing is read.
  assert.equal(presetsFor(null), PRESETS);
  assert.equal(deckRail(null).locks, undefined);
  assert.equal(typeof deckRail(31).locks, 'function');
});

// ------------------------------------------------------------------ the rail

const ELEMENTS_REPLY = () => ({
  deck_id: 31, billing: 'cost',
  groups: ['text', 'images', 'graphics', 'data', 'diagrams', 'venture'].map((g) => (g === 'graphics'
    ? { group: g, elements: [], suggested: [], more: [], pick: null, resolved: null, free: 'No model · free' }
    : { group: g, suggested: [1, 2].map((n) => ({ id: M(`${g}-${n}`), name: `Synthetic ${g} ${n}`, role: n === 1 ? 'Default' : 'Alternative', line: '', price: { cost: {}, billed: {} } })), more: [], pick: null,
      resolved: { model: M(`${g}-1`), source: g === 'images' ? 'org_lock' : 'default', locked: g === 'images', notice: null } })),
});

async function mount(el, { presets = () => PRESETS_REPLY(), set = (id, p) => Promise.resolve(PRESETS_REPLY(p)) } = {}) {
  __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
  const restore = installDocument();
  const saved = [{ ...api }, { ...aiBudgetApi }, { ...railPrefsApi }, { ...deckElementModelsApi }, { ...deckModelPresetsApi }, { ...adminDeckModelsApi }];
  const calls = { presets: [], set: [], elements: [], elementPick: [] };
  deckElementModelsApi.read = async (id) => { calls.elements.push(id); return ELEMENTS_REPLY(); };
  deckElementModelsApi.pick = async (id, body) => { calls.elementPick.push([id, body]); return { ok: true }; };
  deckModelPresetsApi.read = async (id) => { calls.presets.push(id); return presets(); };
  deckModelPresetsApi.set = (id, p) => { calls.set.push([id, p]); return set(id, p); };
  api.myAiSpend = async () => ({ recorded: true, month: { spend_usd: 1, calls: 1 }, by_task: [] });
  aiBudgetApi.mine = async () => ({ licence: 'founder:growth', daily_microusd: 1, monthly_microusd: 1, day_spend_microusd: 0, month_spend_microusd: 0, balance_microusd: 1, day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [] });
  aiBudgetApi.topUp = async () => ({ configured: false });
  aiBudgetApi.rates = async () => ({ ok: true, billing: 'cost', models: [] });
  aiBudgetApi.holds = async () => ({ holds: [] });
  railPrefsApi.read = async () => ({ ok: true, modes: {}, models: {} });
  railPrefsApi.page = async () => ({ ok: true, models: [], more: [], options: [], billing: 'cost', guard: { every_run: false } });
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
    calls, by, pr, nodes, settle,
    text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      [api, aiBudgetApi, railPrefsApi, deckElementModelsApi, deckModelPresetsApi, adminDeckModelsApi].forEach((o, i) => Object.assign(o, saved[i]));
      __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest();
    },
  };
}

test('the rail: Balanced in force is pressed; a press stores Fast and the groups and locks read again; a refused press says why', async () => {
  // Mutation checked: RailPresets ignoring `pick` (pressing changes nothing) → the set assert fails.
  let refuse = false;
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }), {
    set: (id, p) => (refuse ? Promise.reject(Object.assign(new Error('You cannot change this deck.'), { status: 403 })) : Promise.resolve(PRESETS_REPLY(p))),
  });
  try {
    assert.equal(m.pr(m.by('button-worker-rail-preset-balanced'))['aria-pressed'], true);
    assert.equal(m.pr(m.by('button-worker-rail-preset-fast'))['aria-pressed'], false);
    assert.ok(!m.by('text-worker-rail-presets-later'), 'not "Coming later" on a deck');
    const readsBefore = m.calls.presets.length;
    await m.click('button-worker-rail-group-text');
    await m.click('button-worker-rail-preset-fast');
    assert.deepEqual(m.calls.set, [[31, 'fast']]);
    assert.equal(m.pr(m.by('button-worker-rail-preset-fast'))['aria-pressed'], true);
    assert.ok(m.calls.presets.length > readsBefore, 'the locks read again');
    assert.equal(m.calls.elements.length, 2, 'the open group read again');
    await m.click('button-worker-rail-preset-balanced');
    assert.deepEqual(m.calls.set, [[31, 'fast'], [31, 'balanced']]);
    refuse = true;
    await m.click('button-worker-rail-preset-best');
    assert.equal(m.text(m.by('text-worker-rail-presets-refused')), 'You cannot change this deck.');
    assert.equal(m.pr(m.by('button-worker-rail-preset-balanced'))['aria-pressed'], true, 'the refused press changes nothing');
  } finally { await m.unmount(); }
});

test('a group HQ locked says "🔒 Set by Axal VC HQ" and offers no pick; an unlocked group still does', async () => {
  // Mutation checked: RailGroup not drawing the lock line → the text assert fails; keeping `live` on a locked group → the button assert fails.
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }));
  try {
    assert.equal(m.text(m.by('text-worker-rail-group-lock-images')), '🔒 Set by Axal VC HQ', 'drawn before the group is opened, from orgLocks');
    assert.ok(!m.by('text-worker-rail-group-lock-text'));
    await m.click('button-worker-rail-group-images');
    const card = m.by('card-worker-rail-group-images-model-images-2');
    assert.ok(card, 'the locked group still shows its models');
    assert.notEqual(card.tagName, 'BUTTON', 'no pick on a locked group');
    await m.click('button-worker-rail-group-data');
    assert.equal(m.by('card-worker-rail-group-data-model-data-2').tagName, 'BUTTON', 'an unlocked group is pickable');
    await m.click('card-worker-rail-group-data-model-data-2');
    assert.deepEqual(m.calls.elementPick, [[31, { scope: 'deck', key: 'group:data', model: M('data-2') }]]);
  } finally { await m.unmount(); }
});

test('the lock line also comes from the group\'s own read when orgLocks is off', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Raise', groups: deckRail(31) }), { presets: () => { throw Object.assign(new Error('off'), { status: 404 }); } });
  try {
    assert.ok(!m.by('text-worker-rail-group-lock-images'), 'nothing claimed before a read says so');
    assert.match(m.text(m.by('text-worker-rail-presets-later')), /Coming later|Not switched on/);
    await m.click('button-worker-rail-group-images');
    assert.equal(m.text(m.by('text-worker-rail-group-lock-images')), '🔒 Set by Axal VC HQ');
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ HQ's table

const HQ_REPLY = () => ({ groups: [
  { group: 'text', label: 'Text', lead: 'title', choices: [{ id: M('t1'), name: 'Synthetic T1', lock: null }, { id: M('t2'), name: 'Synthetic T2', lock: 'Paid plans' }], catalogue_default: { id: M('t1'), name: 'Synthetic T1' }, org: null },
  { group: 'images', label: 'Images', lead: 'photo', choices: [{ id: M('i1'), name: 'Synthetic I1', lock: null }], catalogue_default: { id: M('i1'), name: 'Synthetic I1' }, org: { model: M('i1'), name: 'Synthetic I1', locked: true, updated_at: '2026-11-01 10:00:00' } },
] });

test('saveBody: a lock needs a model; the catalogue default clears the row and its lock', () => {
  assert.deepEqual(saveBody('text', { model: M('t1'), locked: true }), { group: 'text', model: M('t1'), locked: true });
  assert.deepEqual(saveBody('text', { model: '', locked: false }), { group: 'text', model: null, locked: false });
  assert.equal(saveBody('text', { model: '', locked: true }), null);
  assert.deepEqual(storedOf({ org: null }), { model: '', locked: false });
  assert.deepEqual(storedOf(HQ_REPLY().groups[1]), { model: M('i1'), locked: true });
});

test('DeckModelsCard: Element group | Model | Lock from the Worker; nothing is written until Save; a failed read says so, with Retry', async () => {
  // Mutation checked: the select writing on change (no Save) → the "nothing written" assert fails.
  const writes = [];
  let fail = false;
  const real = { ...adminDeckModelsApi };
  adminDeckModelsApi.read = async () => { if (fail) throw new Error('no'); return HQ_REPLY(); };
  adminDeckModelsApi.set = async (body) => { writes.push(body); return { ok: true, ...body }; };
  const k = await mountCard();
  try {
    const t = k.text(k.by('hq-deck-models'));
    assert.match(t, /^HQ · Platform HQ Deck models · org default/);
    assert.match(t, /Element group Model Lock/);
    assert.ok(k.by('hq-deck-models-row-text') && k.by('hq-deck-models-row-images'));
    assert.equal(k.pr(k.by('switch-hq-deck-models-lock-images'))['aria-checked'], true);
    assert.equal(k.pr(k.by('switch-hq-deck-models-lock-text')).disabled, true, 'no lock without a model');
    assert.equal(k.pr(k.by('button-hq-deck-models-save-text')).disabled, true, 'nothing to save');
    await k.change('select-hq-deck-models-text', M('t2'));
    await k.click('switch-hq-deck-models-lock-text');
    assert.deepEqual(writes, [], 'nothing written before Save');
    await k.click('button-hq-deck-models-save-text');
    assert.deepEqual(writes, [{ group: 'text', model: M('t2'), locked: true }]);
    await k.change('select-hq-deck-models-images', '');
    assert.equal(k.pr(k.by('switch-hq-deck-models-lock-images'))['aria-checked'], false, 'the catalogue default drops the lock');
    await k.click('button-hq-deck-models-save-images');
    assert.deepEqual(writes.at(-1), { group: 'images', model: null, locked: false });
  } finally { await k.unmount(); Object.assign(adminDeckModelsApi, real); }
  fail = true;
  adminDeckModelsApi.read = async () => { throw new Error('no'); };
  const u = await mountCard();
  try {
    assert.match(u.text(u.by('hq-deck-models')), /HQ’s deck models could not be read\./);
    assert.match(u.text(u.by('hq-deck-models')), /Retry$/);
    assert.ok(!u.by('hq-deck-models-row-text'), 'no row is drawn as unlocked instead');
  } finally { await u.unmount(); Object.assign(adminDeckModelsApi, real); }
});

/** The card alone, with the stubs already in place before its first read. */
async function mountCard() {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(DeckModelsCard)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the table is on HQ › AI usage, the Super Admin page; no founder page draws a model control outside the AIRail', () => {
  assert.match(read('frontend/src/pages/hq/AiUsagePage.jsx'), /<DeckModelsCard \/>/);
  for (const f of ['PitchStudio.jsx', 'NewDeck.jsx', 'PitchEditor.jsx']) assert.doesNotMatch(read(`frontend/src/pages/raise/pitch/${f}`), /DeckModelsCard|adminDeckModels/);
});
