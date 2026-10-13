/**
 * D684 (#1576) — Telegram Business and WhatsApp Business: the adapters, the
 * member routes and the webhooks, on the SQLite D1 harness with every
 * provider call answered by a mocked `globalThis.fetch` (an unexpected URL
 * fails the test — nothing reaches a real provider).
 *
 * What these prove:
 *   · Telegram: a forged or missing secret is 401 and stores nothing, before
 *     the body is read; an unset one is 503. `/start <code>` links nothing on
 *     its own: the bot names the Axal account, and only that Telegram
 *     account's own /confirm, within ten minutes, links it — so a member's
 *     code sent to someone else's account hands over none of its chats. An
 *     account another member holds is refused and nothing is stored. A
 *     business connection before linking stores only its row and prompts the
 *     owner; after linking its messages arrive pending, encrypted; edits,
 *     deletions and duplicates behave; a disabled connection is nobody.
 *   · Voice notes: on a pending chat, a placeholder with no text and no job —
 *     no download, no model; the member's assignment queues them, ids only,
 *     and each lands once, even when its record fails mid-way. A note deleted
 *     at the source is never transcribed. A spent budget, the connection's
 *     daily cap (D1, fails closed) or an oversize note runs nothing.
 *   · The per-connection limit trips by a D1 count (KV could never count that
 *     fast) and fails open; webhook bodies are capped without Content-Length.
 *   · WhatsApp: the challenge echoes only for the right token; a forged or
 *     missing signature is 401; text, voice, app echoes and statuses land
 *     where they should; a duplicate is processed once; an unknown number is
 *     ignored; Embedded Signup stores the token encrypted and refuses a number
 *     outside the WABA or held by another member. No wamid rides in a job.
 *     Disconnecting leaves the app subscribed while another member's number
 *     shares the WABA.
 *   · Replies: once per client_key, never outside the 24-hour window; a send
 *     the provider took answers sent even when its outcome could not be
 *     saved, and a key whose first attempt never finished is never called
 *     sent or sent again.
 *   · Another member's thread is not there (404) for every thread route.
 *   · No response carries a platform secret, a token or a phone number;
 *     availability names missing secrets to admins only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channels_messaging_d684.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import channels, { channelsAdmin } from '../src/routes/channels.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { transcriptionFailures } from '../src/services/channels/voiceFailures.ts';
import { createLinkCode } from '../src/services/channels/linkCodes.ts';
import { normaliseTelegramUpdate } from '../src/services/channels/telegram.ts';
import { normaliseWhatsAppPayload, maskNumber } from '../src/services/channels/whatsapp.ts';
import { CHANNEL_LIMITS } from '../src/services/channels/types.ts';

/** Provider ids are stored hashed (events.ts `refKey`); the tests look them up the same way. */
const ref = (provider: string, id: string) => createHash('sha256').update(`${provider}:${id}`).digest('hex');

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, ME = 2, OTHER = 3, GONE = 4, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101;
const TG_ME = '555001', TG_OTHER = '555002', TG_NEW = '555003';
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
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql']) db.exec(mig(m));
  if (opts.budget != null) {
    for (const key of ['founder:free', 'other']) {
      db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)').run(key, opts.budget, opts.budget);
    }
  }
  const queued: any[] = [];
  const aiCalls: any[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48), ...SECRETS,
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
const seen: string[] = [];

async function send(env: any, path: string, init: RequestInit) {
  const res = await app.fetch(new Request(`https://axal.vc${path}`, init), env);
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
  return send(env, `/api/channels${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
const telegramApi: Route = (url) => {
  if (url.hostname !== 'api.telegram.org') return undefined;
  if (url.pathname.endsWith('/sendMessage')) return { json: { ok: true, result: { message_id: 9001, date: 1 } } };
  if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'VOICE-1', file_size: 4000, file_path: 'voice/file_7.oga' } } };
  if (url.pathname.startsWith('/file/bot')) return { body: new Uint8Array(4000).fill(7), headers: { 'content-type': 'audio/ogg' } };
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
const confirmUpdate = (tg = TG_ME) => ({
  update_id: ++updateId,
  message: { message_id: 2, date: now(), chat: { id: Number(tg), type: 'private' }, from: tgUser(tg), text: '/confirm' },
});
/** Both steps of linking: the code, then the Telegram account's own /confirm. */
async function linkTelegram(env: any, code: string, tg = TG_ME) {
  await tgHook(env, startUpdate(code, tg));
  return tgHook(env, confirmUpdate(tg));
}
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
test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

test('Telegram updates normalise into the contract shapes', () => {
  const link = normaliseTelegramUpdate(startUpdate('abcdefghjkmnpqrstuvwxyzA'));
  assert.equal(link.kind, 'link');
  assert.equal((link as any).displayName, '@dana_biz');

  const conn = normaliseTelegramUpdate(connectionUpdate('BC-9', TG_ME)) as any;
  assert.equal(conn.kind, 'connection');
  assert.equal(conn.canReply, true, 'Bot API 9.0 rights');
  const legacy = normaliseTelegramUpdate(connectionUpdate('BC-9', TG_ME, { can_reply: true })) as any;
  assert.equal(legacy.canReply, true, 'the pre-9.0 can_reply still reads');
  const noRight = normaliseTelegramUpdate(connectionUpdate('BC-9', TG_ME, { rights: { can_read_messages: true } })) as any;
  assert.equal(noRight.canReply, false);

  const fromContact = normaliseTelegramUpdate(businessMessage('BC-ME', { chat: 8001, id: 7 }), TG_ME) as any;
  assert.deepEqual([fromContact.kind, fromContact.side, fromContact.externalMessageId, fromContact.contactName], ['message', 'contact', '8001:7', 'Sam Okafor']);
  const fromOwner = normaliseTelegramUpdate(businessMessage('BC-ME', { chat: 8001, from: Number(TG_ME) }), TG_ME) as any;
  assert.equal(fromOwner.side, 'me');
  assert.equal(fromOwner.contactName, null);
  const long = normaliseTelegramUpdate(businessMessage('BC-ME', { text: 'x'.repeat(9000) }), TG_ME) as any;
  assert.equal(long.text.length, 8000);

  const group = businessMessage('BC-ME');
  (group as any).business_message.chat.type = 'group';
  assert.equal(normaliseTelegramUpdate(group, TG_ME).kind, 'ignored');
  assert.equal(normaliseTelegramUpdate({ update_id: 5, channel_post: { text: 'x' } }).kind, 'ignored');
  const sticker = businessMessage('BC-ME');
  delete (sticker as any).business_message.text;
  (sticker as any).business_message.sticker = { file_id: 'S' };
  assert.equal(normaliseTelegramUpdate(sticker, TG_ME).kind, 'ignored');
  assert.equal(normaliseTelegramUpdate({ nope: true }).kind, 'ignored');
});

test('WhatsApp deliveries normalise into one event per message and status', () => {
  const evs = normaliseWhatsAppPayload({
    object: 'whatsapp_business_account',
    entry: [{ id: 'W', changes: [
      { field: 'messages', value: { metadata: { phone_number_id: PNID }, contacts: [{ profile: { name: 'Priya' }, wa_id: '44' }],
        messages: [
          { from: '44', id: 'wamid.T', timestamp: '1700000000', type: 'text', text: { body: 'hello' } },
          { from: '44', id: 'wamid.V', timestamp: '1700000001', type: 'audio', audio: { id: 'MEDIA-1', mime_type: 'audio/ogg; codecs=opus', voice: true } },
          { from: '44', id: 'wamid.I', timestamp: '1700000002', type: 'image', image: { id: 'IMG' } },
        ],
        statuses: [{ id: 'wamid.OUT', status: 'delivered', timestamp: '1700000003', recipient_id: '44' }] } },
      { field: 'smb_message_echoes', value: { metadata: { phone_number_id: PNID },
        message_echoes: [{ from: '15550001234', to: '44', id: 'wamid.E', timestamp: '1700000004', type: 'text', text: { body: 'from the app' } }] } },
    ] }],
  }) as any[];
  assert.deepEqual(evs.map((e) => [e.kind, e.eventId]), [
    ['message', 'wamid.T'], ['message', 'wamid.V'], ['ignored', 'wamid.I'], ['status', 'wamid.OUT:delivered'], ['message', 'wamid.E'],
  ]);
  assert.equal(evs[0].contactName, 'Priya');
  assert.equal(evs[0].connectionRef, PNID);
  assert.deepEqual(evs[1].voice, { fileRef: 'MEDIA-1', mime: 'audio/ogg; codecs=opus', durationSec: null });
  assert.deepEqual([evs[4].side, evs[4].externalChatId], ['me', '44']);
  assert.deepEqual(normaliseWhatsAppPayload({ object: 'page', entry: [] }), []);
  assert.equal(maskNumber('+1 555-000-1234'), '•••• 1234');
});

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

test('Telegram: a forged or missing secret is 401 and stores nothing; an unset one is 503; oversize is 413', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    assert.equal((await tgHook(env, businessMessage('BC-ME'), 'wrong-secret')).status, 401);
    assert.equal((await tgHook(env, businessMessage('BC-ME'), null)).status, 401);
    assert.equal((await tgHook({ ...env, TELEGRAM_CHANNEL_WEBHOOK_SECRET: '' }, businessMessage('BC-ME'))).status, 503);
    const big = await send(env, '/api/channels/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 1, pad: 'x'.repeat(300 * 1024) }),
    });
    assert.equal(big.status, 413);
    const bad = await send(env, '/api/channels/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET }, body: '{not json',
    });
    assert.equal(bad.status, 400);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_events'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 0);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('Telegram: /start <code> then the account’s own /confirm links it once; a duplicate update does nothing', async () => {
  const { env, db } = await world();
  const f = mockFetch(telegramApi);
  try {
    const link = await call(env, ME, 'POST', '/telegram/link');
    assert.equal(link.status, 200);
    assert.equal(link.body.url, `https://t.me/${SECRETS.TELEGRAM_CHANNEL_BOT_USERNAME}?start=${link.body.code}`);
    assert.ok(link.body.expires_at);

    // The member had connected the bot in Telegram Business before linking.
    db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
             VALUES ('bc-early', 'BC-EARLY', '${TG_NEW}', NULL, 1, 1)`);
    const update = startUpdate(link.body.code, TG_NEW);
    assert.equal((await tgHook(env, update)).status, 200);
    // Step one names the Axal account and links nothing.
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'`), 0);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-EARLY'`).get().user_id, null);
    const prompt = f.calls.find((c) => c.url.endsWith('/sendMessage'))!;
    assert.equal(String(prompt.body.chat_id), TG_NEW, 'the question goes to the private chat');
    assert.match(prompt.body.text, /m•••@example\.test/, 'it names the Axal account, masked');
    assert.match(prompt.body.text, /\/confirm/);
    assert.equal(prompt.body.text.includes(link.body.code), false);
    assert.equal(prompt.body.text.includes('member@example.test'), false);

    const before = f.calls.length;
    assert.equal((await tgHook(env, update)).status, 200, 'a redelivery answers 200');
    assert.equal(f.calls.length, before, 'and does nothing');

    assert.equal((await tgHook(env, confirmUpdate(TG_NEW))).status, 200);
    const row = db.prepare(`SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'telegram'`).get(ME);
    assert.deepEqual([row.status, row.auth_type, row.external_account_id, row.external_account_name, row.credentials_enc],
      ['active', 'webhook', TG_NEW, '@dana_biz', null]);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-EARLY'`).get().user_id, ME);
    const reply = f.calls[f.calls.length - 1];
    assert.match(reply.body.text, /now linked/i);
    assert.equal(count(db, `SELECT COUNT(*) n FROM channel_events WHERE kind = 'link'`), 2);

    // A second /confirm finds nothing waiting.
    await tgHook(env, confirmUpdate(TG_NEW));
    assert.match(f.calls[f.calls.length - 1].body.text, /no link waiting/);

    const status = await call(env, ME, 'GET', '');
    assert.deepEqual(status.body.connections.telegram.external_account_name, '@dana_biz');
    assert.equal(status.body.connections.telegram.business_connected, true);
    assert.equal(JSON.stringify(status.body).includes(TG_NEW), false, 'the Telegram id is not echoed');
  } finally { f.restore(); }
});

