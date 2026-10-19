/**
 * D756 (#1981, part 1) — a Telegram chat's consent where the founder sees it:
 * the five states, "Ask for consent in Telegram", "Copy the notice" with each
 * reason, no member's word (ruling 6), and Customer research's "Agreed in the
 * chat". Record a Session's own gate is in `record_lightbox_d685.test.mjs`.
 * No test calls the network or Telegram.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/telegram_consent_view_d756.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  canAttest, chatConsentBlock, chatConsentOf, consentChoices, consentLine, memberWordAllowed, noticeBlocked,
} from '../src/pages/founder/chatConsent.js';
import { ThreadConsent } from '../src/pages/founder/ChannelsInbox.jsx';
import { ChatConsentLine } from '../src/pages/founder/InterviewSessionPage.jsx';

const h = React.createElement;
const AT = '2026-10-18T14:05:00.000Z';
const when = (iso) => `@${iso.slice(11, 16)}`;
const view = (over = {}) => ({
  required: true, status: 'not_asked', source: null, method: null, notice_version: null,
  requested_at: null, delivered_at: null, answered_at: null, withdrawn_at: null, notice_status: null,
  window_open: true, can_request: true, next_request_at: null, notices_left: 2, ...over,
});
const THREAD = { uid: 'tg-1', provider: 'telegram', contact_name: 'Tom Tele', interviewee_name: null, status: 'pending', can_reply: true, interview_id: null, session_id: null };
const NOTICE = 'SENTINEL-NOTICE-FROM-THE-WORKER https://axal.vc/privacy/interviews?n=1';

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
const stubApi = (over = {}) => {
  const calls = [];
  return { calls, api: { requestConsent: async (uid) => { calls.push(['ask', uid]); return { ok: true }; }, attestConsent: async (...a) => { calls.push(['attest', ...a]); return { ok: true }; }, ...over } };
};

// ---------------------------------------------------------------- the rules

test('each consent state: not asked, asked at <time>, YES at <time>, NO, stopped', () => {
  const line = (over) => consentLine(chatConsentOf({ consent: view(over) }), 'Tom', { provider: 'telegram', when })?.text;
  assert.equal(line({ status: 'not_asked' }), 'Not asked yet');
  assert.equal(line({ status: 'requested', requested_at: AT }), 'Asked at @14:05');
  assert.equal(line({ status: 'given', source: 'interviewee_reply', method: 'chat_reply', answered_at: AT }), 'YES at @14:05');
  assert.equal(line({ status: 'declined' }), 'NO');
  assert.equal(line({ status: 'withdrawn' }), 'Stopped');
  assert.equal(line({ status: 'brand_new' }), 'Not asked yet', 'an unknown status is not called YES');
  // The list row reads the same way (#1998: Telegram's `consent_status` is now sent).
  assert.equal(consentLine(chatConsentOf({ consent_status: 'awaiting' }), 'Tom', { provider: 'telegram' }).text, 'Not asked yet');
});

test('Start waits for a YES; nothing stands in for it', () => {
  const c = (over) => chatConsentOf({ consent: view(over) });
  assert.equal(chatConsentBlock(c({ status: 'not_asked' }), null, 'Tom', 'telegram'), 'Ask Tom for consent in Telegram first.');
  assert.equal(chatConsentBlock(c({ status: 'requested' }), null, 'Tom', 'telegram'), "Start waits for Tom's YES in Telegram.");
  for (const choice of ['ask', 'verbal', 'written', 'pre_agreed']) {
    assert.notEqual(chatConsentBlock(c({ status: 'requested' }), choice, 'Tom', 'telegram'), null, `${choice} is not a YES`);
  }
  assert.equal(chatConsentBlock(c({ status: 'given' }), null, 'Tom', 'telegram'), null);
  assert.equal(chatConsentBlock(c({ status: 'declined' }), null, 'Tom', 'telegram'), 'Tom said NO in Telegram, so their notes are not recorded.');
  assert.equal(chatConsentBlock(c({ status: 'withdrawn' }), null, 'Tom', 'telegram'), 'Tom replied STOP in Telegram.');
});

test('no member\'s word for Telegram (ruling 6)', () => {
  assert.equal(memberWordAllowed('telegram'), false);
  assert.equal(memberWordAllowed('whatsapp'), true);
  assert.equal(consentChoices('Tom', 'telegram').agreed, null);
  assert.equal(consentChoices('Tom', 'telegram').ask.label, 'Ask for consent in Telegram');
  const delivered = chatConsentOf({ consent: view({ status: 'requested', delivered_at: AT }) });
  assert.equal(canAttest(delivered, 'telegram'), false);
  assert.equal(canAttest(delivered, 'whatsapp'), true);
});

test('"Copy the notice": each reason, and only the Worker\'s text is copied', () => {
  const c = chatConsentOf({ consent: view({ window_open: true }) });
  assert.equal(noticeBlocked({ can_reply: false }, c), "The bot isn't allowed to reply in this chat");
  assert.equal(noticeBlocked({ can_reply: true }, chatConsentOf({ consent: view({ window_open: false }) })), 'The person last wrote more than 24 hours ago');
  assert.equal(noticeBlocked({ can_reply: false }, chatConsentOf({ consent: view({ window_open: false }) })), "The bot isn't allowed to reply in this chat", 'the reply right first');
  assert.equal(noticeBlocked({ can_reply: true }, c), null);
  assert.equal(chatConsentOf({ consent: view({ notice_text: NOTICE }) }).notice_text, NOTICE);
  assert.equal(chatConsentOf({ consent: view({ notice_text: '  ' }) }).notice_text, null);
  assert.equal(chatConsentOf({ consent: view() }).notice_text, null);
  for (const f of ['frontend/src/pages/founder/chatConsent.js', 'frontend/src/pages/founder/RecordLightbox.jsx', 'frontend/src/pages/founder/ChannelsInbox.jsx']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /privacy\/interviews|Reply YES to agree/, `${f} writes no notice of its own`);
  }
});

// ---------------------------------------------------------------- the inbox

test('the inbox: a pending Telegram chat may be asked; Ask calls the consent-request route once', async () => {
  const s = stubApi();
  const m = await mount(h(ThreadConsent, { thread: THREAD, consent: view(), api: s.api }));
  try {
    assert.equal(m.text(m.by('thread-consent-line')), 'Not asked yet');
    assert.doesNotMatch(m.text(), /Add this chat to an interview first/, 'Telegram is asked while pending');
    assert.equal(m.text(m.by('button-ask-consent')), 'Ask for consent in Telegram');
    await m.click('button-ask-consent');
    assert.deepEqual(s.calls, [['ask', 'tg-1']]);
  } finally { await m.unmount(); }
});

test('the inbox: the reasons and Copy the notice; the clipboard gets the Worker\'s text; no attestation even once delivered', async () => {
  const written = [];
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { written.push(t); } } }, configurable: true });
  try {
    for (const [thread, consent, reason] of [
      [{ ...THREAD, can_reply: false }, view(), "The bot isn't allowed to reply in this chat"],
      [THREAD, view({ window_open: false }), 'The person last wrote more than 24 hours ago'],
    ]) {
      const m = await mount(h(ThreadConsent, { thread, consent: { ...consent, notice_text: NOTICE }, api: stubApi().api }));
      try {
        assert.equal(m.by('button-ask-consent'), undefined);
        assert.equal(m.text(m.by('thread-consent-copy-reason')), `${reason}, so Axal cannot send the notice. Paste it into the chat yourself.`);
        await m.click('button-copy-notice');
      } finally { await m.unmount(); }
    }
    assert.deepEqual(written, [NOTICE, NOTICE]);

    const none = await mount(h(ThreadConsent, { thread: { ...THREAD, can_reply: false }, consent: view(), api: stubApi().api }));
    try { assert.equal(none.by('button-copy-notice'), undefined, 'no text from the Worker: no button'); } finally { await none.unmount(); }

    const s = stubApi();
    const linked = await mount(h(ThreadConsent, { thread: { ...THREAD, status: 'assigned', interview_id: 7, session_id: 9 }, consent: view({ status: 'requested', delivered_at: AT, requested_at: AT }), api: s.api }));
    try {
      assert.equal(linked.by('thread-consent-attest'), undefined, 'no member\'s word for Telegram');
      assert.equal(s.calls.length, 0);
    } finally { await linked.unmount(); }
  } finally {
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav); else delete globalThis.navigator;
  }
});

// ---------------------------------------------------------------- the session page and Customer research

test('the session page draws Telegram\'s words, and "Agreed in the chat" is Customer research\'s chat_reply', async () => {
  for (const [over, text] of [[{ status: 'given', answered_at: AT }, 'YES at @14:05'], [{ status: 'withdrawn' }, 'Stopped'], [{ status: 'requested', requested_at: AT }, 'Asked at @14:05']]) {
    const m = await mount(h(ChatConsentLine, { consent: view(over), name: 'Tom', provider: 'telegram', onDiscard: async () => {}, when }));
    try { assert.equal(m.text(m.by('chat-consent-line')), text); } finally { await m.unmount(); }
  }
  const src = readFileSync('cloudflare-worker/src/services/records/validate.ts', 'utf8');
  assert.match(src, /chat_reply: 'Agreed in the chat'/);
  assert.match(src, /telegram: 'Telegram'/, '"Imported from Telegram" keeps its word');
});
