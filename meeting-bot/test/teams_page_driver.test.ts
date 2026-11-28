/**
 * D5812 (#5812, D1451 part 2): the Playwright `TeamsPage` driver in real
 * Chromium, on the constructed fixture (`fixtures/teams.html`), alone and
 * through the packaged factory under B2's `runBot`.
 *
 *   a. `query` returns exactly the attributes asked for, null when missing,
 *      and only visible elements.
 *   b. An element's text never comes back, even asked for by name.
 *   c. Audio reaches a listener only after admission (`startCapture`) AND a
 *      subscription; the page's capture switch stays off until both.
 *   d. The packaged factory's Teams adapter, whole run: pre-join with mic and
 *      camera off and the name "Eadwyn AI", the lobby with nothing heard, the
 *      notice before capture, roster attributes, caption speaker timing, an
 *      orderly hang-up, and the browser closed.
 *   e. A failed notice: no capture, no chunk, no event.
 *   f. Refusals (captcha, anonymous join off, bot blocked) stop the run as
 *      `platform_blocked` with an allowlisted stage; a captcha is never touched.
 *   g. Bounded cleanup on the admission timeout, the run's time limit and a
 *      failed upload.
 *   h. No text-reading call in the Teams driver or adapter source.
 *
 * A real browser runs on real time: every clock read is relative to the
 * start of a run, a polling deadline or a measured duration (`clock-ok`), and
 * the lifecycle's own timers may run on a scaled real clock (`scaled`). The browser tests skip by name without Chromium.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { playwrightTeamsPage } from '../src/adapters/teams/page.ts';
import { TEAMS_STAGES } from '../src/adapters/teams.ts';
import { ROSTER_KEY, ROSTER_NAME, ROSTER_SELF, TEAMS } from '../src/adapters/teamsSelectors.ts';
import { LEAVE_MS, runtimeAdapter } from '../src/runtimeAdapters.ts';
import { realClock, runBot } from '../src/lifecycle.ts';
import { ADMIT_TIMEOUT_MS, BOT_NAME, FREE_LIMIT_MS } from '../src/constants.ts';
import type { Clock, RunConfig } from '../src/types.ts';
import type { RuntimeAdapterContext } from '../src/runtime.ts';
import { StubCallback } from './_harness.ts';
import { NO_BROWSER, launchBrowser, routeTeams, teamsBrowser } from './_teams_browser.ts';

const skip = NO_BROWSER || false;
// A test that fails mid-run must not leave its run (and its heartbeat) keeping this file alive.
const stops: AbortController[] = [];
after(() => { for (const s of stops) s.abort(); });
const NOTICE = 'Eadwyn AI is recording this call for the host. [notice v1]';
// Invented links: the scenario is the first part of the meeting id (see the fixture).
const link = (scenario: string) => `https://teams.microsoft.com/meet/${scenario}-1234567890123?p=FixturePass1`;
/** The factory's leave: the adapter's hang-up (bounded by LEAVE_MS), then the browser closes. */
const CLOSE_BOUND_MS = LEAVE_MS + 3000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms; // clock-ok: deadline
  while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await wait(25); } // clock-ok: deadline
}
/** Runs `fn` in the fixture page with its control object (`window.__teams`) and a JSON argument. */
const fx = (page: { evaluate: (expression: string) => Promise<any> }, fn: (t: any, arg: any) => unknown, arg?: unknown): Promise<any> =>
  page.evaluate(`(${fn.toString()})(window.__teams, ${JSON.stringify(arg ?? null)})`);

/** Real time, `k` times faster for the lifecycle's own timers (admission wait, retries, drain). */
function scaled(k: number): Clock {
  const t0 = Date.now(); // clock-ok: relative
  return {
    now: () => t0 + (Date.now() - t0) * k, // clock-ok: relative
    setTimeout: (fn, ms) => realClock.setTimeout(fn, ms / k),
    sleep: (ms) => realClock.sleep(ms / k),
  };
}

