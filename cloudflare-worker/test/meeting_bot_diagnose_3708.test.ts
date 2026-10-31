/** #3708: the owner's staged diagnostic, against fakes: container host, callbacks, stages, routes. Synthetic only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { mig } from './_call_audio_fixture.ts';
import { MeetingBotContainer } from '../../meeting-bot/worker/container.ts';
import { runtimeKey } from '../src/services/meetingBotRuntime.ts';
import { startDiagnosis, readDiagnosis, readDiagnosisScreenshot, googleStage, zoomStage, lastRunStage, meetApiRefusal, view, DIAGNOSE_FIXES, DIAGNOSE_WINDOW_MS } from '../src/services/meetingBotDiagnose.ts';
import { Hono } from 'hono';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';

/** Mounted as index.ts mounts it: the signature covers the full path. */
const mounted = new Hono().route('/api/meeting-bots', callbacks);
import platform from '../src/routes/admin_platform.ts';
import { signRequest } from '../../meeting-bot/src/callback.ts';

const SECRET = randomBytes(32).toString('hex'), JWT_SECRET = randomBytes(32).toString('hex');
const ID = '00000000-0000-4000-8000-0000000037a8', MEET = 'https://meet.google.com/abc-defg-hij';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');

/** R2 with etags and conditional puts, as the diagnostic's writes rely on. */
function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let n = 0;
  return {
    objects,
    async get(key: string) {
      const o = objects.get(key);
      return o ? { etag: o.etag, text: async () => new TextDecoder().decode(o.bytes), body: new Blob([o.bytes]).stream() } : null;
    },
    async put(key: string, value: string | Uint8Array, opts?: any) {
      const cur = objects.get(key);
      if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      objects.set(key, { bytes, etag: `e${++n}` });
      return { key };
    },
  };
}
/** The bot host's namespace: health and diagnose, scripted per test. */
function host(answer: { health?: Response; diagnose?: (body: any) => Promise<Response> } = {}) {
  const sent: any[] = [];
  return {
    sent,
    idFromName: (s: string) => s,
    get: () => ({ fetch: async (r: Request) => {
      const path = new URL(r.url).pathname;
      if (path === '/health') return answer.health ?? Response.json({ running: false, version: 'a1b2c3d4e5f6a7b8' });
      const body = await r.json(); sent.push(body);
      return answer.diagnose ? answer.diagnose(body) : Response.json({ code: 'started' }, { status: 202 });
    } }),
  };
}
function world(extra: Record<string, unknown> = {}) {
  const fx = makeD1(['users', 'super_admins', 'google_oauth_tokens', 'integrations', 'user_sessions', 'admin_audit_log', 'activity_logs']
    .map((t) => tableFromBaseline(baseline, t)).join('\n'));
  fx.db.exec('PRAGMA foreign_keys=OFF');
  fx.db.exec(mig('531_meeting_bots.sql')); fx.db.exec(mig('532_meeting_bot_participants.sql')); fx.db.exec(mig('655_meeting_bot_failure_detail.sql'));
  for (const [id, role] of [[1, 'admin'], [2, 'admin'], [3, 'admin'], [4, 'founder']] as const)
    fx.db.prepare('INSERT INTO users(id,name,email,role,is_active) VALUES(?,?,?,?,1)').run(id, 'Synthetic', `synthetic${id}@example.test`, role);
  for (const id of [1, 3]) fx.db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(id);
  const files = bucket(), container = host();
  const env: any = { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development', FILES: files, MEETING_BOT_SECRET: SECRET,
    APP_URL: 'https://worker.example.test', MEETING_BOT_CONTAINER: container, ...extra };
  return { ...fx, env, files, container };
}
async function runtimeCall(env: any, id: string, kind: string, body: object, key?: string, now = Date.now()) {
  const path = `/api/meeting-bots/diagnostics/${id}/${kind}`, raw = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', ...await signRequest(key ?? await runtimeKey(SECRET, id), path, raw, now) };
  return mounted.fetch(new Request('https://worker.example.test' + path, { method: 'POST', headers, body: raw }), env);
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const WAV = (() => { const b = Buffer.alloc(44 + 64); b.write('RIFF', 0); b.write('WAVE', 8); return b.toString('base64'); })();

test('the bot host answers health with its deployed commit, and serves one /diagnose per instance', async () => {
  const commands: Request[] = [];
  let destroys = 0, answer = 202;
  const timeouts: number[] = [];
  const container: any = { running: false, images: { runtime: 'registry.cloudflare.com/synthetic/runtime@sha256:' + 'a'.repeat(64) },
    start() { this.running = true; }, async destroy() { destroys += 1; this.running = false; }, monitor: async () => {},
    async setInactivityTimeout(ms: number) { timeouts.push(ms); }, getTcpPort: () => ({ fetch: async (r: Request) => { commands.push(r.clone()); return Response.json({}, { status: answer }); } }) };
  const rows = new Map<string, any>();
  let lock = Promise.resolve<any>(undefined);
  const state: any = { container, waitUntil: () => {}, blockConcurrencyWhile: (f: any) => { const next = lock.then(f); lock = next.catch(() => {}); return next; },
    storage: { get: async (k: string) => structuredClone(rows.get(k)), put: async (k: string, v: any) => { rows.set(k, structuredClone(v)); }, setAlarm: async () => {} } };
  const env: any = { APP_URL: 'https://worker.example.test', MEETING_BOT_SECRET: SECRET, MEETING_BOT_VERSION: 'a1b2c3d4e5f6' };
  const bot = new MeetingBotContainer(state, env);
  const call = (path: string, body?: object) => bot.fetch(new Request('https://c.internal' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}));
  assert.deepEqual(await (await call('/health')).json(), { running: false, version: 'a1b2c3d4e5f6' });
  env.MEETING_BOT_VERSION = 'not a sha';
  assert.equal(((await (await call('/health')).json()) as any).version, null);
  assert.equal((await call('/diagnose', { uid: ID, platform: 'teams', meeting_url: MEET })).status, 400);
  const ok = await call('/diagnose', { uid: ID, platform: 'google_meet', meeting_url: MEET });
  assert.equal(ok.status, 202);
  assert.equal(new URL(commands[0].url).pathname, '/diagnose');
  // No heartbeat keeps a diagnostic awake: its container may idle for the whole lease, not a run's two minutes.
  assert.ok(timeouts.at(-1)! > 8 * 60_000, String(timeouts));
  // Signed with the diagnostic's own derived key, as the runtime checks it.
  const raw = await commands[0].text(), ts = Number(commands[0].headers.get('x-meeting-bot-timestamp'));
  const expected = await signRequest(await runtimeKey(SECRET, ID), '/diagnose', raw, ts);
  assert.equal(commands[0].headers.get('x-meeting-bot-signature'), expected['x-meeting-bot-signature']);
  assert.equal(JSON.parse(raw).meeting_url, MEET);
  assert.equal((await call('/diagnose', { uid: ID, platform: 'google_meet', meeting_url: MEET })).status, 409);
  // A refusal from the image is final, and the container goes.
  rows.clear(); container.running = false; answer = 401;
  const refused = await call('/diagnose', { uid: ID, platform: 'google_meet', meeting_url: MEET });
  assert.deepEqual([refused.status, ((await refused.json()) as any).code], [503, 'runtime_refused']);
  assert.equal(destroys, 1);
  rows.clear(); container.running = false; container.images = {};
  assert.deepEqual(((await (await call('/diagnose', { uid: ID, platform: 'google_meet', meeting_url: MEET })).json()) as any).code, 'image_unavailable');
});

