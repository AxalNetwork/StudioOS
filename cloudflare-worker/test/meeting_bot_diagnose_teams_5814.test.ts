/**
 * D5814 (#5814): the owner's diagnostic on a Teams link, end to end in memory:
 * the HQ route → the Worker's start → the bot host's Durable Object → the
 * runtime image's signed `/diagnose` → the Teams adapter on the recorded-screen
 * fixture → the signed callbacks → the HQ read. Synthetic only: no Teams
 * meeting, no deployed container, no production resource.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { mig } from './_call_audio_fixture.ts';
import { runtimeKey } from '../src/services/meetingBotRuntime.ts';
import { startDiagnosis, readDiagnosis, readDiagnosisScreenshot, teamsStage, view, DIAGNOSE_FIXES, DIAGNOSE_STAGES } from '../src/services/meetingBotDiagnose.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import platform from '../src/routes/admin_platform.ts';
import { MeetingBotContainer } from '../../meeting-bot/worker/container.ts';
import { RuntimeHost } from '../../meeting-bot/src/runtime.ts';
import { signRequest } from '../../meeting-bot/src/callback.ts';
import { diagnoseCallbacks, runDiagnosis, teamsJoinStop } from '../../meeting-bot/src/diagnose.ts';
import { TeamsAdapter } from '../../meeting-bot/src/adapters/teams.ts';
import { realClock } from '../../meeting-bot/src/lifecycle.ts';
import { AdapterFailure } from '../../meeting-bot/src/types.ts';
import { FakeTeamsPage } from '../../meeting-bot/test/_teamsPage.ts';
import type { ScreenName } from '../../meeting-bot/test/fixtures/teamsScreens.ts';

const mounted = new Hono().route('/api/meeting-bots', callbacks);
const SECRET = randomBytes(32).toString('hex'), JWT_SECRET = randomBytes(32).toString('hex');
const ORIGIN = 'https://worker.example.test';
const WORK = 'https://teams.microsoft.com/meet/synthetic5814?p=Synthetic1', PERSONAL = 'https://teams.live.com/meet/synthetic5814';
const NOTICE = 'Synthetic recording notice for the diagnostic. [5814]';
const VERSION = 'a1b2c3d4e5f6';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
let nextId = 0;
const freshId = () => `00000000-0000-4000-8000-${(0x5814_0000 + (nextId += 1)).toString(16).padStart(12, '0')}`;

function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let n = 0;
  return {
    objects,
    async get(key: string) { const o = objects.get(key); return o ? { etag: o.etag, text: async () => new TextDecoder().decode(o.bytes), body: new Blob([o.bytes]).stream() } : null; },
    async put(key: string, value: string | Uint8Array, opts?: any) {
      const cur = objects.get(key);
      if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
      objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value, etag: `e${++n}` });
      return { key };
    },
  };
}

/** How Teams behaves in one check: the screen it opens on, where Join now lands, and what happens after (ms after the page opens). */
interface Teams { first?: ScreenName; afterJoin?: ScreenName; moves?: ReadonlyArray<readonly [number, ScreenName]>; speak?: boolean; noBrowser?: boolean }

/**
 * The bot host as deployed: the real `MeetingBotContainer` Durable Object, whose container is the real
 * `RuntimeHost` (booted with the env the Durable Object passes it), whose `/diagnose` runs the real
 * `runDiagnosis` with the Teams adapter on the fixture page and posts the signed callbacks to the Worker.
 * Only the browser is the fixture: the packaged browser is `meeting-bot/test/diagnose_teams.test.ts`.
 */
function botHost(worker: { env: any }, teams: Teams, done: Promise<void>[]) {
  const objects = new Map<string, MeetingBotContainer>();
  const instance = (name: string) => {
    let runtime: RuntimeHost | null = null;
    const rows = new Map<string, any>();
    let lock = Promise.resolve<any>(undefined);
    const container: any = {
      running: false, images: { runtime: 'registry.cloudflare.com/synthetic/runtime@sha256:' + 'a'.repeat(64) },
      start(opts: { env: Record<string, string> }) {
        this.running = true;
        runtime = new RuntimeHost({ secret: opts.env.MEETING_BOT_SECRET, callbackOrigin: opts.env.MEETING_BOT_CALLBACK_ORIGIN, version: opts.env.MEETING_BOT_VERSION,
          adapter: async () => { throw new Error('a diagnostic never starts a run'); },
          diagnose: (p, url, ctx) => { const run = teamsCheck(worker, teams, p, url, ctx); done.push(run); return run; } });
      },
      async destroy() { this.running = false; }, monitor: () => new Promise(() => {}), async setInactivityTimeout() {},
      getTcpPort: () => ({ fetch: (r: Request) => runtime!.fetch(r) }),
    };
    const state: any = { container, waitUntil: () => {}, blockConcurrencyWhile: (f: any) => { const next = lock.then(f); lock = next.catch(() => {}); return next; },
      storage: { get: async (k: string) => structuredClone(rows.get(k)), put: async (k: string, v: any) => { rows.set(k, structuredClone(v)); }, setAlarm: async () => {} } };
    return new MeetingBotContainer(state, { APP_URL: ORIGIN, MEETING_BOT_SECRET: SECRET, MEETING_BOT_VERSION: VERSION } as any);
  };
  return { idFromName: (s: string) => s, get: (name: string) => { if (!objects.has(name)) objects.set(name, instance(name)); return objects.get(name)!; } };
}

