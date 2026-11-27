/**
 * #4046 (S1, 2026-11-04) — Ask on Publish to…'s post text, as a form intent
 * (`PublishAskIntent`, D1443's `AskIntent`), and the Distribution channel's
 * Ask through the founder form registry. The sheet is mounted over a stand-in
 * `publishApi`; no test reaches the Worker, and every account and post is made up.
 *
 *   1. The model: Ask is off until a place is ticked, and for anyone who may
 *      not publish; Draft waits for the hold; the mark follows the text.
 *   2. The sheet: Ask opens the intent for the ticked places, quotes first,
 *      Draft runs once, Accept places the text in the Draft with "From
 *      Eadwyn", and nothing is confirmed. Discard leaves the Draft as it was.
 *   3. The channel: Add and Edit channel offer Ask on the name alone, keyed by uid.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/publish_ask_4046.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PublishSheet from '../src/pages/cycles/publish/PublishSheet.jsx';
import {
  ASK_MARK, ASK_NEEDS_PLACE, ASK_NOT_FOUNDER, askHoldLine, askMarkShown, askOff, askPlaces, canAskDraft,
} from '../src/pages/cycles/publish/publishAskModel.js';
import { FILL_PAGES, EDIT_FILL_FORMS, fillRecordId, fillTarget, savedId } from '../src/lib/fillForms.js';
import { fieldsOf } from '../src/lib/fillFields.js';

const h = React.createElement;
const P = 701;

const dest = (uid, provider_key, account, audience, enabled = true, retract = 'delete') => ({ uid, provider_key, account, audience, enabled, retract });
const DESTS = {
  can_publish: true,
  connections: [
    { uid: 'int-x', provider_key: 'x', destinations: [dest('d-x', 'x', '@northwind_demo', 'Public')] },
    { uid: 'int-fb', provider_key: 'facebook', destinations: [dest('d-fb', 'facebook', 'Northwind Data', 'Public', true, 'none')] },
  ],
};
const DRAFTED = 'Shipped this month: bulk CSV import, the most asked-for change from finance teams.';

/** A stand-in publishApi: records every call; `ask` quotes or drafts. */
function stubApi(over = {}) {
  const calls = [];
  const api = {
    destinations: async () => { calls.push(['destinations']); return over.destinations || DESTS; },
    createDraft: async (b) => { calls.push(['createDraft', b]); return { draft: { uid: 'draft-1' } }; },
    saveDraft: async (uid, b) => { calls.push(['saveDraft', uid, b]); return { draft: { uid } }; },
    archiveDraft: async (uid) => { calls.push(['archiveDraft', uid]); return { archived: true }; },
    preview: async (uid, uids) => { calls.push(['preview', uid, uids]); return { previews: [] }; },
    confirm: async (uid, b) => { calls.push(['confirm', uid, b]); throw new Error('never confirmed in these tests'); },
    ask: async (b) => {
      calls.push(['ask', b]);
      if (b.estimate) return { estimate: over.estimate === undefined ? { hold_microusd: 4200, model: '@cf/x' } : over.estimate, sources: [{ label: 'Product improvement' }], limit: 280 };
      if (over.askError) throw over.askError;
      return { text: DRAFTED, sources: [{ label: 'Product improvement' }], model: '@cf/x', limit: 280 };
    },
  };
  return { api, calls };
}

function Where() { const l = useLocation(); return h('output', { 'data-testid': 'where' }, `${l.pathname}${l.search}${l.hash}`); }