test('Telegram: an account another member holds is refused, and nothing is stored', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const { code } = await createLinkCode(env, OTHER, 'telegram');
    assert.equal((await tgHook(env, startUpdate(code, TG_ME))).status, 200);
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE user_id = ${OTHER}`), 0);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'`).get().user_id, ME);
    assert.match(f.calls[0].body.text, /already linked to another Axal account/);
    assert.equal(db.prepare(`SELECT status, error FROM channel_events`).get().error, 'identity_taken');

    const bad = await tgHook(env, startUpdate('abcdefghjkmnpqrstuvwxyzA', TG_OTHER));
    assert.equal(bad.status, 200);
    assert.match(f.calls[1].body.text, /expired or was already used/);
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE external_account_id = '${TG_OTHER}'`), 0);
  } finally { f.restore(); }
});

test('Telegram: a member’s link code sent to someone else’s account links nothing without that account’s /confirm', async () => {
  // Review finding 3: OTHER (any signed-in member) sends their t.me link to the
  // owner of a Telegram Business account that already has the bot connected.
  // One tap on Start used to link that account to OTHER and hand OTHER its
  // business connection — the customer chats, and replies as that business.
  const { env, db } = await world();
  const f = mockFetch(telegramApi);
  try {
    db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
             VALUES ('bc-v', 'BC-VICTIM', '${TG_NEW}', NULL, 1, 1)`);
    const { code } = await createLinkCode(env, OTHER, 'telegram');
    assert.equal((await tgHook(env, startUpdate(code, TG_NEW))).status, 200);
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'`), 0, 'nothing linked on /start');
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-VICTIM'`).get().user_id, null,
      'the business connection is not handed over');
    assert.match(f.calls[0].body.text, /i•••@example\.test/, 'the owner is told which Axal account is asking');

    // Nobody else can confirm for that Telegram account.
    await tgHook(env, confirmUpdate(TG_OTHER));
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'`), 0);
    assert.match(f.calls[1].body.text, /no link waiting/);

    // And the owner's own /confirm counts only within ten minutes.
    db.exec(`UPDATE channel_link_codes SET used_at = datetime('now', '-11 minutes')`);
    await tgHook(env, confirmUpdate(TG_NEW));
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'`), 0);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-VICTIM'`).get().user_id, null);
  } finally { f.restore(); }
});

test('Telegram: a connection before linking stores only its row and prompts; after linking, messages arrive pending', async () => {
  const { env, db } = await world();
  const f = mockFetch(telegramApi);
  try {
    assert.equal((await tgHook(env, connectionUpdate('BC-NEW', TG_NEW))).status, 200);
    const bc = db.prepare(`SELECT * FROM telegram_business_connections WHERE business_connection_id = 'BC-NEW'`).get();
    assert.deepEqual([bc.user_id, bc.is_enabled, bc.can_reply], [null, 1, 1]);
    assert.equal(String(f.calls[0].body.chat_id), TG_NEW, 'the link prompt goes to the owner');
    assert.match(f.calls[0].body.text, /Link Telegram/);

    // Messages on an unlinked connection: nothing stored.
    assert.equal((await tgHook(env, businessMessage('BC-NEW'))).status, 200);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);
    assert.equal(db.prepare(`SELECT error FROM channel_events WHERE kind = 'message'`).get().error, 'unknown_connection');

    const { code } = await createLinkCode(env, ME, 'telegram');
    await linkTelegram(env, code, TG_NEW);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-NEW'`).get().user_id, ME);

    assert.equal((await tgHook(env, businessMessage('BC-NEW', { text: 'Invoices take my whole Friday.' }))).status, 200);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1);
    const raw = JSON.stringify(db.prepare('SELECT * FROM channel_thread_messages').all()) + JSON.stringify(db.prepare('SELECT * FROM channel_events').all());
    assert.equal(raw.includes('Friday'), false, 'stored encrypted; events carry no text');
    const list = await call(env, ME, 'GET', '/threads?status=pending');
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].contact_name, 'Sam Okafor');
    const read = await call(env, ME, 'GET', `/threads/${list.body.items[0].uid}`);
    assert.equal(read.body.messages[0].text, 'Invoices take my whole Friday.');
    assert.equal((await call(env, ME, 'GET', '')).body.pending.telegram, 1);

    // A connection after linking joins the member at once and prompts nobody.
    const prompts = f.calls.length;
    await tgHook(env, connectionUpdate('BC-SECOND', TG_NEW));
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-SECOND'`).get().user_id, ME);
    assert.equal(f.calls.length, prompts);
  } finally { f.restore(); }
});

test("Telegram: the owner's messages are 'Me', edits and deletions change pending copies, duplicates land once", async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const first = businessMessage('BC-ME', { id: 11, text: 'typo here' });
    await tgHook(env, first);
    await tgHook(env, first);
    await tgHook(env, businessMessage('BC-ME', { id: 12, from: Number(TG_ME), text: 'How often does that happen?' }));
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 2, 'the duplicate update landed once');
    assert.deepEqual(db.prepare('SELECT direction FROM channel_thread_messages ORDER BY id').all().map((r: any) => r.direction), ['in', 'out']);

    await tgHook(env, businessMessage('BC-ME', { key: 'edited_business_message', id: 11, text: 'fixed text' }));
    const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
    assert.deepEqual((await call(env, ME, 'GET', `/threads/${t.uid}`)).body.messages.map((m: any) => [m.side, m.text]),
      [['contact', 'fixed text'], ['me', 'How often does that happen?']]);

    await tgHook(env, { update_id: ++updateId, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 8001, type: 'private' }, message_ids: [12] } });
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1);
    assert.equal(f.calls.length, 0, 'receiving sends nothing');
  } finally { f.restore(); }
});

test('Telegram: a disabled connection is updated and its messages are nobody’s; unsupported updates store nothing', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    await tgHook(env, connectionUpdate('BC-ME', TG_ME, { rights: {} }, false));
    const bc = db.prepare(`SELECT is_enabled, can_reply FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'`).get();
    assert.deepEqual([bc.is_enabled, bc.can_reply], [0, 0]);
    await tgHook(env, businessMessage('BC-ME'));
    await tgHook(env, { update_id: ++updateId, channel_post: { message_id: 1, chat: { id: -100, type: 'channel' }, text: 'x' } });
    await tgHook(env, { update_id: ++updateId, message: { message_id: 2, chat: { id: -5, type: 'group' }, from: tgUser('9'), text: '/start abc' } });
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 0);
    assert.equal(f.calls.length, 0, 'a disabled connection prompts nobody');
  } finally { f.restore(); }
});

/** A Telegram chat with one text message, assigned to INTERVIEW through the route. */
async function assignedTelegramChat(env: any, chat = 8001) {
  await tgHook(env, businessMessage('BC-ME', { chat, text: 'We reconcile invoices by hand every Friday.' }));
  const [t] = (await call(env, ME, 'GET', '/threads?status=pending')).body.items;
  const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  return { uid: t.uid as string, sessionId: Number(a.body.session_id) };
}
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup');
const segments = (db: any, sessionId: number) => db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId)
  .map((s: any) => [s.speaker_label, s.text]);