/** What the image's `/diagnose` runs for Teams (`runtimeDiagnose`), with the fixture page in place of Chromium. */
async function teamsCheck(worker: { env: any }, teams: Teams, p: any, url: string, ctx: { uid: string; secret: string; callbackOrigin: string; stop: AbortSignal }) {
  const page = new FakeTeamsPage(teams.first ?? 'launcher');
  page.afterJoin = teams.afterJoin ?? 'lobby';
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  for (const [at, screen] of teams.moves ?? []) timers.push(setTimeout(() => page.show(screen), at)); // clock-ok: relative
  if (teams.speak) timers.push(setInterval(() => page.say(new Float32Array(4800).fill(0.25), 48000), 50)); // clock-ok: relative
  const toWorker: typeof fetch = async (input, init) => mounted.fetch(new Request(String(input), init), worker.env);
  try {
    await runDiagnosis(p, url, {
      ...diagnoseCallbacks(ctx.callbackOrigin, ctx.uid, ctx.secret, toWorker), diagnosisId: ctx.uid, clock: realClock, stop: ctx.stop,
      fetch: async () => new Response(null, { status: 302 }), admitMs: 1500, audioMs: 800, notice: () => NOTICE,
      launch: async () => {
        if (teams.noBrowser) throw Object.assign(new Error('synthetic'), { name: 'TimeoutError' });
        return { page: { screenshot: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), url: () => 'https://teams.microsoft.com/' },
          meet: new TeamsAdapter(page, { clock: realClock, pollMs: 25, joinTimeoutMs: 1500 }), close: async () => {} };
      },
    });
  } finally { for (const t of timers) clearInterval(t); }
}

