// D1606 (#3731, #2409 part 4) — PostHog in Build: the flag chip, "Link flag
// to a must-have?" with the founder's must-have, "Mark Done?", and Operating
// systems' one Tools line. The API is injected; every value is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_posthog_d1606.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { OperatingPosthog, PrototypePosthog, flagChip, syncLine } from '../src/pages/cycles/BuildPosthog.jsx';

const h = React.createElement;
const LINK = { linked: true, active: true, mine: true, uid: 'int-fixture' };
const MVP = {
  ok: true, module: 'prototype_mvp', label: 'Prototype / MVP', link: LINK, tracked: [],
  facts: [{ id: 1, kind: 'flag_state', fact_key: 'flag:3', period: '2026-10-30', value: 25, label: 'new-onboarding', as_of: '2026-10-30', data: { key: 'new-onboarding', active: true, feature_id: 30 } }],
  proposals: [
    { id: 7, kind: 'flag_link', payload: { key: 'checkout-v2', rollout: 10, active: true } },
    { id: 8, kind: 'flag_shipped', payload: { title: 'Onboarding v2', key: 'new-onboarding', since: '2026-10-10' } },
  ],
  must_haves: [{ id: 30, title: 'Onboarding v2' }, { id: 31, title: 'Checkout' }],
};

function fakeApi(read) {
  const calls = [];
  const log = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  return { calls, fromPosthog: log('from', async () => read), sync: log('sync', async () => ({})), accept: log('accept', async () => ({})), dismiss: log('dismiss', async () => ({})), deleteFact: log('deleteFact', async () => ({})) };
}

async function mounted(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    by, all, pr, say: (n) => text(typeof n === 'string' ? by(n) : n), text: () => text(document.body),
    async click(n) { const x = typeof n === 'string' ? by(n) : n; assert.ok(x, `no ${n}`); assert.ok(!pr(x).disabled, `${n} is enabled`); await act(async () => pr(x).onClick?.({ preventDefault() {} })); await flush(); },
    async choose(n, value) { const x = typeof n === 'string' ? by(n) : n; await act(async () => pr(x).onChange?.({ target: { value } })); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the words: a flag chip never invents a rollout; a sync line names its section and counts', () => {
  assert.equal(flagChip({ rollout: 25, active: true }), 'Flag 25% · active');
  assert.equal(flagChip({ rollout: null, active: false }), 'Flag rollout not recorded · off');
  assert.equal(flagChip({ rollout: 100, active: null }), 'Flag 100% · state not recorded');
  assert.equal(syncLine({ section: 'build', facts: 4, proposals: 1, partial: false, at: '2026-10-30' }), 'Build · 4 figures, 1 proposal · 2026-10-30');
  assert.equal(syncLine({ section: 'grow', facts: 1, proposals: 0, partial: true, at: null }), 'Grow · 1 figure, 0 proposals, partly synced');
});

test('Prototype / MVP: the linked flag\'s chip; Link waits for the founder\'s must-have; Mark Done says why', async () => {
  const api = fakeApi(MVP);
  const ui = await mounted(h(PrototypePosthog, { projectId: 1, api }));
  try {
    assert.deepEqual(ui.all('posthog-flag-chip').map((n) => ui.say(n)), ['Flag 25% · active']);
    const [link] = ui.all('posthog-accept');
    assert.ok(ui.pr(link).disabled, 'no must-have chosen');
    await ui.choose('posthog-feature', '31');
    await ui.click(ui.all('posthog-accept')[0]);
    assert.deepEqual(api.calls.filter((c) => c[0] === 'accept')[0], ['accept', 'build', 1, 7, { feature_id: 31 }]);
    assert.ok(ui.say('posthog-flag-shipped').includes('has been active at 100% since 2026-10-10'));
    await ui.click(ui.all('posthog-accept')[1]);
    assert.deepEqual(api.calls.filter((c) => c[0] === 'accept')[1], ['accept', 'build', 1, 8, {}]);
    await ui.click('posthog-sync');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'sync'), [['sync', 'build', 1]]);
  } finally { await ui.close(); }
});

test('a teammate sees the chip but no Link and no Mark Done', async () => {
  const ui = await mounted(h(PrototypePosthog, { projectId: 1, api: fakeApi({ ...MVP, link: { ...LINK, mine: false } }) }));
  try {
    assert.equal(ui.all('posthog-flag-chip').length, 1);
    assert.equal(ui.all('posthog-accept').length, 0);
    assert.equal(ui.by('posthog-feature'), undefined);
  } finally { await ui.close(); }
});

test('Operating systems: one Tools line with the project, region, last sync and each sync; nothing without a link', async () => {
  const tools = { project: 'Lumen web app', region: 'EU', last_synced: '2026-10-30', reason: null, syncs: [{ section: 'build', facts: 3, proposals: 1, partial: false, at: '2026-10-30' }] };
  let ui = await mounted(h(OperatingPosthog, { projectId: 1, api: fakeApi({ link: LINK, tools }) }));
  try {
    assert.equal(ui.say('posthog-tools-line'), 'Lumen web app · EU Cloud · synced 2026-10-30');
    assert.deepEqual(ui.all('posthog-sync-lines').map((n) => ui.say(n)), ['Build · 3 figures, 1 proposal · 2026-10-30']);
  } finally { await ui.close(); }
  ui = await mounted(h(OperatingPosthog, { projectId: 1, api: fakeApi({ link: { linked: false } }) }));
  try { assert.equal(ui.by('posthog-tools'), undefined, 'a venture with no PostHog draws nothing here'); } finally { await ui.close(); }
});

test('wiring: Build\'s three modules draw PostHog last, in their own lines', () => {
  const parts = readFileSync(new URL('../src/pages/cycles/buildParts.jsx', import.meta.url), 'utf8');
  assert.match(parts, /\['posthog', \(_data, ctx\) => <PrototypePosthog projectId=\{ctx\.projectId\} \/>\]/);
  assert.match(parts, /\['posthog', \(_data, ctx\) => <RoadmapPosthog projectId=\{ctx\.projectId\} \/>\]/);
  assert.match(parts, /\['posthog', \(_data, ctx\) => <OperatingPosthog projectId=\{ctx\.projectId\} \/>\]/);
});
