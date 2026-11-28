/**
 * D9288 (#9288) — Eadwyn's history is honest about itself.
 *
 *   1. a failed history read draws the unreadable state with Retry, never the
 *      orientation an empty history gets;
 *   2. an empty history draws its empty state (the orientation);
 *   3. the question widget's partial failure draws the unreadable state, not
 *      empty or stale buckets;
 *   4. one stored tool envelope draws the same live and after a reload;
 *   5. the phone's transcript sheet shows the receipt.
 *
 * `PersonalAdvisor` and `AdvisorProgressWidget` reach `lib/advisor/router.js`,
 * which a Node test cannot import, so their wiring is pinned in the source
 * through `codeOnly`; the model and the pieces they draw are imported.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_history_honesty_9288.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import {
  HISTORY_UNREADABLE, QUEUE_UNREADABLE, TOOL_UNREADABLE, historyUnreadableNotice, isHistoryUnreadable,
  openingState, queueReadState, readToolMessage, toolEnvelopeText, toolReceiptText,
} from '../src/lib/advisor/transcript.js';
import { ToolPreview, UnreadableNotice } from '../src/components/advisor/transcriptPieces.jsx';
import { TranscriptSheet, transcriptLines } from '../src/pages/founder/StudioPhone.jsx';

const h = React.createElement;
const read = (rel) => codeOnly(readFileSync(resolve(rel), 'utf8'));
const ADVISOR = read('frontend/src/components/advisor/PersonalAdvisor.jsx');
const WIDGET = read('frontend/src/components/advisor/AdvisorProgressWidget.jsx');
const textOf = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** What `/advisor/tool/auto` stores (`JSON.stringify(envelope).slice(0, 4000)`) and answers. */
const ENVELOPE = {
  result: { advisors: [
    { id: 'a1', title: 'Rhea Okafor', snippet: 'GTM for B2B pilots' },
    { id: 'a2', title: 'Tomas Lind', snippet: 'Pricing' },
    { id: 'a3', name: 'Ines Duarte' },
    { id: 'a4', title: 'Kai Mori' },
  ] },
  cta: { label: 'See advisors', route: '/advisors', primary: { label: 'See advisors', route: '/advisors' } },
};
const RESPONSE = { status: 'ok', tool: 'findAdvisor', requested_tool: 'findAdvisor', degraded_to_paywall: false, conversation_uid: 'c1', ...ENVELOPE };
const STORED = { role: 'tool', content: JSON.stringify(ENVELOPE).slice(0, 4000), question_id: null, created_at: '2026-11-20 10:00:00' };

test('1. a failed history read opens on the unreadable state, with Retry', async () => {
  assert.equal(openingState({ historyReadable: false, hydrated: 0 }), 'unreadable');
  assert.equal(openingState({ historyReadable: false, hydrated: 3 }), 'unreadable');

  let retried = 0;
  const notice = historyUnreadableNotice(() => { retried += 1; });
  assert.ok(isHistoryUnreadable(notice));
  assert.equal(notice.content, HISTORY_UNREADABLE);
  assert.equal(HISTORY_UNREADABLE, "Couldn't load your earlier conversation.");
  assert.ok(!isHistoryUnreadable({ role: 'assistant', content: HISTORY_UNREADABLE }));

  const view = await mountContracts(h(UnreadableNotice, { message: notice.content, onRetry: notice.onRetry }), '/studio');
  try {
    assert.match(view.text(), /Couldn't load your earlier conversation\. Retry/);
    await view.click('Retry');
    assert.equal(retried, 1, 'Retry runs the read again');
  } finally { await view.unmount(); }

  // The panel: a failed read (or a reply with no messages) marks the history
  // unreadable, opens on the notice, and its Retry runs the load again.
  assert.match(ADVISOR, /if \(!Array\.isArray\(hist\?\.messages\)\) throw/);
  assert.match(ADVISOR, /\} catch \(e\) \{\s*reportError\('PersonalAdvisor:history', e\);\s*historyReadable = false;\s*\}/);
  assert.match(ADVISOR, /const opening = openingState\(\{ historyReadable, hydrated \}\);/);
  assert.match(ADVISOR, /if \(opening === 'unreadable'\) setMessages\(\[historyUnreadableNotice\(\(\) => setBootRun\(\(n\) => n \+ 1\)\)\]\);/);
  assert.match(ADVISOR, /useEffect\(\(\) => \{ if \(user\) bootstrap\(\); \}, \[user, bootstrap, bootRun\]\);/);
  assert.match(ADVISOR, /if \(isHistoryUnreadable\(m\)\) return <UnreadableNotice message=\{m\.content\} onRetry=\{m\.onRetry\}/);
});

