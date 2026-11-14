/** D1491 (#3725) — synthetic mounted UI tests for the real core wiring and explicit posting boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import EventSyndicationPanel from '../src/pages/events/EventSyndicationPanel.jsx';
import { ApproveDialog } from '../src/pages/admin/events/EventDialogs.jsx';
import { Channels, Activity, Settings } from '../src/pages/hq/eventSyndication/SyndicationTabs.jsx';
import { approveWithChannels, charCount, safeExternal } from '../src/pages/hq/eventSyndication/syndicationModel.js';

const h = React.createElement;
const ROW = { uid: 's-1', account_uid: 'eb', channel: 'eventbrite', display_name: 'Axal', adapter_ready: true, title_limit: 20, text_limit: 100, on: true, status: 'selected', overrides: { title: 'Saved title', description: 'Keep description', ticket_url: 'https://axal.vc/events/a' }, registrations: null };
const READ = { eligible: false, approved: false, reason: 'Not approved for the public calendar', rows: [ROW] };
const channelRows = [
  { channel: 'eventbrite', capability: 'creates_events', auth: 'oauth', adapter_ready: true, account: { uid: 'eb', status: 'active', display_name: 'Axal', default_on: true } },
  ...['google_business', 'linkedin', 'facebook'].map((channel) => ({ channel, adapter_ready: false, capability: null, auth: null, account: null })),
];
function fake(overrides = {}) {
  const calls = [];
  const record = (name, data) => async (...args) => { calls.push([name, ...args]); return typeof data === 'function' ? data(...args) : structuredClone(data); };
  const api = {
    forEvent: record('forEvent', READ), choose: record('choose', (id, rows) => ({ ...READ, rows: rows.map((r) => ({ ...ROW, ...r })) })),
    preview: record('preview', { title: 'Preview', text: 'Channel text', link: 'https://axal.vc/events/a', warnings: [] }),
    retry: record('retry', {}), withdraw: record('withdraw', {}),
    channels: record('channels', { channels: channelRows }), updateChannel: record('updateChannel', {}), disconnect: record('disconnect', {}), connect: record('connect', {}),
    settings: record('settings', { settings: { hosts: 'approved_events', default_channels_by_type: { meetup: ['eventbrite'] }, host_accounts: false } }),
    saveSettings: record('saveSettings', (settings) => ({ settings })),
    log: record('log', { rows: [{ id: 9, channel: 'eventbrite', action: 'post', outcome: 'failed', detail: 'Synthetic refusal', actor_name: null, http_status: 429 }], next: 9 }),
    ...overrides,
  };
  return { api, calls };
}
async function mounted(element) {
  const restore = installDocument();
  const prior = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  const render = async (v) => { await act(async () => { root.render(h(MemoryRouter, null, v)); await settle(); }); };
  await render(element);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '';
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    text: () => text(document.body), props: (id) => props(byId(id)), has: (id) => !!byId(id), render,
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} disabled`); await act(async () => { if (props(n).onClick) props(n).onClick({ preventDefault() {} }); else { let parent = n.parentNode; while (parent && !props(parent).onSubmit) parent = parent.parentNode; assert.ok(parent, 'submit form'); props(parent).onSubmit({ preventDefault() {} }); } await settle(); }); },
    async change(id, value) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value, checked: value } }); await settle(); }); },
    async settle() { await act(settle); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prior; restore(); },
  };
}

test('saved public draft: edit and preview send nothing; explicit save keeps other copy', async () => {
  const { api, calls } = fake();
  const page = await mounted(h(EventSyndicationPanel, { eventId: '42', editable: true, api }));
  try {
    assert.match(page.text(), /Not approved for the public calendar/);
    await page.change('syndication-copy-eb-title', 'New title');
    assert.match(page.text(), /9 \/ 20/);
    await page.click('syndication-preview-eb');
    assert.deepEqual(calls.find(([n]) => n === 'preview'), ['preview', '42', 'eb', { ...ROW.overrides, title: 'New title' }]);
    assert.equal(calls.some(([n]) => n === 'choose'), false);
    assert.match(page.text(), /Channel preview · nothing sent/);
    await page.click('syndication-save');
    assert.deepEqual(calls.find(([n]) => n === 'choose'), ['choose', '42', [{ account_uid: 'eb', on: true, overrides: { ...ROW.overrides, title: 'New title' } }]]);
    assert.match(page.text(), /Channels saved/);
    assert.match(page.text(), /Registrations: Not recorded/);
  } finally { await page.close(); }
});

test('approved event: explicit posting label, invalid bounds block saving and blank ticket uses event link', async () => {
  const { api, calls } = fake({ forEvent: async () => ({ ...READ, approved: true, eligible: true, reason: null }) });
  const page = await mounted(h(EventSyndicationPanel, { eventId: '42', editable: true, api }));
  try {
    assert.match(page.text(), /Save channels and post additions/);
    assert.match(page.text(), /queues a post immediately/);
    await page.change('syndication-copy-eb-title', 'x'.repeat(21));
    assert.equal(page.props('syndication-save').disabled, true);
    await page.change('syndication-copy-eb-title', 'Short');
    await page.change('syndication-copy-eb-ticket_url', 'http://example.test');
    assert.equal(page.props('syndication-save').disabled, true);
    await page.change('syndication-copy-eb-ticket_url', '');
    assert.equal(page.props('syndication-save').disabled, false);
    await page.click('syndication-save');
    assert.equal('ticket_url' in calls.find(([n]) => n === 'choose')[2][0].overrides, false);
  } finally { await page.close(); }
});

test('listing failure Retry and posted Withdraw require their explicit actions; unsafe URLs never render', async () => {
  const { api, calls } = fake({ forEvent: async () => ({ ...READ, rows: [{ ...ROW, status: 'failed', last_error: 'Try later' }, { ...ROW, uid: 's-2', account_uid: 'li', channel: 'linkedin', status: 'posted', external_url: 'javascript:alert(1)', sync_state: 'unsupported' }] }) });
  const page = await mounted(h(EventSyndicationPanel, { eventId: '42', api }));
  try {
    assert.match(page.text(), /Try later/);
    assert.doesNotMatch(page.text(), /View listing/);
    await page.click('syndication-retry-s-1');
    assert.deepEqual(calls.find(([n]) => n === 'retry'), ['retry', '42', 's-1']);
    await page.click('syndication-withdraw-s-2');
    assert.equal(calls.some(([n]) => n === 'withdraw'), false);
    assert.match(page.text(), /may need to be removed on the channel/);
    await page.click('syndication-withdraw-confirm');
    assert.deepEqual(calls.find(([n]) => n === 'withdraw'), ['withdraw', '42', 's-2']);
  } finally { await page.close(); }
});

test('read failures and malformed envelopes remain Unreadable, retry recovers the real empty state', async () => {
  let n = 0;
  const { api } = fake({ forEvent: async () => { n++; if (n === 1) throw new Error('offline'); if (n === 2) return {}; return { ...READ, rows: [] }; } });
  const page = await mounted(h(EventSyndicationPanel, { eventId: '42', api }));
  try {
    assert.match(page.text(), /Unreadable/); assert.doesNotMatch(page.text(), /No channel listings/);
    await page.click('syndication-read-retry'); assert.match(page.text(), /Unreadable/);
    await page.click('syndication-read-retry'); assert.match(page.text(), /No channel listings recorded/); assert.doesNotMatch(page.text(), /Unreadable/);
  } finally { await page.close(); }
});

test('old event response cannot replace the next event', async () => {
  let finish;
  const { api } = fake({ forEvent: (id) => id === 'old' ? new Promise((r) => { finish = r; }) : Promise.resolve({ ...READ, rows: [] }) });
  const page = await mounted(h(EventSyndicationPanel, { eventId: 'old', api }));
  try {
    assert.match(page.text(), /Reading channels/);
    await page.render(h(EventSyndicationPanel, { eventId: 'new', api }));
    await act(async () => { finish(READ); }); await page.settle();
    assert.match(page.text(), /No channel listings recorded/); assert.doesNotMatch(page.text(), /Will post on approval/);
  } finally { await page.close(); }
});

test('approve dialog reads choices and count; unreadable choices prevent approval', async () => {
  const { api, calls } = fake(); const confirmed = [];
  const props = { ev: { id: 42, title: 'Synthetic event', visibility: 'public' }, syndicationApi: api, onClose() {}, onConfirm: (v) => confirmed.push(v) };
  const page = await mounted(h(ApproveDialog, props));
  try {
    assert.match(page.text(), /Approve, publish and post to 1 channel/);
    await page.change('syndication-choice-eb', false);
    assert.equal(calls.some(([n]) => n === 'choose'), false);
    await page.click('events-approve-go');
    assert.deepEqual(confirmed, [{ feature: false, channels: [{ account_uid: 'eb', on: false }] }]);
    const bad = fake({ forEvent: async () => { throw new Error('unreadable'); } }).api;
    await page.render(h(ApproveDialog, { ...props, syndicationApi: bad }));
    assert.match(page.text(), /Unreadable/); assert.equal(page.props('events-approve-go').disabled, true);
  } finally { await page.close(); }
});

test('approval saves choices first, failed save stops approval, empty accounts need no write', async () => {
  const calls = [];
  const api = { choose: async () => { calls.push('choose'); } }; const admin = { approve: async () => { calls.push('approve'); return 'done'; } };
  assert.equal(await approveWithChannels(api, admin, 42, [ROW]), 'done');
  assert.deepEqual(calls, ['choose', 'approve']);
  calls.length = 0;
  await assert.rejects(approveWithChannels({ choose: async () => { throw new Error('refused'); } }, admin, 42, [ROW]), /refused/);
  assert.deepEqual(calls, []);
  await approveWithChannels(api, admin, 42, []); assert.deepEqual(calls, ['approve']);
});

test('HQ account reads default state and disconnect needs confirmation; absent adapters cannot connect', async () => {
  const { api, calls } = fake(); const page = await mounted(h(Channels, { api }));
  try {
    assert.match(page.text(), /Connected/); assert.doesNotMatch(page.text(), /Luma|pending owner|service is being built/);
    assert.equal(page.props('syndication-connect-linkedin').disabled, true);
    assert.equal(page.props('syndication-default-eventbrite').checked, true);
    await page.change('syndication-default-eventbrite', false);
    assert.deepEqual(calls.find(([n]) => n === 'updateChannel'), ['updateChannel', 'eb', { default_on: false }]);
    await page.click('syndication-disconnect-eventbrite');
    assert.equal(calls.some(([n]) => n === 'disconnect'), false);
    assert.match(page.text(), /Already posted listings stay up/);
    await page.click('syndication-account-confirm-eventbrite');
    assert.deepEqual(calls.find(([n]) => n === 'disconnect'), ['disconnect', 'eb']);
  } finally { await page.close(); }
});

test('settings read stored defaults and save the edited grid with host accounts off', async () => {
  const { api, calls } = fake(); const page = await mounted(h(Settings, { api }));
  try {
    assert.equal(page.props('syndication-setting-meetup-eventbrite').checked, true);
    await page.change('syndication-setting-meetup-linkedin', true);
    assert.equal(calls.some(([n]) => n === 'saveSettings'), false);
    await page.click('syndication-settings-save');
    assert.deepEqual(calls.find(([n]) => n === 'saveSettings')[1], { hosts: 'approved_events', default_channels_by_type: { meetup: ['eventbrite', 'linkedin'] }, host_accounts: false });
    assert.match(page.text(), /Settings saved/); assert.match(page.text(), /HQ accounts only/);
  } finally { await page.close(); }
});

test('activity filters call the store, older follows cursor, changing filter resets it and detail shows failure', async () => {
  const { api, calls } = fake(); const page = await mounted(h(Activity, { api }));
  try {
    assert.match(page.text(), /Failed/); assert.doesNotMatch(page.text(), /No activity matches/);
    await page.click('syndication-log-older');
    assert.equal(calls.filter(([n]) => n === 'log').at(-1)[1].before, 9);
    await page.change('syndication-log-channel', 'eventbrite');
    await page.change('syndication-log-event', '42');
    await page.click('syndication-log-filter');
    assert.deepEqual(calls.filter(([n]) => n === 'log').at(-1)[1], { event: '42', channel: 'eventbrite', outcome: '', before: null, limit: 25 });
    await page.click('syndication-log-detail-9'); assert.match(page.text(), /Synthetic refusal/); assert.match(page.text(), /429/);
  } finally { await page.close(); }
});

test('external addresses and counters follow the Worker bounds', () => {
  assert.equal(safeExternal('javascript:alert(1)'), null);
  assert.equal(safeExternal('https://user:secret@example.test'), null);
  assert.equal(safeExternal('https://example.test/path'), 'https://example.test/path');
  assert.equal(charCount('😀', 1).over, true);
});

test('HQ failed reads are Unreadable; refused settings and connection writes cannot claim success', async () => {
  for (const [Component, method] of [[Channels, 'channels'], [Settings, 'settings'], [Activity, 'log']]) {
    const { api } = fake({ [method]: async () => { throw new Error('offline'); } });
    const page = await mounted(h(Component, { api }));
    try { assert.match(page.text(), /Unreadable/); assert.doesNotMatch(page.text(), /No activity matches|Settings saved|Not connected/); }
    finally { await page.close(); }
  }
  const { api } = fake({ saveSettings: async () => { throw new Error('Write refused'); } });
  const settings = await mounted(h(Settings, { api }));
  try { await settings.click('syndication-settings-save'); assert.match(settings.text(), /Write refused/); assert.doesNotMatch(settings.text(), /Settings saved/); }
  finally { await settings.close(); }
  const unconnected = channelRows.map((r) => r.channel === 'eventbrite' ? { ...r, account: null } : r);
  const bad = fake({ channels: async () => ({ channels: unconnected }), connect: async () => ({ authorize_url: 'javascript:alert(1)' }) });
  const channels = await mounted(h(Channels, { api: bad.api }));
  try {
    await channels.click('syndication-connect-eventbrite'); assert.equal(bad.calls.some(([n]) => n === 'connect'), false);
    await channels.click('syndication-account-confirm-eventbrite'); assert.match(channels.text(), /connection address is invalid/);
  } finally { await channels.close(); }
});

test('posted copy is read-only; failed choice save stays refused without a success claim', async () => {
  const { api, calls } = fake({ forEvent: async () => ({ ...READ, rows: [{ ...ROW, status: 'posted' }] }) });
  const posted = await mounted(h(EventSyndicationPanel, { eventId: '42', editable: true, api }));
  try { assert.equal(posted.has('syndication-copy-eb-title'), false); assert.equal(posted.props('syndication-choice-eb').disabled, true); assert.equal(posted.has('syndication-save'), false); assert.equal(calls.some(([n]) => n === 'choose'), false); }
  finally { await posted.close(); }
  const bad = fake({ choose: async () => { throw new Error('Choice refused'); } });
  const failed = await mounted(h(EventSyndicationPanel, { eventId: '42', editable: true, api: bad.api }));
  try { await failed.change('syndication-copy-eb-title', 'Edited title'); await failed.click('syndication-save'); assert.match(failed.text(), /Choice refused/); assert.doesNotMatch(failed.text(), /Channels saved/); }
  finally { await failed.close(); }
});
