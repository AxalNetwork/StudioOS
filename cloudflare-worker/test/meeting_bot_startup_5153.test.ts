/**
 * D5153 (#5153): a meeting bot run's runtime startup keeps its failure boundary.
 * Synthetic container, runtime and database only; no provider or production call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { randomBytes } from 'node:crypto';
import { MeetingBotContainer } from '../../meeting-bot/worker/container.ts';
import { RuntimeHost } from '../../meeting-bot/src/runtime.ts';
import { meetingBotRuntime } from '../src/services/meetingBotRuntime.ts';
import {
  MeetingBotRuntimeError, readStartupReply, botFailureCategory, RUNTIME_ERROR_CODES, RUNTIME_ACTION, HOST_READY_MS, RUN_START_MS, TRANSPORT_START_MS,
} from '../src/services/meetingBotStartup.ts';
import { readRecentBotFailures, recentRunAction } from '../src/services/meetingBotOperationsRead.ts';
import { lastRunStage } from '../src/services/meetingBotDiagnose.ts';
import { botRow } from '../src/services/meetingBots.ts';
import { call, FOUNDER } from './_call_audio_fixture.ts';
import { world, syntheticLink, event } from './_meeting_bot_fixture.ts';
import { botView, INFRASTRUCTURE_FAILURE } from '../../frontend/src/pages/founder/meetingBotSession.js';
import { lifecycle, failureView } from '../../frontend/src/pages/founder/sessionLifecycle.js';
import type { Env } from '../src/types.ts';

const UID = '00000000-0000-4000-8000-000000005153';
const SECRET = randomBytes(32).toString('hex');
const VERSION = 'abcdef1234567';
const LINK = 'https://meet.google.com/abc-defg-hij';
const input = () => ({ uid: UID, platform: 'google_meet', meeting_url: LINK, limit_minutes: 30,
  deadline_at: Date.now() + 1_800_000, budget_deadline_at: Date.now() + 120_000, notice: 'Synthetic notice', venture_name: null });

type Host = typeof MeetingBotContainer;
/** A container DO with a controllable image, boot, port and process. */
function host(Class: Host = MeetingBotContainer) {
  const rows = new Map<string, any>(); let lock = Promise.resolve<any>(undefined); let exit!: () => void;
  let health: () => Promise<Response> = async () => Response.json({ ready: true, version: VERSION });
  let command: () => Promise<Response> = async () => Response.json({ accepted: true }, { status: 202 });
  let crash = false; let destroys = 0;
  const container = {
    running: false, images: { runtime: 'registry.cloudflare.com/synthetic/runtime@sha256:' + 'a'.repeat(64) } as Record<string, string | undefined>,
    start() { this.running = true; if (crash) throw new Error('SYNTHETIC_PRIVATE_BOOT_ERROR'); },
    async destroy() { destroys++; this.running = false; }, signal() {}, monitor: () => new Promise<void>((r) => { exit = () => { container.running = false; r(); }; }),
    async setInactivityTimeout() {},
    getTcpPort() { return { fetch: async (r: Request) => new URL(r.url).pathname === '/healthz' ? health() : command() }; },
  };
  const state = { container, waitUntil: () => {}, blockConcurrencyWhile: (f: any) => { const next = lock.then(f); lock = next.catch(() => {}); return next; },
    storage: { get: async (k: string) => structuredClone(rows.get(k)), put: async (k: string, v: any) => rows.set(k, structuredClone(v)), setAlarm: async () => {} } };
  const env = { APP_URL: 'https://worker.example.test', MEETING_BOT_SECRET: SECRET, MEETING_BOT_VERSION: VERSION } as Env;
  const object = new Class(state as any, env);
  return {
    container, rows, env, get destroys() { return destroys; },
    crash() { crash = true; }, exit: () => exit(),
    health(fn: () => Promise<Response>) { health = fn; }, command(fn: () => Promise<Response>) { command = fn; },
    start: async (body: any = input()) => { const r = await object.fetch(new Request('https://container.internal/start', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, body: await r.json() as any }; },
  };
}
/** Runs `fn` with a clock that jumps, so a 40 s readiness budget passes in a few loops. */
async function fastClock<T>(fn: () => Promise<T>, step = 5_000): Promise<T> {
  const real = Date.now; let now = real(); Date.now = () => (now += step);
  try { return await fn(); } finally { Date.now = real; }
}

// ── 1. the container host answers each boundary with its own code ──

const hostCases: Record<string, (Class: Host) => Promise<void>> = {
  async 'a missing image is image_unavailable at image_resolved'(Class) {
    const h = host(Class); h.container.images.runtime = undefined;
    assert.deepEqual((await h.start()).body, { ok: false, code: 'image_unavailable', stage: 'image_resolved', runtime_version: VERSION });
  },
  async 'a boot that throws is container_start_failed, and the container is destroyed'(Class) {
    const h = host(Class); h.crash();
    const r = await h.start();
    assert.deepEqual([r.status, r.body.code, r.body.stage], [503, 'container_start_failed', 'container_starting']);
    assert.equal(h.destroys, 1); assert.equal(JSON.stringify(r.body).includes('SYNTHETIC_PRIVATE'), false);
  },
  async 'a port that never answers is runtime_no_answer at runtime_port_waiting'(Class) {
    const h = host(Class); h.health(async () => { throw new Error('connection refused'); });
    const r = await fastClock(() => h.start());
    assert.deepEqual([r.status, r.body.code, r.body.stage], [503, 'runtime_no_answer', 'runtime_port_waiting']); assert.equal(h.destroys, 1);
  },
  async 'a process that exits while booting is runtime_process_exited'(Class) {
    const h = host(Class); h.health(async () => { h.exit(); throw new Error('connection refused'); });
    const r = await fastClock(() => h.start());
    assert.deepEqual([r.body.code, r.body.stage], ['runtime_process_exited', 'runtime_port_waiting']);
  },
  async 'a runtime that answers but is not ready is runtime_health_failed'(Class) {
    const h = host(Class); h.health(async () => Response.json({ ready: false }));
    assert.deepEqual([(await h.start()).body.code, (await host(Class).start()).body.code], ['runtime_health_failed', 'started']);
    const sick = host(Class); sick.health(async () => Response.json({ code: 'broken' }, { status: 500 }));
    const r = await fastClock(() => sick.start());
    assert.deepEqual([r.body.code, r.body.stage], ['runtime_health_failed', 'runtime_health_ready']);
  },
  async 'a runtime on a different build is runtime_health_failed; an older image that reports none still starts'(Class) {
    const h = host(Class); h.health(async () => Response.json({ ready: true, version: 'fedcba7654321' }));
    assert.equal((await h.start()).body.code, 'runtime_health_failed');
    const old = host(Class); old.health(async () => Response.json({ ready: true }));
    assert.equal((await old.start()).status, 202);
  },
  async 'a refused signed command is runtime_refused at runtime_command_accepted'(Class) {
    const h = host(Class); h.command(async () => Response.json({ code: 'invalid_signature' }, { status: 401 }));
    const r = await h.start();
    assert.deepEqual([r.status, r.body.code, r.body.stage], [503, 'runtime_refused', 'runtime_command_accepted']); assert.equal(h.destroys, 1);
  },
  async 'a healthy runtime that never answers the command is runtime_command_timeout'(Class) {
    const h = host(Class); h.command(async () => { throw new Error('cold'); });
    const r = await fastClock(() => h.start(), 3_000);
    assert.deepEqual([r.body.code, r.body.stage], ['runtime_command_timeout', 'runtime_command_accepted']);
  },
  async 'an accepted command answers ok with the stage, the version and the time it took'(Class) {
    const h = host(Class); const r = await h.start();
    assert.equal(r.status, 202);
    assert.deepEqual([r.body.ok, r.body.code, r.body.stage, r.body.runtime_version], [true, 'started', 'runtime_command_accepted', VERSION]);
    assert.ok(Number.isSafeInteger(r.body.start_ms) && r.body.start_ms >= 0); assert.equal(h.rows.get('lease').started, true);
  },
};
for (const [name, scenario] of Object.entries(hostCases)) test('D5153 host: ' + name, () => scenario(MeetingBotContainer));

// Mutation check: the mappings that tell no-answer, refused and boot failure apart.
const source = readFileSync(new URL('../../meeting-bot/worker/container.ts', import.meta.url), 'utf8');
const mutants: [string, string][] = [
  ["message==='command_refused' ? {code:'runtime_refused'", "message==='never' ? {code:'runtime_refused'"],
  ["{code:'runtime_no_answer',stage:'runtime_port_waiting'}", "{code:'runtime_health_failed',stage:'runtime_health_ready'}"],
  ["return failed({code:'container_start_failed',stage:'container_starting'})", "return failed({code:'runtime_no_answer',stage:'runtime_port_waiting'})"],
  ["monitor().then(()=>{ this.exited=true; }", "monitor().then(()=>{ this.exited=false; }"],
  ["return expected && reported && reported!==expected ?", "return false ?"],
];
const containerUrl = new URL('../../meeting-bot/worker/container.ts', import.meta.url);
for (const [index, [before, after]] of mutants.entries()) test(`D5153 host mutation ${index} is caught`, async () => {
  assert.ok(source.includes(before), `mutant ${index} no longer matches the source`);
  const js = stripTypeScriptTypes(source.replace(before, after), { mode: 'strip' }).replace(/from '(\.[^']+)'/g, (_m, s) => `from '${new URL(s + '.ts', containerUrl).href}'`);
  const { MeetingBotContainer: Mutant } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  let caught = false;
  for (const scenario of Object.values(hostCases)) { try { await scenario(Mutant); } catch { caught = true; break; } }
  assert.equal(caught, true);
});

