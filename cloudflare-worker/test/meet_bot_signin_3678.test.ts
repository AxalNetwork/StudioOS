/**
 * D3678 (#3678) — the site Worker's half of the signed-in Meet join.
 *
 *   1. The code generator matches RFC 6238's SHA-1 test vectors, and base32 reads a setup key.
 *   2. The run's callback: signed, Meet only, joining only, throttled, at most MEET_CODES_MAX codes.
 *   3. With any secret missing, the answer is 404 `meet_signin_unconfigured` (the bot joins as a guest).
 *   4. The TOTP key is never in an answer; the answers are no-store.
 *   5. The owner diagnostic's own callback, for a Meet diagnostic in its window only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { fixture, seed, mig } from './_call_audio_fixture.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { MeetingBotRun, MEET_CODES_MAX } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { runtimeHeaders, runtimeKey } from '../src/services/meetingBotRuntime.ts';
import { base32, credentialStep, meetCredentials, meetSignInConfigured, totp } from '../src/services/meetBotGoogle.ts';
import { googleStage } from '../src/services/meetingBotDiagnose.ts';

const UID = '00000000-0000-4000-8000-000000000003', OTHER = '00000000-0000-4000-8000-000000000004', DIAG = '00000000-0000-4000-8000-000000000005';
const MASTER = 'synthetic-runtime-master-secret-0123456789';
// Synthetic secrets: no real account. The TOTP key is RFC 6238's own ASCII key, in base32.
const EMAIL = 'bot@example.test', PASSWORD = 'synthetic-password-not-real';
const RFC_KEY_ASCII = '12345678901234567890';
const RFC_KEY_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('1. the code generator matches RFC 6238 Appendix B (SHA-1, 8 digits), and base32 reads the setup key', async () => {
  const key = new TextEncoder().encode(RFC_KEY_ASCII);
  const vectors: Array<[number, string]> = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) assert.equal(await totp(key, t * 1000, { digits: 8 }), code, `T=${t}`);
  // Six digits, as an authenticator shows: the last six of the same value.
  assert.equal(await totp(key, 59_000), '287082');
  assert.deepEqual(base32(RFC_KEY_B32), key);
  assert.deepEqual(base32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), key, 'spaces and case, as Google shows the key');
  assert.equal(base32('not base32!'), null);
  assert.equal(base32(''), null);
});

test('1b. the body names one step, and nothing else', () => {
  assert.equal(credentialStep('{}'), 'account');
  assert.equal(credentialStep('{"step":"code"}'), 'code');
  for (const raw of ['', '{"step":"secret"}', '{"email":"x"}', '{ }']) assert.equal(credentialStep(raw), null, raw);
});

test('3. with any secret missing, the answer is 404 meet_signin_unconfigured', async () => {
  const full = { MEET_BOT_GOOGLE_EMAIL: EMAIL, MEET_BOT_GOOGLE_PASSWORD: PASSWORD, MEET_BOT_GOOGLE_TOTP: RFC_KEY_B32 } as any;
  assert.equal(meetSignInConfigured(full), true);
  for (const drop of ['MEET_BOT_GOOGLE_EMAIL', 'MEET_BOT_GOOGLE_PASSWORD', 'MEET_BOT_GOOGLE_TOTP']) {
    const env = { ...full, [drop]: undefined };
    assert.equal(meetSignInConfigured(env), false, drop);
    const res = await meetCredentials(env, 'account');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { code: 'meet_signin_unconfigured' });
  }
  assert.equal(meetSignInConfigured({ ...full, MEET_BOT_GOOGLE_TOTP: 'backup-code-1234' }), false, 'a backup code is not a setup key');
});

test('4. the answers: the account once, a code with its time left; never the TOTP key; no-store', async () => {
  const env = { MEET_BOT_GOOGLE_EMAIL: EMAIL, MEET_BOT_GOOGLE_PASSWORD: PASSWORD, MEET_BOT_GOOGLE_TOTP: RFC_KEY_B32 } as any;
  const a = await meetCredentials(env, 'account');
  assert.equal(a.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await a.json(), { email: EMAIL, password: PASSWORD });
  const c = await meetCredentials(env, 'code', 59_000);
  const text = await c.text();
  assert.deepEqual(JSON.parse(text), { code: '287082', valid_ms: 1000 });
  assert.ok(!text.includes(RFC_KEY_B32) && !text.includes(PASSWORD), 'a code answer carries the code only');
});

async function world(platform = 'google_meet') {
  const w = fixture(); w.db.exec(mig('531_meeting_bots.sql')); w.db.exec(mig('532_meeting_bot_participants.sql'));
  w.db.exec(tableFromBaseline(readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8'), 'integrations'));
  const session = seed(w, { kind: 'recorder', chunks: 0, ageDays: 0 });
  w.env.KEK_PII = 'k'.repeat(48);
  const url = await encryptColumn(w.env, 'meeting_bots', 'meeting_url_enc', UID, platform === 'zoom' ? 'https://unit.zoom.us/j/111111111' : 'https://meet.google.com/abc-defg-hij');
  w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,status,scheduled_at,started_at,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at)
    VALUES(?,2,10,?,?,?,'joining',0,?,30,100,125,?)`).run(UID, session, platform, url, Date.now(), Date.now());
  Object.assign(w.env, { MEETING_BOT: 'on', MEETING_BOT_SECRET: MASTER, MEETING_BOT_RUNTIME: { start: async () => {}, stop: async () => {} },
    MEETING_BOT_ZOOM_CLIENT_ID: 'synthetic-sdk-client', MEETING_BOT_ZOOM_CLIENT_SECRET: 'synthetic-sdk-credential-01234567890123456789',
    MEET_BOT_GOOGLE_EMAIL: EMAIL, MEET_BOT_GOOGLE_PASSWORD: PASSWORD, MEET_BOT_GOOGLE_TOTP: RFC_KEY_B32 });
  const rows = new Map<string, any>([['billing', [{ end: Date.now() + 120_000 }]]]);
  const state = { blockConcurrencyWhile: (f: any) => f(), storage: { get: async (k: string) => rows.get(k), put: async (k: string, v: any) => rows.set(k, v), setAlarm: async () => {} } };
  const supervisor = new MeetingBotRun(state as any, w.env);
  w.env.MEETING_BOT_RUN = { idFromName: (s: string) => s, get: () => ({ fetch: (r: Request) => supervisor.fetch(r) }) } as any;
  const app = new Hono(); app.route('/api/meeting-bots', callbacks as any);
  const call = async (raw = '{}', uid = UID, keyUid = uid) => {
    const path = `/api/meeting-bots/${uid}/meet-credentials`;
    return app.fetch(new Request('https://worker.example.test' + path, { method: 'POST', body: raw, headers: await runtimeHeaders(await runtimeKey(MASTER, keyUid), path, raw) }), w.env);
  };
  return { ...w, rows, call, app };
}

test('2. the run callback: signed with the run key, Meet only, joining only, throttled, a bounded number of codes', async () => {
  // Mutation checked: the `run.platform!=='google_meet'` gate removed → a Zoom run gets the Google account (200).
  const w = await world();
  try {
    assert.equal((await w.call('{}', OTHER, UID)).status, 401, 'another run\'s key');
    assert.equal((await w.call('{"step":"secret"}')).status, 400);
    const a = await w.call();
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await a.json(), { email: EMAIL, password: PASSWORD });
    assert.equal((await w.call('{"step":"code"}')).status, 429, 'two requests inside 2.5 s');
    for (let i = 0; i < MEET_CODES_MAX; i += 1) {
      w.rows.delete('meet_credentials_at');
      const c = await w.call('{"step":"code"}');
      assert.equal(c.status, 200);
      assert.match((await c.json()).code, /^\d{6}$/);
    }
    w.rows.delete('meet_credentials_at');
    const spent = await w.call('{"step":"code"}');
    assert.equal(spent.status, 429);
    assert.equal((await spent.json()).code, 'bot_meet_codes_spent');
    // Out of joining (admitted, recording): no more secrets.
    w.rows.delete('meet_credentials_at');
    w.db.prepare("UPDATE meeting_bots SET status='recording' WHERE uid=?").run(UID);
    assert.equal((await w.call()).status, 403);
  } finally { w.db.close(); }
  const z = await world('zoom');
  try { assert.equal((await z.call()).status, 403, 'a Zoom run never gets the Google account'); } finally { z.db.close(); }
});

test('2b. a lapsed lease or a withdrawn consent gives nothing', async () => {
  for (const mode of ['lease', 'consent']) {
    const w = await world();
    try {
      if (mode === 'lease') w.rows.set('billing', [{ end: Date.now() - 1 }]);
      else w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();
      const res = await w.call();
      assert.equal(res.status, 403, mode);
      const body = await res.json();
      assert.equal(body.email, undefined); assert.equal(body.password, undefined);
    } finally { w.db.close(); }
  }
});

test('5. the owner diagnostic\'s callback: a Meet diagnostic in its window only', async () => {
  const w = await world();
  const objects = new Map<string, string>();
  (w.env as any).FILES = { get: async (k: string) => (objects.has(k) ? { text: async () => objects.get(k)! } : null), put: async (k: string, v: string) => { objects.set(k, v); } };
  const rec = (platform: string, created_at: number) => objects.set(`meeting-bot-diagnostics/${DIAG}.json`, JSON.stringify({ id: DIAG, owner_id: 1, platform, created_at, rows: [], screenshot: false, probe_bytes: null }));
  const call = async (raw = '{}') => {
    const path = `/api/meeting-bots/diagnostics/${DIAG}/meet-credentials`;
    return w.app.fetch(new Request('https://worker.example.test' + path, { method: 'POST', body: raw, headers: await runtimeHeaders(await runtimeKey(MASTER, DIAG), path, raw) }), w.env);
  };
  try {
    assert.equal((await call()).status, 403, 'no such diagnostic');
    rec('zoom', Date.now());
    assert.equal((await call()).status, 403, 'a Zoom diagnostic');
    rec('google_meet', Date.now() - 11 * 60_000);
    assert.equal((await call()).status, 403, 'past its window');
    rec('google_meet', Date.now());
    const a = await call();
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json(), { email: EMAIL, password: PASSWORD });
    assert.match((await (await call('{"step":"code"}')).json()).code, /^\d{6}$/);
    // The diagnostic's config row says whether the account is set, never its value.
    const row = await googleStage(w.env, 1, Date.now(), (async () => Response.json({})) as any);
    assert.equal(row.facts!.bot_account, 'set');
    assert.ok(!JSON.stringify(row).includes(EMAIL));
  } finally { w.db.close(); }
});