test('Telegram: a voice note on a pending chat runs no model and waits, with no text, until the member assigns the chat', async () => {
  // Review findings 0 and 9: a stranger's voice notes used to be downloaded and
  // transcribed on arrival, on the member's AI budget and then their top-up.
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const voice = { file_id: 'VOICE-1', file_unique_id: 'U1', duration: 9, mime_type: 'audio/ogg', file_size: 4000 };
    for (let i = 0; i < 3; i++) assert.equal((await tgHook(env, businessMessage('BC-ME', { voice }))).status, 200);
    assert.equal(queued.length, 0, 'nothing queued for a chat the member has not assigned');
    assert.equal(aiCalls.length, 0, 'no model ran');
    assert.equal(f.calls.length, 0, 'nothing downloaded');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM channel_thread_messages').all()).includes('VOICE-1'), false, 'the file ref is stored encrypted');
    assert.equal(db.prepare(`SELECT status FROM channel_events WHERE kind = 'voice' LIMIT 1`).get().status, 'stored');
    const [t] = (await call(env, ME, 'GET', '/threads?status=pending')).body.items;
    assert.equal(t.message_count, 3);
    const read = await call(env, ME, 'GET', `/threads/${t.uid}`);
    assert.deepEqual(read.body.messages.map((m: any) => [m.kind, m.text, m.awaiting_transcription, m.duration_sec]),
      [['voice', null, true, 9], ['voice', null, true, 9], ['voice', null, true, 9]]);
    assert.equal(JSON.stringify(read.body).includes('VOICE-1'), false, 'the file ref never leaves the Worker');

    // The member assigns the chat: now, and only now, the notes are queued — ids only.
    const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
    assert.deepEqual([a.status, a.body.moved, a.body.voice_queued], [200, 0, 3]);
    const jobs = voiceJobs(queued);
    assert.equal(jobs.length, 3);
    for (const job of jobs) {
      assert.match(job.idempotency_key, /^telegram:channel_followup:[0-9a-f-]{36}$/);
      assert.deepEqual(Object.keys(job.payload).sort(), ['event', 'job', 'kind', 'message', 'provider']);
      assert.equal(JSON.stringify(job).includes('VOICE-1') || JSON.stringify(job).includes('8001'), false, 'no file ref and no chat id in the job');
    }
    assert.equal((await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW })).body.voice_queued, 0, 'never queued twice');

    await runChannelJob(env, 'channel_followup', jobs[0].payload);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].model, '@cf/openai/whisper-large-v3-turbo', 'the sessions default final model');
    assert.deepEqual(segments(db, a.body.session_id), [['Dana Ruiz', 'We lose a whole day every month to this.']]);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 2, 'the transcribed placeholder is gone');
    assert.ok(count(db, `SELECT COUNT(*) n FROM ai_usage_logs WHERE user_id = ${ME} AND task = 'transcribe'`) >= 1, 'charged to the member');
    assert.ok(f.calls.some((c) => c.url.includes('/file/bot')), 'downloaded through getFile');

    // Run twice: nothing more happens.
    await runChannelJob(env, 'channel_followup', jobs[0].payload);
    assert.equal(aiCalls.length, 1);
    assert.equal(segments(db, a.body.session_id).length, 1);
  } finally { f.restore(); }
});

test('Telegram: on a chat in an interview a voice note is queued on arrival and lands once, even when its record fails mid-way', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const { sessionId } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-2', duration: 4 } }));
    const [job] = voiceJobs(queued);
    assert.ok(job.payload.event, 'the webhook’s event travels with the job, as its id');
    assert.equal(db.prepare(`SELECT status FROM channel_events WHERE kind = 'voice'`).get().status, 'stored');

    // Review finding 17: the event's record fails after the append. The record
    // is in the append's batch now, so nothing lands and the retry lands once.
    db.exec(`CREATE TRIGGER fail_event BEFORE UPDATE ON channel_events BEGIN SELECT RAISE(ABORT, 'd1 hiccup'); END;`);
    await assert.rejects(runChannelJob(env, 'channel_followup', job.payload));
    db.exec('DROP TRIGGER fail_event');
    assert.equal(segments(db, sessionId).length, 1, 'nothing appended without its record');
    await runChannelJob(env, 'channel_followup', job.payload);
    await runChannelJob(env, 'channel_followup', job.payload);
    assert.deepEqual(segments(db, sessionId).map((x: any) => x[1]),
      ['We reconcile invoices by hand every Friday.', 'We lose a whole day every month to this.'], 'appended once');
    assert.equal(aiCalls.length, 2, 'the failed attempt and its retry; the redelivery ran nothing');
    assert.equal(db.prepare(`SELECT status FROM channel_events WHERE kind = 'voice'`).get().status, 'done');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);
  } finally { f.restore(); }
});

test('Telegram: a voice note deleted at the source while its job waits is never downloaded, transcribed or stored', async () => {
  // Review finding 7.
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const { sessionId } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { id: 777, voice: { file_id: 'VOICE-3', duration: 4 } }));
    const [job] = voiceJobs(queued);
    await tgHook(env, { update_id: ++updateId, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 8001, type: 'private' }, message_ids: [777] } });
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0, 'the placeholder went with the deletion');
    const calls = f.calls.length;
    await runChannelJob(env, 'channel_followup', job.payload);
    assert.equal(f.calls.length, calls, 'not downloaded');
    assert.equal(aiCalls.length, 0, 'not transcribed');
    assert.equal(segments(db, sessionId).length, 1, 'not stored');
  } finally { f.restore(); }
});

test('Telegram: a spent budget, the connection’s daily cap or an oversize note transcribes nothing, and the note waits', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true, budget: 0 });
  const f = mockFetch((url, init) => {
    if (url.pathname.endsWith('/getFile') && String((JSON.parse(String(init.body))).file_id) === 'HUGE') {
      return { json: { ok: true, result: { file_id: 'HUGE', file_size: 25 * 1024 * 1024, file_path: 'voice/huge.oga' } } };
    }
    return telegramApi(url, init);
  });
  try {
    const { uid } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 4 } }));
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[0].payload);
    assert.equal(aiCalls.length, 0, 'no model ran on a spent budget');
    assert.match(db.prepare(`SELECT error FROM channel_events WHERE kind = 'voice'`).get().error, /^budget_/);
    const waiting = (await call(env, ME, 'GET', `/threads/${uid}`)).body.messages;
    assert.deepEqual(waiting.map((m: any) => [m.kind, m.text, m.awaiting_transcription]), [['voice', null, true]], 'the note waits, given back');

    // The day's cap, held in D1 (the refused run above took one): spent, the model never runs.
    const integration = db.prepare(`SELECT id FROM integrations WHERE uid = 'tg-me'`).get().id;
    assert.equal(db.prepare(`SELECT n FROM channel_counters WHERE counter = 'transcriptions_day'`).get().n, 1);
    db.prepare(`UPDATE channel_counters SET n = ? WHERE integration_id = ? AND counter = 'transcriptions_day'`)
      .run(CHANNEL_LIMITS.transcriptionsPerDay, integration);
    const again = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
    assert.equal(again.body.voice_queued, 1, 'assigning again queues the note that was given back');
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[1].payload);
    assert.equal(aiCalls.length, 0);
    assert.equal(db.prepare(`SELECT n FROM channel_counters WHERE counter = 'transcriptions_day'`).get().n, CHANNEL_LIMITS.transcriptionsPerDay);

    // And when the counter cannot be read, it fails closed: the job throws for the queue to retry, and nothing runs.
    await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
    db.exec('DROP TABLE channel_counters');
    await assert.rejects(runChannelJob(env, 'channel_followup', voiceJobs(queued)[2].payload));
    assert.equal(aiCalls.length, 0);

    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'HUGE', duration: 4000 } }));
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[3].payload);
    assert.equal(f.calls.some((c) => c.url.includes('huge.oga')), false, 'never downloaded');
    assert.equal(db.prepare(`SELECT error FROM channel_events WHERE kind = 'voice' ORDER BY id DESC LIMIT 1`).get().error, 'too_large');
  } finally { f.restore(); }
});

