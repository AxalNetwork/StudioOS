/**
 * D4359 (#4359, #2434 Q8 = A) — the Pitch deck studio unlocks at Raise + Grow,
 * the same as the Worker.
 *
 *   1. The gate's state comes only from the Worker's answer
 *      (`GET /api/decks/access`): open, locked with the plan, or unread when
 *      the read fails or says nothing it can trust. It is never open by default.
 *   2. Mounted: a Growth member's answer draws the locked card with the
 *      upgrade path and none of the studio; a Raise + Grow member's draws the
 *      studio; a failed read draws "could not be checked" and Try again reads
 *      once more.
 *   3. Every studio route is drawn inside the gate, and no studio page keeps
 *      a plan list of its own to drift from the Worker's.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_studio_gate_d4359.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { deckAccessApi } from '../src/lib/api/deckAccess.js';
import StudioGate from '../src/pages/raise/pitch/StudioGate.jsx';
import { LOCKED_TITLE, UNREAD_TITLE, UPGRADE, accessState } from '../src/pages/raise/pitch/studioAccessModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

// The Worker's two answers, as `deckStudioAccess` writes them.
const LOCKED = { open: false, required: 'studio', plan: { tier: 'studio', name: 'Raise + Grow', plan_key: 'founder:studio' }, message: 'This is on the Raise + Grow plan. Upgrade for the pitch deck, cap table, capital, legal, and partner tooling.' };
const OPEN = { open: true, required: 'studio', plan: { tier: 'studio', name: 'Raise + Grow', plan_key: 'founder:studio' }, message: null };

test('the state comes only from the Worker\'s answer, and is never open by default', () => {
  assert.deepEqual(accessState({ status: 'loading' }), { state: 'loading' });
  assert.deepEqual(accessState(null), { state: 'loading' });
  assert.deepEqual(accessState({ status: 'ready', data: OPEN }), { state: 'open' });
  assert.deepEqual(accessState({ status: 'ready', data: LOCKED }), { state: 'locked', tier: 'studio', name: 'Raise + Grow', message: LOCKED.message });
  assert.deepEqual(accessState({ status: 'error' }), { state: 'unread' });
  for (const data of [null, {}, { open: 'true' }, { open: 1 }, []]) assert.equal(accessState({ status: 'ready', data }).state, 'unread', JSON.stringify(data));
  const bare = accessState({ status: 'ready', data: { open: false } });
  assert.equal(bare.state, 'locked');
  assert.equal(bare.tier, 'studio');
});

async function mount(answer) {
  const restore = installDocument();
  const original = deckAccessApi.get;
  const events = [];
  const origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { events.push(e); return true; };
  let calls = 0;
  deckAccessApi.get = async () => { calls += 1; return typeof answer === 'function' ? answer(calls) : answer; };
  const container = document.createElement('div');
  const root = createRoot(container);
  const studio = React.createElement('div', { 'data-testid': 'the-studio' }, 'Synthetic studio');
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(StudioGate, null, studio))));
  return {
    container, events, calls: () => calls,
    async done() { await act(async () => root.unmount()); deckAccessApi.get = original; globalThis.dispatchEvent = origDispatch; restore(); },
  };
}

test('a Growth member sees the studio locked, with the upgrade path', async () => {
  const m = await mount(LOCKED);
  try {
    assert.equal(byId(m.container, 'the-studio'), undefined, 'none of the studio is drawn');
    const card = byId(m.container, 'pitch-studio-locked');
    assert.ok(card, 'the locked card');
    assert.equal(props(card)['data-tier'], 'studio');
    assert.ok(text(card).includes(LOCKED_TITLE), text(card));
    assert.match(text(card), /Upgrade for the pitch deck/);
    const up = byId(m.container, 'pitch-studio-upgrade');
    assert.equal(text(up), UPGRADE);
    await act(async () => props(up).onClick());
    assert.equal(m.events.length, 1);
    assert.equal(m.events[0].type, 'studioos:tier_required');
    assert.equal(m.events[0].detail.required, 'studio', 'the paywall opens on Raise + Grow');
    assert.equal(props(byId(m.container, 'pitch-studio-plans')).href, '/pricing');
  } finally { await m.done(); }
});

test('a Raise + Grow member sees it open', async () => {
  const m = await mount(OPEN);
  try {
    assert.ok(byId(m.container, 'the-studio'), 'the studio is drawn');
    assert.equal(byId(m.container, 'pitch-studio-locked'), undefined);
  } finally { await m.done(); }
});

test('while the plan is being checked, the studio is not drawn', async () => {
  const m = await mount(() => new Promise(() => {}));
  try {
    assert.equal(byId(m.container, 'the-studio'), undefined, 'nothing of the studio before the answer');
    assert.ok(byId(m.container, 'pitch-studio-gate-loading'));
  } finally { await m.done(); }
});

test('a failed read never shows the studio; Try again reads once more', async () => {
  const m = await mount((n) => { if (n === 1) throw Object.assign(new Error('offline'), { status: 0 }); return OPEN; });
  try {
    assert.equal(byId(m.container, 'the-studio'), undefined);
    const card = byId(m.container, 'pitch-studio-unread');
    assert.ok(text(card).includes(UNREAD_TITLE), text(card));
    await act(async () => props(byId(m.container, 'pitch-studio-retry')).onClick());
    assert.equal(m.calls(), 2);
    assert.ok(byId(m.container, 'the-studio'), 'open once the plan is checked');
  } finally { await m.done(); }
});

const STUDIO_PAGES = ['PitchStudio tab="overview"', 'PitchWorkspaceMoved', 'PitchStudio tab="decks"', 'PitchStudio tab="script"',
  'PitchStudio tab="analytics"', 'PitchEditor', 'NewDeck', 'TemplatesGallery', 'PitchStudio tab="review"', 'PitchPresent', 'PitchStudio tab="notes"'];

test('every studio route is drawn inside the gate, and no studio page keeps a plan list of its own', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /const studioGate = \(component\) => <StudioGate>\{component\}<\/StudioGate>;/);
  for (const page of STUDIO_PAGES) {
    const uses = app.split(`<${page} />`).length - 1;
    assert.ok(uses >= 1, `${page} is routed`);
    const gated = app.split(new RegExp(`studioGate\\((?:founderEditor\\()?<${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} />`)).length - 1;
    assert.equal(gated, uses, `${page}: every route to it is inside the gate`);
  }
  const gate = read('frontend/src/pages/raise/pitch/StudioGate.jsx');
  assert.match(gate, /deckAccessApi\.get\(\)/, 'the gate reads the Worker\'s answer');
  const model = read('frontend/src/pages/raise/pitch/studioAccessModel.js');
  assert.doesNotMatch(model, /growth|TIER_RANK|subscription_tier/, 'the model ranks no plans');
  const dir = new URL('../src/pages/raise/pitch/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => /\.(jsx?|mjs)$/.test(n))) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(s, /\bhasTier\(|subscription_tier/, `${f}: no second plan check in the studio`);
  }
  assert.match(read('frontend/src/lib/api/deckAccess.js'), /get: \(\) => request\('\/decks\/access'\)/);
});
