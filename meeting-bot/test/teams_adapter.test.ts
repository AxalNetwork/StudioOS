/**
 * D886 B5 (#2583): the Microsoft Teams adapter, driven through B2's own
 * lifecycle (`runBot`) on the screens in `fixtures/teamsScreens.ts`.
 *
 *   1. Which links it joins: work or school and Teams free, https only.
 *   2. A whole call: launcher → pre-join (name, mic and camera off) → lobby →
 *      admitted → the notice in the chat → roster, caption speakers, audio →
 *      the call ends → hang up.
 *   3. Every refusal screen as D886's code; a captcha is never touched.
 *   4. The roster leaves the bot out and reports leaves; a speaker is a roster
 *      id, never a guess; a caption's words are never asked for.
 *   5. Leave is safe twice; nothing about the call reaches a log line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBot } from '../src/lifecycle.ts';
import { TeamsAdapter, JOIN_TIMEOUT_MS } from '../src/adapters/teams.ts';
import { TEAMS, teamsJoinUrl } from '../src/adapters/teamsSelectors.ts';
import { BOT_NAME, FREE_LIMIT_MS, SAMPLE_RATE } from '../src/constants.ts';
import type { RunConfig } from '../src/types.ts';
import { FakeClock, StubCallback, settle } from './_harness.ts';
import { FakeTeamsPage } from './_teamsPage.ts';
import { caption, row } from './fixtures/teamsScreens.ts';
import type { ScreenName } from './fixtures/teamsScreens.ts';

const NOTICE = 'Eadwyn AI is recording this call for the host. [notice v1]';
// Invented links: the meeting id and passcode are fixtures, not a real meeting.
const WORK = 'https://teams.microsoft.com/meet/1234567890123?p=FixturePass1';
const FREE = 'https://teams.live.com/meet/9876543210987?p=FixturePass2';

function start(over: { url?: string; first?: ScreenName; afterJoin?: ScreenName } = {}) {
  const clock = new FakeClock();
  const cb = new StubCallback();
  const page = new FakeTeamsPage(over.first ?? 'launcher');
  if (over.afterJoin) page.afterJoin = over.afterJoin;
  const adapter = new TeamsAdapter(page, { clock });
  const stop = new AbortController();
  const lines: string[] = [];
  const cfg: RunConfig = { runId: 'run_t', platform: 'teams', meetingUrl: over.url ?? WORK, notice: NOTICE, limitMs: FREE_LIMIT_MS, deadlineAt:clock.now()+FREE_LIMIT_MS,budgetDeadlineAt:clock.now()+120_000 };
  const run = runBot(cfg, { adapter, transport: cb, clock, stop: stop.signal, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
  return { clock, cb, page, adapter, stop, run, lines };
}

const second = (n = 1) => new Float32Array(48000 * n).fill(0.1);

test('1. links: work or school and Teams free, https only, joined in the browser; anything else is not opened', () => {
  // Mutation checked: dropping the https check, an endsWith host match or the path rule → the refused list fails; no launchAgent → the join_only check fails.
  const work = teamsJoinUrl(WORK)!;
  assert.equal(work.kind, 'work');
  assert.equal(new URL(work.url).searchParams.get('launchAgent'), 'join_only');
  assert.equal(new URL(work.url).searchParams.get('p'), 'FixturePass1', 'the passcode is kept as given');
  assert.equal(teamsJoinUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_Fixture%40thread.v2/0?context=%7b%7d')!.kind, 'work');
  assert.equal(teamsJoinUrl(FREE)!.kind, 'free');
  for (const bad of [
    'http://teams.microsoft.com/meet/1234567890123',
    'https://teams.microsoft.com.example.com/meet/1',
    'https://notteams.microsoft.com/meet/1',
    'https://example.com/meet/1',
    'https://teams.microsoft.com/',
    'https://teams.microsoft.com/v2/',
    'https://teams.live.com/l/meetup-join/1',
    'https://user:pw@teams.microsoft.com/meet/1',
    'https://teams.microsoft.com:8443/meet/1',
    'not a link',
  ]) assert.equal(teamsJoinUrl(bad), null, bad);
});

test('2. a whole call: launcher, pre-join with mic and camera off, lobby, notice, roster, caption speakers, audio, then the call ends', async () => {
  // Mutation checked: the mic left on → the toggle assertion fails; the notice not typed → the chat assertion fails; the bot's own row not skipped → the self check fails; the roster read off the call's screen → a false leave appears.
  const { clock, cb, page, run, lines } = start();
  await clock.advance(3000);
  assert.deepEqual(page.gotos.map((u) => new URL(u).searchParams.get('launchAgent')), ['join_only']);
  assert.ok(page.clicks.includes(TEAMS.continueInBrowser.selector), 'continued in the browser');
  assert.deepEqual(page.fills, [[TEAMS.nameInput.selector, BOT_NAME]]);
  assert.ok(page.clicks.includes(TEAMS.micToggle.selector) && page.clicks.includes(TEAMS.cameraToggle.selector), 'the microphone and the camera are turned off');
  assert.deepEqual(cb.statuses.map((s) => s.state), ['joining', 'waiting_room']);
  assert.ok(!page.fills.some(([s]) => s === TEAMS.chatCompose.selector), 'nothing is posted from the lobby');
  assert.equal(page.listeners, 0, 'nothing is heard from the lobby');

  page.people([row('self', BOT_NAME, true), row('p1', 'Sam Founder'), row('p2', 'Dana Ruiz')]);
  page.show('in_call');
  await clock.advance(2000);
  assert.deepEqual(page.fills.filter(([s]) => s === TEAMS.chatCompose.selector), [[TEAMS.chatCompose.selector, NOTICE]]);
  const sent = page.clicks.indexOf(TEAMS.chatSend.selector);
  assert.ok(sent >= 0 && sent < page.clicks.indexOf(TEAMS.rosterButton.selector), 'the notice is sent before the roster is opened');
  assert.equal(cb.statuses.at(-1)!.state, 'recording');

  page.captions([caption('Sam Founder')]);
  await clock.advance(1000);
  page.captions([caption('Sam Founder'), caption('Dana Ruiz')]);
  page.say(second(31));
  await clock.advance(6000);
  assert.deepEqual([...cb.chunks.keys()], [0], 'a whole ~30 s chunk goes out from 48 kHz browser audio');

  page.people([row('self', BOT_NAME, true), row('p1', 'Sam Founder')]);
  await clock.advance(1000);
  page.show('ended');
  const r = await clock.until(run);
  assert.deepEqual([r.state, r.reason, r.participants], ['left', 'call_ended', 2]);
  assert.equal(cb.chunks.get(1)!.byteLength, 44 + SAMPLE_RATE * 2, 'the last second is sent at the end');

  const events = cb.allEvents.map((e) => (e.type === 'roster' ? `roster:${e.participants.map(p=>p.id+':'+(p.left_ms===null?'in':'out')).join(',')}` : `speaker:${e.participant_id}`));
  assert.deepEqual(events, ['roster:p1:in', 'roster:p1:in,p2:in', 'speaker:p1', 'speaker:p2', 'roster:p1:in,p2:out', 'speaker:null']);
  assert.ok(!cb.allEvents.some((e) => e.type === 'roster' && e.participants.some(p=>p.id==='self')), 'the bot never reports itself');
  assert.equal(page.closed, 1, 'the page is closed on leaving');

  for (const words of ['Sam Founder', 'Dana Ruiz', '1234567890123', 'FixturePass1', 'teams.microsoft.com']) {
    assert.ok(!lines.some((l) => l.includes(words)), `no log line names "${words}"`);
  }
});

test('2. a Teams free link, let straight in: no lobby wait, and the run records', async () => {
  const { clock, cb, page, run, stop } = start({ url: FREE, first: 'prejoin', afterJoin: 'in_call' });
  page.people([row('p1', 'Sam Founder')]);
  await clock.advance(3000);
  assert.equal(cb.statuses.at(-1)!.state, 'recording');
  stop.abort();
  const r = await clock.until(run);
  assert.deepEqual([r.state, r.reason], ['left', 'stopped']);
  assert.ok(page.clicks.includes(TEAMS.hangup.selector));
});

for (const [screen, code, when] of [
  ['captcha', 'platform_blocked', 'join'],
  ['anonymous_blocked', 'platform_blocked', 'join'],
  ['bot_blocked', 'platform_blocked', 'lobby'],
  ['not_found', 'link_invalid', 'join'],
  ['ended', 'meeting_ended', 'lobby'],
  ['denied', 'not_admitted', 'lobby'],
] as const) {
  test(`3. ${screen} ${when === 'join' ? 'on opening the link' : 'while waiting'} is ${code}, and nothing is posted or heard`, async () => {
    // Mutation checked: SCREEN_CODE's entry for each screen changed → its case fails.
    const { clock, cb, page, run } = start({ first: when === 'join' ? screen : 'prejoin' });
    await clock.advance(2000);
    if (when === 'lobby') page.show(screen);
    const r = await clock.until(run);
    assert.deepEqual([r.state, r.code], ['failed', code]);
    assert.equal(cb.statuses.filter((s) => s.state === 'recording').length, 0);
    assert.ok(!page.fills.some(([s]) => s === TEAMS.chatCompose.selector));
    assert.equal(page.listeners, 0);
    if (screen === 'captcha') assert.deepEqual(page.clicks, [], 'a captcha is never touched');
  });
}

test('3. a link that is not Teams fails as link_invalid without being opened; a screen it does not know is platform_blocked after the join timeout', async () => {
  // Mutation checked: no join deadline → the unknown screen never fails.
  const a = start({ url: 'https://example.com/meet/1' });
  const ra = await a.clock.until(a.run);
  assert.deepEqual([ra.state, ra.code, a.page.gotos.length], ['failed', 'link_invalid', 0]);

  const b = start({ first: 'blank' });
  let settled = false;
  void b.run.then(() => { settled = true; });
  await b.clock.advance(JOIN_TIMEOUT_MS - 2000);
  assert.equal(b.cb.statuses.at(-1)!.state, 'joining');
  await b.clock.advance(5000);
  assert.ok(settled, 'the join gives up at its deadline');
  const rb = await b.run;
  assert.deepEqual([rb.state, rb.code], ['failed', 'platform_blocked']);
});

test('4. a speaker is one roster id or nothing: an unknown or shared name is not attributed, and caption words are never asked for', async () => {
  // Mutation checked: keyFor taking the first match → the shared name is attributed; asking the caption row for more than its author → the asked-for check fails.
  const { clock, cb, page, run, stop } = start({ first: 'prejoin', afterJoin: 'in_call' });
  page.people([row('p1', 'Sam'), row('p2', 'Sam'), row('p3', 'Lee Park')]);
  await clock.advance(3000);
  page.captions([caption('Sam')]);
  await clock.advance(1000);
  page.captions([caption('Sam'), caption('Someone Else')]);
  await clock.advance(1000);
  page.captions([caption('Sam'), caption('Someone Else'), caption('Lee Park')]);
  await clock.advance(1000);
  stop.abort();
  await clock.until(run);
  await settle();
  assert.deepEqual(cb.allEvents.filter((e) => e.type === 'speaker').map((e) => e.participant_id), ['p3', null]);
  assert.deepEqual([...page.asked.get(TEAMS.captionRow.selector)!], ['data-speaker-name'], 'only the author is read from a caption');
  for (const [sel, attrs] of page.asked) assert.ok(!attrs.has('textContent') && !attrs.has('innerText'), sel);
});

test('5. leave is safe twice and after the call ended; the bot does not click what is gone', async () => {
  // Mutation checked: no `left` guard → the page is closed twice.
  const page = new FakeTeamsPage('ended');
  const adapter = new TeamsAdapter(page, { clock: new FakeClock() });
  await adapter.leave();
  await adapter.leave();
  assert.equal(page.closed, 1);
  assert.deepEqual(page.clicks, []);
});
