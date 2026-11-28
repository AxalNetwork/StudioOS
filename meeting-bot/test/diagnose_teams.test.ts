/**
 * D5814 (#5814): the owner's diagnostic on a Teams link, against the recorded-screen fixture
 * (`fixtures/teamsScreens.ts` through `FakeTeamsPage`) and, where Chromium is installed, the
 * packaged factory on the constructed Teams page (`fixtures/teams.html`). Synthetic only: no
 * Teams tenant, meeting or deployed container is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { runDiagnosis, teamsJoinStop, stagesFor, EGRESS_HOSTS, TEAMS_DIAGNOSE_STAGES, DIAGNOSE_STAGES, type DiagnoseDeps, type DiagnoseEvent, type DiagnoseReport } from '../src/diagnose.ts';
import { TeamsAdapter } from '../src/adapters/teams.ts';
import { runtimeDiagnose } from '../src/runtimeAdapters.ts';
import { AdapterFailure } from '../src/types.ts';
import { BOT_NAME, NOTICE_TRIES } from '../src/constants.ts';
import { meetingBotNotice } from '../notice.mjs';
import { FakeClock } from './_harness.ts';
import { FakeTeamsPage } from './_teamsPage.ts';
import type { ScreenName } from './fixtures/teamsScreens.ts';
import { NO_BROWSER, teamsBrowser } from './_teams_browser.ts';

const ID = '00000000-0000-4000-8000-000000005814';
const WORK = 'https://teams.microsoft.com/meet/synthetic-5814?p=Synthetic1';
const PERSONAL = 'https://teams.live.com/meet/synthetic5814';
const NOTICE = 'Synthetic recording notice for the diagnostic. [5814]';
/** A tenth of a second of a remote participant at 48 kHz: 1600 samples once resampled to 16 kHz. */
const BLOCK = () => new Float32Array(4800).fill(0.25);

interface Script {
  readonly first?: ScreenName;
  readonly afterJoin?: ScreenName;
  /** Teams' own moves, on the fixture clock: [ms after start, what happens]. */
  readonly moves?: ReadonlyArray<readonly [number, (page: FakeTeamsPage) => void]>;
  /** A participant speaking from this time on, every 100 ms (heard only by a subscribed listener). */
  readonly speakFrom?: number;
  readonly url?: string;
  readonly fetch?: typeof fetch;
  readonly launch?: DiagnoseDeps['launch'];
  readonly chatFails?: boolean;
}

async function teamsRun(s: Script = {}) {
  const clock = new FakeClock(), page = new FakeTeamsPage(s.first ?? 'launcher');
  page.afterJoin = s.afterJoin ?? 'lobby';
  if (s.chatFails) page.fill = async (selector: string, text: string) => {
    if (selector.includes('chat-compose')) throw new Error('chat closed for guests');
    page.fills.push([selector, text]);
  };
  const adapter = new TeamsAdapter(page, { clock, pollMs: 100, joinTimeoutMs: 5000 });
  const events: DiagnoseEvent[] = [], seen = new Set<string>(), shots: Uint8Array[] = [], probes: Uint8Array[] = [], hosts: string[] = [];
  let heard = 0, said = 0, closed = 0;
  const say = page.say.bind(page);
  page.say = (samples, rate) => { said += 1; heard += page.listeners; say(samples, rate); };
  for (const [at, move] of s.moves ?? []) clock.setTimeout(() => move(page), at);
  if (s.speakFrom !== undefined) {
    const tick = () => { page.say(BLOCK(), 48000); clock.setTimeout(tick, 100); };
    clock.setTimeout(tick, s.speakFrom);
  }
  const deps: DiagnoseDeps = {
    clock, diagnosisId: ID, admitMs: 10_000, audioMs: 3000, notice: () => NOTICE,
    report: async (snap) => { for (const e of [...snap.events].sort((a, b) => a.rev - b.rev)) if (!seen.has(`${e.stage}:${e.rev}`)) { seen.add(`${e.stage}:${e.rev}`); events.push(e); } },
    screenshot: async (png) => { shots.push(png); },
    probe: async (wav) => { probes.push(wav); },
    fetch: s.fetch ?? (async (url) => { hosts.push(new URL(String(url)).hostname); return new Response(null, { status: 302 }); }),
    launch: s.launch ?? (async () => ({ page: { screenshot: async () => new Uint8Array([137, 80, 78, 71]), url: () => 'https://teams.microsoft.com/' }, meet: adapter, close: async () => { closed += 1; } })),
  };
  const outcome = await clock.until(runDiagnosis('teams', s.url ?? WORK, deps), 100, 100_000);
  return { page, events, shots, probes, hosts, outcome, heard: () => heard, said: () => said, closed: () => closed };
}
const table = (events: readonly DiagnoseReport[]) => events.filter((e) => e.result !== 'running').map((e) => `${e.stage}:${e.result}:${e.code}`);
const final = (events: readonly DiagnoseEvent[], stage: string) => events.filter((e) => e.stage === stage && e.result !== 'running').at(-1)!;
/** The first failing stage and its code: what the console's `stops_at` and its row answer. */
const stop = (events: readonly DiagnoseReport[]) => table(events).find((r) => r.split(':')[1] === 'fail') ?? 'none';