test('Telegram: an inactive member is ignored, and a connection over its per-minute limit is refused by a D1 count', async (t) => {
  const { env, db } = await world({ seed: true });
  db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
           VALUES ('bc-g', 'BC-GONE', '999', ${GONE}, 1, 1)`);
  db.exec(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id) VALUES ('tg-gone', ${GONE}, 'telegram', 'webhook', '999')`);
  await tgHook(env, businessMessage('BC-GONE'));
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 0);
  assert.equal(db.prepare(`SELECT error FROM channel_events`).get().error, 'member_inactive');

  // Review finding 1: KV as production has it takes one write per key per
  // second and throws on a second, so the KV counter this used to be never
  // passed about 60 in a minute and the limit of 120 never tripped.
  const writes = new Map<string, number>();
  env.RATE_LIMITS = {
    async get() { return null; },
    async put(key: string) {
      const last = writes.get(key);
      if (last !== undefined && Date.now() - last < 1000) throw new Error('KV PUT failed: 429 Too Many Requests');
      writes.set(key, Date.now());
    },
  };
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-13T10:05:05.000Z') });
  const over = 5;
  for (let i = 0; i < CHANNEL_LIMITS.eventsPerMinute + over; i++) await tgHook(env, businessMessage('BC-ME'));
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_events WHERE error = 'rate_limited'`), over);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), CHANNEL_LIMITS.eventsPerMinute);

  // It fails open: a counter that cannot be written never drops a customer's text.
  db.exec('DROP TABLE channel_counters');
  const error = console.error;
  console.error = () => {};
  try { await tgHook(env, businessMessage('BC-ME')); } finally { console.error = error; }
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), CHANNEL_LIMITS.eventsPerMinute + 1);
});

test('Webhook bodies: the size cap holds without Content-Length, and a wrong Telegram secret is refused before the body is read', async () => {
  // Review split finding 0.
  const { env, db } = await world({ seed: true });
  const streamed = (bytes: number) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= bytes) { ctrl.close(); return; }
        const n = Math.min(64 * 1024, bytes - sent);
        sent += n;
        ctrl.enqueue(new Uint8Array(n).fill(32));
      },
    }, { highWaterMark: 0 });
    return { body, read: () => sent };
  };
  const post = (path: string, headers: Record<string, string>, body: ReadableStream<Uint8Array>) =>
    send(env, path, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  const allowance = CHANNEL_LIMITS.maxBodyBytes + 128 * 1024;

  const big = streamed(8 * 1024 * 1024);
  const r = await post('/api/channels/telegram/webhook', { 'X-Telegram-Bot-Api-Secret-Token': SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET }, big.body);
  assert.equal(r.status, 413);
  assert.ok(big.read() <= allowance, `read ${big.read()} bytes of a body that sent no Content-Length`);

  const anon = streamed(8 * 1024 * 1024);
  const r2 = await post('/api/channels/telegram/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'not-the-secret' }, anon.body);
  assert.equal(r2.status, 401);
  assert.ok(anon.read() <= 64 * 1024, `read ${anon.read()} bytes for a caller without the secret`);

  // WhatsApp's signature covers the body, so it is read first — under the same cap.
  const wa = streamed(8 * 1024 * 1024);
  const r3 = await post('/api/channels/whatsapp/webhook', { 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}` }, wa.body);
  assert.equal(r3.status, 413);
  assert.ok(wa.read() <= allowance);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_events'), 0);
});

test('Telegram: a store that fails releases the claim and answers 500, so the retry is processed', async () => {
  const { env, db } = await world({ seed: true });
  const update = businessMessage('BC-ME', { text: 'first try fails' });
  db.exec(`CREATE TRIGGER fail_once BEFORE INSERT ON channel_thread_messages BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;`);
  const r = await tgHook(env, update);
  assert.equal(r.status, 500);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_events'), 0, 'the claim was released');
  db.exec('DROP TRIGGER fail_once');
  assert.equal((await tgHook(env, update)).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1);
});

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

test('WhatsApp: the challenge echoes only for the right token; unset is 503', async () => {
  const { env } = await world();
  const q = (token: string, challenge = '1158201444') => `/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`;
  const ok = await send(env, q(SECRETS.WHATSAPP_VERIFY_TOKEN), { method: 'GET' });
  assert.deepEqual([ok.status, ok.body], [200, 1158201444]);
  assert.equal((await send(env, q('wrong'), { method: 'GET' })).status, 403);
  assert.equal((await send(env, q(SECRETS.WHATSAPP_VERIFY_TOKEN, '<script>'), { method: 'GET' })).status, 403);
  assert.equal((await send({ ...env, WHATSAPP_VERIFY_TOKEN: '' }, q('x'), { method: 'GET' })).status, 503);
});

test('WhatsApp: a forged or missing signature is 401 and stores nothing; a good one stores the text once', async () => {
  const { env, db } = await world({ seed: true });
  const payload = waText(PNID, 'wamid.T1');
  assert.equal((await waHook(env, payload, sign(JSON.stringify(payload), 'not-the-secret'))).status, 401);
  assert.equal((await waHook(env, payload, null)).status, 401);
  assert.equal((await waHook(env, payload, 'sha256=zz')).status, 401);
  assert.equal((await waHook({ ...env, WHATSAPP_APP_SECRET: '' }, payload)).status, 503);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_events'), 0);

  assert.equal((await waHook(env, payload)).status, 200);
  assert.equal((await waHook(env, payload)).status, 200, 'a redelivery answers 200');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1);
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  assert.equal(t.contact_name, 'Priya Shah');
  assert.equal(t.provider, 'whatsapp');
  assert.equal((await call(env, ME, 'GET', `/threads/${t.uid}`)).body.messages[0].text, 'Our month-end close takes four days.');
  const raw = JSON.stringify(db.prepare('SELECT * FROM channel_threads').all());
  assert.equal(raw.includes('Priya'), false, 'the contact name is stored encrypted');
});

test('WhatsApp: app echoes are the member’s side; statuses advance Axal’s sends; an unknown number is ignored', async () => {
  const { env, db } = await world({ seed: true });
  await waHook(env, waText(PNID, 'wamid.C1'));
  await waHook(env, waPayload(PNID, {
    message_echoes: [{ from: '15550001234', to: WA_CUSTOMER, id: 'wamid.ECHO', timestamp: String(now()), type: 'text', text: { body: 'Sent from my phone app' } }],
  }, 'smb_message_echoes'));
  assert.deepEqual(db.prepare('SELECT direction FROM channel_thread_messages ORDER BY id').all().map((r: any) => r.direction), ['in', 'out']);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 1, 'one thread for both sides');

  db.exec(`INSERT INTO channel_outbound (uid, provider, user_id, client_key, external_message_id, status) VALUES ('o1', 'whatsapp', ${ME}, 'k1', '${ref('whatsapp', 'wamid.OUT')}', 'submitted')`);
  await waHook(env, waPayload(PNID, { statuses: [{ id: 'wamid.OUT', status: 'delivered', timestamp: String(now()), recipient_id: WA_CUSTOMER }] }));
  await waHook(env, waPayload(PNID, { statuses: [{ id: 'wamid.OUT', status: 'read', timestamp: String(now()), recipient_id: WA_CUSTOMER }] }));
  assert.equal(db.prepare(`SELECT status FROM channel_outbound WHERE uid = 'o1'`).get().status, 'read');

  const before = count(db, 'SELECT COUNT(*) n FROM channel_thread_messages');
  assert.equal((await waHook(env, waText('9999999', 'wamid.UNKNOWN'))).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), before);
  assert.equal(db.prepare(`SELECT status, error FROM channel_events WHERE external_event_id = ?`).get(ref('whatsapp', 'wamid.UNKNOWN')).error, 'unknown_connection');

  await waHook(env, waText(PNID_GONE, 'wamid.GONE'));
  assert.equal(db.prepare(`SELECT error FROM channel_events WHERE external_event_id = ?`).get(ref('whatsapp', 'wamid.GONE')).error, 'member_inactive');
});

test('WhatsApp: one POST with several messages claims each; a voice note waits for the assignment, then is fetched with the member token', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const payload = waPayload(PNID, {
    contacts: [{ profile: { name: 'Priya Shah' }, wa_id: WA_CUSTOMER }],
    messages: [
      { from: WA_CUSTOMER, id: 'wamid.A', timestamp: String(now()), type: 'text', text: { body: 'One.' } },
      { from: WA_CUSTOMER, id: 'wamid.VOICE', timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-9', mime_type: 'audio/ogg; codecs=opus', voice: true } },
    ],
  });
  await waHook(env, payload);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_events'), 2);
  assert.equal(queued.length, 0, 'a pending chat’s voice note is not queued');
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.deepEqual([a.body.moved, a.body.voice_queued], [1, 1]);
  const [job] = voiceJobs(queued);
  // Review finding 5: a wamid is the customer's number in base64. Neither it,
  // the number nor the media id rides in the job or in its idempotency key.
  const wire = JSON.stringify(job);
  for (const s of ['wamid', WA_CUSTOMER, 'MEDIA-9']) assert.equal(wire.includes(s), false, `${s} is in the job`);

  const f = mockFetch((url) => {
    if (url.hostname === 'graph.facebook.com' && url.pathname === '/v23.0/MEDIA-9') {
      return { json: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA-9', mime_type: 'audio/ogg', file_size: 3000, id: 'MEDIA-9' } };
    }
    if (url.hostname === 'lookaside.fbsbx.com') return { body: new Uint8Array(3000).fill(1), headers: { 'content-type': 'audio/ogg' } };
    return undefined;
  });
  try {
    await runChannelJob(env, 'channel_followup', job.payload);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((c) => c.auth === `Bearer ${WA_TOKEN}`), 'both calls carry the member token');
    assert.equal(aiCalls.length, 1);
    assert.deepEqual(segments(db, a.body.session_id).map((x: any) => x[1]), ['One.', 'We lose a whole day every month to this.']);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0);
  } finally { f.restore(); }

  // On the assigned chat a voice note is queued on arrival. A media URL off Meta's hosts is never sent the token.
  await waHook(env, waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'wamid.V2', timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-EVIL' } }] }));
  const g = mockFetch((url) => (url.pathname === '/v23.0/MEDIA-EVIL' ? { json: { url: 'https://attacker.example/steal', file_size: 10 } } : undefined));
  try {
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[1].payload);
    assert.equal(g.calls.length, 1);
    assert.equal(db.prepare(`SELECT error FROM channel_events WHERE external_event_id = ?`).get(ref('whatsapp', 'wamid.V2')).error, 'media_host');
  } finally { g.restore(); }
});

