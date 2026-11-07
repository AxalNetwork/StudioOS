/**
 * #4857: the diagnostic's reports are cumulative snapshots, merged by (diagnosis, stage, event revision).
 * The real bot (`runDiagnosis`) is wired to the real Worker callback; only the network between them is injected. Synthetic only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { mig } from './_call_audio_fixture.ts';
import { runtimeKey } from '../src/services/meetingBotRuntime.ts';
import { startDiagnosis, readDiagnosis, DIAGNOSE_FIXES, DIAGNOSE_WINDOW_MS } from '../src/services/meetingBotDiagnose.ts';
import { Hono } from 'hono';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { signRequest } from '../../meeting-bot/src/callback.ts';
import { runDiagnosis, DIAGNOSE_STAGES, REPORT_TRIES, type DiagnoseSnapshot, type DiagnoseDeps } from '../../meeting-bot/src/diagnose.ts';
import { FakeClock } from '../../meeting-bot/test/_harness.ts';
import type { AudioFrame, MeetingAdapter } from '../../meeting-bot/src/types.ts';

const mounted = new Hono().route('/api/meeting-bots', callbacks);
const SECRET = randomBytes(32).toString('hex');
const ID = '00000000-0000-4000-8000-000000004857', MEET = 'https://meet.google.com/abc-defg-hij';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');

function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let n = 0, writes = 0;
  return {
    objects, writes: () => writes,
    async get(key: string) { const o = objects.get(key); return o ? { etag: o.etag, text: async () => new TextDecoder().decode(o.bytes), body: new Blob([o.bytes]).stream() } : null; },
    async put(key: string, value: string | Uint8Array, opts?: any) {
      const cur = objects.get(key);
      if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
      writes += 1;
      objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value, etag: `e${++n}` });
      return { key };
    },
  };
}
const container = { idFromName: (s: string) => s, get: () => ({ fetch: async (r: Request) => new URL(r.url).pathname === '/health'
  ? Response.json({ running: false, version: 'a1b2c3d4e5f6a7b8' }) : Response.json({ code: 'started' }, { status: 202 }) }) };
function world() {
  const fx = makeD1(['users', 'super_admins', 'google_oauth_tokens', 'integrations'].map((t) => tableFromBaseline(baseline, t)).join('\n'));
  fx.db.exec('PRAGMA foreign_keys=OFF');
  fx.db.exec(mig('531_meeting_bots.sql')); fx.db.exec(mig('532_meeting_bot_participants.sql')); fx.db.exec(mig('655_meeting_bot_failure_detail.sql'));
  fx.db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(1,?,?,?,1)').run('Synthetic', 'synthetic1@example.test', 'admin');
  const files = bucket();
  const env: any = { DB: fx.DB, JWT_SECRET: randomBytes(32).toString('hex'), ENVIRONMENT: 'development', FILES: files, MEETING_BOT_SECRET: SECRET,
    APP_URL: 'https://worker.example.test', MEETING_BOT_CONTAINER: container };
  return { ...fx, env, files };
}
async function call(env: any, id: string, kind: string, body: object, now = Date.now()) {
  const path = `/api/meeting-bots/diagnostics/${id}/${kind}`, raw = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', ...await signRequest(await runtimeKey(SECRET, id), path, raw, now) };
  return mounted.fetch(new Request('https://worker.example.test' + path, { method: 'POST', headers, body: raw }), env);
}
const rowOf = (d: any, stage: string) => d.rows.find((r: any) => r.stage === stage);
const ev = (stage: string, result: string, code: string, rev: number, extra: object = {}) => ({ stage, result, code, rev, at: Date.now(), attempts: 0, ...extra });
const snap = (revision: number, events: object[], id = ID) => ({ diagnosis_id: id, revision, events });

class Meet implements MeetingAdapter {
  readonly platform = 'google_meet' as const;
  joins = 0; step: string | null = null;
  private on: ((f: AudioFrame) => void) | null = null;
  async join() { this.joins += 1; this.step = 'meet_join_result:in_call'; }
  async admitted() {}
  async sendChat() {}
  audio(f: (a: AudioFrame) => void) { this.on = f; queueMicrotask(() => this.on?.({ samples: new Int16Array(1600).fill(900) })); return () => { this.on = null; }; }
  roster() { return () => {}; }
  speakers() { return () => {}; }
  ended() { return () => {}; }
  async leave() {}
  diagnostic() { return this.step; }
}
/** The real bot against the real Worker. `lose(snapshot)` decides, per send, whether the network drops it before or after the Worker. */
async function botRun(w: ReturnType<typeof world>, lose: (s: DiagnoseSnapshot, send: number) => 'before' | 'after' | null) {
  const meet = new Meet(), clock = new FakeClock();
  let sends = 0;
  const deps: DiagnoseDeps = { clock, diagnosisId: ID, fetch: async () => new Response(null, { status: 302 }), screenshot: async () => {}, probe: async () => {},
    launch: async () => ({ page: { screenshot: async () => new Uint8Array([137]), url: () => MEET }, meet, close: async () => {} }), audioMs: 5000,
    report: async (s) => {
      const fate = lose(s, sends += 1);
      if (fate === 'before') throw new Error('diagnose_503');
      const res = await call(w.env, ID, 'report', s);
      assert.equal(res.status, 200);
      if (fate === 'after') throw new Error('the answer was lost');
    } };
  const outcome = await clock.until(runDiagnosis('google_meet', MEET, deps), 250);
  return { meet, outcome, sends };
}
const table = (d: any) => d.rows.map((r: any) => `${r.stage}:${r.result}:${r.code}`);