test('2. an empty history draws its empty state, the orientation', () => {
  assert.equal(openingState({ historyReadable: true, hydrated: 0 }), 'orient');
  assert.equal(openingState({ historyReadable: true, hydrated: 2 }), 'history');
  assert.match(ADVISOR, /if \(opening === 'orient' && shouldOrient\(\{ ready: true, messageCount: hydrated \}\)\) \{/,
    'the orientation is gated on a history that was read and is empty');
});

test('3. a partial queue failure draws the unreadable state, not empty or stale buckets', () => {
  const ok = { status: 'fulfilled', value: { next_question: { id: 'q1' }, queue: [{ id: 'q2' }], paywall_ctas: [], complete: false } };
  const answered = { status: 'fulfilled', value: { answered: [{ question_id: 'q0' }] } };
  const failed = { status: 'rejected', reason: new Error('503') };
  assert.deepEqual(queueReadState(ok, answered), {
    readable: true,
    queue: { next_question: { id: 'q1' }, queue: [{ id: 'q2' }], paywall_ctas: [], complete: false },
    answered: [{ question_id: 'q0' }],
  });
  assert.equal(queueReadState(failed, answered).readable, false, 'the queue failed');
  assert.equal(queueReadState(ok, failed).readable, false, 'the answered list failed');
  assert.equal(queueReadState(ok, { status: 'fulfilled', value: {} }).readable, false, 'answered came back without its list');
  assert.equal(queueReadState({ status: 'fulfilled', value: null }, answered).readable, false, 'the queue came back empty-handed');

  const drawn = textOf(renderToStaticMarkup(h(UnreadableNotice, { message: QUEUE_UNREADABLE, onRetry() {} })));
  assert.equal(drawn, "Couldn't load your questions. Retry");

  // The widget keeps its last good read only behind the notice, and draws
  // neither the phone buckets nor the desktop ones while it shows.
  assert.match(WIDGET, /const read = queueReadState\(q, a\);\s*if \(read\.readable\) \{\s*setQueue\(read\.queue\);\s*setAnswered\(read\.answered\);\s*\}\s*setUnreadable\(!read\.readable\);/);
  assert.match(WIDGET, /const unreadableNotice = unreadable\s*\? <UnreadableNotice message=\{QUEUE_UNREADABLE\} onRetry=\{refresh\}/);
  assert.match(WIDGET, /\{unreadableNotice\}\s*\{!unreadableNotice && <PhoneBuckets/);
  assert.match(WIDGET, /\{unreadableNotice\}\s*\{!unreadableNotice && \(<>\s*(?:\{\}\s*)?<Bucket\s+title="Proposed"/);
});

test('4. one stored tool envelope draws the same live and after a reload', () => {
  // The panel builds the live row from the response with the stored envelope's text.
  assert.match(ADVISOR, /setMessages\(\(m\) => \[\.\.\.m, \{\s*role: 'tool',\s*content: toolEnvelopeText\(r\),\s*\}\]\);/);
  assert.doesNotMatch(ADVISOR, /cta: r\.cta/, 'a live row carries no CTA of its own');
  assert.match(ADVISOR, /const tool = readToolMessage\(m\);\s*const cta = tool \? tool\.cta : \(m\.cta \|\| null\);/);
  assert.match(ADVISOR, /\{tool \? \(\s*<ToolPreview view=\{tool\} \/>/);

  const live = { role: 'tool', content: toolEnvelopeText(RESPONSE) };
  assert.equal(live.content, STORED.content, 'the live row is the stored row');
  assert.deepEqual(readToolMessage(live), readToolMessage(STORED));
  assert.deepEqual(readToolMessage(STORED), { result: ENVELOPE.result, cta: ENVELOPE.cta, refused: null, unreadable: false });

  const liveHtml = renderToStaticMarkup(h(ToolPreview, { view: readToolMessage(live) }));
  assert.equal(liveHtml, renderToStaticMarkup(h(ToolPreview, { view: readToolMessage(STORED) })));
  const t = textOf(liveHtml);
  for (const want of ['Rhea Okafor', 'GTM for B2B pilots', 'Ines Duarte', 'Kai Mori']) assert.ok(t.includes(want), want);
  assert.doesNotMatch(t, /\{|"result"/, 'no raw envelope');

  // A row the Worker cut at 4000 characters, or refused, says so in words.
  const cut = { role: 'tool', content: '{"result":{"advisors":[{"id":"a1","title":"Rh' };
  assert.equal(readToolMessage(cut).unreadable, true);
  assert.equal(textOf(renderToStaticMarkup(h(ToolPreview, { view: readToolMessage(cut) }))), TOOL_UNREADABLE);
  const refused = readToolMessage({ role: 'tool', content: 'refused:rate_limited' });
  assert.equal(refused.refused, 'rate_limited');
  assert.equal(textOf(renderToStaticMarkup(h(ToolPreview, { view: refused }))), 'That action was not run.');
  assert.equal(readToolMessage({ role: 'assistant', content: STORED.content }), null, 'only a tool row is a tool turn');
});

test('5. the phone transcript shows the receipt, compactly', async () => {
  assert.equal(toolReceiptText(readToolMessage(STORED)), 'Found 4: Rhea Okafor, Tomas Lind, Ines Duarte and 1 more.');
  assert.equal(toolReceiptText(readToolMessage({ role: 'tool', content: toolEnvelopeText({ result: { advisors: [] }, cta: ENVELOPE.cta }) })), 'No matches yet.');
  assert.equal(toolReceiptText(readToolMessage({ role: 'tool', content: toolEnvelopeText({ result: { page: 'Fundraising' }, cta: ENVELOPE.cta }) })), 'Opening Fundraising.');
  assert.equal(toolReceiptText(readToolMessage({ role: 'tool', content: toolEnvelopeText({ result: { gated: true, feature: 'Deal flow', required_tier: 'studio' }, cta: ENVELOPE.cta }) })), 'Deal flow requires the studio tier.');

  const lines = transcriptLines([
    { role: 'user', content: 'Find me an advisor' },
    STORED,
    { role: 'system', content: 'SYSTEM LINE' },
  ]);
  assert.deepEqual(lines.map((l) => l.role), ['user', 'tool']);

  const sheet = await mountContracts(h(TranscriptSheet, {
    row: { id: 'p1', kind: 'profiling', title: 'Profiling questions' }, onClose() {},
    read: async () => ({ messages: [{ role: 'user', content: 'Find me an advisor' }, STORED, { role: 'assistant', content: 'Here they are.' }] }),
  }), '/studio');
  try {
    await sheet.flush();
    const st = sheet.text();
    assert.ok(st.includes('Find me an advisor') && st.includes('Here they are.'));
    assert.ok(st.includes('Found 4: Rhea Okafor, Tomas Lind, Ines Duarte and 1 more.'), 'the receipt is in the phone history');
    assert.ok(!st.includes('"result"'), 'never the raw envelope');
    const at = (s) => st.indexOf(s);
    assert.ok(at('Find me an advisor') < at('Found 4') && at('Found 4') < at('Here they are.'), 'in the order it happened');
  } finally { await sheet.unmount(); }
});
