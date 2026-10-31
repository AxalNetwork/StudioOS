/** #3708: the owner's staged diagnostic, against fakes: each stage, in order, and where it stops. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiagnosis, joinStop, diagnoseCallbacks, type DiagnoseDeps, type DiagnoseReport } from '../src/diagnose.ts';
import { RuntimeHost } from '../src/runtime.ts';
import { signRequest } from '../src/callback.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { AdapterFailure } from '../src/types.ts';
import type { AudioFrame, MeetingAdapter } from '../src/types.ts';
import { FakeClock } from './_harness.ts';

type Step = string | null;
/** A Meet adapter whose join and admission are scripted, with D1368's last step. */
class ScriptedMeet implements MeetingAdapter {
  readonly platform = 'google_meet' as const;
  step: Step = null;
  left = 0;
  private listener: ((f: AudioFrame) => void) | null = null;
  private readonly script: { join: () => Promise<Step>; admitted?: (s: AbortSignal) => Promise<void> };
  constructor(script: ScriptedMeet['script']) { this.script = script; }
  async join() { this.step = 'meet_navigation_started'; this.step = await this.script.join(); }
  async admitted(signal: AbortSignal) { await (this.script.admitted ?? (() => Promise.resolve()))(signal); this.step = 'meet_admitted'; }
  async sendChat() {}
  audio(on: (f: AudioFrame) => void) { this.listener = on; return () => { this.listener = null; }; }
  frame() { this.listener?.({ samples: new Int16Array(1600).fill(900) }); }
  roster() { return () => {}; }
  speakers() { return () => {}; }
  ended() { return () => {}; }
  async leave() { this.left += 1; }
  diagnostic() { return this.step; }
}

function harness(meet: ScriptedMeet | null, opts: { fetch?: typeof fetch; launch?: DiagnoseDeps['launch']; probe?: DiagnoseDeps['probe'] } = {}) {
  const clock = new FakeClock(), reports: DiagnoseReport[] = [], shots: Uint8Array[] = [], probes: Uint8Array[] = [];
  let closed = 0;
  const deps: DiagnoseDeps = {
    clock, report: async (r) => { reports.push(r); },
    screenshot: async (png) => { shots.push(png); },
    probe: opts.probe ?? (async (wav) => { probes.push(wav); }),
    fetch: opts.fetch ?? (async () => new Response(null, { status: 302 })),
    launch: opts.launch ?? (async () => ({ page: { screenshot: async () => new Uint8Array([137, 80, 78, 71]), url: () => 'https://meet.google.com/x' }, meet: meet!, close: async () => { closed += 1; } })),
    admitMs: 60_000, audioMs: 5_000,
  };
  return { clock, deps, reports, shots, probes, closed: () => closed };
}
const table = (reports: DiagnoseReport[]) => reports.filter((r) => r.result !== 'running').map((r) => `${r.stage}:${r.result}:${r.code}`);

test('admitted with frames: every stage passes in order and a silent probe the frames’ length uploads', async () => {
  const meet = new ScriptedMeet({ join: async () => 'meet_join_result:lobby' });
  const h = harness(meet);
  const run = runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', h.deps);
  await h.clock.advance(500);
  meet.frame(); meet.frame();
  await h.clock.until(run, 250);
  assert.deepEqual(table(h.reports), ['container:pass:command_received', 'browser:pass:launched', 'egress:pass:hosts_reached',
    'join:pass:asked_to_join', 'admission:pass:admitted', 'audio:pass:chunk_uploaded']);
  assert.ok(h.reports.some((r) => r.stage === 'admission' && r.result === 'running' && r.code === 'waiting_for_admission'));
  // 3200 samples of zeros, never the frames' values.
  assert.equal(h.probes.length, 1);
  assert.equal(h.probes[0].byteLength, 44 + 3200 * 2);
  assert.ok(h.probes[0].subarray(44).every((b) => b === 0));
  assert.equal(h.reports.at(-1)!.facts?.frames, 2);
  assert.equal(h.shots.length, 1);
  assert.equal(meet.left, 1); assert.equal(h.closed(), 1);
});

