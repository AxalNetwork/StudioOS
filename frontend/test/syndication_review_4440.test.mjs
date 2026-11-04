/** D4440 (#4440): regressions for all eight confirmed post-merge syndication findings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import EventSyndicationPanel from '../src/pages/events/EventSyndicationPanel.jsx';
import SyndicationAsk from '../src/pages/events/SyndicationAsk.jsx';
import EventEditorPage from '../src/pages/events/EventEditorPage.jsx';
import { askableRows } from '../src/pages/events/syndicationAskModel.js';
import { ApproveDialog } from '../src/pages/admin/events/EventDialogs.jsx';
import { Channels, Settings } from '../src/pages/hq/eventSyndication/SyndicationTabs.jsx';
import { choicesOf, copyInvalid, copyOf } from '../src/pages/hq/eventSyndication/syndicationModel.js';
import { parseSettings } from '../../cloudflare-worker/src/services/eventSyndication/eligibility.ts';

const h = React.createElement;
const row = (uid = 'eb', extra = {}) => ({ uid: 's-' + uid, account_uid: uid, channel: 'eventbrite', display_name: uid,
  on: true, adapter_ready: true, status: 'selected', title_limit: 60, text_limit: 300,
  overrides: { title: 'Old title', description: 'Kept description' }, ...extra });
const read = (rows = [row()]) => ({ eligible: true, approved: false, reason: null, rows });
const props = (node) => Object.entries(node || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const text = (node) => node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '';
async function mounted(element, url = '/') {
  const restore = installDocument(), prior = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const find = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  async function invoke(node, key, event = {}) {
    assert.ok(node, 'control exists');
    assert.ok(!props(node).disabled, 'control is enabled');
    await act(async () => { await props(node)[key](event); await settle(); });
  }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element })))); await settle(); });
  return { nodes, find, text: () => text(document.body), props: (id) => props(find(id)),
    click: (id) => invoke(find(id), 'onClick'), change: (id, value) => invoke(find(id), 'onChange', { target: { value, checked: value } }),
    clickText: (value) => invoke(nodes().find((n) => n.tagName === 'BUTTON' && text(n).trim() === value), 'onClick'),
    radio: (value) => invoke(nodes().find((n) => n.tagName === 'INPUT' && props(n).type === 'radio' && props(n).value === value), 'onChange'),
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prior; restore(); } };
}

test('1: both saved admin-only settings and its radio use the Worker parseSettings contract', async () => {
  let saved = { hosts: 'admins', host_accounts: false, default_channels_by_type: {} };
  const api = { settings: async () => ({ settings: saved }), saveSettings: async (value) => { saved = parseSettings(value); assert.ok(saved, 'Worker accepts the submitted radio value'); return { settings: saved }; } };
  const page = await mounted(h(Settings, { api }));
  try {
    assert.doesNotMatch(page.text(), /Unreadable/);
    await page.radio('approved_events'); await page.radio('admins'); await page.click('syndication-settings-save');
    assert.equal(saved.hosts, 'admins');
    assert.match(page.text(), /Settings saved/);
  } finally { await page.close(); }
});

test('2–3: only dirty, connected, nonterminal rows leave choicesOf; toggling alone sends no stale copy', () => {
  const rows = [row('clean'), row('edit'), row('toggle'), row('gone', { adapter_ready: false }),
    ...['withdrawn', 'cancelled', 'skipped', 'posted'].map((status) => row(status, { status }))];
  const dirty = new Set(rows.filter((r) => r.account_uid !== 'clean').map((r) => r.account_uid));
  assert.deepEqual(choicesOf(rows, dirty, new Set(['edit'])), [
    { account_uid: 'edit', on: true, overrides: rows[1].overrides }, { account_uid: 'toggle', on: true },
  ]);
  assert.deepEqual(choicesOf(rows, new Set()), []);
  assert.deepEqual(askableRows(read(rows)).map((r) => r.account_uid), ['clean', 'edit', 'toggle']);
});

test('2–3: an unrelated panel Save neither sends historical rows nor a disconnected account', async () => {
  const rows = [row('edit'), row('clean'), row('gone', { adapter_ready: false }), ...['withdrawn', 'cancelled', 'skipped', 'posted'].map((status) => row(status, { status }))];
  const writes = [];
  const api = { forEvent: async () => read(rows), choose: async (_id, choices) => { writes.push(choices); return read(rows); } };
  const page = await mounted(h(EventSyndicationPanel, { eventId: 42, editable: true, api }));
  try {
    await page.change('syndication-copy-edit-title', 'Edited title'); await page.click('syndication-save');
    assert.deepEqual(writes, [[{ account_uid: 'edit', on: true, overrides: { title: 'Edited title', description: 'Kept description' } }]]);
    assert.equal(page.props('syndication-choice-skipped').disabled, true);
    assert.equal(page.props('syndication-choice-gone').disabled, true);
  } finally { await page.close(); }
});

test('4: accepting Ask copy rereads the panel; another row Save cannot overwrite the accepted title', async () => {
  let rows = [row('eb'), row('other')]; const writes = [];
  const syn = { forEvent: async () => read(rows),
    assistQuote: async () => ({ ai: true, hold_microusd: 100, model: 'synthetic' }),
    assist: async () => ({ proposals: [{ uid: 'p1', status: 'proposed', payload: { account_uid: 'eb', channel: 'eventbrite', field: 'title', value: 'Accepted title' } }] }),
    choose: async (_id, choices) => { writes.push(choices); rows = rows.map((r) => { const changed = choices.find((v) => v.account_uid === r.account_uid); return changed ? { ...r, ...changed } : r; }); return read(rows); } };
  function Editor() { const [refresh, setRefresh] = useState(0); return h(React.Fragment, null,
    h(EventSyndicationPanel, { eventId: 42, editable: true, api: syn, refresh }),
    h(SyndicationAsk, { eventId: 42, api: { syndication: syn, proposals: { decide: async () => ({}) } }, onSaved: () => setRefresh((v) => v + 1) })); }
  const page = await mounted(h(Editor));
  try {
    await page.click('syndication-ask-open-eb'); await page.click('syndication-ask-run'); await page.click('syndication-card-accept-p1');
    assert.equal(page.props('syndication-copy-eb-title').value, 'Accepted title');
    await page.change('syndication-copy-other-description', 'Other copy'); await page.click('syndication-save');
    assert.equal(rows[0].overrides.title, 'Accepted title');
    assert.deepEqual(writes.at(-1).map((r) => r.account_uid), ['other']);
  } finally { await page.close(); }
});

test('5: private/unlisted approval needs no channel read and offers no posting choices', async () => {
  for (const visibility of ['private', 'unlisted']) {
    const writes = [], reads = [];
    const page = await mounted(h(ApproveDialog, { ev: { id: 42, title: 'Synthetic', visibility }, onClose() {}, onConfirm: (value) => writes.push(value), syndicationApi: { forEvent: async () => { reads.push(1); throw Error('offline'); } } }));
    try {
      assert.match(page.text(), /Private events are never posted/);
      assert.doesNotMatch(page.text(), /Will also post to|post to 1 channel/);
      await page.click('events-approve-go'); assert.deepEqual(writes, [{ feature: false, channels: [] }]);
      assert.deepEqual(reads, []);
    } finally { await page.close(); }
  }
});

test('5: approval counts only eligible saved or edited selections, not disconnected, terminal or unsaved suggestions', async () => {
  const rows = [row('live'), row('gone', { adapter_ready: false }), row('default', { uid: null, status: null }), row('skipped', { status: 'skipped' }), row('failed', { status: 'failed' })];
  const confirmed = [];
  const page = await mounted(h(ApproveDialog, { ev: { id: 42, title: 'Synthetic', visibility: 'public' }, onClose() {}, onConfirm: (v) => confirmed.push(v), syndicationApi: { forEvent: async () => read(rows) } }));
  try { assert.match(page.text(), /post to 1 channel/); await page.click('events-approve-go'); assert.deepEqual(confirmed, [{ feature: false, channels: [] }]); }
  finally { await page.close(); }
});

test('6: the real event editor main Save keeps an unsaved channel choice', async () => {
  const original = globalThis.fetch; let reads = 0;
  const ev = { id: 42, title: 'Synthetic', slug: 'synthetic', starts_at: '2099-03-01T18:00:00Z', timezone: 'UTC', visibility: 'public', status: 'draft' };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'https://synthetic.test').pathname;
    let body = {};
    if (path === '/api/events/42/syndication') { reads++; body = read([row('eb', { on: false })]); }
    else if (path === '/api/events/42') body = { event: ev, agenda: [] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  let page;
  try {
    page = await mounted(h(Routes, null, h(Route, { path: '/events/:id/edit', element: h(EventEditorPage) })), '/events/42/edit');
    await page.change('syndication-choice-eb', true); const before = reads; await page.clickText('Save changes');
    assert.equal(page.props('syndication-choice-eb').checked, true);
    assert.equal(reads, before);
  } finally { if (page) await page.close(); globalThis.fetch = original; }
});

test('7: a failed reconnect reloads after disconnect, so retry is a fresh Connect', async () => {
  let account = { uid: 'acc', display_name: 'Synthetic', status: 'active' }, disconnects = 0, connects = 0;
  const api = { channels: async () => ({ channels: ['eventbrite', 'google_business', 'linkedin', 'facebook'].map((channel) => ({ channel, adapter_ready: channel === 'eventbrite', auth: 'oauth', account: channel === 'eventbrite' ? account : null })) }),
    disconnect: async () => { disconnects++; account = { ...account, status: 'disconnected' }; }, connect: async () => { connects++; throw Error('Connect failed'); } };
  const page = await mounted(h(Channels, { api }));
  try {
    await page.click('syndication-connect-eventbrite'); await page.click('syndication-account-confirm-eventbrite');
    assert.equal(page.nodes().filter((n) => n.tagName === 'BUTTON' && text(n) === 'Reconnect…').length, 0);
    await page.click('syndication-connect-eventbrite'); await page.click('syndication-account-confirm-eventbrite');
    assert.deepEqual([disconnects, connects], [1, 2]);
  } finally { await page.close(); }
});

test('8: ticket links trim before the Worker regex and invalid internal whitespace has an inline error', async () => {
  const valid = row('eb', { overrides: { ticket_url: ' https://tickets.synthetic.test/path ' } });
  assert.equal(copyInvalid(valid), false);
  assert.equal(copyOf(valid.overrides).ticket_url, 'https://tickets.synthetic.test/path');
  const page = await mounted(h(EventSyndicationPanel, { eventId: 42, editable: true, api: { forEvent: async () => read() } }));
  try {
    await page.change('syndication-copy-eb-ticket_url', 'https://tickets.synthetic.test/ bad');
    assert.equal(page.props('syndication-copy-eb-ticket_url')['aria-invalid'], true);
    assert.match(page.text(), /https ticket link.*spaces/);
    assert.equal(page.props('syndication-save').disabled, true);
  } finally { await page.close(); }
});
