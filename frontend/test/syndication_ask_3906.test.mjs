/**
 * #3906 (SY8, D1493): Ask proposes a channel's title and description on the
 * event editor. Every event, channel and line is made up.
 *
 *   · Ask is offered on a saved listing kept on and not posted, of an eligible event;
 *   · the cards: Accept, Edit, Discard, and "Accept all (n)" from two up;
 *   · Accept decides the proposal, then the page's own PUT saves it, kept on,
 *     the channel's other saved copy kept;
 *   · Discard decides and saves nothing; Edit decides "edit" with the new value;
 *   · no suggestion chips; the editor mounts it under Visibility.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import SyndicationAsk from '../src/pages/events/SyndicationAsk.jsx';
import { askableRows, quoteLine, savedChannels, syndicationCard } from '../src/pages/events/syndicationAskModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const LUMA = { uid: 's-1', channel: 'luma', account_uid: 'acc-luma', display_name: 'Luma · Axal', on: true, status: 'selected', overrides: { description: 'Kept description', ticket_url: 'https://axal.vc/t' } };
const READ = {
  eligible: true, reason: null,
  rows: [
    LUMA,
    { uid: null, channel: 'eventbrite', account_uid: 'acc-eb', on: true, status: null, overrides: {} }, // suggested, never saved
    { uid: 's-2', channel: 'meetup', account_uid: 'acc-mu', on: false, status: null, overrides: {} }, // off
    { uid: 's-3', channel: 'linkedin', account_uid: 'acc-li', on: true, status: 'posted', overrides: {} }, // posted
  ],
};
const proposal = (uid, field, value) => ({ uid, status: 'proposed', payload: { account_uid: 'acc-luma', channel: 'luma', field, value, source: 'From the event’s description' } });

test('Ask is offered on a saved listing kept on and not posted, of an eligible event', () => {
  assert.deepEqual(askableRows(READ).map((r) => r.account_uid), ['acc-luma']);
  assert.deepEqual(askableRows({ ...READ, eligible: false }), []);
  assert.deepEqual(askableRows(null), []);
});

test('a card carries its field and value; saving keeps the listing on and its other copy', () => {
  const c = syndicationCard(proposal('p-1', 'title', 'Founders evening'));
  assert.deepEqual([c.uid, c.eyebrow, c.field, c.value, c.text, c.status], ['p-1', 'Title', 'title', 'Founders evening', 'Founders evening', 'proposed']);
  assert.equal(syndicationCard(proposal('p-x', 'colour', 'red')).field, null, 'a field Ask does not fill is not saved');
  assert.deepEqual(savedChannels(LUMA, { title: 'Founders evening' }), [{ account_uid: 'acc-luma', on: true, overrides: { description: 'Kept description', ticket_url: 'https://axal.vc/t', title: 'Founders evening' } }]);
  assert.deepEqual(savedChannels({ account_uid: 'a' }, { title: '  ' }), [{ account_uid: 'a', on: true, overrides: {} }], 'a blank value saves nothing over the copy');
  assert.match(quoteLine({ ai: true, hold_microusd: 21_000 }), /^Holds up to \$0\.021/);
  assert.equal(quoteLine({ ai: false, message: 'AI is off on this page.' }), 'AI is off on this page.');
  assert.match(quoteLine(null), /hold shows here before Send/);
});

function fakeApi({ proposals = [proposal('p-1', 'title', 'Founders evening'), proposal('p-2', 'description', 'An evening for founders.')] } = {}) {
  const calls = [];
  const log = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(typeof value === 'function' ? value(...args) : value); };
  return {
    calls,
    syndication: {
      forEvent: log('forEvent', READ),
      assistQuote: log('assistQuote', { option: 'draft:syndication-copy', ai: true, hold_microusd: 21_000, model: 'm' }),
      assist: log('assist', { proposals, cost: { charged_microusd: 9_000, usage_log_id: 7 } }),
      choose: log('choose', (eventId, channels) => ({ ...READ, rows: [{ ...LUMA, overrides: channels[0].overrides }, ...READ.rows.slice(1)] })),
    },
    proposals: { decide: log('decide', (uid, decision) => ({ proposal: { uid, status: decision } })) },
  };
}

async function mounted(element) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  await act(async () => { root.render(element); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    text: () => text(document.body),
    ids: () => walk(document.body).map((n) => props(n)['data-testid']).filter(Boolean),
    has: (id) => !!byId(id),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { props(n).onClick({ preventDefault() {} }); await settle(); }); },
    async type(id, value) { const n = byId(id); await act(async () => { props(n).onChange({ target: { value } }); await settle(); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('Accept decides the proposal, then the page saves it with its own PUT, the other copy kept', async () => {
  const api = fakeApi();
  const page = await mounted(h(SyndicationAsk, { eventId: '42', api }));
  try {
    assert.deepEqual(page.ids().filter((i) => i.startsWith('syndication-ask-open-')), ['syndication-ask-open-acc-luma']);
    await page.click('syndication-ask-open-acc-luma');
    assert.match(page.text(), /Holds up to \$0\.021/);
    assert.equal(api.calls.some(([n]) => n === 'assist'), false, 'opening runs nothing');
    await page.click('syndication-ask-run');
    assert.deepEqual(api.calls.find(([n]) => n === 'assist').slice(1), ['42', 'acc-luma']);
    assert.ok(page.has('syndication-card-p-1') && page.has('syndication-card-p-2'));
    assert.equal(api.calls.some(([n]) => n === 'decide' || n === 'choose'), false, 'nothing written before Accept');
    await page.click('syndication-card-accept-p-1');
    assert.deepEqual(api.calls.filter(([n]) => n === 'decide').map((c) => c.slice(1)), [['p-1', 'accept']]);
    const saves = api.calls.filter(([n]) => n === 'choose');
    assert.deepEqual(saves.map((c) => c.slice(1)), [['42', [{ account_uid: 'acc-luma', on: true, overrides: { description: 'Kept description', ticket_url: 'https://axal.vc/t', title: 'Founders evening' } }]]]);
    assert.ok(api.calls.findIndex(([n]) => n === 'decide') < api.calls.findIndex(([n]) => n === 'choose'), 'decided before saved');
    assert.ok(!page.has('syndication-accept-all'), 'one open card: no Accept all');
  } finally { await page.close(); }
});

test('"Accept all (2)" decides each open card and saves both in one PUT', async () => {
  const api = fakeApi();
  const page = await mounted(h(SyndicationAsk, { eventId: '42', api }));
  try {
    await page.click('syndication-ask-open-acc-luma');
    await page.click('syndication-ask-run');
    assert.match(page.text(), /Accept all \(2\)/);
    await page.click('syndication-accept-all');
    assert.deepEqual(api.calls.filter(([n]) => n === 'decide').map((c) => c.slice(1)), [['p-1', 'accept'], ['p-2', 'accept']]);
    const saves = api.calls.filter(([n]) => n === 'choose');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0][2][0].overrides, { description: 'An evening for founders.', ticket_url: 'https://axal.vc/t', title: 'Founders evening' });
  } finally { await page.close(); }
});

test('Discard decides and saves nothing; Edit decides "edit" with the new value and saves it', async () => {
  const api = fakeApi();
  const page = await mounted(h(SyndicationAsk, { eventId: '42', api }));
  try {
    await page.click('syndication-ask-open-acc-luma');
    await page.click('syndication-ask-run');
    await page.click('syndication-card-discard-p-2');
    assert.deepEqual(api.calls.filter(([n]) => n === 'decide').map((c) => c.slice(1)), [['p-2', 'discard']]);
    assert.equal(api.calls.some(([n]) => n === 'choose'), false, 'a discard saves nothing');
    await page.click('syndication-card-edit-p-1');
    await page.type('syndication-card-input-p-1', 'Founders evening, edited');
    await page.click('syndication-card-save-p-1');
    const edit = api.calls.filter(([n]) => n === 'decide')[1];
    assert.deepEqual([edit[1], edit[2], edit[3].value, edit[3].field], ['p-1', 'edit', 'Founders evening, edited', 'title']);
    assert.equal(api.calls.find(([n]) => n === 'choose')[2][0].overrides.title, 'Founders evening, edited');
  } finally { await page.close(); }
});

test('a refused run says why and writes nothing', async () => {
  const api = fakeApi();
  api.syndication.assist = () => Promise.reject(Object.assign(new Error('x'), { status: 402, data: { error: 'insufficient_tokens' } }));
  const page = await mounted(h(SyndicationAsk, { eventId: '42', api }));
  try {
    await page.click('syndication-ask-open-acc-luma');
    await page.click('syndication-ask-run');
    assert.match(page.text(), /cannot cover this run/);
    assert.equal(api.calls.some(([n]) => n === 'decide' || n === 'choose'), false);
  } finally { await page.close(); }
});

test('a refused Accept saves nothing and says why', async () => {
  const api = fakeApi({ proposals: [proposal('p-1', 'title', 'Founders evening')] });
  api.proposals.decide = (...args) => { api.calls.push(['decide', ...args]); return Promise.reject(Object.assign(new Error('x'), { status: 409, data: { error: 'not_open', message: 'That proposal is not yours, or it has already been decided.' } })); };
  const page = await mounted(h(SyndicationAsk, { eventId: '42', api }));
  try {
    await page.click('syndication-ask-open-acc-luma');
    await page.click('syndication-ask-run');
    await page.click('syndication-card-accept-p-1');
    assert.match(page.text(), /already been decided/);
    assert.equal(api.calls.some(([n]) => n === 'choose'), false, 'nothing kept, nothing saved');
    assert.equal(page.has('syndication-card-accept-p-1'), true, 'the card stays open');
  } finally { await page.close(); }
});

test('no suggestion chips; the client paths; the editor mounts it under Visibility', () => {
  const src = read('pages/events/SyndicationAsk.jsx');
  assert.doesNotMatch(src, /panelChips|RUN_CHIPS|ASK_SUGGESTED|Suggested for this page/);
  const client = read('lib/api/eventSyndication.js');
  assert.match(client, /assistQuote: .*\/syndication\/assist\/quote`, 'POST'/);
  assert.match(client, /assist: .*\n\s+method: 'POST', timeoutMs: 60_000/);
  const editor = read('pages/events/EventEditorPage.jsx');
  const note = editor.indexOf('{syndicateNote(form.visibility)}');
  const ask = editor.indexOf("{isEdit && form.visibility === 'public' && <SyndicationAsk eventId={id} />}");
  assert.ok(note > 0 && ask > note, 'under the Visibility note');
});