const ADMIT = (page: FakeTeamsPage) => page.show('in_call');

test('a successful canary: three Teams hosts, the guest join, admission, the notice, then frames and a silent probe', async () => {
  const r = await teamsRun({ moves: [[1500, ADMIT]], speakFrom: 300 });
  assert.deepEqual(table(r.events), ['container:pass:command_received', 'browser:pass:launched', 'egress:pass:hosts_reached',
    'join:pass:asked_to_join', 'admission:pass:admitted', 'notice:pass:notice_posted', 'audio:pass:chunk_uploaded']);
  assert.deepEqual(r.hosts, ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com']);
  assert.deepEqual(final(r.events, 'egress').facts, { 'teams.microsoft.com': 302, 'teams.cloud.microsoft': 302, 'teams.live.com': 302 });
  assert.deepEqual(final(r.events, 'join').facts, { link_kind: 'work' });
  assert.deepEqual(final(r.events, 'notice').facts, { attempts: 1 });
  // The guest is Eadwyn AI, and the notice is the one chat message it sends.
  assert.deepEqual(r.page.fills, [['input[data-tid="prejoin-display-name-input"]', BOT_NAME], ['[data-tid="chat-compose-input"]', NOTICE]]);
  // The page was asked to capture only once in the call, and the lobby's speech was never heard: frames start after the notice.
  assert.deepEqual(r.page.started, ['in_call']);
  const audio = final(r.events, 'audio');
  assert.ok(Number(audio.facts?.frames) > 0 && Number(audio.facts?.frames) <= r.heard(), JSON.stringify(audio.facts));
  assert.ok(audio.at > final(r.events, 'notice').at);
  // Zeros the frames' length, never their values; a screenshot of where it ended; leave and close once.
  assert.equal(r.probes.length, 1);
  assert.ok(r.probes[0].subarray(44).every((b) => b === 0));
  assert.equal(r.shots.length, 1);
  assert.equal(r.closed(), 1);
  assert.deepEqual(r.outcome.undelivered, []);
});

test('lobby speech is never counted: before the notice nothing listens to the page', async () => {
  // A participant talks the whole time; the host admits after 2 s. No listener exists until the notice is posted.
  const r = await teamsRun({ moves: [[2000, ADMIT]], speakFrom: 0 });
  const noticeAt = final(r.events, 'notice').at;
  assert.ok(noticeAt >= 1_000_000 + 2000);
  // Frames were said every 100 ms from the start, 20 of them before admission. Every frame a listener heard was counted,
  // and none of the lobby's: what was said exceeds what was heard by at least those 20.
  const frames = Number(final(r.events, 'audio').facts?.frames);
  assert.ok(frames >= 1);
  assert.equal(r.heard(), frames);
  assert.ok(r.said() - frames >= 20, `said ${r.said()}, counted ${frames}`);
});

test('work and personal links say which they are, and only that', async () => {
  const personal = await teamsRun({ url: PERSONAL, moves: [[1000, ADMIT]], speakFrom: 0 });
  assert.deepEqual(final(personal.events, 'join').facts, { link_kind: 'personal' });
  const cloud = await teamsRun({ url: 'https://teams.cloud.microsoft/meet/synthetic5814', moves: [[1000, ADMIT]], speakFrom: 0 });
  assert.deepEqual(final(cloud.events, 'join').facts, { link_kind: 'work' });
  for (const r of [personal, cloud]) assert.ok(!JSON.stringify(r.events).includes('synthetic5814'), 'the link never reaches a report');
});

test('denied in the lobby: admission fails as not_admitted at the denied screen; no notice, nothing heard', async () => {
  const r = await teamsRun({ moves: [[1500, (p) => p.show('denied')]], speakFrom: 0 });
  assert.deepEqual(table(r.events).slice(4), ['admission:fail:not_admitted', 'notice:skipped:not_admitted', 'audio:skipped:not_admitted']);
  assert.deepEqual(final(r.events, 'admission').facts, { step: 'teams_denied' });
  assert.equal(r.page.fills.some(([sel]) => sel.includes('chat')), false);
  assert.equal(r.heard(), 0);
  assert.equal(r.shots.length, 1);
});

test('no one admits: admission times out in the lobby; no notice, nothing heard', async () => {
  const r = await teamsRun({ speakFrom: 0 });
  assert.deepEqual(table(r.events).slice(4), ['admission:fail:admission_timed_out', 'notice:skipped:not_admitted', 'audio:skipped:not_admitted']);
  assert.ok(r.events.some((e) => e.stage === 'admission' && e.result === 'running' && e.code === 'waiting_for_admission'));
  assert.equal(r.heard(), 0);
  assert.equal(r.page.started.length, 0, 'the page never starts capturing from the lobby');
});

test('admitted but silent: the notice posts, then audio fails as no_frames and nothing uploads', async () => {
  const r = await teamsRun({ afterJoin: 'in_call' });
  assert.deepEqual(table(r.events).slice(3), ['join:pass:admitted_directly', 'admission:pass:admitted_directly', 'notice:pass:notice_posted', 'audio:fail:no_frames']);
  assert.equal(r.probes.length, 0);
  // Admitted straight into the call, the page is still told to capture: a silent call, not a capture that never started.
  assert.deepEqual(r.page.started, ['in_call']);
});

test('a notice that cannot be posted: three tries, then audio is skipped and the page is never listened to', async () => {
  const r = await teamsRun({ afterJoin: 'in_call', speakFrom: 0, chatFails: true });
  assert.deepEqual(table(r.events).slice(5), ['notice:fail:notice_failed', 'audio:skipped:notice_failed']);
  assert.deepEqual(final(r.events, 'notice').facts, { attempts: NOTICE_TRIES });
  assert.equal(r.heard(), 0);
  assert.equal(r.probes.length, 0);
  assert.equal(r.shots.length, 1);
});

for (const [screen, code] of [['captcha', 'teams_captcha'], ['anonymous_blocked', 'teams_anonymous_blocked'], ['bot_blocked', 'teams_bot_blocked'],
  ['not_found', 'teams_not_found'], ['ended', 'meeting_ended']] as const) {
  test(`a Teams refusal on opening the link (${screen}) stops at join as ${code}, with its screen and a screenshot`, async () => {
    const r = await teamsRun({ first: screen });
    assert.deepEqual(table(r.events).slice(3), [`join:fail:${code}`, 'admission:skipped:join_failed', 'notice:skipped:join_failed', 'audio:skipped:join_failed']);
    assert.deepEqual(final(r.events, 'join').facts, { link_kind: 'work', step: `teams_${screen}` });
    assert.equal(r.shots.length, 1);
    assert.equal(r.page.fills.length, 0);
  });
}

test('a suspected-bot check raised in the lobby fails admission with its own code', async () => {
  const r = await teamsRun({ moves: [[1500, (p) => p.show('bot_blocked')]] });
  assert.deepEqual([final(r.events, 'admission').code, final(r.events, 'admission').facts], ['teams_bot_blocked', { step: 'teams_bot_blocked' }]);
});

test('timed-out joins: stuck on pre-join is teams_join_timed_out; a page no hook matches is teams_page_unread', async () => {
  const stuck = await teamsRun({ afterJoin: 'prejoin' });
  assert.deepEqual([final(stuck.events, 'join').code, final(stuck.events, 'join').facts?.step], ['teams_join_timed_out', 'teams_prejoin']);
  const blank = await teamsRun({ first: 'blank' });
  assert.deepEqual([final(blank.events, 'join').code, final(blank.events, 'join').facts?.step], ['teams_page_unread', 'teams_unknown']);
});

test('teamsJoinStop names each stop from the adapter’s screen, never from page text', () => {
  const blocked = new AdapterFailure('platform_blocked');
  assert.equal(teamsJoinStop(blocked, 'teams_captcha'), 'teams_captcha');
  assert.equal(teamsJoinStop(blocked, 'teams_anonymous_blocked'), 'teams_anonymous_blocked');
  assert.equal(teamsJoinStop(blocked, 'teams_bot_blocked'), 'teams_bot_blocked');
  assert.equal(teamsJoinStop(new AdapterFailure('link_invalid'), 'teams_not_found'), 'teams_not_found');
  assert.equal(teamsJoinStop(new AdapterFailure('meeting_ended'), 'teams_ended'), 'meeting_ended');
  assert.equal(teamsJoinStop(new AdapterFailure('not_admitted'), 'teams_denied'), 'not_admitted');
  assert.equal(teamsJoinStop(new AdapterFailure('link_invalid'), null), 'teams_link_unread');
  assert.equal(teamsJoinStop(blocked, 'teams_launcher'), 'teams_join_timed_out');
  assert.equal(teamsJoinStop(blocked, 'teams_prejoin'), 'teams_join_timed_out');
  assert.equal(teamsJoinStop(blocked, 'teams_unknown'), 'teams_page_unread');
  assert.equal(teamsJoinStop(new Error('net::ERR_NAME_NOT_RESOLVED'), null), 'teams_navigation_failed');
  // A Meet step is not a Teams screen.
  assert.equal(teamsJoinStop(blocked, 'meet_page_signin'), 'teams_navigation_failed');
});

test('provider-independent startup failures: no browser, or no egress, stop before any Teams screen is read', async () => {
  const noBrowser = await teamsRun({ launch: async () => { throw new Error('no chromium'); } });
  assert.deepEqual(table(noBrowser.events), ['container:pass:command_received', 'browser:fail:launch_failed', 'egress:pass:hosts_reached',
    'join:skipped:browser_failed', 'admission:skipped:browser_failed', 'notice:skipped:browser_failed', 'audio:skipped:browser_failed']);
  const down = await teamsRun({ fetch: async (url) => { if (new URL(String(url)).hostname === 'teams.live.com') throw new TypeError('fetch failed'); return new Response(null, { status: 200 }); } });
  assert.deepEqual(table(down.events).slice(2, 4), ['egress:fail:host_unreachable', 'join:skipped:egress_failed']);
  assert.equal(final(down.events, 'egress').facts?.['teams.live.com'], 'unreachable');
  assert.equal(down.page.gotos.length, 0, 'nothing is opened without egress');
});

test('denied, lobby timeout, no audio, a successful canary and a startup failure each read differently', async () => {
  const outcomes = {
    denied: stop((await teamsRun({ moves: [[1500, (p) => p.show('denied')]] })).events),
    lobby_timeout: stop((await teamsRun({})).events),
    no_audio: stop((await teamsRun({ afterJoin: 'in_call' })).events),
    canary: stop((await teamsRun({ moves: [[1500, ADMIT]], speakFrom: 0 })).events),
    startup: stop((await teamsRun({ launch: async () => { throw new Error('no chromium'); } })).events),
  };
  assert.deepEqual(outcomes, { denied: 'admission:fail:not_admitted', lobby_timeout: 'admission:fail:admission_timed_out', no_audio: 'audio:fail:no_frames',
    canary: 'none', startup: 'browser:fail:launch_failed' });
  assert.equal(new Set(Object.values(outcomes)).size, 5);
});

test('Teams runs its own stage list; Meet and Zoom keep theirs, with no notice', () => {
  assert.deepEqual(stagesFor('teams'), TEAMS_DIAGNOSE_STAGES);
  assert.deepEqual(stagesFor('google_meet'), DIAGNOSE_STAGES);
  assert.equal(DIAGNOSE_STAGES.includes('notice'), false);
  assert.deepEqual(TEAMS_DIAGNOSE_STAGES.filter((s) => s !== 'notice'), DIAGNOSE_STAGES);
  assert.deepEqual(EGRESS_HOSTS.teams, ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com']);
  // Without an injected notice, the diagnostic posts the published one, the same words a run posts.
  assert.ok(meetingBotNotice().startsWith(`I’m ${BOT_NAME}`));
});

// ── the packaged runtime on the constructed Teams page (skips by name without Chromium) ──

const skip = NO_BROWSER || false;
const CONTEXT = { uid: ID, secret: randomBytes(32).toString('hex'), callbackOrigin: 'https://worker.example.test' };

const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 30_000) => {
  const until = Date.now() + ms; // clock-ok: relative
  while (!(await fn())) { if (Date.now() > until) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); } // clock-ok: relative
};