test('WhatsApp: Embedded Signup stores the token encrypted, subscribes the app, and refuses a number outside the WABA', async () => {
  const { env, db } = await world();
  const NEW_TOKEN = 'EAAG-new-business-token-SECRET';
  const route: Route = (url) => {
    if (url.hostname !== 'graph.facebook.com') return undefined;
    if (url.pathname === '/v23.0/oauth/access_token') {
      return url.searchParams.get('code') === 'GOOD-CODE' && url.searchParams.get('client_id') === SECRETS.WHATSAPP_APP_ID
        && url.searchParams.get('client_secret') === SECRETS.WHATSAPP_APP_SECRET
        ? { json: { access_token: NEW_TOKEN, token_type: 'bearer' } }
        : { status: 400, json: { error: { message: 'Invalid verification code format.', code: 100 } } };
    }
    if (url.pathname === '/v23.0/3000001/phone_numbers') {
      return { json: { data: [{ id: '3000009', display_phone_number: '+44 7700 900999', verified_name: 'Ledger Co' }] } };
    }
    if (url.pathname === '/v23.0/3000001/subscribed_apps') return { json: { success: true } };
    return undefined;
  };
  const f = mockFetch(route);
  try {
    const bad = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'BAD', waba_id: '3000001', phone_number_id: '3000009' });
    assert.deepEqual([bad.status, bad.body.code], [400, 'code_exchange_failed']);
    assert.equal(JSON.stringify(bad.body).includes('Invalid verification'), false, 'provider text never reaches the body');
    const outside = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001', phone_number_id: '3000555' });
    assert.deepEqual([outside.status, outside.body.code], [400, 'number_not_in_waba']);
    assert.equal(f.calls.some((c) => c.url.includes('subscribed_apps')), false, 'nothing subscribed for a refused number');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM integrations'), 0);
    assert.equal((await call(env, ME, 'POST', '/whatsapp/connect', { code: 'x', waba_id: 'abc', phone_number_id: '1' })).status, 400);

    const ok = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001', phone_number_id: '3000009' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.connection.external_account_name, 'Ledger Co');
    const row = db.prepare(`SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp'`).get(ME);
    assert.equal(row.external_account_id, '3000009');
    assert.equal(row.credentials_enc.includes(NEW_TOKEN), false);
    assert.equal((await decryptCredentials(env, row.uid, row.credentials_enc))?.access_token, NEW_TOKEN, 'the connectors scheme (integrations/secrets.ts)');
    assert.equal(JSON.parse(row.config_json).number_masked, '•••• 0999');
    const sub = f.calls.find((c) => c.url.endsWith('/3000001/subscribed_apps'))!;
    assert.deepEqual([sub.method, sub.auth], ['POST', `Bearer ${NEW_TOKEN}`]);

    // Another member cannot take the same number, named or read from the WABA.
    const taken = await call(env, OTHER, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001', phone_number_id: '3000009' });
    assert.deepEqual([taken.status, taken.body.code], [409, 'number_taken']);
    const takenUnnamed = await call(env, OTHER, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001', phone_number_id: null });
    assert.deepEqual([takenUnnamed.status, takenUnnamed.body.code], [409, 'number_taken']);

    const status = await call(env, ME, 'GET', '');
    const body = JSON.stringify(status.body);
    assert.equal(body.includes('3000009') || body.includes('3000001'), false, 'no phone_number_id or waba_id in the connections');
    assert.equal(status.body.connections.whatsapp.can_reply, true);
  } finally { f.restore(); }
});

// D686 (#1592): a connection that is linked again is no longer failing, so the
// stored failure time goes with the failure.
const STALE_FAILURE = { last_error: 'sync failed', last_error_at: '2026-10-01 08:00:00' };
const failureOf = (db: any, provider: string) =>
  ({ ...db.prepare('SELECT last_error, last_error_at FROM integrations WHERE user_id = ? AND provider_key = ?').get(ME, provider) });

test('D686 #1592: Telegram linked again clears the stored failure and its time', async () => {
  const { env, db } = await world({ seed: true });
  db.prepare(`UPDATE integrations SET last_error = ?, last_error_at = ? WHERE user_id = ? AND provider_key = 'telegram'`)
    .run(STALE_FAILURE.last_error, STALE_FAILURE.last_error_at, ME);
  const f = mockFetch(telegramApi);
  try {
    const { code } = await createLinkCode(env, ME, 'telegram');
    assert.equal((await tgHook(env, startUpdate(code, TG_ME))).status, 200);
    assert.deepEqual(failureOf(db, 'telegram'), STALE_FAILURE, 'redeeming the code alone links nothing');
    assert.equal((await tgHook(env, confirmUpdate(TG_ME))).status, 200);
    assert.deepEqual(failureOf(db, 'telegram'), { last_error: null, last_error_at: null });
  } finally { f.restore(); }
});

test('D686 #1592: WhatsApp connected again clears the stored failure and its time', async () => {
  const { env, db } = await world({ seed: true });
  db.prepare(`UPDATE integrations SET last_error = ?, last_error_at = ? WHERE user_id = ? AND provider_key = 'whatsapp'`)
    .run(STALE_FAILURE.last_error, STALE_FAILURE.last_error_at, ME);
  const f = mockFetch((url) => {
    if (url.hostname !== 'graph.facebook.com') return undefined;
    if (url.pathname === '/v23.0/oauth/access_token') {
      return url.searchParams.get('code') === 'GOOD-CODE' ? { json: { access_token: 'EAAG-new-business-token-SECRET', token_type: 'bearer' } }
        : { status: 400, json: { error: { message: 'Invalid verification code format.', code: 100 } } };
    }
    if (url.pathname === '/v23.0/2000001/phone_numbers') return { json: { data: [{ id: PNID, display_phone_number: '+44 7700 901234', verified_name: 'Ledger Co' }] } };
    if (url.pathname === '/v23.0/2000001/subscribed_apps') return { json: { success: true } };
    return undefined;
  });
  try {
    const bad = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'BAD', waba_id: '2000001', phone_number_id: PNID });
    assert.equal(bad.status, 400);
    assert.deepEqual(failureOf(db, 'whatsapp'), STALE_FAILURE, 'a refused signup changes nothing');
    const ok = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '2000001', phone_number_id: PNID });
    assert.equal(ok.status, 200);
    assert.deepEqual(failureOf(db, 'whatsapp'), { last_error: null, last_error_at: null });
  } finally { f.restore(); }
});

test('Replies: once per client_key, as Me, and never outside the 24-hour window', async () => {
  const { env, db } = await world({ seed: true });
  await waHook(env, waText(PNID, 'wamid.IN1'));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  const f = mockFetch((url, init) => (url.hostname === 'graph.facebook.com' && url.pathname === `/v23.0/${PNID}/messages` && init.method === 'POST'
    ? { json: { messaging_product: 'whatsapp', contacts: [{ input: WA_CUSTOMER, wa_id: WA_CUSTOMER }], messages: [{ id: 'wamid.REPLY1' }] } }
    : undefined));
  try {
    const first = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'How many people do the close?', client_key: 'ck-1' });
    assert.equal(first.status, 200);
    assert.deepEqual([first.body.existing, first.body.outbound.status, first.body.recorded], [false, 'submitted', true]);
    const again = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'How many people do the close?', client_key: 'ck-1' });
    assert.equal(again.status, 200);
    assert.equal(again.body.existing, true);
    assert.equal(f.calls.length, 1, 'sent once');
    assert.equal(f.calls[0].body.to, WA_CUSTOMER);
    assert.equal(f.calls[0].auth, `Bearer ${WA_TOKEN}`);
    const msgs = (await call(env, ME, 'GET', `/threads/${t.uid}`)).body.messages;
    assert.deepEqual(msgs.map((m: any) => m.side), ['contact', 'me']);

    // The provider's echo of Axal's own reply is a duplicate.
    await waHook(env, waPayload(PNID, { message_echoes: [{ from: '1', to: WA_CUSTOMER, id: 'wamid.REPLY1', timestamp: String(now()), type: 'text', text: { body: 'How many people do the close?' } }] }, 'smb_message_echoes'));
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 2);

    const otherKey = await call(env, OTHER, 'POST', `/threads/${t.uid}/reply`, { text: 'x', client_key: 'ck-1' });
    assert.equal(otherKey.status, 404, "another member's thread is not there");

    db.exec(`UPDATE channel_threads SET last_inbound_at = '2026-01-01T00:00:00.000Z'`);
    const late = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Still there?', client_key: 'ck-2' });
    assert.deepEqual([late.status, late.body.code], [409, 'window_closed']);
    assert.equal(f.calls.length, 1, 'nothing sent outside the window');
    assert.equal(db.prepare(`SELECT status, error_code FROM channel_outbound WHERE client_key = 'ck-2'`).get().error_code, 'window_closed');
    assert.equal((await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: '', client_key: 'ck-3' })).status, 400);
    assert.equal((await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'y'.repeat(5000), client_key: 'ck-4' })).status, 400);
  } finally { f.restore(); }
});

test('Replies: a send whose outcome could not be saved still answers sent; a key whose first attempt never finished is never called sent or sent again', async () => {
  const { env, db } = await world({ seed: true });
  await waHook(env, waText(PNID, 'wamid.IN9'));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  const f = mockFetch((url, init) => (url.hostname === 'graph.facebook.com' && url.pathname === `/v23.0/${PNID}/messages` && init.method === 'POST'
    ? { json: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.REPLY9' }] } }
    : undefined));
  const error = console.error;
  try {
    // Review finding 18: Meta took the message, then D1 failed to record the
    // outcome. A 500 here made the composer drop its key, and the next press
    // sent a second copy.
    db.exec(`CREATE TRIGGER fail_outcome BEFORE UPDATE ON channel_outbound BEGIN SELECT RAISE(ABORT, 'd1 hiccup'); END;`);
    console.error = () => {};
    const first = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Can we talk Thursday?', client_key: 'ck-9' });
    console.error = error;
    db.exec('DROP TRIGGER fail_outcome');
    assert.deepEqual([first.status, first.body.ok, first.body.outbound.status], [200, true, 'submitted']);

    // Review finding 19: the row is still 'pending'. The same key again sends
    // nothing, and says neither sent nor failed.
    const again = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Can we talk Thursday?', client_key: 'ck-9' });
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.ok, again.body.pending, again.body.code, again.body.outbound.status], [null, true, 'send_in_flight', 'pending']);
    db.exec(`UPDATE channel_outbound SET created_at = datetime('now', '-5 minutes') WHERE client_key = 'ck-9'`);
    const later = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Can we talk Thursday?', client_key: 'ck-9' });
    assert.deepEqual([later.body.ok, later.body.code], [null, 'send_unknown']);
    assert.equal(f.calls.length, 1, 'sent once');
  } finally { console.error = error; f.restore(); }
});

