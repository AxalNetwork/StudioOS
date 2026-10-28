/**
 * #2582 (D886 §1 Q5, §4): Zoom's per-participant audio on the bot's side, and
 * the founder-wait report. Synthetic SDK and callback only; no Zoom account,
 * native library or network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { VoicedStreams, voiced } from '../src/voiced.ts';
import { SeqSource, encodeWav } from '../src/wav.ts';
import { httpTransport, TransportError } from '../src/callback.ts';
import { ZoomAdapter } from '../src/zoomAdapter.ts';
import type { ZoomSdkBridge } from '../src/zoomAdapter.ts';
import { runtimeAdapter } from '../src/runtimeAdapters.ts';
import type { RuntimeAdapterContext } from '../src/runtime.ts';
import { CHUNK_SAMPLES, CHUNK_SEQ_MAX, FREE_LIMIT_MS, SAMPLE_RATE, VOICE_HANGOVER_MS, WAV_HEADER_BYTES } from '../src/constants.ts';
import type { AudioFrame, RunConfig, StatusReport } from '../src/types.ts';
import { FakeClock, StubCallback, tone } from './_harness.ts';

const S = SAMPLE_RATE;
const silence = (n: number) => new Int16Array(n);
const samplesOf = (wav: Uint8Array) => (wav.byteLength - WAV_HEADER_BYTES) / 2;
const cfg = (): RunConfig => ({
  runId: 'run_1', platform: 'zoom', meetingUrl: 'https://us02web.zoom.us/j/12345678901?pwd=synthetic-passcode',
  notice: 'Eadwyn AI is recording this call. [notice v1]', limitMs: FREE_LIMIT_MS, deadlineAt: 1_000_000 + FREE_LIMIT_MS, budgetDeadlineAt: 1_000_000 + FREE_LIMIT_MS,
});
async function recording() {
  const clock = new FakeClock(), cb = new StubCallback(), adapter = new FakeAdapter(), lines: string[] = [];
  const run = runBot(cfg(), { adapter, transport: cb, clock, log: (e, f) => lines.push(JSON.stringify({ e, ...f })) });
  adapter.arrive('p1', 'Synthetic founder'); adapter.arrive('p2', 'Synthetic interviewee');
  await clock.advance(10); adapter.admit(); await clock.advance(10);
  assert.equal(cb.statuses.at(-1)!.state, 'recording');
  return { clock, cb, adapter, run, lines };
}

// ── The energy gate ─────────────────────────────────────────────────────────

test('the gate keeps only voiced audio, with its pre-roll and hangover, at its true place on the timeline', () => {
  assert.equal(voiced(tone(320)), true); assert.equal(voiced(silence(320)), false); assert.equal(voiced(tone(320, 300)), false);
  let now = 0;
  const v = new VoicedStreams(new SeqSource(), () => now);
  now = 10_000; assert.deepEqual(v.push('p1', silence(10 * S)), [], 'ten seconds of silence sends nothing');
  now = 13_000; assert.deepEqual(v.push('p1', tone(3 * S)), [], 'a part stays open while its speaker talks');
  now = 15_000; const [part] = v.push('p1', silence(2 * S));
  assert.equal(part.participant, 'p1');
  assert.equal(part.start_ms, 9_800, 'it opens 200 ms before the first voiced window');
  assert.equal(samplesOf(part.wav), 0.2 * S + 3 * S + (VOICE_HANGOVER_MS / 1000) * S, 'pre-roll, speech, hangover; no trailing silence');
  assert.equal(v.sent, 1);
  // A stream the SDK stops delivering resumes at its true time, not glued to the last part.
  now = 60_000; v.push('p1', tone(S));
  const [late] = v.flush();
  assert.equal(late.start_ms, 59_000);
  // A cough under 300 ms of voice is not a part.
  const w = new VoicedStreams(new SeqSource(), () => 1_000);
  w.push('p2', new Int16Array([...tone(320 * 5), ...silence(2 * S)]));
  assert.deepEqual(w.flush(), []); assert.equal(w.sent, 0);
});

test('a long turn is cut at the chunk size and continues; past B1\'s chunk_seq range a part is counted, never sent', () => {
  let now = 0;
  const v = new VoicedStreams(new SeqSource(), () => now);
  now = 70_000; const parts = [...v.push('p1', tone(CHUNK_SAMPLES + 5 * S)), ...v.flush()];
  assert.equal(parts.length, 2);
  assert.equal(samplesOf(parts[0].wav), CHUNK_SAMPLES);
  assert.equal(parts[1].start_ms, parts[0].start_ms + CHUNK_SAMPLES / 16, 'the second part starts where the first ends');
  const seqs = new SeqSource();
  for (let i = 0; i < CHUNK_SEQ_MAX; i += 1) seqs.next();
  const capped = new VoicedStreams(seqs, () => now);
  now = 80_000; capped.push('p1', tone(S)); capped.push('p2', tone(S));
  assert.deepEqual(capped.flush().map((c) => c.seq), [CHUNK_SEQ_MAX], 'the last seq B1 admits is used');
  assert.equal(capped.dropped, 1); assert.equal(seqs.left, 0);
});

// ── The run: per participant when delivered, mixed otherwise, never both ──────

test('keyed parts reach the chunk event; mixed audio stops where the first own stream begins, so nothing is sent twice', async () => {
  const { clock, cb, adapter, run, lines } = await recording();
  // A frame arrives when the audio it holds has been heard: advance, then deliver.
  await clock.advance(10_000);
  adapter.say(tone(10 * S)); // the first ten seconds, mixed
  await clock.advance(3_000);
  adapter.say(tone(3 * S), 'p1'); // 10 s to 13 s, p1's own stream: from here on, per participant
  adapter.say(tone(CHUNK_SAMPLES)); // mixed after the switch, even a whole chunk of it: dropped
  await clock.advance(2_000);
  adapter.say(silence(2 * S), 'p1');
  adapter.say(tone(2 * S), 'p2');
  adapter.end();
  const r = await clock.until(run) as StatusReport;
  assert.equal(r.state, 'left');
  const seqs = [...cb.chunks.keys()].sort((a, b) => a - b);
  assert.deepEqual(seqs, [0, 1, 2], 'one contiguous chunk_seq from 0 for both paths');
  assert.deepEqual(seqs.map((q) => cb.participants.get(q)), [undefined, 'p1', 'p2']);
  assert.equal(samplesOf(cb.chunks.get(0)!), 10 * S, 'the mixed part ends at the switch; the later mixed frames never went out');
  const mixedEnd = cb.starts.get(0)! + 10_000;
  for (const q of [1, 2]) assert.ok(cb.starts.get(q)! >= mixedEnd, `part ${q} starts after the mixed stretch`);
  assert.deepEqual([r.mixed_chunks, r.participant_chunks, r.participant_streams, r.voiced_dropped], [1, 2, 2, 0]);
  const paths = lines.map((l) => JSON.parse(l)).find((l) => l.e === 'meeting_bot.audio_paths');
  assert.deepEqual(paths, { e: 'meeting_bot.audio_paths', mixed_chunks: 1, participant_chunks: 2, participant_streams: 2, voiced_dropped: 0 });
  assert.doesNotMatch(lines.join('\n'), /p1|p2|Synthetic|12345678901|passcode/, 'counts only: no participant, name or meeting in a log line');
});

test('with no per-participant frames the run falls back to mixed, unchanged', async () => {
  const { clock, cb, adapter, run } = await recording();
  adapter.say(tone(CHUNK_SAMPLES + 4 * S));
  await clock.advance(5_000);
  adapter.end();
  const r = await clock.until(run) as StatusReport;
  assert.deepEqual([...cb.participants.values()], [undefined, undefined]);
  assert.deepEqual([r.mixed_chunks, r.participant_chunks, r.participant_streams], [2, 0, 0]);
});

// ── The adapter and the transport ───────────────────────────────────────────

test('the Zoom adapter sends a participant\'s own stream, never the bot\'s, and drops mixed once one arrives', async () => {
  let mixed: (s: Int16Array) => void = () => {}, own: (k: string, s: Int16Array) => void = () => {};
  const bridge = {
    async join() {}, async admitted() { return { selfKey: 'self' }; }, async sendChat() {}, async joinAudio() {},
    async recordingAllowed() { return true; }, async requestRecordingPrivilege() { return true; }, async startRawRecording() {},
    mixedAudio(on: (s: Int16Array) => void) { mixed = on; return () => { mixed = () => {}; }; },
    participantAudio(on: (k: string, s: Int16Array) => void) { own = on; return () => { own = () => {}; }; },
    roster() { return () => {}; }, speakers() { return () => {}; }, ended() { return () => {}; }, async leave() {},
  } as ZoomSdkBridge;
  const adapter = new ZoomAdapter({ sdk: bridge, mintObf: async () => ({ token: 'synthetic-token' }), waitingForHost: async () => {} });
  const signal = new AbortController().signal;
  await adapter.join({ url: 'https://us02web.zoom.us/j/12345678901', botName: 'Eadwyn AI', signal });
  await adapter.admitted(signal); await adapter.sendChat('Synthetic notice.');
  const frames: AudioFrame[] = [];
  const off = adapter.audio((f) => frames.push(f));
  mixed(new Int16Array([1])); own('self', new Int16Array([2])); mixed(new Int16Array([3]));
  const borrowed = new Int16Array([4]); own('p1', borrowed); borrowed[0] = 99;
  mixed(new Int16Array([5])); own('p2', new Int16Array([6]));
  assert.deepEqual(frames.map((f) => [f.participant ?? null, f.samples[0]]), [[null, 1], [null, 3], ['p1', 4], ['p2', 6]]);
  off(); own('p1', new Int16Array([7])); assert.equal(frames.length, 4, 'unsubscribing ends both streams');
  await adapter.leave();
});

test('the chunk event names its participant; an id B1 would refuse is never sent', async () => {
  const RUN = '00000000-0000-4000-8000-000000000009', BASE = `https://axal.vc/api/meeting-bots/${RUN}/`, NOW = 1_700_000_000_000;
  const bodies: unknown[] = [];
  const f = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/events')) { bodies.push(JSON.parse(String(init!.body))); return Response.json({ upload_path: `/api/meeting-bots/${RUN}/chunks/${bodies.length - 1}?token=synthetic`, expires_at: NOW + 60_000 }); }
    return Response.json({ ok: true });
  }) as typeof fetch;
  const transport = httpTransport({ baseUrl: BASE, runId: RUN, key: randomBytes(16).toString('hex'), fetch: f, now: () => NOW });
  const wav = encodeWav(new Int16Array(1600));
  await transport.putChunk(0, wav, 0);
  await transport.putChunk(1, wav, 12_000, 'p1');
  assert.deepEqual(bodies, [
    { seq: 1, type: 'chunk', chunk_seq: 0, size_bytes: wav.length, start_ms: 0 },
    { seq: 2, type: 'chunk', chunk_seq: 1, size_bytes: wav.length, start_ms: 12_000, participant_id: 'p1' },
  ]);
  for (const bad of ['', 'x'.repeat(129)]) await assert.rejects(transport.putChunk(2, wav, 0, bad), TransportError);
  assert.equal(bodies.length, 2);
});

// ── Waiting for the founder ─────────────────────────────────────────────────

test('waiting for the founder is reported once, however many retries it takes, and carries nothing from the meeting', async () => {
  const statuses: StatusReport[] = [];
  const context: RuntimeAdapterContext = {
    uid: '00000000-0000-4000-8000-000000000001', secret: randomBytes(32).toString('hex'), callbackOrigin: 'https://worker.example.test',
    transport: { status: async (r) => { statuses.push(r); }, heartbeat: async () => Date.now() + 120_000, events: async () => {}, putChunk: async () => {} },
  };
  let mints = 0, joined = 0;
  const sdk = { join: async () => { joined += 1; }, leave: async () => {} } as unknown as ZoomSdkBridge;
  const adapter = await runtimeAdapter('zoom', context, {
    zoom: () => sdk, zoomWait: async () => {},
    fetch: (async () => { mints += 1; return Response.json(mints <= 4 ? { sdk_jwt: 'synthetic-sdk-jwt-'.repeat(3), waitingForHost: true } : { sdk_jwt: 'synthetic-sdk-jwt-'.repeat(3), token: 'synthetic-obf' }); }) as typeof fetch,
  });
  await adapter.join({ url: 'https://unit.zoom.us/j/111111111?pwd=synthetic', botName: 'Eadwyn AI', signal: new AbortController().signal });
  assert.equal(mints, 5); assert.equal(joined, 1);
  assert.deepEqual(statuses, [{ state: 'waiting_room' }], 'one waiting report for four waits');
  await adapter.leave();
});
