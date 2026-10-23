/** Synthetic SDK; no Zoom account, native library or network used. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { ZoomAdapter, ZoomJoinFailure, zoomMeeting } from '../src/zoomAdapter.ts';
import type { ZoomSdkBridge } from '../src/zoomAdapter.ts';
import type { RosterChange, SpeakerChange } from '../src/types.ts';
import { runBot } from '../src/lifecycle.ts';
import { FakeClock, StubCallback, settle } from './_harness.ts';

const URL = 'https://us02web.zoom.us/j/12345678901?pwd=synthetic-passcode';
const request = () => ({ url: URL, botName: 'Eadwyn AI', signal: new AbortController().signal });
function sdk() {
  const calls: string[] = [];
  let audio: (s: Int16Array) => void = () => {};
  let roster: (c: RosterChange) => void = () => {};
  let speaker: (c: SpeakerChange) => void = () => {};
  let end = () => {};
  let listeners = 0;
  const sub = () => { listeners++; return () => { listeners--; }; };
  const bridge: ZoomSdkBridge = {
    async join(i) { calls.push('join'); assert.equal(i.obfToken, 'synthetic-token'); assert.equal(i.botName, 'Eadwyn AI'); assert.equal(i.meetingId, '12345678901'); assert.equal(i.passcode, 'synthetic-passcode'); },
    async admitted() { return { selfKey: 'self' }; },
    async sendChat() { calls.push('notice'); },
    async joinAudio() { calls.push('joinAudio'); },
    async recordingAllowed() { calls.push('allowed'); return false; },
    async requestRecordingPrivilege() { calls.push('permission'); return true; },
    async startRawRecording() { calls.push('start'); },
    mixedAudio(on) { calls.push('audio'); audio = on; return sub(); },
    roster(on) { roster = on; on({ kind: 'join', key: 'self', name: 'Eadwyn AI' }); on({ kind: 'join', key: 'p1', name: 'Synthetic participant' }); return sub(); },
    speakers(on) { speaker = on; return sub(); },
    ended(on) { end = on; return sub(); },
    async leave() { calls.push('leave'); },
  };
  return { bridge, calls, say: (s: Int16Array) => audio(s), roster: (c: RosterChange) => roster(c), speak: (key: string | null) => speaker({ key }), end: () => end(), listeners: () => listeners };
}

async function scenario(Adapter = ZoomAdapter) {
  const s = sdk(); let mints = 0, waits = 0;
  const adapter = new Adapter({ sdk: s.bridge, async mintObf(id) {
    assert.equal(id, '12345678901'); mints++;
    return mints === 1 ? { waitingForHost: true } : { token: 'synthetic-token' };
  }, async waitingForHost() { waits++; }, async wait() {} });
  const req = request();
  assert.throws(() => adapter.audio(() => {}), /platform_blocked/);
  await adapter.join(req); await adapter.admitted(req.signal);
  assert.deepEqual([mints, waits], [2, 1]);
  assert.throws(() => adapter.audio(() => {}), /platform_blocked/);
  await adapter.sendChat('Synthetic recording notice.');
  const frames: Int16Array[] = [], people: RosterChange[] = [], speakers: SpeakerChange[] = [];
  adapter.audio(f => frames.push(f.samples)); adapter.roster(c => people.push(c)); adapter.speakers(c => speakers.push(c));
  const input = new Int16Array([1, 2, 3]); s.say(input); input[0] = 99;
  s.speak('self'); s.speak('p1'); s.speak(null);
  s.roster({ kind: 'leave', key: 'p1', name: 'Synthetic participant' });
  assert.deepEqual([...frames[0]], [1, 2, 3], 'copy borrowed native memory');
  assert.deepEqual(people.map(p => [p.kind, p.key]), [['join', 'p1'], ['leave', 'p1']]);
  assert.deepEqual(speakers.map(p => p.key), [null, 'p1', null]);
  assert.deepEqual(s.calls, ['join', 'notice', 'joinAudio', 'allowed', 'permission', 'start', 'audio']);
  await adapter.leave(); await adapter.leave();
  assert.equal(s.listeners(), 0); assert.equal(s.calls.filter(c => c === 'leave').length, 1);
  s.say(new Int16Array([4])); s.speak('p1'); s.roster({ kind: 'join', key: 'late', name: 'Late' });
  assert.equal(frames.length, 1); assert.equal(people.length, 2); assert.equal(speakers.length, 3);
  assert.equal(JSON.stringify(adapter).includes('synthetic-token'), false);
}

test('Zoom: OBF wait, notice/permission ordering, borrowed audio, roster, speakers and teardown', () => scenario());
test('Zoom: strict link validation never exposes the rejected input', () => {
  assert.deepEqual(zoomMeeting(URL), { meetingId: '12345678901', passcode: 'synthetic-passcode' });
  for (const url of ['http://zoom.us/j/12345678901', 'https://zoom.us.evil.test/j/12345678901', 'https://evil.test/j/12345678901', 'https://u:p@zoom.us/j/12345678901', 'https://zoom.us/wrong/12345678901', 'https://zoom.us/j/abc', 'https://zoom.us/j/12345678901?pwd=%00']) {
    assert.throws(() => zoomMeeting(url), (e: Error) => e.message === 'link_invalid');
  }
});
test('Zoom: missing founder at SDK join remints, other refusals are terminal and sanitized', async () => {
  for (const code of ['authorized_user_absent', 'refused', 'ended'] as const) {
    const s = sdk(); let n = 0, waits = 0;
    s.bridge.join = async () => { if (++n === 1) throw new ZoomJoinFailure(code); };
    const a = new ZoomAdapter({ sdk: s.bridge, async mintObf() { return { token: 'synthetic-token' }; }, async waitingForHost() { waits++; }, async wait() {} });
    if (code === 'authorized_user_absent') { await a.join(request()); assert.equal(n, 2); assert.equal(waits, 1); }
    else await assert.rejects(a.join(request()), { message: code === 'ended' ? 'meeting_ended' : 'obf_unavailable' });
    await a.leave();
  }
});
test('Zoom: abort, empty token and bounded founder wait never join', async () => {
  for (const kind of ['abort', 'empty', 'wait']) {
    const s = sdk(); let n = 0;
    const a = new ZoomAdapter({ sdk: s.bridge, async mintObf() { n++; return kind === 'empty' ? { token: '' } : { waitingForHost: true }; }, async waitingForHost() {}, async wait() {} });
    const req = request(); if (kind === 'abort') { const stop = new AbortController(); stop.abort(); req.signal = stop.signal; }
    await assert.rejects(a.join(req), { message: 'obf_unavailable' });
    assert.equal(n, kind === 'abort' ? 0 : kind === 'empty' ? 1 : 120); assert.deepEqual(s.calls, []);
  }
});
test('Zoom: permission denied never starts raw recording or permits a listener', async () => {
  const s = sdk(); s.bridge.requestRecordingPrivilege = async () => false;
  const a = new ZoomAdapter({ sdk: s.bridge, async mintObf() { return { token: 'synthetic-token' }; }, async waitingForHost() {} });
  const req = request(); await a.join(req); await a.admitted(req.signal);
  await assert.rejects(a.sendChat('Synthetic notice'), { message: 'platform_blocked' });
  assert.equal(s.calls.includes('start'), false); assert.throws(() => a.audio(() => {}), /platform_blocked/);
  await a.leave();
});
async function throughCore(Adapter = ZoomAdapter) {
  const s = sdk(); const clock = new FakeClock(), cb = new StubCallback();
  const a = new Adapter({ sdk: s.bridge, async mintObf() { return { token: 'synthetic-token' }; }, async waitingForHost() {} });
  const run = runBot({ runId: 'synthetic', platform: 'zoom', meetingUrl: URL, notice: 'Synthetic notice', limitMs: 1800000 }, { adapter: a, transport: cb, clock });
  await settle(); s.say(new Int16Array(16000)); s.speak('p1'); s.end(); s.say(new Int16Array(16000));
  const result = await clock.until(run);
  assert.equal(result.state, 'left'); assert.equal(result.participants, 1); assert.equal(result.chunks, 1);
  assert.equal(cb.chunks.get(0)!.byteLength, 32044); assert.equal(s.listeners(), 0);
}
test('Zoom through B2: mixed WAV, roster/events, no PCM after end', () => throughCore());

const mutations = [
  ['skip waiting state', 'await this.deps.waitingForHost();', ''],
  ['skip permission request', '!(await this.deps.sdk.requestRecordingPrivilege(this.signal))', 'false'],
  ['skip raw start', 'await this.deps.sdk.startRawRecording(this.signal);', ''],
  ['skip notice', 'await this.deps.sdk.sendChat(text);', ''],
  ['skip audio join', 'await this.deps.sdk.joinAudio(this.signal);', ''],
  ['borrow buffer', 'samples: samples.slice()', 'samples'],
  ['include bot roster', 'c.key !== this.selfKey', 'true'],
  ['include bot speaker', 'c.key === this.selfKey ? null : c.key', 'c.key'],
  ['leak subscriptions', 'for (const off of this.subs) off();', ''],
  ['listen before permission', '!this.ready || this.left', 'this.left'],
] as const;
for (const [name, before, after] of mutations) test('Zoom mutation: ' + name, async () => {
  await scenario();
  const url = new globalThis.URL('../src/zoomAdapter.ts', import.meta.url);
  const source = readFileSync(url, 'utf8'); assert.ok(source.includes(before));
  const stripped = stripTypeScriptTypes(source.replace(before, after), { mode: 'strip' }).replaceAll("'./types.ts'", JSON.stringify(new globalThis.URL('../src/types.ts', import.meta.url).href));
  const variant = await import('data:text/javascript;base64,' + Buffer.from(stripped).toString('base64'));
  await assert.rejects(() => scenario(variant.ZoomAdapter), { name: 'AssertionError' });
  await scenario();
});

test('Zoom mutation: end must stop late PCM immediately', async () => {
  await throughCore();
  const url = new globalThis.URL('../src/zoomAdapter.ts', import.meta.url);
  const source = readFileSync(url, 'utf8');
  const before = 'this.ready = false; // No late PCM';
  assert.ok(source.includes(before));
  const stripped = stripTypeScriptTypes(source.replace(before, '// No late PCM'), { mode: 'strip' }).replaceAll("'./types.ts'", JSON.stringify(new globalThis.URL('../src/types.ts', import.meta.url).href));
  const variant = await import('data:text/javascript;base64,' + Buffer.from(stripped).toString('base64'));
  await assert.rejects(() => throughCore(variant.ZoomAdapter), { name: 'AssertionError' });
  await throughCore();
});
