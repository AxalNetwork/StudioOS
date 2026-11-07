// D3726 (#3726) — Learning on Stream: the member screens this integration
// draws (LR1's progress, New this week and Recommended; LR4's resume, position
// writes, chapters and plain transcript; LR13's member program page), and that
// every board it cannot fill names the task that will.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_stream_d3726.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  LEARNING_STREAM_TASKS, NO_CHAPTERS, PLAIN_TRANSCRIPT_LINE, nextView,
  clockLabel, newThisWeek, positionWriter, resumeAt, statsTiles,
} from '../src/pages/learning/learningModel.js';
import { continueTarget, enrolmentCopy, memberProgramHref } from '../src/pages/learning/programModel.js';
import { readMyStats } from '../src/pages/learning/learningReads.js';
import { learningApi } from '../src/lib/api/learning.js';
import { NewThisWeek, ProgressStrip } from '../src/pages/learning/LearningHome.jsx';
import { NextForYouCard } from '../src/pages/learning/NextForYou.jsx';
import LessonPlayer from '../src/pages/learning/LessonPlayer.jsx';
import { MemberProgramView } from '../src/pages/learning/MemberProgram.jsx';
import { readMemberProgram } from '../src/pages/learning/programReads.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/learning'] }, el));
const flat = (m) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const NOW = Date.parse('2026-11-02T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const settle = () => new Promise((r) => setTimeout(r, 0));

test('every board this build cannot fill names its task', () => {
  assert.deepEqual(LEARNING_STREAM_TASKS, { stream: 4176, studio: 4177, player: 4178, copy: 4179, lists: 4180, analytics: 4181 });
});

test('LR1 Your progress: the four figures of #4180; one not recorded reads "Not recorded", never a 0; a failed read is never zeros', () => {
  const tiles = statsTiles({ courses_in_progress: 2, lessons_completed_this_month: null, watch_seconds_this_month: 3600, exams: { passed: 1, sat: 2 } });
  assert.deepEqual(tiles.map((t) => t.label), ['Courses in progress', 'Lessons completed this month', 'Watch time this month', 'Exams passed']);
  const m = html(h(ProgressStrip, { state: { status: 'ready', tiles } }));
  assert.equal((m.match(/data-testid="progress-figure"/g) || []).length, 4);
  assert.equal((flat(m).match(/Not recorded/g) || []).length, 1, 'only the figure the route did not record');
  assert.match(flat(m), /1 of 2/);
  const none = html(h(ProgressStrip, { state: { status: 'ready', tiles: statsTiles(null) } }));
  assert.equal((flat(none).match(/Not recorded/g) || []).length, 4);
  assert.doesNotMatch(flat(none), /\b0\b/);
  const failed = html(h(ProgressStrip, { state: { status: 'error' } }));
  assert.match(flat(failed), /not a claim that they are zero/);
  assert.doesNotMatch(failed, /data-testid="progress-figure"/);
});

test('LR1 New this week: courses, videos and readings of the last seven days, newest first, at most four', () => {
  const at = (days) => new Date(NOW - days * DAY).toISOString();
  const rows = [
    { key: 'a', kind: 'course', title: 'A', date: at(1) },
    { key: 'b', kind: 'video', title: 'B', date: at(0.5) },
    { key: 'c', kind: 'webinar', title: 'C', date: at(1) },
    { key: 'd', kind: 'reading', title: 'D', date: at(8) },
    { key: 'e', kind: 'reading', title: 'E', date: null },
    { key: 'f', kind: 'reading', title: 'F', date: at(3) },
    { key: 'g', kind: 'video', title: 'G', date: at(2) },
    { key: 'h', kind: 'course', title: 'H', date: at(6) },
  ];
  assert.deepEqual(newThisWeek(rows, NOW).map((r) => r.key), ['b', 'a', 'g', 'f']);
  assert.deepEqual(newThisWeek([], NOW), []);
  const ready = html(h(NewThisWeek, { state: { status: 'ready', rows }, now: NOW }));
  assert.match(ready, /data-testid="list-new-this-week"/);
  const empty = flat(html(h(NewThisWeek, { state: { status: 'ready', rows: [] }, now: NOW })));
  assert.match(empty, /Nothing new this week/);
  const failed = flat(html(h(NewThisWeek, { state: { status: 'unreadable' }, now: NOW, onRetry: () => {} })));
  assert.match(failed, /not a claim that nothing is new/, 'a failed read is never an empty week');
});

test('LR1 Recommended for you (#4650): the next action with its reason, the server\'s empty state, or a failed read; never an issue number', () => {
  // Mutation checked: the reason dropped from the card -> the "2 of 5" line is missing; the unreadable branch drawn as empty -> the claim is missing.
  const next = { status: 'ready', next: { rule: 'continue_course', kind: 'lesson', uid: 'l1', title: 'Raising: Term sheets', href: '/learning/courses/raising/l1', reason: '2 of 5 required lessons complete.', plan: { kind: 'lesson', uid: 'l1', title: 'Term sheets' } }, checked: ['continue_course'], empty: null };
  const a = flat(html(h(NextForYouCard, { state: next, onRetry: () => {} })));
  assert.match(a, /Recommended for you Continue Raising: Term sheets 2 of 5 required lessons complete\./);
  assert.match(a, /Add to my plan/);
  assert.deepEqual(nextView(next).plan, { kind: 'lesson', uid: 'l1', title: 'Term sheets' });
  const empty = flat(html(h(NextForYouCard, { state: { status: 'ready', next: null, checked: ['continue_course', 'program', 'plan'], empty: 'Nothing is waiting: browse courses.' }, onRetry: () => {} })));
  assert.match(empty, /Nothing is waiting: browse courses\./);
  const failed = flat(html(h(NextForYouCard, { state: { status: 'unreadable' }, onRetry: () => {} })));
  assert.match(failed, /not a claim that nothing is waiting/);
  for (const m of [a, empty, failed]) assert.doesNotMatch(m, /#\d{3,}|Future|Waits on/, 'no internal issue or dependency is product copy');
});

test('LR4 resume: a position worth resuming, as a clock', () => {
  assert.equal(clockLabel(725), '12:05');
  assert.equal(clockLabel(3725), '1:02:05');
  assert.equal(clockLabel(null), null);
  assert.equal(clockLabel(0), '00:00', '#4180\'s clock, padded');
  assert.equal(clockLabel(-1), null);
  assert.equal(resumeAt(null), null);
  assert.equal(resumeAt(3), null, 'the first seconds are not worth a resume');
  assert.equal(resumeAt(725, 1800), 725);
  assert.equal(resumeAt(1797, 1800), null, 'at the end there is nothing to resume');
  assert.equal(resumeAt(725.9), 725);
});

test('LR4 position writes: at most one every 15 s while playing, one on pause, never doubled', async () => {
  let t = 0;
  const writes = [];
  const w = positionWriter((s, p) => { writes.push([s, p]); }, { now: () => t });
  assert.equal(w.tick(10, 100), true);
  await settle();
  t = 5_000; assert.equal(w.tick(15, 100), false, 'inside the window');
  t = 15_000; assert.equal(w.tick(25, 100), true);
  await settle();
  t = 16_000; assert.equal(w.flush(26.7, 100), true, 'a pause always writes');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(writes, [[10, 10], [25, 25], [26, 26]]);
  const slow = [];
  let release;
  const w2 = positionWriter(() => new Promise((r) => { slow.push(1); release = r; }), { now: () => 0 });
  assert.equal(w2.flush(5, null), true);
  await Promise.resolve();
  assert.equal(w2.flush(6, null), false, 'a write in flight is never doubled');
  release();
});

test('LR4 the player: resume pill, no chapters, the plain transcript line', () => {
  const item = { uid: 'i1', kind: 'video', title: 'The script', duration_seconds: 1800 };
  const m = html(h(LessonPlayer, { status: 'ready', lesson: null, item, video: { src: '/media/i1', embed: false }, transcript: 'Hello.', resumeFrom: 725, onPosition: () => {} }));
  assert.match(flat(m), /Resume from 12:05/);
  assert.match(m, /data-testid="lesson-chapters-none"/);
  // #4178 (D4178): chapters arrived with #4176, so none recorded is simply "No chapters".
  assert.ok(flat(m).includes(NO_CHAPTERS), 'no chapters says so');
  assert.ok(flat(m).includes(PLAIN_TRANSCRIPT_LINE), 'the plain transcript line');
  const none = html(h(LessonPlayer, { status: 'ready', lesson: null, item, video: { src: '/media/i1', embed: false } }));
  assert.doesNotMatch(none, /lesson-resume/, 'no position, no resume');
  const chapters = html(h(LessonPlayer, { status: 'ready', lesson: null, item: { ...item, chapters: [{ start_seconds: 0, title: 'Intro' }, { start_seconds: 725, title: 'The script' }] }, video: { src: '/media/i1', embed: false } }));
  assert.match(flat(chapters), /00:00 Intro 12:05 The script/);
});

test('LR4 the wired pages pass the stored position and write it back through the progress route', () => {
  const wired = read('pages/learning/LearningWired.jsx');
  assert.equal((wired.match(/resumeFrom=\{/g) || []).length, 2, 'a lesson and a standalone item');
  assert.equal((wired.match(/recordItemPosition\(item\.uid, s, p\)/g) || []).length, 2);
  const reads = read('pages/learning/learningReads.js');
  assert.match(reads, /subject_kind: 'item',\s+subject_uid: uid,\s+status: 'started',\s+position_seconds: seconds,/);
});

test('LR13 the member program page: route, enrolment words, Continue', () => {
  assert.match(read('routes/learning.jsx'), /path="\/learning\/my-programs\/:program" element=\{guard\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\], <LearningPage view="myProgram"/);
  assert.equal(memberProgramHref('p 1'), '/learning/my-programs/p%201');
  assert.match(read('pages/learning/MyPrograms.jsx'), /to=\{memberProgramHref\(program\.uid\)\}/);
  assert.deepEqual(enrolmentCopy({ enrolment: 'invite' }, { enrolled: true }).title, 'By invitation');
  assert.equal(enrolmentCopy({ enrolment: 'invite' }, { enrolled: true }).line, 'A Super Admin enrolled you. The date is not recorded.');
  assert.equal(enrolmentCopy({ enrolment: 'open' }, { enrolled: false }).line, 'Anyone with a profile can join.');
  const contents = [
    { subject_kind: 'course', subject_uid: 'c1', status: 'published', href: '/learning/courses/c1' },
    { subject_kind: 'item', subject_uid: 'v1', status: 'draft', href: '/learning/videos/v1' },
    { subject_kind: 'item', subject_uid: 'v2', status: 'published', href: '/learning/videos/v2' },
  ];
  const completion = [{ subject_kind: 'course', subject_uid: 'c1', status: 'completed' }];
  assert.equal(continueTarget(contents, completion).subject_uid, 'v2', 'skips the done and the unpublished');
  assert.equal(continueTarget(contents, null), null);
});

test('LR13 enrolled: progress per item and overall; LR13b open: Join to start and Join', () => {
  const program = { uid: 'p1', name: 'Spin-Out Lab · Lisbon', region: 'Lisbon', description: 'Five items.', enrolment: 'invite' };
  const contents = [
    { subject_kind: 'course', subject_uid: 'c1', title: 'Customer discovery 101', status: 'published', href: '/learning/courses/c1', position: 1 },
    { subject_kind: 'item', subject_uid: 'v1', title: 'Interviewing without leading', status: 'published', href: '/learning/videos/v1', position: 2 },
  ];
  const completion = [
    { subject_kind: 'course', subject_uid: 'c1', status: 'in_progress', percent: 37 },
    { subject_kind: 'item', subject_uid: 'v1', status: 'completed' },
  ];
  const mine = html(h(MemberProgramView, { state: { status: 'ready', program, contents, enrolled: true, completion } }));
  assert.match(mine, /data-testid="member-program-continue"/);
  assert.match(flat(mine), /1 of 2 complete/);
  assert.match(flat(mine), /By invitation A Super Admin enrolled you\. The date is not recorded\. No cohort dates, mentors or application: none is stored\./);
  assert.doesNotMatch(mine, /member-program-join/);
  const open = html(h(MemberProgramView, { state: { status: 'ready', program: { ...program, enrolment: 'open' }, contents, enrolled: false, completion: null }, onJoin: () => {} }));
  assert.equal((flat(open).match(/Join to start/g) || []).length, 2);
  assert.match(open, /data-testid="member-program-join"/);
  assert.match(flat(open), /You are not in this program yet\./);
  assert.doesNotMatch(open, /member-program-continue/);
  assert.match(flat(html(h(MemberProgramView, { state: { status: 'missing' } }))), /No such program/);
  assert.match(flat(html(h(MemberProgramView, { state: { status: 'unreadable' }, onRetry: () => {} }))), /not a claim that it holds nothing/);
});

test('#4480: enrolment copy names recorded dates, keeps unknown dates honest, and ignores dates before joining', () => {
  const date = '2026-10-01T12:00:00.000Z';
  const options = { enrolled: true, enrolled_at: date, timeZone: 'UTC' };
  const invite = enrolmentCopy({ enrolment: 'invite' }, options);
  assert.equal(invite.line, 'A Super Admin enrolled you on 1 Oct 2026.');
  assert.equal(invite.dateTime, date);
  assert.equal(invite.date, '1 Oct 2026');
  assert.equal(enrolmentCopy({ enrolment: 'invite' }, { ...options, enrolled_at: null }).line, 'A Super Admin enrolled you. The date is not recorded.');
  assert.equal(enrolmentCopy({ enrolment: 'open' }, options).line, 'You joined on 1 Oct 2026.');
  const notJoined = enrolmentCopy({ enrolment: 'open' }, { ...options, enrolled: false });
  assert.equal(notJoined.line, 'Anyone with a profile can join.');
  assert.equal(notJoined.date, null);
  for (const unknown of [null, '', 'not-a-date', 0]) {
    const copy = enrolmentCopy({ enrolment: 'open' }, { ...options, enrolled_at: unknown });
    assert.equal(copy.date, null);
    assert.equal(copy.line, 'You joined this program. The date is not recorded.');
  }
});

test('#4480: the enrolment date is en-GB in the member’s zone, including the default viewer zone', () => {
  const state = { enrolled: true, enrolled_at: '2026-10-01T23:30:00.000Z' };
  assert.equal(enrolmentCopy({ enrolment: 'open' }, { ...state, timeZone: 'UTC' }).date, '1 Oct 2026');
  assert.equal(enrolmentCopy({ enrolment: 'open' }, { ...state, timeZone: 'Europe/Helsinki' }).date, '2 Oct 2026');
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Helsinki';
    assert.equal(enrolmentCopy({ enrolment: 'open' }, state).date, '2 Oct 2026');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('#4480: member program read carries the own date into a semantic mono date, never a non-member’s date', async () => {
  const before = learningApi.program;
  const date = '2026-10-01T12:00:00.000Z';
  const program = { uid: 'p1', name: 'Date fixtures', enrolment: 'invite' };
  try {
    learningApi.program = async () => ({ program, contents: [], enrolled: true, enrolled_at: date, my_completion: [] });
    const state = await readMemberProgram('p1');
    assert.equal(state.enrolled_at, date);
    const view = html(h(MemberProgramView, { state: { status: 'ready', ...state } }));
    assert.match(view, /<time dateTime="2026-10-01T12:00:00.000Z" class="font-mono tabular-nums">/i);
    assert.match(flat(view), /A Super Admin enrolled you on/);
    learningApi.program = async () => ({ program: { ...program, enrolment: 'open' }, contents: [], enrolled: false, enrolled_at: date });
    const outsider = await readMemberProgram('p1');
    assert.equal(Object.hasOwn(outsider, 'enrolled_at'), false);
    const open = html(h(MemberProgramView, { state: { status: 'ready', ...outsider } }));
    assert.match(flat(open), /Anyone with a profile can join/);
    assert.doesNotMatch(open, /<time/);
  } finally { learningApi.program = before; }
});

test('LR1 readMyStats reads #4180\'s stats route once and turns it into the four tiles', async () => {
  const real = learningApi.myStats;
  let calls = 0;
  learningApi.myStats = async () => { calls += 1; return { courses_in_progress: 3, lessons_completed_this_month: 0, watch_seconds_this_month: null, exams: null }; };
  try {
    const { tiles } = await readMyStats();
    assert.equal(calls, 1);
    assert.deepEqual(tiles.map((t) => t.value), ['3', '0', 'Not recorded', 'Not recorded'], 'a recorded 0 is 0; an unrecorded figure is never 0');
  } finally { learningApi.myStats = real; }
});
