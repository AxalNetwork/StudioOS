/**
 * D1580 F1 (#3827) — Present › Rehearse and its report, the frontend half.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rehearse_d1580.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PITCH_CHOICES, RETENTION, budgetLine, cardBudgetsMs, figureGrade, holdLine, noteItemsOf, rowOf, spentByCard, summaryLine,
} from '../src/pages/raise/pitch/rehearseModel.js';
import { SURFACES, SWAPPED } from '../src/pages/raise/pitch/deckV2Adapter.js';

const src = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

test('the pitch lengths are 2, 3 and 5 minutes, shared evenly as the Worker shares them', () => {
  assert.deepEqual(PITCH_CHOICES.map((c) => c.seconds), [120, 180, 300]);
  assert.deepEqual(cardBudgetsMs(180, 7), [26_000, 26_000, 26_000, 26_000, 26_000, 25_000, 25_000]);
  const worker = src('cloudflare-worker/src/services/decks/rehearsal.ts');
  assert.match(worker, /export const PITCH_SECONDS = \[120, 180, 300\] as const;/);
});

test('a card\'s time reads "0:42 of 0:30", from the marks, a card shown twice adding both stretches', () => {
  assert.equal(budgetLine(42_000, 30_000), '0:42 of 0:30');
  const marks = [{ card: 1, at_ms: 0 }, { card: 2, at_ms: 10_000 }, { card: 1, at_ms: 20_000 }];
  assert.deepEqual(spentByCard(marks, 25_000, 3), [15_000, 10_000, 0]);
});

test('the hold line is the quote\'s, and absent until the quote is read; never "$0.00" by default', () => {
  assert.equal(holdLine({ hold_microusd: 20_000 }), 'Transcript · Holds up to $0.0200 · you pay what it uses');
  assert.equal(holdLine(null), null);
  assert.equal(holdLine({}), null);
  assert.equal(RETENTION, 'Your audio is turned into text. The audio is deleted afterwards unless you keep it.');
});

test('a report row draws what was counted and a dash for what was not', () => {
  const row = rowOf({ card: 2, title: 'Traction', time_line: '0:48 of 0:30', over: true, wpm: null, fillers: 3, filler_words: { um: 2, uh: 1 }, pauses: 1, notes_total: 0, notes_covered: 0 });
  assert.deepEqual(row, { card: 2, title: 'Traction', time: '0:48 of 0:30', over: true, wpm: '—', fillers: '3', fillerWords: 'um ×2, uh ×1', pauses: '1', notes: '—' });
  assert.equal(rowOf({ card: 1, title: '', notes_total: 3, notes_covered: 2, fillers: 0, pauses: 0, wpm: 140 }).notes, '2 of 3');
  assert.equal(figureGrade({ grade: 'Measured' }), 'Linked · Measured');
  assert.equal(summaryLine({ time_line: '1:30 of 2:00', totals: { wpm: 132, fillers: 4, pauses: 2 } }), '1:30 of 2:00 · 132 words a minute · 4 filler words · 2 pauses');
  assert.deepEqual(noteItemsOf('- One\n2) Two\n\n• Three'), ['One', 'Two', 'Three']);
});

test('rehearse is swapped to its route, and Present opens it', () => {
  assert.ok(SWAPPED.includes('rehearse'));
  assert.equal(SURFACES.rehearse.issue, 3827);
  const adapter = src('frontend/src/pages/raise/pitch/deckV2Adapter.js');
  assert.match(adapter, /export const rehearse = \(deckId\) => through\(\(\) => deckRehearsalsApi\.list\(deckId\), SURFACES\.rehearse\.issue\);/);
  const present = src('frontend/src/pages/raise/pitch/PitchPresent.jsx');
  assert.match(present, /data-testid="pitch-present-rehearse"/);
  assert.match(present, /if \(view === 'rehearse'\) return;/, 'Present\'s keys stand aside while Rehearse moves the cards');
  const panel = src('frontend/src/pages/raise/pitch/RehearsePanel.jsx');
  assert.match(panel, /deckRehearsalsApi\.run\(/);
  assert.match(panel, /audioBitsPerSecond: AUDIO_BITS_PER_SECOND/, 'the recorder runs at the bitrate the Worker reads minutes by');
  assert.match(panel, /checked=\{report\.audio === 'kept'\}/, '"Keep the audio" is off unless the founder kept it');
});
