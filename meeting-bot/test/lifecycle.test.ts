/**
 * D886 B2 (#2580): the fake adapter drives a whole run against a stubbed
 * callback — join, the waiting room, the notice, audio, roster and speakers,
 * every way of leaving, and every failure code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { ADMIT_TIMEOUT_MS, ALONE_MS, BOT_NAME, CHUNK_SAMPLES, FREE_LIMIT_MS, PAID_LIMIT_MS, SAMPLE_RATE, WAV_HEADER_BYTES } from '../src/constants.ts';
import type { RunConfig } from '../src/types.ts';
import { FakeClock, StubCallback, settle, tone } from './_harness.ts';

const NOTICE = 'Eadwyn AI is recording this call for the host. [notice v1]';
const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  runId: 'run_1', platform: 'google_meet', meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc', notice: NOTICE, limitMs: FREE_LIMIT_MS, ...over,
});

function start(over: { cfg?: Partial<RunConfig>; adapter?: FakeAdapter; stop?: AbortController } = {}) {
  const clock = new FakeClock();
  const cb = new StubCallback();
  const adapter = over.adapter ?? new FakeAdapter();
  const stop = over.stop ?? new AbortController();
  const lines: string[] = [];
  const run = runBot(cfg(over.cfg), { adapter, transport: cb, clock, stop: stop.signal, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
  return { clock, cb, adapter, stop, run, lines };
}

test('1. a whole call: lobby, notice before listening, ~30 s chunks, roster and speakers, then left on call end', async () => {
  const { clock, cb, adapter, run } = start();
  adapter.arrive('p1', 'Founder');
  await clock.advance(1000);
  assert.equal(adapter.joinedAs, BOT_NAME);
  assert.equal(BOT_NAME, 'Eadwyn AI', 'the owner\'s choice, from B9\'s notice.mjs');
  assert.deepEqual(cb.statuses.map((s) => s.state), ['joining', 'waiting_room']);
  assert.deepEqual(adapter.chat, [], 'nothing is posted from the waiting room');
  assert.ok(!adapter.calls.includes('audio'), 'nothing is heard from the waiting room');

  adapter.admit();
  await clock.advance(10);
  assert.deepEqual(adapter.chat, [NOTICE]);
  const order = adapter.calls;
  assert.ok(order.indexOf('chat') < order.indexOf('audio') && order.indexOf('chat') < order.indexOf('roster'), 'the notice goes up before the bot listens');
  assert.equal(cb.statuses.at(-1)!.state, 'recording');

  adapter.arrive('p2', 'Interviewee');
  adapter.speak('p1'); adapter.speak('p1'); adapter.speak('p2'); adapter.speak(null);
  adapter.say(tone(CHUNK_SAMPLES * 2 + SAMPLE_RATE * 15)); // 75 s
  await clock.advance(5000);
  assert.deepEqual([...cb.chunks.keys()], [0, 1], 'whole chunks go out as they complete');

  adapter.depart('p2');
  adapter.end();
  const r = await clock.until(run);
  assert.equal(r.state, 'left');
  assert.equal(r.reason, 'call_ended');
  assert.deepEqual([...cb.chunks.keys()], [0, 1, 2], 'the partial chunk is sent at the end');
  assert.equal(cb.chunks.get(0)!.byteLength, WAV_HEADER_BYTES + CHUNK_SAMPLES * 2);
  assert.equal(cb.chunks.get(2)!.byteLength, WAV_HEADER_BYTES + SAMPLE_RATE * 15 * 2);
  assert.equal(r.chunks, 3); assert.equal(r.last_seq, 2); assert.equal(r.chunks_failed, 0);

  const ev = cb.allEvents;
  assert.deepEqual(ev.map((e) => e.n), [1, 2, 3, 4, 5, 6], 'events numbered in order, none lost');
  assert.deepEqual(ev.filter((e) => e.type === 'roster').map((e) => e.type === 'roster' && `${e.kind}:${e.key}:${e.name}`), ['join:p1:Founder', 'join:p2:Interviewee', 'leave:p2:Interviewee']);
  assert.deepEqual(ev.filter((e) => e.type === 'speaker').map((e) => e.type === 'speaker' && e.key), ['p1', 'p2', null], 'one event per change of speaker');
  assert.ok(ev.every((e) => e.at_ms >= 0 && e.at_ms < 60_000));
  assert.equal(r.events, 6); assert.equal(r.participants, 2);

  assert.deepEqual(cb.statuses.map((s) => s.state), ['joining', 'waiting_room', 'recording', 'left']);
  assert.deepEqual(cb.statuses.at(-1), r);
  assert.equal(adapter.leaveCalls, 1);
  assert.equal(adapter.listening, 0, 'every listener is detached');
});

test('2. it leaves after two minutes alone, and a return before then cancels the countdown', async () => {
  const adapter = new FakeAdapter({ openDoor: true });
  adapter.arrive('p1', 'A');
  const { clock, run } = start({ adapter });
  await clock.advance(10);
  adapter.depart('p1');
  await clock.advance(ALONE_MS - 1000);
  adapter.arrive('p1', 'A');
  await clock.advance(ALONE_MS * 2);
  let done = false; run.then(() => { done = true; });
  await settle();
  assert.equal(done, false, 'not alone: still recording');
  adapter.depart('p1');
  await clock.advance(ALONE_MS - 1);
  await settle();
  assert.equal(done, false, 'one millisecond short of two minutes');
  await clock.advance(1);
  const r = await clock.until(run);
  assert.equal(r.reason, 'alone');
});

test('3. alone from the start counts too', async () => {
  const { clock, run } = start({ adapter: new FakeAdapter({ openDoor: true }) });
  await clock.advance(ALONE_MS);
  assert.equal((await clock.until(run)).reason, 'alone');
});

test('4. Stop leaves, during the call and from the waiting room (no notice, nothing heard)', async () => {
  const a = new FakeAdapter({ openDoor: true });
  a.arrive('p1', 'A');
  const one = start({ adapter: a });
  await one.clock.advance(1000);
  one.stop.abort();
  assert.equal((await one.clock.until(one.run)).reason, 'stopped');
  assert.equal(a.leaveCalls, 1);

  const two = start();
  await two.clock.advance(1000);
  two.stop.abort();
  const r = await two.clock.until(two.run);
  assert.equal(r.state, 'left'); assert.equal(r.reason, 'stopped'); assert.equal(r.chunks, 0);
  assert.deepEqual(two.adapter.chat, []);
  assert.ok(!two.adapter.calls.includes('audio'));
  assert.equal(two.adapter.leaveCalls, 1);
  assert.deepEqual(two.cb.statuses.map((s) => s.state), ['joining', 'waiting_room', 'left']);
});

test('5. the plan limit ends the call: 30 minutes free, 2 hours paid; a limit over 2 hours is refused before joining', async () => {
  for (const limitMs of [FREE_LIMIT_MS, PAID_LIMIT_MS]) {
    const a = new FakeAdapter({ openDoor: true });
    a.arrive('p1', 'A');
    const { clock, run } = start({ adapter: a, cfg: { limitMs } });
    await clock.advance(limitMs - 1);
    let done = false; run.then(() => { done = true; });
    await settle();
    assert.equal(done, false);
    await clock.advance(1);
    assert.equal((await clock.until(run)).reason, 'time_limit');
  }
  const a = new FakeAdapter();
  await assert.rejects(runBot(cfg({ limitMs: PAID_LIMIT_MS + 1 }), { adapter: a, transport: new StubCallback(), clock: new FakeClock() }), /limit_out_of_range/);
  await assert.rejects(runBot(cfg({ notice: '  ' }), { adapter: a, transport: new StubCallback(), clock: new FakeClock() }), /notice_required/);
  assert.deepEqual(a.calls, [], 'a bad config never joins');
});

test('6. failure codes: refused, never admitted, a bad link, and each code an adapter raises', async () => {
  const refused = start();
  await refused.clock.advance(10);
  refused.adapter.refuse();
  assert.deepEqual(await refused.clock.until(refused.run), { state: 'failed', code: 'not_admitted' });

  const waited = start();
  await waited.clock.advance(ADMIT_TIMEOUT_MS);
  assert.equal((await waited.clock.until(waited.run)).code, 'not_admitted');
  assert.equal(waited.adapter.leaveCalls, 1);

  const badLink = start({ cfg: { meetingUrl: 'http://meet.google.com/aaa' } });
  assert.equal((await badLink.clock.until(badLink.run)).code, 'link_invalid');
  assert.ok(!badLink.adapter.calls.includes('join'), 'a bad link is never opened');

  for (const code of ['link_invalid', 'meeting_ended', 'platform_blocked', 'obf_unavailable'] as const) {
    const s = start({ adapter: new FakeAdapter({ joinFails: code, platform: 'zoom' }), cfg: { platform: 'zoom' } });
    const r = await s.clock.until(s.run);
    assert.deepEqual(r, { state: 'failed', code });
    assert.deepEqual(s.cb.statuses.at(-1), { state: 'failed', code });
  }

  // Anything that is not an AdapterFailure reads as platform_blocked.
  const odd = new FakeAdapter();
  odd.join = async () => { throw new Error('page crashed'); };
  const s = start({ adapter: odd });
  assert.equal((await s.clock.until(s.run)).code, 'platform_blocked');
});

test('7. a notice that cannot be posted ends the run with nothing heard; one that works on a retry goes on', async () => {
  const blocked = start({ adapter: new FakeAdapter({ openDoor: true, chatFailures: 3 }) });
  assert.deepEqual(await blocked.clock.until(blocked.run), { state: 'failed', code: 'platform_blocked' });
  assert.ok(!blocked.adapter.calls.includes('audio') && !blocked.adapter.calls.includes('roster'));
  assert.ok(!blocked.cb.statuses.some((s) => s.state === 'recording'));

  const a = new FakeAdapter({ openDoor: true, chatFailures: 2 });
  a.arrive('p1', 'A');
  const late = start({ adapter: a });
  await late.clock.advance(10_000);
  assert.deepEqual(a.chat, [NOTICE]);
  a.end();
  assert.equal((await late.clock.until(late.run)).reason, 'call_ended');
});

test('8. a status the callback misses is retried, and the run goes on either way', async () => {
  const a = new FakeAdapter({ openDoor: true });
  a.arrive('p1', 'A');
  const s = start({ adapter: a });
  s.cb.failStatus = 2;
  await s.clock.advance(10_000);
  a.end();
  const r = await s.clock.until(s.run);
  assert.equal(r.reason, 'call_ended');
  assert.deepEqual(s.cb.statuses.map((x) => x.state), ['joining', 'waiting_room', 'recording', 'left']);
});