test('the whole Meet table: the site, the container’s reports, a screenshot and a probe; read by its owner only', async () => {
  const w = world({ GOOGLE_CLIENT_ID: 'synthetic-client' });
  try {
    const started = await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID, now: Date.now() });
    assert.deepEqual(w.container.sent, [{ uid: ID, platform: 'google_meet', meeting_url: MEET }]);
    const site = started.rows.find((r: any) => r.stage === 'site')!;
    assert.deepEqual([site.result, site.facts.version, site.facts.rollout], ['pass', 'a1b2c3d4e5f6', 'off']);
    assert.deepEqual(started.rows.find((r: any) => r.stage === 'config')!.code, 'not_connected');
    assert.equal(started.rows.find((r: any) => r.stage === 'container')!.result, 'running');
    assert.equal(started.done, false);
    for (const [stage, result, code, facts] of [['container', 'pass', 'command_received'], ['browser', 'pass', 'launched'],
      ['egress', 'pass', 'hosts_reached', { 'meet.google.com': 302 }], ['join', 'fail', 'signin_wall', { step: 'meet_page_signin' }],
      ['admission', 'skipped', 'join_failed'], ['audio', 'skipped', 'join_failed']] as const)
      assert.equal((await runtimeCall(w.env, ID, 'report', { stage, result, code, ...(facts ? { facts } : {}) })).status, 200);
    assert.equal((await runtimeCall(w.env, ID, 'screenshot', { png: PNG })).status, 200);
    assert.equal((await runtimeCall(w.env, ID, 'probe', { wav: WAV })).status, 200);
    const read = (await readDiagnosis(w.env, 1, ID))!;
    assert.equal(read.done, true);
    assert.equal(read.stops_at, 'join');
    const join = read.rows.find((r: any) => r.stage === 'join')!;
    assert.equal(join.fix, DIAGNOSE_FIXES.signin_wall);
    assert.deepEqual(read.rows.map((r: any) => r.stage), ['site', 'config', 'container', 'browser', 'egress', 'join', 'admission', 'audio', 'last_run']);
    assert.deepEqual([read.screenshot, read.probe_bytes], [true, 108]);
    // Only the size of the probe is kept, and the link never.
    assert.equal([...w.files.objects.keys()].sort().join(','), `meeting-bot-diagnostics/${ID}.json,meeting-bot-diagnostics/${ID}.png`);
    assert.equal(new TextDecoder().decode(w.files.objects.get(`meeting-bot-diagnostics/${ID}.json`)!.bytes).includes('abc-defg-hij'), false);
    assert.equal(await readDiagnosis(w.env, 3, ID), null);
    assert.equal(await readDiagnosisScreenshot(w.env, 3, ID), null);
    assert.ok(await readDiagnosisScreenshot(w.env, 1, ID));
  } finally { w.db.close(); }
});

