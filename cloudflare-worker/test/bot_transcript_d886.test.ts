/**
 * D886 (#2584, B6) — the meeting bot's transcript assembly
 * (`services/channels/botTranscript.ts`), on fixtures.
 *
 *   1. Three speakers in one chunk take their participants' names; the founder is "Me".
 *   2. A tie names no one; silence and a thin overlap name no one.
 *   3. A renamed participant's passages all carry the last name.
 *   4. With no overlap, no name is inferred: "Speaker N", numbered in order of first speech.
 *   5. Nova-3's speaker numbers are per chunk: the same number in two chunks can be two people.
 *   6. The participant list: display names, join and leave times; the bot and email addresses never appear.
 *
 * Every name here is a fixture name, never a person's.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/bot_transcript_d886.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleBotTranscript, matchSpeaker, MIN_SHARE, speakerIntervals, type BotEvent, type BotPassage } from '../src/services/channels/botTranscript.ts';

const p = (chunk: number, speaker: number | null, start_ms: number, end_ms: number, text = `t${start_ms}`): BotPassage => ({ chunk, speaker, start_ms, end_ms, text });
const join = (participant_id: string, name: string, at_ms = 0, is_bot = false): BotEvent => ({ type: 'join', participant_id, name, at_ms, ...(is_bot ? { is_bot } : {}) });
const leave = (participant_id: string, at_ms: number): BotEvent => ({ type: 'leave', participant_id, at_ms });
const says = (participant_id: string | null, at_ms: number): BotEvent => ({ type: 'active_speaker', participant_id, at_ms });
const speakers = (out: ReturnType<typeof assembleBotTranscript>) => out.passages.map((x) => x.speaker);

const ROSTER: BotEvent[] = [join('bot', 'Eadwyn AI', 0, true), join('f', 'Sam Founder', 100), join('d', 'Dana Ruiz', 200), join('l', 'Lee Park', 300)];

test('three speakers in one chunk take their names by overlap; the founder is "Me"', () => {
  const events = [...ROSTER, says('f', 0), says('d', 10_000), says('l', 20_000), says(null, 30_000)];
  const out = assembleBotTranscript(
    [p(0, 0, 500, 9_500), p(0, 1, 10_200, 19_000), p(0, 2, 20_100, 29_000), p(0, 0, 29_500, 29_900)],
    events, { founderName: '  sam   founder ', endMs: 40_000 },
  );
  assert.deepEqual(speakers(out), ['Me', 'Dana Ruiz', 'Lee Park', 'Me']);
  assert.deepEqual(out.stats, { speakers: 3, named: 3, unnamed: 0, participants: 3 });
});

test('a tie names no one, and neither does silence or an overlap under MIN_SHARE', () => {
  // Speaker 0 spans Dana's and Lee's turns equally.
  const tie = assembleBotTranscript([p(0, 0, 5_000, 15_000)], [...ROSTER, says('d', 0), says('l', 10_000), says(null, 20_000)], { endMs: 20_000 });
  assert.deepEqual(speakers(tie), ['Speaker 1']);
  // Speaker 0 talks only while the indicator shows no one.
  const silent = assembleBotTranscript([p(0, 0, 1_000, 4_000)], [...ROSTER, says(null, 0), says('d', 5_000)], { endMs: 9_000 });
  assert.deepEqual(speakers(silent), ['Speaker 1']);
  // D886 §4: the share must be at least 60 %. Dana's indicator covers 5 s of a 10 s passage: not enough.
  assert.equal(MIN_SHARE, 0.6);
  const thin = assembleBotTranscript([p(0, 0, 0, 10_000)], [...ROSTER, says(null, 0), says('d', 5_000), says(null, 10_000)], { endMs: 10_000 });
  assert.deepEqual(speakers(thin), ['Speaker 1']);
  // 6 s of 10 s is enough.
  const enough = assembleBotTranscript([p(0, 0, 0, 10_000)], [...ROSTER, says(null, 0), says('d', 4_000), says(null, 10_000)], { endMs: 10_000 });
  assert.deepEqual(speakers(enough), ['Dana Ruiz']);
});

test("a renamed participant's passages all carry the last name, and the list shows it once", () => {
  const events = [...ROSTER, says('d', 0), { type: 'rename', participant_id: 'd', name: 'Dana R. (Ledger)', at_ms: 15_000 } as BotEvent, says(null, 30_000)];
  const out = assembleBotTranscript([p(0, 0, 1_000, 9_000), p(1, 0, 20_000, 28_000)], events, { endMs: 30_000 });
  assert.deepEqual(speakers(out), ['Dana R. (Ledger)', 'Dana R. (Ledger)']);
  assert.deepEqual(out.participants.map((x) => x.name), ['Sam Founder', 'Dana R. (Ledger)', 'Lee Park']);
});

test('no overlap infers no name: "Speaker N" in order of first speech, and a passage with no speaker is unnamed too', () => {
  const out = assembleBotTranscript([p(0, 1, 6_000, 8_000), p(0, 0, 1_000, 3_000), p(0, null, 9_000, 9_500)], ROSTER, { founderName: 'Sam Founder', endMs: 10_000 });
  assert.deepEqual(speakers(out), ['Speaker 1', 'Speaker 2', 'Speaker 3']);
  assert.equal(out.passages[0].start_ms, 1_000, 'passages come back in time order');
  assert.deepEqual(out.stats, { speakers: 3, named: 0, unnamed: 3, participants: 3 });
});

test("Nova-3's speaker numbers are per chunk: speaker 0 is Dana in chunk 0 and Lee in chunk 1", () => {
  const events = [...ROSTER, says('d', 0), says('l', 120_000), says(null, 240_000)];
  const out = assembleBotTranscript([p(0, 0, 1_000, 100_000), p(1, 0, 121_000, 200_000)], events, { endMs: 240_000 });
  assert.deepEqual(speakers(out), ['Dana Ruiz', 'Lee Park']);
  assert.equal(out.stats.speakers, 2);
});

test('the participant list: names with join and leave times; the bot, its indicator and email addresses never appear', () => {
  const events: BotEvent[] = [
    ...ROSTER,
    join('x', 'guest@example.test', 400),
    join('y', '  ', 450),
    leave('d', 5_000), join('d', 'Dana Ruiz', 7_000), leave('d', 9_000),
    leave('l', 8_000),
    says('bot', 0), says('x', 1_000), says(null, 3_000),
  ];
  const out = assembleBotTranscript([p(0, 0, 100, 900), p(0, 1, 1_100, 2_900)], events, { founderName: 'Sam Founder', endMs: 10_000 });
  assert.deepEqual(out.participants, [
    { name: 'Me', joined_at_ms: 100, left_at_ms: null },
    { name: 'Dana Ruiz', joined_at_ms: 200, left_at_ms: 9_000 },
    { name: 'Lee Park', joined_at_ms: 300, left_at_ms: 8_000 },
    { name: 'Participant 1', joined_at_ms: 400, left_at_ms: null },
    { name: 'Participant 2', joined_at_ms: 450, left_at_ms: null },
  ]);
  assert.deepEqual(speakers(out), ['Speaker 1', 'Participant 1'], "the bot's own indicator names no one; an email reads as Participant N");
  const dump = JSON.stringify(out);
  for (const hidden of ['guest@example.test', 'example.test', 'Eadwyn AI', '"bot"', '"x"']) assert.equal(dump.includes(hidden), false, hidden);
  assert.deepEqual(Object.keys(out.stats).sort(), ['named', 'participants', 'speakers', 'unnamed'], 'stats are counts only');
});

test('a bot joined under its name is a bot even without the flag', () => {
  const out = assembleBotTranscript([], [join('b2', ' eadwyn  ai '), join('d', 'Dana Ruiz', 10)], { endMs: 100 });
  assert.deepEqual(out.participants.map((x) => x.name), ['Dana Ruiz']);
});

test('speakerIntervals and matchSpeaker: spans end at the next mark or the end; untimed passages count for nothing', () => {
  assert.deepEqual(speakerIntervals([says('a', 0), says('a', 0), says('b', 50), says(null, 80)], 100), [{ id: 'a', from: 0, to: 50 }, { id: 'b', from: 50, to: 80 }]);
  assert.deepEqual(speakerIntervals([says('b', 50), says('a', 0)], 70, new Set(['b'])), [{ id: 'a', from: 0, to: 50 }], 'sorted, and a bot span is a gap');
  assert.equal(matchSpeaker([{ start_ms: null, end_ms: null }, { start_ms: 5, end_ms: 5 }], [{ id: 'a', from: 0, to: 10 }]), null);
  assert.equal(matchSpeaker([{ start_ms: 0, end_ms: 10 }], [{ id: 'a', from: 0, to: 6 }, { id: 'b', from: 6, to: 9 }]), 'a');
  assert.equal(matchSpeaker([{ start_ms: 0, end_ms: 10 }], [{ id: 'a', from: 0, to: 5 }, { id: 'b', from: 5, to: 9 }]), null, 'the largest, but under 60 %');
});

test('edges: the is_bot flag alone, the end closing the last span, a passage with no speaker, a malformed passage, events out of order', () => {
  // A bot under another name is still the bot.
  assert.deepEqual(assembleBotTranscript([], [join('r', 'Notes', 0, true), join('d', 'Dana Ruiz', 10)], { endMs: 100 }).participants.map((x) => x.name), ['Dana Ruiz']);
  // The recording's end closes Dana's open span at 4 s: 20 % of a 20 s passage, so no name.
  assert.deepEqual(speakers(assembleBotTranscript([p(0, 0, 0, 20_000)], [...ROSTER, says('d', 0)], { endMs: 4_000 })), ['Speaker 1']);
  // A passage Nova gave no speaker is never named, even inside someone's turn.
  assert.deepEqual(speakers(assembleBotTranscript([p(0, null, 1_000, 9_000)], [...ROSTER, says('d', 0)], { endMs: 10_000 })), ['Speaker 1']);
  // A passage that ends before it starts counts for nothing: 6 s of the 10 s that are real is enough.
  assert.equal(matchSpeaker([{ start_ms: 0, end_ms: 10_000 }, { start_ms: 20_000, end_ms: 5_000 }], [{ id: 'a', from: 0, to: 6_000 }]), 'a');
  // Events may arrive out of order: the rename still lands after the join.
  const late = assembleBotTranscript([], [{ type: 'rename', participant_id: 'd', name: 'Dana (renamed)', at_ms: 50 }, join('d', 'Dana Ruiz', 10)], { endMs: 100 });
  assert.deepEqual(late.participants.map((x) => x.name), ['Dana (renamed)']);
});

test("B2's roster: a second join under a key already in the call is a rename, not a second stay", () => {
  const out = assembleBotTranscript([p(0, 0, 1_000, 9_000)], [...ROSTER, join('d', 'Dana (Ledger)', 5_000), says('d', 0), says(null, 10_000), leave('d', 12_000)], { endMs: 12_000 });
  assert.deepEqual(speakers(out), ['Dana (Ledger)']);
  assert.deepEqual(out.participants.find((x) => x.name === 'Dana (Ledger)'), { name: 'Dana (Ledger)', joined_at_ms: 200, left_at_ms: 12_000 });
  // After a leave, a join is a new stay: first join and last leave are kept.
  const back = assembleBotTranscript([], [join('d', 'Dana Ruiz', 0), leave('d', 10), join('d', 'Dana Ruiz', 20)], { endMs: 30 });
  assert.deepEqual(back.participants, [{ name: 'Dana Ruiz', joined_at_ms: 0, left_at_ms: null }]);
});

test("Zoom's per-participant streams: a passage's participant_key names it directly, across chunks; an unknown key is one Speaker N", () => {
  const z = (chunk: number, key: string, start_ms: number, end_ms: number): BotPassage => ({ chunk, speaker: null, start_ms, end_ms, text: `z${start_ms}`, participant_key: key });
  const out = assembleBotTranscript(
    [z(0, 'd', 0, 5_000), z(0, 'f', 6_000, 8_000), z(1, 'd', 130_000, 131_000), z(1, 'ghost', 132_000, 133_000), z(2, 'ghost', 250_000, 251_000)],
    ROSTER, { founderName: 'Sam Founder', endMs: 300_000 },
  );
  assert.deepEqual(speakers(out), ['Dana Ruiz', 'Me', 'Dana Ruiz', 'Speaker 1', 'Speaker 1']);
  assert.deepEqual(out.stats, { speakers: 3, named: 2, unnamed: 1, participants: 3 });
  // The bot's key never names a passage.
  assert.deepEqual(speakers(assembleBotTranscript([z(0, 'bot', 0, 1_000)], ROSTER, { endMs: 2_000 })), ['Speaker 1']);
});
