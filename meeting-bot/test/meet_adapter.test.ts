/**
 * D886 B3 (#2581): the Meet adapter on the constructed fixture, alone and under
 * B2's `runBot`. Covers:
 * - the guest join;
 * - the waiting room and admission;
 * - the notice before listening;
 * - the roster and the speaker;
 * - the tab's audio as 16 kHz frames;
 * - the refusals with D886's codes;
 * - the end of the call and removal;
 * - leaving twice;
 * - a whole run's log, which carries no link, name or chat text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetAdapter } from '../src/adapters/meet.ts';
import { AdapterFailure } from '../src/types.ts';
import type { AudioFrame, RosterChange, SpeakerChange } from '../src/types.ts';
import { runBot } from '../src/lifecycle.ts';
import { BOT_NAME, FREE_LIMIT_MS } from '../src/constants.ts';
import { StubCallback } from './_harness.ts';
import { NO_BROWSER, withMeetPage } from './_meet_browser.ts';

const skip = NO_BROWSER || false;
const LINK = 'https://meet.google.com/prejoin-abcd-efg';
const OPEN = 'https://meet.google.com/prejoin_open-abcd-efg';
const fast = { pollMs: 25, stepTimeoutMs: 5000 };
const never = new AbortController().signal;
// A wait that cannot end would hang the run instead of failing it: every admission wait in these tests has a deadline.
const soon = () => AbortSignal.timeout(15_000);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await wait(20); }
}

test('a guest join: the name, microphone and camera off, then the waiting room; admitted, it reads the call', { skip }, async () => {
  await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    const roster: RosterChange[] = [];
    const speakers: SpeakerChange[] = [];
    await bot.join({ url: LINK, botName: BOT_NAME, signal: never });
    const asked = await raw.evaluate(() => (globalThis as any).__meet.log);
    assert.deepEqual([asked.name, asked.mic, asked.camera, asked.asked], [BOT_NAME, 'off', 'off', 'ask']);
    assert.equal(await bot.state(), 'lobby');

    const admitted = bot.admitted(soon());
    await raw.evaluate(() => { const m = (globalThis as any).__meet; m.admit(); m.join('me', 'Eadwyn AI', true); m.join('p1', 'Participant A'); });
    await admitted;
    assert.equal((await raw.evaluate(() => (globalThis as any).__meet.log)).panelOpened, true, 'the participant panel is opened');

    bot.roster((c) => roster.push(c));
    assert.deepEqual(roster, [{ kind: 'join', key: 'p1', name: 'Participant A' }], 'a subscriber is told who is already there, never the bot');
    bot.speakers((c) => speakers.push(c));
    await raw.evaluate(() => { const m = (globalThis as any).__meet; m.join('p2', 'Participant B'); m.speak('p2', true); });
    await until(() => roster.length === 2 && speakers.length === 1);
    await raw.evaluate(() => { const m = (globalThis as any).__meet; m.speak('p2', false); m.part('p1'); });
    await until(() => roster.length === 3 && speakers.length === 2);
    assert.deepEqual(roster.slice(1), [{ kind: 'join', key: 'p2', name: 'Participant B' }, { kind: 'leave', key: 'p1', name: 'Participant A' }]);
    assert.deepEqual(speakers, [{ key: 'p2' }, { key: null }]);
    assert.equal(bot.participants, 1);

    await bot.sendChat('A notice for the call.');
    assert.deepEqual((await raw.evaluate(() => (globalThis as any).__meet.log)).chat, ['A notice for the call.']);
    await bot.leave();
    await bot.leave();
    assert.equal((await raw.evaluate(() => (globalThis as any).__meet.log)).left, true);
  });
});

test('audio: a remote WebRTC track arrives as 16 kHz mono frames, and none before admission', { skip }, async () => {
  await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    const frames: AudioFrame[] = [];
    bot.audio((f) => frames.push(f));
    await bot.join({ url: OPEN, botName: BOT_NAME, signal: never });
    await raw.evaluate(() => (globalThis as any).__meet.tone(440));
    await until(() => frames.reduce((n, f) => n + f.samples.length, 0) > 16000, 8000);
    const all = frames.flatMap((f) => [...f.samples]);
    assert.ok(all.some((v) => Math.abs(v) > 1000), 'the tone is heard');
    assert.ok(frames.every((f) => f.samples instanceof Int16Array));
    await bot.leave();
  });
  // Before admission nothing is taken: capture is switched on only on entering.
  await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    const frames: AudioFrame[] = [];
    bot.audio((f) => frames.push(f));
    await bot.join({ url: LINK, botName: BOT_NAME, signal: never });
    await raw.evaluate(() => (globalThis as any).__meet.tone(440));
    // Even a block that reaches Node before admission is dropped there.
    await raw.evaluate(() => (globalThis as any).__eadwynAudio(48000, btoa(String.fromCharCode(...new Uint8Array(new Float32Array(480).fill(0.5).buffer)))));
    await wait(1500);
    assert.equal(frames.length, 0, 'no audio in the waiting room');
    await bot.leave();
  });
});

test('the end of the call and removal by the host both fire ended', { skip }, async () => {
  for (const how of ['end', 'remove'] as const) {
    await withMeetPage(async (page, raw) => {
      const bot = new MeetAdapter(page, fast);
      let ended = 0;
      await bot.join({ url: OPEN, botName: BOT_NAME, signal: never });
      bot.ended(() => { ended += 1; });
      await raw.evaluate((h) => (globalThis as any).__meet[h](), how);
      await until(() => ended === 1);
      await bot.leave();
      assert.equal(ended, 1, how);
    });
  }
});

test('refusals carry D886\'s codes', { skip }, async () => {
  const code = async (fn: () => Promise<void>) => { try { await fn(); return 'none'; } catch (e) { return e instanceof AdapterFailure ? e.code : `other:${(e as Error).message}`; } };
  const joinCode = (url: string) => withMeetPage((page) => code(() => new MeetAdapter(page, fast).join({ url, botName: BOT_NAME, signal: never })));
  // From the waiting room: `act` is what the host does, `abort` the core's timeout.
  const waitCode = (act: 'deny' | 'end' | null) => withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    await bot.join({ url: LINK, botName: BOT_NAME, signal: never });
    const ctl = new AbortController();
    const pending = code(() => bot.admitted(AbortSignal.any([ctl.signal, soon()])));
    if (act) await raw.evaluate((a) => (globalThis as any).__meet[a](), act);
    else ctl.abort();
    return pending;
  });
  const out = {
    not_meet: await joinCode('https://example.test/abc'),
    link_invalid: await joinCode('https://meet.google.com/link_invalid-x'),
    blocked: await joinCode('https://meet.google.com/blocked-x'),
    ended_first: await joinCode('https://meet.google.com/ended-x'),
    denied: await waitCode('deny'),
    ended_waiting: await waitCode('end'),
    aborted: await waitCode(null),
  };
  assert.deepEqual(out, {
    not_meet: 'link_invalid', link_invalid: 'link_invalid', blocked: 'platform_blocked', ended_first: 'meeting_ended',
    denied: 'not_admitted', ended_waiting: 'meeting_ended', aborted: 'other:aborted',
  });
});

test('under B2\'s runBot: waiting room, the notice before listening, then the call to its end, with a clean log', { skip }, async () => {
  await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    const transport = new StubCallback();
    const lines: string[] = [];
    const notice = 'Eadwyn AI is recording this call.';
    const stop = new AbortController();
    const run = runBot({ runId: 'run-1', platform: 'google_meet', meetingUrl: `${LINK}?pwd=secret-passcode`, notice, limitMs: FREE_LIMIT_MS }, {
      adapter: bot, transport, stop: stop.signal, log: (event, fields) => lines.push(`${event} ${JSON.stringify(fields)}`),
    });
    // A failing check below must not leave the run's timers holding the process open.
    try {
    await until(() => transport.statuses.some((s) => s.state === 'waiting_room'));
    await raw.evaluate(() => { const m = (globalThis as any).__meet; m.admit(); m.join('me', 'Eadwyn AI', true); m.join('p1', 'Participant A'); });
    await until(() => transport.statuses.some((s) => s.state === 'recording'));
    assert.deepEqual((await raw.evaluate(() => (globalThis as any).__meet.log)).chat, [notice], 'the notice is posted once');
    await raw.evaluate(() => { const m = (globalThis as any).__meet; m.speak('p1', true); });
    await wait(300);
    await raw.evaluate(() => (globalThis as any).__meet.end());
    const result = await run;
    assert.equal(result.state, 'left');
    assert.equal(result.reason, 'call_ended');
    const events = transport.allEvents;
    assert.ok(events.some((e) => e.type === 'roster' && e.kind === 'join' && e.key === 'p1'));
    assert.ok(events.some((e) => e.type === 'speaker' && e.key === 'p1'));
    for (const line of lines) {
      for (const word of ['meet.google.com', 'secret-passcode', 'Participant A', 'Eadwyn AI', notice]) assert.ok(!line.includes(word), line);
    }
    } finally { stop.abort(); await run.catch(() => {}); }
  });
});

test('a page that has gone ends a wait as platform_blocked, and ends the call for a bot that was in', { skip }, async () => {
  const waiting = await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    await bot.join({ url: LINK, botName: BOT_NAME, signal: never });
    const pending = bot.admitted(soon()).then(() => 'admitted', (e) => (e instanceof AdapterFailure ? e.code : 'other'));
    await raw.close();
    return pending;
  });
  assert.equal(waiting, 'platform_blocked');
  const ended = await withMeetPage(async (page, raw) => {
    const bot = new MeetAdapter(page, fast);
    await bot.join({ url: OPEN, botName: BOT_NAME, signal: never });
    let n = 0;
    bot.ended(() => { n += 1; });
    await raw.close();
    await until(() => n === 1);
    await bot.leave();
    return n;
  });
  assert.equal(ended, 1);
});
