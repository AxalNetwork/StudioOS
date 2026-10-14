/**
 * D686 §5.6 (#1598): Call for Capital in the cycle lightbox.
 *   · the frame is `<Lightbox size="tall">` around an `ActionSheet` (#1596);
 *   · availability is read first, and while round calls are not enabled the
 *     sheet says so and makes no other call;
 *   · the command palette carries the Raise action.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { roundCallsApi } from '../src/lib/api/roundCalls.js';
import RoundCallSheet, { RoundCallSheetView, availabilityOf } from '../src/pages/founder/RoundCallSheet.jsx';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

async function withApi(availability, run) {
  const calls = [];
  const saved = { ...roundCallsApi };
  for (const key of Object.keys(saved)) roundCallsApi[key] = async () => { calls.push(key); return { items: [] }; };
  roundCallsApi.availability = async () => { calls.push('availability'); return availability(); };
  roundCallsApi.context = async () => { calls.push('context'); throw Object.assign(new Error('x'), { status: 503 }); };
  try { return await run(calls); } finally { Object.assign(roundCallsApi, saved); }
}

async function mounted(availability) {
  return withApi(availability, async (calls) => {
    const view = await mountContracts(h(RoundCallSheet, { projectId: 7, onClose: () => {} }), '/raise/call');
    try { await view.flush(); await view.flush(); return { text: view.text(), calls: [...calls] }; } finally { await view.unmount(); }
  });
}

test('availability off: the sheet says Coming soon and makes no other call', async () => {
  const off = await mounted(() => ({ enabled: false }));
  assert.match(off.text, /Coming soon\. Round calls are not enabled\./);
  assert.deepEqual(off.calls, ['availability']);
});

test('availability refused with the flag code reads as off, not Unreadable', async () => {
  const off = await mounted(() => { throw Object.assign(new Error('Coming soon'), { status: 503, code: 'round_calls_disabled' }); });
  assert.match(off.text, /Coming soon\. Round calls are not enabled\./);
  assert.deepEqual(off.calls, ['availability']);
});

test('availability unreadable says Unreadable, and still reads nothing else', async () => {
  const bad = await mounted(() => { throw Object.assign(new Error('down'), { status: 503 }); });
  assert.match(bad.text, /Unreadable/);
  assert.doesNotMatch(bad.text, /Coming soon/);
  assert.deepEqual(bad.calls, ['availability']);
});

test('availability on: the call flow reads its context', async () => {
  const on = await mounted(() => ({ enabled: true }));
  assert.ok(on.calls.includes('context'), on.calls.join());
  assert.doesNotMatch(on.text, /Coming soon/);
});

test('availabilityOf: only enabled === true is on', () => {
  assert.equal(availabilityOf({ loading: true }), 'loading');
  assert.equal(availabilityOf({ loading: false, data: { enabled: true } }), 'on');
  assert.equal(availabilityOf({ loading: false, data: { enabled: 'yes' } }), 'off');
  assert.equal(availabilityOf({ loading: false, error: { code: 'round_calls_disabled' } }), 'off');
  assert.equal(availabilityOf({ loading: false, error: { code: 'x' } }), 'unreadable');
});

test('the frame is the tall cycle lightbox, named Call for Capital', () => {
  const html = ssr(h(RoundCallSheet, { projectId: 7, onClose: () => {} }));
  assert.match(html, /data-testid="round-call-lightbox-layer" data-size="tall"/);
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Call for Capital"/);
  assert.match(html, /data-testid="round-call-sheet"/);
  assert.match(html, /Loading…/);
  assert.doesNotMatch(readFileSync('frontend/src/pages/founder/roundCallParts.jsx', 'utf8'), /CallSheetFrame/, 'the side-panel frame is retired');
});

test('the flow draws ActionSheet steps, a round × and the footer', () => {
  const on = new Proxy({}, { get: () => () => {} });
  const state = { step: 1, fields: { name: '', amount: '', instrument: '', terms: '', minimum: '', target: '', deck_id: '', room: false },
    context: { decks: [], data_room: null, chosen: [], project: { id: 7 } }, chosen: [], page: null, busy: false, error: 'Refused.', outcome: null, projectId: 7 };
  const html = ssr(h(RoundCallSheetView, { state, on, onClose: () => {} }));
  assert.match(html, /data-testid="round-call-sheet-steps"/);
  assert.match(html, /aria-current="step"[^>]*>2 · Materials</);
  assert.match(html, /aria-label="Close" data-testid="round-call-sheet-close"/);
  assert.match(html, /role="alert" data-tone="error"[^>]*>Refused\.</);
  assert.match(html, /Step 2 of 5/);
  assert.match(html, />Back<\/button>/);
});

test('the command palette opens Call for Capital for founders and admins', () => {
  const src = readFileSync('frontend/src/components/CommandPalette.jsx', 'utf8');
  const block = src.slice(src.indexOf("id: 'qa.call-for-capital'"), src.indexOf("id: 'qa.send-nda'"));
  assert.ok(block.length > 0, 'qa.call-for-capital is listed');
  assert.match(block, /label: 'Call for Capital'/);
  assert.match(block, /roles: \['admin', 'founder'\]/);
  assert.match(block, /run: \(nav\) => nav\('\/raise\/call'\)/);
});
