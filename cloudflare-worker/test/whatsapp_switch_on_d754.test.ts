/** D754 #1892: both chat rollout switches, WhatsApp safeguards and media expiry. Every provider is stubbed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { consentGiven, memR2 } from './_channels_fixture.ts';
import { audioConsentRequired } from '../src/services/channels/types.ts';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import channels, { channelsAdmin, runVoiceFollowup as originalVoiceJob } from '../src/routes/channels.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { voiceFetchBy } from '../src/services/channels/voiceFailures.ts';
import { callingEligibility, callingRecord, GRAPH_VERSION, unsubscribeApp } from '../src/services/channels/whatsapp.ts';
import { memberConnection, channelOpenToMember } from '../src/services/channels/connections.ts';

import { withGuard } from './_guard_stub.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, ME = 2, OTHER = 3, GONE = 4, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101;
const TG_ME = '555001', TG_NEW = '555003';
const PNID = '1000001', PNID_GONE = '1000004';
const WA_TOKEN = 'EAAG-member-business-token-SECRET';

const SECRETS = {
  TELEGRAM_CHANNEL_BOT_TOKEN: '123456:tg-bot-token-SECRET',
  TELEGRAM_CHANNEL_BOT_USERNAME: 'axal_interviews_bot',
  TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'tg_webhook_SECRET_1',
  WHATSAPP_APP_ID: '424242',
  WHATSAPP_APP_SECRET: 'wa-app-SECRET-value',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify-SECRET',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '777888',
};
const SECRET_VALUES = [SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN, SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET, SECRETS.WHATSAPP_APP_SECRET,
  SECRETS.WHATSAPP_VERIFY_TOKEN, WA_TOKEN, 'EAAG-new-business-token-SECRET'];

async function world(opts: { seed?: boolean; budget?: number } = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id IN (${ME}, ${GONE});
    UPDATE users SET is_active = 0 WHERE id = ${GONE};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Not mine', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz');
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      display_name TEXT, status TEXT NOT NULL DEFAULT 'active', auth_type TEXT NOT NULL, credentials_enc TEXT,
      webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    // D870: interview_channel_refs.transcript_source, call_lang and stt_reservation_uid.
    '529_meeting_transcript_source.sql',
    // D685: openSession stores the call (call_provider), as production's 452 lets it.
    '452_record_session_setup.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    // D754 (#1893): the consent store, which assign and the voice job read.
    '488_channel_consents.sql']) db.exec(mig(m));
    applySessionTranslationColumns(db); // D857: migration 527's segment columns
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  db.exec(mig('492_whatsapp_sender_links.sql'));
  db.exec(mig('504_whatsapp_link_settings.sql')); // #1939 part 3: unlink clears the venture choice
  db.exec("UPDATE users SET role = 'admin', is_super_admin = 1 WHERE id = 5");
  if (opts.budget != null) {
    for (const key of ['founder:free', 'other']) {
      db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)').run(key, opts.budget, opts.budget);
    }
  }
  const queued: any[] = [];
  const aiCalls: any[] = [];
  const env: any = {
    // D754 W3 (#1935): a consented WhatsApp note is kept as recorder audio.
    FILES: memR2(),
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48), ...SECRETS,
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    RATE_LIMITS: memKV(), USE_CF_QUEUE: 'true',
    JOB_QUEUE: { async send(body: any) { queued.push(body); } },
    AI: withGuard({ async run(model: string, input: any) { aiCalls.push({ model, input }); return { text: 'We lose a whole day every month to this.', transcription_info: { language: 'en' } }; } }),
  };
  if (opts.seed) {
    const creds = await encryptCredentials(env, 'wa-me', { access_token: WA_TOKEN, token_type: 'bearer' });
    const goneCreds = await encryptCredentials(env, 'wa-gone', { access_token: WA_TOKEN, token_type: 'bearer' });
    db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, external_account_name, config_json, credentials_enc)
                VALUES ('tg-me', ?, 'telegram', 'webhook', ?, '@dana_biz', '{}', NULL),
                       ('wa-me', ?, 'whatsapp', 'oauth2', ?, 'Ledger Co', ?, ?),
                       ('wa-gone', ?, 'whatsapp', 'oauth2', ?, 'Gone Co', ?, ?)`)
      .run(ME, TG_ME, ME, PNID, JSON.stringify({ phone_number_id: PNID, waba_id: '2000001', number_masked: '•••• 1234' }), creds,
        GONE, PNID_GONE, JSON.stringify({ phone_number_id: PNID_GONE, waba_id: '2000004' }), goneCreds);
    db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
             VALUES ('bc-1', 'BC-ME', '${TG_ME}', ${ME}, 1, 1)`);
  }
  return { env, db, queued, aiCalls };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const app = (() => {
  const a = new Hono();
  a.route('/api/channels', channels as any);
  a.route('/api/admin/channels', channelsAdmin as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

/** Every response body any test saw, to search for secrets at the end of each test. */
let activeApp: any = app;
let voiceJob = originalVoiceJob;
const seen: string[] = [];