test('Telegram replies go out on the business connection, only with the reply right; acceptance is never delivery', async () => {
  const { env, db } = await world({ seed: true });
  await tgHook(env, businessMessage('BC-ME', { chat: 8001 }));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  const f = mockFetch(telegramApi);
  try {
    const r = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Thanks — can we talk Thursday?', client_key: 'tg-1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.outbound.status, 'submitted');
    assert.deepEqual([f.calls[0].body.business_connection_id, String(f.calls[0].body.chat_id)], ['BC-ME', '8001']);
    assert.equal(db.prepare(`SELECT external_message_id FROM channel_outbound WHERE client_key = 'tg-1'`).get().external_message_id, ref('telegram', '8001:9001'));

    db.exec(`UPDATE telegram_business_connections SET can_reply = 0`);
    const refused = await call(env, ME, 'POST', `/threads/${t.uid}/reply`, { text: 'Again?', client_key: 'tg-2' });
    assert.deepEqual([refused.status, refused.body.code], [409, 'no_reply_right']);
    assert.equal(f.calls.length, 1);

    const test1 = await call(env, ME, 'POST', '/telegram/test');
    assert.equal(test1.status, 200);
    assert.equal(String(f.calls[1].body.chat_id), TG_ME, 'the test goes to the member, not a customer');
  } finally { f.restore(); }
});

test("Another member's thread is not there, on every thread route", async () => {
  const { env } = await world({ seed: true });
  await tgHook(env, businessMessage('BC-ME'));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  assert.equal((await call(env, OTHER, 'GET', `/threads/${t.uid}`)).status, 404);
  assert.equal((await call(env, OTHER, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW })).status, 404);
  assert.equal((await call(env, OTHER, 'POST', `/threads/${t.uid}/ignore`, {})).status, 404);
  assert.deepEqual((await call(env, OTHER, 'GET', '/threads')).body.items, []);
  assert.equal((await call(env, OTHER, 'GET', '')).body.pending.telegram, 0);

  // The member can: assign into their interview, then see it assigned.
  const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  assert.equal(a.body.moved, 1);
  const theirs = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { create: { interviewee_name: 'X', project_id: OTHER_PROJECT } });
  assert.deepEqual([theirs.status, theirs.body.code], [404, 'project_not_found']);
  const ig = await call(env, ME, 'POST', `/threads/${t.uid}/ignore`, {});
  assert.deepEqual([ig.status, ig.body.status], [200, 'ignored']);
  assert.equal((await call(env, ME, 'GET', '/threads?status=nope')).status, 400);
  assert.equal((await send(env, '/api/channels/threads', { method: 'GET' })).status, 401);
});

test('Availability names missing secrets to admins only, hands the browser the signup ids, and never a secret', async () => {
  const { env } = await world({ seed: true });
  const partial = { ...env, TELEGRAM_CHANNEL_WEBHOOK_SECRET: '' };
  const forMember = await call(partial, ME, 'GET', '');
  const tg = forMember.body.providers.find((p: any) => p.provider === 'telegram');
  assert.deepEqual([tg.available, tg.missing], [false, []]);
  const wa = forMember.body.providers.find((p: any) => p.provider === 'whatsapp');
  assert.deepEqual(wa.signup, { app_id: SECRETS.WHATSAPP_APP_ID, config_id: SECRETS.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID });
  assert.deepEqual(forMember.body.providers.map((p: any) => p.provider), ['telegram', 'whatsapp', 'zoom', 'google_meet']);
  assert.equal(forMember.body.providers.find((p: any) => p.provider === 'zoom').available, false);
  assert.deepEqual(Object.keys(forMember.body.connections.whatsapp).sort(), ['calls', 'can_reply', 'connected_at', 'external_account_name', 'status'], 'calls: the Calling eligibility read (#1586)');

  const forAdmin = await call(partial, ADMIN, 'GET', '', undefined, 'admin');
  assert.deepEqual(forAdmin.body.providers.find((p: any) => p.provider === 'telegram').missing, ['TELEGRAM_CHANNEL_WEBHOOK_SECRET']);

  const off = await call({ ...env, TELEGRAM_CHANNEL_BOT_USERNAME: '' }, ME, 'POST', '/telegram/link');
  assert.deepEqual([off.status, off.body.code], [503, 'not_available']);
  const noWa = await call({ ...env, WHATSAPP_APP_SECRET: '' }, ME, 'GET', '');
  assert.equal(noWa.body.providers.find((p: any) => p.provider === 'whatsapp').signup, undefined);
});

/** Graph for a disconnect: the WABA's numbers, and the unsubscribe. */
const wabaRoute = (numbers: string[]): Route => (url, init) => {
  if (url.hostname !== 'graph.facebook.com') return undefined;
  if (url.pathname === '/v23.0/2000001/phone_numbers') return { json: { data: numbers.map((id) => ({ id })) } };
  if (url.pathname === '/v23.0/2000001/subscribed_apps' && init.method === 'DELETE') return { json: { success: true } };
  return undefined;
};

test('Disconnecting clears credentials, forgets conversations and unsubscribes the app', async () => {
  const { env, db } = await world({ seed: true });
  await waHook(env, waText(PNID, 'wamid.D1'));
  await tgHook(env, businessMessage('BC-ME'));
  const f = mockFetch(wabaRoute([PNID]));
  try {
    const r = await call(env, ME, 'DELETE', '/whatsapp');
    assert.deepEqual(r.body, { ok: true, disconnected: true });
    assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'DELETE'], 'the WABA’s numbers are read, then the app unsubscribed');
    assert.ok(f.calls.every((c) => c.auth === `Bearer ${WA_TOKEN}`));
  } finally { f.restore(); }
  const row = db.prepare(`SELECT status, credentials_enc FROM integrations WHERE uid = 'wa-me'`).get();
  assert.deepEqual([row.status, row.credentials_enc], ['disconnected', null]);
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_threads WHERE provider = 'whatsapp'`), 0);
  await waHook(env, waText(PNID, 'wamid.D2'));
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_threads WHERE provider = 'whatsapp'`), 0, 'a disconnected number is nobody');

  assert.equal((await call(env, ME, 'DELETE', '/telegram')).status, 200);
  assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'`).get().user_id, null);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_threads'), 0);
  assert.equal((await call(env, ME, 'DELETE', '/zoom')).status, 404);
  assert.deepEqual((await call(env, ME, 'DELETE', '/telegram')).body, { ok: true, disconnected: false });
});