test('the sign-in wall stops at join with a screenshot, and later stages are skipped', async () => {
  const meet = new ScriptedMeet({ join: async () => { meet.step = 'meet_page_signin'; throw new AdapterFailure('platform_blocked'); } });
  const h = harness(meet);
  await runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', h.deps);
  assert.deepEqual(table(h.reports).slice(3), ['join:fail:signin_wall', 'admission:skipped:join_failed', 'audio:skipped:join_failed']);
  assert.equal(h.reports[3].facts?.step, 'meet_page_signin');
  assert.equal(h.shots.length, 1);
});

test('where the page stops is named for each kind of refusal', () => {
  const blocked = new AdapterFailure('platform_blocked');
  assert.equal(joinStop(blocked, 'meet_page_signin'), 'signin_wall');
  assert.equal(joinStop(blocked, 'meet_prejoin_result:platform_blocked'), 'cannot_join');
  assert.equal(joinStop(blocked, 'meet_page_unsupported'), 'page_unsupported');
  assert.equal(joinStop(blocked, 'meet_join_result:prejoin'), 'join_click_unanswered');
  assert.equal(joinStop(new AdapterFailure('not_admitted'), 'meet_join_result:not_admitted'), 'not_admitted');
  assert.equal(joinStop(new AdapterFailure('link_invalid'), null), 'link_invalid');
  assert.equal(joinStop(new Error('timeout'), 'meet_navigation_started'), 'navigation_failed');
  assert.equal(joinStop(new Error('x'), 'meet_join_click_started'), 'join_button_failed');
  assert.equal(joinStop(new Error('x'), null), 'page_unread');
});