test('D5153 host: startup log lines carry codes and stages only, never the meeting link or the secret', async () => {
  const lines: string[] = []; const real = console.log; console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try { const h = host(); h.command(async () => Response.json({}, { status: 401 })); await h.start(); await host().start(); }
  finally { console.log = real; }
  const stages = lines.map((l) => JSON.parse(l)).filter((l) => l.event === 'meeting_bot.runtime_stage');
  assert.ok(stages.length >= 8);
  for (const line of stages) assert.deepEqual(Object.keys(line).sort(), ['elapsed_ms', 'error_code', 'event', 'platform', 'result', 'run_uid', 'runtime_version', 'stage']);
  assert.deepEqual(stages.filter((l) => l.result === 'fail').map((l) => l.error_code), ['runtime_refused']);
  for (const l of lines) { assert.equal(l.includes('meet.google.com'), false); assert.equal(l.includes(SECRET), false); assert.equal(l.includes('Synthetic notice'), false); }
});

test('D5153 runtime: /healthz reports its build only when it is a commit id', async () => {
  const make = (version?: string) => new RuntimeHost({ secret: SECRET, callbackOrigin: 'https://worker.example.test', adapter: async () => { throw new Error('unused'); }, version });
  assert.equal((await (await make(VERSION).fetch(new Request('http://runtime.internal/healthz'))).json() as any).version, VERSION);
  assert.equal((await (await make('not a version').fetch(new Request('http://runtime.internal/healthz'))).json() as any).version, null);
});

