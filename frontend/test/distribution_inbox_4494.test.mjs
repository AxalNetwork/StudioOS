// D4494: actual Inbox components and clients; proposal acceptance never crosses the Send boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts, installDocument } from './_contracts_dom.mjs';
import InboxTab, { InboxNeedsYou, MessageBubble, ReplyComposer, useInboxUnread } from '../src/pages/cycles/distribution/InboxTab.jsx';
import DistributionTabs from '../src/pages/cycles/distribution/DistributionTabs.jsx';
import { acceptedReply, bookingHref, bubbleDirection, INBOX_EMPTY, INBOX_EMPTY_NOTE, unreadCount } from '../src/pages/cycles/distribution/inboxModel.js';
import { growInboxApi } from '../src/lib/api/growInbox.js';

const h = React.createElement;
const html = (node) => renderToStaticMarkup(h(MemoryRouter, null, node));
const THREAD = { contact: { uid: 'prospect-a', name: 'Synthetic Ari', organization: 'Synthetic Co' }, campaign: null, messages: [{ key: 'contact:1', direction: 'inbound', channel: 'email', at: '2026-11-03T10:00:00Z', body: 'Can we speak on Thursday?', subject: 'A demo' }] };
const DETAIL = { state: 'ready', thread: THREAD, recipient: 'synthetic@example.test', can_write: true, accounts: [{ uid: 'mailbox-a', address: 'own@example.test', status: 'active' }] };
const PROPOSAL = { uid: 'proposal-a', payload: { kind: 'reply', text: 'Thursday works. Here is my booking link.' } };
const descendants = (node) => [node, ...(node.childNodes ?? []).flatMap(descendants)];

test('empty and failed reads are different, with no fabricated channel connections or unread count', async () => {
  const counts = [];
  const api = { list: async () => ({ state: 'ready', threads: [], unread_count: 0, channels: [{ channel: 'linkedin', state: 'not_connected' }, { channel: 'whatsapp', state: 'not_connected' }] }) };
  const m = await mountContracts(h(InboxTab, { projectId: 7, api, onUnreadChange: (r) => counts.push(r.unread_count) }));
  try {
    await m.flush();
    assert.match(m.text(), new RegExp(INBOX_EMPTY.replace('.', '\\.')));
    assert.ok(m.text().includes(INBOX_EMPTY_NOTE));
    assert.match(m.text(), /LinkedIn · Not connected.*WhatsApp · Not connected/);
    assert.deepEqual(counts, [0]);
  } finally { await m.unmount(); }
  const failed = await mountContracts(h(InboxTab, { projectId: 7, api: { list: async () => { throw new Error('Synthetic private provider response'); } } }));
  try { await failed.flush(); assert.match(failed.text(), /Unreadable/); assert.doesNotMatch(failed.text(), /No replies yet|Synthetic private/); } finally { await failed.unmount(); }
});

test('Accept puts the actual reply in the composer and sends only after the final pressed confirmation', async () => {
  const calls = [];
  const api = { confirmSend: async (uid) => { calls.push(['confirm', uid]); return { nonce: 'synthetic-nonce' }; }, send: async (body) => { calls.push(['send', body]); return { sent: { uid: 'sent-a' } }; } };
  const m = await mountContracts(h(ReplyComposer, { projectId: 7, detail: DETAIL, proposal: PROPOSAL, api }));
  try {
    assert.deepEqual(calls, []);
    await m.click('Accept');
    const textarea = m.nodes().find((n) => n.tagName === 'TEXTAREA');
    assert.equal(m.props(textarea).value, PROPOSAL.payload.text);
    assert.deepEqual(calls, []);
    await m.click('Send');
    assert.deepEqual(calls, []);
    const confirm = descendants(document.body).find((n) => n.tagName === 'BUTTON' && m.props(n)?.children === 'Send reply');
    assert.ok(confirm, 'the final confirmation exists');
    await act(async () => { await Promise.all([m.props(confirm).onClick(), m.props(confirm).onClick()]); });
    assert.deepEqual(calls, [['confirm', 'mailbox-a'], ['send', { account_uid: 'mailbox-a', to: 'synthetic@example.test', subject: 'Re: A demo', body: PROPOSAL.payload.text, nonce: 'synthetic-nonce' }]]);
  } finally { await m.unmount(); }
});

test('Discard never fills or sends; non-reply proposals cannot become replies', async () => {
  const api = { confirmSend: async () => { throw new Error('must not send'); } };
  const m = await mountContracts(h(ReplyComposer, { projectId: 7, detail: DETAIL, proposal: PROPOSAL, api }));
  try { await m.click('Discard'); assert.equal(m.props(m.nodes().find((n) => n.tagName === 'TEXTAREA')).value, ''); assert.doesNotMatch(m.text(), /Suggested reply/); } finally { await m.unmount(); }
  assert.equal(acceptedReply({ payload: { kind: 'ad_creative', text: 'wrong kind' } }), null);
  assert.equal(acceptedReply({ payload: { kind: 'reply', text: 'original' }, decided_payload: { kind: 'reply', text: 'edited' } }), 'edited');
});

