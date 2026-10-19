/**
 * The D684 channel harness (#1576), shared by the channel tests: the SQLite
 * D1 world with the channel migrations, the member and webhook callers, and a
 * mocked `globalThis.fetch` whose unexpected URL fails the test, so nothing
 * reaches a real provider. Moved here unchanged from
 * channels_messaging_d684.test.ts for D754 (#1893), which shares it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import channels, { channelsAdmin } from '../src/routes/channels.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';

/** Provider ids are stored hashed (events.ts `refKey`); the tests look them up the same way. */
export const refCode = (code: string) => createHash('sha256').update(code).digest('hex');
export const ref = (provider: string, id: string) => createHash('sha256').update(`${provider}:${id}`).digest('hex');

export const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
export const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
export const ADMIN = 1, ME = 2, OTHER = 3, GONE = 4, FOUNDER = 9;
export const PROJECT = 7, OTHER_PROJECT = 8;
export const INTERVIEW = 101;
export const TG_ME = '555001', TG_OTHER = '555002', TG_NEW = '555003';
export const PNID = '1000001', PNID_GONE = '1000004';
export const WA_TOKEN = 'EAAG-member-business-token-SECRET';

export const SECRETS = {
  TELEGRAM_CHANNEL_BOT_TOKEN: '123456:tg-bot-token-SECRET',
  TELEGRAM_CHANNEL_BOT_USERNAME: 'axal_interviews_bot',
  TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'tg_webhook_SECRET_1',
  WHATSAPP_APP_ID: '424242',
  WHATSAPP_APP_SECRET: 'wa-app-SECRET-value',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify-SECRET',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '777888',
};
export const SECRET_VALUES = [SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN, SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET, SECRETS.WHATSAPP_APP_SECRET,
  SECRETS.WHATSAPP_VERIFY_TOKEN, WA_TOKEN, 'EAAG-new-business-token-SECRET'];

export async function world(opts: { seed?: boolean; budget?: number } = {}) {
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
    // D685: openSession stores the call (call_provider), as production's 452 lets it.
    '452_record_session_setup.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    // D754 (#1893): the consent store and channel_threads.consent_state.
    '488_channel_consents.sql', '492_whatsapp_sender_links.sql']) db.exec(mig(m));
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  if (opts.budget != null) {
    for (const key of ['founder:free', 'other']) {
      db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)').run(key, opts.budget, opts.budget);
    }
  }
  const queued: any[] = [];
  const aiCalls: any[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48), ...SECRETS,
    WHATSAPP_CHANNEL: 'on', TELEGRAM_CHANNEL: 'on',
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    RATE_LIMITS: memKV(), USE_CF_QUEUE: 'true',
    JOB_QUEUE: { async send(body: any) { queued.push(body); } },
    AI: { async run(model: string, input: any) { aiCalls.push({ model, input }); return { text: 'We lose a whole day every month to this.', transcription_info: { language: 'en' } }; } },
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