const context: RuntimeAdapterContext = {
  uid: '00000000-0000-4000-8000-000000005812', secret: randomBytes(32).toString('hex'), callbackOrigin: 'https://worker.example.test',
  transport: { status: async () => {}, heartbeat: async () => Date.now() + 120_000, events: async () => {}, putChunk: async () => {} }, // clock-ok: relative
};

function config(url: string, clock: Clock, over: Partial<RunConfig> = {}): RunConfig {
  return { runId: 'run_teams_driver', platform: 'teams', meetingUrl: url, notice: NOTICE, limitMs: FREE_LIMIT_MS,
    deadlineAt: clock.now() + FREE_LIMIT_MS, budgetDeadlineAt: clock.now() + 120_000, ...over };
}

/** The packaged factory's Teams adapter on a fixture browser, and a run of it. */
async function packaged(scenario: string, opts: { clock?: Clock; cb?: StubCallback; over?: (c: Clock) => Partial<RunConfig> } = {}) {
  const tb = await teamsBrowser();
  const adapter = await runtimeAdapter('teams', context, { launch: async () => tb.browser });
  const clock = opts.clock ?? realClock;
  const cb = opts.cb ?? new StubCallback();
  const stop = new AbortController();
  stops.push(stop);
  const lines: string[] = [];
  const run = runBot(config(link(scenario), clock, opts.over?.(clock)), { adapter, transport: cb, clock, stop: stop.signal, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
  run.catch(() => {});
  return { tb, adapter, cb, stop, run, lines, page: () => tb.pages[0]! };
}

async function rawDriver(scenario: string) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const notes = await routeTeams(page);
  const driver = await playwrightTeamsPage(page);
  await driver.goto(link(scenario));
  return { browser, page, notes, driver };
}

/** Through the launcher and pre-join, by the driver alone. */
async function intoCall(driver: Awaited<ReturnType<typeof rawDriver>>['driver']) {
  await driver.click(TEAMS.continueInBrowser.selector);
  await driver.click(TEAMS.joinButton.selector);
}

test('a. query returns exactly the attributes asked for, null when missing, visible elements only', { skip }, async () => {
  // Mutation checked: dropping the visibility filter → the hidden "ghost" row is returned; reading a fixed attribute list → the null check fails.
  const { browser, page, driver } = await rawDriver('open');
  try {
    await driver.click(TEAMS.continueInBrowser.selector);
    assert.deepEqual(await driver.query(TEAMS.micToggle.selector, ['aria-pressed', 'data-missing']), [{ 'aria-pressed': 'true', 'data-missing': null }]);
    assert.deepEqual(await driver.query(TEAMS.lobby.selector, []), [], 'none: an empty list');
    await driver.click(TEAMS.joinButton.selector);
    await fx(page, (t) => t.people([{ id: 'self', name: 'Eadwyn AI', self: true }, { id: 'p1', name: 'Participant A' }]));
    await driver.click(TEAMS.rosterButton.selector);
    assert.deepEqual(await driver.query(TEAMS.rosterRow.selector, TEAMS.rosterRow.attrs), [
      { [ROSTER_KEY]: 'self', [ROSTER_NAME]: 'Eadwyn AI', [ROSTER_SELF]: 'true' },
      { [ROSTER_KEY]: 'p1', [ROSTER_NAME]: 'Participant A', [ROSTER_SELF]: 'false' },
    ]);
    await assert.rejects(() => driver.click(TEAMS.chatSend.selector), /not on the page/, 'a click on what the page does not show fails at once');
  } finally { await browser.close(); }
});

test('b. an element\'s text never comes back from query, even when asked for by name', { skip }, async () => {
  // Mutation checked: query returning el.textContent (or innerText) for each row → the SECRET checks fail, and h. fails.
  const { browser, page, driver } = await rawDriver('open');
  try {
    await intoCall(driver);
    await fx(page, (t) => { t.people([{ id: 'p1', name: 'Participant A' }]); });
    await driver.click(TEAMS.rosterButton.selector);
    await driver.click(TEAMS.moreButton.selector);
    await driver.click(TEAMS.captionsOn.selector);
    await fx(page, (t) => t.captions([{ name: 'Participant A', words: 'SECRET CAPTION WORDS' }]));
    const asked = ['data-speaker-name', 'textContent', 'innerText', 'innerHTML'];
    const captions = await driver.query(TEAMS.captionRow.selector, asked);
    assert.deepEqual(captions, [{ 'data-speaker-name': 'Participant A', textContent: null, innerText: null, innerHTML: null }]);
    const rows = await driver.query(TEAMS.rosterRow.selector, [...TEAMS.rosterRow.attrs, 'textContent']);
    for (const out of [captions, rows]) assert.ok(!JSON.stringify(out).includes('SECRET'), JSON.stringify(out));
  } finally { await browser.close(); }
});

test('c. audio reaches a listener only after admission and a subscription; the page capture switch stays off until both', { skip }, async () => {
  // Mutation checked: capture switched on in playwrightTeamsPage (before goto) or in onAudio regardless of startCapture → "nothing before admission" fails.
  const { browser, page, notes, driver } = await rawDriver('open');
  try {
    await intoCall(driver);
    const heard: Float32Array[] = [];
    const off = driver.onAudio((s) => heard.push(s));
    await fx(page, (t) => t.tone(440));
    // Even a block that reaches Node before admission is dropped there.
    await page.evaluate(() => (globalThis as any).__eadwynAudio(48000, btoa(String.fromCharCode(...new Uint8Array(new Float32Array(480).fill(0.5).buffer)))));
    await wait(1500);
    assert.equal(heard.length, 0, 'nothing before admission');
    assert.deepEqual(notes, [], 'the page capture switch never turned on');
    assert.equal(await page.evaluate(() => (globalThis as any).__eadwynCapture.on), false);

    off();
    await driver.startCapture();
    await wait(800);
    assert.deepEqual(notes, [], 'admitted with no listener (the notice not yet posted): still off');

    const off2 = driver.onAudio((s) => heard.push(s));
    await until(() => heard.reduce((n, s) => n + s.length, 0) > 48000, 8000);
    assert.ok(heard.flatMap((s) => [...s]).some((v) => Math.abs(v) > 0.05), 'the tone is heard');
    assert.deepEqual(notes, ['capture_on']);
    off2();
    await until(() => notes.length === 2);
    assert.deepEqual(notes, ['capture_on', 'capture_off'], 'the last listener gone turns the page capture off');
    const n = heard.length;
    await wait(800);
    assert.equal(heard.length, n, 'nothing after the last listener left');
  } finally { await browser.close(); }
});

test('d. the packaged factory: pre-join, lobby, notice before capture, roster attributes, speaker timing, orderly leave', { skip }, async () => {
  // Mutation checked: the factory's original `page as unknown as TeamsPage` cast → "query is not a function" fails the run as
  // platform_blocked at the first read; startCapture called in join (before admission) → the lobby capture check fails.
  const { tb, cb, stop, run, lines, page } = await packaged('lobby');
  try {
    await until(() => cb.statuses.some((s) => s.state === 'waiting_room'));
    const pre = await fx(page(), (t) => t.log);
    assert.deepEqual([pre.name, pre.mic, pre.camera, pre.joins], [BOT_NAME, 'off', 'off', 1], 'the visible name is Eadwyn AI, mic and camera off');
    await fx(page(), (t) => t.tone(440));
    await wait(2000);
    assert.equal(cb.chunkSends, 0, 'nothing is uploaded from the lobby');
    assert.deepEqual(tb.notes, [], 'nothing is captured or posted from the lobby');

    await fx(page(), (t) => { t.people([{ id: 'self', name: 'Eadwyn AI', self: true }, { id: 'p1', name: 'Participant A' }, { id: 'p2', name: 'Participant B' }]); t.admit(); });
    await until(() => cb.statuses.some((s) => s.state === 'recording'));
    await until(() => tb.notes.includes('capture_on'));
    assert.deepEqual(tb.notes.slice(0, 2), ['chat', 'capture_on'], 'the notice is posted before the page captures anything');
    assert.deepEqual((await fx(page(), (t) => t.log)).chat, [NOTICE]);

    await until(async () => (await fx(page(), (t) => t.screen)) === 'in_call' && (await page().locator(TEAMS.captionsOn.selector).count()) === 0);
    await wait(1500);
    await fx(page(), (t) => t.captions([{ name: 'Participant A', words: 'SECRET CAPTION WORDS' }]));
    await wait(2200);
    await fx(page(), (t) => t.captions([{ name: 'Participant A', words: 'SECRET' }, { name: 'Participant B', words: 'SECRET MORE WORDS' }]));
    await wait(2200);
    stop.abort();
    const r = await run;
    assert.deepEqual([r.state, r.reason], ['left', 'stopped']);
    assert.ok((r.chunks ?? 0) >= 1 && r.chunks_failed === 0, 'the admitted audio is uploaded');
    assert.equal(tb.notes.at(-1), 'hangup', `it hangs up on leaving (${tb.notes})`);
    await until(() => !tb.browser.isConnected(), CLOSE_BOUND_MS); // the browser is closed, within the bound

    const events = cb.allEvents;
    const roster = events.filter((e) => e.type === 'roster').at(-1)!;
    assert.deepEqual(roster.type === 'roster' && roster.participants.map((p) => [p.id, p.name]), [['p1', 'Participant A'], ['p2', 'Participant B']], 'the bot and a hidden row are never reported');
    const speakers = events.filter((e) => e.type === 'speaker') as Array<{ participant_id: string | null; at_ms: number }>;
    assert.deepEqual(speakers.map((s) => s.participant_id), ['p1', 'p2', null]);
    assert.ok(speakers[1]!.at_ms - speakers[0]!.at_ms >= 1500, `speaker timing follows the captions (${speakers.map((s) => s.at_ms)})`);
    assert.ok(speakers[2]!.at_ms >= speakers[1]!.at_ms);
    for (const secret of ['SECRET', 'Participant A', 'FixturePass1', '1234567890123']) {
      assert.ok(!JSON.stringify(events).includes('SECRET'), 'no caption words in an event');
      assert.ok(!lines.some((l) => l.includes(secret)), `no log line names "${secret}"`);
    }
  } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
});

test('e. a notice that cannot be posted: no capture, no chunk, no roster or speaker event', { skip }, async () => {
  // Mutation checked: TeamsAdapter.audio/the driver forwarding without a subscription (capture on at startCapture) → the capture note appears.
  const { tb, cb, run } = await packaged('nochat', { clock: scaled(10) });
  try {
    await until(() => tb.pages.length > 0);
    await until(async () => (await fx(tb.pages[0]!, (t) => t.screen).catch(() => null)) === 'in_call');
    await fx(tb.pages[0]!, (t) => t.tone(440)).catch(() => {});
    const r = await run;
    assert.deepEqual([r.state, r.code], ['failed', 'notice_failed']);
    assert.equal(cb.statuses.filter((s) => s.state === 'recording').length, 0);
    assert.equal(cb.chunkSends, 0, 'no audio is uploaded');
    assert.deepEqual(cb.allEvents, [], 'no roster or speaker is stored');
    assert.ok(!tb.notes.includes('capture_on'), 'the page never captured');
    assert.ok(!tb.notes.includes('chat'));
    await until(() => !tb.browser.isConnected(), CLOSE_BOUND_MS);
  } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
});

for (const [scenario, screen, stage] of [
  ['captcha', null, 'teams_captcha'],
  ['anonymous', null, 'teams_anonymous_blocked'],
  ['lobby', 'bot_blocked', 'teams_bot_blocked'],
] as const) {
  test(`f. ${stage}: the run stops as platform_blocked with an allowlisted stage, and nothing is captured or posted`, { skip }, async () => {
    // Mutation checked: diagnostic() not recording the stage → the detail check fails; a captcha clicked → the captcha check fails.
    const { tb, cb, run } = await packaged(scenario);
    try {
      if (screen) {
        await until(() => cb.statuses.some((s) => s.state === 'waiting_room'));
        await fx(tb.pages[0]!, (t, s) => t.show(s), screen);
      }
      const r = await run;
      assert.deepEqual([r.state, r.code, r.detail], ['failed', 'platform_blocked', stage]);
      assert.ok(TEAMS_STAGES.includes(stage) && /^[a-z_]{1,40}$/.test(stage), 'the stage is one of the fixed codes the Worker keeps');
      assert.equal(cb.statuses.at(-1)!.detail, stage);
      assert.ok(!tb.notes.includes('captcha_click'), 'a captcha is never touched');
      assert.ok(!tb.notes.includes('capture_on') && !tb.notes.includes('chat'));
      assert.equal(cb.chunkSends, 0);
      await until(() => !tb.browser.isConnected(), CLOSE_BOUND_MS);
    } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
  });
}

test('g. bounded cleanup: never admitted (admission timeout), the run\'s time limit, and a failed upload', { skip }, async () => {
  // Mutation checked: the factory's leave not closing the browser → the isConnected checks fail.
  // Never admitted: the lifecycle's ten-minute wait, at 100× speed.
  {
    const { tb, cb, run } = await packaged('lobby', { clock: scaled(100) });
    try {
      await until(() => cb.statuses.some((s) => s.state === 'waiting_room'));
      await fx(tb.pages[0]!, (t) => t.tone(440));
      const t0 = Date.now(); // clock-ok: duration
      const r = await run;
      assert.deepEqual([r.state, r.code], ['failed', 'not_admitted']);
      assert.ok(Date.now() - t0 < ADMIT_TIMEOUT_MS / 100 + 7000, 'it gives up at the admission wait plus the bounded leave'); // clock-ok: duration
      assert.equal(r.detail, 'teams_lobby', 'it says it stopped in the lobby');
      assert.equal(cb.chunkSends, 0);
      assert.ok(!tb.notes.includes('capture_on'));
      await until(() => !tb.browser.isConnected(), CLOSE_BOUND_MS);
    } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
  }
  // The run's own deadline while recording.
  {
    const { tb, cb, run } = await packaged('open', { over: (c) => ({ deadlineAt: c.now() + 9000, budgetDeadlineAt: c.now() + 9000 }) });
    try {
      await until(() => tb.notes.includes('capture_on'));
      await fx(tb.pages[0]!, (t) => t.tone(440));
      const r = await run;
      assert.equal(r.state, 'left');
      assert.ok(r.reason === 'time_limit' || r.reason === 'tokens', `ended by its deadline (${r.reason})`);
      assert.ok((r.chunks ?? 0) >= 1);
      assert.equal(tb.notes.at(-1), 'hangup');
      await until(() => !tb.browser.isConnected(), CLOSE_BOUND_MS);
      assert.equal(cb.statuses.at(-1)!.state, 'left');
    } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
  }
  // A failed upload: the browser is closed before the drain, and the drain ends at its bound.
  {
    const cb = new StubCallback();
    cb.failChunk.set(0, 1_000);
    const { tb, stop, run } = await packaged('open', { clock: scaled(10), cb });
    try {
      await until(() => tb.notes.includes('capture_on'));
      await fx(tb.pages[0]!, (t) => t.tone(440));
      await wait(2000);
      const t0 = Date.now(); // clock-ok: duration
      stop.abort();
      await until(() => !tb.browser.isConnected(), 7000);
      const r = await run;
      assert.deepEqual([r.state, r.code], ['failed', 'processing_failed']);
      assert.ok((r.chunks_failed ?? 0) >= 1 && r.chunks === 0);
      assert.ok(Date.now() - t0 < 20_000 / 10 + 8000, 'the drain ends at its bound'); // clock-ok: duration
      assert.equal(tb.notes.at(-1), 'hangup');
    } finally { if (tb.browser.isConnected()) await tb.browser.close(); }
  }
});

test('h. the Teams driver and adapter never read an element\'s text', () => {
  // Mutation checked: adding `el.textContent` to the driver's query → this fails.
  for (const file of ['../src/adapters/teams/page.ts', '../src/adapters/teams.ts', '../src/adapters/teamsSelectors.ts']) {
    const code = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /textContent|innerText|innerHTML|outerHTML|inner_text|allTextContents|\.textContent\(/, file);
  }
});