test('callbacks: a wrong key, another diagnostic’s key, text in a fact, an unknown stage and an old diagnostic are refused', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    const report = { stage: 'browser', result: 'pass', code: 'launched' };
    assert.equal((await runtimeCall(w.env, ID, 'report', report, 'k'.repeat(64))).status, 401);
    assert.equal((await runtimeCall(w.env, ID, 'report', report, await runtimeKey(SECRET, '00000000-0000-4000-8000-000000000001'))).status, 401);
    assert.equal((await runtimeCall(w.env, ID, 'report', report, undefined, Date.now() - 6 * 60_000)).status, 401);
    assert.equal((await runtimeCall(w.env, ID, 'report', { ...report, facts: { page: 'You can’t join' } })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'report', { ...report, facts: { Name: 'x' } })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'report', { ...report, stage: 'site' })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'report', { ...report, code: 'Launched OK' })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'screenshot', { png: Buffer.from('GIF89a').toString('base64') })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'probe', { wav: Buffer.from('not a wav').toString('base64') })).status, 400);
    assert.equal((await runtimeCall(w.env, ID, 'anything', {})).status, 404);
    const other = '00000000-0000-4000-8000-0000000037a9';
    assert.equal((await runtimeCall(w.env, other, 'report', report)).status, 404);
    // Past its window, a diagnostic takes no more reports, and what never came reads as never reported.
    const old = '00000000-0000-4000-8000-0000000037aa';
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: old, now: Date.now() - DIAGNOSE_WINDOW_MS - 1 });
    assert.equal((await runtimeCall(w.env, old, 'report', report)).status, 410);
    const stale = (await readDiagnosis(w.env, 1, old))!;
    assert.equal(stale.rows.find((r: any) => r.stage === 'browser')!.code, 'never_reported');
    assert.deepEqual(stale.rows.find((r: any) => r.stage === 'container')!.facts, { last_code: 'starting' });
    assert.equal(stale.done, true);
  } finally { w.db.close(); }
});

test('a container that reports before the start returns keeps its own container row', async () => {
  const w = world();
  try {
    w.env.MEETING_BOT_CONTAINER = host({ diagnose: async (body) => {
      assert.equal((await runtimeCall(w.env, body.uid, 'report', { stage: 'container', result: 'pass', code: 'command_received' })).status, 200);
      return Response.json({ code: 'started' }, { status: 202 });
    } });
    const started = await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    assert.deepEqual(started.rows.find((r: any) => r.stage === 'container'), { stage: 'container', result: 'pass', code: 'command_received', facts: {}, fix: null });
  } finally { w.db.close(); }
});