test('the host never admits: admission times out, with a screenshot of the lobby', async () => {
  const meet = new ScriptedMeet({ join: async () => 'meet_join_result:lobby',
    admitted: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const h = harness(meet);
  await h.clock.until(runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', h.deps), 10_000);
  assert.deepEqual(table(h.reports).slice(4), ['admission:fail:admission_timed_out', 'audio:skipped:not_admitted']);
  assert.equal(h.shots.length, 1);
});

test('admitted directly but silent: audio fails as no_frames and nothing uploads', async () => {
  const meet = new ScriptedMeet({ join: async () => 'meet_join_result:in_call' });
  const h = harness(meet);
  await h.clock.until(runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', h.deps), 250);
  assert.deepEqual(table(h.reports).slice(3), ['join:pass:admitted_directly', 'admission:pass:admitted_directly', 'audio:fail:no_frames']);
  assert.equal(h.probes.length, 0);
});

test('a refused upload fails the audio stage, not the run', async () => {
  const meet = new ScriptedMeet({ join: async () => 'meet_join_result:in_call' });
  const h = harness(meet, { probe: async () => { throw new Error('diagnose_401'); } });
  const run = runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', h.deps);
  await h.clock.advance(250); meet.frame();
  await h.clock.until(run, 250);
  assert.equal(table(h.reports).at(-1), 'audio:fail:upload_failed');
});

test('no egress and no browser are their own stops', async () => {
  const down = harness(new ScriptedMeet({ join: async () => 'meet_join_result:in_call' }), { fetch: async () => { throw new TypeError('fetch failed'); } });
  await runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', down.deps);
  assert.deepEqual(table(down.reports).slice(1, 4), ['browser:pass:launched', 'egress:fail:host_unreachable', 'join:skipped:egress_failed']);
  assert.equal(down.reports[2].facts?.['meet.google.com'], 'unreachable');
  const noBrowser = harness(null, { launch: async () => { throw new Error('no chromium'); } });
  await runDiagnosis('google_meet', 'https://meet.google.com/abc-defg-hij', noBrowser.deps);
  assert.deepEqual(table(noBrowser.reports).slice(1, 4), ['browser:fail:launch_failed', 'egress:pass:hosts_reached', 'join:skipped:browser_failed']);
});

test('Zoom: container and egress to Zoom only; the join is the Worker’s to read', async () => {
  const hosts: string[] = [];
  const h = harness(null, { fetch: async (url) => { hosts.push(new URL(String(url)).hostname); return new Response(null, { status: 200 }); } });
  await runDiagnosis('zoom', 'https://zoom.us/j/123456789', h.deps);
  assert.deepEqual(hosts, ['zoom.us', 'api.zoom.us']);
  assert.deepEqual(table(h.reports), ['container:pass:command_received', 'browser:skipped:not_used_by_platform', 'egress:pass:hosts_reached',
    'join:skipped:zoom_joins_with_run_credentials', 'admission:skipped:zoom_joins_with_run_credentials', 'audio:skipped:zoom_joins_with_run_credentials']);
});

test('callbacks are signed with the run key to the diagnostic’s own paths', async () => {
  const sent: Array<{ path: string; raw: string; sig: string; ts: string }> = [];
  const KEY = 'k'.repeat(64), ID = '00000000-0000-4000-8000-0000000000aa';
  const cb = diagnoseCallbacks('https://app.axal.vc', ID, KEY, async (url, init) => {
    const h = new Headers(init!.headers);
    sent.push({ path: new URL(String(url)).pathname, raw: String(init!.body), sig: h.get('x-meeting-bot-signature')!, ts: h.get('x-meeting-bot-timestamp')! });
    return new Response('{}');
  }, () => 1_700_000_000_000);
  await cb.report({ stage: 'join', result: 'pass', code: 'asked_to_join' });
  await cb.probe(new Uint8Array([1, 2]));
  assert.deepEqual(sent.map((s) => s.path), [`/api/meeting-bots/diagnostics/${ID}/report`, `/api/meeting-bots/diagnostics/${ID}/probe`]);
  const expected = await signRequest(KEY, sent[0].path, sent[0].raw, 1_700_000_000_000);
  assert.equal(sent[0].sig, expected['x-meeting-bot-signature']);
  assert.equal(JSON.parse(sent[1].raw).wav, 'AQI=');
});

test('the runtime serves /diagnose only when given a diagnostic, signed, and never runs the bot for it', async () => {
  const SECRET = 'synthetic-runtime-only-secret-0123456789', UID = '00000000-0000-4000-8000-0000000000bb';
  let adapters = 0;
  const seen: string[] = [];
  const send = async (host: RuntimeHost, body: object, secret = SECRET) => {
    const raw = JSON.stringify(body);
    return host.fetch(new Request('http://runtime.internal/diagnose', { method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', ...await signRequest(secret, '/diagnose', raw, Date.now()) } }));
  };
  const bare = new RuntimeHost({ secret: SECRET, callbackOrigin: 'https://axal.vc', adapter: async () => { adapters += 1; return new FakeAdapter(); } });
  assert.equal((await send(bare, { uid: UID, platform: 'google_meet', meeting_url: 'https://meet.google.com/abc-defg-hij' })).status, 404);
  const host = new RuntimeHost({ secret: SECRET, callbackOrigin: 'https://axal.vc', adapter: async () => { adapters += 1; return new FakeAdapter(); },
    diagnose: async (platform, url, ctx) => { seen.push(`${platform}:${ctx.uid}:${url === 'https://meet.google.com/abc-defg-hij'}`); } });
  const body = { uid: UID, platform: 'google_meet', meeting_url: 'https://meet.google.com/abc-defg-hij' };
  assert.equal((await send(host, body, 'another-secret-another-secret-0123')).status, 401);
  assert.equal((await send(host, { ...body, platform: 'teams' })).status, 400);
  assert.equal((await send(host, body)).status, 202);
  await host.shutdown();
  assert.deepEqual(seen, [`google_meet:${UID}:true`]);
  assert.equal(adapters, 0);
});