function world(teams: Teams = {}, extra: Record<string, unknown> = {}) {
  const fx = makeD1(['users', 'super_admins', 'google_oauth_tokens', 'integrations', 'user_sessions', 'admin_audit_log', 'activity_logs']
    .map((t) => tableFromBaseline(baseline, t)).join('\n'));
  fx.db.exec('PRAGMA foreign_keys=OFF');
  fx.db.exec(mig('531_meeting_bots.sql')); fx.db.exec(mig('532_meeting_bot_participants.sql')); fx.db.exec(mig('655_meeting_bot_failure_detail.sql'));
  for (const [id, role] of [[1, 'admin'], [2, 'admin'], [3, 'admin'], [4, 'founder']] as const)
    fx.db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,?,1)').run(id, 'Synthetic', `synthetic${id}@example.test`, role);
  for (const id of [1, 3]) fx.db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(id);
  fx.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'synthetic-totp','totp',datetime('now'))").run();
  const files = bucket(), done: Promise<void>[] = [];
  const w: any = { ...fx, files, done };
  w.env = { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development', FILES: files, MEETING_BOT_SECRET: SECRET, APP_URL: ORIGIN, MEETING_BOT_TEAMS: 'off', ...extra };
  if (!('MEETING_BOT_CONTAINER' in extra)) w.env.MEETING_BOT_CONTAINER = botHost(w, teams, done);
  return w as typeof fx & { env: any; files: ReturnType<typeof bucket>; done: Promise<void>[] };
}
const token = async (id: number, jti?: string) => 'Bearer ' + await new SignJWT({ user_id: id, role: id === 4 ? 'founder' : 'admin', ...(jti ? { jti } : {}) })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const hq = (env: any, auth: string | null, path: string, method = 'GET', body?: object) => platform.fetch(new Request('https://example.test' + path, {
  method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);

/** Start through the HQ route as the Super Admin, let the image finish, and read the result through the HQ route. */
async function diagnose(w: ReturnType<typeof world>, link = WORK) {
  const started = await hq(w.env, await token(1, 'synthetic-totp'), '/meeting-bots/diagnose', 'POST', { meeting_url: link });
  assert.equal(started.status, 202);
  const { diagnosis } = await started.json() as any;
  await Promise.all(w.done);
  const read = await hq(w.env, await token(1), `/meeting-bots/diagnose/${diagnosis.id}`);
  assert.equal(read.status, 200);
  return (await read.json() as any).diagnosis;
}
const rowOf = (d: any, stage: string) => d.rows.find((r: any) => r.stage === stage);
const table = (d: any) => d.rows.filter((r: any) => !['site', 'config', 'last_run'].includes(r.stage)).map((r: any) => `${r.stage}:${r.result}:${r.code}`);
/** What tells two outcomes apart on the console: where it stops and that row's code. */
const answer = (d: any) => (d.stops_at ? `${d.stops_at}:${rowOf(d, d.stops_at).code}` : 'none');

test('a successful canary, API → bot host → runtime → callbacks → HQ: every Teams stage passes, in order', async () => {
  const w = world({ moves: [[300, 'in_call']], speak: true });
  try {
    const d = await diagnose(w);
    assert.equal(d.platform, 'teams');
    assert.equal(d.done, true);
    assert.equal(d.stops_at, null);
    assert.deepEqual(d.rows.map((r: any) => r.stage), [...DIAGNOSE_STAGES]);
    assert.deepEqual(table(d), ['container:pass:command_received', 'browser:pass:launched', 'egress:pass:hosts_reached', 'join:pass:asked_to_join',
      'admission:pass:admitted', 'notice:pass:notice_posted', 'audio:pass:chunk_uploaded']);
    // The private binding answered with its build; the Teams row says the switch and the link's kind.
    assert.deepEqual([rowOf(d, 'site').result, rowOf(d, 'site').facts.version], ['pass', VERSION]);
    assert.deepEqual(rowOf(d, 'config').facts, { teams_switch: 'off', link_kind: 'work', link_host: 'teams.microsoft.com' });
    assert.deepEqual(rowOf(d, 'egress').facts, { 'teams.microsoft.com': 302, 'teams.cloud.microsoft': 302, 'teams.live.com': 302 });
    assert.deepEqual(rowOf(d, 'join').facts, { link_kind: 'work' });
    assert.ok(rowOf(d, 'audio').facts.frames > 0);
    assert.ok(d.probe_bytes > 44);
    // Each container stage says when it ran, in whole seconds; nothing reads as late.
    for (const stage of ['container', 'join', 'notice', 'audio']) assert.ok(Number.isInteger(rowOf(d, stage).elapsed_s), stage);
    assert.ok(d.rows.every((r: any) => r.delivery === 'ok'));
  } finally { w.db.close(); }
});

test('the public result holds stages, codes, counts, elapsed seconds and the build only; the link and the notice are never stored', async () => {
  const w = world({ moves: [[300, 'in_call']], speak: true });
  try {
    const d = await diagnose(w);
    const allowedRow = new Set(['stage', 'result', 'code', 'facts', 'fix', 'delivery', 'attempts', 'elapsed_s']);
    for (const r of d.rows) {
      for (const k of Object.keys(r)) assert.ok(allowedRow.has(k), `${r.stage}.${k}`);
      for (const [k, v] of Object.entries(r.facts)) assert.ok(typeof v === 'number' || typeof v === 'boolean' || /^[a-z0-9_:@.]{1,80}$/.test(String(v)), `${r.stage}.${k}=${v}`);
    }
    const stored = [...w.files.objects.values()].map((o) => new TextDecoder().decode(o.bytes)).join('\n');
    for (const secret of ['synthetic5814', 'Synthetic1', 'Synthetic recording notice', '/meet/', 'Eadwyn']) assert.equal(stored.includes(secret), false, secret);
    assert.equal(JSON.stringify(d).includes('synthetic5814'), false);
  } finally { w.db.close(); }
});

test('a personal (Teams free) link is read as personal by the Worker and by the bot', async () => {
  const w = world({ moves: [[300, 'in_call']], speak: true });
  try {
    const d = await diagnose(w, PERSONAL);
    assert.deepEqual([rowOf(d, 'config').facts.link_kind, rowOf(d, 'config').facts.link_host, rowOf(d, 'join').facts.link_kind], ['personal', 'teams.live.com', 'personal']);
  } finally { w.db.close(); }
});

test('denied, lobby timeout, no audio, a notice that fails, a successful canary and startup failures each read differently in HQ', async () => {
  const outcomes: Record<string, string> = {};
  const cases: Array<[string, Teams, Record<string, unknown>?]> = [
    ['denied', { moves: [[300, 'denied']] }],
    ['lobby_timeout', {}],
    ['no_audio', { afterJoin: 'in_call' }],
    ['canary', { moves: [[300, 'in_call']], speak: true }],
    ['captcha', { first: 'captcha' }],
    ['browser_startup', { noBrowser: true }],
    // Provider-independent: the Worker's own boundary, before any Teams host is read.
    ['no_private_binding', {}, { MEETING_BOT_CONTAINER: undefined }],
  ];
  for (const [name, teams, extra] of cases) {
    const w = world(teams, extra);
    try {
      const d = await diagnose(w);
      outcomes[name] = answer(d);
      if (name === 'denied') assert.deepEqual([rowOf(d, 'notice').code, rowOf(d, 'audio').code, rowOf(d, 'admission').facts.step], ['not_admitted', 'not_admitted', 'teams_denied']);
      if (name === 'no_audio') assert.equal(d.probe_bytes, null);
      if (name === 'no_private_binding') assert.ok(['container', 'browser', 'egress', 'join', 'admission', 'notice', 'audio'].every((s) => rowOf(d, s).code === 'site_failed'));
      if (d.stops_at) assert.equal(rowOf(d, d.stops_at).fix, DIAGNOSE_FIXES[rowOf(d, d.stops_at).code], name);
    } finally { w.db.close(); }
  }
  assert.deepEqual(outcomes, {
    denied: 'admission:not_admitted', lobby_timeout: 'admission:admission_timed_out', no_audio: 'audio:no_frames', canary: 'none',
    captcha: 'join:teams_captcha', browser_startup: 'browser:launch_failed', no_private_binding: 'site:binding_missing',
  });
  assert.equal(new Set(Object.values(outcomes)).size, cases.length);
});

test('a notice that cannot be posted stops at notice, and audio is skipped, not failed', async () => {
  const w = world({ afterJoin: 'in_call', speak: true });
  // The fixture chat refuses to take the notice.
  const real = FakeTeamsPage.prototype.fill;
  FakeTeamsPage.prototype.fill = async function (selector: string, text: string) { if (selector.includes('chat-compose')) throw new Error('closed'); return real.call(this, selector, text); };
  try {
    const d = await diagnose(w);
    assert.equal(answer(d), 'notice:notice_failed');
    assert.deepEqual([rowOf(d, 'notice').facts.attempts, rowOf(d, 'audio').result, rowOf(d, 'audio').code], [3, 'skipped', 'notice_failed']);
    assert.equal(d.probe_bytes, null);
    assert.equal(d.screenshot, true);
  } finally { FakeTeamsPage.prototype.fill = real; w.db.close(); }
});

test('a normal member cannot start a Teams diagnostic or read its result or screenshot; another Super Admin cannot read it either', async () => {
  const w = world({ first: 'captcha' });
  try {
    for (const auth of [null, await token(4), await token(2), await token(1)])
      assert.notEqual((await hq(w.env, auth, '/meeting-bots/diagnose', 'POST', { meeting_url: WORK })).status, 202);
    assert.equal(w.done.length, 0, 'nothing reached the bot host');
    const d = await diagnose(w);
    assert.equal(d.screenshot, true);
    assert.equal((await hq(w.env, await token(1), `/meeting-bots/diagnose/${d.id}/screenshot`)).status, 200);
    for (const auth of [null, await token(4), await token(2)]) {
      assert.notEqual((await hq(w.env, auth, `/meeting-bots/diagnose/${d.id}`)).status, 200);
      assert.notEqual((await hq(w.env, auth, `/meeting-bots/diagnose/${d.id}/screenshot`)).status, 200);
    }
    assert.equal((await hq(w.env, await token(3), `/meeting-bots/diagnose/${d.id}`)).status, 404);
    assert.equal((await hq(w.env, await token(3), `/meeting-bots/diagnose/${d.id}/screenshot`)).status, 404);
    assert.equal(await readDiagnosis(w.env, 4, d.id), null);
    assert.equal(await readDiagnosisScreenshot(w.env, 4, d.id), null);
    // The screenshot stays in the private diagnostics prefix of FILES, beside its record, and nowhere else.
    assert.deepEqual([...w.files.objects.keys()].sort(), [`meeting-bot-diagnostics/${d.id}.json`, `meeting-bot-diagnostics/${d.id}.png`]);
  } finally { w.db.close(); }
});

test('a preview diagnostic cannot dispatch to production: preview binds no production bot host, and the keys do not cross', async () => {
  // 1. As configured: the preview site binds no MEETING_BOT_CONTAINER to production's bot host.
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const blocks = toml.split(/\n(?=\[\[?)/);
  const previewBot = blocks.filter((b) => /^\[\[env\.preview\.durable_objects\.bindings\]\]/.test(b) && /name\s*=\s*"MEETING_BOT_CONTAINER"/.test(b));
  assert.ok(previewBot.every((b) => !/script_name\s*=\s*"studioos-meeting-bot"\s*$/m.test(b)), 'preview binds production’s bot host');
  // 2. A preview site with no binding stops at its own site row; no runtime stage is reached and nothing is sent.
  const preview = world({}, { ENVIRONMENT: 'preview', APP_URL: 'https://studioos-preview.workers.dev', MEETING_BOT_CONTAINER: undefined });
  try {
    const d = await startDiagnosis(preview.env, { id: 1 }, WORK, { id: freshId() });
    assert.deepEqual([d.stops_at, rowOf(d, 'site').code, rowOf(d, 'container').code], ['site', 'binding_missing', 'site_failed']);
    assert.equal(preview.done.length, 0);
  } finally { preview.db.close(); }
  // 3. Even if a preview command reached a production image, the image refuses it: it is signed with the preview secret's key.
  const id = freshId(), previewSecret = randomBytes(32).toString('hex');
  const prodImage = new RuntimeHost({ secret: await runtimeKey(SECRET, id), callbackOrigin: ORIGIN, adapter: async () => { throw new Error('never'); },
    diagnose: async () => { throw new Error('a refused command never runs'); } });
  const raw = JSON.stringify({ uid: id, platform: 'teams', meeting_url: WORK });
  const refused = await prodImage.fetch(new Request('http://runtime.internal/diagnose', { method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', ...await signRequest(await runtimeKey(previewSecret, id), '/diagnose', raw, Date.now()) } })); // clock-ok: relative
  assert.equal(refused.status, 401);
  // 4. And a production Worker refuses a callback signed by a preview image.
  const prod = world();
  try {
    const started = await startDiagnosis(prod.env, { id: 1 }, WORK, { id: freshId() });
    await Promise.all(prod.done);
    const path = `/api/meeting-bots/diagnostics/${started.id}/report`, body = JSON.stringify({ stage: 'join', result: 'pass', code: 'asked_to_join' });
    const res = await mounted.fetch(new Request(ORIGIN + path, { method: 'POST', body,
      headers: { 'content-type': 'application/json', ...await signRequest(await runtimeKey(previewSecret, started.id), path, body, Date.now()) } }), prod.env); // clock-ok: relative
    assert.equal(res.status, 401);
  } finally { prod.db.close(); }
});

test('the Teams row: the switch and the link’s kind, never the link; each container row says when it ran', () => {
  assert.deepEqual(teamsStage({ MEETING_BOT_TEAMS: 'on' } as any, 'https://teams.cloud.microsoft/meet/synthetic', 0).facts,
    { teams_switch: 'on', link_kind: 'work', link_host: 'teams.cloud.microsoft' });
  assert.equal(teamsStage({ MEETING_BOT_TEAMS: 'canary' } as any, PERSONAL, 0).facts!.teams_switch, 'off');
  const rec = { id: freshId(), owner_id: 1, platform: 'teams' as const, created_at: 1_000_000, screenshot: false, probe_bytes: null,
    rows: [{ stage: 'join' as const, result: 'pass' as const, code: 'asked_to_join', at: 1_000_000, rev: 1, ran_at: 1_004_400, attempts: 0 }] };
  assert.equal(view(rec, 1_005_000).rows.find((r: any) => r.stage === 'join')!.elapsed_s, 4);
  // A clock that ran behind never reads as negative time.
  rec.rows[0].ran_at = 990_000;
  assert.equal(view(rec, 1_005_000).rows.find((r: any) => r.stage === 'join')!.elapsed_s, 0);
});

test('every stop the Teams check can name has a fix in the owner’s words', () => {
  const src = readFileSync(new URL('../../meeting-bot/src/diagnose.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function teamsJoinStop'), src.indexOf('async function reach('));
  const named = new Set([...body.matchAll(/return '([a-z_]+)'/g), ...body.matchAll(/return `teams_\$\{screen\}`/g)].map((m) => m[1]).filter(Boolean));
  for (const screen of ['captcha', 'anonymous_blocked', 'bot_blocked']) named.add(teamsJoinStop(new AdapterFailure('platform_blocked'), `teams_${screen}`));
  assert.ok(named.size >= 10, [...named].join());
  for (const code of [...named, 'notice_failed', 'notice_unpublished', 'admission_timed_out', 'no_frames', 'upload_failed', 'host_unreachable', 'launch_failed'])
    assert.ok(DIAGNOSE_FIXES[code], `no fix for ${code}`);
});