async function send(env: any, path: string, init: RequestInit) {
  const res = await activeApp.fetch(new Request(`https://axal.vc${path}`, init), env);
  const text = await res.text();
  seen.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function call(env: any, user: number, method: string, path: string, body?: unknown, role = 'founder') {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const result = await send(env, `/api/channels${path === '/' ? '' : path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (method === 'GET') assert.equal(result.status, 200, 'fixture GET must reach its mounted route: ' + path);
  return result;
}

function tgHook(env: any, update: unknown, secret: string | null = SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return send(env, '/api/channels/telegram/webhook', { method: 'POST', headers, body: JSON.stringify(update) });
}

const sign = (raw: string, secret = SECRETS.WHATSAPP_APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

function waHook(env: any, payload: unknown, signature?: string | null) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = signature === undefined ? sign(raw) : signature;
  if (sig !== null) headers['X-Hub-Signature-256'] = sig;
  return send(env, '/api/channels/whatsapp/webhook', { method: 'POST', headers, body: raw });
}

type Reply = { status?: number; json?: unknown; body?: BodyInit; headers?: Record<string, string> };
type Route = (url: URL, init: RequestInit) => Reply | undefined;

/** Mock every provider: a URL no route answers fails the test. */
function mockFetch(route: Route) {
  const calls: { url: string; method: string; body: any; auth: string | null }[] = [];
  const original = globalThis.fetch;
  const unexpected: string[] = [];
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    let body: any = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* raw */ } }
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    calls.push({ url: url.toString(), method: String(init.method ?? 'GET'), body, auth });
    const r = route(url, init);
    if (!r) { unexpected.push(`${url.origin}${url.pathname}`); throw new Error(`unexpected fetch ${url.origin}${url.pathname}`); }
    const payload = r.body ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(payload, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; assert.deepEqual(unexpected, [], 'every provider URL must be stubbed'); } };
}

const OGG_FILE = (() => { const b = new Uint8Array(4000).fill(7); b.set([0x4f, 0x67, 0x67, 0x53]); return b; })();

/** Telegram's Bot API, as far as these tests use it. */
const telegramApi: Route = (url) => {
  if (url.hostname !== 'api.telegram.org') return undefined;
  if (url.pathname.endsWith('/sendMessage')) return { json: { ok: true, result: { message_id: 9001, date: 1 } } };
  if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'VOICE-1', file_size: 4000, file_path: 'voice/file_7.oga' } } };
  // D756 (#1896): the file's own bytes must name its container, so the fake is a real Ogg header.
  if (url.pathname.startsWith('/file/bot')) return { body: OGG_FILE, headers: { 'content-type': 'application/octet-stream' } };
  if (url.pathname.endsWith('/setWebhook')) return { json: { ok: true, result: true } };
  return undefined;
};

const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
const now = () => Math.floor(Date.now() / 1000);

let updateId = 100;
let tgMessageId = 500;
const tgUser = (id: string, extra: Record<string, unknown> = {}) => ({ id: Number(id), is_bot: false, first_name: 'Dana', username: 'dana_biz', ...extra });

const startUpdate = (code: string, tg = TG_ME) => ({
  update_id: ++updateId,
  message: { message_id: 1, date: now(), chat: { id: Number(tg), type: 'private' }, from: tgUser(tg), text: `/start ${code}` },
});
const connectionUpdate = (bc: string, tg: string, extra: Record<string, unknown> = { rights: { can_reply: true, can_read_messages: true } }, enabled = true) => ({
  update_id: ++updateId,
  business_connection: { id: bc, user: tgUser(tg), user_chat_id: Number(tg), date: now(), is_enabled: enabled, ...extra },
});
const businessMessage = (bc: string, o: { chat?: number; from?: number; id?: number; text?: string; voice?: unknown; key?: string } = {}) => ({
  update_id: ++updateId,
  [o.key ?? 'business_message']: {
    message_id: o.id ?? ++tgMessageId, business_connection_id: bc, date: now(),
    chat: { id: o.chat ?? 8001, type: 'private', first_name: 'Sam' },
    from: { id: o.from ?? o.chat ?? 8001, is_bot: false, first_name: 'Sam', last_name: 'Okafor' },
    ...(o.voice ? { voice: o.voice } : { text: o.text ?? 'We reconcile invoices by hand every Friday.' }),
  },
});

const waPayload = (pnid: string, value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '2000001', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001234', phone_number_id: pnid }, ...value } }] }],
});
const WA_CUSTOMER = '447700900123';
const waText = (pnid: string, wamid: string, text = 'Our month-end close takes four days.', from = WA_CUSTOMER) => waPayload(pnid, {
  contacts: [{ profile: { name: 'Priya Shah' }, wa_id: from }],
  messages: [{ from, id: wamid, timestamp: String(now()), type: 'text', text: { body: text } }],
});

function noSecretsSeen() {
  const all = seen.join('\n');
  for (const s of SECRET_VALUES) assert.equal(all.includes(s), false, 'a secret reached a response');
  assert.equal(all.includes(WA_CUSTOMER), false, 'a customer phone number reached a response');
}
test.afterEach(() => { noSecretsSeen(); seen.length = 0; activeApp = app; voiceJob = originalVoiceJob; });


const PNID_ADMIN = '1000009', TG_ADMIN = '555009', PLAIN_ADMIN = 5;
const providers = ['whatsapp', 'telegram'] as const;
type Provider = typeof providers[number];
const rolloutVar = (provider: Provider) => provider === 'whatsapp' ? 'WHATSAPP_CHANNEL' : 'TELEGRAM_CHANNEL';
const setMode = (env: any, mode: string) => { env.WHATSAPP_CHANNEL = mode; env.TELEGRAM_CHANNEL = mode; };
const signup = { code: 'fixture-code', waba_id: '2000022', phone_number_id: '3000002' };
const newToken = 'EAAG-new-business-token-SECRET';
const rows = (db: any, table: string) => {
  // Every caller below supplies one of these fixed fixture tables.
  const statements: Record<string, string> = {
    events: 'SELECT COUNT(*) n FROM channel_events', threads: 'SELECT COUNT(*) n FROM channel_threads',
    messages: 'SELECT COUNT(*) n FROM channel_thread_messages', outbound: 'SELECT COUNT(*) n FROM channel_outbound',
  };
  return count(db, statements[table]);
};

function graphStub(numbers = ['3000002']): Route {
  return (url, init) => {
    const tg = telegramApi(url, init);
    if (tg) return tg;
    if (url.hostname === 'lookaside.fbsbx.com') return { body: OGG_FILE, headers: { 'content-type': 'application/octet-stream' } };
    if (url.hostname !== 'graph.facebook.com') return undefined;
    if (url.pathname.endsWith('/oauth/access_token')) return { json: { access_token: newToken } };
    if (url.pathname.endsWith('/phone_numbers')) return { json: { data: numbers.map((id) => ({ id, display_phone_number: '15550001234', verified_name: 'Example business', messaging_limit_tier: 'TIER_10K' })) } };
    if (url.pathname.endsWith('/subscribed_apps')) return { json: { success: true } };
    if (url.pathname.includes('/MEDIA-')) return { json: { url: 'https://lookaside.fbsbx.com/fixture-audio', mime_type: 'audio/ogg', file_size: 4000 } };
    if (url.pathname.endsWith('/messages')) return { json: { messages: [{ id: 'fixture-sent-message' }] } };
    if (url.pathname.endsWith('/' + PNID) || url.pathname.endsWith('/' + PNID_ADMIN)) return { json: { id: PNID, messaging_limit_tier: 'TIER_10K', display_phone_number: '15550001234' } };
    return undefined;
  };
}

type World = Awaited<ReturnType<typeof world>> & { f: ReturnType<typeof mockFetch> };
async function withWorld(check: (w: World) => Promise<void>, opts: { seed?: boolean; budget?: number } = { seed: true }, route: Route = graphStub()) {
  const w = await world(opts);
  const f = mockFetch(route);
  try { await check({ ...w, f }); }
  finally { f.restore(); w.db.close(); }
}

async function seedAdmin(w: World) {
  const credentials = await encryptCredentials(w.env, 'wa-admin', { access_token: WA_TOKEN });
  w.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, config_json, credentials_enc)
    VALUES ('wa-admin', 1, 'whatsapp', 'oauth2', ?, ?, ?), ('tg-admin', 1, 'telegram', 'webhook', ?, '{}', NULL)`)
    .run(PNID_ADMIN, JSON.stringify({ phone_number_id: PNID_ADMIN, waba_id: '2000009' }), credentials, TG_ADMIN);
  w.db.prepare(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
    VALUES ('bc-admin', 'BC-ADMIN', ?, 1, 1, 1)`).run(TG_ADMIN);
}

let voiceId = 0;
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup');
async function incomingVoice(w: World, provider: Provider, days = 0) {
  const id = ++voiceId;
  const response = provider === 'whatsapp'
    ? await waHook(w.env, waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'fixture-voice-' + id,
      timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-' + id, mime_type: 'audio/ogg', voice: true } }] }))
    : await tgHook(w.env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 2, mime_type: 'audio/ogg' } }));
  assert.equal(response.status, 200);
  const thread = w.db.prepare('SELECT uid FROM channel_threads WHERE provider = ?').get(provider) as any;
  const note = w.db.prepare('SELECT uid FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL ORDER BY id DESC LIMIT 1').get() as any;
  const sent = new Date(Date.now() - days * 86_400_000).toISOString();
  w.db.prepare('UPDATE channel_thread_messages SET sent_at = ? WHERE uid = ?').run(sent, note.uid);
  return { thread: thread.uid as string, message: note.uid as string, sent };
}
async function assign(w: World, thread: string) {
  const result = await call(w.env, ME, 'POST', '/threads/' + thread + '/assign', { interview_id: INTERVIEW });
  assert.equal(result.status, 200);
  // D754 (#1893), D756 (#1977): a chat whose notes wait for consent waits for the
  // interviewee's. These cases test what follows it, so the chat says yes
  // (channel_consent_d754 tests getting there).
  const t = w.db.prepare('SELECT provider, consent_state FROM channel_threads WHERE uid = ?').get(thread) as any;
  if (audioConsentRequired(t?.provider) && t.consent_state !== 'given') await consentGiven(w.env, w.db, thread);
}
const hookText = (env: any, provider: Provider, id: string, admin = false) => provider === 'whatsapp'
  ? waHook(env, waText(admin ? PNID_ADMIN : PNID, id))
  : tgHook(env, businessMessage(admin ? 'BC-ADMIN' : 'BC-ME', { id: Number(id.replace(/\D/g, '')) || 600 }));

async function case1() {
  await withWorld(async ({ env, f }) => {
    for (const provider of providers) {
      const other = provider === 'whatsapp' ? 'telegram' : 'whatsapp';
      env[rolloutVar(other)] = 'on';
      env[rolloutVar(provider)] = 'canary';
      const baseline = (await call(env, ME, 'GET', '/')).body.providers.find((p: any) => p.provider === other);
      for (const value of [undefined, '', 'canary', 'Canary ', 'yes']) {
        if (value === undefined) delete env[rolloutVar(provider)]; else env[rolloutVar(provider)] = value;
        const member = (await call(env, ME, 'GET', '/')).body.providers;
        const row = member.find((p: any) => p.provider === provider);
        assert.deepEqual([row.available, row.signup, row.rollout], [false, undefined, undefined]);
        assert.deepEqual(member.find((p: any) => p.provider === other), baseline, 'each row follows only its own rollout var');
        const plain = (await call(env, PLAIN_ADMIN, 'GET', '/', undefined, 'admin')).body.providers.find((p: any) => p.provider === provider);
        assert.deepEqual([plain.available, plain.missing, plain.rollout], [false, [], undefined], 'users.is_super_admin is not elevation');
        const admin = (await call(env, ADMIN, 'GET', '/', undefined, 'admin')).body.providers.find((p: any) => p.provider === provider);
        assert.deepEqual([admin.available, admin.rollout], [true, 'canary']);
        if (provider === 'whatsapp') {
          assert.deepEqual(admin.signup, { app_id: SECRETS.WHATSAPP_APP_ID, config_id: SECRETS.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID, graph_version: GRAPH_VERSION });
          assert.match(admin.signup.graph_version, /^v\d{1,2}\.\d$/);
        }
      }
    }
    assert.equal(f.calls.length, 0);
    setMode(env, 'canary');
    assert.equal(await channelOpenToMember({ ...env, BRANCH_CODE: 'fixture' }, 'whatsapp', ADMIN), false, 'branches have no Super Admin elevation');
    // On/off do not require a D1 read; canary must use the elevation table.
    const noDb = { ...env, DB: { prepare() { throw new Error('no read expected'); } } };
    setMode(noDb, 'on');
    assert.equal(await channelOpenToMember(noDb, 'whatsapp', ME), true);
    setMode(noDb, 'off');
    assert.equal(await channelOpenToMember(noDb, 'telegram', ADMIN), false);
  });
}

async function case2() {
  await withWorld(async ({ env }) => {
    setMode(env, ' On ');
    for (const provider of providers) {
      const row = (await call(env, ME, 'GET', '/')).body.providers.find((p: any) => p.provider === provider);
      assert.equal(row.available, true);
      assert.equal(row.rollout, undefined);
      if (provider === 'whatsapp') assert.equal(row.signup.graph_version, GRAPH_VERSION);
    }
  });
}
async function case3() {
  await withWorld(async ({ env, db }) => {
    setMode(env, 'off');
    for (const who of [ME, ADMIN]) {
      const out = (await call(env, who, 'GET', '/', undefined, who === ADMIN ? 'admin' : 'founder')).body;
      for (const provider of providers) {
        const row = out.providers.find((p: any) => p.provider === provider);
        assert.equal(row.available, false);
        assert.equal(row.rollout, who === ADMIN ? 'off' : undefined);
        assert.equal(row.signup, undefined);
        if (who === ME) assert.equal(out.connections[provider].status, 'active');
      }
    }
    assert.equal(count(db, "SELECT COUNT(*) n FROM integrations WHERE user_id = 2 AND status = 'active'"), 2);
  });
}
async function case4() {
  await withWorld(async ({ env }) => {
    setMode(env, 'on');
    env.WHATSAPP_APP_SECRET = ''; env.TELEGRAM_CHANNEL_BOT_TOKEN = '';
    for (const who of [ME, ADMIN]) {
      const out = (await call(env, who, 'GET', '/', undefined, who === ADMIN ? 'admin' : 'founder')).body;
      for (const provider of providers) {
        const row = out.providers.find((p: any) => p.provider === provider);
        assert.equal(row.available, false);
        assert.equal(row.signup, undefined);
        assert.deepEqual(row.missing, who === ADMIN ? [provider === 'whatsapp' ? 'WHATSAPP_APP_SECRET' : 'TELEGRAM_CHANNEL_BOT_TOKEN'] : []);
      }
    }
  });
}
async function case5() {
  await withWorld(async ({ env, db, f }) => {
    setMode(env, 'canary');
    for (const [path, data] of [['/whatsapp/connect', signup], ['/telegram/link', {}]] as const) {
      const denied = await call(env, ME, 'POST', path, data);
      assert.deepEqual([denied.status, denied.body.code], [503, 'not_available']);
    }
    assert.equal(f.calls.length, 0);
    assert.equal((await call(env, ADMIN, 'POST', '/whatsapp/connect', signup, 'admin')).status, 200);
    assert.equal((await call(env, ADMIN, 'POST', '/telegram/link', {}, 'admin')).status, 200);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM integrations WHERE user_id = 1'), 1);
    const before = f.calls.length;
    setMode(env, 'off');
    for (const [path, data] of [['/whatsapp/connect', signup], ['/telegram/link', {}]] as const) {
      const denied = await call(env, ADMIN, 'POST', path, data, 'admin');
      assert.deepEqual([denied.status, denied.body.code], [503, 'not_available']);
    }
    assert.equal(f.calls.length, before);
  }, { seed: false });
}
async function case6() {
  await withWorld(async ({ env, db, f }) => {
    setMode(env, 'on');
    for (const [i, provider] of providers.entries()) assert.equal((await hookText(env, provider, String(700 + i))).status, 200);
    setMode(env, 'canary');
    for (const provider of providers) {
      const thread = db.prepare('SELECT uid FROM channel_threads WHERE provider = ?').get(provider) as any;
      const denied = await call(env, ME, 'POST', '/' + provider + '/test');
      assert.deepEqual([denied.status, denied.body.code], [503, 'not_available']);
      const reply = await call(env, ME, 'POST', '/threads/' + thread.uid + '/reply', { text: 'Example reply', client_key: provider });
      assert.deepEqual([reply.status, reply.body.code], [503, 'not_available']);
      assert.equal((await call(env, OTHER, 'POST', '/threads/' + thread.uid + '/reply', { text: 'No access', client_key: provider })).status, 404);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(rows(db, 'outbound'), 0);
    setMode(env, 'on');
    for (const provider of providers) {
      const thread = db.prepare('SELECT uid FROM channel_threads WHERE provider = ?').get(provider) as any;
      const reply = await call(env, ME, 'POST', '/threads/' + thread.uid + '/reply', { text: 'Example reply', client_key: provider });
      assert.deepEqual([reply.status, reply.body.ok], [200, true]);
    }
    assert.equal(rows(db, 'outbound'), 2);
  });
}
async function case7() {
  await withWorld(async ({ env, db, queued, f }) => {
    setMode(env, 'off');
    const payloads = [
      waText(PNID, 'off-text'),
      waPayload(PNID, { messages: [{ id: 'off-voice', from: WA_CUSTOMER, timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-OFF' } }] }),
      waPayload(PNID, { statuses: [{ id: 'off-status', status: 'sent', timestamp: String(now()) }] }),
    ];
    for (const payload of payloads) assert.deepEqual((await waHook(env, payload)).body, { ok: true, ignored: 'rollout_off' });
    for (const payload of [businessMessage('BC-ME'), businessMessage('BC-ME', { voice: { file_id: 'VOICE-1' } }), connectionUpdate('BC-ME', TG_ME)])
      assert.deepEqual((await tgHook(env, payload)).body, { ok: true, ignored: 'rollout_off' });
    for (const mode of ['off', 'on']) {
      setMode(env, mode);
      assert.equal((await waHook(env, payloads[0], null)).status, 401);
      assert.equal((await waHook(env, payloads[0], sign(JSON.stringify(payloads[0]), 'wrong-secret'))).status, 401);
      assert.equal((await tgHook(env, {}, null)).status, 401);
      assert.equal((await tgHook(env, {}, 'wrong-secret')).status, 401);
    }
    setMode(env, 'off');
    assert.equal((await tgHook({ ...env, TELEGRAM_CHANNEL_WEBHOOK_SECRET: '' }, {})).status, 503);
    assert.equal((await waHook({ ...env, WHATSAPP_APP_SECRET: '' }, payloads[0])).status, 503);
    const raw = '{';
    assert.equal((await send(env, '/api/channels/whatsapp/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': sign(raw) }, body: raw })).status, 400);
    let reads = 0;
    const body = new ReadableStream({ pull(ctrl) { reads++; ctrl.error(new Error('must not read in off')); } }, { highWaterMark: 0 });
    const noRead = await send(env, '/api/channels/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET }, body, duplex: 'half' } as RequestInit);
    assert.deepEqual([noRead.status, noRead.body, reads], [200, { ok: true, ignored: 'rollout_off' }, 0]);
    const challenge = '/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=' + SECRETS.WHATSAPP_VERIFY_TOKEN + '&hub.challenge=123';
    assert.deepEqual(await send(env, challenge, { method: 'GET' }), { status: 200, body: 123 });
    assert.equal((await send(env, challenge.replace(SECRETS.WHATSAPP_VERIFY_TOKEN, 'wrong'), { method: 'GET' })).status, 403);
    for (const table of ['events', 'threads', 'messages', 'outbound']) assert.equal(rows(db, table), 0);
    assert.equal(queued.length, 0);
    assert.equal(f.calls.length, 0);
  });
}
async function case8() {
  await withWorld(async (w) => {
    const { env, db, f } = w; setMode(env, 'canary'); await seedAdmin(w);
    for (const [index, provider] of providers.entries()) {
      const memberEvent = provider === 'whatsapp' ? waText(PNID, 'member-canary') : businessMessage('BC-ME', { id: 810 });
      const adminEvent = provider === 'whatsapp' ? waText(PNID_ADMIN, 'admin-canary') : businessMessage('BC-ADMIN', { id: 811 });
      const hook = (payload: any, targetEnv = env) => provider === 'whatsapp' ? waHook(targetEnv, payload) : tgHook(targetEnv, payload);
      assert.equal((await hook(memberEvent)).status, 200);
      const event = db.prepare('SELECT status, error FROM channel_events WHERE provider = ? ORDER BY id DESC LIMIT 1').get(provider) as any;
      assert.deepEqual([event.status, event.error], ['ignored', 'rollout']);
      assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads WHERE user_id = 2'), 0);
      assert.equal((await hook(adminEvent)).status, 200);
      assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads WHERE user_id = 1 AND provider = ?', provider), 1);
      const before = [rows(db, 'events'), rows(db, 'messages')];
      await hook(memberEvent); await hook(adminEvent);
      assert.deepEqual([rows(db, 'events'), rows(db, 'messages')], before, 'redelivery of stored or ignored events is a no-op');
      const errorEvent = provider === 'whatsapp' ? waText(PNID_ADMIN, 'admin-d1-error') : businessMessage('BC-ADMIN', { id: 812 + index });
      const original = env.DB;
      env.DB = { ...original, prepare(sql: string) {
        if (sql === 'SELECT id, role FROM users WHERE id = ?') throw new Error('rollout read unavailable');
        return original.prepare(sql);
      } };
      assert.equal((await hook(errorEvent)).status, 500);
      assert.equal(rows(db, 'events'), before[0], 'a D1 fault releases its claim');
      env.DB = original;
      assert.equal((await hook(errorEvent)).status, 200);
      assert.equal(rows(db, 'messages'), before[1] + 1);
      const hydrationEvent = provider === 'whatsapp' ? waText(PNID_ADMIN, 'admin-hydration-error') : businessMessage('BC-ADMIN', { id: 850 + index });
      env.DB = { ...original, prepare(sql: string) {
        if (sql === 'SELECT user_id FROM super_admins WHERE user_id = ?') throw new Error('elevation read unavailable');
        return original.prepare(sql);
      } };
      assert.equal((await hook(hydrationEvent)).status, 500, 'a swallowed auth hydration fault must still release the event');
      assert.equal(rows(db, 'events'), before[0] + 1);
      env.DB = original;
      assert.equal((await hook(hydrationEvent)).status, 200);
      assert.equal(rows(db, 'messages'), before[1] + 2);
    }
    // Management updates and link commands precede the member chat rollout check.
    await tgHook(env, connectionUpdate('BC-ME', TG_ME, { rights: { can_reply: true } }, false));
    assert.equal((db.prepare("SELECT is_enabled FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'").get() as any).is_enabled, 0);
    const code = await call(env, ADMIN, 'POST', '/telegram/link', {}, 'admin');
    assert.equal(code.status, 200);
    assert.equal((await tgHook(env, startUpdate(code.body.code, TG_NEW))).status, 200);
    assert.equal(count(db, "SELECT COUNT(*) n FROM channel_events WHERE kind = 'link' AND status = 'done'"), 1);
    assert.ok(f.calls.some((c) => c.url.includes('/sendMessage')));
  });
}
async function case9() {
  for (const provider of providers) await withWorld(async (w) => {
    setMode(w.env, 'on');
    await hookText(w.env, provider, '901');
    const firstThread = w.db.prepare('SELECT uid FROM channel_threads WHERE provider = ?').get(provider) as any;
    await assign(w, firstThread.uid);
    const note = await incomingVoice(w, provider);
    const job = voiceJobs(w.queued)[0]; assert.ok(job); assert.ok(job.payload.event);
    setMode(w.env, 'canary');
    await voiceJob(w.env, job.payload);
    assert.equal(w.f.calls.length, 0);
    const event = w.db.prepare('SELECT status, error FROM channel_events WHERE id = ?').get(job.payload.event) as any;
    assert.deepEqual([event.status, event.error], ['ignored', 'rollout']);
    const row = w.db.prepare('SELECT transcribe_error, transcribe_job FROM channel_thread_messages WHERE uid = ?').get(note.message) as any;
    assert.deepEqual([row.transcribe_error, row.transcribe_job], [null, null]);
    setMode(w.env, 'on');
    await assign(w, note.thread);
    const next = voiceJobs(w.queued).at(-1); assert.notEqual(next.payload.job, job.payload.job);
    await voiceJob(w.env, next.payload);
    await voiceJob(w.env, next.payload);
    assert.equal(w.aiCalls.length, 1);
  });
}
async function case10(unsubscribe = unsubscribeApp) {
  await withWorld(async (w) => {
    setMode(w.env, 'on');
    w.env.WHATSAPP_AXAL_PHONE_NUMBER_ID = ' 3000001 ';
    w.env.WHATSAPP_AXAL_WABA_ID = ' 2000077 ';
    for (const data of [{ ...signup, phone_number_id: '3000001' }, { ...signup, waba_id: '2000077' }]) {
      const result = await call(w.env, ME, 'POST', '/whatsapp/connect', data);
      assert.deepEqual([result.status, result.body.code, result.body.message], [409, 'axal_number', "This is Axal's own WhatsApp number. Connect your business's own number instead."]);
    }
    assert.equal(w.f.calls.length, 0);
  }, { seed: false });
  await withWorld(async (w) => {
    setMode(w.env, 'on'); w.env.WHATSAPP_AXAL_PHONE_NUMBER_ID = '3000001';
    const result = await call(w.env, ME, 'POST', '/whatsapp/connect', { code: signup.code, waba_id: signup.waba_id });
    assert.deepEqual([result.status, result.body.code], [409, 'axal_number']);
    assert.equal(w.f.calls.some((c) => c.method === 'POST' && c.url.includes('/subscribed_apps')), false);
    assert.equal(count(w.db, 'SELECT COUNT(*) n FROM integrations'), 0);
    delete w.env.WHATSAPP_AXAL_PHONE_NUMBER_ID;
    assert.equal((await call(w.env, ME, 'POST', '/whatsapp/connect', { code: signup.code, waba_id: signup.waba_id })).status, 200);
  }, { seed: false }, graphStub(['3000001']));
  await withWorld(async (w) => {
    const conn = await memberConnection(w.env, ME, 'whatsapp'); assert.ok(conn);
    w.env.WHATSAPP_AXAL_WABA_ID = ' 2000001 ';
    assert.equal(await unsubscribe(w.env, { ...conn!, phoneNumberId: PNID }), 'shared');
    assert.equal(w.f.calls.length, 0);
  });
}
async function case11() {
  await withWorld(async (w) => {
    setMode(w.env, 'on');
    for (const provider of providers) {
      const note = await incomingVoice(w, provider, 6);
      let read = (await call(w.env, ME, 'GET', '/threads/' + note.thread)).body;
      const message = read.messages.find((m: any) => m.uid === note.message);
      const expected = provider === 'whatsapp' ? new Date(Date.parse(note.sent) + 7 * 86_400_000).toISOString() : null;
      assert.equal(message.voice_fetch_by, expected);
      const d1 = note.sent.slice(0, 19).replace('T', ' ');
      w.db.prepare('UPDATE channel_thread_messages SET sent_at = ? WHERE uid = ?').run(d1, note.message);
      read = (await call(w.env, ME, 'GET', '/threads/' + note.thread)).body;
      assert.equal(read.messages.find((m: any) => m.uid === note.message).voice_fetch_by,
        provider === 'whatsapp' ? new Date(Date.parse(d1.replace(' ', 'T') + 'Z') + 7 * 86_400_000).toISOString() : null);
    }
    await waHook(w.env, waText(PNID, 'no-deadline-text'));
    const thread = w.db.prepare("SELECT uid FROM channel_threads WHERE provider = 'whatsapp'").get() as any;
    const read = (await call(w.env, ME, 'GET', '/threads/' + thread.uid)).body;
    assert.equal(read.messages.find((m: any) => m.kind === 'text').voice_fetch_by, null);
    assert.equal(voiceFetchBy('whatsapp', { awaiting_transcription: true, sent_at: 'invalid' }), null);
  });
}
async function expiryScenario(days: number, code: number, status: number, provider: Provider = 'whatsapp', download = false) {
  await withWorld(async (w) => {
    setMode(w.env, 'on'); const note = await incomingVoice(w, provider, days); await assign(w, note.thread);
    await voiceJob(w.env, voiceJobs(w.queued)[0].payload);
    const row = w.db.prepare('SELECT transcribe_error, transcribe_job FROM channel_thread_messages WHERE uid = ?').get(note.message) as any;
    const read = (await call(w.env, ME, 'GET', '/threads/' + note.thread)).body;
    const failure = read.messages.find((m: any) => m.uid === note.message).transcription_failure;
    const expired = provider === 'whatsapp' && days > 7 && !download && code === 100 && status === 400;
    assert.equal(failure.reason, expired ? 'expired' : code === 190 ? 'reconnect' : status >= 500 ? 'retrying' : 'unreadable');
    if (expired) {
      assert.equal(row.transcribe_error, 'expired');
      assert.equal(failure.sentence, 'WhatsApp keeps a voice note for 7 days; this one can no longer be fetched.');
      assert.equal(failure.retry, null);
      const retry = await call(w.env, ME, 'POST', '/threads/' + note.thread + '/voice/' + note.message + '/retry');
      assert.deepEqual([retry.status, retry.body.code], [409, 'voice_not_retryable']);
      const jobs = voiceJobs(w.queued).length, calls = w.f.calls.length;
      await assign(w, note.thread);
      assert.equal(voiceJobs(w.queued).length, jobs);
      assert.equal(w.f.calls.length, calls);
    }
    assert.equal(w.aiCalls.length, 0);
  }, { seed: true }, (url, init) => {
    if (provider === 'telegram' && url.pathname.endsWith('/getFile')) return { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request' } };
    if (url.pathname.includes('/MEDIA-')) return download
      ? { json: { url: 'https://lookaside.fbsbx.com/fixture-audio', mime_type: 'audio/ogg' } }
      : { status, json: { error: { code, message: 'fixture refusal' } } };
    if (download && url.hostname === 'lookaside.fbsbx.com') return { status: 404, body: '' };
    return graphStub()(url, init);
  });
}
async function case12() {
  await expiryScenario(8, 100, 400);
  await expiryScenario(1, 100, 400);
  await expiryScenario(8, 190, 400);
  await expiryScenario(8, 10, 400);
  await expiryScenario(8, 100, 503);
  await expiryScenario(8, 100, 400, 'telegram');
  await expiryScenario(8, 100, 400, 'whatsapp', true);
  // A usable old id still succeeds: the clock itself cannot expire it.
  await withWorld(async (w) => {
    setMode(w.env, 'on'); const note = await incomingVoice(w, 'whatsapp', 8); await assign(w, note.thread);
    await voiceJob(w.env, voiceJobs(w.queued)[0].payload);
    assert.equal(w.aiCalls.length, 1);
  });
}
async function case13(eligibility = callingEligibility) {
  const current = '2026-10-18T00:00:00.000Z';
  const rec = (display_phone_number: string, messaging_limit_tier: string) => ({ calling: callingRecord({ display_phone_number, messaging_limit_tier }, new Date(current)) });
  const result = eligibility(rec('+15550001234', 'TIER_10K'));
  assert.deepEqual(result.inbound.reasons.map((r) => r.code), ['not_built']);
  assert.deepEqual(result.outbound.reasons.map((r) => r.code), ['not_built', 'region']);
  const egypt = eligibility(rec('+201000000000', 'TIER_250'));
  assert.deepEqual(egypt.inbound.reasons.map((r) => r.code), ['not_built', 'tier_low']);
  assert.deepEqual(egypt.outbound.reasons.map((r) => r.code), ['not_built', 'tier_low', 'region']);
  const unchecked = eligibility({});
  assert.deepEqual(unchecked.inbound.reasons.map((r) => r.code), ['not_built', 'not_checked']);
  assert.deepEqual(unchecked.outbound.reasons, unchecked.inbound.reasons);
  const unknown = eligibility({ calling: { tier: null, region: null, checked_at: current } });
  assert.deepEqual(unknown.inbound.reasons.map((r) => r.code), ['not_built', 'tier_unknown']);
  assert.deepEqual(unknown.outbound.reasons.map((r) => r.code), ['not_built', 'tier_unknown', 'region_unknown']);
  for (const out of [result, egypt, unchecked, unknown]) assert.deepEqual([out.available, out.inbound.available, out.outbound.available], [false, false, false]);
  assert.deepEqual({ available: result.available, reasons: result.reasons, sentence: result.sentence, tier: result.tier, checked_at: result.checked_at }, {
    available: false,
    reasons: [
      { code: 'not_built', sentence: 'Axal does not answer or place WhatsApp calls yet.' },
      { code: 'region', sentence: 'Meta does not offer business-initiated calls for numbers in the US or Canada (+1).' },
    ],
    sentence: 'Calls: not yet, because Axal does not answer or place WhatsApp calls yet; Meta does not offer business-initiated calls for numbers in the US or Canada (+1).',
    tier: 'TIER_10K', checked_at: current,
  });
}

async function case14() {
  await withWorld(async (w) => {
    Object.assign(w.env, {
      WHATSAPP_AXAL_ACCESS_TOKEN: WA_TOKEN, WHATSAPP_AXAL_PHONE_NUMBER_ID: '3000001',
      WHATSAPP_AXAL_WABA_ID: '3000003', WHATSAPP_AXAL_DISPLAY_NUMBER: '+15550009999',
    });
    setMode(w.env, 'canary');
    assert.equal((await call(w.env, ME, 'POST', '/whatsapp/link')).status, 503);
    assert.equal(count(w.db, "SELECT COUNT(*) n FROM channel_link_codes WHERE provider = 'whatsapp_link'"), 0);
    assert.equal((await call(w.env, ADMIN, 'POST', '/whatsapp/link', undefined, 'admin')).status, 200);
    setMode(w.env, 'off');
    assert.equal((await call(w.env, ADMIN, 'POST', '/whatsapp/link', undefined, 'admin')).status, 503);
    setMode(w.env, 'on');
    const code = (await call(w.env, ME, 'POST', '/whatsapp/link')).body.code;
    assert.equal((await waHook(w.env, waText('3000001', 'axal-link', 'LINK ' + code))).status, 200);
    const claim = (await call(w.env, ME, 'GET', '/whatsapp/link')).body.claim;
    setMode(w.env, 'canary');
    assert.equal((await call(w.env, ME, 'POST', '/whatsapp/link/' + claim.uid + '/confirm')).status, 503);
    assert.equal(count(w.db, "SELECT COUNT(*) n FROM integrations WHERE provider_key = 'whatsapp_link'"), 0);
    setMode(w.env, 'on');
    assert.equal((await call(w.env, ME, 'POST', '/whatsapp/link/' + claim.uid + '/confirm')).status, 200);
    w.db.exec("UPDATE integrations SET last_synced_at = '2026-01-01T00:00:00.000Z' WHERE provider_key = 'whatsapp_link'");
    setMode(w.env, 'canary');
    const calls = w.f.calls.length;
    assert.equal((await waHook(w.env, waText('3000001', 'axal-closed-capture'))).status, 200);
    const event = w.db.prepare('SELECT status, error FROM channel_events ORDER BY id DESC LIMIT 1').get() as any;
    assert.deepEqual([event.status, event.error], ['ignored', 'rollout']);
    assert.equal((w.db.prepare("SELECT last_synced_at FROM integrations WHERE provider_key = 'whatsapp_link'").get() as any).last_synced_at, '2026-01-01T00:00:00.000Z');
    assert.equal(w.f.calls.length, calls);
    // Existing links remain readable; unlink/STOP are management, even in canary.
    assert.ok((await call(w.env, ME, 'GET', '/whatsapp/link')).body.link);
    assert.equal((await waHook(w.env, waText('3000001', 'axal-stop', 'STOP'))).status, 200);
    assert.equal(w.f.calls.length, calls + 1);
    assert.equal((await call(w.env, ME, 'GET', '/whatsapp/link')).body.link, null);
  }, { seed: false });
}

const cases = [case1, case2, case3, case4, case5, case6, case7, case8, case9, case10, case11, case12, case13, case14];
for (const [index, check] of cases.entries()) test('D754 ' + (index + 1) + ': ' + check.name, () => check());

/**
 * Mutations run in process as isolated data-URL modules, following D684's
 * existing deadline checks. No tracked file is edited; ordinary code is
 * restored after each mutation and the same positive case is run again.
 */
let mutationId = 0;
async function mutated(path: string, before: string, after: string, overrides: Record<string, string> = {}, all = false): Promise<any> {
  const file = new URL(path, import.meta.url);
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(before), 'mutation target must exist: ' + before.slice(0, 80));
  const { stripTypeScriptTypes } = await import('node:module');
  const changed = all ? original.split(before).join(after) : original.replace(before, () => after);
  let source = stripTypeScriptTypes(changed, { mode: 'strip' });
  source = source.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_match, prefix, spec, quote) => prefix + (overrides[spec] ?? (spec.startsWith('.')
      ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href
      : import.meta.resolve(spec))) + quote);
  const url = 'data:text/javascript;base64,' + Buffer.from(source + '\n// D754 mutation ' + ++mutationId).toString('base64');
  return { module: await import(url), url };
}
const routePath = '../src/routes/channels.ts';
const connectionPath = '../src/services/channels/connections.ts';
const whatsappPath = '../src/services/channels/whatsapp.ts';
const failurePath = '../src/services/channels/voiceFailures.ts';
const threadPath = '../src/services/channels/threads.ts';
type Mutation = {
  name: string; path: string; before: string; after: string; check: () => Promise<void>;
  dependency?: string; all?: boolean;
};
const mutations: Mutation[] = [
  ...['/whatsapp/link', '/whatsapp/link/:uid/confirm'].map((path): Mutation => ({
    name: 'Axal-number ' + path + ' bypasses canary', path: routePath,
    before: `channels.post('${path}', venture(async (c, user) => {\n  if (!waLink.axalNumberReady(c.env) || !channelOpenTo(c.env, 'whatsapp', user))`,
    after: `channels.post('${path}', venture(async (c, user) => {\n  if (!waLink.axalNumberReady(c.env))`, check: case14,
  })),
  { name: 'Axal-number captures ignore canary', path: routePath,
    before: "if (!(await channelOpenToMember(env, 'whatsapp', Number(link.user_id)))) {", after: 'if (false) {', check: case14 },

  { name: 'hydration read fault acknowledges an event', path: connectionPath,
    before: 'if (hydrationError) throw hydrationError;', after: '', check: case8, dependency: '../services/channels/connections' },
  {"name":"telegram off bypasses authentication","path":"../src/routes/channels.ts","before":"  const check = await telegram.verifyTelegramSecret(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token'));","after":"  if (channelRollout(c.env, 'telegram') === 'off') return c.json({ ok: true, ignored: 'rollout_off' });\n  const check = await telegram.verifyTelegramSecret(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token'));", check: case7 },
  {"name":"whatsapp off bypasses authentication","path":"../src/routes/channels.ts","before":"  const check = await whatsapp.verifyWhatsAppSignature(c.env, raw, c.req.header('X-Hub-Signature-256'));","after":"  if (channelRollout(c.env, 'whatsapp') === 'off') return c.json({ ok: true, ignored: 'rollout_off' });\n  const check = await whatsapp.verifyWhatsAppSignature(c.env, raw, c.req.header('X-Hub-Signature-256'));", check: case7 },
  { name: 'rollout shown to non-elevated admins', path: routePath, before: "chat && isSuperAdmin(user) ? { rollout:", after: "chat ? { rollout:", check: case1 },
  { name: 'Graph version omitted', path: routePath, before: ", graph_version: whatsapp.GRAPH_VERSION", after: "", check: case1 },

  { name: 'absent mode becomes on', path: connectionPath, before: "return mode === 'off' || mode === 'on' ? mode : 'canary';", after: "return mode === 'off' || mode === 'on' ? mode : 'on';", check: case1, dependency: '../services/channels/connections' },
  { name: 'one provider var drives both rows', path: connectionPath, before: "const raw = provider === 'whatsapp' ? env.WHATSAPP_CHANNEL : env.TELEGRAM_CHANNEL;", after: 'const raw = env.WHATSAPP_CHANNEL;', check: case1, dependency: '../services/channels/connections' },
  { name: 'plain admin treated as elevated', path: connectionPath, before: "mode === 'canary' && isSuperAdmin(user)", after: "mode === 'canary' && user.role === 'admin'", check: case1, dependency: '../services/channels/connections' },
  { name: 'member elevation trusts users column', path: connectionPath,
    before: "return isSuperAdmin(hydrated);",
    after: "return isSuperAdmin((await env.DB.prepare('SELECT role, is_super_admin FROM users WHERE id = ?').bind(userId).first()) as any);",
    check: async () => {
      await withWorld(async (w) => {
        setMode(w.env, 'canary');
        const credentials = await encryptCredentials(w.env, 'wa-plain', { access_token: WA_TOKEN });
        w.db.prepare("INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, config_json, credentials_enc) VALUES ('wa-plain', 5, 'whatsapp', 'oauth2', '1000005', '{}', ?)").run(credentials);
        await waHook(w.env, waText('1000005', 'plain-admin-webhook'));
        assert.equal(rows(w.db, 'messages'), 0);
      });
    }, dependency: '../services/channels/connections' },
  { name: 'on treated as canary', path: connectionPath, before: "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", after: "return mode === 'canary' && isSuperAdmin(user);", check: case2, dependency: '../services/channels/connections' },
  { name: 'off opens to Super Admin', path: connectionPath, before: "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", after: "return mode === 'on' || isSuperAdmin(user);", check: case3, dependency: '../services/channels/connections' },
  { name: 'GET ignores missing secrets', path: routePath, before: "const available = a.available && (!chat || channelOpenTo(env, a.provider as MessagingProvider, user));", after: "const available = !chat || channelOpenTo(env, a.provider as MessagingProvider, user);", check: case4 },
  ...providers.map((provider): Mutation => ({ name: provider + ' connect/link skips rollout', path: routePath,
    before: `if (!providerAvailable(c.env, '${provider}') || !channelOpenTo(c.env, '${provider}', user))`, after: `if (!providerAvailable(c.env, '${provider}'))`, check: case5 })),
  { name: 'test skips rollout', path: routePath, before: "if (!providerAvailable(c.env, provider as MessagingProvider) || !channelOpenTo(c.env, provider as MessagingProvider, user))", after: 'if (false)', check: case6 },
  { name: 'reply skips rollout', path: routePath, before: "if (!providerAvailable(env, thread.provider) || !channelOpenTo(env, thread.provider, user))", after: 'if (false)', check: case6 },
  ...providers.map((provider): Mutation => ({ name: provider + ' off claims events', path: routePath,
    before: `if (channelRollout(c.env, '${provider}') === 'off') return c.json({ ok: true, ignored: 'rollout_off' });`,
    after: '', check: case7 })),
  { name: 'canary event check omitted', path: routePath, before: "if (!(await channelOpenToMember(env, conn.provider, conn.userId))) {", after: 'if (false) {', check: case8 },
  { name: 'job downloads while closed', path: routePath, before: "if (!(await channelOpenToMember(env, conn.provider, conn.userId))) return giveBack('ignored', 'rollout');", after: '', check: case9 },
  { name: 'resolved Axal number can subscribe', path: whatsappPath, before: "    if (isAxal()) return { ok: false, status: 409, code: 'axal_number' };\n    if (await isTaken(input.phoneNumberId))", after: "    if (await isTaken(input.phoneNumberId))", check: case10, dependency: '../services/channels/whatsapp' },
  { name: 'Axal number comparison is not trimmed', path: whatsappPath, before: "String(env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? '').trim()", after: "String(env.WHATSAPP_AXAL_PHONE_NUMBER_ID ?? '')", check: case10, dependency: '../services/channels/whatsapp' },
  { name: 'Telegram given a media deadline', path: failurePath, before: '!msg.awaiting_transcription || days == null', after: '!msg.awaiting_transcription', check: case11, dependency: '../services/channels/voiceFailures' },
  { name: 'text gets a deadline', path: failurePath, before: '!msg.awaiting_transcription || days == null', after: 'days == null', check: case11, dependency: '../services/channels/voiceFailures' },
  { name: 'recent lookup marked expired', path: routePath, before: "fetchBy !== null && Date.now() >= Date.parse(fetchBy)", after: 'fetchBy !== null', check: case12 },
  { name: 'download failure marked expired', path: routePath, before: "'lookup' in audio && audio.lookup === true", after: 'true', check: case12 },
  { name: 'token refusal marked expired', path: routePath, before: "!['token_invalid', 'forbidden', 'not_connected'].includes(audio.code)", after: 'true', check: case12 },
  { name: 'queue reclaims expired placeholders', path: threadPath, before: "AND (transcribe_error IS NULL OR transcribe_error != 'expired')", after: '', all: true, check: case12, dependency: '../services/channels/threads' },
];
for (const m of mutations) {
  test('D754 mutation: ' + m.name, async () => {
    const changed = await mutated(m.path, m.before, m.after, {}, m.all);
    const route = m.dependency
      ? await mutated(routePath, 'const channels = new Hono', 'const channels = new Hono', { [m.dependency]: changed.url })
      : changed;
    activeApp = new Hono().route('/api/channels', route.module.default);
    voiceJob = route.module.runVoiceFollowup;
    try { await assert.rejects(() => m.check(), { name: 'AssertionError' }); }
    finally { activeApp = app; voiceJob = originalVoiceJob; }
    await m.check();
  });
}
test('D754 mutation: region applies to inbound too', async () => {
  const m = await mutated(whatsappPath, "side === 'outbound' || audience === 'both'", 'true');
  await assert.rejects(() => case13(m.module.callingEligibility), { name: 'AssertionError' });
  await case13();
});

test('D754 mutation: reply checks rollout after claiming outbound', async () => {
  const gate = "  if (!providerAvailable(env, thread.provider) || !channelOpenTo(env, thread.provider, user)) return no(c, 503, 'not_available');";
  const source = readFileSync(new URL(routePath, import.meta.url), 'utf8');
  const changed = source.replace(gate, '').replace('  // The same client_key again:', () => gate + '\n  // The same client_key again:');
  const m = await mutated(routePath, source, changed);
  activeApp = new Hono().route('/api/channels', m.module.default);
  try { await assert.rejects(case6, { name: 'AssertionError' }); }
  finally { activeApp = app; }
  await case6();
});
test('D754 mutation: a member unsubscribes Axal’s WABA', async () => {
  const m = await mutated(whatsappPath, "if (waba && waba === String(env.WHATSAPP_AXAL_WABA_ID ?? '').trim()) return 'shared';", '');
  await assert.rejects(() => case10(m.module.unsubscribeApp), { name: 'AssertionError' });
  await case10();
});
