/**
 * D1309 (#2507, #2515, #2525) — Record a session's channels at their own
 * addresses, each pointing at where today's version of its boards is and at
 * the task that builds the rest.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_channels_d1309.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RecordChannelPage from '../src/pages/founder/RecordChannelPage.jsx';
import { INBOX, RECORD_CHANNELS, channelOf } from '../src/pages/founder/recordChannels.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

test('three channels, each at its own address, each naming its task', () => {
  assert.deepEqual(RECORD_CHANNELS.map((c) => c.to), ['/validate/record/whatsapp', '/validate/record/telegram', '/validate/record/calls']);
  assert.deepEqual(RECORD_CHANNELS.map((c) => c.task), [2507, 2515, 2525]);
  assert.equal(channelOf('/validate/record/telegram').key, 'telegram');
  assert.equal(channelOf('/validate/record/calls/').key, 'calls');
  // Mutation checked: fall back to WhatsApp for any segment → 'live' reads as a channel.
  assert.equal(channelOf('/validate/record/live'), null);
  assert.equal(channelOf('/validate/record'), null);
});

test('App.jsx serves each address as a static route, so /validate/:slug/:id never reads it as a record', () => {
  const app = read('frontend/src/App.jsx');
  // Mutation checked: drop a route → its channel falls to CycleRoute's record mode.
  for (const c of RECORD_CHANNELS) {
    assert.match(app, new RegExp(`path="${c.to}" element=\\{guard\\(labRoles\\(\\['admin', 'founder'\\]\\), <RecordChannelPage />\\)\\}`), c.to);
  }
});

async function mount(path) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(RecordChannelPage))));
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}

// D862 (#2507) and D869 (#2515) build WhatsApp's and Telegram's boards, so their pages draw the tool;
// record_whatsapp_d862.test.mjs and record_telegram_d869.test.mjs mount them.
for (const c of RECORD_CHANNELS.filter((x) => x.key === 'calls')) {
  test(`${c.label}: its tabs, where today's version is, and the task that builds the rest`, async () => {
    const w = await mount(c.to);
    try {
      assert.ok(byId(w.container, `record-channel-${c.key}`), 'the page is this channel\'s');
      for (const t of RECORD_CHANNELS) assert.ok(byId(w.container, `record-tab-${t.key}`), t.key);
      assert.equal(props(byId(w.container, 'record-channel-connect')).href, c.connect);
      if (c.key === 'calls') assert.equal(byId(w.container, 'record-channel-inbox'), undefined, 'calls have no chats inbox');
      else assert.equal(props(byId(w.container, 'record-channel-inbox')).href, INBOX);
      const wait = text(byId(w.container, 'record-channel-wait'));
      // Mutation checked: name the wrong task → the number fails.
      assert.match(wait, new RegExp(`Task #${c.task} \\(${c.decision}\\)`));
      assert.ok(wait.includes(c.boards));
    } finally { await w.done(); }
  });
}