export const app = (() => {
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
export const seen: string[] = [];

export async function send(env: any, path: string, init: RequestInit) {
  const res = await app.fetch(new Request(`https://axal.vc${path}`, init), env);
  const text = await res.text();
  seen.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

export async function call(env: any, user: number, method: string, path: string, body?: unknown, role = 'founder') {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return send(env, `/api/channels${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function tgHook(env: any, update: unknown, secret: string | null = SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return send(env, '/api/channels/telegram/webhook', { method: 'POST', headers, body: JSON.stringify(update) });
}

export const sign = (raw: string, secret = SECRETS.WHATSAPP_APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

export function waHook(env: any, payload: unknown, signature?: string | null) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = signature === undefined ? sign(raw) : signature;
  if (sig !== null) headers['X-Hub-Signature-256'] = sig;
  return send(env, '/api/channels/whatsapp/webhook', { method: 'POST', headers, body: raw });
}

export type Reply = { status?: number; json?: unknown; body?: BodyInit; headers?: Record<string, string> };
export type Route = (url: URL, init: RequestInit) => Reply | undefined;

/** Mock every provider: a URL no route answers fails the test. */
export function mockFetch(route: Route) {
  const calls: { url: string; method: string; body: any; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    let body: any = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* raw */ } }
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    calls.push({ url: url.toString(), method: String(init.method ?? 'GET'), body, auth });
    const r = route(url, init);
    if (!r) throw new Error(`unexpected fetch ${url.origin}${url.pathname}`);
    const payload = r.body ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(payload, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Telegram's Bot API, as far as these tests use it. */
export const telegramApi: Route = (url) => {
  if (url.hostname !== 'api.telegram.org') return undefined;
  if (url.pathname.endsWith('/sendMessage')) return { json: { ok: true, result: { message_id: 9001, date: 1 } } };
  if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'VOICE-1', file_size: 4000, file_path: 'voice/file_7.oga' } } };
  if (url.pathname.startsWith('/file/bot')) return { body: new Uint8Array(4000).fill(7), headers: { 'content-type': 'audio/ogg' } };
  if (url.pathname.endsWith('/setWebhook')) return { json: { ok: true, result: true } };
  return undefined;
};

export const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);
export const now = () => Math.floor(Date.now() / 1000);

/** Telegram update and message ids, counted up by every builder (and by a test that builds its own). */
export const ids = { update: 100, message: 500 };
export const tgUser = (id: string, extra: Record<string, unknown> = {}) => ({ id: Number(id), is_bot: false, first_name: 'Dana', username: 'dana_biz', ...extra });

export const startUpdate = (code: string, tg = TG_ME) => ({
  update_id: ++ids.update,
  message: { message_id: 1, date: now(), chat: { id: Number(tg), type: 'private' }, from: tgUser(tg), text: `/start ${code}` },
});
export const confirmUpdate = (tg = TG_ME) => ({
  update_id: ++ids.update,
  message: { message_id: 2, date: now(), chat: { id: Number(tg), type: 'private' }, from: tgUser(tg), text: '/confirm' },
});
/** Both steps of linking: the code, then the Telegram account's own /confirm. */
export async function linkTelegram(env: any, code: string, tg = TG_ME) {
  await tgHook(env, startUpdate(code, tg));
  await tgHook(env, confirmUpdate(tg));
  const owner = Number((await env.DB.prepare('SELECT user_id FROM channel_link_codes WHERE code_hash = ?').bind(refCode(code)).first<any>()).user_id);
  const { claim } = (await call(env, owner, 'GET', '/telegram/link')).body;
  return call(env, owner, 'POST', `/telegram/link/${claim.uid}/confirm`);
}
export const connectionUpdate = (bc: string, tg: string, extra: Record<string, unknown> = { rights: { can_reply: true, can_read_messages: true } }, enabled = true) => ({
  update_id: ++ids.update,
  business_connection: { id: bc, user: tgUser(tg), user_chat_id: Number(tg), date: now(), is_enabled: enabled, ...extra },
});
export const businessMessage = (bc: string, o: { chat?: number; from?: number; id?: number; text?: string; voice?: unknown; key?: string } = {}) => ({
  update_id: ++ids.update,
  [o.key ?? 'business_message']: {
    message_id: o.id ?? ++ids.message, business_connection_id: bc, date: now(),
    chat: { id: o.chat ?? 8001, type: 'private', first_name: 'Sam' },
    from: { id: o.from ?? o.chat ?? 8001, is_bot: false, first_name: 'Sam', last_name: 'Okafor' },
    ...(o.voice ? { voice: o.voice } : { text: o.text ?? 'We reconcile invoices by hand every Friday.' }),
  },
});

export const waPayload = (pnid: string, value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '2000001', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001234', phone_number_id: pnid }, ...value } }] }],
});
export const WA_CUSTOMER = '447700900123';
export const waText = (pnid: string, wamid: string, text = 'Our month-end close takes four days.', from = WA_CUSTOMER) => waPayload(pnid, {
  contacts: [{ profile: { name: 'Priya Shah' }, wa_id: from }],
  messages: [{ from, id: wamid, timestamp: String(now()), type: 'text', text: { body: text } }],
});

/**
 * D754 (#1893): a WhatsApp chat keeps nothing until its consent is given. The
 * state the interviewee's Yes leaves (the row, the thread, the session), then
 * the follow-up job that moves what waited — for the cases here that test
 * what happens after it. channel_consent_d754.test.ts tests getting there.
 */
export async function consentGiven(env: any, db: any, threadUid: string) {
  const t = db.prepare('SELECT * FROM channel_threads WHERE uid = ?').get(threadUid);
  const uid = crypto.randomUUID();
  db.prepare(`INSERT INTO channel_consents (uid, user_id, provider, integration_id, thread_id, interview_id, session_id,
                source, method, status, notice_version, answered_at)
              VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, 'interviewee_reply', 'chat_reply', 'given', 1, datetime('now'))`)
    .run(uid, t.user_id, t.integration_id, t.id, t.interview_id, t.session_id);
  db.prepare(`UPDATE channel_threads SET consent_state = 'given' WHERE id = ?`).run(t.id);
  db.prepare(`UPDATE interview_sessions SET consent_status = 'given', consent_method = 'chat_reply', consent_at = datetime('now') WHERE id = ?`).run(t.session_id);
  await runChannelJob(env, 'channel_followup', { provider: 'whatsapp', kind: 'consent', thread: threadUid, consent: uid });
}

export function noSecretsSeen() {
  const all = seen.join('\n');
  for (const s of SECRET_VALUES) assert.equal(all.includes(s), false, 'a secret reached a response');
  assert.equal(all.includes(WA_CUSTOMER), false, 'a customer phone number reached a response');
}
