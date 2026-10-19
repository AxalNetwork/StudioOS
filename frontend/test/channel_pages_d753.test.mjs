/**
 * D753 (#1958, task C1) — WhatsApp Business and Telegram Business on their own
 * pages, `/account/connectors/whatsapp` and `/account/connectors/telegram`, in
 * the connector page frame: `pageEntry` takes the channel keys from
 * `GET /api/channels` and never the catalogue, each page mounts its card,
 * Details carry no blank, an unknown provider is unknown, and the hub's cards
 * link to the pages. No test calls a provider: `fetch` is stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/channel_pages_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { readOverview } from '../src/pages/account/channelsModel.js';
import {
  CHANNEL_PAGE_KEYS, CHANNEL_PAGE_TEXT, channelDetailsRows, channelEntry, channelPageTitle, isChannelKey,
} from '../src/pages/account/channelPageModel.js';
import { pageEntry } from '../src/pages/account/connectorPageModel.js';
import { connectorPagePath } from '../src/pages/account/connectorsModel.js';
import ConnectorPage, { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { ChannelPageView } from '../src/pages/account/ChannelPage.jsx';
import { ChannelsGroup, TelegramChannelCard, WhatsAppChannelCard } from '../src/pages/account/ChannelsGroup.jsx';

const h = React.createElement;
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const RAW = {
  providers: [
    { provider: 'telegram', available: true }, { provider: 'whatsapp', available: false },
    { provider: 'zoom', available: true }, { provider: 'google_meet', available: true },
  ],
  connections: {},
  pending: { telegram: 0, whatsapp: 0 },
};
const OVERVIEW = readOverview(RAW);
const channels = (overview = OVERVIEW, status = 'ready') => ({ status, overview, reload() {} });
const html = (key, extra = {}, url = `/account/connectors/${key}`) =>
  renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(ChannelPageView, { channels: channels(), channelKey: key, ...extra })));

// ================================================================ the rules

test('the channel keys are the messaging providers, and only those', () => {
  assert.deepEqual([...CHANNEL_PAGE_KEYS].sort(), ['telegram', 'whatsapp']);
  for (const k of ['whatsapp', 'telegram']) assert.equal(isChannelKey(k), true, k);
  for (const k of ['zoom', 'google_meet', 'signal', '__proto__', 'constructor', 'toString', '', undefined]) assert.equal(isChannelKey(k), false, String(k));
  for (const k of CHANNEL_PAGE_KEYS) assert.equal(connectorPagePath(k), `/account/connectors/${k}`);
});

test('pageEntry reads a channel key from GET /api/channels, never from the catalogue', () => {
  // A catalogue that (wrongly) held a whatsapp row is not read for the page.
  const data = { status: 'ready', catalogue: [{ key: 'whatsapp', display_name: 'Spoof' }] };
  assert.deepEqual(pageEntry({ data, key: 'whatsapp', channels: channels() }), { state: 'ready', key: 'whatsapp' });
  assert.deepEqual(pageEntry({ data, key: 'telegram', channels: channels() }), { state: 'ready', key: 'telegram' });
  assert.deepEqual(pageEntry({ data, key: 'whatsapp' }), { state: 'unreadable' }, 'no overview read is unreadable, never the catalogue row');
  assert.deepEqual(pageEntry({ data, key: 'whatsapp', channels: { status: 'loading', overview: null } }), { state: 'loading' });
  assert.deepEqual(pageEntry({ data, key: 'whatsapp', channels: { status: 'unreadable', overview: null } }), { state: 'unreadable' });
  // Ready only when the read reports the provider.
  const onlyTelegram = readOverview({ ...RAW, providers: [{ provider: 'telegram', available: true }] });
  assert.deepEqual(pageEntry({ key: 'whatsapp', channels: channels(onlyTelegram) }), { state: 'unknown' });
  assert.deepEqual(channelEntry({ key: 'signal', channels: channels() }), { state: 'unknown' });
  // Every other key keeps F1's catalogue rules.
  assert.deepEqual(pageEntry({ data: { status: 'ready', catalogue: [] }, key: 'signal', channels: channels() }), { state: 'unknown' });
});

test('Details: Category, Status, Plan, Sign-in and Documentation, and an unread status is said', () => {
  const rows = channelDetailsRows('whatsapp', OVERVIEW);
  assert.deepEqual(rows.map((r) => r.label), ['Category', 'Status', 'Plan', 'Sign-in', 'Documentation']);
  assert.equal(rows[1].value, 'Not available yet');
  assert.equal(channelDetailsRows('telegram', OVERVIEW)[1].value, 'Live');
  assert.equal(rows[3].value, 'Meta sign-up');
  assert.equal(channelDetailsRows('telegram', OVERVIEW)[3].value, 'Telegram bot link');
  const unread = channelDetailsRows('whatsapp', readOverview({ ...RAW, providers: [{ provider: 'whatsapp' }] }))[1];
  assert.equal(unread.value, null);
  assert.ok(unread.reason, 'an unread status carries its reason');
  for (const k of CHANNEL_PAGE_KEYS) for (const r of channelDetailsRows(k, OVERVIEW)) assert.ok(r.value !== null || r.reason, `${k}: ${r.label}`);
  for (const k of CHANNEL_PAGE_KEYS) assert.match(CHANNEL_PAGE_TEXT[k].docs, /^https:\/\//);
  assert.equal(channelPageTitle({ state: 'ready', key: 'whatsapp' }), 'WhatsApp Business · Connectors · Axal VC');
  assert.equal(channelPageTitle({ state: 'unknown' }), 'Connectors · Axal VC');
});

// ================================================================ the pages

test('both pages draw the frame with their own card: band, Connect and manage, About and Details', () => {
  for (const [key, title, cardTestId] of [['whatsapp', 'WhatsApp Business', 'whatsapp-page-body'], ['telegram', 'Telegram Business', 'telegram-page-body']]) {
    const out = html(key);
    assert.match(out, new RegExp(`data-testid="connector-page" data-state="ready" data-key="${key}" data-channel="true"`), key);
    for (const id of ['connector-page-back', 'connector-page-band', 'connector-page-connect', 'connector-page-about', 'connector-page-details', cardTestId]) {
      assert.ok(out.includes(`data-testid="${id}"`), `${key}: ${id}`);
    }
    const text = flat(out);
    assert.ok(text.includes(title), `${key}: title`);
    assert.ok(text.includes(CHANNEL_PAGE_TEXT[key].tagline), `${key}: tagline`);
    for (const para of CHANNEL_PAGE_TEXT[key].about) assert.ok(text.includes(para), `${key}: About`);
    // One h1, the name.
    assert.equal((out.match(/<h1/g) || []).length, 1, key);
    // The card on its own page carries no link to itself.
    assert.equal(out.includes(`channel-page-link-${key}`), false, `${key}: the page links to itself`);
  }
  // WhatsApp's body in the frame (D754 f1, #1959): not available yet, with its calls line; Telegram's body (D756, #1979): Link Telegram.
  const wa = flat(html('whatsapp'));
  assert.ok(wa.includes('Axal has not switched this on yet.'), 'the unavailable words');
  assert.ok(wa.includes('WhatsApp calls do not reach Axal'), 'the calls line');
  assert.ok(html('telegram').includes('data-testid="button-link-telegram"'), 'Link Telegram');
});

test('the connected card keeps its Manage: Test and Disconnect from ConnectedActions', () => {
  const connected = readOverview({ ...RAW, providers: [{ provider: 'whatsapp', available: true }], connections: { whatsapp: { status: 'active', external_account_name: 'Acme', config: { number_masked: '•••• 1234' } } } });
  const out = html('whatsapp', { channels: channels(connected) });
  assert.ok(out.includes('data-testid="button-channel-test-whatsapp"'), 'Test');
  assert.ok(out.includes('data-testid="button-channel-disconnect-whatsapp"'), 'Disconnect');
});

test('loading, unreadable and an unreported channel each say so, inside the frame', () => {
  const loading = html('whatsapp', { channels: { status: 'loading', overview: null, reload() {} } });
  assert.ok(loading.includes('data-testid="connector-page-loading"'));
  const unreadable = flat(html('telegram', { channels: { status: 'unreadable', overview: null, reload() {} } }));
  assert.ok(unreadable.includes('This is not a claim that you have none.'));
  const missing = flat(html('whatsapp', { channels: channels(readOverview({ ...RAW, providers: [{ provider: 'telegram', available: true }] })) }));
  assert.ok(missing.includes('No connector called “whatsapp”.'));
});

test('an unknown provider (/account/connectors/signal) is unknown', () => {
  const out = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/signal'] },
    h(ConnectorPageView, { data: { status: 'ready', catalogue: [], reload() {} }, connectorKey: 'signal' })));
  assert.match(out, /data-state="unknown"/);
  assert.ok(flat(out).includes('No connector called “signal”.'));
});

// ================================================================ the dispatch

function mockFetch(routes) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    calls.push(`${init.method || 'GET'} ${path}`);
    const [status, body] = routes[`${init.method || 'GET'} ${path}`] || [404, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

test('/account/connectors/whatsapp reads GET /api/channels and nothing of the connectors catalogue', async () => {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const net = mockFetch({ 'GET /channels': [200, RAW] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/account/connectors/whatsapp'] }, h(Routes, null, h(Route, { path: '*', element: h(ConnectorPage, { connectorKey: 'whatsapp' }) }))));
    });
    await act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
    const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
    const text = textOf(container).replace(/\s+/g, ' ');
    assert.ok(text.includes(CHANNEL_PAGE_TEXT.whatsapp.tagline), text.slice(0, 300));
    assert.deepEqual(net.calls.filter((c) => !c.startsWith('GET /channels')), [], 'the channel page read something besides GET /api/channels');
    assert.ok(net.calls.includes('GET /channels'));
  } finally {
    await act(async () => root.unmount());
    net.restore();
    restoreDoc();
  }
});

// ================================================================ the links

test('the hub\'s Customer conversations cards link to their pages; an interview\'s cards do not', () => {
  const hub = renderToStaticMarkup(h(MemoryRouter, null, h(ChannelsGroup, { status: 'ready', overview: OVERVIEW, catalogue: [] })));
  for (const key of CHANNEL_PAGE_KEYS) {
    const tag = new RegExp(`<a [^>]*data-testid="channel-page-link-${key}"[^>]*>`).exec(hub)?.[0];
    assert.ok(tag, `${key}: no page link on the hub card`);
    assert.ok(tag.includes(`href="/account/connectors/${key}"`), tag);
  }
  assert.ok(hub.includes('id="interview-channels"'), 'the hub section keeps its anchor');
  // The cards as an interview's Connect panel draws them: no page link.
  const wa = renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppChannelCard, { card: { provider: 'whatsapp', state: 'unavailable', label: 'Not available yet', tone: 'neutral' }, overview: OVERVIEW })));
  const tg = renderToStaticMarkup(h(MemoryRouter, null, h(TelegramChannelCard, { card: { provider: 'telegram', state: 'not_connected', label: 'Not connected', tone: 'neutral' } })));
  assert.equal(wa.includes('channel-page-link-'), false);
  assert.equal(tg.includes('channel-page-link-'), false);
  // CHANNELS_HREF stays for the hub section, and Meta's SDK comment names the pages.
  assert.match(read('frontend/src/pages/account/channelsModel.js'), /CHANNELS_HREF = '\/account\/connectors#interview-channels'/);
  assert.match(read('frontend/src/pages/account/whatsappSignup.js'), /\/account\/connectors\/\*/);
});