test('the Inbox tab badge is read from actual data and is absent while its count is unknown', async () => {
  const counted = html(h(DistributionTabs, { tab: 'inbox', inboxCount: 3 }, 'Synthetic Inbox'));
  const unknown = html(h(DistributionTabs, { tab: 'inbox', inboxCount: null }, 'Synthetic Inbox'));
  assert.match(counted, /class="ds-count">3/);
  assert.doesNotMatch(unknown, /class="ds-count"/);
  const counts = [];
  function Probe() { const state = useInboxUnread(7, { api }); counts.push(state.count); return h('span', null, state.count == null ? 'Unknown' : state.count); }
  const api = { unread: async () => ({ state: 'ready', count: 2, needs_you: { count: 2 } }) };
  const m = await mountContracts(h(Probe));
  try { await m.flush(); assert.equal(m.text(), '2'); assert.equal(counts[0], null); } finally { await m.unmount(); }
  assert.deepEqual([unreadCount(null), unreadCount(-1), unreadCount('4'), unreadCount(0)], [null, null, null, 0]);
});

test('bubble direction, Book a demo and Needs-you copy use only recorded facts', () => {
  const inbound = html(h(MessageBubble, { name: 'Synthetic Ari', message: THREAD.messages[0] }));
  const outbound = html(h(MessageBubble, { message: { ...THREAD.messages[0], direction: 'outbound', body: null, preview: false } }));
  assert.match(inbound, /inbox-bubble is-inbound/);
  assert.match(outbound, /inbox-bubble is-outbound/);
  assert.match(outbound, /Message body: Not recorded/);
  assert.deepEqual([bubbleDirection({ direction: 'outbound' }), bubbleDirection({ direction: 'inbound' })], ['outbound', 'inbound']);
  assert.equal(bookingHref('prospect-a'), '/calendar?new=1&with=prospect-a');
  const row = html(h(InboxNeedsYou, { reading: { state: 'ready', count: 4, needsYou: { organization: { name: 'Synthetic Co', count: 2 } } }, search: '?project_id=7' }));
  assert.match(row, /4 reply threads wait, 2 from Synthetic Co/);
  assert.match(row, /href="\/grow\/distribution\/inbox\?project_id=7"/);
  assert.equal(html(h(InboxNeedsYou, { reading: { state: 'loading', count: null } })), '');
});

test('the actual client encodes scopes and posts serialized read keys to the mounted route', async () => {
  const restore = installDocument(), saved = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push([String(url), options]); return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    await growInboxApi.list(7, 'a & b'); await growInboxApi.thread(7, 'prospect/a'); await growInboxApi.unread(7); await growInboxApi.read(7, 'prospect-a', ['contact:21']);
    assert.deepEqual(calls.map(([url]) => url.replace(/^.*\/api/, '/api')), ['/api/grow/inbox?project=7&q=a%20%26%20b', '/api/grow/inbox/prospect%2Fa?project=7', '/api/grow/inbox/unread-count?project=7', '/api/grow/inbox/prospect-a/read']);
    assert.equal(calls[3][1].method, 'POST');
    assert.deepEqual(JSON.parse(calls[3][1].body), { project: 7, message_keys: ['contact:21'] });
  } finally { globalThis.fetch = saved; restore(); }
});

test('search keeps its input mounted while a new read is pending', async () => {
  let resolveSearch;
  const api = { list: async (_project, q) => q ? new Promise((resolve) => { resolveSearch = resolve; }) : { state: 'ready', threads: [], unread_count: 0 } };
  const m = await mountContracts(h(InboxTab, { projectId: 7, api }));
  try {
    await m.flush();
    const input = m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Search replies');
    await m.fill('Search replies', 'Thursday');
    assert.equal(m.nodes().find((n) => m.props(n)?.['aria-label'] === 'Search replies'), input);
    assert.equal(m.props(input).value, 'Thursday');
    assert.ok(m.nodes().some((n) => m.props(n)?.['aria-label'] === 'Loading Inbox'));
    await act(async () => resolveSearch({ state: 'ready', threads: [], unread_count: 0 }));
    assert.match(m.text(), /No matching replies/);
  } finally { await m.unmount(); }
});

test('switching ventures clears the selected recipient and ignores a late thread response', async () => {
  const calls = []; let resolveThread;
  const api = {
    list: async (project) => ({ state: 'ready', unread_count: 1, threads: project === 7 ? [{ ...THREAD, unread: true, last_line: 'Synthetic last line' }] : [] }),
    thread: async (project, uid) => { calls.push([project, uid]); return new Promise((resolve) => { resolveThread = resolve; }); },
  };
  function Harness() { const [project, setProject] = React.useState(7); return h(React.Fragment, null, h('button', { onClick: () => setProject(8) }, 'Switch venture'), h(InboxTab, { projectId: project, api })); }
  const m = await mountContracts(h(Harness));
  try {
    await m.flush();
    const choose = m.nodes().find((n) => n.tagName === 'BUTTON' && m.props(n)?.className?.startsWith('inbox-thread'));
    await act(async () => m.props(choose).onClick());
    await m.click('Switch venture');
    await act(async () => resolveThread(DETAIL)); await m.flush();
    assert.deepEqual(calls, [[7, 'prospect-a']]);
    assert.doesNotMatch(m.text(), /Can we speak on Thursday|From your own mailbox|Synthetic Ari/);
    assert.match(m.text(), /No replies yet/);
  } finally { await m.unmount(); }
});
