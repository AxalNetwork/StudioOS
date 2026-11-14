/**
 * D754 (#1980) — a WhatsApp chat's recording consent where the founder sees
 * it: the rules (`chatConsent.js`), the session page's consent line and its
 * discard, and the inbox's Ask for consent and the member's word. Record a
 * Session's own gate is in `record_lightbox_d685.test.mjs`. Part 2 (§5): the
 * inbox's WhatsApp keep-by line and the session page's voice-note playback
 * through Open recording's player. No test calls
 * the network: every API is a stub.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_consent_d754.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  CHAT_CONSENT_METHODS, canAttest, chatConsentBlock, chatConsentOf, consentChoices, consentLine, consentTarget, windowClosedSentence,
} from '../src/pages/founder/chatConsent.js';
import { assignTarget } from '../src/pages/founder/recordSetup.js';
import { MEMBER_CONSENT_METHODS } from '../src/lib/api/channels.js';
import { keepByDay, voiceKeepBy } from '../src/pages/founder/channelThreads.js';
import { ChannelVoiceNotes, ChatConsentLine } from '../src/pages/founder/InterviewSessionPage.jsx';
import { ThreadConsent, ThreadPanel } from '../src/pages/founder/ChannelsInbox.jsx';

const h = React.createElement;
const AT = '2026-10-18T14:05:00.000Z';
const when = (iso) => `@${iso.slice(11, 16)}`;
const view = (over = {}) => ({
  required: true, status: 'not_asked', source: null, method: null, notice_version: null,
  requested_at: null, delivered_at: null, answered_at: null, withdrawn_at: null, notice_status: null,
  window_open: true, can_request: true, next_request_at: null, notices_left: 2, ...over,
});
const NOT_REQUIRED = { required: false, status: null, window_open: false, can_request: false };

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, text: (n) => text(n === undefined ? container : n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// ---------------------------------------------------------------- the rules

test('the member\'s word is the Worker\'s three methods, and the assign body carries Ask or a method', () => {
  assert.deepEqual(CHAT_CONSENT_METHODS.map(([k]) => k), MEMBER_CONSENT_METHODS, 'the same three as channels.js');
  assert.deepEqual(consentTarget('ask'), { ask: true });
  assert.deepEqual(consentTarget('written'), { method: 'written' });
  for (const bad of ['in_app', '', null, '__proto__', 'toString']) assert.equal(consentTarget(bad), null, String(bad));
  const target = assignTarget({ name: 'Dana', company: '', consent: null, chatConsent: 'ask' }, { projectId: 3 });
  assert.deepEqual(target, { create: { interviewee_name: 'Dana', interviewee_company: null, project_id: 3 }, consent: { ask: true } });
  assert.equal('consent' in assignTarget({ name: 'Dana', consent: null }, { projectId: 3 }), false, 'no choice: no consent');
  const c = consentChoices('Dana');
  assert.equal(c.ask.label, 'Ask Dana in WhatsApp');
  assert.equal(c.agreed.label, 'Dana already agreed');
});

test('Start stays disabled until consent is asked or attested; Ask needs the window open', () => {
  const open = chatConsentOf({ consent_status: 'not_asked', reply_window_open: true });
  assert.equal(chatConsentBlock(open, null, 'Dana'), 'Ask Dana in WhatsApp, or say they already agreed.');
  assert.equal(chatConsentBlock(open, 'ask', 'Dana'), null);
  assert.equal(chatConsentBlock(open, 'verbal', 'Dana'), null);
  const closed = chatConsentOf({ consent_status: 'not_asked', reply_window_open: false });
  assert.equal(chatConsentBlock(closed, 'ask', 'Dana'), windowClosedSentence('Dana'));
  assert.equal(chatConsentBlock(closed, 'written', 'Dana'), null, 'the member\'s word needs no window');
  assert.equal(windowClosedSentence('Dana'), 'Dana last wrote more than 24 hours ago, and WhatsApp only lets Axal write within 24 hours of their last message. Ask Dana to send you a message from your WhatsApp Business app, then ask again.');
  assert.equal(chatConsentBlock(chatConsentOf({ consent_status: 'given' }), null, 'Dana'), null, 'given: nothing to choose');
  assert.equal(chatConsentBlock(chatConsentOf({ consent_status: 'declined' }), 'ask', 'Dana'), 'Dana declined. Nothing from this chat was kept.');
  assert.match(chatConsentBlock(chatConsentOf({ consent_status: 'withdrawn' }), 'ask', 'Dana'), /^Dana withdrew consent/);
});

test('a Telegram thread (required false) is unchanged: no block, no line', () => {
  for (const t of [{ consent_status: null }, { consent: NOT_REQUIRED }, {}]) {
    const c = chatConsentOf(t);
    assert.deepEqual(c, { required: false });
    assert.equal(chatConsentBlock(c, null, 'Tom', 'telegram'), null);
    assert.equal(consentLine(c, 'Tom'), null);
  }
});

test('each consent line\'s words', () => {
  const line = (over, name = 'Dana') => consentLine(chatConsentOf({ consent: view(over) }), name, { when });
  assert.deepEqual(line({ status: 'not_asked' }), { kind: 'waiting', text: 'Waiting for Dana to agree' });
  assert.deepEqual(line({ status: 'requested', delivered_at: AT }), { kind: 'waiting', text: 'Waiting for Dana to agree' });
  assert.deepEqual(line({ status: 'given', source: 'interviewee_reply', method: 'chat_reply', answered_at: AT }), { kind: 'given', text: 'Agreed in WhatsApp at @14:05' });
  assert.deepEqual(line({ status: 'given', source: 'member_attested', method: 'written', answered_at: AT }), { kind: 'given', text: 'Dana already agreed: In writing, recorded at @14:05' });
  assert.deepEqual(line({ status: 'declined' }), { kind: 'declined', text: 'Declined in WhatsApp' });
  assert.deepEqual(line({ status: 'withdrawn', withdrawn_at: AT }), { kind: 'withdrawn', text: 'Dana withdrew consent' });
  assert.deepEqual(line({ status: 'withdrawn' }, ''), { kind: 'withdrawn', text: 'Your contact withdrew consent' }, 'no name: no guess');
  assert.deepEqual(line({ status: 'brand_new' }), { kind: 'waiting', text: 'Waiting for Dana to agree' }, 'an unknown status is not called given');
});

test('the member\'s word is offered only once the notice was delivered', () => {
  assert.equal(canAttest(chatConsentOf({ consent: view({ status: 'requested', delivered_at: AT }) })), true);
  assert.equal(canAttest(chatConsentOf({ consent: view({ status: 'requested' }) })), false, 'sent, not delivered');
  assert.equal(canAttest(chatConsentOf({ consent: view({ status: 'not_asked' }) })), false);
  assert.equal(canAttest(chatConsentOf({ consent: view({ status: 'given', delivered_at: AT }) })), false);
});

// ---------------------------------------------------------------- the session page

test('the session page: the line, and a withdrawn chat\'s discard calls DELETE /sessions/:id once, after a confirm', async () => {
  const removed = [];
  const onDiscard = async () => { removed.push(1); };
  const m = await mount(h(ChatConsentLine, { consent: view({ status: 'withdrawn' }), name: 'Dana', provider: 'whatsapp', onDiscard, when }));
  try {
    assert.equal(m.text(m.by('chat-consent-line')), 'Dana withdrew consent');
    assert.equal(m.pr(m.by('chat-consent')).role, 'status');
    await m.click('button-discard-chat');
    assert.deepEqual(removed, [], 'the first press only asks');
    await m.click('button-confirm-discard-chat');
    await m.click('button-confirm-discard-chat');
    assert.deepEqual(removed, [1], 'discarded once');
  } finally { await m.unmount(); }

  const failing = await mount(h(ChatConsentLine, { consent: view({ status: 'withdrawn' }), name: 'Dana', onDiscard: async () => { throw new Error('SENTINEL-WORKER'); } }));
  try {
    await failing.click('button-discard-chat');
    await failing.click('button-confirm-discard-chat');
    assert.match(failing.text(), /SENTINEL-WORKER/, 'the Worker\'s words');
  } finally { await failing.unmount(); }

  for (const [over, text] of [[{ status: 'given', source: 'interviewee_reply', answered_at: AT }, 'Agreed in WhatsApp at @14:05'], [{ status: 'declined' }, 'Declined in WhatsApp'], [{ status: 'not_asked' }, 'Waiting for Dana to agree']]) {
    const v = await mount(h(ChatConsentLine, { consent: view(over), name: 'Dana', onDiscard: async () => {}, when }));
    try {
      assert.equal(v.text(v.by('chat-consent-line')), text);
      assert.ok(!v.by('button-discard-chat'), 'discard only for a withdrawn chat');
    } finally { await v.unmount(); }
  }
  const none = await mount(h(ChatConsentLine, { consent: NOT_REQUIRED, name: 'Tom', onDiscard: async () => {} }));
  try { assert.ok(!none.by('chat-consent'), 'Telegram: nothing'); } finally { await none.unmount(); }
});

test('the session page reads channel_consent and discards through the sessions API', () => {
  const src = readFileSync('frontend/src/pages/founder/InterviewSessionPage.jsx', 'utf8');
  assert.match(src, /data\.channel_consent\?\.required && \(\s*<ChatConsentLine consent=\{data\.channel_consent\}/);
  assert.match(src, /onDiscard=\{async \(\) => \{ await api\.remove\(session\.id\);/);
  // §11: a channel session never opens the Recording View (#1933's `imported`).
  assert.match(src, /const handOver = inFlight && !recordingOther && !imported;/);
});

// ---------------------------------------------------------------- the inbox

const THREAD = { uid: 'wa-1', provider: 'whatsapp', contact_name: 'Dana Ruiz', interviewee_name: 'Dana', status: 'assigned', interview_id: 7, session_id: 9 };
const stubApi = (over = {}) => {
  const calls = [];
  return {
    calls,
    api: {
      requestConsent: async (uid) => { calls.push(['ask', uid]); return { ok: true }; },
      attestConsent: async (uid, method) => { calls.push(['attest', uid, method]); return { ok: true }; },
      ...over,
    },
  };
};

test('the inbox: the state, Ask for consent once, and the member\'s word after delivery', async () => {
  const s = stubApi();
  let changed = 0;
  const m = await mount(h(ThreadConsent, { thread: THREAD, consent: view(), api: s.api, onChanged: () => { changed += 1; } }));
  try {
    assert.equal(m.text(m.by('thread-consent-line')), 'Waiting for Dana to agree');
    assert.ok(!m.by('thread-consent-attest'), 'no word before the notice is delivered');
    await m.click('button-ask-consent');
    assert.deepEqual(s.calls, [['ask', 'wa-1']]);
    assert.equal(changed, 1, 'the thread is read again');
  } finally { await m.unmount(); }

  const s2 = stubApi();
  const m2 = await mount(h(ThreadConsent, { thread: THREAD, consent: view({ status: 'requested', delivered_at: AT, can_request: false }), api: s2.api }));
  try {
    assert.equal(m2.pr(m2.by('button-ask-consent')).disabled, true, 'the Worker allows no other notice yet');
    await m2.click('button-attest-verbal');
    assert.deepEqual(s2.calls, [['attest', 'wa-1', 'verbal']]);
  } finally { await m2.unmount(); }
});

test('the inbox: a closed window disables Ask with D754\'s sentence; a refusal shows the Worker\'s words; a pending chat is linked first', async () => {
  const s = stubApi();
  const m = await mount(h(ThreadConsent, { thread: THREAD, consent: view({ window_open: false }), api: s.api }));
  try {
    assert.equal(m.pr(m.by('button-ask-consent')).disabled, true);
    assert.equal(m.text(m.by('thread-consent-window')), windowClosedSentence('Dana'));
  } finally { await m.unmount(); }

  const s2 = stubApi({ requestConsent: async () => { throw Object.assign(new Error('SENTINEL-TOO-SOON'), { code: 'too_soon' }); } });
  const m2 = await mount(h(ThreadConsent, { thread: THREAD, consent: view(), api: s2.api }));
  try {
    await m2.click('button-ask-consent');
    assert.match(m2.text(), /SENTINEL-TOO-SOON/);
  } finally { await m2.unmount(); }

  const m3 = await mount(h(ThreadConsent, { thread: { ...THREAD, status: 'pending', interview_id: null, session_id: null }, consent: view({ can_request: false }), api: stubApi().api }));
  try {
    assert.equal(m3.by('button-ask-consent'), undefined);
    assert.match(m3.text(), /Add this chat to an interview first\./);
  } finally { await m3.unmount(); }

  const m4 = await mount(h(ThreadConsent, { thread: { ...THREAD, provider: 'telegram' }, consent: NOT_REQUIRED, api: stubApi().api }));
  try { assert.equal(m4.by('thread-consent'), undefined, 'Telegram: unchanged'); } finally { await m4.unmount(); }
});

test('the inbox panel reads the thread\'s consent and draws it above the messages', () => {
  const src = readFileSync('frontend/src/pages/founder/ChannelsInbox.jsx', 'utf8');
  assert.match(src, /consent: r\.consent \?\? null/);
  assert.match(src, /<ThreadConsent thread=\{thread\} consent=\{data\.consent\}/);
});

// ------------------------------------------------- voice notes (D754 §5, part 2)

const day = (iso) => `<${iso.slice(0, 10)}>`;
const VOICE = [
  { uid: 'm1', side: 'contact', kind: 'text', text: 'hi', sent_at: '2026-10-17T09:00:00Z', voice_fetch_by: null },
  { uid: 'm2', side: 'contact', kind: 'voice', text: null, sent_at: '2026-10-19T09:00:00Z', voice_fetch_by: '2026-10-26T09:00:00.000Z' },
  { uid: 'm3', side: 'contact', kind: 'voice', text: null, sent_at: '2026-10-18T09:00:00Z', voice_fetch_by: '2026-10-25T09:00:00.000Z' },
];
const WAITING = { uid: 'wa-2', provider: 'whatsapp', contact_name: 'Dana Ruiz', status: 'pending', interview_id: null, session_id: null };

test('the keep-by line: WhatsApp only, a waiting chat only, from the earliest voice fetch-by date', () => {
  assert.equal(voiceKeepBy(WAITING, VOICE, day), 'Add this chat to an interview by <2026-10-25> to keep its voice notes.');
  assert.equal(voiceKeepBy({ ...WAITING, provider: 'telegram' }, VOICE, day), null, 'Telegram keeps no such date');
  assert.equal(voiceKeepBy({ ...WAITING, status: 'assigned' }, VOICE, day), null, 'already in an interview');
  assert.equal(voiceKeepBy({ ...WAITING, status: 'ignored' }, VOICE, day), null, 'ignored');
  assert.equal(voiceKeepBy(WAITING, VOICE.map((m) => ({ ...m, voice_fetch_by: null })), day), null, 'no voice note awaits');
  assert.equal(voiceKeepBy(WAITING, [{ voice_fetch_by: 'not a date' }], day), null);
  assert.equal(voiceKeepBy(WAITING, null, day), null);
  assert.equal(keepByDay('nope'), null);
  assert.match(keepByDay('2026-10-25T09:00:00.000Z'), /25/);
});

const threadApi = (thread, messages) => ({ thread: async () => ({ thread, messages, consent: null }) });

test('the thread view draws the keep-by line for a waiting WhatsApp chat, and a Telegram thread is unchanged', async () => {
  const wa = await mount(h(ThreadPanel, { uid: WAITING.uid, api: threadApi(WAITING, VOICE) }));
  try {
    assert.match(wa.text(wa.by('thread-voice-keep-by')), /^Add this chat to an interview by .*25.* to keep its voice notes\.$/);
  } finally { await wa.unmount(); }
  // The Worker gives Telegram no fetch-by date; the gate holds even if one came.
  const tg = await mount(h(ThreadPanel, { uid: 'tg-1', api: threadApi({ ...WAITING, uid: 'tg-1', provider: 'telegram' }, VOICE) }));
  try {
    assert.ok(tg.by('thread-panel'), 'the thread is drawn');
    assert.ok(!tg.by('thread-voice-keep-by'));
  } finally { await tg.unmount(); }
  const assigned = await mount(h(ThreadPanel, { uid: 'wa-3', api: threadApi({ ...WAITING, uid: 'wa-3', status: 'assigned', interview_id: 7, session_id: 9 }, VOICE) }));
  try { assert.ok(!assigned.by('thread-voice-keep-by')); } finally { await assigned.unmount(); }
});

const CHAT_SESSION = { id: 41, submitted_via: 'whatsapp', status: 'transcribed', project_id: 3 };
const CHUNKS = [{ seq: 202, size_bytes: 10, start_ms: null }, { seq: 101, size_bytes: 10, start_ms: null }];

function stubPlayback() {
  const fetched = [];
  const made = [];
  const saved = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  globalThis.fetch = async (url) => { fetched.push(url); return { ok: true, blob: async () => ({ url }) }; };
  URL.createObjectURL = (b) => { made.push(b.url); return `blob:${b.url}`; };
  URL.revokeObjectURL = () => {};
  return { fetched, made, restore() { globalThis.fetch = saved.fetch; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; } };
}

test('the session page: a chat\'s voice notes play through Open recording, in seq order, from GET /sessions/:id/audio', async () => {
  const calls = [];
  const later = new Date(Date.now() + 120_000).toISOString();
  const api = { audio: async (id) => { calls.push(id); return { parts: [
    { seq: 202, url: '/api/files/dl/b', mime: 'audio/ogg', start_ms: null, expires_at: later },
    { seq: 101, url: '/api/files/dl/a', mime: 'audio/ogg', start_ms: null, expires_at: later },
  ] }; } };
  const net = stubPlayback();
  const m = await mount(h(ChannelVoiceNotes, { api, session: CHAT_SESSION, chunks: CHUNKS, consent: view({ status: 'given', answered_at: AT }) }));
  try {
    assert.match(m.text(m.by('channel-voice-notes')), /2 voice notes Open recording/);
    await m.click('button-open-voice-notes');
    assert.deepEqual(calls, [41], 'one audio read for the session');
    assert.deepEqual(net.fetched, ['/api/files/dl/a', '/api/files/dl/b'], 'parts in seq order');
    assert.equal(m.by('voice-notes-player').src, 'blob:/api/files/dl/a', 'the first part plays');
    assert.ok(!m.by('voice-notes-error'));
    await m.click('button-open-voice-notes');
    assert.deepEqual(calls, [41], 'a replay fetches nothing');
  } finally { await m.unmount(); net.restore(); }
});

test('the session page: no voice-note player without consent, without audio, or for a session not from a chat', async () => {
  const api = { audio: async () => { throw new Error('must not be called'); } };
  for (const [props, why] of [
    [{ session: CHAT_SESSION, chunks: CHUNKS, consent: view({ status: 'withdrawn' }) }, 'withdrawn'],
    [{ session: CHAT_SESSION, chunks: CHUNKS, consent: view({ status: 'requested' }) }, 'waiting'],
    [{ session: CHAT_SESSION, chunks: [], consent: view({ status: 'given' }) }, 'no audio'],
    [{ session: { ...CHAT_SESSION, submitted_via: null }, chunks: CHUNKS, consent: null }, 'recorded here'],
    [{ session: { ...CHAT_SESSION, submitted_via: 'zoom' }, chunks: CHUNKS, consent: null }, 'a call'],
  ]) {
    const m = await mount(h(ChannelVoiceNotes, { api, ...props }));
    try { assert.ok(!m.by('channel-voice-notes'), why); } finally { await m.unmount(); }
  }
  // A Telegram chat (consent not required) plays.
  const tg = await mount(h(ChannelVoiceNotes, { api, session: { ...CHAT_SESSION, submitted_via: 'telegram' }, chunks: CHUNKS.slice(0, 1), consent: NOT_REQUIRED }));
  try { assert.match(tg.text(tg.by('channel-voice-notes')), /1 voice note Open recording/); } finally { await tg.unmount(); }
});

test('the session page draws the voice notes under the consent line, from the session read\'s chunks', () => {
  const src = readFileSync(new URL('../src/pages/founder/InterviewSessionPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<ChannelVoiceNotes api=\{api\} session=\{session\} chunks=\{chunks\} consent=\{data\.channel_consent\} \/>/);
  const review = readFileSync(new URL('../src/pages/founder/InterviewReviewPage.jsx', import.meta.url), 'utf8');
  assert.match(review, /useSessionPlayer\(sessions, chosenId\)/, 'Customer research plays through the same player');
});
