/**
 * D754 f1 (#1959) — WhatsApp Business on its own page,
 * `/account/connectors/whatsapp`, in every D754 §11 state for way A:
 * `whatsappPageState` for a member and for a Super Admin (the canary line and
 * the missing secret names are a Super Admin's only), and `WhatsAppPageBody`
 * in #1958's frame: Connect opens Meta's popup through the signup launcher and
 * never redirects, Disconnect asks with its note, chats waiting link to the
 * inbox, and the calls line. No test calls a provider: the SDK is stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/whatsapp_page_d754.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  INBOX_HREF, SWITCHED_OFF_WHY, UNAVAILABLE_WHY, WHATSAPP_PAGE, WHATSAPP_SIGNUP_NOT_CONFIGURED,
  disconnectNote, readOverview, whatsappPageState,
} from '../src/pages/account/channelsModel.js';
import { WhatsAppPageBody, useWhatsAppSignup } from '../src/pages/account/ChannelsGroup.jsx';
import { ChannelPageView } from '../src/pages/account/ChannelPage.jsx';

const h = React.createElement;
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const MEMBER = { id: 7, role: 'founder', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const SIGNUP = { app_id: '1234567890', config_id: '9876543210', graph_version: 'v23.0' };
const MISSING = ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'];
const CONN = { status: 'active', external_account_name: '•••• 1234', calls: { sentence: 'Calls: not yet. This number is outside the regions Meta allows.' } };

/** `GET /api/channels` as the Worker answers it (#1950: `rollout` to Super Admins, `missing` to admins). */
const overview = ({ available = true, signup = SIGNUP, missing = [], rollout, conn = null, pending = 0 } = {}) => readOverview({
  providers: [{ provider: 'whatsapp', available, missing, ...(rollout ? { rollout } : {}), ...(signup ? { signup } : {}) }, { provider: 'telegram', available: true }],
  connections: conn ? { whatsapp: conn } : {},
  pending: { whatsapp: pending, telegram: 0 },
});

// ================================================================ whatsappPageState, one case per §11 row

test('secrets unset: Not available yet for both; the missing names for a Super Admin only', () => {
  const o = overview({ available: false, signup: null, missing: MISSING });
  const m = whatsappPageState(o, MEMBER);
  assert.equal(m.state, 'unavailable');
  assert.equal(m.why, UNAVAILABLE_WHY);
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.notices, []);
  assert.equal(m.canConnect, false);
  const s = whatsappPageState(o, SUPER);
  assert.equal(s.state, 'unavailable');
  assert.deepEqual(s.missing, MISSING);
  assert.deepEqual(s.notices, [`${WHATSAPP_PAGE.missing} ${MISSING.join(', ')}`]);
  // An admin who is not a Super Admin is a member here, whatever the Worker sent.
  assert.deepEqual(whatsappPageState(o, { role: 'admin', is_super_admin: 0 }).notices, []);
  // Only WhatsApp's names are kept by the read.
  const zoom = readOverview({ providers: [{ provider: 'zoom', available: false, missing: ['ZOOM_CLIENT_ID'] }] });
  assert.deepEqual(zoom.providers.zoom.missing, []);
});

test('canary: a member reads Not available yet and has no Connect; a Super Admin gets the canary line, then the states below', () => {
  // The Worker answers available:false to a member in canary, and sends no rollout.
  const member = whatsappPageState(overview({ available: false, signup: null }), MEMBER);
  assert.equal(member.state, 'unavailable');
  assert.equal(member.canConnect, false);
  assert.deepEqual(member.notices, []);
  // A rollout a member somehow holds closes it too.
  const crafted = whatsappPageState(overview({ rollout: 'canary' }), MEMBER);
  assert.equal(crafted.state, 'unavailable');
  assert.equal(crafted.canConnect, false);
  assert.deepEqual(crafted.notices, [], 'the canary line is a Super Admin\'s only');
  const s = whatsappPageState(overview({ rollout: 'canary' }), SUPER);
  assert.deepEqual(s.notices, [WHATSAPP_PAGE.canary]);
  assert.equal(s.state, 'not_connected');
  assert.equal(s.canConnect, true);
  assert.equal(whatsappPageState(overview({ rollout: 'canary', conn: CONN }), SUPER).state, 'connected');
  assert.deepEqual(whatsappPageState(overview({ rollout: 'on' }), SUPER).notices, [], 'no canary line once on');
});

