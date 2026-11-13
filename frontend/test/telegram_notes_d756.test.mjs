/**
 * D756 §1.12 (#1981, part 2) — Telegram's notes in the inbox: each said as the
 * kind it is (Voice note, Audio file, Round video) from the thread read's
 * `media`, the Worker's refusal sentence for a note it did not transcribe,
 * and no "keep by <date>" line, which is WhatsApp's 7-day rule only (the
 * Worker's `voice_fetch_by`).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/telegram_notes_d756.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { messageView, noteKind, voiceKeepBy } from '../src/pages/founder/channelThreads.js';
import { MessageList } from '../src/pages/founder/ChannelsInbox.jsx';

const h = React.createElement;
const BY = '2026-10-26T09:00:00.000Z';
const note = (over = {}) => ({ uid: 'n1', side: 'contact', kind: 'voice', text: null, awaiting_transcription: true, duration_sec: 8, media: 'voice', voice_fetch_by: null, ...over });

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by: (id) => walk(container).find((n) => pr(n)['data-testid'] === id),
    text: () => text(container).replace(/\s+/g, ' ').trim(),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the three note labels, from the Worker\'s media; anything else is a voice note', () => {
  assert.equal(noteKind({ media: 'voice' }), 'Voice note');
  assert.equal(noteKind({ media: 'audio' }), 'Audio file');
  assert.equal(noteKind({ media: 'video_note' }), 'Round video');
  assert.equal(noteKind({ media: 'sticker' }), 'Voice note');
  assert.equal(noteKind({}), 'Voice note');
  assert.equal(messageView(note({ media: 'audio' }), 'Sam').label, 'Audio file, transcribed when you add this chat to an interview');
  assert.equal(messageView(note({ media: 'video_note', awaiting_transcription: false, text: 'Hi.' }), 'Sam').label, 'Round video (transcribed)');
  assert.equal(messageView(note({ media: 'audio', kind: 'text', text: 'Hi.' }), 'Sam').label, '', 'a text message is no note');
});

test('a note the Worker refused says the kind and the Worker\'s sentence, in its words', () => {
  const failed = note({ media: 'video_note', transcription_failure: { sentence: "Round video messages can't be transcribed yet.", retry: null } });
  const v = messageView(failed, 'Sam');
  assert.equal(v.label, 'Round video');
  assert.deepEqual(v.failure, { sentence: "Round video messages can't be transcribed yet.", action: null });
});

// WhatsApp's keep-by line is the thread's, once per waiting chat (`voiceKeepBy`, D754 §5, #1980,
// held by record_consent_d754.test.mjs). Here: Telegram never gets one.
test('no keep-by line for Telegram; WhatsApp\'s comes from the Worker\'s date, once per waiting chat', () => {
  const day = (iso) => `day(${iso.slice(0, 10)})`;
  const tg = { provider: 'telegram', status: 'pending' };
  assert.equal(voiceKeepBy(tg, [note({ voice_fetch_by: null })], day), null, 'Telegram: the Worker sends no date');
  assert.equal(voiceKeepBy(tg, [note({ voice_fetch_by: BY })], day), null, 'Telegram: no line even if a date arrived');
  assert.equal(voiceKeepBy({ provider: 'whatsapp', status: 'pending' }, [note({ voice_fetch_by: BY })], day), 'Add this chat to an interview by day(2026-10-26) to keep its voice notes.');
});

test('the inbox draws each Telegram note by its kind, and no note draws a keep-by line of its own', async () => {
  const messages = [
    note({ uid: 'v', media: 'voice' }),
    note({ uid: 'a', media: 'audio' }),
    note({ uid: 'r', media: 'video_note', transcription_failure: { sentence: "Round video messages can't be transcribed yet.", retry: null } }),
  ];
  const tg = await mount(h(MessageList, { messages, contact: 'Sam', threadUid: 't1', api: {} }));
  try {
    const all = tg.text();
    assert.match(all, /Sam · Voice note, transcribed when you add this chat to an interview/);
    assert.match(all, /Sam · Audio file, transcribed when you add this chat to an interview/);
    assert.match(all, /Sam · Round video Round video messages can't be transcribed yet\./);
    for (const uid of ['v', 'a', 'r']) assert.equal(tg.by(`voice-keep-by-${uid}`), undefined, `${uid}: no keep-by line`);
    assert.doesNotMatch(all, /to keep its voice notes/);
  } finally { await tg.unmount(); }
  const wa = await mount(h(MessageList, { messages: [note({ uid: 'w', voice_fetch_by: BY })], contact: 'Ada', threadUid: 't2', api: {} }));
  try {
    assert.equal(wa.by('voice-keep-by-w'), undefined, 'WhatsApp\'s line is the thread\'s (voiceKeepBy), never one per note');
  } finally { await wa.unmount(); }
});
