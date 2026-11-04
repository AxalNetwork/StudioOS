/**
 * D1569 (#3816, deck v2 D8) — an AI voice-over per card, always labelled "AI voice".
 *
 *   1. The model: the quote's line, the hold, a card with no script; the links
 *      Present and the share viewer play are only the Worker's signed ones.
 *   2. The sheet: quote first, then Make; the clip plays labelled "AI voice"
 *      and "Not saved"; Accept saves (the editor reads the new version back);
 *      Discard saves nothing. A card with no script, unsaved changes or a
 *      reader run nothing.
 *   3. Where it lives: ⋯ › This card, never the header or the rail; the rail's
 *      Voice group only shows the model.
 *   4. Present and the share viewer play it, labelled "AI voice".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_voice_d1569.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { deckVoiceApi } from '../src/lib/api/deckVoice.js';
import VoiceSheet from '../src/pages/raise/pitch/VoiceSheet.jsx';
import { CardVoices } from '../src/pages/raise/pitch/ShareViewerParts.jsx';
import { MORE_MENU } from '../src/pages/raise/pitch/deckV2Model.js';
import {
  ACCEPTED, DISCARDED, NO_SCRIPT, SAVE_FIRST, VOICE_LABEL, hasScript, holdText, quoteLine, sharedVoice, voiceUrlFor,
} from '../src/pages/raise/pitch/voiceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const URL1 = '/api/decks/voice/eyJrIjoiZGVjay1hdWRpby83In0.sig';
const QUOTE = { ai: true, model: '@cf/myshell-ai/melotts', job: 'DK10', hold_microusd: 400, chars: 40, label: VOICE_LABEL, balance: { ok: true } };
const CARD = { uid: 'c-cover', title: 'Kestrel', notes: 'We make freight reconciliation automatic.' };

test('1. the model: the quote line and hold; no script; only the Worker\'s signed links play', () => {
  assert.equal(VOICE_LABEL, 'AI voice');
  assert.equal(holdText(400), '$0.0004');
  assert.equal(holdText(25_000), '$0.03');
  assert.equal(holdText(null), null, 'an unknown hold is not $0');
  assert.deepEqual(quoteLine(QUOTE), { ok: true, text: 'AI voice · @cf/myshell-ai/melotts · holds $0.0004 until it is made' });
  assert.deepEqual(quoteLine({ ai: false, message: 'AI assistance is off on this page.' }), { ok: false, text: 'AI assistance is off on this page.' });
  assert.equal(quoteLine({ ...QUOTE, balance: { ok: false, message: 'Add tokens first.' } }).ok, false, 'a balance that cannot cover it runs nothing');
  assert.equal(hasScript(CARD), true);
  assert.equal(hasScript({ notes: '   ' }), false);
  assert.equal(voiceUrlFor({ cards: [{ card_uid: 'c-cover', url: URL1 }] }, 'c-cover'), URL1);
  assert.equal(voiceUrlFor({ cards: [{ card_uid: 'c-cover', url: 'https://evil.example/x.mp3' }] }, 'c-cover'), null, 'only the Worker\'s player');
  assert.equal(voiceUrlFor(null, 'c-cover'), null);
  assert.deepEqual(sharedVoice({ voice: { url: URL1, label: 'Your voice' } }), { url: URL1, label: 'AI voice' }, 'always labelled AI voice');
  assert.equal(sharedVoice({ voice: { key: 'deck-audio/7/x.mp3' } }), null, 'a key is never played');
});

async function mount(props, api) {
  const restore = installDocument();
  const real = { ...deckVoiceApi };
  const calls = [];
  for (const [k, fn] of Object.entries(api)) deckVoiceApi[k] = async (...a) => { calls.push([k, ...a]); return fn(...a); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => root.render(h(VoiceSheet, { deckId: 41, index: 0, card: CARD, readOnly: false, dirty: false, onClose() {}, ...props })));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  return {
    calls, by, pr, text: (id) => txt(by(id)),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick?.(); }); await settle(); },
    async done() { await act(async () => root.unmount()); Object.assign(deckVoiceApi, real); restore(); },
  };
}

const MADE = { proposal: { uid: 'p-1', status: 'proposed' }, card_uid: 'c-cover', model: '@cf/myshell-ai/melotts', label: VOICE_LABEL, url: URL1 };

test('2a. quote first, then Make: the clip plays labelled AI voice, Not saved; Accept saves and the editor reads it back', async () => {
  let accepted = 0;
  const m = await mount({ onAccepted: () => { accepted += 1; } }, { quote: () => QUOTE, make: () => MADE, accept: () => ({ deck: { id: 42 } }) });
  try {
    assert.deepEqual(m.calls.map((c) => c[0]), ['quote'], 'the quote is read first, nothing runs');
    assert.match(m.text('pitch-voice-quote'), /AI voice · @cf\/myshell-ai\/melotts · holds \$0\.0004/);
    await m.click('pitch-voice-make');
    assert.deepEqual(m.calls[1], ['make', 41, 'c-cover']);
    assert.match(m.text('pitch-voice-made'), /AI voice.*Not saved/);
    assert.equal(m.pr(m.by('pitch-voice-audio')).src, URL1);
    assert.equal(accepted, 0, 'nothing is saved before Accept');
    await m.click('pitch-voice-accept');
    assert.deepEqual(m.calls[2], ['accept', 41, 'p-1']);
    assert.equal(accepted, 1, 'the editor reads the new version back');
    assert.equal(m.text('pitch-voice-done'), ACCEPTED);
  } finally { await m.done(); }
});

test('2b. Discard saves nothing; a refusal is said in the Worker\'s words', async () => {
  let accepted = 0;
  const m = await mount({ onAccepted: () => { accepted += 1; } }, { quote: () => QUOTE, make: () => MADE, discard: () => ({ discarded: true }) });
  try {
    await m.click('pitch-voice-make');
    await m.click('pitch-voice-discard');
    assert.deepEqual(m.calls.map((c) => c[0]), ['quote', 'make', 'discard']);
    assert.equal(accepted, 0);
    assert.equal(m.text('pitch-voice-done'), DISCARDED);
  } finally { await m.done(); }
  const off = await mount({}, { quote: () => ({ ai: false, reason: 'assist_off', message: 'AI assistance is off on this page.' }), make: () => MADE });
  try {
    assert.equal(off.text('pitch-voice-quote'), 'AI assistance is off on this page.');
    assert.equal(off.pr(off.by('pitch-voice-make')).disabled, true, 'a refused quote runs nothing');
  } finally { await off.done(); }
  const r = await mount({}, { quote: () => QUOTE, make: () => { throw Object.assign(new Error('Your balance does not cover this voice-over.'), { status: 402 }); } });
  try {
    await r.click('pitch-voice-make');
    assert.equal(r.text('pitch-voice-error'), 'Your balance does not cover this voice-over.');
    assert.ok(!r.by('pitch-voice-made'));
  } finally { await r.done(); }
});

test('2c. no script, unsaved changes or a reader run nothing, not even the quote', async () => {
  for (const [props, line] of [[{ card: { uid: 'c-x', title: 'X' } }, NO_SCRIPT], [{ dirty: true }, SAVE_FIRST], [{ readOnly: true }, 'Read only']]) {
    const m = await mount(props, { quote: () => QUOTE, make: () => MADE });
    try {
      assert.equal(m.text('pitch-voice-blocked'), line);
      assert.equal(m.calls.length, 0, `${line}: nothing read or run`);
      assert.ok(!m.by('pitch-voice-make'));
    } finally { await m.done(); }
  }
});

test('3. the action lives under ⋯ › This card, never in the header or the rail; the rail shows the model only', () => {
  const card = MORE_MENU.find((s) => s.id === 'card');
  const item = card.items.find((i) => i.id === 'voice');
  assert.deepEqual([item.label, item.ai, item.write], ['AI voice-over', true, true]);
  assert.equal(MORE_MENU.filter((s) => s.id !== 'card').some((s) => s.items.some((i) => i.id === 'voice')), false, 'only under This card');
  const editor = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  assert.match(editor, /'find', 'voice'\]\.includes\(id\)\) setSheet\(id\);/);
  assert.match(editor, /<VoiceSheet deckId=\{base\.deck\.id\} card=\{card\} index=\{sel\} readOnly=\{readOnly\} dirty=\{dirty\}/);
  assert.doesNotMatch(read('frontend/src/pages/raise/pitch/DeckToolbar.jsx'), /VoiceSheet|deckVoiceApi/, 'not in the header');
  assert.doesNotMatch(read('frontend/src/pages/raise/pitch/deckRailGroups.js'), /deckVoiceApi\.(make|accept|quote)/, 'the rail runs nothing');
});

test('4. Present and the share viewer play it, labelled AI voice', () => {
  const html = renderToStaticMarkup(h(CardVoices, { slides: [{ title: 'Kestrel', voice: { url: URL1, label: 'AI voice', model: 'm' } }, { title: 'Problem' }] }));
  assert.match(html, /data-testid="share-card-voices"/);
  assert.match(html, /Card 1 · Kestrel.*AI voice/);
  assert.match(html, new RegExp(`<audio[^>]*src="${URL1.replace(/[.]/g, '\\.')}"`));
  assert.doesNotMatch(html, /Card 2/, 'a card without a voice-over draws nothing');
  assert.equal(renderToStaticMarkup(h(CardVoices, { slides: [{ title: 'X' }] })), '', 'nothing when no card has one');
  const page = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.equal((page.match(/<CardVoices slides=\{deck\.slides\} \/>/g) || []).length, 2, 'on both share layouts');
  const present = read('frontend/src/pages/raise/pitch/PitchPresent.jsx');
  assert.match(present, /deckVoiceApi\.read\(deck\.id\)/);
  assert.match(present, /<VoicePlayer url=\{voiceUrlFor\(voices, uids\[i\]\)\} index=\{i\} \/>/);
  assert.match(present, /\{VOICE_LABEL\.toUpperCase\(\)\}/, 'labelled AI voice');
});
