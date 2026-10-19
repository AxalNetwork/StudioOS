/**
 * D756 (#1895) — the Telegram Business interview bot made checkable, and the
 * Bot API 10.3 drift fixed, on the D684 harness (`_channels_fixture.ts`): every
 * Telegram call is a mocked `globalThis.fetch`, and an unexpected URL fails.
 *
 *   · The Super Admin's health read: 503 with secret NAMES when unset and no
 *     call; 403 for anyone else; 200 with codes and numbers only, one issue at
 *     a time; nothing secret leaves, in a response or a log.
 *   · The reply window counts from the contact's last message.
 *   · Event keys survive a reused update_id; a redelivery is still dropped.
 *   · `/start bizChat<id>` gets its own answer and spends no link attempt.
 *   · A 429's retry_after stretches the voice job's next try, and rides a reply's 429.
 *   · A switched-off bot stops downloads and sends; switched back on, the note lands once.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channels_readiness_d756.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { createLinkCode } from '../src/services/channels/linkCodes.ts';
import { normaliseTelegramUpdate, telegramEventId, TELEGRAM_COPY } from '../src/services/channels/telegram.ts';
import {
  ADMIN, INTERVIEW, JWT_SECRET, ME, SECRETS, SECRET_VALUES, TG_ME, businessMessage, call, connectionUpdate, count, linkTelegram,
  mockFetch, nextUpdateId, noSecretsSeen, now, seen, send, telegramApi, tgHook, tgUser, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const HOOK = '/api/admin/channels/telegram/webhook';
const EXPECTED_URL = 'https://axal.vc/api/channels/telegram/webhook';
const ALLOWED = ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'];
const NEWS_TOKEN = '999111:news-bot-token-SECRET';
const PLAIN_ADMIN = 50;

async function adminGet(env: any, user = ADMIN, role = 'admin') {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return send(env, HOOK, { method: 'GET', headers: { authorization: `Bearer ${tok}` } });
}

/** getMe and getWebhookInfo as a healthy bot answers them; each part can be overridden or failed. */
function healthApi(o: { me?: Record<string, unknown>; hook?: Record<string, unknown>; meStatus?: number; hookStatus?: number; meThrows?: boolean } = {}) {
  return (url: URL) => {
    if (url.hostname !== 'api.telegram.org') return undefined;
    if (url.pathname.endsWith('/getMe')) {
      if (o.meThrows) throw new Error('connect ECONNREFUSED');
      if (o.meStatus) return { status: o.meStatus, json: { ok: false, error_code: o.meStatus, description: 'Unauthorized' } };
      return { json: { ok: true, result: { id: 123456, is_bot: true, first_name: 'Axal', username: 'axal_interviews_bot', can_connect_to_business: true, ...o.me } } };
    }
    if (url.pathname.endsWith('/getWebhookInfo')) {
      if (o.hookStatus) return { status: o.hookStatus, json: { ok: false, error_code: o.hookStatus, description: 'Unauthorized' } };
      return { json: { ok: true, result: { url: EXPECTED_URL, has_custom_certificate: false, pending_update_count: 0, allowed_updates: ALLOWED, ...o.hook } } };
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// The health read
// ---------------------------------------------------------------------------

test('health: with a secret unset, 503 not_configured with the missing NAMES only, and no Telegram call', async () => {
  const { env } = await world();
  const f = mockFetch(() => undefined);
  try {
    for (const name of ['TELEGRAM_CHANNEL_BOT_TOKEN', 'TELEGRAM_CHANNEL_BOT_USERNAME', 'TELEGRAM_CHANNEL_WEBHOOK_SECRET']) {
      const r = await adminGet({ ...env, [name]: '' });
      assert.deepEqual([r.status, r.body.code, r.body.configured], [503, 'not_configured', false], name);
      assert.deepEqual(r.body.missing, [name]);
    }
    assert.equal(f.calls.length, 0, 'no Telegram call is made');
  } finally { f.restore(); }
});

test('health: a founder and an admin without the Super Admin elevation are refused 403', async () => {
  const { env, db } = await world();
  db.exec(`UPDATE users SET role = 'admin', is_super_admin = 0 WHERE id = ${PLAIN_ADMIN}`);
  const f = mockFetch(healthApi());
  try {
    assert.equal((await adminGet(env, ME, 'founder')).status, 403);
    assert.equal((await adminGet(env, PLAIN_ADMIN, 'admin')).status, 403);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('health: all good is 200, ready, no issues, from exactly getMe and getWebhookInfo with the channel bot\'s token', async () => {
  const { env } = await world();
  const f = mockFetch(healthApi());
  try {
    const r = await adminGet({ ...env, TELEGRAM_BOT_TOKEN: NEWS_TOKEN });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.configured, r.body.ready, r.body.issues], [true, true, []]);
    assert.deepEqual(r.body.bot, { reachable: true, business_mode: true, username_matches: true, separate_from_news_bot: true });
    assert.deepEqual(r.body.webhook, {
      reachable: true, registered: true, url_matches: true, pending_update_count: 0, last_error_at: null, last_error: null, allowed_updates_match: true,
    });
    assert.ok(!Number.isNaN(Date.parse(r.body.checked_at)));
    assert.deepEqual(f.calls.map((c) => c.url.split('/').pop()).sort(), ['getMe', 'getWebhookInfo']);
    for (const c of f.calls) {
      assert.ok(c.url.includes(SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN), 'the channel bot');
      assert.ok(!c.url.includes(NEWS_TOKEN), 'never the news bot');
    }
  } finally { f.restore(); }
});

async function issuesFor(o: Parameters<typeof healthApi>[0], envExtra: Record<string, unknown> = {}) {
  const { env } = await world();
  const f = mockFetch(healthApi(o));
  try {
    const r = await adminGet({ ...env, ...envExtra });
    assert.equal(r.status, 200, 'the read answers 200 even when Telegram does not');
    return r.body;
  } finally { f.restore(); }
}

test('health: each issue, one at a time', async () => {
  assert.deepEqual((await issuesFor({ me: { can_connect_to_business: false } })).issues, ['business_mode_off']);
  // Telegram usernames are case-insensitive, and the env may carry a leading @.
  assert.deepEqual((await issuesFor({}, { TELEGRAM_CHANNEL_BOT_USERNAME: '@Axal_Interviews_Bot' })).issues, []);
  assert.deepEqual((await issuesFor({ me: { username: 'someone_else_bot' } })).issues, ['username_mismatch']);
  assert.deepEqual((await issuesFor({}, { TELEGRAM_BOT_TOKEN: '123456:the-same-bot-SECRET' })).issues, ['same_bot_as_news']);
  assert.deepEqual((await issuesFor({ hook: { url: '' } })).issues, ['webhook_unregistered']);
  assert.deepEqual((await issuesFor({ hook: { url: 'https://elsewhere.example/hook' } })).issues, ['webhook_elsewhere']);
  assert.deepEqual((await issuesFor({}, { PUBLIC_BASE_URL: 'http://axal.vc', APP_URL: '' })).issues, ['base_url_missing']);
  for (const allowed of [ALLOWED.slice(0, 4), [...ALLOWED, 'callback_query'], undefined]) {
    assert.deepEqual((await issuesFor({ hook: { allowed_updates: allowed } })).issues, ['updates_stale'], JSON.stringify(allowed));
  }
  assert.deepEqual((await issuesFor({ hook: { allowed_updates: [...ALLOWED].reverse() } })).issues, [], 'the same five in another order match');

  // One clock read: a second boundary between two reads failed this once.
  const hourAgo = now() - 3600;
  const recent = await issuesFor({ hook: { last_error_date: hourAgo, last_error_message: `Wrong response from the webhook: ${'x'.repeat(400)}` } });
  assert.deepEqual(recent.issues, ['delivery_error']);
  assert.equal(recent.webhook.last_error_at, new Date(hourAgo * 1000).toISOString());
  assert.equal(recent.webhook.last_error.length, 200, 'clipped to 200 characters');
  const old = await issuesFor({ hook: { last_error_date: now() - 8 * 86400, last_error_message: 'Connection timed out' } });
  assert.deepEqual(old.issues, [], 'an old error does not block ready');
  assert.deepEqual([typeof old.webhook.last_error_at, old.webhook.last_error], ['string', 'Connection timed out']);

  const rejected = await issuesFor({ meStatus: 401 });
  assert.deepEqual(rejected.issues, ['token_rejected']);
  assert.deepEqual(rejected.bot, { reachable: false, error: 'token_rejected' });
  const down = await issuesFor({ meThrows: true });
  assert.deepEqual(down.issues, ['telegram_unreachable']);
  assert.deepEqual(down.bot, { reachable: false, error: 'telegram_unreachable' });
});

test('health: nothing secret leaves, in the response or a log', async () => {
  const { env } = await world();
  const token = SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN, secret = SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET;
  const f = mockFetch(healthApi({ hook: {
    url: `https://evil.example/bot${token}/hook`, last_error_date: now() - 60,
    last_error_message: `Rejected bot${token} with secret ${secret}\u0007 and bot42:abcdefghijklmnopqrstuvwxyz`,
  } }));
  const logged: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    const r = await adminGet(env);
    const text = JSON.stringify(r.body);
    for (const v of [...SECRET_VALUES, token, secret, 'evil.example', '123456', 'axal_interviews_bot']) {
      assert.equal(text.includes(v), false, `the response holds ${v}`);
    }
    assert.match(r.body.webhook.last_error, /•••/);
    assert.doesNotMatch(r.body.webhook.last_error, /[\u0000-\u001f]/);
    assert.deepEqual(r.body.issues, ['webhook_elsewhere', 'delivery_error']);
    for (const line of logged) for (const v of SECRET_VALUES) assert.equal(line.includes(v), false, 'a log holds a secret');
  } finally {
    Object.assign(console, saved);
    f.restore();
  }
});

// ---------------------------------------------------------------------------
// The reply window
// ---------------------------------------------------------------------------

async function telegramThread(env: any) {
  await tgHook(env, businessMessage('BC-ME', { chat: 8001 }));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  return t.uid as string;
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test('window: a contact who wrote 25 hours ago is closed even though the member wrote an hour ago; an hour ago is open; never is closed', async () => {
  const { env, db } = await world({ seed: true });
  const uid = await telegramThread(env);
  const f = mockFetch(telegramApi);
  try {
    db.prepare('UPDATE channel_threads SET last_inbound_at = ?, last_message_at = ?').run(hoursAgo(25), hoursAgo(1));
    const late = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Still there?', client_key: 'w-1' });
    assert.deepEqual([late.status, late.body.code], [409, 'window_closed']);
    assert.equal(late.body.message, 'Your contact last wrote more than 24 hours ago, so a free-form reply is closed. Nothing was sent.');
    assert.equal(f.calls.filter((c) => c.url.endsWith('/sendMessage')).length, 0, 'no sendMessage');
    assert.equal(db.prepare(`SELECT error_code FROM channel_outbound WHERE client_key = 'w-1'`).get().error_code, 'window_closed');
    assert.equal((await call(env, ME, 'GET', `/threads/${uid}`)).body.thread.reply_window_open, false);

    db.prepare('UPDATE channel_threads SET last_inbound_at = ?').run(hoursAgo(1));
    const open = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Can we talk Thursday?', client_key: 'w-2' });
    assert.equal(open.status, 200);
    assert.equal((await call(env, ME, 'GET', `/threads/${uid}`)).body.thread.reply_window_open, true);

    db.exec('UPDATE channel_threads SET last_inbound_at = NULL');
    const never = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Hello?', client_key: 'w-3' });
    assert.deepEqual([never.status, never.body.code], [409, 'window_closed']);
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// Event keys
// ---------------------------------------------------------------------------

const fixedMessage = (updateId: number, chat: number, messageId: number) => ({
  update_id: updateId,
  business_message: {
    message_id: messageId, business_connection_id: 'BC-ME', date: now(),
    chat: { id: chat, type: 'private', first_name: 'Sam' }, from: { id: chat, is_bot: false, first_name: 'Sam' },
    text: `Message ${messageId} in chat ${chat}`,
  },
});

test('event keys: a redelivery is dropped, but a different update that reuses update_id 900 is processed', async () => {
  const { env, db } = await world({ seed: true });
  const messages = () => count(db, 'SELECT COUNT(*) n FROM channel_thread_messages');
  assert.equal((await tgHook(env, fixedMessage(900, 8001, 7))).status, 200);
  assert.equal(messages(), 1);
  assert.equal((await tgHook(env, fixedMessage(900, 8001, 7))).status, 200);
  assert.equal(messages(), 1, 'the same update again stores nothing');
  await tgHook(env, fixedMessage(900, 8002, 3));
  assert.equal(messages(), 2, 'a reused update_id for another chat is stored');
  await tgHook(env, { update_id: 900, business_connection: { id: 'BC-NEW', user: tgUser(TG_ME), user_chat_id: Number(TG_ME), date: now(), is_enabled: true, rights: { can_reply: true } } });
  assert.equal(count(db, `SELECT COUNT(*) n FROM telegram_business_connections WHERE business_connection_id = 'BC-NEW'`), 1, 'a business_connection on 900 is recorded');

  const a = telegramEventId(fixedMessage(900, 8001, 7));
  assert.equal(a, telegramEventId(fixedMessage(900, 8001, 7)), 'stable for the same payload');
  assert.notEqual(a, telegramEventId(fixedMessage(900, 8002, 7)), 'differs when only the chat differs');
  assert.match(String(a), /^900:[0-9a-f]{8}$/);
  assert.equal(normaliseTelegramUpdate(fixedMessage(900, 8001, 7)).eventId, a);
});

// ---------------------------------------------------------------------------
// The "manage this chat" button
// ---------------------------------------------------------------------------

const press = (text: string, tg = TG_ME) => ({
  update_id: nextUpdateId(),
  message: { message_id: nextUpdateId(), date: now(), chat: { id: Number(tg), type: 'private' }, from: tgUser(tg), text },
});

test('bizChat: the normaliser tells the button from a link code', () => {
  assert.equal(normaliseTelegramUpdate(press('/start bizChat8001')).kind, 'manage_chat');
  assert.equal(normaliseTelegramUpdate(press('/start@axal_interviews_bot bizChat8001')).kind, 'manage_chat');
  assert.equal(normaliseTelegramUpdate(press('/start bizChat')).kind, 'link', 'no digits stays a link attempt');
});

test('bizChat: one answer in the member\'s own chat, no code spent, no codeInvalid, and a redelivery sends nothing', async () => {
  const { env, db } = await world();
  const { code } = await createLinkCode(env, ME, 'telegram');
  const f = mockFetch(telegramApi);
  try {
    const u = press('/start bizChat8001');
    await tgHook(env, u);
    const sent = f.calls.filter((c) => c.url.endsWith('/sendMessage'));
    assert.equal(sent.length, 1);
    assert.deepEqual([String(sent[0].body.chat_id), sent[0].body.text], [TG_ME, TELEGRAM_COPY.manageChat]);
    assert.equal(sent[0].body.text, 'To manage this chat, open Axal › Interviews.');
    assert.ok(!f.calls.some((c) => c.body?.text === TELEGRAM_COPY.codeInvalid));
    assert.equal(db.prepare(`SELECT kind FROM channel_events ORDER BY id DESC LIMIT 1`).get().kind, 'command');
    await tgHook(env, u);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/sendMessage')).length, 1, 'a redelivery sends nothing');
    // The code the member made is still unspent: it links.
    const linked = await linkTelegram(env, code);
    assert.equal(linked.status, 200);
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE user_id = ${ME} AND provider_key = 'telegram' AND status = 'active'`), 1);
  } finally { f.restore(); }
});

test('bizChat: 11 presses in an hour give 10 replies, and a real /start then /confirm still link', async () => {
  const { env, db } = await world();
  const f = mockFetch(telegramApi);
  try {
    for (let i = 0; i < 11; i++) await tgHook(env, press(`/start bizChat${8001 + i}`));
    const replies = f.calls.filter((c) => c.url.endsWith('/sendMessage') && c.body.text === TELEGRAM_COPY.manageChat);
    assert.equal(replies.length, 10);
    const { code } = await createLinkCode(env, ME, 'telegram');
    const linked = await linkTelegram(env, code);
    assert.equal(linked.status, 200, 'the presses did not spend the link limit');
    assert.equal(count(db, `SELECT COUNT(*) n FROM integrations WHERE user_id = ${ME} AND provider_key = 'telegram' AND status = 'active'`), 1);
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// retry_after
// ---------------------------------------------------------------------------

/** A Telegram chat with one text message, assigned to INTERVIEW through the route. */
async function assignedTelegramChat(env: any, chat = 8001) {
  await tgHook(env, businessMessage('BC-ME', { chat, text: 'We reconcile invoices by hand every Friday.' }));
  const [t] = (await call(env, ME, 'GET', '/threads?status=pending')).body.items;
  const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  return { uid: t.uid as string, sessionId: Number(a.body.session_id) };
}
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup');

/** A voice note on an assigned chat, with its job queued (the fetch mock is the plain Bot API). */
async function queuedVoiceNote(env: any, queued: any[]) {
  const f = mockFetch(telegramApi);
  let uid = '';
  try {
    ({ uid } = await assignedTelegramChat(env));
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'VOICE-1', duration: 4 } }));
  } finally { f.restore(); }
  const jobs = voiceJobs(queued);
  return { uid, payload: jobs[jobs.length - 1].payload };
}

const getFile429 = (retryAfter: number) => (url: URL) => (url.hostname === 'api.telegram.org' && url.pathname.endsWith('/getFile')
  ? { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: retryAfter } } }
  : undefined);

test('retry_after: getFile 429 waits as Telegram asks, at least the schedule\'s own delay and at most an hour, and downloads nothing', async () => {
  for (const [retryAfter, delay] of [[120, 120], [5, 60], [99999, 3600]] as const) {
    const { env, queued, queuedOpts, aiCalls } = await world({ seed: true });
    const { payload } = await queuedVoiceNote(env, queued);
    const before = queued.length;
    const error = console.error;
    console.error = () => {};
    const f = mockFetch(getFile429(retryAfter));
    try { await runChannelJob(env, 'channel_followup', payload); } finally { f.restore(); console.error = error; }
    assert.equal(queued.length, before + 1, `retry_after ${retryAfter}: the next try is queued`);
    assert.ok(String(queued[queued.length - 1].idempotency_key).endsWith('-try-2'));
    assert.deepEqual(queuedOpts[queuedOpts.length - 1], { delaySeconds: delay }, `retry_after ${retryAfter}`);
    assert.ok(!f.calls.some((c) => c.url.includes('/file/bot')), 'no download');
    assert.equal(aiCalls.length, 0, 'no transcription');
  }
});

test('retry_after: a reply\'s 429 carries retry_after and Retry-After, is recorded rate_limited, and the same key never sends again', async () => {
  const { env, db } = await world({ seed: true });
  const uid = await telegramThread(env);
  const f = mockFetch((url) => (url.hostname === 'api.telegram.org' && url.pathname.endsWith('/sendMessage')
    ? { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 30 } } }
    : undefined));
  const error = console.error;
  console.error = () => {};
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Thursday?', client_key: 'ra-1' });
    assert.deepEqual([r.status, r.body.code, r.body.retry_after], [429, 'rate_limited', 30]);
    assert.equal(r.headers.get('Retry-After'), '30');
    assert.deepEqual({ ...db.prepare(`SELECT status, error_code FROM channel_outbound WHERE client_key = 'ra-1'`).get() }, { status: 'failed', error_code: 'rate_limited' });
    await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Thursday?', client_key: 'ra-1' });
    assert.equal(f.calls.length, 1, 'the same client_key sends nothing again');
  } finally { console.error = error; f.restore(); }
});

// ---------------------------------------------------------------------------
// A switched-off bot
// ---------------------------------------------------------------------------

test('switched off: the job fetches nothing and says bot_off, a reply is refused, and switched back on the note lands once', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const { uid, payload } = await queuedVoiceNote(env, queued);
  await tgHook(env, connectionUpdate('BC-ME', TG_ME, { rights: { can_reply: true } }, false));
  assert.equal(db.prepare(`SELECT is_enabled FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'`).get().is_enabled, 0);

  const f = mockFetch(telegramApi);
  try {
    await runChannelJob(env, 'channel_followup', payload);
    assert.equal(f.calls.length, 0, 'no getFile, no download');
    assert.equal(aiCalls.length, 0, 'no transcription');
    const read = (await call(env, ME, 'GET', `/threads/${uid}`)).body;
    const [note] = read.messages.filter((m: any) => m.awaiting_transcription);
    assert.deepEqual(note.transcription_failure, {
      reason: 'bot_off', retry: 'available',
      sentence: 'The Axal bot is switched off for your Telegram Business account, so this voice note was not fetched. Turn it back on in Telegram › Settings › Telegram Business › Chatbots, then retry.',
    });

    db.prepare('UPDATE channel_threads SET last_inbound_at = ?').run(hoursAgo(1));
    const reply = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Hello?', client_key: 'off-1' });
    assert.deepEqual([reply.status, reply.body.code], [409, 'connection_disabled']);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/sendMessage')).length, 0, 'no sendMessage');

    await tgHook(env, connectionUpdate('BC-ME', TG_ME, { rights: { can_reply: true } }, true));
    const retry = await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`);
    assert.deepEqual([retry.status, retry.body.queued], [200, 1]);
    const jobs = voiceJobs(queued);
    await runChannelJob(env, 'channel_followup', jobs[jobs.length - 1].payload);
    assert.equal(aiCalls.length, 1, 'transcribed once');
    assert.equal(f.calls.filter((c) => c.url.endsWith('/getFile')).length, 1, 'fetched once');
  } finally { f.restore(); }
});
