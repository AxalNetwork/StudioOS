/**
 * D4675 (#4675) — HQ's two durable acts on /admin/security say what is on
 * record: the DSR close and the trust-center Publish.
 *
 * Mounted against a stubbed Worker: each act names what was reviewed, carries
 * one key that every retry resends, and an answer that never came (or a
 * server failure) reads as unconfirmed, never as "nothing happened".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_ops_d4675.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import TrustContentPage from '../src/pages/hq/TrustContentPage.jsx';
import DsrOutcomeDialog from '../src/pages/hq/security/PrivacyActions.jsx';
import { REFUSALS, PUBLISH_UNCONFIRMED, publishRefusalText } from '../src/pages/hq/trustContentModel.js';
import { newOpKey } from '../src/lib/opKey.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TC = '/api/admin/security/trust-center';
const TOKEN = 'cd'.repeat(32);

const READ = () => ({
  blocks: [
    { key: 'security', label: 'Security', published: null, draft: { body: { intro: 'Draft words.', groups: [] }, checked_at: '2026-10-20', updated_at: '2026-10-20 10:00:00' } },
  ],
  subprocessors: [],
  reports: [],
  changes: { items: [], complete: true },
  subscribers: { confirmed: 0, pending: 0, unsubscribed: 0 },
  pending_token: TOKEN,
});

async function mount(element, handler) {
  const restore = installDocument();
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = String(init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    seen.push({ method, path: u.pathname, body });
    return handler({ method, path: u.pathname, body, n: seen.filter((s) => s.method === method && s.path === u.pathname).length });
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const byText = (text) => walk(document.body).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === text);
  return {
    seen, flush,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)) || {},
    async click(id) { const p = props(byId(id)); assert.ok(p?.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async press(text) { const p = props(byText(text)); assert.ok(p?.onClick, `no "${text}" button`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const p = props(byId(id)); assert.ok(p?.onChange, `no ${id} to type in`); await act(async () => { p.onChange({ target: { value } }); }); await flush(); },
    async submit(id) { const p = props(byId(id)); assert.ok(p?.onSubmit, `no ${id} to submit`); await act(async () => { await p.onSubmit({ preventDefault() {} }); }); await flush(); },
    typeIn: async (selector, value) => {
      const input = walk(document.body).find((n) => n.tagName === selector);
      const p = props(input); assert.ok(p?.onChange, `no ${selector}`);
      await act(async () => { p.onChange({ target: { value } }); }); await flush();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const posts = (seen, path) => seen.filter((s) => s.method === 'POST' && s.path === path);
const NOTE = 'Security: the sign-in line restated.';

async function openPublish(handler) {
  const m = await mount(h(TrustContentPage), (req) => (req.method === 'GET' && req.path === TC ? json(READ()) : handler(req)));
  await m.click('trust-content-publish');
  await m.type('trust-content-note', NOTE);
  return m;
}

// ------------------------------------------------------------ the key

test('an act key is a fresh, narrow token every time', () => {
  const a = newOpKey(), b = newOpKey();
  assert.match(a, /^op_[0-9a-f]{32}$/);
  assert.notEqual(a, b, 'two acts shared a key');
});

// ------------------------------------------------------------ Publish

test('Publish: no answer is UNCONFIRMED, the dialog stays, and Try again resends the SAME key', async () => {
  const m = await openPublish(({ path, n }) => {
    if (path !== `${TC}/publish`) return json({ ok: true });
    if (n === 1) throw new TypeError('Failed to fetch');
    return json({ ok: true, uid: 'tcc_1', blocks: ['security'], added: [], removed: [], replayed: true, notices: 'none' });
  });
  try {
    await m.click('trust-content-publish-go');
    assert.equal(m.of('trust-content-publish-error'), PUBLISH_UNCONFIRMED, 'a lost answer read as a refusal');
    assert.ok(m.has('trust-content-publish-dialog'));
    await m.click('trust-content-publish-go');
    const sent = posts(m.seen, `${TC}/publish`);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.publish_key, sent[1].body.publish_key, 'the retry carried a new key, so it could publish twice');
    assert.equal(sent[1].body.pending_token, TOKEN);
    assert.match(m.of('trust-content-notice'), /Already published by your earlier attempt\./,
      'the replayed answer was reported as a fresh publish');
  } finally { await m.unmount(); }
});

test('Publish: a server failure is unconfirmed too; a refusal is certain', async () => {
  assert.equal(publishRefusalText({ status: 503, code: 'not_confirmed', message: 'x' }), PUBLISH_UNCONFIRMED);
  assert.equal(publishRefusalText({ status: 500, message: 'boom' }), PUBLISH_UNCONFIRMED);
  assert.equal(publishRefusalText({}), PUBLISH_UNCONFIRMED);
  assert.equal(publishRefusalText({ status: 400, code: 'note_required', message: 'note_required' }), REFUSALS.note_required);
  assert.match(publishRefusalText({ status: 400, code: 'x_unknown', message: 'x_unknown' }), /Nothing was published/);
});

test('Publish: drafts changed since the dialog opened — it closes, re-reads, and says nothing was published', async () => {
  const m = await openPublish(({ path }) => (path === `${TC}/publish`
    ? json({ error: 'changed_since_review', code: 'changed_since_review', message: REFUSALS.changed_since_review }, 409)
    : json({ ok: true })));
  try {
    const readsBefore = m.seen.filter((s) => s.method === 'GET' && s.path === TC).length;
    await m.click('trust-content-publish-go');
    assert.equal(m.has('trust-content-publish-dialog'), false, 'the dialog kept listing drafts that are no longer pending');
    assert.equal(m.of('trust-content-notice'), REFUSALS.changed_since_review);
    assert.ok(m.seen.filter((s) => s.method === 'GET' && s.path === TC).length > readsBefore, 'the page did not re-read');
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------ the DSR close
// D4803 (slice 3): the close is SE06's Record outcome dialog
// (`security/PrivacyActions.jsx`), Scope → Review → Result. The D4675 rules
// are the same and so are these assertions: it names the reviewed request,
// one key per close resent on every retry, unconfirmed is not done, a request
// that changed underneath offers a reload and no second send.

const ROW = {
  key: 'open:7', open: true, label: 'DSR-0041', kind: 'Erasure', subject: 'founder@lumen.example', userId: 7,
  received: '1 Oct 2026', receivedFull: 'Thu 1 Oct 2026, 09:00 UTC', due: 'Sat 31 Oct 2026', remaining: '10 days',
  raw: { id: 7, requested_at: '2026-10-01 09:00:00', request_id: 41, days_left: 10 },
};
const CLOSE = '/api/admin/security/dsr/7/close';

async function openClose(handler, onRecorded = () => {}, onReread = () => {}) {
  const m = await mount(h(DsrOutcomeDialog, { row: ROW, onClose() {}, onRecorded, onReread }), (req) => handler(req));
  await m.type('dsr-outcome-denied', 'denied');
  await m.typeIn('TEXTAREA', 'retained under an open legal hold');
  await m.click('dsr-continue');
  return m;
}
const resultOf = (m) => m.props('dsr-result')['data-result'];

test('DSR close: it names the reviewed request, and a retry after no answer resends the SAME key', async () => {
  let done = 0;
  const m = await openClose(({ n }) => {
    if (n === 1) throw new TypeError('Failed to fetch');
    return json({ ok: true, replayed: true });
  }, () => { done += 1; });
  try {
    await m.click('dsr-confirm');
    assert.equal(resultOf(m), 'unconfirmed', 'a lost answer read as a failure or a success');
    assert.match(m.of('dsr-result'), /not confirmed/i);
    assert.equal(done, 0);
    await m.click('dsr-retry');
    await m.click('dsr-confirm');
    const sent = posts(m.seen, CLOSE);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body.requested_at, ROW.raw.requested_at, 'the close does not name the reviewed request');
    assert.equal(sent[0].body.request_id, ROW.raw.request_id);
    assert.equal(sent[0].body.outcome, 'denied');
    assert.match(String(sent[0].body.close_key), /^op_[0-9a-f]{32}$/);
    assert.equal(sent[0].body.close_key, sent[1].body.close_key, 'the retry carried a new key');
    assert.equal(resultOf(m), 'done');
    assert.match(m.of('dsr-result'), /already on record/);
    assert.equal(done, 1, 'a recorded close did not refresh the list');
  } finally { await m.unmount(); }
});

test('DSR close: 202 unconfirmed is shown as unconfirmed and the list is not refreshed as if done', async () => {
  let done = 0;
  const m = await openClose(() => json({ ok: false, code: 'outcome_unconfirmed', error: 'The close was sent, but whether it was recorded could not be read back.' }, 202), () => { done += 1; });
  try {
    await m.click('dsr-confirm');
    assert.equal(resultOf(m), 'unconfirmed');
    assert.match(m.of('dsr-result'), /could not be read back/);
    assert.equal(done, 0, 'an unconfirmed close was treated as done');
  } finally { await m.unmount(); }
});

test('DSR close: a stale or already-closed request offers a reload and no second send', async () => {
  for (const [code, extra, now] of [
    ['stale_request', { current_requested_at: '2026-10-05 08:00:00' }, /asked again on 5 Oct 2026/],
    ['no_open_request', { last_outcome: 'withdrawn', last_outcome_at: '2026-10-02 14:28:00' }, /Withdrawn by the requester at Fri 2 Oct 2026, 14:28 UTC/],
  ]) {
    let reread = 0;
    const m = await openClose(() => json({ error: `Nothing was recorded (${code}).`, code, ...extra }, 409), () => {}, () => { reread += 1; });
    try {
      await m.click('dsr-confirm');
      assert.equal(resultOf(m), 'changed', `${code}: a certain refusal read as something else`);
      assert.match(m.of('dsr-result'), /Nothing was saved/);
      assert.match(m.of('dsr-result'), now, `${code}: the dialog does not say what the request is now`);
      assert.doesNotMatch(m.of('dsr-result'), /not confirmed/i, `${code}: a certain refusal read as uncertain`);
      assert.equal(m.has('dsr-confirm'), false, `${code}: a second send is still offered`);
      assert.ok(m.has('dsr-copy-reason'), `${code}: the reason is not kept`);
      await m.click('dsr-reload');
      assert.equal(reread, 1);
      assert.equal(posts(m.seen, CLOSE).length, 1);
    } finally { await m.unmount(); }
  }
});

test('DSR close: choosing another outcome, or another reason, is another act, with a new key', async () => {
  const m = await openClose(() => { throw new TypeError('Failed to fetch'); });
  try {
    await m.click('dsr-confirm');
    await m.click('dsr-retry');
    await m.press('Back');
    await m.type('dsr-outcome-fulfilled', 'fulfilled');
    await m.typeIn('TEXTAREA', 'records purged on 2026-10-02, ticket DSR-14');
    await m.click('dsr-continue');
    await m.click('dsr-confirm');
    await m.click('dsr-retry');
    await m.press('Back');
    await m.typeIn('TEXTAREA', 'records purged on 2026-10-02, ticket DSR-15');
    await m.click('dsr-continue');
    await m.click('dsr-confirm');
    const sent = posts(m.seen, CLOSE);
    assert.equal(sent.length, 3);
    assert.equal(sent[1].body.outcome, 'fulfilled');
    assert.notEqual(sent[0].body.close_key, sent[1].body.close_key, 'a different outcome reused the first close\'s key');
    assert.notEqual(sent[1].body.close_key, sent[2].body.close_key, 'a different reason reused the earlier close\'s key');
  } finally { await m.unmount(); }
});

test('DSR close: Withdrawn is not offered, and a reason under the floor goes nowhere', async () => {
  const m = await mount(h(DsrOutcomeDialog, { row: ROW, onClose() {} }), () => json({ ok: true }));
  try {
    assert.equal(m.has('dsr-outcome-withdrawn'), false, 'HQ is offered a withdrawal, which is the subject\'s own act');
    assert.match(m.of('dsr-scope'), /It does not erase data\./);
    await m.typeIn('TEXTAREA', 'short');
    await m.click('dsr-continue');
    assert.equal(m.has('dsr-confirm'), false, 'a reason under the floor reached Review');
    assert.equal(posts(m.seen, CLOSE).length, 0);
  } finally { await m.unmount(); }
});
