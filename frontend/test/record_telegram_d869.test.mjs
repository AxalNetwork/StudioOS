/**
 * D869 (#2515) — Record a session › Telegram, the boards TG1–TG7 on the reads
 * the Worker already serves, sharing WhatsApp's tool (D862). Every API is
 * stubbed; every value is invented, and no phone number appears in full.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_telegram_d869.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RecordChannelPage from '../src/pages/founder/RecordChannelPage.jsx';
import {
  CHAT_TOOLS, SOURCE_DELETED_TEXT, TG_TABS, consentBanner, consentPill, inboxRows, pageState, premiumLine, telegramSteps, tgHref, tgRoute,
  transcriptTurns, waRoute,
} from '../src/pages/founder/channelSessionModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

/* ------------------------------------------------------------------ *
 * Fixtures (invented)
 * ------------------------------------------------------------------ */

const thread = (uid, o = {}) => ({
  uid, provider: 'telegram', contact_name: '[Contact]', status: 'pending', message_count: 2, last_message_at: '2026-10-21T13:40:00Z',
  last_inbound_at: null, interview_id: null, interviewee_name: null, session_id: null, can_reply: true, reply_window_open: true,
  consent_status: 'not_asked', digest_status: null, pending_suggestions: 0, ...o,
});
const THREADS = [
  thread('g1'),
  thread('g2', { consent_status: 'given', status: 'assigned', session_id: 21, interview_id: 4, interviewee_name: '[Person B]', last_message_at: '2026-10-20T09:00:00Z' }),
  thread('g3', { consent_status: 'withdrawn', last_message_at: '2026-10-19T09:00:00Z' }),
  thread('w1', { provider: 'whatsapp', contact_name: '+44 7700 900123', consent_status: 'awaiting', last_message_at: '2026-10-21T14:06:00Z' }),
  thread('w2', { provider: 'whatsapp', status: 'assigned', session_id: 31, consent_status: 'given', last_message_at: '2026-10-18T09:00:00Z' }),
];
const OVERVIEW = { providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }], connections: { telegram: { status: 'active' } }, pending: { telegram: 2 } };
const SEGMENTS = [
  { id: 1, source: 'final', speaker_label: '[Contact]', text: 'Olá! Recebi a sua mensagem.', translation: 'Hi! I got your message.', translation_status: 'done', source_lang: 'pt', model: 'channel:telegram' },
  { id: 2, source: 'final', speaker_label: '[Contact]', text: 'As inspeções atrasam quase todas as semanas.', translation: null, translation_status: 'pending', source_lang: 'pt', model: 'channel:telegram:change:00000000-0000-4000-8000-000000000001' },
  { id: 3, source: 'final', speaker_label: '[Contact]', text: SOURCE_DELETED_TEXT, translation: null, translation_status: 'undetected', source_lang: null, model: 'channel:telegram:change:00000000-0000-4000-8000-000000000002' },
  { id: 4, source: 'final', speaker_label: 'Me', text: 'Thanks for replying.', translation: null, translation_status: 'same', source_lang: 'en', model: 'channel:telegram' },
];
const step = (n, key, state, code, action = null) => ({ step: n, key, state, code, action });
const SETUP = {
  account: '@synthetic_founder', ready: false, next: 'replies_allowed',
  prerequisites: [{ key: 'telegram_premium', required: true, state: null, line: 'Needs Telegram Premium: chatbots are part of Telegram Business.' }],
  steps: [
    step(1, 'linked', 'done', 'linked'), step(2, 'bot_added', 'done', 'bot_added'), step(3, 'bot_enabled', 'done', 'bot_enabled'),
    step(4, 'replies_allowed', 'todo', 'no_reply_right', 'Allow the Axal bot to reply to messages in Telegram › Settings › Telegram Business › Chatbots, so Axal can ask your contacts for consent.'),
    step(5, 'first_chat', 'blocked', 'needs_bot_on', 'Switch the Axal bot on in Telegram Business first.'),
    step(6, 'consent_notice', 'done', 'notice_ready'),
  ],
};
const UNLINKED = { ...SETUP, account: null, steps: [step(1, 'linked', 'todo', 'not_linked', 'Press Link Telegram, open the link in your Telegram account and press Start.'), ...SETUP.steps.slice(1).map((s) => ({ ...s, state: 'blocked', code: 'needs_link' }))] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('addresses: Telegram’s seven tabs are paths, a session id only where a tab reads one; WhatsApp’s stay its own', () => {
  assert.deepEqual(TG_TABS.map((t) => t.label), ['Inbox', 'Sessions', 'Analytics', 'Proposals', 'Send to Axal', 'Connection', 'MCP access']);
  assert.deepEqual(tgRoute('/validate/record/telegram'), { tab: 'inbox', id: null });
  assert.deepEqual(tgRoute('/validate/record/telegram/send'), { tab: 'send', id: null });
  assert.deepEqual(tgRoute('/validate/record/telegram/sessions/21'), { tab: 'sessions', id: 21 });
  for (const bad of ['/validate/record/telegram/send/3', '/validate/record/telegram/mcp/1', '/validate/record/telegram/nope', '/validate/record/telegram/sessions/0', '/validate/record/telegram/sessions/1/x']) assert.equal(tgRoute(bad), null, bad);
  assert.equal(tgRoute('/validate/record/whatsapp/sessions/2'), null);
  assert.equal(waRoute('/validate/record/telegram/sessions/2'), null);
  assert.equal(waRoute('/validate/record/whatsapp/send'), null, 'WhatsApp has no Send to Axal tab');
  assert.equal(tgHref('proposals', 21), '/validate/record/telegram/proposals/21');
  assert.equal(tgHref('connection', 21), '/validate/record/telegram/connection', 'Connection reads no session');
  assert.equal(CHAT_TOOLS.telegram.filter, 'all', 'TG2 opens on All');
  assert.equal(CHAT_TOOLS.whatsapp.filter, 'whatsapp');
});

test('consent in Telegram’s words: text in with notes held, asked, given, declined, stopped; WhatsApp keeps its own', () => {
  assert.deepEqual(['not_asked', 'awaiting', 'given', 'declined', 'withdrawn'].map((s) => consentPill(s, 'telegram').t),
    ['Text in · notes held', 'Asked · notes held', 'Given', 'Declined', 'Stopped']);
  assert.equal(consentPill('not_asked').t, 'Not asked');
  assert.equal(consentPill('withdrawn', 'whatsapp').t, 'Withdrawn');
  assert.equal(consentPill('mystery', 'telegram').t, 'Not recorded');
  const rows = inboxRows(THREADS, 'all', Date.parse('2026-10-22T00:00:00Z'));
  assert.deepEqual(rows.map((r) => r.uid), ['w1', 'g1', 'g2', 'g3', 'w2'], 'All mixes the channels, newest first');
  assert.equal(rows.find((r) => r.uid === 'g1').consent.t, 'Text in · notes held');
  assert.equal(rows.find((r) => r.uid === 'w1').consent.t, 'Asked', 'each row in its own channel’s words');
  assert.equal(rows.find((r) => r.uid === 'w1').name, '•••• 0123');
  assert.equal(consentBanner({ status: 'given' }, 'telegram').p, 'If the person sends “stop”, Axal stops keeping new messages at once.');
  assert.notEqual(consentBanner({ status: 'given' }).p, consentBanner({ status: 'given' }, 'telegram').p);
});

test('the transcript: a deleted message is a tombstone, an edited one is marked, and the rest reads as before', () => {
  const turns = transcriptTurns(SEGMENTS, 'both');
  assert.deepEqual(turns.map((t) => [t.id, t.deleted, t.edited]), [[1, false, false], [2, false, true], [3, true, false], [4, false, false]]);
  assert.equal(turns[0].translation, 'Hi! I got your message.');
  assert.equal(turns[1].pending, true);
});

test('TG1’s steps from D863’s read: done, to do with the Worker’s sentence, waiting; only an unlinked step 1 is pressed here', () => {
  const steps = telegramSteps(SETUP);
  assert.deepEqual(steps.map((s) => s.t), ['Link with a code', 'Bot added in Telegram Business', 'Bot on', 'Replies allowed', 'First chat in', 'Consent notice ready']);
  assert.deepEqual(steps.map((s) => s.pill), ['Done', 'Done', 'Done', 'To do', 'Waiting', 'Done']);
  assert.match(steps[3].action, /Reply to messages|reply to messages/);
  assert.equal(steps[0].action, null, 'a done step carries no action');
  assert.equal(telegramSteps({ steps: [{ ...step(1, 'linked', 'done', 'linked'), action: 'stale words' }] })[0].action, null, 'even if a sentence comes with it');
  assert.ok(steps.every((s) => !s.link), 'a linked account presses nothing here');
  assert.equal(telegramSteps(UNLINKED)[0].link, true);
  assert.equal(telegramSteps({ ...UNLINKED, steps: [step(1, 'linked', 'todo', 'link_waiting_axal', 'Confirm the Telegram account here in Axal to finish linking.')] })[0].link, false, 'a link already in progress makes no second code');
  assert.deepEqual(telegramSteps(null), []);
  const p = premiumLine(SETUP);
  assert.equal(p.t, 'Needs Telegram Premium');
  assert.equal(p.known, null, 'Axal cannot see Premium, and never says it is held');
  assert.equal(premiumLine({}), null);
});

test('the page state: canary-only for a founder outside Telegram’s canary; empty with no connection; WhatsApp unchanged', () => {
  const ready = (o) => ({ overview: { status: 'ready', overview: o }, threads: { status: 'ready' } });
  assert.equal(pageState(ready(OVERVIEW), 'telegram'), 'ready');
  assert.equal(pageState(ready({ ...OVERVIEW, connections: {} }), 'telegram'), 'empty');
  assert.equal(pageState(ready({ ...OVERVIEW, providers: { telegram: { available: false } }, connections: {} }), 'telegram'), 'canary');
  assert.equal(pageState(ready({ ...OVERVIEW, providers: { telegram: { available: false } }, connections: { telegram: {} } }), 'telegram'), 'ready', 'a connected founder keeps their chats');
  assert.equal(pageState(ready({ ...OVERVIEW, providers: { whatsapp: { available: false } }, connections: {} })), 'empty', 'WhatsApp has no canary board');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stubApi(o = {}) {
  const calls = [];
  const rec = (name, value) => (...a) => { calls.push([name, ...a]); return typeof value === 'function' ? value(...a) : Promise.resolve(value); };
  return {
    calls,
    api: {
      channels: {
        overview: rec('overview', o.overview ?? OVERVIEW),
        threads: rec('threads', o.threads ?? { items: THREADS }),
        telegramSetup: rec('telegramSetup', o.setup ?? SETUP),
        linkTelegram: rec('linkTelegram', { code: 'AXL-0000', url: 'https://t.me/synthetic_axal_bot?start=AXL-0000', expires_at: '2026-10-27T11:10:00Z' }),
        assign: rec('assign', { ok: true }), requestConsent: rec('requestConsent', { ok: true }), ignore: rec('ignore', { ok: true }),
      },
      sessions: {
        get: rec('get', { segments: SEGMENTS, channel_consent: { status: 'given' } }),
        placements: rec('placements', { runs: [{ run_id: 'r1', source: 'studioos', placements: [
          { id: 9, kind: 'prototype_ask', payload: { feature: 'a booking link', build_candidate: true, confidence: 0.7 }, edited_payload: null, status: 'pending', can_accept: true, source: 'studioos', cite: { quote: 'q' } },
        ] }] }),
        accept: rec('accept', { ok: true }), discard: rec('discard', { ok: true }), acceptAll: rec('acceptAll', { accepted: 1, remaining: 0 }),
      },
      analytics: { session: rec('session', {}), venture: rec('venture', { sessions: 1 }) },
      app: { listProjects: rec('listProjects', [{ id: 7, name: '[Acme Robotics]' }]), listInterviews: rec('listInterviews', [{ id: 4, interviewee_name: '[Person B]' }]) },
    },
  };
}

async function mount(path, api) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(RecordChannelPage, { telegramApi: api }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });

test('TG2 mounted: the Telegram page draws the shared inbox on All, in Telegram’s consent words, with seven tabs', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/telegram', api);
  try {
    assert.ok(byId(w.container, 'record-channel-telegram'));
    assert.ok(byId(w.container, 'tg-tool'), 'Telegram draws the tool, not D1309’s Today');
    assert.equal(byId(w.container, 'record-channel-wait'), undefined);
    for (const t of TG_TABS) assert.ok(byId(w.container, `tg-tab-${t.key}`), t.key);
    assert.equal(props(byId(w.container, 'inbox-filter-all'))['aria-checked'], 'true');
    assert.match(text(byId(w.container, 'inbox-consent-g1')), /Text in · notes held/);
    assert.match(text(byId(w.container, 'inbox-consent-g3')), /Stopped/);
    assert.ok(byId(w.container, 'inbox-row-w1'), 'WhatsApp chats share the list on All');
    assert.doesNotMatch(text(w.container), /7700 900123/, 'no number in full');
    await click(byId(w.container, 'inbox-filter-telegram'));
    assert.equal(byId(w.container, 'inbox-row-w1'), undefined);
    await click(byId(w.container, 'inbox-ignore-g1'));
    assert.ok(byId(w.container, 'tg-ignore-dialog'), 'Ignore asks first');
    assert.equal(calls.filter((c) => c[0] === 'ignore').length, 0);
  } finally { await w.done(); }
});

test('TG3 mounted: the edited marker and the deleted tombstone; the session reads Telegram’s consent line', async () => {
  const { api } = stubApi();
  const w = await mount('/validate/record/telegram/sessions/21', api);
  try {
    assert.match(text(byId(w.container, 'turn-edited-2')), /Edited in Telegram/);
    assert.match(text(byId(w.container, 'turn-deleted-3')), /Deleted in Telegram/);
    assert.equal(byId(w.container, 'turn-original-3'), undefined, 'a deleted message shows nothing of it');
    assert.equal(byId(w.container, 'turn-edited-1'), undefined);
    assert.match(text(byId(w.container, 'transcript-consent')), /sends “stop”/);
    assert.match(text(byId(w.container, 'transcript-meta')), /Telegram/);
  } finally { await w.done(); }
});

test('Sessions mounted: Telegram’s picker lists Telegram sessions only', async () => {
  const { api } = stubApi();
  const w = await mount('/validate/record/telegram/sessions', api);
  try {
    assert.ok(byId(w.container, 'tg-sessions-pick-21'));
    assert.equal(byId(w.container, 'tg-sessions-pick-31'), undefined, 'a WhatsApp session is WhatsApp’s');
  } finally { await w.done(); }
});

test('TG5 mounted: a prototype ask carries “Build candidate”', async () => {
  const { api } = stubApi();
  const w = await mount('/validate/record/telegram/proposals/21', api);
  try { assert.equal(text(byId(w.container, 'proposal-build-9')), 'Build candidate'); } finally { await w.done(); }
});

test('TG1 mounted: the steps, the Premium line Axal does not check, and Link with a code only after its dialog', async () => {
  const linked = stubApi();
  let w = await mount('/validate/record/telegram/connection', linked.api);
  try {
    assert.match(text(byId(w.container, 'tg-step-pill-replies_allowed')), /To do/);
    assert.match(text(byId(w.container, 'tg-step-pill-first_chat')), /Waiting/);
    assert.match(text(byId(w.container, 'tg-step-action-replies_allowed')), /Allow the Axal bot to reply/);
    assert.match(text(byId(w.container, 'tg-premium')), /Needs Telegram Premium.*Not checked by Axal/s);
    assert.match(text(byId(w.container, 'tg-login-line')), /never asks for your Telegram login code/);
    assert.equal(byId(w.container, 'tg-link-code'), undefined, 'a linked account presses no code');
    await click(byId(w.container, 'tg-check-again'));
    assert.equal(linked.calls.filter((c) => c[0] === 'telegramSetup').length, 2, 'Check again reads the steps again');
  } finally { await w.done(); }
  const unlinked = stubApi({ setup: UNLINKED, overview: { ...OVERVIEW, connections: {} } });
  w = await mount('/validate/record/telegram/connection', unlinked.api);
  try {
    await click(byId(w.container, 'tg-link-code'));
    assert.ok(byId(w.container, 'tg-link-dialog'));
    assert.equal(unlinked.calls.filter((c) => c[0] === 'linkTelegram').length, 0, 'nothing is made before the dialog’s press');
    await click(byId(w.container, 'tg-link-dialog-confirm'));
    assert.equal(unlinked.calls.filter((c) => c[0] === 'linkTelegram').length, 1);
    assert.equal(text(byId(w.container, 'tg-code-value')), 'AXL-0000');
    assert.equal(props(byId(w.container, 'tg-code-open')).href, 'https://t.me/synthetic_axal_bot?start=AXL-0000');
  } finally { await w.done(); }
  const odd = stubApi({ setup: UNLINKED, overview: { ...OVERVIEW, connections: {} } });
  odd.api.channels.linkTelegram = () => Promise.resolve({ code: 'AXL-0001', url: 'https://example.test/not-telegram' });
  w = await mount('/validate/record/telegram/connection', odd.api);
  try {
    await click(byId(w.container, 'tg-link-code'));
    await click(byId(w.container, 'tg-link-dialog-confirm'));
    assert.equal(text(byId(w.container, 'tg-code-value')), 'AXL-0001');
    assert.equal(byId(w.container, 'tg-code-open'), undefined, 'only a t.me link is offered');
  } finally { await w.done(); }
});

test('TG6 and TG7 mounted: Send to Axal says what the bot asks and holds; MCP access says what is never read; neither needs a chat', async () => {
  const { api } = stubApi({ overview: { ...OVERVIEW, connections: {} }, threads: { items: [] } });
  let w = await mount('/validate/record/telegram/send', api);
  try {
    assert.equal(byId(w.container, 'tg-empty'), undefined, 'Send to Axal stands without a connection');
    assert.match(text(byId(w.container, 'tg-send-held')), /Yes, out loud.*Yes, in writing.*No/s);
    assert.match(text(byId(w.container, 'tg-send-held')), /nothing is downloaded or transcribed/);
    assert.equal(props(byId(w.container, 'tg-send-cr')).href, '/validate/customer-research');
  } finally { await w.done(); }
  w = await mount('/validate/record/telegram/mcp', api);
  try {
    assert.match(text(byId(w.container, 'tg-mcp-never')), /Message text from anyone who has not agreed.*Phone numbers in full.*Your Telegram account or login/s);
    assert.match(text(byId(w.container, 'tg-mcp-clients')), /not listed on this page yet/);
  } finally { await w.done(); }
});

test('TG-S mounted: empty offers Link with a code; canary-only says so; error and no permission are WhatsApp’s boards', async () => {
  let s = stubApi({ overview: { ...OVERVIEW, connections: {} } });
  let w = await mount('/validate/record/telegram', s.api);
  try { assert.equal(props(byId(w.container, 'tg-empty-connect')).href, '/validate/record/telegram/connection'); } finally { await w.done(); }
  s = stubApi({ overview: { providers: [{ provider: 'telegram', available: false }], connections: {} } });
  w = await mount('/validate/record/telegram', s.api);
  try { assert.match(text(byId(w.container, 'tg-canary')), /canary founders only/); } finally { await w.done(); }
  s = stubApi({ threads: () => Promise.reject(Object.assign(new Error('x'), { status: 503 })) });
  w = await mount('/validate/record/telegram', s.api);
  try { assert.ok(byId(w.container, 'tg-error')); } finally { await w.done(); }
  s = stubApi({ threads: () => Promise.reject(Object.assign(new Error('x'), { status: 403 })) });
  w = await mount('/validate/record/telegram', s.api);
  try { assert.ok(byId(w.container, 'tg-nop')); } finally { await w.done(); }
});

test('the routes, and the house rules on the shared tool and Telegram’s tabs', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/validate/record/telegram/:tab', '/validate/record/telegram/:tab/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder']), <RecordChannelPage />)} />`), p);
  }
  const src = ['RecordChatTool.jsx', 'RecordTelegramTool.jsx', 'ChannelSessionParts.jsx', 'channelSessionModel.js'].map((f) => read(`frontend/src/pages/founder/${f}`)).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(alert|confirm|prompt)\(/);
  assert.doesNotMatch(code, /\b(advisor|advice|recommendation)s?\b/i);
  for (const m of code.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) {
    if (/hover:underline/.test(m[1]) && !/hover:(bg|text|border)-/.test(m[1].replace('hover:underline', ''))) continue;
    assert.match(m[1], /dark:hover:/, m[1].slice(0, 90));
  }
  // The bot's own words, so the page and the chat agree (telegramCapture.ts CAPTURE_COPY).
  const capture = read('cloudflare-worker/src/services/channels/telegramCapture.ts');
  for (const w of ['Yes, out loud', 'Yes, in writing', 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?']) {
    assert.ok(capture.includes(w) && src.includes(w), w);
  }
  // The tombstone's text is the Worker's.
  assert.ok(read('cloudflare-worker/src/services/interviewSessions.ts').includes(`SOURCE_DELETED_TEXT = '${SOURCE_DELETED_TEXT}'`));
});
