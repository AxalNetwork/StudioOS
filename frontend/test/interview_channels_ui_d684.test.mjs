/**
 * D684 (#1575, S02 #1578) — interview channels, the screens: Connectors'
 * four cards in each state, Embedded Signup launched from the click, the
 * inbox with its thread view, assign and create, the reply composer's key on
 * a retry, an interview's Connect and Schedule a call panels, the channel
 * badge, the session page's waiting panel, and where each is mounted.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_channels_ui_d684.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';

import { ChannelsGroup, TelegramChannelCard, TelegramLinkSteps, WhatsAppChannelCard, ConnectedActions } from '../src/pages/account/ChannelsGroup.jsx';
import { channelCard, readOverview } from '../src/pages/account/channelsModel.js';
import ChannelsInboxPage, { AssignControls, MessageList, ReplyComposer } from '../src/pages/founder/ChannelsInbox.jsx';
import { ChannelSessionPanel, ConnectPanel, MeetingRow, SchedulePanel } from '../src/pages/founder/InterviewChannels.jsx';
import { AssistantBadge } from '../src/pages/founder/AssistantEntry.jsx';
import RecordSessionSheet from '../src/pages/founder/RecordSessionSheet.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));

async function mount(element, url = '/') {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    byTestId,
    props,
    flush,
    async click(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ stopPropagation() {}, preventDefault() {} }); }); await flush(); },
    async type(id, value) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

const RAW = {
  providers: [
    { provider: 'telegram', available: true, missing: [] },
    { provider: 'whatsapp', available: true, missing: [], signup: { app_id: '1234567890', config_id: '9876543210' } },
    { provider: 'zoom', available: false, missing: ['ZOOM_CLIENT_ID', 'ZOOM_WEBHOOK_SECRET_TOKEN'] },
    { provider: 'google_meet', available: true, missing: [] },
  ],
  connections: {
    telegram: { status: 'active', external_account_name: '@ada_shop', can_reply: true, business_connected: true },
    whatsapp: { status: 'active', external_account_name: 'Ada’s Bakery', waba_id: '104950000000001', phone_number_id: '106540000000002', external_account_id: '106540000000002' },
  },
  pending: { telegram: 2, whatsapp: 1 },
};
const FRESH = { providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }, { provider: 'zoom', available: true }, { provider: 'google_meet', available: true }], connections: {}, pending: { telegram: 0, whatsapp: 0 } };
const CATALOGUE = [
  { key: 'zoom', display_name: 'Zoom', available: true, connection: null },
  { key: 'google', display_name: 'Google Calendar', available: true, connection: { status: 'active', external_account_name: 'ada@example.test' } },
];

// ------------------------------------------------------------------ Connectors

test('the group draws four cards; a connected member sees names, tests, disconnects and the waiting count — never an id or a secret name', () => {
  const out = html(h(ChannelsGroup, { status: 'ready', overview: readOverview(RAW), catalogue: CATALOGUE }));
  const t = renderedText(out);
  assert.match(out, /id="interview-channels"/);
  assert.match(out, /data-testid="channel-card-telegram" data-state="connected"/);
  assert.match(out, /data-testid="channel-card-whatsapp" data-state="connected"/);
  assert.match(out, /data-testid="channel-card-zoom" data-state="unavailable"/);
  assert.match(out, /data-testid="channel-card-google_meet" data-state="connected"/);
  assert.match(t, /Telegram Business@ada_shopConnected/);
  assert.match(t, /WhatsApp BusinessAda’s BakeryConnected/);
  assert.match(t, /3 conversations waiting · Open the inbox/);
  assert.match(out, /href="\/validate\/inbox"/);
  assert.match(t, /Send test/);
  assert.match(t, /Test the connection/);
  assert.match(t, /Calls: not yet/);
  assert.match(t, /Needs Telegram Premium/);
  assert.match(t, /It cannot make or receive calls\./);
  assert.match(t, /Axal has not switched this on yet/);
  for (const secret of ['ZOOM_CLIENT_ID', 'WEBHOOK', '104950000000001', '106540000000002', '1234567890', '9876543210']) {
    assert.ok(!out.includes(secret), `${secret} is never drawn`);
  }
  assert.doesNotMatch(t, /delivered/i);
});

test('not connected: Link Telegram, Connect WhatsApp Business (off with "not set up yet" until the Worker hands out Meta’s ids), Connect Zoom', () => {
  const fresh = readOverview(FRESH);
  const t = text(h(ChannelsGroup, { status: 'ready', overview: fresh, catalogue: CATALOGUE, onOpenConnector() {} }));
  assert.match(t, /Link Telegram/);
  assert.match(t, /Connect WhatsApp Business/);
  assert.match(t, /Not set up yet: Meta’s sign-up is not configured on Axal\./);
  assert.match(t, /WhatsApp Business app keeps working on it/);
  assert.match(t, /Connect Zoom/);
  const wa = html(h(WhatsAppChannelCard, { card: channelCard('whatsapp', fresh), overview: fresh }));
  assert.match(wa.match(/<button[^>]*data-testid="button-connect-whatsapp"[^>]*>/)[0], /disabled=""/);
  const configured = readOverview({ ...FRESH, providers: [{ provider: 'whatsapp', available: true, signup: { app_id: '1234567890', config_id: '9876543210' } }] });
  const on = html(h(WhatsAppChannelCard, { card: channelCard('whatsapp', configured), overview: configured }));
  assert.doesNotMatch(on.match(/<button[^>]*data-testid="button-connect-whatsapp"[^>]*>/)[0], /disabled=""/);
  assert.doesNotMatch(on, /<script/, 'Meta’s SDK is not on the page before the click');
  const unread = text(h(ChannelsGroup, { status: 'unreadable', overview: null }));
  assert.match(unread, /could not be read\. This is not a claim that you have none\./);
});

test('Link Telegram shows the t.me button, the expiry and the Telegram Business steps; an expired link offers a new one', () => {
  const url = 'https://t.me/AxalStudioBot?start=Kp7mQ9xZ2bC4dF6gH8jK3mN5';
  const now = Date.parse('2026-10-13T10:00:00Z');
  const out = html(h(TelegramLinkSteps, { link: { url, expires_at: '2026-10-13T10:10:00Z' }, now, onCheck() {} }));
  assert.match(out, new RegExp(`href="${url.replace(/[?]/g, '\\?')}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`));
  const t = renderedText(out);
  assert.match(t, /Open Telegram/);
  assert.match(t, /Works once, until /);
  assert.match(t, /Settings › Telegram Business › Chatbots/);
  assert.match(t, /Add @AxalStudioBot as your chatbot/);
  assert.doesNotMatch(t, /Kp7mQ9xZ2bC4dF6gH8jK3mN5/, 'the code is in the link, never printed');
  assert.match(text(h(TelegramLinkSteps, { link: { url, expires_at: '2026-10-13T09:00:00Z' }, now })), /That link has expired\. Make a new one\./);
  assert.match(text(h(TelegramLinkSteps, { link: { url: 'https://evil.example/x', expires_at: '2026-10-13T10:10:00Z' }, now })), /could not make a Telegram link/);
  const linked = readOverview({ ...RAW, connections: { telegram: { status: 'active', external_account_name: '@ada', business_connected: false } } });
  const l = text(h(TelegramChannelCard, { card: channelCard('telegram', linked), onChanged() {} }));
  assert.match(l, /One step left/);
  assert.match(l, /Add the Axal bot in Telegram Business/);
});

test('Link Telegram asks the Worker for a link on the click', async () => {
  const calls = [];
  const api = { linkTelegram: async () => { calls.push('link'); return { code: 'x', url: 'https://t.me/AxalStudioBot?start=abcDEF234', expires_at: new Date(Date.now() + 600000).toISOString() }; } };
  const m = await mount(h(TelegramChannelCard, { card: channelCard('telegram', readOverview(FRESH)), api, onChanged() {} }));
  try {
    assert.deepEqual(calls, []);
    await m.click('button-link-telegram');
    assert.deepEqual(calls, ['link']);
    assert.ok(m.byTestId('link-open-telegram'));
    assert.equal(m.props(m.byTestId('link-open-telegram')).href, 'https://t.me/AxalStudioBot?start=abcDEF234');
  } finally { await m.unmount(); }
});

test('Connect WhatsApp Business: the SDK loads on the click, Meta’s window opens on the next one, and the result is sent to connect', async () => {
  const seen = [];
  const sdk = {
    load: async (o) => { seen.push(['load', o]); return { fake: 'FB' }; },
    run: (o) => { seen.push(['run', o.FB, o.configId]); return Promise.resolve({ code: 'AQB', waba_id: '111', phone_number_id: '222' }); },
  };
  const connected = [];
  let changed = 0;
  const api = { connectWhatsApp: async (b) => { connected.push(b); return { ok: true }; } };
  const o = readOverview({ ...FRESH, providers: [{ provider: 'whatsapp', available: true, signup: { app_id: '1234567890', config_id: '9876543210' } }] });
  const m = await mount(h(WhatsAppChannelCard, { card: channelCard('whatsapp', o), overview: o, api, sdk, onChanged() { changed += 1; } }));
  try {
    assert.deepEqual(seen, [], 'nothing from Meta before the click');
    await m.click('button-connect-whatsapp');
    assert.deepEqual(seen, [['load', { appId: '1234567890' }]]);
    assert.match(m.text(), /Continue with Facebook/);
    await m.click('button-connect-whatsapp');
    assert.deepEqual(seen[1], ['run', { fake: 'FB' }, '9876543210']);
    assert.deepEqual(connected, [{ code: 'AQB', waba_id: '111', phone_number_id: '222' }]);
    assert.equal(changed, 1);
    assert.match(m.text(), /WhatsApp Business is connected\./);
    assert.doesNotMatch(m.text(), /111|222|AQB/, 'no id or code is drawn');
  } finally { await m.unmount(); }
});

test('a closed Meta window is said in plain words, and nothing is connected', async () => {
  const { SignupError } = await import('../src/pages/account/whatsappSignup.js');
  const sdk = { load: async () => ({}), run: () => Promise.reject(new SignupError('cancelled')) };
  const connected = [];
  const o = readOverview({ ...FRESH, providers: [{ provider: 'whatsapp', available: true, signup: { app_id: '1234567890', config_id: '9876543210' } }] });
  const m = await mount(h(WhatsAppChannelCard, { card: channelCard('whatsapp', o), overview: o, sdk, api: { connectWhatsApp: async (b) => connected.push(b) } }));
  try {
    await m.click('button-connect-whatsapp');
    await m.click('button-connect-whatsapp');
    assert.match(m.text(), /You closed Meta’s window before finishing\. Nothing was connected\./);
    assert.deepEqual(connected, []);
  } finally { await m.unmount(); }
});

test('Disconnect asks first and says what goes; Send test reports acceptance only', async () => {
  const asking = text(h(ConnectedActions, { provider: 'telegram', initialConfirming: true }));
  assert.match(asking, /Disconnect Telegram\? New Telegram chats stop arriving, and conversations still waiting in your inbox are deleted\. Anything you already put in an interview stays there\./);
  const calls = [];
  let changed = 0;
  const api = { test: async (p) => { calls.push(['test', p]); return { ok: true, provider: p, sent: true }; }, disconnect: async (p) => { calls.push(['disconnect', p]); return { ok: true }; } };
  const m = await mount(h(ConnectedActions, { provider: 'telegram', api, onChanged() { changed += 1; } }));
  try {
    await m.click('button-channel-test-telegram');
    assert.match(m.text(), /accepted the message, not that it arrived/);
    await m.click('button-channel-disconnect-telegram');
    assert.deepEqual(calls, [['test', 'telegram']], 'the first press only asks');
    await m.click('button-channel-disconnect-yes-telegram');
    assert.deepEqual(calls, [['test', 'telegram'], ['disconnect', 'telegram']]);
    assert.equal(changed, 1);
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ the inbox

const NOW = Date.parse('2026-10-13T12:00:00Z');
const THREAD = {
  uid: 'th1', provider: 'whatsapp', contact_name: 'Ada Lovelace', status: 'pending', message_count: 2,
  last_message_at: '2026-10-13T09:00:00Z', last_inbound_at: '2026-10-13T09:00:00Z', interview_id: null,
  interviewee_name: null, session_id: null, can_reply: true, reply_window_open: true,
};
const MESSAGES = [
  { uid: 'm1', side: 'contact', kind: 'voice', text: 'We reconcile two systems by hand.', sent_at: '2026-10-13T08:59:00Z' },
  { uid: 'm2', side: 'me', kind: 'text', text: 'How long does it take?', sent_at: '2026-10-13T09:00:00Z' },
];

function inboxApi(over = {}) {
  const calls = [];
  const api = {
    overview: async () => RAW,
    threads: async (s) => { calls.push(['threads', s]); return { threads: s === 'pending' ? [THREAD, { ...THREAD, uid: 'th2', provider: 'telegram', contact_name: null, message_count: 1 }] : [] }; },
    thread: async (uid) => { calls.push(['thread', uid]); return { thread: THREAD, messages: MESSAGES }; },
    assign: async (uid, target) => { calls.push(['assign', uid, target]); return { ok: true, interview_id: 3, session_id: 44, moved: 2 }; },
    ignore: async (uid, ignored) => { calls.push(['ignore', uid, ignored]); return { ok: true, status: ignored ? 'ignored' : 'pending' }; },
    reply: async (uid, t, key) => { calls.push(['reply', uid, t, key]); return { ok: true, outbound: { status: 'submitted' } }; },
    ...over,
  };
  return { api, calls };
}
const SOURCE = {
  listProjects: async () => [{ id: 5, name: 'Northwind' }],
  listInterviews: async () => [{ id: 3, interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme', interview_date: '2026-10-01' }],
};

test('the inbox lists waiting conversations; a thread shows both sides and a transcribed voice note; assign sends the interview', async () => {
  const { api, calls } = inboxApi();
  const m = await mount(h(ChannelsInboxPage, { api, source: SOURCE, now: NOW }), '/validate/inbox');
  try {
    await m.flush();
    const t = m.text();
    assert.match(t, /Conversations/);
    assert.match(t, /Nothing reaches an interview until you assign it\./);
    assert.match(t, /Waiting In interviews Ignored/);
    assert.match(t, /Ada Lovelace WhatsApp 2 messages · 3 h ago/);
    assert.match(t, /Name not shared Telegram 1 message/);
    await m.click('thread-row-th1');
    await m.flush();
    const th = m.text();
    assert.match(th, /Ada Lovelace · Voice note \(transcribed\) We reconcile two systems by hand\./);
    assert.match(th, /You How long does it take\?/);
    assert.match(th, /Assign to an interview/);
    await m.type('select-assign-interview', '3');
    await m.click('button-assign');
    await m.flush();
    assert.deepEqual(calls.find((c) => c[0] === 'assign'), ['assign', 'th1', { interview_id: 3 }]);
    assert.match(m.text(), /Moved 2 messages into the interview with Dana Ruiz\./);
    assert.ok(m.byTestId('thread-assigned-now'));
  } finally { await m.unmount(); }
});

test('Create an interview from this chat: an explicit name, the sidebar’s venture named (never picked), then assign', async () => {
  const { api, calls } = inboxApi();
  const venture = { status: 'ready', project: { id: 5, name: 'Northwind' }, interviews: [], reload() {} };
  const out = text(h(AssignControls, { thread: THREAD, venture, initialMode: 'create' }));
  assert.match(out, /Create an interview from this chat/);
  assert.match(out, /Venture: Northwind \(the one chosen in the sidebar\)/);
  assert.doesNotMatch(html(h(AssignControls, { thread: THREAD, venture, initialMode: 'create' })), /<select/, 'no venture picker');
  let done = null;
  const m = await mount(h(AssignControls, { thread: THREAD, venture, api, initialMode: 'create', onAssigned: (r, label) => { done = [r, label]; } }));
  try {
    assert.equal(m.props(m.byTestId('input-create-interviewee')).value, 'Ada Lovelace', 'the contact’s name to start from');
    await m.type('input-create-interviewee', 'Ada L.');
    await m.click('button-create-and-assign');
    assert.deepEqual(calls.at(-1), ['assign', 'th1', { create: { interviewee_name: 'Ada L.', project_id: 5 } }]);
    assert.equal(done[1], 'Ada L.');
  } finally { await m.unmount(); }
  assert.match(text(h(AssignControls, { thread: THREAD, venture: { status: 'ready', project: null, interviews: [] } })), /No venture yet/);
});

test('the composer: disabled with the reason outside the window; a retry with no answer reuses the key, a refusal does not', async () => {
  const closed = html(h(ReplyComposer, { thread: { ...THREAD, reply_window_open: false } }));
  assert.match(closed, /data-enabled="false"/);
  assert.match(renderedText(closed), /WhatsApp only allows a free reply within 24 hours of the customer’s last message/);
  assert.match(closed.match(/<textarea[^>]*>/)[0], /disabled=""/);
  const tgClosed = renderedText(html(h(ReplyComposer, { thread: { ...THREAD, provider: 'telegram', reply_window_open: false } })));
  assert.match(tgClosed, /Telegram only lets the bot reply in chats active in the last 24 hours/);

  const keys = [];
  let attempt = 0;
  const api = {
    reply: async (uid, t, key) => {
      keys.push(key);
      attempt += 1;
      if (attempt === 1) throw new Error('Network error');
      if (attempt === 2) return { ok: true, outbound: { status: 'delivered' } };
      if (attempt === 3) throw Object.assign(new Error('More than 24 hours have passed.'), { status: 409, code: 'window_closed' });
      return { ok: true, outbound: { status: 'submitted' } };
    },
  };
  let n = 0;
  const m = await mount(h(ReplyComposer, { thread: { ...THREAD, provider: 'telegram' }, api, makeKey: () => `key-${++n}` }));
  try {
    await m.type('input-reply', 'Could we talk Thursday?');
    await m.click('button-reply-send');
    assert.match(m.text(), /Network error/);
    await m.click('button-reply-send');
    assert.deepEqual(keys, ['key-1', 'key-1'], 'no answer: the same key, so it cannot send twice');
    assert.equal(m.props(m.byTestId('reply-sent')).children, 'Sent', 'Telegram is Sent, never Delivered');
    await m.type('input-reply', 'Second message');
    await m.click('button-reply-send');
    await m.click('button-reply-send');
    assert.deepEqual(keys, ['key-1', 'key-1', 'key-2', 'key-3'], 'refused: that key is spent, the next press takes a new one');
  } finally { await m.unmount(); }
});

test('ignore and stop ignoring', async () => {
  const { api, calls } = inboxApi({ thread: async () => ({ thread: { ...THREAD, status: 'ignored', message_count: 0 }, messages: [] }) });
  const m = await mount(h(ChannelsInboxPage, { api, source: SOURCE, now: NOW }));
  try {
    await m.flush();
    await m.click('thread-row-th1');
    await m.flush();
    assert.match(m.text(), /Ignored: its waiting messages were deleted and new ones are dropped/);
    await m.click('button-unignore');
    assert.deepEqual(calls.find((c) => c[0] === 'ignore'), ['ignore', 'th1', false]);
  } finally { await m.unmount(); }
  assert.equal(html(h(MessageList, { messages: [], contact: 'x' })), '');
});

// ------------------------------------------------------------------ the interview's panels

test('Connect panel: the waiting chats, each assigned to THIS interview in one click', async () => {
  const { api, calls } = inboxApi();
  let assigned = null;
  const m = await mount(h(ConnectPanel, { interview: { id: 7, interviewee_name: 'Dana Ruiz' }, api, onAssigned: (r) => { assigned = r; }, now: NOW }));
  try {
    await m.flush();
    assert.match(m.text(), /Its messages become a Text session on this interview with Dana Ruiz/);
    assert.match(m.text(), /Ada Lovelace WhatsApp 2 messages · 3 h ago Assign here/);
    await m.click('button-assign-here-th1');
    assert.deepEqual(calls.find((c) => c[0] === 'assign'), ['assign', 'th1', { interview_id: 7 }]);
    assert.equal(assigned.session_id, 44);
    assert.ok(m.byTestId('link-inbox'));
  } finally { await m.unmount(); }
});

test('Connect panel with nothing connected: Telegram and WhatsApp are linked or connected in place', async () => {
  const { api } = inboxApi({ overview: async () => FRESH, threads: async () => ({ threads: [] }) });
  const m = await mount(h(ConnectPanel, { interview: { id: 7 }, api }));
  try {
    await m.flush();
    assert.ok(m.byTestId('connect-in-place'));
    assert.ok(m.byTestId('button-link-telegram'));
    assert.ok(m.byTestId('button-connect-whatsapp'));
  } finally { await m.unmount(); }
});

test('Schedule a call: Zoom or Meet, the body the Worker reads, and a refusal that points at Connectors', async () => {
  const sent = [];
  const api = {
    meetings: async () => ({ meetings: [], providers: [{ provider: 'zoom', available: true, connected: true }, { provider: 'google_meet', available: false, connected: false }] }),
    scheduleMeeting: async (id, body) => { sent.push([id, body]); throw Object.assign(new Error('Zoom no longer accepts Axal’s access. Reconnect Zoom in Account › Connectors, then retry.'), { status: 409, code: 'zoom_reconnect' }); },
  };
  const form = { provider: 'zoom', date: '2099-01-05', time: '10:00', duration: 30, topic: '' };
  const m = await mount(h(SchedulePanel, { interview: { id: 7, interviewee_name: 'Dana' }, api, initialForm: form }));
  try {
    await m.flush();
    assert.match(m.text(), /Calls over Telegram or WhatsApp cannot be recorded this way/);
    assert.match(m.text(), /Google Meet · not set up on Axal yet/);
    assert.equal(m.props(m.byTestId('meeting-provider-google_meet')).disabled, true);
    await m.click('button-schedule-meeting');
    assert.deepEqual(sent, [[7, { provider: 'zoom', starts_at: new Date('2099-01-05T10:00:00').toISOString(), duration_min: 30 }]]);
    assert.match(m.text(), /Zoom no longer accepts Axal’s access\. .* Open Connectors/);
  } finally { await m.unmount(); }
});

test('Schedule a call says what to fix before pressing, and repeats the Worker’s notice once scheduled', async () => {
  const notice = 'Google needs to be reconnected to allow transcripts: reconnect Google in Account › Connectors and allow Axal to read your Meet transcripts, then retry.';
  let listed = 0;
  const api = {
    meetings: async () => { listed += 1; return { meetings: [], providers: [{ provider: 'zoom', available: true, connected: false }, { provider: 'google_meet', available: true, connected: true, transcript_access: 'missing' }] }; },
    scheduleMeeting: async () => ({ meeting: { uid: 'r9' }, session_id: 50, notice: { code: 'meet_scope_missing', message: notice } }),
  };
  const form = (provider) => ({ provider, date: '2099-01-05', time: '10:00', duration: 30, topic: '' });
  const z = await mount(h(SchedulePanel, { interview: { id: 7 }, api, initialForm: form('zoom') }));
  try {
    await z.flush();
    assert.ok(z.byTestId('schedule-provider-note'));
    assert.match(z.text(), /Connect Zoom in Account › Connectors first\. Open Connectors/);
  } finally { await z.unmount(); }
  const m = await mount(h(SchedulePanel, { interview: { id: 7 }, api, initialForm: form('google_meet') }));
  try {
    await m.flush();
    assert.match(m.text(), /You can schedule now, but reconnect Google in Account › Connectors before the call/);
    await m.click('button-schedule-meeting');
    assert.ok(m.byTestId('schedule-notice'));
    assert.ok(m.text().includes(`Scheduled. ${notice}`));
    assert.equal(listed, 3, 'the list is read again after scheduling');
  } finally { await m.unmount(); }
});

test('a scheduled call shows its join link with Copy and Cancel (asked first); a failed one offers Try again', async () => {
  const ref = { uid: 'r1', provider: 'zoom', join_url: 'https://us02web.zoom.us/j/81234567890?pwd=abc', starts_at: '2099-01-05T09:00:00Z', ends_at: '2099-01-05T09:30:00Z', status: 'scheduled', session_id: 12 };
  const out = html(h('ul', null, h(MeetingRow, { meeting: ref, interview: { id: 7 }, now: NOW })));
  assert.match(out, /href="https:\/\/us02web\.zoom\.us\/j\/81234567890\?pwd=abc"/);
  assert.match(renderedText(out), /Scheduled for .*Copy.*Cancel the call/);
  const calls = [];
  const api = { cancelMeeting: async (i, u) => { calls.push(['cancel', i, u]); }, importMeeting: async (i, u) => { calls.push(['import', i, u]); } };
  const m = await mount(h('ul', null, h(MeetingRow, { meeting: ref, interview: { id: 7 }, api, now: NOW })));
  try {
    await m.click('button-meeting-cancel-r1');
    assert.deepEqual(calls, [], 'the first press only asks');
    assert.ok(m.byTestId('meeting-cancel-confirm-r1'));
  } finally { await m.unmount(); }
  const failed = await mount(h('ul', null, h(MeetingRow, { meeting: { ...ref, status: 'failed', error: 'Zoom did not answer. Axal will try again; you can also retry now.' }, interview: { id: 7 }, api, now: NOW })));
  try {
    assert.match(failed.text(), /The transcript was not imported\. Zoom did not answer/);
    await failed.click('button-meeting-import-r1');
    assert.deepEqual(calls, [['import', 7, 'r1']]);
  } finally { await failed.unmount(); }
  const evil = html(h('ul', null, h(MeetingRow, { meeting: { ...ref, join_url: 'javascript:alert(1)' }, interview: { id: 7 }, now: NOW })));
  assert.doesNotMatch(evil, /javascript:/);
});

test('Record a session offers "From Telegram or WhatsApp" and "Schedule a Zoom or Meet call", with nothing to start for either', async () => {
  const models = { live: [], final: [], defaults: { live: null, final: null } };
  // The panels read the real client here; every answer is an empty body.
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const el = h(ActiveCompanyContext.Provider, { value: { company: { company_name: 'Acme' } } },
    h(RecordSessionSheet, { interview: { id: 1, interviewee_name: 'Ana' }, initialModels: models, onClose() {}, onCreated() {} }));
  const m = await mount(el);
  try {
    assert.ok(m.byTestId('button-start-recording'));
    await m.click('channel-from-chat');
    assert.ok(m.byTestId('interview-connect'));
    assert.equal(m.byTestId('button-start-recording'), undefined);
    assert.match(m.text(), /The chat’s messages become this interview’s transcript; nothing is recorded here\./);
    await m.click('channel-schedule-call');
    assert.ok(m.byTestId('interview-schedule'));
    assert.equal(m.byTestId('button-start-recording'), undefined);
  } finally { await m.unmount(); globalThis.fetch = prevFetch; }
});

// ------------------------------------------------------------------ the session page

test('the badge: "From Telegram" is the channel’s, never the assistant’s violet badge or "host not recorded"', () => {
  const tg = html(h(AssistantBadge, { session: { submitted_via: 'telegram', submitted_via_name: 'Telegram' } }));
  assert.match(tg, /data-testid="channel-badge"/);
  assert.match(tg, />From Telegram</);
  assert.doesNotMatch(tg, /assistant-badge|host not recorded|violet/);
  assert.match(html(h(AssistantBadge, { session: { submitted_via: 'zoom', submitted_via_name: 'Zoom' } })), /title="Imported from the Zoom call’s transcript"/);
  const claude = html(h(AssistantBadge, { session: { submitted_via: 'abc123def456', submitted_via_name: 'Claude', submitted_via_host: 'claude.ai' } }));
  assert.match(claude, /data-testid="assistant-badge"[^>]*title="claude\.ai">From Claude</);
});

test('a channel session waiting for its words shows what it waits for, never the recorder', async () => {
  const chat = text(h(ChannelSessionPanel, { session: { id: 9, interview_id: 3, submitted_via: 'whatsapp', status: 'draft', channel: 'text' } }));
  assert.match(chat, /Waiting for messages/);
  assert.match(chat, /New messages in this WhatsApp chat are added here as they arrive/);
  assert.doesNotMatch(chat, /Start recording|consent/i);
  const api = { meetings: async (id) => ({ meetings: [{ uid: 'r1', provider: 'google_meet', join_url: 'https://meet.google.com/abc-defg-hij', starts_at: '2026-10-12T09:00:00Z', ends_at: '2026-10-12T09:30:00Z', status: 'no_transcript', error: null, session_id: 9, interview_id: id }] }) };
  const m = await mount(h(ChannelSessionPanel, { session: { id: 9, interview_id: 3, submitted_via: 'google_meet', status: 'draft', channel: 'video' }, api, now: NOW }));
  try {
    await m.flush();
    assert.match(m.text(), /Waiting for the Google Meet transcript/);
    assert.match(m.text(), /No transcript was made\. Google Meet makes a transcript only on a Workspace edition/);
    assert.ok(m.byTestId('button-meeting-import-r1'), 'Try again');
  } finally { await m.unmount(); }
  const src = readFileSync('frontend/src/pages/founder/InterviewSessionPage.jsx', 'utf8');
  assert.match(src, /const waiting = openingStep\(session\) === 'channel';/);
  assert.match(src, /\? <ChannelSessionPanel session=\{session\}/);
  assert.match(src, /AUDIO\.has\(session\.channel\) && !channelOf\(session\)/, 'a provider’s transcript names no speech model of ours');
});

// ------------------------------------------------------------------ where each is mounted

test('mounted: the inbox route, the Connectors group, the sheet’s two ways in; no CSP was added to the shell', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /const ChannelsInboxPage = lazy\(\(\) => import\('\.\/pages\/founder\/ChannelsInbox'\)\);/);
  assert.match(app, /<Route path="\/validate\/inbox" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <ChannelsInboxPage \/>\)\} \/>/);
  const conn = readFileSync('frontend/src/pages/account/AccountConnectors.jsx', 'utf8');
  assert.match(conn, /<ChannelsSection catalogue=\{data\.catalogue\} onOpenConnector=/);
  const sheet = readFileSync('frontend/src/pages/founder/RecordSessionSheet.jsx', 'utf8');
  assert.match(sheet, /<ConnectPanel interview=\{interview\}/);
  assert.match(sheet, /<SchedulePanel interview=\{interview\} \/>/);
  assert.doesNotMatch(readFileSync('frontend/public/_headers', 'utf8').replace(/^#.*$/gm, ''), /Content-Security-Policy/i, 'the SDK is blocked by nothing on the shell');
  assert.doesNotMatch(readFileSync('frontend/index.html', 'utf8'), /http-equiv="Content-Security-Policy"/i);
  // The SDK is never a static script on the page: only the click adds it.
  assert.doesNotMatch(readFileSync('frontend/index.html', 'utf8'), /connect\.facebook\.net/);
});