test('every runtime stage: a report lost before the Worker, or whose answer was lost after it, never loses the stage', async () => {
  const clean = world();
  await startDiagnosis(clean.env, { id: 1 }, MEET, { id: ID });
  await botRun(clean, () => null);
  const expected = table((await readDiagnosis(clean.env, 1, ID))!);
  clean.db.close();
  for (const stage of DIAGNOSE_STAGES) for (const fate of ['before', 'after'] as const) {
    const w = world();
    try {
      await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
      // The first send that carries this stage finished fails once, then the network recovers.
      let hit = false;
      const { meet, outcome } = await botRun(w, (s) => { if (!hit && s.events.some((e) => e.stage === stage && e.result !== 'running')) { hit = true; return fate; } return null; });
      assert.ok(hit, stage);
      const d = (await readDiagnosis(w.env, 1, ID))!;
      assert.deepEqual(table(d), expected, `${stage} ${fate}`);
      assert.deepEqual(d.unrecorded, []);
      assert.equal(d.done, true);
      assert.equal(meet.joins, 1, 'the join was not run again');
      assert.deepEqual(outcome.undelivered, []);
      // Ran and delivered apart: a stage the Worker only got on a resend says it arrived late; one it stored before the answer was lost
      // arrived on time, and the resend (a duplicate) did not rewrite it. The diagnostic result is its own either way.
      assert.equal(rowOf(d, stage).delivery, fate === 'before' ? 'late' : 'ok', `${stage} ${fate}`);
      assert.equal(rowOf(d, stage).result, 'pass');
    } finally { w.db.close(); }
  }
});

test('a whole report budget lost after stage N: the next report carries stage N, in the order the Worker needs none', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    let lost = 0;
    await botRun(w, (s) => (s.events.some((e) => e.stage === 'join' && e.result !== 'running') && lost < REPORT_TRIES ? (lost += 1, 'before') : null));
    const d = (await readDiagnosis(w.env, 1, ID))!;
    assert.equal(rowOf(d, 'join').result, 'pass');
    assert.equal(rowOf(d, 'join').attempts, REPORT_TRIES);
  } finally { w.db.close(); }
});

test('the same snapshot twice is one write; an older one, or the same revision with other content, changes nothing', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    const first = snap(2, [ev('container', 'pass', 'command_received', 1), ev('browser', 'pass', 'launched', 2)]);
    assert.equal((await call(w.env, ID, 'report', first)).status, 200);
    const stored = () => new TextDecoder().decode(w.files.objects.get(`meeting-bot-diagnostics/${ID}.json`)!.bytes);
    const before = stored(), writes = w.files.writes();
    // Delivered again (a lost answer): acknowledged, not rewritten.
    assert.equal((await call(w.env, ID, 'report', first)).status, 200);
    assert.equal(stored(), before); assert.equal(w.files.writes(), writes);
    // The same event revision claiming another result: the first one stands.
    assert.equal((await call(w.env, ID, 'report', snap(2, [ev('browser', 'fail', 'launch_failed', 2)]))).status, 200);
    assert.equal(stored(), before);
    // Out of order: a later stage first, then the earlier snapshot, then a stale "running" for a finished stage.
    assert.equal((await call(w.env, ID, 'report', snap(5, [ev('container', 'pass', 'command_received', 1), ev('browser', 'pass', 'launched', 2), ev('egress', 'pass', 'hosts_reached', 3),
      ev('join', 'pass', 'asked_to_join', 4), ev('admission', 'pass', 'admitted', 5)]))).status, 200);
    assert.equal((await call(w.env, ID, 'report', snap(4, [ev('join', 'pass', 'asked_to_join', 4), ev('admission', 'running', 'waiting_for_admission', 4)]))).status, 200);
    assert.equal((await call(w.env, ID, 'report', first)).status, 200);
    const d = (await readDiagnosis(w.env, 1, ID))!;
    assert.deepEqual(['container', 'browser', 'egress', 'join', 'admission'].map((s) => rowOf(d, s).result), ['pass', 'pass', 'pass', 'pass', 'pass']);
    assert.equal(rowOf(d, 'admission').code, 'admitted');
    assert.equal(JSON.parse(stored()).revision, 5);
  } finally { w.db.close(); }
});