test('WhatsApp: disconnecting one number leaves the app subscribed while another member’s number shares the WABA', async () => {
  // Review findings 2 and 24: Meta subscribes an app per WABA, so unsubscribing
  // for one member's number cut off every other member's number in it.
  const { env, db } = await world({ seed: true });
  const otherCreds = await encryptCredentials(env, 'wa-other', { access_token: 'EAAG-other-token', token_type: 'bearer' });
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, config_json, credentials_enc)
              VALUES ('wa-other', ?, 'whatsapp', 'oauth2', '1000002', ?, ?)`)
    .run(OTHER, JSON.stringify({ phone_number_id: '1000002', waba_id: '2000001' }), otherCreds);
  const reconnect = async () => db.prepare(`UPDATE integrations SET status = 'active', credentials_enc = ? WHERE uid = 'wa-me'`)
    .run(await encryptCredentials(env, 'wa-me', { access_token: WA_TOKEN, token_type: 'bearer' }));
  const f = mockFetch(wabaRoute([PNID, '1000002']));
  try {
    assert.deepEqual((await call(env, ME, 'DELETE', '/whatsapp')).body, { ok: true, disconnected: true });
    assert.equal(f.calls.some((c) => c.method === 'DELETE'), false, 'the shared WABA stays subscribed');
    assert.equal(db.prepare(`SELECT status FROM integrations WHERE uid = 'wa-other'`).get().status, 'active');

    // The other member's recorded waba_id does not decide it alone: the WABA's own number list shows the share.
    await reconnect();
    db.exec(`UPDATE integrations SET config_json = '{"phone_number_id":"1000002","waba_id":"9999999"}' WHERE uid = 'wa-other'`);
    await call(env, ME, 'DELETE', '/whatsapp');
    assert.equal(f.calls.some((c) => c.method === 'DELETE'), false);

    // And this member's own waba_id is not trusted when the WABA does not hold their number.
    await reconnect();
    db.exec(`UPDATE integrations SET status = 'disconnected' WHERE uid = 'wa-other'`);
    f.restore();
    const g = mockFetch(wabaRoute(['1000777']));
    try {
      await call(env, ME, 'DELETE', '/whatsapp');
      assert.equal(g.calls.some((c) => c.method === 'DELETE'), false);
    } finally { g.restore(); }
  } finally { f.restore(); }
});

test('Admin: setWebhook registers the secret and the business update types; the response carries neither token nor secret', async () => {
  const { env } = await world();
  const f = mockFetch(telegramApi);
  try {
    const tok = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const r = await send(env, '/api/admin/channels/telegram/webhook', { method: 'POST', headers: { authorization: `Bearer ${tok}` } });
    assert.equal(r.status, 200);
    assert.equal(r.body.url, 'https://axal.vc/api/channels/telegram/webhook');
    const sent = f.calls.find((c) => c.url.endsWith('/setWebhook'))!;
    assert.equal(sent.body.secret_token, SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET);
    assert.deepEqual(sent.body.allowed_updates, ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages']);
    assert.ok(sent.url.includes(SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN), 'the channel bot, not the news bot');

    const notSuper = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const refused = await send(env, '/api/admin/channels/telegram/webhook', { method: 'POST', headers: { authorization: `Bearer ${notSuper}` } });
    assert.equal(refused.status, 403);
    const badSecret = await send({ ...env, TELEGRAM_CHANNEL_WEBHOOK_SECRET: 'has spaces!' }, '/api/admin/channels/telegram/webhook', { method: 'POST', headers: { authorization: `Bearer ${tok}` } });
    assert.deepEqual([badSecret.status, badSecret.body.code], [503, 'secret_format']);
  } finally { f.restore(); }
});

test('WhatsApp: a coexistence signup that sends only the WABA takes its one number, and asks when there are several', async () => {
  const { env, db } = await world();
  let numbers: Array<Record<string, string>> = [{ id: '3000009', display_phone_number: '+44 7700 900999', verified_name: 'Ledger Co' }];
  const f = mockFetch((url) => {
    if (url.hostname !== 'graph.facebook.com') return undefined;
    if (url.pathname === '/v23.0/oauth/access_token') return { json: { access_token: 'EAAG-token', token_type: 'bearer' } };
    if (url.pathname === '/v23.0/3000001/phone_numbers') return { json: { data: numbers } };
    if (url.pathname === '/v23.0/3000001/subscribed_apps') return { json: { success: true } };
    return undefined;
  });
  try {
    const one = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001', phone_number_id: null });
    assert.equal(one.status, 200);
    assert.equal(db.prepare(`SELECT external_account_id FROM integrations WHERE user_id = ?`).get(ME).external_account_id, '3000009');

    numbers = [...numbers, { id: '3000010', display_phone_number: '+44 7700 900100', verified_name: 'Ledger Co 2' }];
    const several = await call(env, OTHER, 'POST', '/whatsapp/connect', { code: 'GOOD-CODE', waba_id: '3000001' });
    assert.deepEqual([several.status, several.body.code], [409, 'choose_number']);
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE user_id = ${OTHER}`), 0);
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// D685 S19 (#1586): import from the lightbox, voice-note failures, Calling eligibility
// ---------------------------------------------------------------------------

/** One pending Telegram conversation for ME, and its uid. */
async function pendingThread(env: any, text = 'Invoices eat my Friday.', chat = 8001): Promise<string> {
  const f = mockFetch(telegramApi);
  try { assert.equal((await tgHook(env, businessMessage('BC-ME', { chat, text }))).status, 200); } finally { f.restore(); }
  const items = (await call(env, ME, 'GET', '/threads?status=pending')).body.items;
  return items.find((t: any) => t.status === 'pending').uid;
}

test('#1586 assign: { create } keeps the company, and quote_consent: true records quote consent', async () => {
  const { env, db } = await world({ seed: true });
  const uid = await pendingThread(env);
  const r = await call(env, ME, 'POST', `/threads/${uid}/assign`, {
    create: { interviewee_name: 'Sam Okafor', interviewee_company: '  Okafor Logistics  ', project_id: PROJECT }, quote_consent: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT interviewee_name, interviewee_company, quote_consent FROM discovery_interviews WHERE id = ?').get(r.body.interview_id);
  assert.deepEqual({ ...row }, { interviewee_name: 'Sam Okafor', interviewee_company: 'Okafor Logistics', quote_consent: 1 });

  // Without consent: NULL stays NULL. A company over 160 characters is cut, a blank one is NULL.
  const uid2 = await pendingThread(env, 'Second chat.', 8002);
  const r2 = await call(env, ME, 'POST', `/threads/${uid2}/assign`, { create: { interviewee_name: 'Ana', interviewee_company: 'x'.repeat(200), project_id: PROJECT } });
  const row2 = db.prepare('SELECT interviewee_company, quote_consent FROM discovery_interviews WHERE id = ?').get(r2.body.interview_id);
  assert.equal(row2.interviewee_company.length, 160);
  assert.equal(row2.quote_consent, null, 'no consent given, none recorded');
  const uid3 = await pendingThread(env, 'Third chat.', 8003);
  const r3 = await call(env, ME, 'POST', `/threads/${uid3}/assign`, { create: { interviewee_name: 'Bo', interviewee_company: '   ', project_id: PROJECT } });
  assert.equal(db.prepare('SELECT interviewee_company FROM discovery_interviews WHERE id = ?').get(r3.body.interview_id).interviewee_company, null);
});

test('#1586 assign: quote consent on an existing interview; only the literal true; a refused assign records nothing', async () => {
  const { env, db } = await world({ seed: true });
  const uid = await pendingThread(env);
  const consent = (id: number) => db.prepare('SELECT quote_consent FROM discovery_interviews WHERE id = ?').get(id).quote_consent;
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, quote_consent: 'yes' })).status, 400);
  assert.equal(consent(INTERVIEW), null);
  assert.equal((await call(env, OTHER, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, quote_consent: true })).status, 404);
  assert.equal(consent(INTERVIEW), null, 'another member\'s request touches nothing');
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (202, ${OTHER_PROJECT}, 'Theirs')`).run();
  assert.notEqual((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: 202, quote_consent: true })).status, 200);
  assert.equal(consent(202), null, 'an interview the member cannot write is untouched');
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, quote_consent: false })).status, 200);
  assert.equal(consent(INTERVIEW), null);
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, quote_consent: true })).status, 200, 'the same interview again');
  assert.equal(consent(INTERVIEW), 1);
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, quote_consent: false })).status, 200);
  assert.equal(consent(INTERVIEW), 1, 'false never takes it back');
});

/** The waiting voice notes on a thread, as the member reads them. */
async function waitingNotes(env: any, uid: string) {
  const read = await call(env, ME, 'GET', `/threads/${uid}`);
  assert.equal(read.status, 200);
  for (const m of read.body.messages) assert.ok('transcription_failure' in m, 'every message carries the field');
  return read.body.messages.filter((m: any) => m.awaiting_transcription);
}

test('#1586 voice: a spent budget shows on the note in our words; a retry runs once the budget allows', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true, budget: 0 });
  const f = mockFetch(telegramApi);
  try {
    const { uid } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 4 } }));
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[0].payload);
    assert.equal(aiCalls.length, 0);

    let [note] = await waitingNotes(env, uid);
    assert.deepEqual(note.transcription_failure, {
      reason: 'budget', sentence: 'Your AI budget was spent, so this voice note was not transcribed.', retry: 'after_budget',
    });
    const early = await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`);
    assert.deepEqual([early.status, early.body.code], [402, 'budget_spent']);
    assert.equal(voiceJobs(queued).length, 1, 'nothing queued while the budget is spent');
    assert.equal((await call(env, OTHER, 'POST', `/threads/${uid}/voice/${note.uid}/retry`)).status, 404, 'not another member\'s');

    db.prepare('UPDATE ai_licence_caps SET daily_microusd = 50000000, monthly_microusd = 50000000').run();
    [note] = await waitingNotes(env, uid);
    assert.equal(note.transcription_failure.retry, 'available');
    const ok = await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`);
    assert.deepEqual([ok.status, ok.body.queued], [200, 1]);
    [note] = await waitingNotes(env, uid);
    assert.equal(note.transcription_failure, null, 'queued again: no failure to show');
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`)).status, 409, 'a second press queues nothing');

    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[1].payload);
    assert.equal(aiCalls.length, 1, 'transcribed this time');
    assert.deepEqual(await waitingNotes(env, uid), []);
  } finally { f.restore(); }
  noSecretsSeen();
});

