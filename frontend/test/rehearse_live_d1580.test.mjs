/**
 * D1580 part 2b (#3827) — Rehearse's live words a minute and live notes checklist.
 *
 *   1. The counting mirrors the Worker's report: the same words, the same
 *      60%-of-stems rule for a notes item, and no words a minute under five
 *      seconds (never 0 for "not counted yet").
 *   2. The live text is held per card: a final turn stays on the card that was
 *      up; interim text is shown, then replaced.
 *   3. The hold line names the block; the client's live paths are the
 *      Worker's; the panel feeds 16 kHz PCM to the socket, ticks notes ✓/○ and
 *      closes the socket on release; the rail option names the call site.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIVE_WORDS, LIVE_OFF, itemCovered, liveHoldLine, liveSaid, liveWpm, wordsIn,
} from '../src/pages/raise/pitch/rehearseModel.js';
import { deckRehearsalsApi } from '../src/lib/api/deckRehearsals.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const read = (p) => readFileSync(p, 'utf8');

test('1. the same words and the same notes rule as the Worker\'s report', () => {
  assert.deepEqual(wordsIn("We're at $2M ARR — it's 1.4x."), ["We're", 'at', '2M', 'ARR', "it's", '1.4x']);
  assert.equal(itemCovered('Mention the pilot customers', 'our pilot customers love it'), true);
  assert.equal(itemCovered('Introduce the team', 'let me introduce the team.'), true);
  assert.equal(itemCovered('Introduce the team', 'we sell freight software'), false);
  assert.equal(itemCovered('the and of', 'the and of'), false, 'an item with no content words is never ticked');
  // Mutation checked: 0.5 for 0.6 → half an item ("pilot" of "pilot customers") is ticked.
  assert.equal(itemCovered('pilot customers', 'the pilot went well'), false, 'half the words is not 60%');
  assert.equal(itemCovered('pilot customers renewals', 'pilot customers'), true, 'two of three is');
  // The Worker's own rule, read from its source, so the two cannot drift silently.
  const worker = read('cloudflare-worker/src/services/decks/rehearsal.ts');
  assert.match(worker, /return need\.filter\(\(w\) => have\.has\(w\)\)\.length \/ need\.length >= 0\.6;/);
  const model = read('frontend/src/pages/raise/pitch/rehearseModel.js');
  for (const line of [
    "const WORD = /[\\p{L}\\p{N}]+(?:['’.-][\\p{L}\\p{N}]+)*/gu;",
    "const stem = (w) => w.toLowerCase().replace(/[’']s$/, '').slice(0, 6);",
  ]) assert.ok(model.includes(line) && worker.includes(line.replace('(w)', '(w: string)')), line);
});

test('1. words a minute: none under five seconds, then words over the minutes', () => {
  // Mutation checked: liveWpm returning 0 under five seconds → the first assertion fails.
  assert.equal(liveWpm('one two three', 4999), null);
  assert.equal(liveWpm('', 4999), null);
  assert.equal(liveWpm(Array(150).fill('word').join(' '), 60_000), 150);
  assert.equal(liveWpm(Array(50).fill('word').join(' '), 20_000), 150);
  assert.equal(liveWpm('', 10_000), 0, 'ten silent seconds are 0 words a minute');
});

test('2. live text per card: finals stay on their card; interim text is shown, then replaced', () => {
  // Mutation checked: take() keeping interim text as final → card 0 reads the interim twice.
  const s = liveSaid();
  s.take({ text: 'let me introduce', final: false }, 0);
  assert.equal(s.card(0), 'let me introduce');
  s.take({ text: 'let me introduce the team.', final: true }, 0);
  assert.equal(s.card(0), 'let me introduce the team.');
  s.take({ text: 'our pilot', final: false }, 1);
  assert.equal(s.card(0), 'let me introduce the team.', 'interim text belongs to the card it was said on');
  assert.equal(s.card(1), 'our pilot');
  s.take({ text: 'our pilot customers love it.', final: true }, 1);
  s.take(null, 1);
  s.take({ text: '', final: true }, 1);
  assert.equal(s.all, 'let me introduce the team. our pilot customers love it.');
});

test('3. the hold line names the block; nothing before the quote', () => {
  assert.equal(LIVE_WORDS, 'Count words live');
  assert.match(liveHoldLine({ hold_microusd: 30000, block_minutes: 4 }), /^Live words · Holds up to .+ for each 4 minutes · you pay what it uses$/);
  assert.equal(liveHoldLine(null), null);
  assert.equal(liveHoldLine({ refused: { message: 'x' } }), null);
});

test('3. the client\'s live paths are the Worker\'s, and the socket is wss on https', () => {
  const worker = read('cloudflare-worker/src/routes/deck_rehearsals.ts');
  assert.ok(worker.includes("deckRehearsals.post('/:id{[0-9]+}/rehearsals/live/quote'"));
  assert.ok(worker.includes("deckRehearsals.get('/:id{[0-9]+}/rehearsals/live'"));
  assert.equal(deckRehearsalsApi.liveUrl(41, { protocol: 'https:', host: 'axal.vc' }), 'wss://axal.vc/api/decks/41/rehearsals/live');
  assert.equal(deckRehearsalsApi.liveUrl(41, { protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/api/decks/41/rehearsals/live');
  assert.match(read('frontend/src/lib/api/deckRehearsals.js'), /liveQuote: \(deckId\) => request\(at\(deckId, '\/live\/quote'\), \{ method: 'POST'/);
});

test('3. the panel feeds 16 kHz PCM, ticks the notes ✓/○ from what was said on the card, and closes the socket on release', () => {
  // Mutation checked: release() not closing the socket → the r.socket?.close() assertion fails.
  const src = read('frontend/src/pages/raise/pitch/RehearsePanel.jsx');
  assert.match(src, /url: deckRehearsalsApi\.liveUrl\(deckId\)/);
  assert.match(src, /r\.socket\.send\(downsampleTo16k\(e\.inputBuffer\.getChannelData\(0\), r\.ctx\.sampleRate\)\)/);
  assert.match(src, /itemCovered\(t, saidHere\)/);
  assert.match(src, /\{done \? '✓' : '○'\}/);
  assert.match(src, /saidHere = live \? said\.card\(at\) : ''/);
  const release = src.slice(src.indexOf('const release = useCallback'), src.indexOf('useEffect(() => release'));
  assert.match(release, /r\.socket\?\.close\(\)/);
  assert.match(release, /r\.processor\.onaudioprocess = null/);
  assert.match(src, /if \(liveOn && liveReady\) openLive\(r, source\)/, 'live only when switched on and the quote allows it');
  assert.match(src, /e\?\.code === BUDGET_CLOSE \? 'budget' : 'stopped'/);
  assert.match(src, /useRailOption\('transcribe:rehearsal-live', LIVE_WORDS\)/);
  assert.ok(src.includes('<LiveLine state={liveState} wpm={wpm} />'));
  assert.ok(read('frontend/src/pages/raise/pitch/rehearseModel.js').includes(LIVE_OFF.slice(0, 20)));
  const row = FOUNDER_OPTIONS.find((o) => o.key === 'transcribe:rehearsal-live');
  assert.deepEqual(row.at, [['frontend/src/pages/raise/pitch/RehearsePanel.jsx', 'deckRehearsalsApi.liveUrl(']]);
  assert.equal(row.label, LIVE_WORDS);
});