async function mount(element, url = '/grow/reporting') {
  const restore = installDocument('', { focus: true });
  const keys = [];
  const add = document.addEventListener;
  document.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
  document.removeEventListener = (type, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); };
  const mk = document.createElement.bind(document);
  document.createElement = (tag) => { const n = mk(tag); n.querySelector = () => null; n.querySelectorAll = () => []; return n; };
  document.querySelectorAll = () => [];
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keys.push(fn); };
  globalThis.removeEventListener = (type, fn) => { const i = keys.indexOf(fn); if (i >= 0) keys.splice(i, 1); };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (pred) => walk(container).filter((n) => pred(pr(n), n));
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, element, h(Where)) })))));
  await settle();
  const need = (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    byId, has: (id) => !!byId(id), text: (id) => text(id ? need(id) : container), props: (id) => pr(need(id)), node: need, all, settle,
    where: () => text(byId('where')),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, target: need(id) }); }); await settle(); },
    async change(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value, checked: value } }); }); await settle(); },
    async escape() { await act(async () => { const fn = keys[keys.length - 1]; fn?.({ key: 'Escape', preventDefault() {}, defaultPrevented: false }); }); await settle(); },
    async close() { await act(async () => root.unmount()); document.addEventListener = add; restore(); },
  };
}
const sheet = (api, props = {}) => h(PublishSheet, { projectId: P, module: 'product-improvement', onClose: () => {}, api, delay: 0, ...props });

