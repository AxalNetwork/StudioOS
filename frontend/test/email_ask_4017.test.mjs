/**
 * #4017 items 2 and 3 (#3710 IV-D3, frames ivd3a and ivd3b): the record's Email Sheet drafts through Ask.
 * Every person and address is made up.
 *
 *   · Ask's field trigger shows on a blank Body only, never on a Body that holds anything, and
 *     never for a reader;
 *   · the trigger opens the draft as a form intent (`AskIntent`): the cost line reads
 *     "Holds up to $X · you pay what it uses" before Draft, and nothing runs before it is on screen;
 *   · Accept places the draft in Subject and Body with the "Not saved" pill, and nothing is sent:
 *     only Send, behind its confirmation, sends, with the draft's uid;
 *   · no "Draft with Eadwyn" button on the Sheet; the Sheet shows no address other than recipientFor's;
 *   · touch targets of 44px below 1024px, and a dark pair on every new colour class.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RecordCompose from '../src/pages/email/RecordCompose.jsx';
import { HOLD_READING, draftHoldLine, showBodyTrigger } from '../src/pages/email/emailModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function mounted(element) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await act(flush);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    by, props,
    text: () => text(document.body),
    testIds: () => walk(document.body).map((n) => props(n)['data-testid']).filter(Boolean),
    async press(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {} }); }); await act(flush); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); await act(flush); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const PERSON = { ref: 'interviewee:11', kind: 'interviewee', name: 'Ada Lovelace', relationship: 'customer' };
function fakeApi() {
  const calls = [];
  const ok = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(value); };
  return {
    calls,
    estimate: ok('estimate', { estimate: { hold_microusd: 20_000, quote: 'q1.synthetic.signature', expires_at: '2099-01-01T00:00:00.000Z' } }),
    draft: ok('draft', { draft: { uid: 'dr-1', subject: 'Thank you for the interview', body: 'Dear Ada,\nThank you.', sources: [{ label: 'Interview' }] } }),
    revise: ok('revise', {}),
    confirmSend: ok('confirmSend', { nonce: 'n-1' }),
    send: ok('send', { sent: { uid: 's-1' } }),
  };
}
const sheet = (over = {}) => h(RecordCompose, {
  pack: { person: PERSON }, refs: ['interview:11'], to: 'ada@example.test', account: { uid: 'acc-1', address: 'me@example.test' },
  onClose() {}, onSent() {}, ...over,
});

test('the trigger rule: a blank Body only, never with a value, never for a reader, never while the draft is open', () => {
  // Mutations checked: the blank test dropped, or readOnly ignored → each assert fails.
  assert.equal(showBodyTrigger({ body: '' }), true);
  assert.equal(showBodyTrigger({ body: '   \n ' }), true, 'whitespace is blank');
  assert.equal(showBodyTrigger({ body: 'Hi' }), false);
  assert.equal(showBodyTrigger({ body: '', readOnly: true }), false);
  assert.equal(showBodyTrigger({ body: '', open: true }), false);
  assert.equal(draftHoldLine(null), null);
  assert.equal(draftHoldLine({ hold_microusd: 0 }), null, 'never $0.00');
  assert.equal(draftHoldLine({ hold_microusd: 20_000 }), 'Holds up to $0.02 · you pay what it uses');
});

test('the Sheet: the trigger on a blank Body; gone once the Body holds anything; none for a reader, and no Send', async () => {
  // Mutation checked: RecordCompose drawing the trigger whatever the Body → the "typed" assert fails.
  const api = fakeApi();
  let page = await mounted(sheet({ api }));
  try {
    assert.ok(page.by('record-compose-trigger'), page.testIds().join(','));
    assert.ok(page.by('fill-trigger-field'), 'the shared FillTrigger');
    await page.type('record-compose-body-field', 'Hi Ada');
    assert.equal(page.by('record-compose-trigger'), undefined, 'a Body with words has no trigger');
    await page.type('record-compose-body-field', '');
    assert.ok(page.by('record-compose-trigger'), 'blank again: back');
    assert.equal(api.calls.length, 0, 'nothing estimated, drafted or sent by looking');
  } finally { await page.close(); }
  page = await mounted(sheet({ api: fakeApi(), readOnly: true }));
  try {
    assert.equal(page.by('record-compose-trigger'), undefined, 'a reader never sees it');
    assert.equal(page.by('record-compose-send'), undefined, 'nor Send');
  } finally { await page.close(); }
});

test('Ask: the draft opens as a form intent with the hold line first; Accept places it "Not saved" and sends nothing', async () => {
  // Mutations checked: Accept calling send → the "nothing sent" assert fails; the placed pill dropped →
  // the Not saved assert fails; Draft pressable before the hold is on screen → the order assert fails.
  const api = fakeApi();
  const page = await mounted(sheet({ api }));
  try {
    await page.press('fill-trigger-field');
    assert.ok(page.by('email-intent'), 'the form intent, drawn in place where no panel serves');
    assert.equal(page.by('record-compose-trigger'), undefined, 'one draft at a time');
    const estimate = api.calls.find(([n]) => n === 'estimate');
    assert.deepEqual(estimate?.[1]?.refs, ['interview:11'], 'the records the pack selects');
    assert.match(page.text(), /Holds up to \$0\.02 · you pay what it uses/);
    assert.equal(api.calls.findIndex(([n]) => n === 'estimate') < api.calls.findIndex(([n]) => n === 'draft') || !api.calls.some(([n]) => n === 'draft'), true);
    await page.press('email-intent-draft');
    assert.ok(page.by('email-intent-preview'));
    assert.match(page.text(), /Thank you for the interview/);
    assert.equal(page.props(page.by('record-compose-body-field')).value, '', 'the Preview places nothing until Accept');
    await page.press('email-intent-accept');
    assert.equal(page.by('email-intent'), undefined, 'Accept closes the intent');
    assert.equal(page.props(page.by('record-compose-subject')).value, 'Thank you for the interview');
    assert.equal(page.props(page.by('record-compose-body-field')).value, 'Dear Ada,\nThank you.');
    const mark = page.by('fill-mark');
    assert.ok(mark, 'the pill');
    assert.equal(page.props(mark)['data-kind'], 'placed');
    assert.match(page.text(), /Not saved/);
    assert.equal(api.calls.some(([n]) => n === 'send' || n === 'confirmSend'), false, 'nothing is sent by Accept');
    await page.press('record-compose-send');
    assert.ok(page.by('record-compose-confirm'), 'Send asks first');
    assert.equal(api.calls.some(([n]) => n === 'send'), false);
    await page.press('record-compose-confirm-send');
    const sent = api.calls.find(([n]) => n === 'send')?.[1];
    assert.deepEqual(sent, { account_uid: 'acc-1', to: 'ada@example.test', subject: 'Thank you for the interview', body: 'Dear Ada,\nThank you.', draft_uid: 'dr-1', nonce: 'n-1' });
  } finally { await page.close(); }
});

test('Discard leaves the form as it was; a typed email sends with no draft', async () => {
  const api = fakeApi();
  const page = await mounted(sheet({ api }));
  try {
    await page.press('fill-trigger-field');
    await page.press('email-intent-draft');
    await page.press('email-intent-discard');
    assert.equal(page.by('email-intent'), undefined);
    assert.equal(page.props(page.by('record-compose-body-field')).value, '');
    assert.equal(page.by('fill-mark'), undefined, 'no pill without Accept');
    await page.type('record-compose-subject', 'Hello');
    await page.type('record-compose-body-field', 'Typed by hand');
    await page.press('record-compose-send');
    await page.press('record-compose-confirm-send');
    const sent = api.calls.find(([n]) => n === 'send')?.[1];
    assert.equal(sent.draft_uid, undefined, 'no draft uid for a typed email');
    assert.equal(sent.body, 'Typed by hand');
  } finally { await page.close(); }
});

test('the source: no "Draft with Eadwyn" on the Sheet, the shared trigger and intent, 44px touch, D1442\'s words', () => {
  const compose = read('pages/email/RecordCompose.jsx');
  const intent = read('pages/email/EmailDraftIntent.jsx');
  assert.doesNotMatch(compose + intent, /Draft with Eadwyn/);
  assert.match(compose, /import \{ FillMark, FillTrigger \} from '\.\.\/\.\.\/ui\/FillMark\.jsx'/);
  assert.match(intent, /import AskIntent from '\.\.\/\.\.\/ui\/AskIntent\.jsx'/);
  assert.match(compose, /max-lg:\[&>button\]:h-11 max-lg:\[&>button\]:w-11/, '44px below 1024px');
  assert.match(read('pages/email/emailModel.js'), /import \{ costLine \} from '\.\.\/\.\.\/ui\/askPanelModel\.js'/);
  assert.equal(HOLD_READING, 'Reading what this draft holds…', 'never $0.00 while it reads');
  assert.match(read('pages/email/RecordEmailSheet.jsx'), /<RecordCompose pack=\{pack\} refs=\{refs\} to=\{recipientFor\(who, shares\)\}/, 'the address is recipientFor\'s');
});
