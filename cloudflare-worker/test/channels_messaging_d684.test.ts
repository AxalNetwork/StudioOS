/** D684 / #1576. Actual SQLite stores and JWT routes; every provider call mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { createLinkCode } from '../src/services/channels/linkCodes.ts';
import { readThread } from '../src/services/channels/threads.ts';
import { connectionForWhatsApp } from '../src/services/channels/connections.ts';
import * as telegram from '../src/services/channels/telegram.ts';
import * as whatsapp from '../src/services/channels/whatsapp.ts';
import * as routes from '../src/routes/channels.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const ME = 2, OTHER = 3, GONE = 4, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101, THEIR_INTERVIEW = 501;
const TG_INT = 11, WA_INT = 12, GONE_INT = 13;

function world() {
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
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz'), (${THEIR_INTERVIEW}, ${OTHER_PROJECT}, 'Theirs');
    CREATE TABLE integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, user_id INTEGER NOT NULL, provider_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', auth_type TEXT, credentials_enc TEXT, config_json TEXT,
      external_account_id TEXT, external_account_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, provider_key)
    );
    INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, external_account_id) VALUES
      (${TG_INT}, 'tg-me', ${ME}, 'telegram', 'webhook', '555001'),
      (${WA_INT}, 'wa-me', ${ME}, 'whatsapp', 'oauth2', '10001'),
      (${GONE_INT}, 'tg-gone', ${GONE}, 'whatsapp', 'oauth2', '10004');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
  `);
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql']) db.exec(mig(m));
  db.exec(`INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply)
           VALUES ('bc-1', 'BC-ME', '555001', ${ME}, 1, 1), ('bc-2', 'BC-UNLINKED', '777', NULL, 1, 1),
                  ('bc-3', 'BC-OFF', '555001', ${ME}, 0, 1)`);
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdef', KEK_PII: 'k'.repeat(48) };
  
  const kv = new Map<string, string>();
  const jobs: any[] = [], ai: any[] = [];
  env.RATE_LIMITS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } };
  env.TELEGRAM_CHANNEL_BOT_TOKEN = '123:test_token';
  env.TELEGRAM_CHANNEL_BOT_USERNAME = 'axal_test_bot';
  env.TELEGRAM_CHANNEL_WEBHOOK_SECRET = 'webhook-fixture';
  env.WHATSAPP_APP_ID = '55555'; env.WHATSAPP_APP_SECRET = 'meta-fixture';
  env.WHATSAPP_VERIFY_TOKEN = 'challenge-fixture'; env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = '999';
  env.USE_CF_QUEUE = 'true';
  env.JOB_QUEUE = { send: async (p: any) => { jobs.push(p); } };
  env.AI = { run: async (model: string, input: any) => { ai.push({ model, input }); return { text: 'Voice transcript fixture.' }; } };
  return { env, db, kv, jobs, ai };

}

type Modules = { telegram: typeof telegram; whatsapp: typeof whatsapp; routes: typeof routes };
const real: Modules = { telegram, whatsapp, routes };
const rowCount = (db: any, table: string) => db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
const counts = (db: any) => ({ events: rowCount(db, 'channel_events'), messages: rowCount(db, 'channel_thread_messages'), threads: rowCount(db, 'channel_threads') });
const snap = (actual: unknown, expected: unknown) => assert.deepEqual(actual, expected);
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function mocked<T>(fn: (url: string, init: RequestInit) => Promise<Response> | Response, action: () => Promise<T>) {
  const old = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => fn(String(url), init)) as typeof fetch;
  try { return await action(); } finally { globalThis.fetch = old; }
}
async function jwt(env: any, id = ME) {
  return new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}
async function signed(env: any, app: any, path: string, body?: unknown, id = ME, method?: string) {
  return app.request('https://axal.vc' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: 'Bearer ' + await jwt(env, id), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const tgMessage = (updateId = 10, extra: any = {}) => ({
  update_id: updateId, business_message: {
    business_connection_id: 'BC-ME', message_id: 42, chat: { id: 777001, type: 'private' },
    from: { id: 777001, first_name: 'Contact fixture' }, date: nowSeconds(), text: 'Private message fixture.', ...extra,
  },
});
const waPayload = (value: any, field = 'messages') => ({
  object: 'whatsapp_business_account', entry: [{ id: '20001', changes: [{ field, value: { metadata: { phone_number_id: '10001' }, ...value } }] }],
});
const waText = (extra: any = {}) => waPayload({
  contacts: [{ wa_id: '447000000001', profile: { name: 'Contact fixture' } }],
  messages: [{ id: 'wamid.fixture', from: '447000000001', timestamp: String(nowSeconds()), type: 'text', text: { body: 'Private message fixture.' }, ...extra }],
});
async function tgPost(env: any, app: any, payload: unknown, token = env.TELEGRAM_CHANNEL_WEBHOOK_SECRET) {
  return app.request('https://axal.vc/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': token }, body: JSON.stringify(payload) }, env);
}
async function waSignature(env: any, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
}
async function waPost(env: any, app: any, payload: unknown, forged = false) {
  const raw = JSON.stringify(payload);
  const signature = forged ? 'sha256=' + '0'.repeat(64) : await waSignature(env, raw);
  return app.request('https://axal.vc/whatsapp/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body: raw }, env);
}
async function waCredentials(env: any, db: any) {
  const enc = await encryptCredentials(env, 'wa-me', { access_token: 'member-token-fixture' });
  db.prepare("UPDATE integrations SET credentials_enc = ? WHERE uid = 'wa-me'").run(enc);
}
const outcome = async (r: Response) => ({ status: r.status, body: await r.json() });

type Check = { name: string; module: keyof Modules; before: string; after: string; run: (m: Modules) => Promise<void> };
const checks: Check[] = [
  {
    name: 'Telegram secret refuses forgery and missing configuration before storing',
    module: 'routes', before: "if (verified !== 'ok')", after: "if (false)",
    run: async m => {
      const { env, db } = world();
      const forged = await tgPost(env, m.routes.channels, tgMessage(), 'forged');
      env.TELEGRAM_CHANNEL_WEBHOOK_SECRET = '';
      const missing = await tgPost(env, m.routes.channels, tgMessage(11));
      snap([forged.status, missing.status, counts(db)], [401, 503, { events: 0, messages: 0, threads: 0 }]);
    },
  },
  {
    name: 'WhatsApp authenticates raw bytes, independently of challenge token',
    module: 'routes', before: "if (verified !== 'ok')", after: "if (false)", // second occurrence below
    run: async m => {
      const { env, db } = world();
      const forged = await waPost(env, m.routes.channels, waText(), true);
      const altered = JSON.stringify(waText()) + ' ';
      const r = await m.routes.channels.request('https://axal.vc/whatsapp/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': await waSignature(env, altered.trimEnd()) }, body: altered }, env);
      snap([forged.status, r.status, counts(db)], [401, 401, { events: 0, messages: 0, threads: 0 }]);
    },
  },
  {
    name: 'Telegram normalization: owner side, private chats, namespaced ids and text cap',
    module: 'telegram', before: "numeric(sender.id) === ownerId", after: "numeric(sender.id) !== ownerId",
    run: async m => {
      const a: any = m.telegram.normaliseTelegram(tgMessage(10, { from: { id: 555001 }, text: 'x'.repeat(8100) }), '555001');
      const b = m.telegram.normaliseTelegram(tgMessage(10, { chat: { id: 777001, type: 'group' } }));
      snap([a.kind, a.side, a.externalMessageId, a.text.length, b.kind], ['message', 'me', 'BC-ME:777001:42', 8000, 'ignored']);
    },
  },
  {
    name: 'BusinessConnection rights supersede the deprecated can_reply field',
    module: 'telegram', before: "rights.can_reply === true", after: "rights.can_reply !== true",
    run: async m => {
      const b: any = m.telegram.normaliseTelegram({ update_id: 7, business_connection: { id: 'BC-ME', user: { id: 555001 }, user_chat_id: 555001, is_enabled: true, can_reply: true, rights: { can_reply: false, can_read_messages: true } } });
      snap([b.kind, b.canReply, b.rights], ['connection', false, { can_reply: false, can_read_messages: true }]);
    },
  },
  {
    name: 'Telegram link code proves the member once and stores no plaintext code',
    module: 'routes', before: "if (!userId)", after: "if (true)",
    run: async m => {
      const { env, db } = world();
      const { code } = await createLinkCode(env, ME, 'telegram');
      const payload = { update_id: 100, message: { from: { id: 555001, first_name: 'Member' }, chat: { id: 555001, type: 'private' }, text: '/start ' + code } };
      let sends = 0;
      await mocked(() => { sends++; return respond({ ok: true, result: { message_id: 1 } }); }, async () => {
        await tgPost(env, m.routes.channels, payload); await tgPost(env, m.routes.channels, payload);
      });
      const row = db.prepare("SELECT external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'").get(ME);
      snap([row.external_account_id, sends, db.prepare("SELECT status FROM channel_events").get().status,
        JSON.stringify(db.prepare('SELECT * FROM channel_link_codes').all()).includes(code)], ['555001', 1, 'done', false]);
    },
  },
  {
    name: 'Telegram business connection saves rights for linked owners; unknown owner stores nothing',
    module: 'routes', before: "if (!linked) return 200;", after: "if (linked) return 200;",
    run: async m => {
      const { env, db } = world();
      const payload = (id: number, owner: number) => ({ update_id: id, business_connection: { id: 'BC-NEW', user: { id: owner }, user_chat_id: owner, is_enabled: true, rights: { can_reply: true } } });
      await tgPost(env, m.routes.channels, payload(1, 888001));
      const first = counts(db);
      await tgPost(env, m.routes.channels, payload(2, 555001));
      const row = db.prepare("SELECT user_id, can_reply FROM telegram_business_connections WHERE business_connection_id = 'BC-NEW'").get();
      snap([first, row ? [row.user_id, row.can_reply] : null], [{ events: 0, messages: 0, threads: 0 }, [ME, 1]]);
    },
  },
  {
    name: 'Telegram text is encrypted, duplicates do nothing, unknown connection stores nothing',
    module: 'routes', before: "if (!conn) return 200;", after: "if (conn) return 200;",
    run: async m => {
      const { env, db } = world();
      await tgPost(env, m.routes.channels, tgMessage(10, { business_connection_id: 'BC-UNLINKED' }));
      const unknown = counts(db);
      await tgPost(env, m.routes.channels, tgMessage());
      await tgPost(env, m.routes.channels, tgMessage());
      const thread = db.prepare('SELECT uid FROM channel_threads').get();
      const view = thread ? await readThread(env, ME, thread.uid) : null;
      const stored = JSON.stringify(db.prepare('SELECT * FROM channel_thread_messages').all()) + JSON.stringify(db.prepare('SELECT * FROM channel_events').all());
      snap([unknown, counts(db), view?.messages[0].text ?? null, stored.includes('Private message fixture.')],
        [{ events: 0, messages: 0, threads: 0 }, { events: 1, messages: 1, threads: 1 }, 'Private message fixture.', false]);
    },
  },
  {
    name: 'Telegram edits and deletions change pending copies',
    module: 'routes', before: "await applyEdit(env, conn, event);", after: "await Promise.resolve();",
    run: async m => {
      const { env, db } = world();
      await tgPost(env, m.routes.channels, tgMessage());
      const edit = tgMessage(11); const edited = { update_id: 11, edited_business_message: { ...edit.business_message, text: 'Edited fixture.' } };
      await tgPost(env, m.routes.channels, edited);
      const thread = db.prepare('SELECT uid FROM channel_threads').get();
      const content = (await readThread(env, ME, thread.uid)).messages[0].text;
      await tgPost(env, m.routes.channels, { update_id: 12, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 777001 }, message_ids: [42] } });
      snap([content, rowCount(db, 'channel_thread_messages')], ['Edited fixture.', 0]);
    },
  },
  {
    name: 'WhatsApp text, voice, app echoes and statuses normalize separately',
    module: 'whatsapp', before: "side: echo ? 'me' : 'contact'", after: "side: echo ? 'contact' : 'me'",
    run: async m => {
      const text: any = m.whatsapp.normaliseWhatsApp(waText())[0];
      const voice: any = m.whatsapp.normaliseWhatsApp(waText({ type: 'audio', audio: { id: '12345', mime_type: 'audio/ogg' } }))[0];
      const echo: any = m.whatsapp.normaliseWhatsApp(waPayload({ message_echoes: [{ id: 'wamid.echo', to: '447000000001', timestamp: String(nowSeconds()), type: 'text', text: { body: 'My reply fixture.' } }] }, 'smb_message_echoes'))[0];
      const status: any = m.whatsapp.normaliseWhatsApp(waPayload({ statuses: [{ id: 'wamid.out', status: 'read' }] }))[0];
      snap([text.side, text.text, voice.voice.fileRef, echo.side, status.kind, status.status],
        ['contact', 'Private message fixture.', '12345', 'me', 'status', 'read']);
    },
  },
  {
    name: 'WhatsApp duplicate text and Axal reply echo never store twice',
    module: 'routes', before: "if (ours) { await finishEvent", after: "if (false) { await finishEvent",
    run: async m => {
      const { env, db } = world();
      await waPost(env, m.routes.channels, waText()); await waPost(env, m.routes.channels, waText());
      db.prepare("INSERT INTO channel_outbound (uid, provider, user_id, client_key, external_message_id, status) VALUES ('out', 'whatsapp', ?, 'key', 'wamid.echo', 'submitted')").run(ME);
      const echo = waPayload({ message_echoes: [{ id: 'wamid.echo', to: '447000000001', timestamp: String(nowSeconds()), type: 'text', text: { body: 'My reply fixture.' } }] }, 'smb_message_echoes');
      await waPost(env, m.routes.channels, echo);
      snap([counts(db), db.prepare("SELECT status FROM channel_events WHERE kind = 'echo'").get().status],
        [{ events: 2, messages: 1, threads: 1 }, 'ignored']);
    },
  },
  {
    name: 'WhatsApp unknown numbers leave no event, thread or message rows',
    module: 'whatsapp', before: "if (!connectionRef) continue;", after: "if (connectionRef) continue;",
    run: async m => {
      const { env, db } = world(), payload = waText();
      payload.entry[0].changes[0].value.metadata.phone_number_id = '999999';
      const events = m.whatsapp.normaliseWhatsApp(payload);
      for (const event of events) await routes.processChannelEvent(env, event);
      snap([events.length, counts(db)], [1, { events: 0, messages: 0, threads: 0 }]);
    },
  },
  {
    name: 'WhatsApp statuses cannot alter another member send or regress read',
    module: 'routes', before: "if (ours) { await applyDeliveryStatus", after: "if (true) { await applyDeliveryStatus",
    run: async m => {
      const { env, db } = world();
      db.prepare("INSERT INTO channel_outbound (uid, provider, user_id, client_key, external_message_id, status) VALUES ('out', 'whatsapp', ?, 'key', 'wamid.out', 'submitted'), ('their', 'whatsapp', ?, 'other', 'wamid.other', 'submitted')").run(ME, OTHER);
      await waPost(env, m.routes.channels, waPayload({ statuses: [{ id: 'wamid.out', status: 'read' }, { id: 'wamid.other', status: 'read' }] }));
      await waPost(env, m.routes.channels, waPayload({ statuses: [{ id: 'wamid.out', status: 'delivered' }] }));
      snap(db.prepare("SELECT status FROM channel_outbound ORDER BY id").all().map((r: any) => r.status), ['read', 'submitted']);
    },
  },
  {
    name: 'WhatsApp free-form window closes exactly at 24 hours and rejects future clocks',
    module: 'whatsapp', before: "now - then < CHANNEL_LIMITS.replyWindowMs", after: "now - then <= CHANNEL_LIMITS.replyWindowMs",
    run: async m => {
      const now = Date.now(), stamp = (offset: number) => new Date(now + offset).toISOString();
      snap([m.whatsapp.replyWindowOpen(stamp(-1), now), m.whatsapp.replyWindowOpen(stamp(-86400000), now),
        m.whatsapp.replyWindowOpen(stamp(1), now), m.whatsapp.replyWindowOpen(null, now)], [true, false, false, false]);
    },
  },
  {
    name: 'WhatsApp send uses only decrypted member token, and closed windows make no calls',
    module: 'whatsapp', before: "if (!replyWindowOpen(lastInboundAt))", after: "if (false)",
    run: async m => {
      const { env, db } = world(); await waCredentials(env, db);
      const conn = (await connectionForWhatsApp(env, '10001'))!;
      const calls: any[] = [];
      await mocked((url, init) => { calls.push([url, objectHeader(init.headers).Authorization, JSON.parse(String(init.body)).to]); return respond({ messages: [{ id: 'wamid.sent' }] }); }, async () => {
        const closed = await m.whatsapp.sendWhatsApp(env, conn, '10001', '447000000001', 'Reply fixture.', '2000-01-01T00:00:00Z');
        const sent = await m.whatsapp.sendWhatsApp(env, conn, '10001', '447000000001', 'Reply fixture.', new Date().toISOString());
        snap([closed, sent, calls], [{ ok: false, code: 'window_closed' }, { ok: true, externalMessageId: 'wamid.sent' },
          [[whatsapp.GRAPH + '/10001/messages', 'Bearer member-token-fixture', '447000000001']]]);
      });
    },
  },
  {
    name: 'Telegram sends include the business connection and return acceptance only',
    module: 'telegram', before: "business_connection_id: businessConnectionId", after: "business_connection_id: 'wrong'",
    run: async m => {
      const { env } = world(); let posted: any;
      await mocked((url, init) => { posted = JSON.parse(String(init.body)); return respond({ ok: true, result: { message_id: 43 } }); }, async () => {
        const result = await m.telegram.sendTelegram(env, 'BC-ME', '777001', 'Reply fixture.');
        snap([posted.business_connection_id, posted.chat_id, result], ['BC-ME', '777001', { ok: true, externalMessageId: 'BC-ME:777001:43' }]);
      });
    },
  },
  {
    name: 'Telegram getFile refuses unsafe paths and files beyond 20 MB',
    module: 'telegram', before: "path.includes('..')", after: "false",
    run: async m => {
      const { env } = world(); let calls = 0;
      const errors: string[] = [];
      await mocked(() => { calls++; return respond({ ok: true, result: { file_path: '../secret.ogg', file_size: 10 } }); }, async () => {
        try { await m.telegram.fetchTelegramMedia(env, 'voice_id'); } catch (e: any) { errors.push(e.message); }
      });
      await mocked(() => { calls++; return respond({ ok: true, result: { file_path: 'voice/a.ogg', file_size: 20 * 1024 * 1024 + 1 } }); }, async () => {
        try { await m.telegram.fetchTelegramMedia(env, 'voice_id'); } catch (e: any) { errors.push(e.message); }
      });
      snap([errors, calls], [['invalid_media', 'invalid_media'], 2]);
    },
  },
  {
    name: 'Chunked request bodies obey the byte cap before parsing',
    module: 'telegram', before: "if (size > cap)", after: "if (false)",
    run: async m => {
      const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); c.close(); } }));
      let failure = '';
      try { await m.telegram.boundedBytes(response, 10); } catch (e: any) { failure = e.message; }
      snap(failure, 'body_too_large');
    },
  },
  {
    name: 'WhatsApp GET challenge is exact and fail-closed',
    module: 'whatsapp', before: "params.get('hub.mode') === 'subscribe'", after: "params.get('hub.mode') !== 'subscribe'",
    run: async m => {
      const { env } = world();
      const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'challenge-fixture', 'hub.challenge': '123456' });
      const good = await m.whatsapp.whatsAppChallenge(env, p);
      p.set('hub.verify_token', 'forged');
      const bad = await m.whatsapp.whatsAppChallenge(env, p);
      env.WHATSAPP_VERIFY_TOKEN = '';
      snap([good, bad, await m.whatsapp.whatsAppChallenge(env, p)], [
        { status: 200, challenge: '123456' }, { status: 401, challenge: null }, { status: 503, challenge: null },
      ]);
    },
  },
  {
    name: 'Embedded Signup verifies app, scopes and WABA number before subscribing',
    module: 'whatsapp', before: "String(info.app_id) !== appId", after: "String(info.app_id) === appId",
    run: async m => {
      const { env } = world(); const paths: string[] = [];
      await mocked((url) => {
        paths.push(new URL(url).pathname);
        if (url.includes('/oauth/access_token')) return respond({ access_token: 'signup-token-fixture' });
        if (url.includes('/debug_token')) return respond({ data: { is_valid: true, app_id: '55555', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'], granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['20001'] }] } });
        if (url.includes('/phone_numbers')) return respond({ data: [{ id: '10001', display_phone_number: '+44 7000 000001' }] });
        if (url.includes('/subscribed_apps')) return respond({ success: true });
        throw new Error('unexpected_provider_call');
      }, async () => {
        let result: any;
        try { result = await m.whatsapp.exchangeWhatsAppSignup(env, { code: 'code-fixture', wabaId: '20001', phoneNumberId: '10001' }); } catch (e: any) { result = e.message; }
        snap([result, paths], [{ accessToken: 'signup-token-fixture', maskedNumber: '••••0001' },
          ['/v24.0/oauth/access_token', '/v24.0/debug_token', '/v24.0/20001/phone_numbers', '/v24.0/20001/subscribed_apps']]);
      });
    },
  },
  {
    name: 'Cross-member thread reads, assignment, ignore and replies are all refused',
    module: 'routes', before: "(await user(c)).id", after: "2",
    run: async m => {
      const { env, db } = world();
      await tgPost(env, m.routes.channels, tgMessage());
      const { uid } = db.prepare('SELECT uid FROM channel_threads').get();
      const responses = [
        await signed(env, m.routes.channels, '/threads/' + uid, undefined, OTHER),
        await signed(env, m.routes.channels, '/threads/' + uid + '/assign', { interview_id: INTERVIEW }, OTHER),
        await signed(env, m.routes.channels, '/threads/' + uid + '/ignore', {}, OTHER),
        await signed(env, m.routes.channels, '/threads/' + uid + '/reply', { text: 'Reply fixture.', client_key: 'their-key' }, OTHER),
      ];
      snap([responses.map(r => r.status), counts(db)], [[404, 404, 404, 404], { events: 1, messages: 1, threads: 1 }]);
    },
  },
  {
    name: 'Management requires a signed-in active member',
    module: 'routes', before: "const member = await requireAuth(c);", after: "const member = { id: 2 };",
    run: async m => {
      const { env } = world();
      const r = await m.routes.channels.request('https://axal.vc/', {}, env);
      snap(await outcome(r), { status: 401, body: { error: 'unauthorized' } });
    },
  },
  {
    name: 'Admin webhook registration is super-admin-only and never automatic',
    module: 'routes', before: "await requireSuperAdmin(c)", after: "await requireAuth(c)",
    run: async m => {
      const { env, db } = world(); let calls = 0;
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ME);
      await mocked(() => { calls++; return respond({ ok: true }); }, async () => {
        const r = await signed(env, m.routes.adminChannels, '/telegram/webhook', {}, ME);
        snap([r.status, calls], [403, 0]);
      });
    },
  },
  {
    name: 'Per-connection limit refuses the next event and releases its retry claim',
    module: 'routes', before: "if (count >= limit)", after: "if (false)",
    run: async m => {
      const { env, db, kv } = world();
      await tgPost(env, m.routes.channels, tgMessage());
      for (const key of kv.keys()) kv.set(key, '120');
      const r = await tgPost(env, m.routes.channels, tgMessage(11, { message_id: 43 }));
      snap([r.status, counts(db)], [429, { events: 1, messages: 1, threads: 1 }]);
    },
  },
  {
    name: 'Voice queue keeps metadata encrypted and duplicate webhooks enqueue once',
    module: 'routes', before: "message_enc: encoded", after: "message_enc: JSON.stringify(event)",
    run: async m => {
      const { env, db, jobs } = world();
      const payload = waText({ type: 'audio', audio: { id: '12345', mime_type: 'audio/ogg' } });
      await waPost(env, m.routes.channels, payload); await waPost(env, m.routes.channels, payload);
      const raw = JSON.stringify(jobs);
      snap([jobs.length, jobs[0]?.job_type, counts(db), raw.includes('447000000001'), raw.includes('Contact fixture')],
        [1, 'channel_followup', { events: 1, messages: 0, threads: 0 }, false, false]);
    },
  },
  {
    name: 'Voice followup downloads audio under member AI budget and stores only text once',
    module: 'routes', before: "if (!row || row.status === 'done' || row.status === 'ignored')", after: "if (!row)",
    run: async m => {
      const { env, db, jobs, ai } = world(); await waCredentials(env, db);
      await waPost(env, m.routes.channels, waText({ type: 'audio', audio: { id: '12345', mime_type: 'audio/ogg' } }));
      let downloads = 0;
      await mocked(url => {
        if (url === whatsapp.GRAPH + '/12345') return respond({ file_size: 16, url: 'https://lookaside.fbsbx.com/voice', mime_type: 'audio/ogg' });
        if (url === 'https://lookaside.fbsbx.com/voice') { downloads++; return new Response(new Uint8Array(16), { headers: { 'Content-Type': 'audio/ogg' } }); }
        throw new Error('unexpected_provider_call');
      }, async () => {
        await m.routes.channelFollowup(env, jobs[0].payload); await m.routes.channelFollowup(env, jobs[0].payload);
      });
      const thread = db.prepare('SELECT uid FROM channel_threads').get();
      const view = await readThread(env, ME, thread.uid);
      snap([downloads, ai.length, view.messages.map(x => [x.kind, x.text]), db.prepare('SELECT user_id, task FROM ai_usage_logs').all().map((x: any) => [x.user_id, x.task])],
        [1, 1, [['voice', 'Voice transcript fixture.']], [[ME, 'transcribe']]]);
    },
  },
  {
    name: 'WhatsApp media URL cannot forward bearer tokens to arbitrary hosts',
    module: 'whatsapp', before: "url.hostname === 'lookaside.fbsbx.com'", after: "url.hostname === 'attacker.example'",
    run: async m => {
      const { env, db } = world(); await waCredentials(env, db); const conn = (await connectionForWhatsApp(env, '10001'))!;
      let calls = 0, failure = '';
      await mocked(() => { calls++; return respond({ file_size: 16, url: 'https://attacker.example/media' }); }, async () => {
        try { await m.whatsapp.fetchWhatsAppMedia(env, conn, '12345'); } catch (e: any) { failure = e.message; }
      });
      snap([failure, calls], ['invalid_media', 1]);
    },
  },
];
function objectHeader(v: any): any { return Object.fromEntries(Array.from(new Headers(v).entries()).map(([k, value]) => [k === 'authorization' ? 'Authorization' : k, value])); }

for (const check of checks) test(check.name, () => check.run(real));
let serial = 0;
async function mutantModule(check: Check): Promise<Modules> {
  const paths = {
    telegram: '../src/services/channels/telegram.ts',
    whatsapp: '../src/services/channels/whatsapp.ts',
    routes: '../src/routes/channels.ts',
  };
  const file = new URL(paths[check.module], import.meta.url);
  let code = readFileSync(file, 'utf8');
  if (!code.includes(check.before)) throw new Error('mutation_target_missing');
  if (check.name.startsWith('WhatsApp authenticates')) {
    const first = code.indexOf(check.before);
    const second = code.indexOf(check.before, first + check.before.length);
    code = code.slice(0, second) + code.slice(second).replace(check.before, check.after);
  } else code = code.replace(check.before, check.after);
  code = stripTypeScriptTypes(code, { mode: 'strip' });
  code = code.replace(/(from\s*['"])([^'"]+)(['"])/g, (_all, begin, path, end) => begin + (path.startsWith('.') ? new URL(path.endsWith('.ts') ? path : path + '.ts', file).href : import.meta.resolve(path)) + end);
  const loaded = await import('data:text/javascript;base64,' + Buffer.from(code + '\n// mutation ' + serial++).toString('base64'));
  return { ...real, [check.module]: loaded };
}
for (const check of checks) test('mutation and restoration: ' + check.name, async () => {
  await check.run(real);
  const mutant = await mutantModule(check);
  await assert.rejects(check.run(mutant), assert.AssertionError);
  await check.run(real);
});