async function packaged(scenario: string, drive: (page: () => import('playwright').Page, notes: readonly string[]) => Promise<void>) {
  const tb = await teamsBrowser();
  const reports: DiagnoseEvent[] = [];
  const stop = new AbortController();
  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== CONTEXT.callbackOrigin) return new Response(null, { status: 302 });
    if (url.pathname.endsWith('/report')) for (const e of JSON.parse(String(init!.body)).events as DiagnoseEvent[]) reports.push(e);
    return new Response('{}');
  };
  const run = runtimeDiagnose('teams', `https://teams.microsoft.com/meet/${scenario}-5814`, { ...CONTEXT, stop: stop.signal }, { launch: async () => tb.browser, fetch: fetchFake });
  try {
    await waitFor(() => tb.pages.length > 0);
    await drive(() => tb.pages[0]!, tb.notes);
    await run;
  } finally { stop.abort(); if (tb.browser.isConnected()) await tb.browser.close(); }
  const last = new Map<string, DiagnoseEvent>();
  for (const e of reports) if (!last.has(e.stage) || last.get(e.stage)!.rev < e.rev) last.set(e.stage, e);
  return { last, notes: tb.notes };
}

test('packaged: the Teams driver joins the constructed page, posts the notice before capture, and hears frames', { skip }, async () => {
  const { last, notes } = await packaged('open', async (page, seen) => {
    await waitFor(async () => (await page().evaluate('window.__teams && window.__teams.screen').catch(() => null)) === 'in_call');
    await waitFor(() => seen.includes('capture_on'));
    await page().evaluate('window.__teams.tone(440)');
  });
  assert.deepEqual(TEAMS_DIAGNOSE_STAGES.map((s) => `${s}:${last.get(s)?.result}:${last.get(s)?.code}`), ['container:pass:command_received', 'browser:pass:launched',
    'egress:pass:hosts_reached', 'join:pass:admitted_directly', 'admission:pass:admitted_directly', 'notice:pass:notice_posted', 'audio:pass:chunk_uploaded']);
  assert.deepEqual(notes.slice(0, 2), ['chat', 'capture_on']);
});

test('packaged: a chat that never opens fails the notice, and the page never captures', { skip }, async () => {
  const { last, notes } = await packaged('nochat', async () => {});
  assert.deepEqual(['notice', 'audio'].map((s) => `${s}:${last.get(s)?.result}:${last.get(s)?.code}`), ['notice:fail:notice_failed', 'audio:skipped:notice_failed']);
  assert.equal(notes.includes('capture_on'), false);
});

test('packaged: a captcha stops at join as teams_captcha', { skip }, async () => {
  const { last } = await packaged('captcha', async () => {});
  assert.deepEqual([last.get('join')?.code, last.get('join')?.facts], ['teams_captcha', { link_kind: 'work', step: 'teams_captcha' }]);
});