test('reports that arrive together all land: each write waits for the one before it', async () => {
  const w = world();
  try {
    await startDiagnosis(w.env, { id: 1 }, MEET, { id: ID });
    // Every read yields first, so the four reads all happen before any write.
    const get = w.files.get.bind(w.files);
    w.files.get = async (key: string) => { const o = await get(key); await new Promise((r) => setImmediate(r)); return o; };
    const stages = [['container', 'command_received'], ['browser', 'launched'], ['egress', 'hosts_reached'], ['join', 'asked_to_join']];
    const answers = await Promise.all(stages.map(([stage, code]) => runtimeCall(w.env, ID, 'report', { stage, result: 'pass', code })));
    assert.deepEqual(answers.map((r) => r.status), [200, 200, 200, 200]);
    const read = (await readDiagnosis(w.env, 1, ID))!;
    for (const [stage, code] of stages) assert.equal(read.rows.find((r: any) => r.stage === stage)!.code, code, stage);
  } finally { w.db.close(); }
});

test('the site and container stops: no binding, Containers off, a refused image; each skips what follows', async () => {
  const none = world({ MEETING_BOT_CONTAINER: undefined });
  try {
    const r = await startDiagnosis(none.env, { id: 1 }, MEET, { id: ID });
    assert.deepEqual([r.stops_at, r.rows[0].code, r.rows[2].code], ['site', 'binding_missing', 'site_failed']);
    assert.equal(r.rows[0].fix, DIAGNOSE_FIXES.binding_missing);
  } finally { none.db.close(); }
  const off = world({ MEETING_BOT_CONTAINER: host({ health: Response.json({ code: 'container_unavailable' }, { status: 503 }) }) });
  try { assert.equal((await startDiagnosis(off.env, { id: 1 }, MEET, { id: ID })).rows[0].code, 'containers_disabled'); } finally { off.db.close(); }
  const refused = world({ MEETING_BOT_CONTAINER: host({ diagnose: async () => Response.json({ code: 'runtime_no_answer' }, { status: 503 }) }) });
  try {
    const r = await startDiagnosis(refused.env, { id: 1 }, MEET, { id: ID });
    assert.deepEqual([r.stops_at, r.rows[2].code, r.rows[3].code], ['container', 'runtime_no_answer', 'container_failed']);
  } finally { refused.db.close(); }
  const teams = world();
  try { await assert.rejects(startDiagnosis(teams.env, { id: 1 }, 'https://teams.microsoft.com/meet/synthetic', { id: ID }), /The diagnostic covers/); } finally { teams.db.close(); }
});

test('Google’s setup: each requirement set or missing, and the Meet API’s own codes', async () => {
  const w = world();
  try {
    assert.equal((await googleStage(w.env, 1, Date.now())).code, 'oauth_client_missing');
    w.env.GOOGLE_CLIENT_ID = 'synthetic-client';
    w.db.prepare("INSERT INTO google_oauth_tokens(user_id,refresh_token,scope) VALUES(1,'x',?)").run('https://www.googleapis.com/auth/calendar.events');
    const facts = (await googleStage(w.env, 1, Date.now(), async () => { throw new Error('never reached without a token'); })).facts!;
    assert.deepEqual([facts.scope_calendar_events, facts.scope_meetings_space_created, facts.scope_meetings_space_readonly, facts.consent_screen],
      ['granted', 'missing', 'missing', 'owner_check_in_cloud_console']);
    assert.deepEqual(meetApiRefusal(403, { error: { status: 'PERMISSION_DENIED', message: 'Synthetic private text', details: [{ reason: 'SERVICE_DISABLED' }] } }),
      { fact: 'permission_denied:service_disabled', failure: 'meet_api_disabled' });
    assert.deepEqual(meetApiRefusal(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }).failure, 'meet_api_scope_missing');
    assert.deepEqual(meetApiRefusal(500, { error: { status: 'not a code <b>' } }), { fact: 'http_500', failure: 'meet_api_error' });
  } finally { w.db.close(); }
});