test('#1586 voice: the daily cap, too large, unreadable and an expired connection each say why; only the cap is retried', async () => {
  const { env, db, queued } = await world({ seed: true });
  const huge: Route = (url, init) => {
    if (url.pathname.endsWith('/getFile')) {
      const id = String(JSON.parse(String(init.body)).file_id);
      if (id === 'HUGE') return { json: { ok: true, result: { file_id: 'HUGE', file_size: 25 * 1024 * 1024, file_path: 'voice/huge.oga' } } };
      if (id === 'EMPTY') return { json: { ok: true, result: { file_id: 'EMPTY', file_size: 10, file_path: 'voice/empty.oga' } } };
    }
    if (url.pathname.endsWith('/voice/empty.oga')) return { body: new Uint8Array(0), headers: { 'content-type': 'audio/ogg' } };
    return telegramApi(url, init);
  };
  const f = mockFetch(huge);
  try {
    const { uid } = await assignedTelegramChat(env);
    for (const id of ['HUGE', 'EMPTY', 'CAPPED']) {
      if (id === 'CAPPED') {
        const integration = db.prepare(`SELECT id FROM integrations WHERE uid = 'tg-me'`).get().id;
        db.prepare(`UPDATE channel_counters SET n = ? WHERE integration_id = ? AND counter = 'transcriptions_day'`).run(CHANNEL_LIMITS.transcriptionsPerDay, integration);
        if (!count(db, `SELECT COUNT(*) n FROM channel_counters WHERE counter = 'transcriptions_day'`)) {
          db.prepare(`INSERT INTO channel_counters (integration_id, counter, window_start, n) VALUES (?, 'transcriptions_day', date('now'), ?)`).run(integration, CHANNEL_LIMITS.transcriptionsPerDay);
        }
      }
      await tgHook(env, businessMessage('BC-ME', { voice: { file_id: id === 'CAPPED' ? 'VOICE-1' : id, duration: 4 } }));
      const jobs = voiceJobs(queued);
      await runChannelJob(env, 'channel_followup', jobs[jobs.length - 1].payload);
    }
    const notes = await waitingNotes(env, uid);
    assert.deepEqual(notes.map((m: any) => [m.transcription_failure.reason, m.transcription_failure.retry]),
      [['too_large', null], ['unreadable', null], ['daily_cap', 'available']]);
    assert.equal(notes[0].transcription_failure.sentence, 'This voice note is larger than Axal can transcribe from Telegram (20 MB).');
    assert.equal(notes[2].transcription_failure.sentence, 'This Telegram account reached its voice notes for today, so this one waits. Retry it tomorrow.');
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/voice/${notes[0].uid}/retry`)).status, 409, 'too large is never retried');
  } finally { f.restore(); }

  // WhatsApp: the member's token has expired.
  await waHook(env, waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'wamid.T', timestamp: String(now()), type: 'text', text: { body: 'Hi' } }] }));
  const wa = (await call(env, ME, 'GET', '/threads')).body.items.find((t: any) => t.provider === 'whatsapp');
  assert.equal((await call(env, ME, 'POST', `/threads/${wa.uid}/assign`, { interview_id: INTERVIEW })).status, 200);
  await waHook(env, waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'wamid.EXP', timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-EXP' } }] }));
  const g = mockFetch((url) => (url.pathname === '/v23.0/MEDIA-EXP' ? { status: 401, json: { error: { code: 190, message: 'Session has expired for +447700900123' } } } : undefined));
  try { const jobs = voiceJobs(queued); await runChannelJob(env, 'channel_followup', jobs[jobs.length - 1].payload); } finally { g.restore(); }
  const [exp] = await waitingNotes(env, wa.uid);
  assert.equal(exp.transcription_failure.reason, 'reconnect');
  assert.match(exp.transcription_failure.sentence, /Connect it again in Account › Connectors\.$/);
  noSecretsSeen();
  assert.equal(seen.join('\n').includes('Session has expired'), false, 'no provider text');
});

test('#1586 voice: Telegram unreachable is retried by the job itself, said while it tries, and said when it stops', async () => {
  const { env, db, queued } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  let uid = '';
  try { ({ uid } = await assignedTelegramChat(env)); await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 4 } })); } finally { f.restore(); }
  const down: Route = (url) => { if (url.hostname === 'api.telegram.org') throw new Error('connect ECONNREFUSED'); return undefined; };
  let payload = voiceJobs(queued)[0].payload;
  for (let i = 1; i <= 4; i++) {
    const g = mockFetch(down);
    try { await runChannelJob(env, 'channel_followup', payload); } finally { g.restore(); }
    const [note] = await waitingNotes(env, uid);
    if (i < 4) {
      assert.deepEqual(note.transcription_failure, {
        reason: 'retrying', sentence: 'This voice note could not be transcribed yet. Axal tries again in a few minutes.', retry: null,
      }, `try ${i}`);
      const next = voiceJobs(queued)[voiceJobs(queued).length - 1];
      assert.equal(next.payload.try, i + 1, 'the next try is queued by the job');
      assert.equal(next.payload.job, payload.job, 'the same claim');
      assert.ok(next.idempotency_key.endsWith(`-try-${i + 1}`));
      payload = next.payload;
    } else {
      assert.deepEqual([note.transcription_failure.reason, note.transcription_failure.retry], ['unreachable', 'available']);
      assert.equal(note.transcription_failure.sentence, 'Telegram could not be reached to fetch this voice note, after several tries.');
    }
  }
  assert.equal(db.prepare(`SELECT transcribe_job FROM channel_thread_messages WHERE kind = 'voice'`).get().transcribe_job, null, 'given back');
  // Retried by the member: a fresh claim, so the old code is gone, not "still trying".
  const [given] = await waitingNotes(env, uid);
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/voice/${given.uid}/retry`)).status, 200);
  const [fresh] = await waitingNotes(env, uid);
  assert.equal(fresh.transcription_failure, null);
});

test('#1586 voice: the failure read is the member\'s own, and a note on a pending chat waits for its assignment', async () => {
  const { env, db, queued } = await world({ seed: true, budget: 0 });
  const f = mockFetch(telegramApi);
  try {
    const { uid } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 4 } }));
    await runChannelJob(env, 'channel_followup', voiceJobs(queued)[0].payload);
    assert.equal((await transcriptionFailures(env, ME, uid)).size, 1);
    assert.equal((await transcriptionFailures(env, OTHER, uid)).size, 0, 'below the route\'s check too');
    // The chat leaves its interview: the retry waits for the next assignment.
    db.prepare(`UPDATE channel_threads SET status = 'pending', interview_id = NULL, session_id = NULL WHERE uid = ?`).run(uid);
    const [note] = await waitingNotes(env, uid);
    assert.equal(note.transcription_failure.retry, 'after_assign');
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`)).status, 409);
  } finally { f.restore(); }
});

test('#1586 Calling eligibility: recorded at signup and on Test, read honestly, and no number is kept', async () => {
  const { env, db } = await world({ seed: true });
  let read = await call(env, ME, 'GET', '');
  let calls = read.body.connections.whatsapp.calls;
  assert.equal(calls.available, false);
  assert.deepEqual(calls.reasons.map((r: any) => r.code), ['not_built', 'not_checked']);
  assert.match(calls.sentence, /^Calls: not yet, because Axal does not answer or place WhatsApp calls yet; this number has not been checked yet/);

  const f = mockFetch((url) => (url.hostname === 'graph.facebook.com' && url.pathname === `/v23.0/${PNID}`
    ? { json: { verified_name: 'Ledger Co', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K', display_phone_number: '+1 555-000-1234', id: PNID } }
    : undefined));
  try { assert.equal((await call(env, ME, 'POST', '/whatsapp/test')).status, 200); } finally { f.restore(); }
  assert.ok(f.calls[0].url.includes('messaging_limit_tier'), 'the tier is asked of Graph');
  const cfg = JSON.parse(db.prepare(`SELECT config_json FROM integrations WHERE uid = 'wa-me'`).get().config_json);
  assert.deepEqual(Object.keys(cfg.calling).sort(), ['checked_at', 'region', 'tier']);
  assert.deepEqual([cfg.calling.tier, cfg.calling.region], ['TIER_1K', 'US_CA']);
  assert.equal(/555-?000-?1234|5550001234/.test(JSON.stringify(cfg)), false, 'the number is not kept');
  assert.equal(cfg.phone_number_id, PNID, 'the rest of the config is untouched');

  read = await call(env, ME, 'GET', '');
  calls = read.body.connections.whatsapp.calls;
  assert.deepEqual(calls.reasons.map((r: any) => r.code), ['not_built', 'tier_low', 'region']);
  assert.equal(calls.sentence,
    'Calls: not yet, because Axal does not answer or place WhatsApp calls yet; this number can start 1,000 conversations a day, and WhatsApp Calling needs at least 2,000; Meta does not offer business-initiated calls for numbers in the US or Canada (+1).');
  assert.equal(calls.tier, 'TIER_1K');
  assert.equal(JSON.stringify(read.body).includes('555'), false, 'no number on the read');
  assert.equal(read.body.connections.telegram?.calls, undefined, 'Telegram has no calls block');

  const g = mockFetch((url) => (url.pathname === `/v23.0/${PNID}` ? { json: { messaging_limit_tier: 'TIER_10K', display_phone_number: '+44 7700 900999' } } : undefined));
  try { await call(env, ME, 'POST', '/whatsapp/test'); } finally { g.restore(); }
  calls = (await call(env, ME, 'GET', '')).body.connections.whatsapp.calls;
  assert.deepEqual(calls.reasons.map((r: any) => r.code), ['not_built']);
  assert.equal(calls.available, false, 'never available: no calling is built');
  noSecretsSeen();
});

test('#1586 Calling eligibility: Embedded Signup records the tier and region', async () => {
  const { env, db } = await world({ seed: false });
  const f = mockFetch((url) => {
    if (url.pathname === '/v23.0/oauth/access_token') return { json: { access_token: 'EAAG-new-business-token-SECRET' } };
    if (url.pathname === '/v23.0/2000009/phone_numbers') {
      assert.ok(url.searchParams.get('fields')?.includes('messaging_limit_tier'));
      return { json: { data: [{ id: '1000009', display_phone_number: '+20 100 000 0000', verified_name: 'Cairo Co', messaging_limit_tier: 'TIER_250' }] } };
    }
    if (url.pathname === '/v23.0/2000009/subscribed_apps') return { json: { success: true } };
    return undefined;
  });
  try {
    const r = await call(env, ME, 'POST', '/whatsapp/connect', { code: 'C0DE', waba_id: '2000009', phone_number_id: '1000009' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally { f.restore(); }
  const cfg = JSON.parse(db.prepare(`SELECT config_json FROM integrations WHERE user_id = ${ME} AND provider_key = 'whatsapp'`).get().config_json);
  assert.deepEqual([cfg.calling.tier, cfg.calling.region], ['TIER_250', 'EG']);
  const calls = (await call(env, ME, 'GET', '')).body.connections.whatsapp.calls;
  assert.deepEqual(calls.reasons.map((r: any) => r.code), ['not_built', 'tier_low', 'region']);
  assert.match(calls.sentence, /numbers in Egypt\.$/);
});