// ── 2. the site Worker's transport keeps the code, and reads an older host safely ──

test('D5153 transport: no binding is binding_missing; a host reply keeps its code and stage; an older reply stays generic', async () => {
  assert.throws(() => meetingBotRuntime({} as Env), (e: any) => e instanceof MeetingBotRuntimeError && e.code === 'binding_missing' && e.stage === 'container_binding_resolved');
  const through = (status: number, body: unknown) => meetingBotRuntime({ MEETING_BOT_CONTAINER: { idFromName: () => UID, get: () => ({ fetch: async () => Response.json(body, { status }) }) } } as unknown as Env);
  assert.deepEqual(await through(202, { ok: true, code: 'started', stage: 'runtime_command_accepted', runtime_version: VERSION }).start(input() as any), { stage: 'runtime_command_accepted', runtime_version: VERSION });
  await assert.rejects(() => through(503, { ok: false, code: 'runtime_no_answer', stage: 'runtime_port_waiting', runtime_version: VERSION }).start(input() as any),
    (e: any) => e instanceof MeetingBotRuntimeError && e.code === 'runtime_no_answer' && e.stage === 'runtime_port_waiting' && e.runtimeVersion === VERSION);
  // An older host: its `{code}` alone. Known codes keep their meaning; anything else is the plain generic failure.
  await assert.rejects(() => through(503, { code: 'image_unavailable' }).start(input() as any), (e: any) => e.code === 'image_unavailable' && e.stage === 'image_resolved');
  await assert.rejects(() => through(503, { code: 'container_unavailable' }).start(input() as any), (e: any) => e.code === 'container_start_failed');
  await assert.rejects(() => through(503, { code: 'runtime_unavailable' }).start(input() as any), (e: any) => !(e instanceof MeetingBotRuntimeError) && e.message === 'runtime_unavailable');
  await assert.rejects(() => through(503, { code: 'SYNTHETIC provider sentence https://example.invalid' }).start(input() as any), (e: any) => e.message === 'runtime_unavailable');
  assert.deepEqual(await through(200, { code: 'already_started' }).start(input() as any), { stage: 'runtime_command_accepted', runtime_version: null });
  // A host that never answers inside the transport budget: the run waited on the runtime.
  const silent = meetingBotRuntime({ MEETING_BOT_CONTAINER: { idFromName: () => UID, get: () => ({ fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } }) } } as unknown as Env);
  await assert.rejects(() => silent.start(input() as any), (e: any) => e.code === 'runtime_command_timeout');
});