test('off, with a connection: Axal has switched this off for now', () => {
  const v = whatsappPageState(overview({ available: false, conn: CONN }), MEMBER);
  assert.equal(v.state, 'off_with_connection');
  assert.equal(v.why, SWITCHED_OFF_WHY);
  assert.equal(v.account, '•••• 1234');
  assert.equal(v.canConnect, false);
});

test('sign-up ids malformed: Not set up yet', () => {
  for (const signup of [null, { app_id: 'x', config_id: '9876543210' }, { app_id: '1234567890' }]) {
    const v = whatsappPageState(overview({ signup }), MEMBER);
    assert.equal(v.state, 'signup_not_configured', JSON.stringify(signup));
    assert.equal(v.why, WHATSAPP_SIGNUP_NOT_CONFIGURED);
    assert.equal(v.canConnect, false);
  }
});

test('not connected: Your business number, with Connect', () => {
  for (const user of [MEMBER, SUPER]) {
    const v = whatsappPageState(overview(), user);
    assert.equal(v.state, 'not_connected');
    assert.equal(v.canConnect, true);
  }
});

test('connected: the masked number and the number\'s own calls line', () => {
  const v = whatsappPageState(overview({ conn: CONN }), MEMBER);
  assert.equal(v.state, 'connected');
  assert.equal(v.account, '•••• 1234');
  assert.equal(v.calls, CONN.calls.sentence);
  assert.equal(v.canConnect, false);
});

test('needs attention: the access stopped working reads D754\'s line, with Connect again; another failure keeps its own words', () => {
  for (const conn of [{ ...CONN, status: 'revoked' }, { ...CONN, last_error: 'oauth_token_invalid' }, { ...CONN, status: 'needs_reconnect' }, { ...CONN, last_error: 'app unsubscribed' }]) {
    const v = whatsappPageState(overview({ conn }), MEMBER);
    assert.equal(v.state, 'needs_attention', JSON.stringify(conn));
    assert.equal(v.why, WHATSAPP_PAGE.needsAttention);
    assert.equal(v.canConnect, true);
  }
  const failed = whatsappPageState(overview({ conn: { ...CONN, last_error: 'timeout' } }), MEMBER);
  assert.equal(failed.state, 'needs_attention');
  assert.match(failed.why, /^The last attempt to reach WhatsApp failed\./);
  assert.equal(whatsappPageState(null, MEMBER).state, 'unreadable');
});

// ================================================================ the body

let seenAssign = 0;
async function mount(element) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  seenAssign = 0;
  globalThis.window.location.assign = () => { seenAssign += 1; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/account/connectors/whatsapp'] }, h(Routes, null, h(Route, { path: '*', element }))));
  });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    by,
    text: () => textOf(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

/** The body as the page mounts it, with its own signup flow. */
function Body({ o, user = MEMBER, sdk, api, pending = null }) {
  const signup = useWhatsAppSignup({ overview: o, api, sdk });
  return h(WhatsAppPageBody, { view: whatsappPageState(o, user), signup, pending, api });
}

test('Connect calls the signup launcher (stubbed) and never window.location.assign', async () => {
  const calls = [];
  const sdk = {
    load: async (opts) => { calls.push(['load', opts]); return { fake: true }; },
    run: async (opts) => { calls.push(['run', opts.configId]); return { code: 'c', waba_id: '1', phone_number_id: '2' }; },
  };
  const api = { connectWhatsApp: async (r) => { calls.push(['connect', r.code]); return { ok: true }; } };
  const m = await mount(h(Body, { o: overview(), sdk, api }));
  try {
    assert.ok(m.text().includes(WHATSAPP_PAGE.heading));
    assert.ok(m.text().includes(WHATSAPP_PAGE.connect));
    await m.click('button-connect-whatsapp'); // loads Meta's SDK on the click
    assert.ok(m.text().includes('Continue with Facebook'));
    await m.click('button-connect-whatsapp'); // opens Meta's window from the second click
    assert.deepEqual(calls.map((c) => c[0]), ['load', 'run', 'connect']);
    assert.equal(calls[0][1].appId, SIGNUP.app_id);
    assert.equal(calls[1][1], SIGNUP.config_id);
    assert.equal(seenAssign, 0, 'Connect redirected');
    assert.ok(m.text().includes('WhatsApp Business is connected.'));
  } finally { await m.unmount(); }
});

test('connected: chats waiting link to the inbox, Test, and Disconnect asks with its note; the calls line', async () => {
  const m = await mount(h(Body, { o: overview({ conn: CONN, pending: 3 }), pending: 3, api: { disconnect: async () => ({}) } }));
  try {
    const link = m.by('channel-pending-link');
    assert.ok(link, 'chats waiting');
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(Body, { o: overview({ conn: CONN, pending: 3 }), pending: 3 })));
    const tag = /<a [^>]*data-testid="channel-pending-link"[^>]*>/.exec(html)?.[0] || '';
    assert.ok(tag.includes(`href="${INBOX_HREF}"`), tag);
    assert.ok(m.text().includes('3 conversations waiting'));
    assert.ok(m.by('button-channel-test-whatsapp'), 'Test');
    assert.ok(m.text().includes(CONN.calls.sentence), 'the number\'s own calls line');
    assert.ok(m.text().includes('WhatsApp calls do not reach Axal; record a call with the in-app recorder instead.'));
    await m.click('button-channel-disconnect-whatsapp');
    assert.ok(m.by('channel-disconnect-confirm-whatsapp'));
    assert.ok(m.text().includes(disconnectNote('whatsapp')));
  } finally { await m.unmount(); }
});

