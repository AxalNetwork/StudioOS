/**
 * D4666 (#4666): the estimate a member approves is the estimate of the operation about to run.
 * Every person and address is made up.
 *
 *   · an estimate answers one operation; an answer for any other is no answer, and a missing price is never 0;
 *   · Shorter has its own estimate, of the text in the editor, and waits for it;
 *   · changing the editor invalidates that estimate at once; a late answer for the old text is ignored;
 *   · a run is sent with the quote of its own estimate; a refused run (409 estimate_required) swaps in the fresh
 *     estimate and runs nothing;
 *   · a failed estimate shuts the buttons and offers a retry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ComposeSheet from '../src/pages/email/ComposeSheet.jsx';
import { gateOf, operationKey, pressable, refreshedFrom, STALE_LINE } from '../src/pages/email/estimateGate.js';

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FUTURE = '2099-01-01T00:00:00.000Z';
const est = (quote, hold = 20_000, extra = {}) => ({ hold_microusd: hold, model: 'm', quote, expires_at: FUTURE, ...extra });

test('a gate is open only for an answer to the operation on screen; no price, no quote and an expired quote are never ready', () => {
  const a = { kind: 'draft', n: 1 };
  const ka = operationKey(a);
  const kb = operationKey({ kind: 'draft', n: 2 });
  assert.equal(gateOf(null, null).status, 'idle');
  assert.equal(gateOf(null, ka).status, 'loading');
  assert.equal(gateOf({ key: ka, estimate: est('q1.a.b'), error: null }, kb).status, 'loading', 'an answer for another operation is no answer');
  const ready = gateOf({ key: ka, estimate: est('q1.a.b'), error: null }, ka);
  assert.equal(ready.status, 'ready');
  assert.equal(pressable(ready, false), true);
  assert.equal(pressable(ready, true), false, 'busy shuts it');
  assert.equal(gateOf({ key: ka, estimate: null, error: 'Down.' }, ka).status, 'failed');
  for (const bad of [{ hold_microusd: 0, quote: 'q' }, { hold_microusd: null, quote: 'q' }, { hold_microusd: 5 }, { hold_microusd: 5, quote: '' }, {}]) {
    assert.equal(gateOf({ key: ka, estimate: bad, error: null }, ka).status, 'failed', `unreadable: ${JSON.stringify(bad)}`);
  }
  const old = gateOf({ key: ka, estimate: est('q1.a.b', 1, { expires_at: '2000-01-01T00:00:00.000Z' }), error: null }, ka);
  assert.deepEqual([old.status, old.error], ['stale', STALE_LINE]);
  assert.equal(pressable(old), false);
  const fresh = est('q1.new.sig');
  assert.deepEqual(refreshedFrom(Object.assign(new Error('x'), { status: 409, code: 'estimate_required', data: { estimate: fresh } })), fresh);
  assert.equal(refreshedFrom(Object.assign(new Error('x'), { status: 409, code: 'other', data: { estimate: fresh } })), null);
  assert.equal(refreshedFrom(Object.assign(new Error('x'), { status: 402 })), null);
});

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
  const byLabel = (label) => walk(document.body).find((n) => props(n)['aria-label'] === label);
  const byText = (t) => walk(document.body).find((n) => n.nodeName === 'BUTTON' && text(n).trim().startsWith(t));
  return {
    by, byLabel, byText, props,
    text: () => text(document.body),
    disabled: (n) => !!props(n).disabled,
    async press(node) { assert.ok(node, 'no such button'); await act(async () => { props(node).onClick?.({ preventDefault() {} }); }); await act(flush); },
    async type(node, value) { await act(async () => { props(node).onChange?.({ target: { value } }); }); await act(flush); },
    async settle(ms = 0) { await act(async () => { await wait(ms); }); await act(flush); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const PACK = { person: { ref: 'interviewee:11', kind: 'interviewee', name: 'Ada Lovelace', relationship: 'customer' }, items: [] };
const ACCOUNT = { uid: 'acc-1', address: 'me@example.test' };
function fakeApi(over = {}) {
  const calls = [];
  const log = (name, fn) => (...args) => { calls.push([name, ...args]); return fn(...args); };
  let n = 0;
  return {
    calls,
    estimate: log('estimate', over.estimate ?? (() => Promise.resolve({ estimate: est('q1.draft.sig') }))),
    draft: log('draft', over.draft ?? (() => Promise.resolve({ draft: { uid: `dr-${++n}`, subject: 'Thank you', body: 'Dear Ada,\nThank you for the interview.', sources: [{ label: 'Interview' }] } }))),
    revise: log('revise', over.revise ?? ((uid, body) => Promise.resolve(body.estimate ? { estimate: est(`q1.revise.${uid}`, 30_000) } : { draft: { uid: `dr-${++n}`, subject: 'Thank you', body: 'Shorter.', sources: [] } }))),
    confirmSend: log('confirmSend', () => Promise.resolve({ nonce: 'n' })),
    send: log('send', () => Promise.resolve({ sent: { uid: 's' } })),
  };
}
const sheet = (api) => h(ComposeSheet, { pack: PACK, refs: ['interview:11'], to: 'ada@example.test', account: ACCOUNT, onClose() {}, onSent() {}, api });

test('Shorter has its own estimate of the text in the editor: it waits for it, is shut again the moment the text changes, and runs with that quote', async () => {
  const api = fakeApi();
  const page = await mounted(sheet(api));
  try {
    assert.equal(page.disabled(page.by('compose-draft')), false, 'the draft estimate is in');
    await page.press(page.by('compose-draft'));
    assert.equal(api.calls.find(([n]) => n === 'draft')[1].quote, 'q1.draft.sig', 'the draft runs with the quote of its estimate');
    await page.settle(450);
    const asked = api.calls.filter(([n, , b]) => n === 'revise' && b?.estimate === true);
    assert.equal(asked.length, 1, 'Shorter\'s estimate was asked for before Shorter could run');
    assert.deepEqual(asked[0][2].base, { subject: 'Thank you', body: 'Dear Ada,\nThank you for the interview.' }, 'it names the text that will be revised');
    assert.equal(page.disabled(page.by('compose-shorter')), false);
    assert.match(page.text(), /Shorter · holds up to \$0\.0300/);
    // The member edits the body: the old estimate is no answer at once, before any new request.
    await page.type(page.byLabel('Body'), 'Dear Ada, a different body the member typed.');
    assert.equal(page.disabled(page.by('compose-shorter')), true, 'shut the moment the text changed');
    assert.match(page.text(), /Shorter \(reading the estimate…\)/);
    await page.settle(450);
    const again = api.calls.filter(([n, , b]) => n === 'revise' && b?.estimate === true);
    assert.equal(again.length, 2);
    assert.equal(again[1][2].base.body, 'Dear Ada, a different body the member typed.', 'the new estimate names the edited text');
    await page.press(page.by('compose-shorter'));
    const run = api.calls.filter(([n, , b]) => n === 'revise' && !b?.estimate).at(-1);
    assert.equal(run[2].quote, 'q1.revise.dr-1');
    assert.equal(run[2].base.body, 'Dear Ada, a different body the member typed.', 'the run revises the text that was approved');
  } finally { await page.close(); }
});

test('a late answer for text the member has since changed never makes Shorter pressable', async () => {
  let releaseFirst;
  let asks = 0;
  const api = fakeApi({
    revise: (uid, body) => {
      if (!body.estimate) return Promise.resolve({ draft: { uid: 'dr-9', subject: 's', body: 'b', sources: [] } });
      asks += 1;
      if (asks === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ estimate: est('q1.OLD.text') }); });
      return new Promise(() => {}); // the second estimate never arrives in this test
    },
  });
  const page = await mounted(sheet(api));
  try {
    await page.press(page.by('compose-draft'));
    await page.settle(450); // the first Shorter estimate is now in flight
    await page.type(page.byLabel('Body'), 'Changed text.');
    await page.settle(450); // the second one is in flight; the first is stale
    await act(async () => { releaseFirst(); });
    await act(flush);
    assert.equal(page.disabled(page.by('compose-shorter')), true, 'the late answer was for the old text');
    assert.doesNotMatch(page.text(), /Shorter · holds up to/);
  } finally { await page.close(); }
});

test('a refused run (estimate_required) takes the fresh estimate, shows why, and runs nothing; the next press uses the new quote', async () => {
  let refusals = 0;
  const api = fakeApi({
    draft: (body) => {
      if (body.quote === 'q1.draft.sig' && refusals === 0) {
        refusals += 1;
        return Promise.reject(Object.assign(new Error('This draft changed since you saw its estimate. Review the new one, then press again.'), { status: 409, code: 'estimate_required', data: { estimate: est('q1.fresh.sig', 25_000) } }));
      }
      return Promise.resolve({ draft: { uid: 'dr-1', subject: 'S', body: 'B', sources: [] } });
    },
  });
  const page = await mounted(sheet(api));
  try {
    await page.press(page.by('compose-draft'));
    assert.equal(page.by('compose-error') ? true : false, true);
    assert.match(page.text(), /changed since you saw its estimate/);
    assert.equal(page.by('compose-send'), undefined, 'no draft was made');
    assert.match(page.text(), /\$0\.0250/, 'the fresh price is the one on the button now');
    await page.press(page.by('compose-draft'));
    const quotes = api.calls.filter(([n]) => n === 'draft').map(([, b]) => b.quote);
    assert.deepEqual(quotes, ['q1.draft.sig', 'q1.fresh.sig']);
  } finally { await page.close(); }
});

test('an estimate that cannot be read shuts Draft and offers a retry; a response with no price is not read as free', async () => {
  let fail = true;
  const api = fakeApi({ estimate: () => (fail ? Promise.reject(new Error('The estimate service is down.')) : Promise.resolve({ estimate: est('q1.draft.sig') })) });
  const page = await mounted(sheet(api));
  try {
    assert.equal(page.disabled(page.by('compose-draft')), true);
    assert.match(page.text(), /The estimate service is down\./);
    fail = false;
    await page.press(page.byText('Try again'));
    assert.equal(page.disabled(page.by('compose-draft')), false, 'the retry read the estimate');
  } finally { await page.close(); }
  const free = fakeApi({ estimate: () => Promise.resolve({ estimate: { hold_microusd: 0, model: 'm', quote: 'q1.x.y', expires_at: FUTURE } }) });
  const page2 = await mounted(sheet(free));
  try {
    assert.equal(page2.disabled(page2.by('compose-draft')), true, 'a zero hold is unreadable, never "free"');
  } finally { await page2.close(); }
});

test('both draft surfaces send the quote of their own estimate and give Shorter its own', () => {
  for (const f of ['ComposeSheet.jsx', 'EmailDraftIntent.jsx']) {
    const src = readFileSync(new URL(`../src/pages/email/${f}`, import.meta.url), 'utf8');
    assert.match(src, /api\.draft\(\{ \.\.\.ask, quote: gate\.estimate\.quote \}\)/, `${f}: Draft and Regenerate carry the quote`);
    assert.match(src, /quote: shortGate\.estimate\.quote/, `${f}: Shorter carries its own quote`);
    assert.match(src, /estimate: true \}\)/, `${f}: Shorter's estimate is the revision's, not the draft's`);
    assert.match(src, /refreshedFrom\(e\)/, `${f}: a refused run takes the fresh estimate`);
    assert.doesNotMatch(src, /disabled=\{busy\} onClick=\{shorter\}/, `${f}: Shorter is no longer pressable on busy alone`);
  }
});