test('D5153 transport: the budgets nest, outermost last, and give a cold image longer than the 20 s that failed session 54', () => {
  assert.ok(HOST_READY_MS > 20_000);
  assert.ok(TRANSPORT_START_MS > HOST_READY_MS); assert.ok(RUN_START_MS > TRANSPORT_START_MS);
  assert.equal(readStartupReply(503, { code: 'not_a_code', stage: 'not_a_stage' }), null);
  for (const code of RUNTIME_ERROR_CODES) { assert.ok(RUNTIME_ACTION[code].length > 20); assert.equal((readStartupReply(503, { code }) as MeetingBotRuntimeError).code, code); }
});

// ── 3. the run records the startup and only then joins ──

async function run(start: (r: any, w: any) => Promise<unknown>) {
  const w = world();
  w.env.MEETING_BOT_RUNTIME = { start: (r: any) => start(r, w) as any, async stop() {} };
  const r = await call(w.env, FOUNDER, 'POST', `/sessions/${w.session}/bot`, { meeting_url: syntheticLink('google_meet') });
  assert.equal(r.status, 202);
  return { w, uid: r.body.bot.uid as string, body: r.body };
}
const facts = (w: any, uid: string) => w.db.prepare('SELECT status, failure_code, minutes, runtime_stage, runtime_error_code, runtime_version, runtime_start_ms, runtime_callback_seen_at FROM meeting_bots WHERE uid = ?').get(uid);