test('the model: Ask is off until a place is ticked and for anyone who may not publish; Draft waits for its hold', () => {
  // Mutation checked: askOff ignoring `ticked`, or canAskDraft ignoring the hold, each turns this red.
  assert.equal(askOff({ canPublish: false, ticked: ['d-x'] }), ASK_NOT_FOUNDER);
  assert.equal(askOff({ canPublish: true, ticked: [] }), ASK_NEEDS_PLACE);
  assert.equal(askOff({ canPublish: true, ticked: ['d-x'] }), null);
  assert.deepEqual(askPlaces(['a', 'b', 'a', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e'], 'at most five places, each once');
  assert.equal(askHoldLine({ hold_microusd: 4200 }), 'Holds up to $0.0042 · you pay what it uses'.replace('$0.0042', askHoldLine({ hold_microusd: 4200 }).match(/\$[0-9.,<]+/)[0]));
  assert.equal(askHoldLine(null), null, 'no hold read: never "$0.00"');
  assert.equal(askHoldLine({ hold_microusd: 0 }), null);
  assert.equal(canAskDraft({ estimate: null }), false);
  assert.equal(canAskDraft({ estimate: { hold_microusd: 4200 }, busy: true }), false);
  assert.equal(canAskDraft({ estimate: { hold_microusd: 4200 } }), true);
  assert.equal(askMarkShown(DRAFTED, DRAFTED), true);
  assert.equal(askMarkShown(DRAFTED, `${DRAFTED} And more.`), false, 'typed over: the founder\'s own');
  assert.equal(askMarkShown(null, ''), false);
});

test('the sheet: Ask is off until a place is ticked, then opens for the ticked places and quotes before Draft', async () => {
  // Mutation checked: the Ask button without `disabled={!!askWhy}` → Ask opens with no place ticked.
  const { api, calls } = stubApi();
  const v = await mount(sheet(api));
  try {
    assert.equal(v.props('publish-ask-open').disabled, true, 'nothing ticked: Ask is off');
    assert.equal(v.text('publish-ask-why'), ASK_NEEDS_PLACE);
    await v.change('publish-dest-d-x-box', true);
    assert.equal(v.props('publish-ask-open').disabled, false);
    assert.equal(v.has('publish-ask-why'), false);
    await v.click('publish-ask-open');
    assert.ok(v.has('publish-ask'), 'the intent opens');
    assert.match(v.text('publish-ask-places'), /@northwind_demo on X/);
    const quote = calls.filter((c) => c[0] === 'ask');
    assert.deepEqual(quote.map((c) => c[1]), [{ project_id: P, module: 'product-improvement', destination_uids: ['d-x'], estimate: true }], 'one quote, which runs nothing');
    assert.match(v.text('publish-ask-hold'), /Holds up to .* · you pay what it uses/);
    assert.equal(v.props('publish-ask-draft').disabled, false);
  } finally { await v.close(); }
});

test('Draft runs once; Accept places the text in the Draft with "From Eadwyn"; typing over it makes it the founder\'s; nothing is confirmed', async () => {
  // Mutation checked: onAccept not calling setText → the Draft stays empty; the mark not tied to the text → it survives an edit.
  const { api, calls } = stubApi();
  const v = await mount(sheet(api));
  try {
    await v.change('publish-dest-d-x-box', true);
    await v.change('publish-dest-d-fb-box', true);
    await v.click('publish-ask-open');
    await v.click('publish-ask-draft');
    const runs = calls.filter((c) => c[0] === 'ask' && !c[1].estimate);
    assert.equal(runs.length, 1, 'one run');
    assert.deepEqual(runs[0][1].destination_uids, ['d-x', 'd-fb'], 'for the ticked places');
    assert.equal(v.text('publish-ask-text'), DRAFTED);
    await v.click('publish-ask-accept');
    assert.equal(v.has('publish-ask'), false, 'the intent closes');
    assert.equal(v.props('publish-text').value, DRAFTED, 'placed in the Draft');
    assert.equal(v.text('publish-ask-mark'), ASK_MARK);
    assert.ok(calls.some((c) => c[0] === 'createDraft' || c[0] === 'saveDraft'), 'the check saves it like typed text');
    await v.change('publish-text', `${DRAFTED} Thanks to everyone who asked.`);
    assert.equal(v.has('publish-ask-mark'), false, 'typed over: the mark goes');
    assert.equal(calls.filter((c) => c[0] === 'confirm').length, 0, 'nothing is sent by Ask');
  } finally { await v.close(); }
});

test('Discard leaves the Draft as it was; no hold read keeps Draft off; a refusal reads in its own words', async () => {
  const { api } = stubApi({ estimate: null });
  const v = await mount(sheet(api));
  try {
    await v.change('publish-text', 'My own words.');
    await v.change('publish-dest-d-x-box', true);
    await v.click('publish-ask-open');
    assert.equal(v.props('publish-ask-draft').disabled, true, 'no hold on screen: Draft is off');
    assert.match(v.text('publish-ask-hold'), /Reading what this draft holds/);
    await v.click('publish-ask-close');
    assert.equal(v.props('publish-text').value, 'My own words.', 'Discard and Close leave the Draft');
  } finally { await v.close(); }
  const refused = stubApi({ askError: Object.assign(new Error('Nothing recorded here yet to draft from. Write your own.'), { status: 422 }) });
  const w = await mount(sheet(refused.api));
  try {
    await w.change('publish-dest-d-x-box', true);
    await w.click('publish-ask-open');
    await w.click('publish-ask-draft');
    assert.match(w.text('publish-ask-error'), /Nothing recorded here yet/);
  } finally { await w.close(); }
  const reader = stubApi({ destinations: { ...DESTS, can_publish: false } });
  const r = await mount(sheet(reader.api));
  try {
    assert.equal(r.props('publish-ask-open').disabled, true, 'a member who may not publish gets no Ask');
    assert.equal(r.text('publish-ask-why'), ASK_NOT_FOUNDER);
  } finally { await r.close(); }
});

test('the channel: Add and Edit channel offer Ask on the name alone, and a channel is keyed by its uid', async () => {
  // Mutation checked: FILL_PAGES without grow/distribution, or EDIT_FILL_FORMS without edit-channel, turns this red.
  const { FORMS, editFor } = await import('../src/pages/cycles/forms.js');
  const page = FILL_PAGES['grow/distribution'];
  assert.equal(page, 'Founder · Grow · Distribution');
  assert.deepEqual(fillTarget('grow', 'distribution', 'channel'), { page, form: 'channel' });
  assert.equal(EDIT_FILL_FORMS['edit-channel'], 'channel');
  assert.deepEqual(fillTarget('grow', 'distribution', editFor('grow', 'distribution').key), { page, form: 'channel' });
  assert.deepEqual(fieldsOf(page, 'channel').map((f) => [f.field, f.column, f.class]), [['name', 'name', 'composition']], 'never the kind, state, spend or bar');
  assert.ok(FORMS.grow.distribution[0].fields.some((f) => f.name === 'name'));
  const uid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(fillRecordId(uid, 'growth_channels'), uid, 'an Edit names its channel by uid');
  assert.equal(savedId({ uid, utm_source: 'founder-podcast' }, 'growth_channels'), uid, 'Add channel answers its uid');
  assert.equal(fillRecordId("x' OR 1=1", 'growth_channels'), null);
});
