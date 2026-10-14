/**
 * D684 (#1575, S02 #1578) — interview channels, the rules: the API module
 * against D684 §9, Connectors' card states for Telegram, WhatsApp, Zoom and
 * Google Meet, Meta's Embedded Signup, the reply composer's 24-hour rule and
 * its idempotency key, the channel badge and the step a channel session opens
 * on, and every meeting status in plain words.
 *
 * Two promises this file holds hardest: a Telegram message is never called
 * delivered, and no secret name, phone number id or WABA id reaches the page.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_channels_d684.test.mjs
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import {
  CHANNEL_PROVIDERS, MEETING_NOTES, accountName, botHandle, channelCard, meetingCard, pendingLabel, pendingTotal, readOverview,
  safeTelegramUrl, telegramLinkView, telegramSteps, testOutcome, whatsappSignupConfig,
  TELEGRAM_CLAIM_STATES, TELEGRAM_CLAIM_WORDS, TELEGRAM_CONFIRM_REFUSALS, TELEGRAM_CONFIRM_STEP, telegramClaim, telegramClaimView, telegramConfirmRefusal,
} from '../src/pages/account/channelsModel.js';
import {
  DEFAULT_GRAPH_VERSION, SDK_URL, SignupError, isFacebookOrigin, loadFacebookSdk, readSignupMessage, runEmbeddedSignup,
  signupLoginOptions,
} from '../src/pages/account/whatsappSignup.js';
import {
  assignedSentence, callWhen, cancelOutcome, cancelQuestion, clientKeyFor, composerState, defaultMeetingForm, interviewOptions, keepKeyAfter,
  meetingBody, meetingError, meetingItems, meetingProviders, meetingStatus, messageView, providerNote, replyFailureText, replyOutcome, safeJoinUrl,
  scheduleRefusal, sentLabel, sessionHref, threadItems, threadRow, transcriptNote,
} from '../src/pages/founder/channelThreads.js';
import {
  CHANNEL_SOURCES, channelBadgeTitle, channelOf, openingStep, sessionBadge, sessionOrigin,
} from '../src/pages/founder/assistantSession.js';
import { PROVIDER_LABEL } from '../src/pages/account/channelsModel.js';

// ------------------------------------------------------------------ a fetch the tests answer

function mockFetch(routes = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = init.method || 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = routes[`${method} ${path}`];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [200, { ok: true }];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

// The shape routes/channels.ts answers GET /api/channels with (S19), plus the
// fields a member must never see: secret names, the WABA and phone number ids.
const RAW = {
  providers: [
    { provider: 'telegram', available: true, missing: [] },
    { provider: 'whatsapp', available: true, missing: [], signup: { app_id: '1234567890', config_id: '9876543210' } },
    { provider: 'zoom', available: false, missing: ['ZOOM_CLIENT_ID', 'ZOOM_WEBHOOK_SECRET_TOKEN'] },
    { provider: 'google_meet', available: true, missing: [] },
  ],
  connections: {
    telegram: { status: 'active', external_account_name: '@ada_shop', connected_at: '2026-10-01T00:00:00Z', can_reply: true, business_connected: true },
    whatsapp: { status: 'active', external_account_name: 'Ada’s Bakery', waba_id: '104950000000001', phone_number_id: '106540000000002', external_account_id: '106540000000002', can_reply: true },
  },
  pending: { telegram: 2, whatsapp: 1 },
};

// ------------------------------------------------------------------ the client

test('every channels call hits D684 §9’s method and path, with the body the Worker reads', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const f = mockFetch({});
  try {
    const { channelsApi } = await import('../src/lib/api/channels.js');
    await channelsApi.overview();
    await channelsApi.linkTelegram();
    await channelsApi.connectWhatsApp({ code: 'c0de', waba_id: '1', phone_number_id: '2' });
    await channelsApi.disconnect('telegram');
    await channelsApi.test('whatsapp');
    await channelsApi.threads('pending');
    await channelsApi.threads();
    await channelsApi.thread('t 1');
    await channelsApi.assign('t1', { interview_id: '7' });
    await channelsApi.assign('t1', { create: { interviewee_name: ' Ada ', project_id: '3' } });
    await channelsApi.ignore('t1');
    await channelsApi.ignore('t1', false);
    await channelsApi.reply('t1', 'Thanks!', 'key-1');
    await channelsApi.meetings(7);
    await channelsApi.scheduleMeeting(7, { provider: 'zoom', starts_at: '2026-10-20T09:00:00.000Z', duration_min: '30', topic: 'Interview' });
    await channelsApi.cancelMeeting(7, 'r 1');
    await channelsApi.importMeeting(7, 'r1');
    await channelsApi.scheduleMeeting(7, { provider: 'zoom', starts_at: '2026-10-20T09:00:00.000Z', duration_min: 30, consent: { status: 'given', method: 'verbal' }, auto_record: true });
  } finally { f.restore(); }
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
    'GET /channels', 'POST /channels/telegram/link', 'POST /channels/whatsapp/connect', 'DELETE /channels/telegram',
    'POST /channels/whatsapp/test', 'GET /channels/threads?status=pending', 'GET /channels/threads', 'GET /channels/threads/t%201',
    'POST /channels/threads/t1/assign', 'POST /channels/threads/t1/assign', 'POST /channels/threads/t1/ignore',
    'POST /channels/threads/t1/ignore', 'POST /channels/threads/t1/reply',
    'GET /founder/validate/interviews/7/meetings', 'POST /founder/validate/interviews/7/meetings',
    'DELETE /founder/validate/interviews/7/meetings/r%201', 'POST /founder/validate/interviews/7/meetings/r1/import',
    'POST /founder/validate/interviews/7/meetings',
  ]);
  // Zoom's cloud recording reaches the Worker only when the member turned it on (`auto_record`, routes/founder_validate_meetings.ts).
  assert.deepEqual(f.calls[17].body, { provider: 'zoom', starts_at: '2026-10-20T09:00:00.000Z', duration_min: 30, consent: { status: 'given', method: 'verbal' }, auto_record: true });
  assert.deepEqual(f.calls[2].body, { code: 'c0de', waba_id: '1', phone_number_id: '2' });
  assert.deepEqual(f.calls[8].body, { interview_id: 7 });
  assert.deepEqual(f.calls[9].body, { create: { interviewee_name: 'Ada', project_id: 3 } });
  assert.deepEqual(f.calls[10].body, { ignored: true });
  assert.deepEqual(f.calls[11].body, { ignored: false });
  assert.deepEqual(f.calls[12].body, { text: 'Thanks!', client_key: 'key-1' });
  assert.deepEqual(f.calls[14].body, { provider: 'zoom', starts_at: '2026-10-20T09:00:00.000Z', duration_min: 30, topic: 'Interview' });
});

test('the client refuses a provider, status or meeting provider the routes do not have, before any fetch', async () => {
  const f = mockFetch({});
  try {
    const { channelsApi } = await import('../src/lib/api/channels.js');
    assert.throws(() => channelsApi.disconnect('signal'), /Unknown channel provider/);
    assert.throws(() => channelsApi.threads('archived'), /Unknown thread status/);
    assert.throws(() => channelsApi.scheduleMeeting(7, { provider: 'teams', starts_at: 'x', duration_min: 30 }), /Unknown meeting provider/);
  } finally { f.restore(); }
  assert.equal(f.calls.length, 0);
});

test('every request in the module is written as a literal path the drift check can read', async () => {
  const { readFileSync } = await import('node:fs');
  const { extractClientCalls, normalizePath } = await import('../../scripts/lib/apiModules.mjs');
  const calls = extractClientCalls(readFileSync('frontend/src/lib/api/channels.js', 'utf8')).map((c) => `${c.method} ${normalizePath(c.path)}`);
  assert.deepEqual(calls.sort(), [
    'DELETE /channels/:p', 'DELETE /founder/validate/interviews/:p/meetings/:p',
    'GET /channels', 'GET /channels/telegram/link', 'GET /channels/threads', 'GET /channels/threads/:p', 'GET /founder/validate/interviews/:p/meetings',
    'POST /channels/:p/test', 'POST /channels/telegram/link', 'POST /channels/telegram/link/:p/confirm', 'POST /channels/threads/:p/assign', 'POST /channels/threads/:p/ignore',
    'POST /channels/threads/:p/reply', 'POST /channels/whatsapp/connect', 'POST /founder/validate/interviews/:p/meetings',
    'POST /founder/validate/interviews/:p/meetings/:p/import',
  ], 'one per route of D684 §9, as the drift check will read them');
});

// ------------------------------------------------------------------ Connectors: the four cards

test('GET /api/channels is read defensively: list or object, nothing absent becomes a zero, secret names are dropped', () => {
  const o = readOverview(RAW);
  assert.deepEqual(Object.keys(o.providers).sort(), [...CHANNEL_PROVIDERS].sort());
  assert.equal(o.providers.zoom.available, false);
  assert.ok(!JSON.stringify(o.providers).includes('ZOOM_CLIENT_ID'), 'missing secret names are never carried');
  assert.deepEqual(o.pending, { telegram: 2, whatsapp: 1 });
  assert.equal(readOverview(null), null);
  assert.equal(readOverview([]), null);
  const sparse = readOverview({ providers: { telegram: { available: true } }, connections: [{ provider: 'telegram', status: 'active' }] });
  assert.equal(sparse.providers.telegram.available, true);
  assert.equal(sparse.providers.whatsapp, undefined);
  assert.equal(sparse.connections.telegram.status, 'active');
  assert.equal(sparse.connections.whatsapp, null);
  assert.deepEqual(sparse.pending, { telegram: null, whatsapp: null }, 'an uncounted inbox is unknown, not empty');
  assert.equal(pendingTotal(o), 3);
  assert.equal(pendingTotal(sparse), null);
  assert.equal(pendingLabel(1), '1 conversation waiting');
  assert.equal(pendingLabel(0), '');
  assert.equal(pendingLabel(null), '');
  // S01's public config may also arrive beside the providers.
  const beside = readOverview({ providers: [{ provider: 'whatsapp', available: true }], whatsapp: { app_id: '1234567', config_id: '7654321' } });
  assert.deepEqual(whatsappSignupConfig(beside), { appId: '1234567', configId: '7654321' });
});

test('the Telegram and WhatsApp cards: not set up here, not connected, linked, connected with the account name, problem, unreadable', () => {
  const o = readOverview(RAW);
  const tg = channelCard('telegram', o);
  assert.deepEqual([tg.state, tg.label, tg.account], ['connected', 'Connected', '@ada_shop']);
  const wa = channelCard('whatsapp', o);
  assert.deepEqual([wa.state, wa.account], ['connected', 'Ada’s Bakery']);
  assert.equal(accountName({ external_account_id: '106540000000002', phone_number_id: '106540000000002', waba_id: '1049' }), '', 'an id is never an account name');

  const off = readOverview({ providers: [{ provider: 'telegram', available: false, missing: ['TELEGRAM_CHANNEL_BOT_TOKEN'] }] });
  const u = channelCard('telegram', off);
  assert.equal(u.state, 'unavailable');
  assert.equal(u.label, 'Not available yet');
  assert.match(u.why, /Axal has not switched this on yet/);
  assert.doesNotMatch(JSON.stringify(u), /TELEGRAM_|SECRET|TOKEN/);
  assert.equal(channelCard('whatsapp', readOverview({ providers: [] })).state, 'unavailable', 'a provider the read does not list is not set up');

  const fresh = readOverview({ providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }] });
  assert.equal(channelCard('telegram', fresh).state, 'not_connected');
  assert.equal(channelCard('whatsapp', fresh).state, 'not_connected');

  const linked = readOverview({ ...RAW, connections: { telegram: { status: 'active', external_account_name: '@ada', business_connected: false } } });
  const l = channelCard('telegram', linked);
  assert.equal(l.state, 'linked');
  assert.match(l.why, /Add the Axal bot in Telegram Business/);

  const noReply = channelCard('telegram', readOverview({ ...RAW, connections: { telegram: { status: 'active', business_connected: true, can_reply: false } } }));
  assert.equal(noReply.state, 'connected');
  assert.match(noReply.note, /can read the chats you chose but not reply/);

  const broken = channelCard('whatsapp', readOverview({ ...RAW, connections: { whatsapp: { status: 'error', last_error: 'token_invalid: 401' } } }));
  assert.equal(broken.state, 'problem');
  assert.equal(broken.tone, 'warn');
  assert.match(broken.why, /no longer accepts Axal’s access/);
  const failing = channelCard('telegram', readOverview({ ...RAW, connections: { telegram: { status: 'error' } } }));
  assert.match(failing.why, /The last attempt to reach Telegram failed/);
  const switchedOff = channelCard('whatsapp', readOverview({ providers: [{ provider: 'whatsapp', available: false }], connections: RAW.connections }));
  assert.equal(switchedOff.state, 'problem', 'a connection on a provider switched off says so, it does not vanish');

  assert.equal(channelCard('telegram', null).state, 'unreadable');
});

test('the Zoom and Google Meet cards read availability from /api/channels and the connection from the connectors catalogue', () => {
  const o = readOverview({ ...RAW, providers: RAW.providers.map((p) => (p.provider === 'zoom' ? { ...p, available: true } : p)) });
  const catalogue = [
    { key: 'zoom', display_name: 'Zoom', available: true, connection: null },
    { key: 'google', display_name: 'Google Calendar', available: true, connection: { status: 'active', external_account_name: 'ada@example.test' } },
  ];
  const zoom = meetingCard('zoom', o, catalogue);
  assert.deepEqual([zoom.state, zoom.connectorKey], ['not_connected', 'zoom']);
  const meet = meetingCard('google_meet', o, catalogue);
  assert.deepEqual([meet.state, meet.account, meet.connectorKey], ['connected', 'ada@example.test', 'google']);
  assert.equal(meetingCard('zoom', readOverview(RAW), catalogue).state, 'unavailable', 'Zoom is off on this deployment');
  assert.equal(meetingCard('zoom', o, []).state, 'unavailable', 'no Zoom in the registry yet');
  // Reconnecting cannot give Axal Meet's transcript scope (no Google sign-in asks for it), so the card never asks for one.
  const stale = meetingCard('google_meet', readOverview({ ...RAW, connections: { google_meet: { status: 'active', needs_reconnect: true } } }), catalogue);
  assert.equal(stale.state, 'connected');
  assert.doesNotMatch(String(stale.why ?? ''), /Reconnect/);
  assert.equal(meetingCard('google_meet', null, catalogue).state, 'unreadable');
});

test('Send test says what happened: Telegram accepted (never "arrived"), WhatsApp checked without messaging anyone', () => {
  assert.match(testOutcome('telegram', { ok: true, sent: true }), /accepted the message, not that it arrived/);
  assert.doesNotMatch(testOutcome('telegram', { ok: true, sent: true }), /delivered/i);
  assert.match(testOutcome('whatsapp', { ok: true, sent: false }), /No message was sent/);
});

// ------------------------------------------------------------------ Telegram: the link step

test('the Telegram link is only one Axal issued, names the bot, says when it stops, and walks through Telegram Business', () => {
  const url = 'https://t.me/AxalStudioBot?start=Kp7mQ9xZ2bC4dF6gH8jK3mN5';
  assert.equal(safeTelegramUrl(url), url);
  for (const bad of ['http://t.me/AxalStudioBot?start=x', 'https://t.me.evil.example/AxalStudioBot?start=x', 'javascript:alert(1)', 'https://t.me/AxalStudioBot', 'tg://resolve?domain=x']) {
    assert.equal(safeTelegramUrl(bad), null, bad);
  }
  assert.equal(botHandle(url), '@AxalStudioBot');
  const now = Date.parse('2026-10-13T10:00:00Z');
  const v = telegramLinkView({ url, expires_at: '2026-10-13T10:10:00Z' }, now, () => '10:10');
  assert.deepEqual(v, { href: url, bot: '@AxalStudioBot', expired: false, expires: 'Works once, until 10:10.' });
  assert.equal(telegramLinkView({ url, expires_at: '2026-10-13T09:59:00Z' }, now).expired, true);
  const steps = telegramSteps('@AxalStudioBot').join(' ');
  assert.match(steps, /Settings › Telegram Business › Chatbots/);
  assert.match(steps, /Add @AxalStudioBot as your chatbot/);
  assert.match(steps, /Choose which chats it can see/);
});

// ------------------------------------------------------------------ #1625: the two-sided Telegram link

const CLAIM = { uid: 'lc1', display_name: 'Dana Ruiz', username: '@dana_biz', expires_at: '2026-10-14T10:10:00Z', telegram_confirmed: true, axal_confirmed: false, status: 'waiting_axal', message: 'Confirm the claimed Telegram account in Axal to finish linking.' };

test('#1625 the overview keeps telegram_link; the claimed account is kept exactly as Telegram sent it', () => {
  const o = readOverview({ ...RAW, telegram_link: { ...CLAIM, display_name: '  Dana  Ruiz ' } });
  assert.deepEqual(o.telegramLink, {
    uid: 'lc1', displayName: '  Dana  Ruiz ', username: '@dana_biz', expiresAt: '2026-10-14T10:10:00Z',
    telegramConfirmed: true, axalConfirmed: false, status: 'waiting_axal', message: 'Confirm the claimed Telegram account in Axal to finish linking.',
  }, 'the name as sent, spaces and all');
  assert.equal(readOverview(RAW).telegramLink, null, 'no claim');
  assert.equal(telegramClaim({ ...CLAIM, status: 'made_up' }), null, 'only the Worker\'s states');
  assert.equal(telegramClaim({ ...CLAIM, uid: '' }), null);
  assert.equal(telegramClaim({ ...CLAIM, message: '' }).message, TELEGRAM_CLAIM_WORDS.waiting_axal, 'no sentence sent: ours');
  assert.equal(telegramClaim({ ...CLAIM, message: 'The Worker words it its own way.' }).message, 'The Worker words it its own way.', 'the Worker\'s sentence first');
  assert.equal(telegramClaim({ ...CLAIM, telegram_confirmed: 'yes' }).telegramConfirmed, false, 'only true is true');
  assert.deepEqual(TELEGRAM_CLAIM_STATES, ['waiting_claim', 'waiting_telegram', 'waiting_axal', 'ready', 'linked', 'expired', 'cancelled', 'unreadable']);
  for (const st of TELEGRAM_CLAIM_STATES) assert.match(TELEGRAM_CLAIM_WORDS[st], /^[A-Z].+\.$/, `${st} is a sentence`);
  assert.equal(TELEGRAM_CLAIM_WORDS.ready, 'Both owners confirmed. Press Confirm again to finish activating this link.');
});

test('#1625 the claim view: who claimed it, each state\'s sentence, and Confirm until Axal\'s half is in', () => {
  const view = (patch) => telegramClaimView(telegramClaim({ ...CLAIM, ...patch }));
  const v = view({});
  assert.deepEqual(v, {
    uid: 'lc1', who: 'Dana Ruiz · @dana_biz', sentence: 'Confirm the claimed Telegram account in Axal to finish linking.', canConfirm: true, stale: false,
    steps: [{ label: 'Confirmed in Telegram', done: true }, { label: 'Confirmed in Axal', done: false }],
  });
  assert.equal(view({ status: 'waiting_telegram', telegram_confirmed: false }).canConfirm, true, 'Axal may confirm first');
  assert.equal(view({ status: 'waiting_telegram', telegram_confirmed: false, axal_confirmed: true }).canConfirm, false, 'Axal\'s half is in: Telegram is awaited');
  assert.equal(view({ status: 'ready', telegram_confirmed: true, axal_confirmed: true }).canConfirm, true, 'ready: Confirm again activates');
  for (const status of ['expired', 'cancelled', 'unreadable']) {
    const s = view({ status });
    assert.deepEqual([s.canConfirm, s.stale], [false, true], status);
  }
  assert.equal(view({ status: 'waiting_claim' }), null, 'an unclaimed code is drawn as its steps');
  assert.equal(view({ status: 'linked' }), null);
  assert.equal(telegramClaimView(null), null);
  assert.equal(view({ display_name: null, username: null }).who, null);
  assert.equal(view({ display_name: null }).who, '@dana_biz');
});

test('#1625 every Confirm refusal is a sentence: the Worker\'s own, else ours, never a code', () => {
  const codes = { link_not_found: 404, link_cancelled: 409, link_expired: 410, link_not_claimed: 409, member_inactive: 403, identity_taken: 409 };
  assert.deepEqual(Object.keys(TELEGRAM_CONFIRM_REFUSALS).sort(), Object.keys(codes).sort());
  for (const [code, status] of Object.entries(codes)) {
    const bare = telegramConfirmRefusal(Object.assign(new Error(code), { status, code }));
    assert.equal(bare, TELEGRAM_CONFIRM_REFUSALS[code], `${code} with no sentence`);
    assert.doesNotMatch(bare, /_/, `${code} reads as words`);
    assert.equal(telegramConfirmRefusal(Object.assign(new Error('The Worker says so.'), { status, code })), 'The Worker says so.', `${code}: the Worker's words first`);
  }
  assert.equal(telegramConfirmRefusal({}), 'Axal could not confirm this link. Try again in a minute.');
});

test('#1625 the steps ask for both confirmations: /confirm in Telegram and Confirm here, inside ten minutes', () => {
  assert.equal(TELEGRAM_CONFIRM_STEP, 'Send /confirm in Telegram, then press Confirm here, within ten minutes of the code.');
  const steps = telegramSteps('@AxalStudioBot');
  assert.equal(steps[1], TELEGRAM_CONFIRM_STEP, 'right after Start');
  assert.match(steps.join(' '), /\/confirm in Telegram/);
  assert.match(steps.join(' '), /press Confirm here/);
});

test('#1625 the claim and Axal\'s confirm are the Worker\'s routes', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const f = mockFetch({});
  try {
    const { channelsApi } = await import('../src/lib/api/channels.js');
    await channelsApi.telegramClaim();
    await channelsApi.confirmTelegram('lc 1');
  } finally { f.restore(); }
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), ['GET /channels/telegram/link', 'POST /channels/telegram/link/lc%201/confirm']);
  assert.deepEqual(f.calls[1].body, {});
});

// ------------------------------------------------------------------ WhatsApp: Embedded Signup

test('Embedded Signup asks Meta for a code, in coexistence, with the config id the Worker gave', () => {
  assert.deepEqual(signupLoginOptions('9876543210'), {
    config_id: '9876543210', response_type: 'code', override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  });
  assert.equal(SDK_URL, 'https://connect.facebook.net/en_US/sdk.js');
  assert.deepEqual(whatsappSignupConfig(readOverview(RAW)), { appId: '1234567890', configId: '9876543210' });
  assert.equal(whatsappSignupConfig(readOverview({ providers: [{ provider: 'whatsapp', available: true }] })), null, 'no config: the button stays off');
  assert.equal(whatsappSignupConfig(readOverview({ providers: [{ provider: 'whatsapp', available: true, signup: { app_id: 'abc', config_id: '1' } }] })), null);
});

test('only a facebook.com message over https is read, and only Embedded Signup’s', () => {
  for (const o of ['https://www.facebook.com', 'https://web.facebook.com', 'https://facebook.com']) assert.equal(isFacebookOrigin(o), true, o);
  for (const o of ['http://www.facebook.com', 'https://evilfacebook.com', 'https://facebook.com.evil.example', 'https://www.facebook.com:8443', '', null]) assert.equal(isFacebookOrigin(o), false, String(o));
  const msg = (data, origin = 'https://www.facebook.com') => ({ origin, data: JSON.stringify(data) });
  assert.deepEqual(readSignupMessage(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '111', phone_number_id: '222' } })), { kind: 'finish', waba_id: '111', phone_number_id: '222' });
  assert.deepEqual(readSignupMessage(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '111' } })), { kind: 'finish', waba_id: '111', phone_number_id: null }, 'a coexistence finish may name the WABA only');
  assert.deepEqual(readSignupMessage(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } })), { kind: 'cancel' });
  assert.deepEqual(readSignupMessage(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'x' } })), { kind: 'error' });
  assert.equal(readSignupMessage(msg({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '111' } }, 'https://evil.example')), null);
  assert.equal(readSignupMessage({ origin: 'https://www.facebook.com', data: 'not json' }), null);
  assert.equal(readSignupMessage(msg({ type: 'OTHER' })), null);
});

function fakeWindow() {
  const listeners = new Set();
  return {
    addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') listeners.delete(fn); },
    post: (data, origin = 'https://www.facebook.com') => { for (const fn of [...listeners]) fn({ origin, data: JSON.stringify(data) }); },
    get size() { return listeners.size; },
  };
}
const FINISH = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '111', phone_number_id: '222' } };

test('runEmbeddedSignup waits for both the ids and the code, in either order, and cleans up its listener', async () => {
  const win = fakeWindow();
  let opts = null; let cb = null;
  const FB = { login(fn, o) { cb = fn; opts = o; } };
  const p = runEmbeddedSignup({ FB, win, configId: '987' });
  assert.equal(opts.config_id, '987', 'FB.login is called at once, inside the click');
  win.post(FINISH, 'https://evil.example');
  win.post(FINISH);
  cb({ authResponse: { code: 'AQB-code' } });
  assert.deepEqual(await p, { code: 'AQB-code', waba_id: '111', phone_number_id: '222' });
  assert.equal(win.size, 0);

  const win2 = fakeWindow();
  const FB2 = { login(fn) { fn({ authResponse: { code: 'c2' } }); } };
  const p2 = runEmbeddedSignup({ FB: FB2, win: win2, configId: '1' });
  win2.post(FINISH);
  assert.deepEqual(await p2, { code: 'c2', waba_id: '111', phone_number_id: '222' });
});

test('runEmbeddedSignup: closing Meta’s window, Meta’s error, or a code with no ids each end with a sentence', async () => {
  const cancel = fakeWindow();
  const p1 = runEmbeddedSignup({ FB: { login() {} }, win: cancel, configId: '1' });
  cancel.post({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: {} });
  await assert.rejects(p1, (e) => e instanceof SignupError && e.code === 'cancelled' && /Nothing was connected/.test(e.message));
  await assert.rejects(runEmbeddedSignup({ FB: { login(fn) { fn({ authResponse: null, status: 'unknown' }); } }, win: fakeWindow(), configId: '1' }), (e) => e.code === 'cancelled');
  const err = fakeWindow();
  const p3 = runEmbeddedSignup({ FB: { login() {} }, win: err, configId: '1' });
  err.post({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'internal' } });
  await assert.rejects(p3, (e) => e.code === 'meta_error' && !/internal/.test(e.message), 'Meta’s own text is not printed');
  await assert.rejects(runEmbeddedSignup({ FB: { login(fn) { fn({ authResponse: { code: 'c' } }); } }, win: fakeWindow(), configId: '1', idsWaitMs: 5 }), (e) => e.code === 'incomplete');
});

test('Meta’s SDK is a script added only when asked, from connect.facebook.net, initialised with the app id', async () => {
  const appended = [];
  const win = {};
  const doc = {
    getElementById: () => null,
    createElement: (tag) => ({ tag }),
    body: { appendChild: (s) => { appended.push(s); setTimeout(() => { win.FB = { init(o) { win.inited = o; }, login() {} }; win.fbAsyncInit(); }, 0); } },
  };
  assert.equal(appended.length, 0, 'nothing loads before the click');
  const FB = await loadFacebookSdk({ appId: '1234567890', doc, win });
  assert.equal(appended.length, 1);
  assert.deepEqual({ tag: appended[0].tag, src: appended[0].src, async: appended[0].async, crossOrigin: appended[0].crossOrigin, id: appended[0].id }, { tag: 'script', src: SDK_URL, async: true, crossOrigin: 'anonymous', id: 'facebook-jssdk' });
  assert.deepEqual(win.inited, { appId: '1234567890', autoLogAppEvents: true, xfbml: false, version: DEFAULT_GRAPH_VERSION });
  assert.equal(FB, win.FB);
  await loadFacebookSdk({ appId: '1234567890', doc, win });
  assert.equal(appended.length, 1, 'a second connect reuses the loaded SDK');
});

// ------------------------------------------------------------------ the inbox and the composer

const THREAD = {
  uid: 'th1', provider: 'whatsapp', contact_name: 'Ada Lovelace', status: 'pending', message_count: 3,
  last_message_at: '2026-10-13T09:00:00Z', last_inbound_at: '2026-10-13T09:00:00Z', interview_id: null,
  interviewee_name: null, session_id: null, can_reply: true, reply_window_open: true,
};

test('a thread row: contact, provider, message count, last message time; GET /threads answers { threads }', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.deepEqual(threadRow(THREAD, now), { uid: 'th1', name: 'Ada Lovelace', provider: 'WhatsApp', count: '3 messages', when: '3 h ago', status: 'pending', interviewee: '' });
  assert.equal(threadRow({ ...THREAD, contact_name: null, message_count: 1 }, now).name, 'Name not shared');
  assert.equal(threadRow({ ...THREAD, message_count: 1 }, now).count, '1 message');
  assert.equal(threadRow({ ...THREAD, status: 'assigned', interviewee_name: 'Ada' }, now).interviewee, 'Ada');
  assert.deepEqual(threadItems({ threads: [THREAD, { nope: 1 }] }).map((t) => t.uid), ['th1']);
  assert.deepEqual(threadItems({ items: [THREAD] }).map((t) => t.uid), ['th1']);
  assert.deepEqual(threadItems(null), []);
});

test('a message shows its side, and a voice note says it was transcribed', () => {
  assert.deepEqual(messageView({ uid: 'm1', side: 'contact', kind: 'voice', text: 'We lose a day a week.' }, 'Ada'), { uid: 'm1', mine: false, who: 'Ada', label: 'Voice note (transcribed)', text: 'We lose a day a week.' });
  assert.deepEqual(messageView({ uid: 'm2', side: 'me', kind: 'text', text: 'Thanks' }, 'Ada'), { uid: 'm2', mine: true, who: 'You', label: '', text: 'Thanks' });
  // A pending chat's voice note waits, untranscribed, until the member adds the chat to an interview (threads.ts readThread).
  assert.deepEqual(messageView({ uid: 'm4', side: 'contact', kind: 'voice', text: null, awaiting_transcription: true, duration_sec: 12 }, 'Ada'), { uid: 'm4', mine: false, who: 'Ada', label: 'Voice note, transcribed when you add this chat to an interview', text: null });
  assert.equal(messageView({ uid: 'm3', side: 'contact', kind: 'text', text: null }, '').text, null, 'an undecryptable message is said, not blank');
});

test('the composer: open inside the window, closed with the provider’s own rule in plain words', () => {
  assert.deepEqual(composerState(THREAD), { enabled: true, reason: '' });
  const wa = composerState({ ...THREAD, reply_window_open: false });
  assert.equal(wa.enabled, false);
  assert.match(wa.reason, /WhatsApp only allows a free reply within 24 hours of the customer’s last message/);
  const tg = composerState({ ...THREAD, provider: 'telegram', reply_window_open: false });
  assert.match(tg.reason, /Telegram only lets the bot reply in chats active in the last 24 hours/);
  const rights = composerState({ ...THREAD, provider: 'telegram', can_reply: false, reply_window_open: false });
  assert.match(rights.reason, /not allowed to reply[^]*Settings › Telegram Business › Chatbots/);
  assert.match(composerState({ ...THREAD, status: 'ignored' }).reason, /Stop ignoring it to reply/);
  assert.equal(composerState(null).enabled, false);
});

test('a sent reply: Telegram is "Sent" whatever the answer says; only WhatsApp’s own reports say more', () => {
  for (const s of [undefined, 'submitted', 'delivered', 'read']) assert.equal(sentLabel('telegram', s), 'Sent', String(s));
  assert.equal(sentLabel('whatsapp', 'submitted'), 'Sent');
  assert.equal(sentLabel('whatsapp', 'delivered'), 'Delivered');
  assert.equal(sentLabel('whatsapp', 'read'), 'Read');
  assert.deepEqual(replyOutcome('telegram', { ok: true, existing: false, outbound: { status: 'delivered' } }), { ok: true, label: 'Sent' });
  assert.deepEqual(replyOutcome('whatsapp', { ok: true, outbound: { status: 'submitted' } }), { ok: true, label: 'Sent' });
  assert.equal(replyOutcome('whatsapp', { ok: false, existing: true, outbound: { status: 'failed' } }).ok, false, 'a repeat of a failed key sent nothing');
});

test('a repeat whose first attempt is still pending is never "Sent": in flight keeps the key, unknown says to check the chat', () => {
  // The Worker's answer for a key whose row is still 'pending' (routes/channels.ts).
  const inFlight = replyOutcome('telegram', { ok: null, existing: true, pending: true, code: 'send_in_flight', outbound: { status: 'pending' } });
  assert.equal(inFlight.ok, null);
  assert.equal(inFlight.keepKey, true, 'the first attempt may still go: the next press only asks again');
  assert.match(inFlight.text, /^Sending… Telegram has not confirmed it yet\. Press Send again in a moment to check: it will not send twice\.$/);
  const unknown = replyOutcome('whatsapp', { ok: null, existing: true, pending: true, code: 'send_unknown', outbound: { status: 'pending' } });
  assert.deepEqual([unknown.ok, unknown.keepKey], [null, true]);
  assert.match(unknown.text, /^Not confirmed yet: check the chat in WhatsApp\./);
  // A Worker without the explicit pending answer said ok: true for a pending row; that is not a provider's word either.
  const older = replyOutcome('telegram', { ok: true, existing: true, outbound: { status: 'pending' } });
  assert.notEqual(older.ok, true, 'a pending row is not Sent');
  assert.equal(older.keepKey, true);
  for (const ambiguous of [{}, { ok: true }, { ok: true, outbound: {} }, null]) {
    assert.notEqual(replyOutcome('whatsapp', ambiguous).ok, true, `${JSON.stringify(ambiguous)} is not Sent`);
  }
  assert.equal(replyOutcome('whatsapp', { ok: true, outbound: { status: 'failed' } }).ok, false, 'a status report of failure is not Sent');
});

test('the idempotency key: one per message, dropped only after the Worker’s refusal (a 4xx with its code)', () => {
  let n = 0;
  const make = () => `k${++n}`;
  const first = clientKeyFor(null, make);
  assert.equal(first, 'k1');
  assert.equal(clientKeyFor(first, make), 'k1', 'a retry reuses it');
  assert.equal(keepKeyAfter(Object.assign(new Error('Network error'), {})), true, 'offline: the first try may have gone');
  assert.equal(keepKeyAfter(Object.assign(new Error('timeout'), { code: 'timeout' })), true);
  assert.equal(keepKeyAfter(Object.assign(new Error('closed'), { status: 409, code: 'window_closed' })), false, 'refused: that key is spent');
  assert.equal(keepKeyAfter(Object.assign(new Error('Too many'), { status: 429, code: 'rate_limited' })), false);
  assert.equal(keepKeyAfter(Object.assign(new Error('Gone'), { status: 404, code: 'thread_not_found' })), false);
  // A 5xx can follow a send the provider took (a D1 error while recording it answers 500): the repeat must read that, not send again.
  assert.equal(keepKeyAfter(Object.assign(new Error('Internal server error'), { status: 500 })), true);
  assert.equal(keepKeyAfter(Object.assign(new Error('busy'), { status: 503 })), true);
  assert.equal(keepKeyAfter(Object.assign(new Error('unreachable'), { status: 503, code: 'network' })), true);
  assert.equal(keepKeyAfter(Object.assign(new Error('odd'), { status: 502, code: 'unexpected_response' })), true);
  assert.equal(keepKeyAfter(Object.assign(new Error('Bad Request'), { status: 400 })), true, 'a 4xx without the Worker’s code is not its refusal');
  assert.match(replyFailureText(Object.assign(new Error('Internal server error'), { status: 500 })), /^Axal could not confirm whether it went\. Press Send again to check: it will not send twice\.$/);
  assert.equal(replyFailureText(Object.assign(new Error('The provider could not be reached. Try again in a minute.'), { status: 503, code: 'network' })), 'The provider could not be reached. Try again in a minute.');
  assert.equal(replyFailureText(new Error('Network error')), 'Network error');
  assert.match(replyFailureText({}), /^No answer came back/);
  assert.match(clientKeyFor(null), /^[0-9a-f-]{32,36}$/, 'crypto.randomUUID by default');
});

test('assigning says what moved, and links the session it went into', () => {
  assert.equal(assignedSentence({ moved: 4, session_id: 9 }, 'Ada'), 'Moved 4 messages into the interview with Ada. New messages in this chat go there too.');
  assert.equal(assignedSentence({ moved: 1 }, ''), 'Moved 1 message into the interview. New messages in this chat go there too.');
  assert.match(assignedSentence({ moved: 0 }, 'Ada'), /^Assigned to the interview with Ada\./);
  assert.equal(sessionHref(9), '/validate/session/9');
  assert.equal(sessionHref(null), null);
  assert.deepEqual(interviewOptions({ interviews: [{ id: 3, interviewee_name: 'Ada', interviewee_company: 'Acme', interview_date: '2026-10-01' }, { id: 'x' }] }), [{ id: 3, label: 'Ada · Acme · 2026-10-01', name: 'Ada' }]);
  assert.deepEqual(interviewOptions([{ id: 4 }]), [{ id: 4, label: 'Name not recorded', name: '' }]);
});

// ------------------------------------------------------------------ the badge and the opening step

test('a channel session carries its channel’s badge, not the assistant’s, and opens on its transcript', () => {
  assert.deepEqual(CHANNEL_SOURCES, PROVIDER_LABEL, 'one set of labels, the Worker’s PROVIDER_LABEL');
  const tg = { submitted_via: 'telegram', submitted_via_name: 'Telegram', channel: 'text', status: 'transcribed' };
  assert.equal(channelOf(tg), 'telegram');
  assert.deepEqual(sessionOrigin(tg), { kind: 'channel', provider: 'telegram', text: 'From Telegram' });
  // The assistant badge's text is the assistant's alone (#1578); the channel's
  // own badge reads `sessionOrigin`'s text through `ChannelOriginBadge`.
  assert.equal(sessionBadge(tg), null);
  assert.equal(openingStep(tg), 'transcript', 'its words are already there; Structure comes after them');
  assert.equal(openingStep({ ...tg, status: 'draft' }), 'channel', 'nothing yet: the page says what it waits for, never the recorder');
  const zoom = { submitted_via: 'zoom', submitted_via_name: 'Zoom', channel: 'video', status: 'draft' };
  assert.equal(openingStep(zoom), 'channel');
  assert.equal(openingStep({ ...zoom, status: 'transcribed' }), 'transcript');
  assert.equal(sessionOrigin({ submitted_via: 'google_meet', submitted_via_name: 'Google Meet' }).text, 'From Google Meet');
  assert.match(channelBadgeTitle('zoom'), /Imported from the Zoom call’s transcript/);
  assert.match(channelBadgeTitle('whatsapp'), /Arrived from your connected WhatsApp account/);
  // The assistant path is unchanged; an assistant that calls itself "Telegram" is still an assistant.
  const gpt = { submitted_via: '3f9a0c7d2e1b4a5f8c6d0e9b7a1c2d3e', submitted_via_name: 'Telegram' };
  assert.equal(channelOf(gpt), null);
  assert.deepEqual(sessionOrigin(gpt), { kind: 'assistant', text: 'From Telegram' });
  assert.equal(openingStep(gpt), 'review');
  assert.equal(openingStep({ submitted_via_name: 'Claude' }), 'review');
  assert.equal(openingStep({ channel: 'in_person' }), null);
  assert.equal(sessionOrigin({ channel: 'video' }), null);
});

// ------------------------------------------------------------------ meetings

const REF = (status, extra = {}) => ({
  uid: 'r1', provider: 'zoom', join_url: 'https://us02web.zoom.us/j/81234567890?pwd=abc', starts_at: '2026-10-14T09:00:00Z',
  ends_at: '2026-10-14T09:30:00Z', status, last_error: null, session_id: 12, ...extra,
});

test('every meeting status reads as a sentence, with what the member can do', () => {
  const before = Date.parse('2026-10-13T09:00:00Z');
  const after = Date.parse('2026-10-14T10:00:00Z');
  const fmt = () => 'Tue 14 Oct, 11:00';
  const s = meetingStatus(REF('scheduled'), before, fmt);
  assert.equal(s.text, 'Scheduled for Tue 14 Oct, 11:00.');
  assert.equal(s.can.cancel, true);
  assert.match(meetingStatus(REF('scheduled'), Date.parse('2026-10-14T09:10:00Z')).text, /In progress/);
  const waiting = meetingStatus(REF('scheduled'), after);
  assert.match(waiting.text, /Waiting for the transcript\. Zoom makes it after the call ends/);
  assert.equal(waiting.can.import, true);
  assert.match(meetingStatus(REF('ended'), after).text, /The call ended\. Waiting for the transcript from Zoom/);
  assert.equal(meetingStatus(REF('transcript_ready'), after).can.import, true);
  const imported = meetingStatus(REF('imported'), after);
  assert.equal(imported.tone, 'ok');
  assert.equal(imported.can.open, true);
  const none = meetingStatus(REF('no_transcript'), after);
  assert.match(none.text, /No transcript was made\. Zoom makes a transcript only on a paid plan[^]*in-app recorder, or paste the conversation/);
  const meetNone = meetingStatus({ ...REF('no_transcript'), provider: 'google_meet' }, after);
  assert.match(meetNone.text, /Workspace edition with transcription turned on/);
  // The Worker's own sentence (MEETING_ERRORS) is shown as it is, and not doubled.
  const said = 'Zoom has no transcript for this call. Transcripts need a paid Zoom plan with cloud recording and “Audio transcript” turned on, and the call recorded to the cloud. You can still use the recorder or paste the conversation.';
  const theirs = meetingStatus(REF('no_transcript', { last_error: null, error: said, error_code: 'zoom_no_transcript' }), after);
  assert.equal(theirs.text, `No transcript was made. ${said}`);
  const failed = meetingStatus(REF('failed', { error: 'Zoom no longer accepts Axal’s access. Reconnect Zoom in Account › Connectors, then retry.' }), after);
  assert.equal(failed.tone, 'danger');
  assert.match(failed.text, /^The transcript was not imported\. Zoom no longer accepts/);
  assert.equal(failed.can.retry, true);
  assert.match(meetingStatus(REF('failed'), after).text, /could not be imported\. Try again\./);
  assert.equal(meetingStatus(REF('cancelled'), after).text, 'Cancelled.');
  assert.equal(meetingStatus(REF('weird'), after).text, 'Status not recorded.');
  for (const st of ['scheduled', 'ended', 'transcript_ready', 'imported', 'no_transcript', 'failed', 'cancelled']) {
    assert.doesNotMatch(meetingStatus(REF(st), after).text, /telegram|whatsapp/i, 'no call is promised over Telegram or WhatsApp');
  }
});

test('a cancel says "Cancelled" only when the provider confirmed it; otherwise it says to delete the call there', () => {
  assert.equal(cancelOutcome('zoom', { meeting: {}, provider_cancelled: true }).text, 'Cancelled in Zoom too: its link no longer works.');
  assert.match(cancelOutcome('google_meet', { provider_cancelled: true }).text, /^Cancelled, and deleted from your Google Calendar\.$/);
  // `false`: not connected, refused or unreachable; `null`: no provider call was made; nothing: an answer without it.
  for (const r of [{ provider_cancelled: false }, { provider_cancelled: null }, {}, undefined]) {
    const z = cancelOutcome('zoom', r);
    assert.equal(z.tone, 'warn', JSON.stringify(r));
    assert.match(z.text, /^Removed from Axal, but Zoom did not confirm the call was cancelled\. It may still exist in your Zoom account with a working link: delete it there\.$/);
    assert.doesNotMatch(z.text, /^Cancelled/);
    const g = cancelOutcome('google_meet', r);
    assert.match(g.text, /may still be in your Google Calendar with a working Meet link: delete it there/);
  }
  // The question promises only what the Worker does: it asks the provider.
  assert.equal(cancelQuestion('zoom'), 'Cancel this call? Axal also asks Zoom to cancel it.');
  assert.match(cancelQuestion('google_meet'), /asks Google to delete it from your calendar/);
  for (const p of ['zoom', 'google_meet']) assert.doesNotMatch(cancelQuestion(p), /stops working/);
});

test('the schedule form promises a transcript only when the provider will make one; Zoom records to the cloud only when asked', () => {
  const zoomOff = transcriptNote('zoom', false);
  assert.match(zoomOff, /Zoom makes a transcript only from a cloud recording\. Without it, no transcript comes into the session/);
  assert.doesNotMatch(zoomOff, /transcript comes into that session/);
  assert.equal(transcriptNote('zoom', undefined), zoomOff);
  assert.match(transcriptNote('zoom', true), /Zoom records the call to the cloud, and when it ends Zoom’s transcript comes into that session[^]*paid plan with Audio transcript turned on/);
  assert.match(transcriptNote('google_meet', true), /only when someone turns on transcription in the call/);
  assert.equal(defaultMeetingForm().record, false, 'recording a customer is the member’s choice, never a default');
  const now = Date.parse('2026-10-13T08:00:00Z');
  const form = { provider: 'zoom', date: '2026-10-20', time: '09:30', duration: 30, consent: 'verbal' };
  assert.equal(meetingBody({ ...form, record: true }, now).body.auto_record, true);
  assert.equal('auto_record' in meetingBody({ ...form, record: false }, now).body, false);
  assert.equal('auto_record' in meetingBody(form, now).body, false);
  assert.equal('auto_record' in meetingBody({ ...form, provider: 'google_meet', record: true }, now).body, false, 'Meet has no cloud-recording setting');
  assert.match(meetingBody({ ...form, consent: '', record: true }, now).error, /agreed to be recorded/, 'no consent, no recording');
  assert.match(MEETING_NOTES.zoom, /Record in the cloud turned on/);
  assert.doesNotMatch(MEETING_NOTES.zoom, /; its transcript comes in when the call ends/);
  assert.match(MEETING_NOTES.google_meet, /only if someone turned on transcription in it/);
});

test('a bare error code is mapped or left out, never printed alone', () => {
  assert.match(meetingError({ error_code: 'meet_scope_missing' }), /Reconnect your account/);
  assert.match(meetingError({ last_error: 'zoom_not_connected' }), /not connected/);
  assert.equal(meetingError({ last_error: 'zzz_unknown' }), '');
  assert.equal(meetingError({}), '');
});

test('the schedule form: local time to UTC, a future time, a duration; the refusal points at Connectors when connecting is the fix', () => {
  const now = Date.parse('2026-10-13T08:00:00Z');
  const ok = meetingBody({ provider: 'google_meet', date: '2026-10-20', time: '09:30', duration: 45, topic: '  Interview with Ada ', consent: 'written' }, now);
  assert.equal(ok.body.provider, 'google_meet');
  assert.deepEqual(ok.body.consent, { status: 'given', method: 'written' }, 'how the interviewee agreed travels with the call');
  assert.match(meetingBody({ provider: 'zoom', date: '2026-10-20', time: '09:30', duration: 30 }, now).error, /agreed to be recorded and transcribed/);
  assert.match(meetingBody({ provider: 'zoom', date: '2026-10-20', time: '09:30', duration: 30, consent: 'telepathy' }, now).error, /agreed to be recorded/);
  assert.equal(ok.body.starts_at, new Date('2026-10-20T09:30:00').toISOString());
  assert.equal(ok.body.duration_min, 45);
  assert.equal(ok.body.topic, 'Interview with Ada');
  assert.equal('topic' in meetingBody({ provider: 'zoom', date: '2026-10-20', time: '09:30', duration: 30, topic: '', consent: 'verbal' }, now).body, false);
  assert.match(meetingBody({ provider: 'zoom', date: '2020-01-01', time: '09:00', duration: 30 }, now).error, /in the future/);
  assert.match(meetingBody({ provider: 'teams', date: '2026-10-20', time: '09:00', duration: 30 }, now).error, /Zoom or Google Meet/);
  assert.match(meetingBody({ provider: 'zoom', date: '', time: '09:00', duration: 30 }, now).error, /date and a time/);
  assert.match(meetingBody({ provider: 'zoom', date: '2026-10-20', time: '09:00', duration: 0 }, now).error, /how long/);
  assert.deepEqual(scheduleRefusal(Object.assign(new Error('Zoom is not connected to your Axal account.'), { status: 409, code: 'zoom_not_connected' }), 'zoom'), { text: 'Zoom is not connected to your Axal account.', connect: true });
  assert.equal(scheduleRefusal(Object.assign(new Error('Connect Zoom in Account › Connectors first, then schedule the call.'), { status: 409, code: 'connect_first' }), 'zoom').connect, true);
  assert.equal(scheduleRefusal(Object.assign(new Error('Schedule it again.'), { status: 409, code: 'meeting_conflict' }), 'zoom').connect, false, 'a 409 is not by itself a reason to connect');
  assert.equal(scheduleRefusal(Object.assign(new Error('Try again.'), { status: 502, code: 'zoom_create_failed' }), 'zoom').connect, false);
  // The meeting read's providers (routes/founder_validate_meetings.ts) say what to fix before pressing anything.
  const ps = meetingProviders({ providers: [
    { provider: 'zoom', available: true, connected: false, transcript_access: null },
    { provider: 'google_meet', available: true, connected: true, transcript_access: 'missing' },
  ] });
  assert.equal(providerNote('zoom', ps.zoom), 'Connect Zoom in Account › Connectors first.');
  assert.equal(providerNote('google_meet', ps.google_meet), 'Axal cannot import Google Meet transcripts yet. You can still hold the call: use the recorder in Axal during it, or paste the conversation afterwards.');
  assert.doesNotMatch(providerNote('google_meet', ps.google_meet), /reconnect/i, 'a reconnect cannot help');
  assert.equal(providerNote('zoom', meetingProviders(null).zoom), '', 'an unread provider is not a "no"');
  assert.match(providerNote('zoom', { available: false }), /not set up on Axal yet/);
  const notice = 'Google Meet transcripts are not available on Axal yet, so this call’s transcript will not be imported. You can still hold the call: use the recorder in Axal during it, or paste the conversation afterwards.';
  const scheduledWithNotice = meetingStatus({ ...REF('scheduled'), provider: 'google_meet', error: notice }, now, () => 'Mon 20 Oct, 09:30');
  assert.equal(scheduledWithNotice.tone, 'warn');
  assert.equal(scheduledWithNotice.text, `Scheduled for Mon 20 Oct, 09:30. ${notice}`);
  assert.equal(safeJoinUrl('https://us02web.zoom.us/j/1?pwd=x', 'zoom'), 'https://us02web.zoom.us/j/1?pwd=x');
  assert.equal(safeJoinUrl('https://meet.google.com/abc-defg-hij', 'google_meet'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(safeJoinUrl('https://zoom.us.evil.example/j/1', 'zoom'), null);
  assert.equal(safeJoinUrl('javascript:alert(1)', 'zoom'), null);
  assert.equal(safeJoinUrl('https://meet.google.com/x', 'zoom'), null);
  assert.deepEqual(meetingItems({ meetings: [REF('scheduled')] }).map((m) => m.uid), ['r1']);
  assert.match(callWhen(REF('scheduled'), () => 'Tue 14 Oct, 11:00'), /^Tue 14 Oct, 11:00 · 30 min$/);
  assert.equal(callWhen({}), 'Time not recorded');
});


test('#1602 mutation: an unknown reply must retain the key and never invite another send', async () => {
  const file = new URL('../src/pages/founder/channelThreads.js', import.meta.url);
  const source = readFileSync(file, 'utf8');
  const before = 'return { ok: null, keepKey: true, text: `Not confirmed yet:';
  assert.ok(source.includes(before));
  const mutated = source.replace(before, 'return { ok: null, keepKey: false, text: `Not confirmed yet:');
  const resolveImports = (s) => s.replace(/^(import\s+[^'";]+from\s*['"])([^'"]+)(['"])/gm,
    (_all, first, path, last) => first + (path.startsWith('.') ? new URL(path, file).href : import.meta.resolve(path)) + last);
  const bad = await import('data:text/javascript;base64,' + Buffer.from(resolveImports(mutated)).toString('base64'));
  const input = { ok: null, pending: true, code: 'send_unknown', outbound: { status: 'pending' } };
  assert.equal(replyOutcome('telegram', input).keepKey, true);
  assert.doesNotMatch(replyOutcome('telegram', input).text, /send it again|before sending again/);
  assert.throws(() => assert.equal(bad.replyOutcome('telegram', input).keepKey, true), { name: 'AssertionError' });
});