test('D5153 run: a startup failure keeps its exact code and stage, never joins, and releases the held minutes', async () => {
  const seen: string[] = [];
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  let w: any, uid: string;
  try {
    ({ w, uid } = await run(async (r, world) => {
      seen.push((await botRow(world.env, r.uid))!.status);
      skew += 45_000; // the startup waited 45 s before it failed
      throw new MeetingBotRuntimeError('runtime_no_answer', 'runtime_port_waiting', VERSION);
    }));
  } finally { Date.now = realNow; }
  assert.deepEqual(seen, ['queued'], 'the run is not joining while its runtime starts');
  const row = facts(w, uid);
  assert.deepEqual([row.status, row.failure_code, row.runtime_stage, row.runtime_error_code, row.runtime_version], ['failed', 'runtime_unavailable', 'runtime_port_waiting', 'runtime_no_answer', VERSION]);
  assert.equal(row.minutes, 0, 'nothing reached the provider, so no minute is billed');
  assert.ok(row.runtime_start_ms >= 45_000); assert.equal(row.runtime_callback_seen_at, null);
  const read = await call(w.env, FOUNDER, 'GET', `/sessions/${w.session}/bot`);
  assert.equal(read.body.bot.failure_category, 'infrastructure');
  // Operator facts stay operator facts: the founder's read carries no startup code, stage or version.
  for (const key of ['runtime_error_code', 'runtime_stage', 'runtime_version']) assert.equal(key in read.body.bot, false);
});

test('D5153 run: an older host or a timeout still fails cleanly, as runtime_unavailable with no startup code', async () => {
  const { w, uid } = await run(async () => { throw new Error('runtime_unavailable'); });
  const row = facts(w, uid);
  assert.deepEqual([row.status, row.failure_code, row.runtime_stage, row.runtime_error_code], ['failed', 'runtime_unavailable', 'dispatch_accepted', null]);
});

test('D5153 run: an accepted start records the stage and version, then joins; the first callback is recorded once and ends the infrastructure category', async () => {
  const { w, uid, body } = await run(async () => ({ stage: 'runtime_command_accepted', runtime_version: VERSION }));
  assert.equal(body.bot.status, 'joining');
  let row = facts(w, uid);
  assert.deepEqual([row.runtime_stage, row.runtime_error_code, row.runtime_version, row.runtime_callback_seen_at], ['runtime_command_accepted', null, VERSION, null]);
  assert.equal((await event(w, uid, { seq: 1, type: 'heartbeat' })).status, 200);
  const first = facts(w, uid).runtime_callback_seen_at; assert.ok(first > 0);
  assert.equal((await event(w, uid, { seq: 2, type: 'heartbeat' })).status, 200);
  assert.equal(facts(w, uid).runtime_callback_seen_at, first, 'recorded once');
  assert.equal((await event(w, uid, { seq: 3, type: 'status', status: 'failed', failure_code: 'runtime_failed', failure_detail: 'platform_blocked@meet_prejoin_result:unknown' })).status, 200);
  row = facts(w, uid); assert.equal(row.status, 'failed');
  const read = await call(w.env, FOUNDER, 'GET', `/sessions/${w.session}/bot`);
  assert.equal(read.body.bot.failure_category, null, 'the provider was reached: provider guidance applies');
  assert.equal(read.body.bot.failure_detail, 'platform_blocked@meet_prejoin_result:unknown', 'a provider failure keeps its detail');
});

test('D5153 run: a heartbeat timeout with no callback is the infrastructure category; a row before the migration has none', () => {
  assert.equal(botFailureCategory({ status: 'failed', failure_code: 'heartbeat_timeout', runtime_callback_seen_at: null }), 'infrastructure');
  assert.equal(botFailureCategory({ status: 'failed', failure_code: 'admission_refused', runtime_callback_seen_at: null }), null);
  assert.equal(botFailureCategory({ status: 'failed', failure_code: 'runtime_unavailable' }), null);
  assert.equal(botFailureCategory({ status: 'stopped', failure_code: 'runtime_unavailable', runtime_callback_seen_at: null }), null);
});

// ── 4. HQ reads the failed runs without the Cloudflare console ──