test('Zoom’s setup and the last real run, by codes only', async () => {
  const w = world();
  try {
    assert.equal((await zoomStage(w.env, 1, 'https://unit.zoom.us/j/111111111', Date.now())).code, 'zoom_bot_unconfigured');
    Object.assign(w.env, { MEETING_BOT_ZOOM_CLIENT_ID: 'synthetic', MEETING_BOT_ZOOM_CLIENT_SECRET: 'synthetic' });
    const z = await zoomStage(w.env, 1, 'https://unit.zoom.us/j/111111111', Date.now());
    assert.deepEqual([z.code, z.facts!.meeting_id], ['zoom_not_connected', 'readable']);
    assert.equal((await lastRunStage(w.env, 1, 'zoom', Date.now())).code, 'no_runs');
    const insert = w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,session_id,project_id,platform,meeting_url_enc,status,failure_code,failure_detail,limit_minutes,
      scheduled_at,cost_per_minute_microusd,rate_per_minute_microusd,created_at) VALUES(?,1,1,1,'zoom','x',?,?,?,30,0,1,1,?)`);
    insert.run('00000000-0000-4000-8000-000000000101', 'failed', 'runtime_failed', 'obf_unavailable@zoom_not_connected', Date.now() - 120_000);
    const last = await lastRunStage(w.env, 1, 'zoom', Date.now());
    assert.deepEqual([last.result, last.code, last.facts!.failure_detail, last.facts!.age_minutes], ['fail', 'last_run_failed', 'obf_unavailable@zoom_not_connected', 2]);
    insert.run('00000000-0000-4000-8000-000000000102', 'failed', 'runtime_failed', 'Not A Code', Date.now());
    assert.equal((await lastRunStage(w.env, 1, 'zoom', Date.now())).facts!.failure_detail, undefined);
  } finally { w.db.close(); }
});

test('HQ routes: Super Admin only, the write needs the TOTP bar, and a stranger cannot read a diagnostic', async () => {
  const w = world();
  try {
    w.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'synthetic-totp','totp',datetime('now'))").run();
    const token = async (id: number, jti?: string) => 'Bearer ' + await new SignJWT({ user_id: id, role: id === 4 ? 'founder' : 'admin', ...(jti ? { jti } : {}) })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const send = async (auth: string | null, path: string, method = 'GET', body?: object) => platform.fetch(new Request('https://example.test' + path, {
      method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined }), w.env);
    for (const auth of [null, await token(2), await token(4), await token(1)])
      assert.notEqual((await send(auth, '/meeting-bots/diagnose', 'POST', { meeting_url: MEET })).status, 202);
    const ok = await send(await token(1, 'synthetic-totp'), '/meeting-bots/diagnose', 'POST', { meeting_url: MEET });
    assert.equal(ok.status, 202);
    const id = ((await ok.json()) as any).diagnosis.id;
    assert.equal((await send(await token(1), `/meeting-bots/diagnose/${id}`)).status, 200);
    for (const auth of [await token(2), await token(4)]) assert.notEqual((await send(auth, `/meeting-bots/diagnose/${id}`)).status, 200);
    assert.equal((await send(await token(3), `/meeting-bots/diagnose/${id}`)).status, 404);
    assert.equal((await send(await token(1), `/meeting-bots/diagnose/${id}/screenshot`)).status, 404);
    const bad = await send(await token(1, 'synthetic-totp'), '/meeting-bots/diagnose', 'POST', { meeting_url: 'https://example.test/call' });
    assert.deepEqual([bad.status, ((await bad.json()) as any).code], [400, 'unsupported_link']);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='meeting_bot_diagnosis_started'").get()!.n, 1);
  } finally { w.db.close(); }
});

test('every failing code the bot or the Worker can name has a fix', () => {
  const src = ['../../meeting-bot/src/diagnose.ts', '../src/services/meetingBotDiagnose.ts', '../../meeting-bot/worker/container.ts']
    .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  const failing = new Set([...src.matchAll(/result: 'fail'(?: as const)?, code: '([a-z_]+)'/g)].map((m) => m[1]));
  for (const code of ['signin_wall', 'cannot_join', 'join_click_unanswered', 'admission_timed_out', 'no_frames', 'runtime_no_answer', 'runtime_refused', 'container_start_failed', 'image_unavailable', ...failing])
    assert.ok(DIAGNOSE_FIXES[code], `no fix for ${code}`);
  assert.equal(view({ id: ID, owner_id: 1, platform: 'zoom', created_at: Date.now(), rows: [{ stage: 'site', result: 'fail', code: 'brand_new_code', at: 0 }], screenshot: false, probe_bytes: null }).rows[0].fix,
    'No fix recorded for this code yet.');
});
