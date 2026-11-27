// D1443 part 4 (#3992) — a page's own Eadwyn task drawn IN the Ask panel: the
// store's intent, `AskIntent`'s portal into the panel's slot, and the Fill
// surfaces that no longer open a D1317 Sheet.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_intent_d1443p4.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  __resetEadwynPanelForTest, askPanelEvent, endAskIntent, openAskIntent, setAskSlot, useAskPanel, useAskRail,
} from '../src/ui/eadwynPanel.js';
import AskIntent from '../src/ui/AskIntent.jsx';
import { FORM_KEEP } from '../src/pages/cycles/FormLightbox.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function Rail({ out, serves = true }) {
  useAskRail(serves, 'Founder · Build', 'Build');
  out.ask = useAskPanel();
  return null;
}

async function mount(element) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = function focus() { document.activeElement = this; }; n.isConnected = true; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const within = (node, id) => walk(node).find((n) => props(n)['data-testid'] === id);
  return {
    container, within, props, root,
    render: async (el) => { await act(async () => { root.render(el); }); },
    act: async (fn) => { await act(async () => { fn(); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the store: an intent opens the panel, the panel closing ends it, a second replaces the first', async () => {
  // Mutations checked: setAsk not ending the intent on close; openAskIntent not telling the first it was replaced; endAskIntent closing the panel.
  __resetEadwynPanelForTest();
  assert.equal(openAskIntent({ label: 'x' }), null, 'no rail serves: no intent, no panel');
  const out = {};
  const m = await mount(h(Rail, { out }));
  try {
    const closed = [];
    let a;
    await m.act(() => { a = openAskIntent({ label: 'Proposals for Experiments', onClose: () => closed.push('a') }); });
    assert.equal(out.ask.open, true);
    assert.equal(out.ask.label, 'Proposals for Experiments');
    assert.equal(out.ask.intent.id, a);
    let b;
    await m.act(() => { b = openAskIntent({ label: 'Ask Eadwyn about Add feature', onClose: () => closed.push('b') }); });
    assert.deepEqual(closed, ['a'], 'the first intent was told it was replaced');
    assert.equal(out.ask.intent.id, b);
    await m.act(() => endAskIntent(a));
    assert.equal(out.ask.intent.id, b, 'a stale id ends nothing');
    await m.act(() => endAskIntent(b));
    assert.equal(out.ask.intent, null);
    assert.equal(out.ask.open, true, 'the host closing its task leaves the panel open');
    await m.act(() => { openAskIntent({ label: 'again', onClose: () => closed.push('c') }); });
    await m.act(() => askPanelEvent({ type: 'escape' }));
    assert.deepEqual(closed, ['a', 'c'], 'closing the panel closed its intent');
    assert.equal(out.ask.intent, null);
  } finally { await m.unmount(); }
});

test('AskIntent: drawn in place with no panel, portalled into the panel\'s slot when there is one; its Close and the panel\'s both call onClose', async () => {
  // Mutations checked: the portal dropped (the region stays in the page); the region's Close not calling onClose.
  __resetEadwynPanelForTest();
  let closes = 0;
  const intent = (key) => h(AskIntent, { key, label: 'Proposals for Experiments', title: '2 proposals for Experiments', footer: h('span', null, 'Each item is added as you accept it.'), onClose: () => { closes += 1; }, testId: 'probe-intent' }, h('p', { 'data-testid': 'probe-body' }, 'rows'));

  // No rail: the region is drawn in place, so the task is never lost.
  const alone = await mount(intent('a'));
  try {
    const region = alone.within(alone.container, 'probe-intent');
    assert.ok(region, 'drawn in place');
    assert.equal(alone.props(region).role, 'region');
    assert.ok(alone.props(region)['aria-labelledby'], 'labelled by its title');
    assert.ok(alone.within(region, 'probe-body'));
    assert.equal(document.activeElement, region, 'focus moved into it');
  } finally { await alone.unmount(); }

  // A rail serves: the region is portalled into the slot the panel hands over.
  const out = {};
  const m = await mount(h(React.Fragment, null, h(Rail, { out }), intent('b')));
  try {
    const slot = document.createElement('div');
    await m.act(() => setAskSlot(slot));
    await m.render(h(React.Fragment, null, h(Rail, { out }), intent('b')));
    assert.equal(out.ask.open, true);
    assert.ok(m.within(slot, 'probe-intent'), 'the region is in the panel\'s slot');
    assert.equal(m.within(m.container, 'probe-intent'), undefined, 'and not also in the page');
    await m.act(() => m.props(m.within(slot, 'probe-intent-close')).onClick());
    assert.equal(closes, 1, 'its own Close');
    assert.equal(out.ask.intent, null);
  } finally { await m.unmount(); }
});

test('the wiring: no Sheet in either Fill surface, the module trigger is the shared Ask, the open form keeps the rail and the panel live', () => {
  for (const f of ['frontend/src/ui/FillSheet.jsx', 'frontend/src/pages/cycles/FillRowsPanel.jsx']) {
    const src = codeOnly(read(f));
    assert.doesNotMatch(src, /import Sheet from|ui\/Sheet\.jsx|<Sheet\b/, `${f} still opens a Sheet`);
    assert.match(src, /<AskIntent /, f);
  }
  const rows = codeOnly(read('frontend/src/pages/cycles/FillRowsPanel.jsx'));
  assert.match(rows, /<AskButtonView onClick=\{\(\) => setOpen\(true\)\} expanded=\{open\} waiting=\{read\.status === 'ready' \? read\.rows\.length : null\}/, 'a failed read draws no count');
  assert.match(rows, /Accept all \(\$\{Math\.min\(rows\.length, 50\)\}\)/, 'Accept all is capped at 50');
  assert.match(codeOnly(read('frontend/src/ui/AskPanel.jsx')), /\{intent \? <div ref=\{setAskSlot\} className="ead-ask-intent" data-testid="ask-panel-intent" \/> : null\}/);
  // S1's B = a: the AIRail and the Ask panel stay live beside an open form.
  assert.deepEqual([...FORM_KEEP], ['[data-sheet-keep]']);
  assert.match(codeOnly(read('frontend/src/pages/cycles/FormLightbox.jsx')), /<Lightbox keep=\{FORM_KEEP\}/);
  assert.match(codeOnly(read('frontend/src/ui/Lightbox.jsx')), /const restore = inertOutside\(el, document\.body, kept\);/);
  const rail = codeOnly(read('frontend/src/ui/WorkerRail.jsx'));
  assert.match(rail, /data-sheet-keep=""\s/);
  assert.match(rail, /className="ead-ask-layer" data-layout=\{askAt\} data-sheet-keep=""/);
});