test('D5153 HQ: recent failed runs carry stage, codes, version, timing and a next step, never meeting content', async () => {
  const { w, uid } = await run(async () => { throw new MeetingBotRuntimeError('runtime_no_answer', 'runtime_port_waiting', VERSION); });
  const recent = await readRecentBotFailures(w.env);
  assert.equal(recent.state, 'ok'); assert.equal(recent.runs.length, 1);
  const r = recent.runs[0];
  assert.deepEqual([r.uid, r.platform, r.status, r.failure_code, r.runtime_stage, r.runtime_error_code, r.runtime_version, r.callback_received],
    [uid, 'google_meet', 'failed', 'runtime_unavailable', 'runtime_port_waiting', 'runtime_no_answer', VERSION, false]);
  assert.equal(r.action, RUNTIME_ACTION.runtime_no_answer);
  const text = JSON.stringify(recent);
  for (const forbidden of ['meet.google.com', 'meeting_url', 'participants', 'v1.', 'user_id']) assert.equal(text.includes(forbidden), false, forbidden);
  const route = await call(w.env, FOUNDER, 'GET', '/admin/platform/meeting-bots');
  assert.notEqual(route.status, 200, 'Super Admin only');
});

test('D5153 HQ: a database before the migration still lists failed runs, with startup facts not recorded', async () => {
  const w = world();
  w.db.exec('ALTER TABLE meeting_bots DROP COLUMN runtime_callback_seen_at');
  w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,session_id,project_id,platform,meeting_url_enc,status,failure_code,failure_detail,limit_minutes,
    cost_per_minute_microusd,rate_per_minute_microusd,scheduled_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(UID, FOUNDER, w.session, 10, 'google_meet', '', 'failed', 'runtime_unavailable', null, 30, 1, 1, Date.now(), Date.now());
  const recent = await readRecentBotFailures(w.env);
  assert.equal(recent.state, 'ok');
  assert.deepEqual([recent.runs[0].callback_received, recent.runs[0].runtime_error_code], [null, null]);
  assert.match(recent.runs[0].action, /predates D5153/);
  assert.match(recentRunAction({ runtime_error_code: null, callback_received: true, failure_code: 'runtime_failed', failure_detail: 'platform_blocked@meet_prejoin' }), /reached the meeting provider/);
});

test('D5153 HQ: the staged diagnostic’s last-run row says where startup stopped', async () => {
  const { w } = await run(async () => { throw new MeetingBotRuntimeError('runtime_refused', 'runtime_command_accepted', VERSION); });
  const row = await lastRunStage(w.env, FOUNDER, 'google_meet', Date.now());
  assert.deepEqual([row.result, row.facts!.runtime_error_code, row.facts!.runtime_stage, row.facts!.runtime_callback], ['fail', 'runtime_refused', 'runtime_command_accepted', 'never']);
});

// ── 5. the member is not told to check the link for a run that never reached the provider ──

test('D5153 copy: an infrastructure failure names the service, not the meeting, and lists no provider cause', () => {
  const failed = { status: 'failed', failure_code: 'runtime_unavailable', failure_category: 'infrastructure', started_at: null, participant_count: null };
  const view = botView({ bot: failed });
  assert.equal(view.failure, INFRASTRUCTURE_FAILURE); assert.equal(view.infrastructure, true);
  const stepped = lifecycle({ bot: failed });
  const failure = failureView(stepped, { botFailure: view.failure })!;
  assert.equal(failure.title, INFRASTRUCTURE_FAILURE);
  assert.ok(failure.causes.length > 0);
  for (const cause of failure.causes) assert.doesNotMatch(cause, /link|platform|outside participants|host|lobby/i);
  // The same code after the runtime reported keeps the provider guidance.
  const provider = { ...failed, failure_category: null };
  assert.deepEqual(failureView(lifecycle({ bot: provider }), { botFailure: botView({ bot: provider }).failure })!.causes,
    ['The meeting link changed or expired', 'The platform blocks outside participants']);
});
