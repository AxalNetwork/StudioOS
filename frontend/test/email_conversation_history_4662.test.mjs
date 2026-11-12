/** D4662 (#4662): mounted manual/AI sends, same-person refresh, older pages, unreadable reads and scope races. All adapters are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import EmailPage from '../src/pages/email/EmailPage.jsx';
import RecordCompose from '../src/pages/email/RecordCompose.jsx';

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const ACCOUNT = { uid: 'synthetic-account', address: 'me@example.invalid', status: 'active', provider: 'outlook' };
const pack = (ref = 'interviewee:11') => ({ person: { ref, kind: 'interviewee', name: ref === 'interviewee:11' ? 'Synthetic Ada' : 'Synthetic Ben', relationship: 'customer', address: 'person@example.invalid' }, items: [] });
const draft = { uid: 'draft-1', person: 'interviewee:11', subject: 'New durable send', body: 'Written with Eadwyn', intent: 'thank_follow_up', tone: 'warm', length: 'short', sources: [] };
const row = (uid, extra = {}) => ({ uid, subject: `Message ${uid}`, status: 'sent', quoted: [], ...extra });
const page = (items = [], total = items.length, n = 1) => ({ items, total, page: n, per_page: 20 });
function fakeApi(over = {}) {
  const calls = [];
  const defaults = {
    accounts: async () => ({ accounts: [ACCOUNT], providers: {} }),
    shares: async () => ({ items: [] }), people: async () => ({ profile: 'founder', groups: [] }),
    context: async (ref) => pack(ref), drafts: async () => ({ drafts: [] }), sent: async () => page(),
    estimate: async () => ({ estimate: { quote: 'synthetic-quote', hold_microusd: 100, expires_at: '2099-01-01T00:00:00Z' } }),
    revise: async () => ({ estimate: { quote: 'synthetic-revise', hold_microusd: 100, expires_at: '2099-01-01T00:00:00Z' } }),
    confirmSend: async () => ({ nonce: 'synthetic-nonce' }), send: async () => ({ sent: { uid: 'new-send' } }),
  };
  return Object.fromEntries([['calls', calls], ...Object.entries({ ...defaults, ...over }).map(([name, fn]) => [name, (...args) => { calls.push([name, ...args]); return fn(...args); }])]);
}
async function mounted(api, element = null) {
  const restore = installDocument({ focus: true });
  const realMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let navigate;
  function Navigation() { navigate = useNavigate(); return null; }
  const render = (userId = 2) => h(MemoryRouter, { initialEntries: ['/email?person=interviewee%3A11'] }, h(Navigation), element ?? h(EmailPage, { api, userId }));
  await act(async () => { root.render(render()); await flush(); });
  const walk = (n) => [n, ...(n.childNodes ?? []).flatMap(walk)];
  const props = (n) => Object.entries(n ?? {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] ?? {};
  const text = (n = document.body) => n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent ?? '';
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    by, text, props, rows: () => walk(document.body).filter((n) => props(n)['data-testid'] === 'thread-sent'),
    async press(node) { assert.ok(node, 'button exists'); assert.ok(!props(node).disabled, 'button is enabled'); await act(async () => { props(node).onClick({ preventDefault() {} }); await flush(); }); },
    async retry() { const button = walk(document.body).find((n) => n.nodeName === 'BUTTON' && /Try again|Retry/.test(text(n))); await this.press(button); },
    async type(id, value) { await act(async () => { props(by(id)).onChange({ target: { value } }); await flush(); }); },
    async settle() { await act(flush); },
    async navigate(ref) { await act(async () => { navigate(`/email?person=${encodeURIComponent(ref)}`); await flush(); }); },
    async settings() { await act(async () => { navigate('/email/settings'); await flush(); }); },
    async user(id) { await act(async () => { root.render(render(id)); await flush(); }); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = realMedia; restore(); },
  };
}

test('the manual record composer carries person independently of any AI draft', async () => {
  const api = fakeApi();
  const ui = await mounted(api, h(RecordCompose, { api, pack: pack(), refs: [], to: 'person@example.invalid', account: ACCOUNT, onClose() {}, onSent() {} }));
  try {
    await ui.type('record-compose-subject', 'Manual subject');
    await ui.type('record-compose-body-field', 'Written by hand');
    await ui.press(ui.by('record-compose-send')); await ui.press(ui.by('record-compose-confirm-send'));
    const payload = api.calls.find(([name]) => name === 'send')[1];
    assert.equal(payload.person, 'interviewee:11');
    assert.equal(payload.draft_uid, undefined);
    assert.equal(payload.body, 'Written by hand');
  } finally { await ui.close(); }
});

test('completing a resumed AI send refreshes the same selected thread once and fences an older page response', async () => {
  const older = deferred(); let sent = false;
  const api = fakeApi({
    drafts: async () => ({ drafts: sent ? [] : [draft] }),
    sent: async (n) => n === 2 ? older.promise : page(sent ? [row('new', { subject: draft.subject }), row('old')] : [row('old')], sent ? 22 : 21),
    send: async () => { sent = true; return { operation: { state: 'accepted', uid: 'new' }, sent: { uid: 'new' } }; },
  });
  const ui = await mounted(api);
  try {
    await ui.press(ui.by('thread-history-more'));
    await ui.press(ui.by('thread-draft-open'));
    await ui.press(ui.by('compose-send')); await ui.press(ui.by('compose-confirm-send'));
    assert.equal(api.calls.find(([name]) => name === 'send')[1].person, 'interviewee:11');
    assert.match(ui.text(), /New durable send/);
    assert.equal(ui.rows().length, 2);
    assert.equal(ui.by('thread-draft'), undefined);
    older.resolve(page([row('stale')], 21, 2)); await ui.settle();
    assert.doesNotMatch(ui.text(), /Message stale/);
    assert.equal(ui.rows().length, 2);
    assert.match(ui.text(), /Showing 2 of 22 recorded sends/);
    assert.ok(api.calls.filter(([name]) => name === 'sent').every(([, , ref]) => ref === 'interviewee:11'));
  } finally { await ui.close(); }
});

test('all history pages are reachable, unique, counted and end with no older-page control', async () => {
  const api = fakeApi({ sent: async (n) => page(Array.from({ length: n === 3 ? 5 : 20 }, (_, i) => row(String((n - 1) * 20 + i))), 45, n) });
  const ui = await mounted(api);
  try {
    assert.equal(ui.rows().length, 20); assert.match(ui.text(), /Showing 20 of 45/);
    await ui.press(ui.by('thread-history-more')); assert.equal(ui.rows().length, 40);
    await ui.press(ui.by('thread-history-more')); assert.equal(ui.rows().length, 45);
    assert.equal(ui.by('thread-history-more'), undefined); assert.match(ui.text(), /Showing 45 of 45/);
    assert.deepEqual(api.calls.filter(([name]) => name === 'sent').map(([, n, ref]) => [n, ref]), [[1, 'interviewee:11'], [2, 'interviewee:11'], [3, 'interviewee:11']]);
  } finally { await ui.close(); }
});

test('failed initial and older-page reads offer retry without empty claims or losing the person', async () => {
  let fail = true;
  const api = fakeApi({ sent: async (n) => { if (fail) throw new Error('Synthetic outage'); return page([row(n === 1 ? 'first' : 'last')], 21, n); } });
  const ui = await mounted(api);
  try {
    assert.match(ui.text(), /Unreadable: this conversation/); assert.doesNotMatch(ui.text(), /Nothing written/);
    fail = false; await ui.retry(); assert.match(ui.text(), /Message first/);
    fail = true; await ui.press(ui.by('thread-history-more'));
    assert.match(ui.text(), /Unreadable/); assert.match(ui.text(), /Message first/); assert.ok(ui.by('thread-history-more'));
    fail = false; await ui.press(ui.by('thread-history-more')); assert.match(ui.text(), /Message last/);
    assert.ok(api.calls.filter(([name]) => name === 'sent').every(([, , ref]) => ref === 'interviewee:11'));
  } finally { await ui.close(); }
});

test('late replies cannot replace another person or another account; overlapping page rows are reconciled by uid', async () => {
  const old = deferred(); let reads = 0;
  const api = fakeApi({ sent: async (_n, ref) => ++reads === 1 ? old.promise : page([row(ref === 'interviewee:12' ? 'ben' : 'current')]) });
  const ui = await mounted(api);
  try {
    await ui.navigate('interviewee:12'); assert.match(ui.text(), /Message ben/);
    old.resolve(page([row('ada-late')])); await ui.settle();
    assert.doesNotMatch(ui.text(), /ada-late/); assert.match(ui.text(), /Synthetic Ben/);
    await ui.user(3); assert.match(ui.text(), /Message ben/);
  } finally { await ui.close(); }
  const oldAccount = deferred(); let count = 0;
  const api2 = fakeApi({ sent: async () => ++count === 1 ? oldAccount.promise : page([row('current')], 21) });
  const ui2 = await mounted(api2);
  try {
    await ui2.user(3); oldAccount.resolve(page([row('previous-account')])); await ui2.settle();
    assert.doesNotMatch(ui2.text(), /previous-account/);
    await ui2.press(ui2.by('thread-history-more'));
    assert.equal(ui2.rows().length, 1, 'an overlapping uid is reconciled, never duplicated');
  } finally { await ui2.close(); }
});

test('unconfirmed history outcomes stay distinct from sent and refused on the mounted thread', async () => {
  const api = fakeApi({ sent: async () => page([row('pending', { status: 'pending' }), row('unknown', { status: 'uncertain' }), row('refused', { status: 'failed', error: 'Synthetic refusal.' }), row('accepted')]) });
  const ui = await mounted(api);
  try {
    assert.match(ui.text(), /Sending. The mail server has not answered yet/);
    assert.match(ui.text(), /Delivery is unconfirmed. Check your mailbox/);
    assert.match(ui.text(), /Not sent: Synthetic refusal/);
    assert.match(ui.text(), /Quoted: nothing/);
  } finally { await ui.close(); }
});

test('the global log labels unassociated history and preserves unconfirmed delivery wording', async () => {
  const api = fakeApi({ sent: async () => page([row('legacy', { person: null, status: 'uncertain' })]) });
  const ui = await mounted(api);
  try {
    await ui.settings();
    assert.match(ui.text(), /Conversation: Not recorded/);
    assert.match(ui.text(), /Delivery is unconfirmed/);
    assert.doesNotMatch(ui.text(), /Not sent:/);
  } finally { await ui.close(); }
});
