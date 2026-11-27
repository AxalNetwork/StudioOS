/**
 * #4018 (#3710 REC3): the session page's participants timeline. Every person
 * and every number is made up.
 *
 *   · bars span joined_ms to left_ms on the call's length; an open bar runs to
 *     now while recording, and to the call's end after;
 *   · the share sums final segments only, and an unmatched label shows none;
 *   · no email is ever drawn;
 *   · each of the three states has its own line;
 *   · the session page draws the timeline and the bot card's list goes there,
 *     and only there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ParticipantsTimeline from '../src/pages/founder/ParticipantsTimeline.jsx';
import { MeetingBotStatus } from '../src/pages/founder/MeetingBotPanel.jsx';
import {
  BOT_NAME, NOT_RECORDED, NO_LENGTH, NO_ONE, READING, UNREADABLE, callLength, clock, nameOf, speakerShares, timelineOf,
} from '../src/pages/founder/participantsTimeline.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const START = Date.UTC(2026, 10, 1, 15, 0, 0);
const ENDED = { status: 'done', started_at: START, ended_at: START + 40 * 60_000 };
const LIVE = { status: 'recording', started_at: START, ended_at: null };
const ROSTER = [
  { display_name: 'Ada Founder', joined_ms: 0, left_ms: 40 * 60_000 },
  { display_name: 'Bo Customer', joined_ms: 10 * 60_000, left_ms: 30 * 60_000 },
  { display_name: 'Cy Late', joined_ms: 20 * 60_000, left_ms: null },
];
const seg = (speaker_label, start_ms, end_ms, source = 'final') => ({ speaker_label, start_ms, end_ms, source });

test('bars span joined_ms to left_ms on the call\'s length; the bot spans all of it', () => {
  const v = timelineOf({ participants: ROSTER, bot: ENDED, now: START + 99 * 60_000 });
  assert.equal(v.state, 'ready');
  assert.equal(v.length, 40 * 60_000);
  assert.deepEqual(v.ticks, ['0:00', '40:00']);
  assert.deepEqual(v.rows.map((r) => [r.name, r.from, r.width, r.open]), [
    [BOT_NAME, 0, 100, false],
    ['Ada Founder', 0, 100, false],
    ['Bo Customer', 25, 50, false],
    ['Cy Late', 50, 50, true], // still in the roster: to the call's end, not to now
  ]);
});

test('while recording, the length and an open bar run to now', () => {
  const at = (min) => timelineOf({ participants: ROSTER, bot: LIVE, now: START + min * 60_000 });
  const v = at(40);
  assert.equal(v.length, 40 * 60_000);
  const cy = v.rows.find((r) => r.name === 'Cy Late');
  assert.deepEqual([cy.from, cy.width, cy.open], [50, 50, true]);
  const later = at(80).rows.find((r) => r.name === 'Cy Late');
  assert.deepEqual([later.from, later.width], [25, 75], 'the open bar grows with the clock');
  assert.equal(at(80).rows[0].open, true, 'the bot is still on the call');
  assert.equal(callLength({ status: 'processing', started_at: START, ended_at: null }, START + 5), null, 'not recording and no end: not known');
  assert.equal(callLength({ status: 'recording', started_at: null }, START), null);
});

test('with no length known, the people are listed without bars, and it says why', () => {
  const v = timelineOf({ participants: ROSTER, bot: { status: 'joining', started_at: null } });
  assert.equal(v.line, NO_LENGTH);
  assert.equal(v.ticks, null);
  assert.ok(v.rows.every((r) => r.from === null && r.width === null));
});

test('the share sums final segments only; an unmatched label shows none; never 0%', () => {
  const segments = [
    seg('Ada Founder', 0, 30_000), seg('ada founder ', 60_000, 90_000), // one speaker, any case
    seg('Bo Customer', 30_000, 60_000),
    seg('Interviewer', 90_000, 120_000), // no one by that name
    seg('Bo Customer', 0, 999_000, 'interim'), // not final: ignored
    seg('Bo Customer', 50, 50), // no duration: ignored
  ];
  const shares = speakerShares(segments);
  assert.deepEqual([...shares], [['ada founder', 50], ['bo customer', 25], ['interviewer', 25]]);
  const v = timelineOf({ participants: ROSTER, bot: ENDED, segments });
  assert.deepEqual(v.rows.map((r) => [r.name, r.share]), [[BOT_NAME, null], ['Ada Founder', 50], ['Bo Customer', 25], ['Cy Late', null]]);
  assert.ok(!v.rows.some((r) => r.name === 'Interviewer'), 'an unmatched label adds no row');
  assert.equal(speakerShares([seg('Ada Founder', 0, 1000, 'interim')]).size, 0, 'nothing final, nothing shown');
  const html = renderToStaticMarkup(h(ParticipantsTimeline, { participants: ROSTER, bot: ENDED, segments, now: START }));
  assert.match(html, /\[50%\]/);
  assert.doesNotMatch(html, /\[0%\]/);
  assert.doesNotMatch(html, /timeline-share-p-2/, 'Cy is not in the transcript: no share drawn');
});

test('no email is ever drawn', () => {
  assert.equal(nameOf('ada@example.test', 0), 'Participant 1');
  assert.equal(nameOf('   ', 4), 'Participant 5');
  const roster = [{ display_name: 'ada@example.test', joined_ms: 0, left_ms: null }, { display_name: 'Bo', joined_ms: 0, left_ms: null }];
  const html = renderToStaticMarkup(h(ParticipantsTimeline, { participants: roster, bot: ENDED, segments: [seg('ada@example.test', 0, 1000)], now: START }));
  assert.doesNotMatch(html, /@/);
  assert.match(html, /Participant 1/);
});

test('each state has its own line', () => {
  const line = (participants) => renderToStaticMarkup(h(ParticipantsTimeline, { participants, bot: ENDED, now: START }));
  assert.match(line(undefined), new RegExp(READING));
  assert.match(line('unreadable'), new RegExp(UNREADABLE));
  assert.match(line(null), new RegExp(NOT_RECORDED));
  assert.match(line([]), new RegExp(NO_ONE));
  assert.match(line([]), new RegExp(BOT_NAME), 'the bot still has its bar');
  assert.equal(timelineOf({ participants: { nope: 1 } }).state, 'unreadable', 'a malformed read is unreadable, never an empty roster');
  for (const s of [undefined, 'unreadable', null]) assert.doesNotMatch(line(s), /timeline-bar-/);
});

test('times read as clocks', () => {
  assert.deepEqual([clock(0), clock(65_000), clock(3_725_000), clock(-1), clock(1.5)], ['0:00', '1:05', '1:02:05', null, null]);
});

test('the session page draws the timeline under the stepper, and the bot card\'s list goes only there', () => {
  const page = read('pages/founder/InterviewSessionPage.jsx');
  const stepper = page.indexOf('<SessionStepper view={life} />');
  const timeline = page.indexOf('<ParticipantsTimeline participants={botParticipants}');
  assert.ok(stepper > 0 && timeline > stepper, 'under the stepper');
  assert.match(page, /onParticipants=\{setBotParticipants\} hideFailure hideParticipants \/>/);
  const snapshot = { read: { bot: { status: 'done', started_at: START, ended_at: START + 1000 } }, unreadable: false };
  const card = (extra) => renderToStaticMarkup(h(MeetingBotStatus, { snapshot, participants: ROSTER, ...extra }));
  assert.match(card({}), /data-testid="bot-participants"/, 'elsewhere (Interview channels) the card keeps its list');
  assert.doesNotMatch(card({ hideParticipants: true }), /bot-participants|Ada Founder/);
  assert.doesNotMatch(read('pages/founder/InterviewChannels.jsx'), /hideParticipants/);
});

test('dark pairs on the timeline\'s colours', () => {
  const src = read('pages/founder/ParticipantsTimeline.jsx');
  for (const light of ['bg-white', 'border-axal-hairline', 'bg-axal-ground', 'bg-violet-700', 'bg-violet-300', 'text-axal-muted', 'text-axal-faint']) {
    const lines = src.split('\n').filter((l) => l.includes(light));
    assert.ok(lines.length, light);
    for (const l of lines) assert.match(l, /dark:/, `${light} has a dark pair`);
  }
});