test('a later event revision replaces a stage’s earlier one, so running becomes its result', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    await call(w.env, ID, 'report', snap(1, [ev('admission', 'running', 'waiting_for_admission', 1)]));
    assert.equal(rowOf((await readDiagnosis(w.env, 1, ID))!, 'admission').result, 'running');
    await call(w.env, ID, 'report', snap(2, [ev('admission', 'fail', 'admission_timed_out', 2)]));
    assert.equal(rowOf((await readDiagnosis(w.env, 1, ID))!, 'admission').code, 'admission_timed_out');
  } finally { w.db.close(); }
});

test('a malformed snapshot is refused whole: another diagnosis’s id, a Worker stage, a repeat, a revision from the future, text in a fact', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    const good = ev('container', 'pass', 'command_received', 1);
    for (const bad of [
      snap(1, [good], '00000000-0000-4000-8000-000000000001'), snap(1, [ev('site', 'pass', 'x', 1)]), snap(2, [good, ev('container', 'fail', 'x', 2)]),
      snap(1, [ev('browser', 'pass', 'launched', 2)]), snap(0, [good]), snap(1, []), snap(1, [{ ...good, attempts: -1 }]), snap(1, [{ ...good, at: 'now' }]),
      snap(2, [good, ev('browser', 'pass', 'launched', 2, { facts: { page: 'You can’t join' } })]), { ...snap(1, [good]), diagnosis_id: undefined },
    ]) assert.equal((await call(w.env, ID, 'report', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    // None of it was applied, not even the good event beside the bad one.
    assert.equal(rowOf((await readDiagnosis(w.env, 1, ID))!, 'container').result, 'running');
  } finally { w.db.close(); }
});

test('a single-stage report from a container built before #4857 still lands, and never replaces a revised row', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    assert.equal((await call(w.env, ID, 'report', { stage: 'browser', result: 'pass', code: 'launched' })).status, 200);
    assert.equal(rowOf((await readDiagnosis(w.env, 1, ID))!, 'browser').code, 'launched');
    await call(w.env, ID, 'report', snap(3, [ev('browser', 'fail', 'launch_failed', 3)]));
    await call(w.env, ID, 'report', { stage: 'browser', result: 'pass', code: 'launched' });
    assert.equal(rowOf((await readDiagnosis(w.env, 1, ID))!, 'browser').code, 'launch_failed');
  } finally { w.db.close(); }
});

test('the console is told apart: a failed check is fail with its fix; a report that never came is Not recorded, never a pass', async () => {
  const w = world();
  try {
    const old = Date.now() - DIAGNOSE_WINDOW_MS - 1;
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID, now: old });
    // Past its window: the join failed and said so; the browser's report never arrived.
    const rec = JSON.parse(new TextDecoder().decode(w.files.objects.get(`meeting-bot-diagnostics/${ID}.json`)!.bytes));
    rec.rows.push({ stage: 'join', result: 'fail', code: 'signin_wall', at: old, rev: 4, ran_at: old, attempts: 2 });
    w.files.objects.set(`meeting-bot-diagnostics/${ID}.json`, { bytes: new TextEncoder().encode(JSON.stringify(rec)), etag: 'forced' });
    const d = (await readDiagnosis(w.env, 1, ID))!;
    const join = rowOf(d, 'join'), browser = rowOf(d, 'browser');
    assert.deepEqual([join.result, join.delivery, join.attempts, join.fix], ['fail', 'late', 2, DIAGNOSE_FIXES.signin_wall]);
    assert.deepEqual([browser.result, browser.delivery, browser.code], ['unrecorded', 'not_recorded', 'never_reported']);
    assert.equal(browser.fix, DIAGNOSE_FIXES.never_reported);
    assert.match(browser.fix, /not a failed check/);
    assert.deepEqual(d.unrecorded, ['container', 'browser', 'egress', 'admission', 'audio']);
    // The failed check is where it stops; an unrecorded report never is.
    assert.equal(d.stops_at, 'join');
    assert.ok(!d.rows.some((r: any) => r.result === 'pass' && r.delivery === 'not_recorded'));
    assert.equal(d.done, true);
  } finally { w.db.close(); }
});