test('each state draws its words, and only the states with Connect offer it', () => {
  const html = (o, user = MEMBER) => renderToStaticMarkup(h(MemoryRouter, null, h(Body, { o, user })));
  const cases = [
    [overview({ available: false, signup: null }), 'unavailable', UNAVAILABLE_WHY, false],
    [overview({ available: false, conn: CONN }), 'off_with_connection', SWITCHED_OFF_WHY, false],
    [overview({ signup: null }), 'signup_not_configured', WHATSAPP_SIGNUP_NOT_CONFIGURED, false],
    [overview(), 'not_connected', WHATSAPP_PAGE.connect, true],
    [overview({ conn: CONN }), 'connected', '•••• 1234', false],
    [overview({ conn: { ...CONN, status: 'revoked' } }), 'needs_attention', WHATSAPP_PAGE.needsAttention, true],
  ];
  for (const [o, state, words, connect] of cases) {
    const out = html(o);
    assert.match(out, new RegExp(`data-testid="whatsapp-page-body" data-state="${state}"`), state);
    assert.ok(flat(out).includes(words), `${state}: ${words}`);
    assert.equal(out.includes('data-testid="button-connect-whatsapp"'), connect, `${state}: Connect`);
    assert.ok(out.includes('data-testid="whatsapp-calls"'), `${state}: the calls line`);
  }
});

// ================================================================ part 2: the page

const page = (o, user) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/whatsapp'] },
  h(ChannelPageView, { channels: { status: 'ready', overview: o, reload() {} }, channelKey: 'whatsapp', user })));

test('/account/connectors/whatsapp draws the body in the frame, the notices in the notice region, and Connect in the band', () => {
  const o = overview({ rollout: 'canary', missing: MISSING });
  const s = page(o, SUPER);
  const connect = s.indexOf('data-testid="connector-page-connect"');
  assert.ok(connect > 0 && s.indexOf('data-testid="whatsapp-page-body"') > connect, 'the body is in Connect and manage');
  const notices = s.slice(s.indexOf('data-testid="connector-page-notices"'), connect);
  assert.ok(notices.includes(WHATSAPP_PAGE.canary), 'the canary line');
  assert.ok(notices.includes(MISSING[0]), 'the missing names');
  assert.ok(notices.indexOf(WHATSAPP_PAGE.canary) < notices.indexOf(WHATSAPP_PAGE.missing), '§11\'s order');
  assert.ok(s.includes('data-testid="button-band-connect-whatsapp"'), 'the band\'s Connect');
  // The member's page: no canary line, no names, no Connect.
  const member = page(overview({ available: false, signup: null, missing: MISSING }), MEMBER);
  assert.equal(member.includes('connector-page-notices'), false);
  for (const name of MISSING) assert.equal(member.includes(name), false, name);
  assert.equal(member.includes(WHATSAPP_PAGE.canary), false);
  assert.equal(member.includes('button-band-connect-whatsapp'), false);
  assert.equal(member.includes('button-connect-whatsapp'), false);
  // Telegram's page keeps its card and draws no WhatsApp body.
  const tg = renderToStaticMarkup(h(MemoryRouter, null, h(ChannelPageView, { channels: { status: 'ready', overview: o, reload() {} }, channelKey: 'telegram', user: SUPER })));
  assert.ok(tg.includes('data-testid="channel-card-telegram"'));
  assert.equal(tg.includes('whatsapp-page-body'), false);
  assert.equal(tg.includes('button-band-connect-whatsapp'), false);
});
