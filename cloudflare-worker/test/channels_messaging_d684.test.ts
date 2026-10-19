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
 * The shared harness (world, app, call, hooks, mockFetch, builders) lives in
 * `_channels_fixture.ts` since D756 (#1895), unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channels_messaging_d684.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { encryptCredentials, decryptCredentials } from '../src/integrations/secrets.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { transcriptionFailures } from '../src/services/channels/voiceFailures.ts';
import { createLinkCode } from '../src/services/channels/linkCodes.ts';
import { normaliseTelegramUpdate } from '../src/services/channels/telegram.ts';
import { normaliseWhatsAppPayload, maskNumber } from '../src/services/channels/whatsapp.ts';
import { CHANNEL_LIMITS } from '../src/services/channels/types.ts';
import { decryptColumn, encryptColumn } from '../src/services/columnCipher.ts';
import { voiceNoteForJob } from '../src/services/channels/threads.ts';
import {
  ADMIN, app, AUDIO, businessMessage, call, confirmUpdate, connectionUpdate, consentGiven, count, GONE, ids, INTERVIEW,
  JWT_SECRET, linkTelegram, ME, mockFetch, noSecretsSeen, now, OTHER, OTHER_PROJECT, PNID, PNID_GONE,
  PROJECT, ref, refCode, type Route, SECRETS, seen, send, sign, startUpdate, telegramApi, TG_ME, TG_NEW, TG_OTHER,
  tgHook, tgUser, WA_CUSTOMER, WA_TOKEN, waHook, waPayload, waText, world,
} from './_channels_fixture.ts';

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
    assert.equal(count(db, "SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'"), 0, 'Telegram consent alone cannot activate');
    const { claim } = (await call(env, ME, 'GET', '/telegram/link')).body;
    assert.equal((await call(env, ME, 'POST', `/telegram/link/${claim.uid}/confirm`)).body.linked, true);
    const row = db.prepare(`SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'telegram'`).get(ME);
    assert.deepEqual([row.status, row.auth_type, row.external_account_id, row.external_account_name, row.credentials_enc],
      ['active', 'webhook', TG_NEW, '@dana_biz', null]);
    assert.equal(db.prepare(`SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-EARLY'`).get().user_id, ME);
    const reply = f.calls[f.calls.length - 1];
    assert.match(reply.body.text, /Telegram confirmed/i);
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
    db.exec(`UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z'`);
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

    await tgHook(env, { update_id: ++ids.update, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 8001, type: 'private' }, message_ids: [12] } });
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
    await tgHook(env, { update_id: ++ids.update, channel_post: { message_id: 1, chat: { id: -100, type: 'channel' }, text: 'x' } });
    await tgHook(env, { update_id: ++ids.update, message: { message_id: 2, chat: { id: -5, type: 'group' }, from: tgUser('9'), text: '/start abc' } });
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
  // D756 (#1977): a Telegram chat's notes are fetched only after the interviewee's YES.
  await consentGiven(env, null, t.uid);
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

    // D756 (#1977): the interviewee's YES on the pending chat waits on the thread...
    await consentGiven(env, db, t.uid);
    assert.equal(queued.length, 0, 'a pending chat queues nothing, consent or not');
    // ...and the member assigns the chat: now, and only now, the notes are queued — ids only.
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
    await tgHook(env, { update_id: ++ids.update, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: 8001, type: 'private' }, message_ids: [777] } });
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
  // D754 (#1893): a WhatsApp chat links and waits for the interviewee's consent.
  assert.deepEqual([a.body.moved, a.body.voice_queued], [0, 0]);
  assert.equal(queued.length, 0, 'nothing is queued before consent');
  await consentGiven(env, db, t.uid);
  assert.equal(segments(db, a.body.session_id).length, 1, 'the text moved once consent was given');
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
    assert.deepEqual(failureOf(db, 'telegram'), STALE_FAILURE, 'Telegram consent alone keeps the old connection');
    const { claim } = (await call(env, ME, 'GET', '/telegram/link')).body;
    assert.equal((await call(env, ME, 'POST', `/telegram/link/${claim.uid}/confirm`)).body.linked, true);
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
  assert.deepEqual(wa.signup, { app_id: SECRETS.WHATSAPP_APP_ID, config_id: SECRETS.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID, graph_version: 'v23.0' });
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
    assert.equal(notes[0].transcription_failure.sentence, 'This file is over 5 MB. Axal takes up to 5 MB per note from Telegram for now.');
    assert.equal(notes[2].transcription_failure.sentence, 'This Telegram account reached its voice notes for today, so this one waits. Retry it tomorrow.');
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/voice/${notes[0].uid}/retry`)).status, 409, 'too large is never retried');
  } finally { f.restore(); }

  // WhatsApp: the member's token has expired.
  await waHook(env, waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'wamid.T', timestamp: String(now()), type: 'text', text: { body: 'Hi' } }] }));
  const wa = (await call(env, ME, 'GET', '/threads')).body.items.find((t: any) => t.provider === 'whatsapp');
  assert.equal((await call(env, ME, 'POST', `/threads/${wa.uid}/assign`, { interview_id: INTERVIEW })).status, 200);
  await consentGiven(env, db, wa.uid);
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


// ---------------------------------------------------------------------------
// #1602: a missing provider response is an unknown send, never a retry invitation.
// Fake only setTimeout: SQLite, WebCrypto and the request still run normally.
// ---------------------------------------------------------------------------

async function deadlineTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Turn the event loop until `done()` holds or `ms` of real time have passed.
 * A count of turns is no bound on the request: the route verifies a JWT,
 * decrypts tokens and hashes refs with WebCrypto, which finishes on libuv's
 * thread pool, so on a loaded runner (the full suite runs test files in
 * parallel) eighty setImmediate turns all passed before the request reached
 * the provider, and `calls` read 0. Only setTimeout is faked; setImmediate and
 * performance.now() are real.
 */
async function deadlineUntil(done: () => boolean, ms = 10_000) {
  const start = performance.now();
  while (!done() && performance.now() - start < ms) await deadlineTurn();
}

let deadlineMutation = 0;
let deadlineMutantUrl = '';
/** Re-execute the production module with one regression, leaving dependencies real. */
async function deadlineMutant(path: string, before: string, after: string, overrides: Record<string, string> = {}) {
  const file = new URL(path, import.meta.url);
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(before), 'mutation target must exist');
  const { stripTypeScriptTypes } = await import('node:module');
  let source = stripTypeScriptTypes(original.replace(before, after), { mode: 'strip' });
  source = source.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_all, prefix, spec, quote) => prefix + (overrides[spec] ?? (spec.startsWith('.')
      ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href
      : import.meta.resolve(spec))) + quote);
  deadlineMutantUrl = 'data:text/javascript;base64,' + Buffer.from(source + '\n// deadline mutant ' + ++deadlineMutation).toString('base64');
  return import(deadlineMutantUrl);
}

async function checkReplyDeadline(t: any, provider: 'telegram' | 'whatsapp', phase: 'headers' | 'json', application: any = app) {
  const { env, db } = await world({ seed: true });
  if (provider === 'telegram') await tgHook(env, businessMessage('BC-ME', { chat: 8001 }));
  else await waHook(env, waText(PNID, 'wamid.DEADLINE'));
  const thread = db.prepare('SELECT uid FROM channel_threads LIMIT 1').get();
  const token = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const key = 'deadline-' + provider + '-' + phase;
  const request = () => new Request(`https://axal.vc/api/channels/threads/${thread.uid}/reply`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Can we talk Thursday?', client_key: key }),
  });
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let calls = 0, signal: AbortSignal | null = null;
  let late: (value: any) => void = () => {};
  const accepted = provider === 'telegram'
    ? { ok: true, result: { message_id: 99 } } : { messages: [{ id: 'wamid.LATE' }] };
  globalThis.fetch = (async (input: any, init: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (!(url.pathname.endsWith('/sendMessage') || url.pathname.endsWith('/messages'))) throw new Error('unexpected provider URL');
    calls++;
    signal = init.signal as AbortSignal;
    if (phase === 'headers') return new Promise<Response>((resolve) => { late = resolve; });
    const res = new Response('{}', { status: 200 });
    res.json = () => new Promise((resolve) => { late = resolve; });
    return res;
  }) as typeof fetch;
  console.error = () => {};
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false;
    const first = application.fetch(request(), env).then(async (res: Response) => {
      const body = await res.json();
      settled = true;
      return { status: res.status, body };
    });
    // The request must have reached the provider before advancing its deadline.
    // A request that ends without calling the provider stops the wait too.
    await deadlineUntil(() => calls > 0 || settled);
    assert.equal(calls, 1, 'exactly one provider attempt');
    await deadlineTurn(); // body read has begun for the JSON variant
    t.mock.timers.tick(9_999);
    await deadlineTurn();
    assert.equal(settled, false, 'deadline must not expire early');
    t.mock.timers.tick(1);
    await deadlineUntil(() => settled);
    assert.equal(settled, true, 'headers and body must both have a bounded wait');
    const out = await first;
    assert.deepEqual([out.status, out.body.ok, out.body.pending, out.body.code, out.body.outbound?.status],
      [200, null, true, 'send_unknown', 'pending']);
    assert.deepEqual({ ...db.prepare('SELECT status, error_code FROM channel_outbound WHERE client_key = ?').get(key) },
      { status: 'pending', error_code: 'send_unknown' });
    assert.equal(signal?.aborted, true, 'cancel remaining provider I/O');
    const repeat = await application.fetch(request(), env);
    const repeated: any = await repeat.json();
    assert.deepEqual([repeat.status, repeated.ok, repeated.existing, repeated.code, repeated.outbound?.status, calls],
      [200, null, true, 'send_unknown', 'pending', 1], 'a repeated key cannot send twice or report success');

    // Even a provider that ignores abort and reports acceptance later cannot
    // change the answered request or append an unconfirmed "Me" transcript.
    late(phase === 'headers' ? new Response(JSON.stringify(accepted)) : accepted);
    await deadlineTurn();
    assert.deepEqual([db.prepare('SELECT status FROM channel_outbound WHERE client_key = ?').get(key).status,
      count(db, "SELECT COUNT(*) n FROM channel_thread_messages"), calls], ['pending', 1, 1]);
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

for (const provider of ['telegram', 'whatsapp'] as const) {
  for (const phase of ['headers', 'json'] as const) {
    test(`#1602 ${provider}: a hung ${phase} returns unknown and retains its send claim`, async (t) => {
      await checkReplyDeadline(t, provider, phase);
    });
  }
}

test('#1602 mutations: the outbound classification and reply branch cannot turn ambiguity into failure', async (t) => {
  const outbound = await deadlineMutant('../src/services/channels/outbound.ts',
    "result.code === 'send_unknown' ? 'pending' : 'failed'", "result.code === 'send_unknown' ? 'failed' : 'failed'");
  const { env, db } = await world({ seed: true });
  const { beginOutbound } = await import('../src/services/channels/outbound.ts');
  const claim = await beginOutbound(env, 'telegram', ME, null, 'mutant-unknown');
  await outbound.finishOutbound(env, claim.row.id, { ok: false, code: 'send_unknown', retryable: false });
  // Same positive assertion fails against the single-line regression.
  assert.throws(() => assert.deepEqual({ ...db.prepare('SELECT status, error_code FROM channel_outbound WHERE id = ?').get(claim.row.id) },
    { status: 'pending', error_code: 'send_unknown' }), { name: 'AssertionError' });

  const route = await deadlineMutant('../src/routes/channels.ts',
    "if (!result.ok && result.code === 'send_unknown')", "if (false && !result.ok && result.code === 'send_unknown')");
  const mutantApp = new Hono().route('/api/channels', route.default);
  await assert.rejects(() => checkReplyDeadline(t, 'telegram', 'headers', mutantApp), { name: 'AssertionError' });
});

test('#1602 mutations: headers-only timeout leaves a hung JSON body unbounded', async (t) => {
  const helper = await deadlineMutant('../src/services/channels/providerHttp.ts',
    "return await withDeadline((async () => {", "return await ((work: Promise<any>) => work)((async () => {");
  // The mutant ignores extra arguments, removing the actual deadline while
  // keeping the real async fetch/body work and abort-finally behavior.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const res = new Response('{}');
    res.json = () => new Promise(() => {});
    return res;
  }) as typeof fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false;
    helper.providerJson('https://api.telegram.org/unit-test').then(() => { settled = true; }, () => { settled = true; });
    await deadlineTurn();
    t.mock.timers.tick(10_000);
    await deadlineTurn();
    assert.throws(() => assert.equal(settled, true, 'body read must also expire'), { name: 'AssertionError' });
  } finally { t.mock.timers.reset(); globalThis.fetch = originalFetch; }
});

test('#1602 mutations: adapter ambiguity, abort, early expiry and repeat copy are observable', async (t) => {
  for (const provider of ['telegram', 'whatsapp'] as const) {
    const before = provider === 'telegram'
      ? "method === 'sendMessage' ? 'send_unknown' : 'network'"
      : "what === 'send' ? 'send_unknown' : 'network'";
    await deadlineMutant(`../src/services/channels/${provider}.ts`, before, "'network'");
    const route = await deadlineMutant('../src/routes/channels.ts', 'const channels = new Hono', 'const channels = new Hono',
      { [`../services/channels/${provider}`]: deadlineMutantUrl });
    await assert.rejects(() => checkReplyDeadline(t, provider, 'headers', new Hono().route('/api/channels', route.default)), { name: 'AssertionError' });
  }
  for (const [before, after] of [
    ['controller.abort();', 'void controller;'],
    ['PROVIDER_CALL_MS = 10_000', 'PROVIDER_CALL_MS = 9_999'],
  ]) {
    await deadlineMutant('../src/services/channels/providerHttp.ts', before, after);
    await deadlineMutant('../src/services/channels/telegram.ts', "import type { Env }", "import type { Env }",
      { './providerHttp': deadlineMutantUrl });
    const route = await deadlineMutant('../src/routes/channels.ts', 'const channels = new Hono', 'const channels = new Hono',
      { '../services/channels/telegram': deadlineMutantUrl });
    await assert.rejects(() => checkReplyDeadline(t, 'telegram', 'json', new Hono().route('/api/channels', route.default)), { name: 'AssertionError' });
  }
  const route = await deadlineMutant('../src/routes/channels.ts',
    "claim.row.error_code === 'send_unknown' ? 'send_unknown'", "false ? 'send_unknown'");
  await assert.rejects(() => checkReplyDeadline(t, 'whatsapp', 'headers', new Hono().route('/api/channels', route.default)), { name: 'AssertionError' });
});

test('#1602: lost networks and malformed acceptances are unknown; known refusals remain failures', async () => {
  for (const provider of ['telegram', 'whatsapp'] as const) {
    for (const outcome of ['network', 'malformed', 'missing_id', 'refused'] as const) {
      const { env, db } = await world({ seed: true });
      if (provider === 'telegram') await tgHook(env, businessMessage('BC-ME'));
      else await waHook(env, waText(PNID, 'wamid.LOST'));
      const [thread] = (await call(env, ME, 'GET', '/threads')).body.items;
      let calls = 0;
      const originalFetch = globalThis.fetch, originalError = console.error;
      globalThis.fetch = (async () => {
        calls++;
        if (outcome === 'network') throw new TypeError('mocked lost response');
        if (outcome === 'malformed') return new Response('unreadable', { status: 200 });
        if (outcome === 'missing_id') return new Response(JSON.stringify(provider === 'telegram' ? { ok: true, result: {} } : {}));
        return new Response(JSON.stringify(provider === 'telegram' ? { ok: false, error_code: 403 } : { error: { code: 10 } }), { status: 403 });
      }) as typeof fetch;
      console.error = () => {};
      try {
        const key = `${provider}-${outcome}`;
        const reply = () => call(env, ME, 'POST', `/threads/${thread.uid}/reply`, { text: 'Are you free Thursday?', client_key: key });
        const first = await reply(), repeat = await reply();
        const row = db.prepare('SELECT status, error_code FROM channel_outbound WHERE client_key = ?').get(key);
        if (outcome === 'refused') {
          assert.deepEqual([first.status, first.body.code, row.status, repeat.body.ok, calls], [502, 'forbidden', 'failed', false, 1]);
        } else {
          assert.deepEqual([first.status, first.body.ok, first.body.code, row.status, row.error_code,
            repeat.body.ok, repeat.body.code, calls], [200, null, 'send_unknown', 'pending', 'send_unknown', null, 'send_unknown', 1]);
        }
      } finally { globalThis.fetch = originalFetch; console.error = originalError; }
    }
  }
});


// #1602: both owners approve the exact claim, and attempt counters can count.
async function axalConfirm(env: any, owner = ME) {
  const { claim } = (await call(env, owner, 'GET', '/telegram/link')).body;
  return call(env, owner, 'POST', `/telegram/link/${claim.uid}/confirm`);
}

test('#1602 Telegram consent: Telegram alone preserves the old connection and encrypted chats; Axal activates once', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    await tgHook(env, businessMessage('BC-ME'));
    const { code } = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(code, TG_NEW));
    const claim = (await call(env, ME, 'GET', '/telegram/link')).body.claim;
    assert.deepEqual([claim.display_name, claim.username, claim.telegram_confirmed, claim.axal_confirmed, claim.status],
      ['Dana', '@dana_biz', false, false, 'waiting_telegram']);
    assert.equal(JSON.stringify(claim).includes(TG_NEW), false);
    const raw = db.prepare('SELECT claim_details_enc FROM channel_link_codes WHERE uid = ?').get(claim.uid).claim_details_enc;
    assert.equal(raw.includes('Dana') || raw.includes('dana_biz'), false, 'pending names are encrypted');
    assert.equal((await call(env, OTHER, 'GET', '/telegram/link')).body.claim, null);
    assert.equal((await call(env, OTHER, 'POST', `/telegram/link/${claim.uid}/confirm`)).status, 404);

    await tgHook(env, confirmUpdate(TG_NEW));
    assert.deepEqual([db.prepare("SELECT external_account_id FROM integrations WHERE provider_key = 'telegram'").get().external_account_id,
      count(db, 'SELECT COUNT(*) n FROM channel_thread_messages')], [TG_ME, 1], 'Telegram alone changes nothing active');
    assert.equal((await call(env, ME, 'GET', '')).body.telegram_link.status, 'waiting_axal');
    const activated = await axalConfirm(env);
    assert.deepEqual([activated.status, activated.body.linked, activated.body.claim.status], [200, true, 'linked']);
    assert.deepEqual([db.prepare("SELECT external_account_id FROM integrations WHERE provider_key = 'telegram'").get().external_account_id,
      count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'),
      db.prepare("SELECT user_id FROM telegram_business_connections WHERE business_connection_id = 'BC-ME'").get().user_id], [TG_NEW, 0, null]);
    await tgHook(env, connectionUpdate('BC-NEW', TG_NEW));
    await tgHook(env, businessMessage('BC-NEW'));
    db.prepare("UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE uid = ?").run(claim.uid);
    const again = await call(env, ME, 'POST', `/telegram/link/${claim.uid}/confirm`);
    assert.deepEqual([again.status, again.body.linked, again.body.claim.uid, count(db, 'SELECT COUNT(*) n FROM channel_thread_messages')], [200, true, claim.uid, 1], 'a completed confirm remains idempotent past expiry and cannot purge new conversations');
    await createLinkCode(env, ME, 'telegram');
    const oldAgain = await call(env, ME, 'POST', `/telegram/link/${claim.uid}/confirm`);
    assert.deepEqual([oldAgain.body.linked, oldAgain.body.claim.uid], [true, claim.uid], 'the response belongs to the exact claim, not a newer one');
  } finally { f.restore(); }
});

test('#1602 Telegram consent: Axal first waits for Telegram, expiry is original, and a new code/disconnect cancels pending consent', async () => {
  const f = mockFetch(telegramApi);
  try {
    const { env, db } = await world();
    const { code } = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(code));
    const first = await axalConfirm(env);
    assert.deepEqual([first.body.linked, first.body.claim.axal_confirmed, first.body.claim.status,
      count(db, "SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'")], [false, true, 'waiting_telegram', 0]);
    await tgHook(env, confirmUpdate(TG_OTHER));
    assert.equal(count(db, "SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram'"), 0, 'another Telegram account cannot consent');
    await tgHook(env, confirmUpdate());
    assert.equal(count(db, "SELECT COUNT(*) n FROM integrations WHERE provider_key = 'telegram' AND status = 'active'"), 1);

    const fresh = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(fresh.code, TG_NEW));
    const pending = (await call(env, ME, 'GET', '/telegram/link')).body.claim;
    db.prepare("UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z', used_at = datetime('now') WHERE uid = ?").run(pending.uid);
    await tgHook(env, confirmUpdate(TG_NEW));
    assert.deepEqual([(await axalConfirm(env)).status,
      (await call(env, ME, 'GET', '/telegram/link')).body.claim.status,
      db.prepare("SELECT external_account_id FROM integrations WHERE provider_key = 'telegram'").get().external_account_id], [410, 'expired', TG_ME]);

    const replaced = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(replaced.code, TG_NEW));
    const old = (await call(env, ME, 'GET', '/telegram/link')).body.claim.uid;
    await createLinkCode(env, ME, 'telegram');
    assert.equal((await call(env, ME, 'POST', `/telegram/link/${old}/confirm`)).status, 409);
    await tgHook(env, confirmUpdate(TG_NEW));
    assert.equal(db.prepare("SELECT external_account_id FROM integrations WHERE provider_key = 'telegram'").get().external_account_id, TG_ME);

    const unclaimed = (await call(env, ME, 'GET', '/telegram/link')).body.claim.uid;
    assert.equal((await call(env, ME, 'POST', `/telegram/link/${unclaimed}/confirm`)).status, 409);
    await call(env, ME, 'DELETE', '/telegram');
    assert.equal((await call(env, ME, 'POST', `/telegram/link/${unclaimed}/confirm`)).status, 409);
  } finally { f.restore(); }
});

test('#1602 Telegram consent: identity races roll back the whole activation, and parallel confirmations activate once', async () => {
  const f = mockFetch(telegramApi);
  try {
    const { env, db } = await world({ seed: true });
    await tgHook(env, businessMessage('BC-ME'));
    const { code } = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(code, TG_NEW));
    await tgHook(env, confirmUpdate(TG_NEW));
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (stmts: any[]) => {
      // Another member takes the identity after the adapter's read and before
      // D1 starts the activation transaction. The unique index is the arbiter.
      db.prepare("INSERT INTO integrations(uid,user_id,provider_key,auth_type,external_account_id) VALUES('race-tg',?,'telegram','webhook',?)").run(OTHER, TG_NEW);
      env.DB.batch = batch;
      return batch(stmts);
    };
    const race = await axalConfirm(env);
    assert.deepEqual([race.status, race.body.code, count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'),
      db.prepare("SELECT external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'").get(ME).external_account_id,
      (await call(env, ME, 'GET', '/telegram/link')).body.claim.status], [409, 'identity_taken', 1, TG_ME, 'ready']);
    db.prepare("DELETE FROM integrations WHERE uid = 'race-tg'").run();
    const outcomes = await Promise.all([axalConfirm(env), axalConfirm(env)]);
    assert.deepEqual(outcomes.map((r) => [r.status, r.body.linked]), [[200, true], [200, true]]);
    assert.equal(count(db, "SELECT COUNT(*) n FROM integrations WHERE user_id = ? AND provider_key = 'telegram'", ME), 1);
  } finally { f.restore(); }
});

test('#1602 link attempts: atomic D1 counting trips despite KV 429s; missing D1 fails closed; old windows purge', async () => {
  const { env, db } = await world();
  let kvCalls = 0;
  env.RATE_LIMITS = { async get() { kvCalls++; return '0'; }, async put() { kvCalls++; throw new Error('KV 429'); } };
  const issued = await Promise.all(Array.from({ length: 25 }, () => call(env, ME, 'POST', '/telegram/link')));
  assert.deepEqual([issued.filter((r) => r.status === 200).length, issued.filter((r) => r.status === 429).length, kvCalls], [20, 5, 0]);
  const { linkAttemptOverLimit } = await import('../src/services/channels/events.ts');
  const checks = await Promise.all(Array.from({ length: 12 }, () => linkAttemptOverLimit(env, 'ip:203.0.113.17', 10, new Date('2026-10-14T12:05:00Z'))));
  assert.deepEqual([checks.filter((over) => !over).length, checks.filter(Boolean).length], [10, 2], 'concurrent callers may finish in any order');
  const rows = db.prepare('SELECT * FROM channel_link_attempts').all();
  assert.equal(JSON.stringify(rows).includes('203.0.113.17') || JSON.stringify(rows).includes('unknown'), false, 'raw IP is not stored');
  db.exec("UPDATE channel_link_attempts SET window_start = '2000-01-01T00:00:00.000Z'");
  const { purgeExpired } = await import('../src/services/channels/threads.ts');
  await purgeExpired(env);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_link_attempts'), 0);
  db.exec('DROP TABLE channel_link_attempts');
  const before = count(db, 'SELECT COUNT(*) n FROM channel_link_codes');
  const refused = await call(env, ME, 'POST', '/telegram/link');
  assert.deepEqual([refused.status, refused.body.code, count(db, 'SELECT COUNT(*) n FROM channel_link_codes')], [503, 'link_limit_unavailable', before]);
});

test('#1602 consent unreadable/inactive and webhook counter outage leave active connections untouched', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const { code } = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(code, TG_NEW));
    const uid = (await call(env, ME, 'GET', '/telegram/link')).body.claim.uid;
    db.prepare("UPDATE channel_link_codes SET claim_details_enc = 'tampered' WHERE uid = ?").run(uid);
    assert.deepEqual([(await call(env, ME, 'GET', '/telegram/link')).body.claim.status, (await axalConfirm(env)).status], ['unreadable', 409]);
    const fresh = await createLinkCode(env, ME, 'telegram');
    db.exec('DROP TABLE channel_link_attempts');
    await tgHook(env, startUpdate(fresh.code, TG_NEW));
    assert.deepEqual([db.prepare('SELECT used_at FROM channel_link_codes WHERE code_hash = ?').get(refCode(fresh.code)).used_at,
      db.prepare("SELECT external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'").get(ME).external_account_id], [null, TG_ME]);
    assert.match(f.calls.at(-1).body.text, /cannot check link attempts/);
  } finally { f.restore(); }
});


test('#1602 mutation tripwires: neither consent may be omitted, expiry/cancellation scope and counting matter', async () => {
  const f = mockFetch(telegramApi);
  try {
    for (const side of ['axal', 'telegram'] as const) {
      const check = async (adapter: any) => {
        const { env, db } = await world({ seed: true });
        const { code } = await createLinkCode(env, ME, 'telegram');
        await tgHook(env, startUpdate(code, TG_NEW));
        const uid = (await call(env, ME, 'GET', '/telegram/link')).body.claim.uid;
        if (side === 'axal') await adapter.confirmTelegramLink(env, normaliseTelegramUpdate(confirmUpdate(TG_NEW)));
        else await adapter.confirmAxalTelegramLink(env, ME, uid);
        assert.equal(db.prepare("SELECT external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'").get(ME).external_account_id, TG_ME);
      };
      const real = await import('../src/services/channels/telegram.ts');
      await check(real);
      const source = readFileSync(new URL('../src/services/channels/telegram.ts', import.meta.url), 'utf8');
      const column = side === 'axal' ? 'axal_confirmed_at' : 'confirmed_at';
      const refusal = side === 'axal' ? 'waiting_axal' : 'waiting_telegram';
      const checkLine = `if (!claim.${column}) return { linked: false, reason: '${refusal}' };`;
      // Remove the corresponding route-layer AND SQL-layer requirement.
      const mutated = source.replace(checkLine, '').replace(`c.${column} IS NOT NULL`, '1 = 1');
      const adapter = await deadlineMutant('../src/services/channels/telegram.ts', source, mutated);
      await assert.rejects(() => check(adapter), { name: 'AssertionError' });
    }

    const codes = await deadlineMutant('../src/services/channels/linkCodes.ts', 'AND expires_at > ?', 'AND ? IS NOT NULL');
    const { env, db } = await world();
    const { code } = await createLinkCode(env, ME, 'telegram');
    db.exec("UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z'");
    assert.equal(await (await import('../src/services/channels/linkCodes.ts')).consumeLinkCode(env, code, 'telegram', TG_ME), null);
    const bad = await codes.consumeLinkCode(env, code, 'telegram', TG_ME);
    assert.throws(() => assert.equal(bad, null), { name: 'AssertionError' });

    const counter = await deadlineMutant('../src/services/channels/events.ts', 'ON CONFLICT (subject_hash, window_start) DO UPDATE SET n = n + 1', 'ON CONFLICT (subject_hash, window_start) DO UPDATE SET n = n');
    const { env: counterEnv } = await world();
    const counts = await Promise.all(Array.from({ length: 11 }, () => counter.linkAttemptOverLimit(counterEnv, 'ip:fixture', 10)));
    assert.throws(() => assert.deepEqual(counts, Array(10).fill(false).concat([true])), { name: 'AssertionError' });
  } finally { f.restore(); }
});


test('#1602 mutation tripwires: claim ownership, cancellation, encrypted names and private counter keys', async () => {
  const { env, db } = await world();
  const first = await createLinkCode(env, ME, 'telegram');
  const uid = db.prepare('SELECT uid FROM channel_link_codes WHERE code_hash = ?').get(refCode(first.code)).uid;
  const store = await import('../src/services/channels/linkCodes.ts');
  assert.equal(await store.memberLinkClaim(env, OTHER, uid), null);
  const unscoped = await deadlineMutant('../src/services/channels/linkCodes.ts',
    'SELECT * FROM channel_link_codes WHERE user_id = ? AND provider = ? AND uid = ?',
    'SELECT * FROM channel_link_codes WHERE ? IS NOT NULL AND provider = ? AND uid = ?');
  const stolen = await unscoped.memberLinkClaim(env, OTHER, uid);
  assert.throws(() => assert.equal(stolen, null), { name: 'AssertionError' });

  const cancelled = await deadlineMutant('../src/services/channels/linkCodes.ts',
    'activated_at IS NULL AND cancelled_at IS NULL', 'activated_at IS NOT NULL AND cancelled_at IS NULL');
  const next = await cancelled.createLinkCode(env, ME, 'telegram');
  const oldResult = await store.consumeLinkCode(env, first.code, 'telegram', TG_ME);
  assert.throws(() => assert.equal(oldResult, null), { name: 'AssertionError' });

  const plaintext = await deadlineMutant('../src/services/channels/linkCodes.ts',
    "await encryptColumn(env, 'channel_link_codes', 'claim_details_enc', codeRow.uid, JSON.stringify(details))",
    "JSON.stringify(details)");
  await plaintext.consumeLinkCode(env, next.code, 'telegram', TG_NEW, { display_name: 'Dana', username: '@dana_biz' });
  const stored = db.prepare('SELECT claim_details_enc FROM channel_link_codes WHERE code_hash = ?').get(refCode(next.code)).claim_details_enc;
  assert.throws(() => assert.equal(stored.includes('Dana') || stored.includes('dana_biz'), false), { name: 'AssertionError' });

  const counter = await deadlineMutant('../src/services/channels/events.ts',
    "const hash = await indexHmac(env, 'channel_link_attempts', 'subject_hash', subject);", "const hash = subject;");
  await counter.linkAttemptOverLimit(env, 'ip:203.0.113.17', 10);
  assert.throws(() => assert.equal(JSON.stringify(db.prepare('SELECT * FROM channel_link_attempts').all()).includes('203.0.113.17'), false), { name: 'AssertionError' });
});


test('#1602 mutation: a completed claim is idempotent past expiry and the response keeps its own UID', async () => {
  const { env, db } = await world({ seed: true });
  const f = mockFetch(telegramApi);
  try {
    const { code } = await createLinkCode(env, ME, 'telegram');
    await tgHook(env, startUpdate(code, TG_ME));
    await tgHook(env, confirmUpdate(TG_ME));
    const completed = await axalConfirm(env);
    const uid = completed.body.claim.uid;
    db.prepare("UPDATE channel_link_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE uid = ?").run(uid);
    const adapter = await import('../src/services/channels/telegram.ts');
    const check = async (candidate: any) => {
      const out = await candidate.confirmAxalTelegramLink(env, ME, uid).catch(() => ({ linked: false }));
      assert.equal(out.linked, true);
    };
    await check(adapter);
    const bad = await deadlineMutant('../src/services/channels/telegram.ts', 'if (claim.activated_at) {', 'if (false && claim.activated_at) {');
    await assert.rejects(() => check(bad), { name: 'AssertionError' });

    await createLinkCode(env, ME, 'telegram');
    const store = await import('../src/services/channels/linkCodes.ts');
    assert.equal((await store.pendingLinkView(env, ME, uid)).uid, uid);
    const latestInstead = await deadlineMutant('../src/services/channels/linkCodes.ts',
      'const row = uid ? await memberLinkClaim', 'const row = false ? await memberLinkClaim');
    const wrong = await latestInstead.pendingLinkView(env, ME, uid);
    assert.throws(() => assert.equal(wrong.uid, uid), { name: 'AssertionError' });
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// D756 (#1896): voice notes, audio files, audio documents and round videos —
// normalised, and downloaded under a deadline and a 5 MB cap.

const MB5 = 5 * 1024 * 1024;
const TOO_LARGE_TG = 'This file is over 5 MB. Axal takes up to 5 MB per note from Telegram for now.';
const UNSUPPORTED = 'Axal can transcribe MP3, M4A, OGG, WAV and WebM audio only, so this file was not transcribed.';
const ROUND_VIDEO = "Round video messages can't be transcribed yet.";

/** Telegram's API with one file per id: getFile names a path per id, and the path serves its bytes. */
function telegramFiles(files: Record<string, { bytes?: Uint8Array | ReadableStream; size?: number; status?: number; headers?: Record<string, string>; throws?: boolean }>): Route {
  return (url, init) => {
    if (url.pathname.endsWith('/getFile')) {
      const id = String(JSON.parse(String(init.body)).file_id);
      const file = files[id];
      if (file) return { json: { ok: true, result: { file_id: id, file_size: file.size ?? 4000, file_path: `music/${id}.bin` } } };
    }
    const m = /\/file\/bot[^/]+\/music\/(.+)\.bin$/.exec(url.pathname);
    if (m && files[m[1]]) {
      const file = files[m[1]];
      if (file.throws) throw new TypeError('fetch failed');
      return { status: file.status ?? 200, body: file.bytes as any ?? AUDIO.OGG, headers: { 'content-type': 'application/octet-stream', ...(file.headers ?? {}) } };
    }
    return telegramApi(url, init);
  };
}
const fileCalls = (f: { calls: { url: string }[] }) => ({
  getFile: f.calls.filter((c) => c.url.endsWith('/getFile')).length,
  download: f.calls.filter((c) => c.url.includes('/file/bot')).length,
});
const dayCount = (db: any) => Number(db.prepare(`SELECT COALESCE(SUM(n), 0) AS n FROM channel_counters WHERE counter = 'transcriptions_day'`).get().n);
const lastVoiceError = (db: any) => db.prepare(`SELECT error FROM channel_events WHERE kind = 'voice' ORDER BY id DESC LIMIT 1`).get().error;
/** A 6 MB body with no content-length, in 64 KB chunks; `pulls` and `cancelled` say how far it was read. */
function bigStream() {
  const state = { pulls: 0, cancelled: false };
  const chunk = new Uint8Array(64 * 1024).fill(1);
  chunk.set([0x4f, 0x67, 0x67, 0x53]);
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { state.pulls += 1; if (state.pulls * chunk.byteLength > 6 * 1024 * 1024) c.close(); else c.enqueue(chunk.slice()); },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}
async function runLastVoiceJob(env: any, queued: any[]) {
  const jobs = voiceJobs(queued);
  await runChannelJob(env, 'channel_followup', jobs[jobs.length - 1].payload);
}

test('D756 #1896 normaliser: voice, audio, round videos and audio documents become notes; other media, edits and bad sizes do not', () => {
  const norm = (o: Record<string, unknown>, key = 'business_message') => normaliseTelegramUpdate(businessMessage('BC-ME', { ...o, key } as any)) as any;
  const voice = norm({ voice: { file_id: 'V1', mime_type: 'audio/ogg', duration: 7, file_size: 4000 } });
  assert.deepEqual(voice.voice, { fileRef: 'V1', mime: 'audio/ogg', durationSec: 7, media: 'voice', sizeBytes: 4000 });
  const audio = norm({ audio: { file_id: 'A1', mime_type: 'audio/mpeg', duration: 61, file_size: 9000 }, caption: 'The call with Lee' });
  assert.equal(audio.text, null, 'a caption is dropped in v1');
  assert.deepEqual(audio.voice, { fileRef: 'A1', mime: 'audio/mpeg', durationSec: 61, media: 'audio', sizeBytes: 9000 });
  const round = norm({ video_note: { file_id: 'R1', duration: 12, length: 384, file_size: 5000 } });
  assert.deepEqual(round.voice, { fileRef: 'R1', mime: 'video/mp4', durationSec: 12, media: 'video_note', sizeBytes: 5000 });
  const doc = norm({ document: { file_id: 'D1', mime_type: 'audio/x-m4a', file_name: 'call.m4a', file_size: 7000 } });
  assert.deepEqual(doc.voice, { fileRef: 'D1', mime: 'audio/x-m4a', durationSec: null, media: 'audio', sizeBytes: 7000 });
  for (const o of [
    { document: { file_id: 'P1', mime_type: 'application/pdf' } },
    { document: { file_id: 'P2' } },
    { video: { file_id: 'VID', mime_type: 'video/mp4', duration: 3 } },
    { photo: [{ file_id: 'PH', width: 1, height: 1 }] },
  ]) assert.deepEqual([norm(o).kind, norm(o).reason], ['ignored', 'unsupported_type'], JSON.stringify(o));
  assert.equal(norm({ audio: { file_id: 'A2', mime_type: 'audio/mpeg' } }, 'edited_business_message').reason, 'unsupported_type', 'an edit stays text only');
  for (const file_size of [-1, 'x', 2 ** 60]) {
    assert.equal(norm({ audio: { file_id: 'A3', mime_type: 'audio/mpeg', file_size } }).voice.sizeBytes, null, String(file_size));
  }
});

test('D756 #1896 webhook: an audio file needs the secret, lands once, and keeps its kind and size only in the encrypted reference', async () => {
  const { env, db } = await world({ seed: true });
  const update = businessMessage('BC-ME', { audio: { file_id: 'AUDIO-FILE-77', mime_type: 'audio/mpeg', duration: 30, file_size: 4000 } });
  assert.equal((await tgHook(env, update, 'wrong-secret')).status, 401);
  assert.equal((await tgHook(env, update, null)).status, 401);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 0, 'a forged delivery stores nothing');
  assert.equal((await tgHook(env, update)).status, 200);
  assert.equal((await tgHook(env, update)).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_thread_messages'), 1, 'one placeholder');
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_events WHERE kind = 'voice'`), 1, 'one event');
  const row = db.prepare('SELECT * FROM channel_thread_messages').get();
  assert.equal(row.kind, 'voice');
  assert.deepEqual(JSON.parse(String(await decryptColumn(env, 'channel_thread_messages', 'voice_ref_enc', row.uid, row.voice_ref_enc))),
    { file: 'AUDIO-FILE-77', mime: 'audio/mpeg', media: 'audio', size: 4000 });
  for (const table of ['channel_thread_messages', 'channel_events', 'channel_threads']) {
    assert.equal(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()).includes('AUDIO-FILE-77'), false, `${table} holds the file id`);
  }
  // The job reads the kind and size back; a reference written before them (or a bad one) is a voice note of unknown size.
  db.prepare(`UPDATE channel_thread_messages SET transcribe_job = 'J-1' WHERE uid = ?`).run(row.uid);
  const job = await voiceNoteForJob(env, row.uid, 'J-1');
  assert.deepEqual([job?.file, job?.mime, job?.media, job?.size], ['AUDIO-FILE-77', 'audio/mpeg', 'audio', 4000]);
  for (const [stored, want] of [
    [{ file: 'OLD', mime: 'audio/ogg' }, ['voice', null]],
    [{ file: 'BAD', mime: null, media: 'sticker', size: 'x' }, ['voice', null]],
    [{ file: 'NEG', mime: null, media: 'video_note', size: -1 }, ['video_note', null]],
  ] as const) {
    db.prepare('UPDATE channel_thread_messages SET voice_ref_enc = ? WHERE uid = ?')
      .run(await encryptColumn(env, 'channel_thread_messages', 'voice_ref_enc', row.uid, JSON.stringify(stored)), row.uid);
    const read = await voiceNoteForJob(env, row.uid, 'J-1');
    assert.deepEqual([read?.media, read?.size], want, stored.file);
  }
});

test('D756 #1896 job: an MP3, an M4A document and a voice note with no type are each transcribed once; a round video waits, never fetched', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramFiles({ MP3: { bytes: AUDIO.MP3_ID3 }, M4A: { bytes: AUDIO.M4A }, OGG: { bytes: AUDIO.OGG } }));
  try {
    const { uid, sessionId } = await assignedTelegramChat(env);
    const notes = [
      { audio: { file_id: 'MP3', mime_type: 'audio/mpeg', duration: 9 } },
      { document: { file_id: 'M4A', mime_type: 'audio/x-m4a' } },
      { voice: { file_id: 'OGG', duration: 4 } },
    ];
    for (const [i, n] of notes.entries()) {
      await tgHook(env, businessMessage('BC-ME', n as any));
      await runLastVoiceJob(env, queued);
      assert.equal(aiCalls.length, i + 1, `one model call for ${Object.keys(n)[0]}`);
    }
    assert.equal(segments(db, sessionId).length, 4, 'the text and three transcripts');
    assert.equal(dayCount(db), 3);

    const before = f.calls.length;
    await tgHook(env, businessMessage('BC-ME', { video_note: { file_id: 'ROUND', duration: 8, length: 384 } }));
    await runLastVoiceJob(env, queued);
    assert.deepEqual(fileCalls({ calls: f.calls.slice(before) }), { getFile: 0, download: 0 }, 'a round video is never fetched');
    assert.equal(aiCalls.length, 3, 'no model ran');
    assert.equal(lastVoiceError(db), 'video_note_unsupported');
    const [waiting] = await waitingNotes(env, uid);
    assert.deepEqual([waiting.transcription_failure.reason, waiting.transcription_failure.sentence, waiting.transcription_failure.retry],
      ['video_note_unsupported', ROUND_VIDEO, null]);
  } finally { f.restore(); }
});

test('D756 #1896 job: a declared size over 5 MB fetches nothing; getFile over 5 MB never downloads; neither takes the day\'s cap', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramFiles({ BIGMETA: { size: MB5 + 1 } }));
  try {
    const { uid } = await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { audio: { file_id: 'BIGMSG', mime_type: 'audio/mpeg', file_size: MB5 + 1 } }));
    let before = f.calls.length;
    await runLastVoiceJob(env, queued);
    assert.deepEqual(fileCalls({ calls: f.calls.slice(before) }), { getFile: 0, download: 0 }, 'no Telegram call at all');
    assert.equal(lastVoiceError(db), 'too_large');

    await tgHook(env, businessMessage('BC-ME', { audio: { file_id: 'BIGMETA', mime_type: 'audio/mpeg', file_size: 4000 } }));
    before = f.calls.length;
    await runLastVoiceJob(env, queued);
    assert.deepEqual(fileCalls({ calls: f.calls.slice(before) }), { getFile: 1, download: 0 }, 'getFile, then no download');
    assert.equal(lastVoiceError(db), 'too_large');
    assert.equal(dayCount(db), 0, "the day's cap is untouched");
    assert.equal(aiCalls.length, 0);
    const failures = (await waitingNotes(env, uid)).map((m: any) => [m.transcription_failure.reason, m.transcription_failure.sentence, m.transcription_failure.retry]);
    assert.deepEqual(failures, [['too_large', TOO_LARGE_TG, null], ['too_large', TOO_LARGE_TG, null]]);
  } finally { f.restore(); }
});

test('D756 #1896 job: a stream over 5 MB stops being read; a content-length over 5 MB is never read; no model, no cap', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const open = bigStream();
  const declared = bigStream();
  const f = mockFetch(telegramFiles({
    STREAM: { bytes: open.stream },
    LENGTH: { bytes: declared.stream, headers: { 'content-length': String(6 * 1024 * 1024) } },
  }));
  try {
    await assignedTelegramChat(env);
    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'STREAM', mime_type: 'audio/ogg' } }));
    await runLastVoiceJob(env, queued);
    assert.equal(lastVoiceError(db), 'too_large');
    assert.equal(open.state.cancelled, true, 'the read was cancelled');
    assert.ok(open.state.pulls <= 82, `stopped after about 5 MB (${open.state.pulls} chunks)`);

    await tgHook(env, businessMessage('BC-ME', { voice: { file_id: 'LENGTH', mime_type: 'audio/ogg' } }));
    await runLastVoiceJob(env, queued);
    assert.equal(lastVoiceError(db), 'too_large');
    assert.equal(declared.state.pulls, 0, 'not one chunk read');
    assert.equal(aiCalls.length, 0);
    assert.equal(dayCount(db), 0);
  } finally { f.restore(); }
});

test('D756 #1896 job: bytes that disagree with the declared type, or a type the recorder does not take, are refused in plain words', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  const f = mockFetch(telegramFiles({ LIE: { bytes: AUDIO.OGG }, JUNK: { bytes: AUDIO.JUNK }, AAC: {}, ADTS: { bytes: AUDIO.ADTS } }));
  try {
    const { uid } = await assignedTelegramChat(env);
    const cases: [string, Record<string, unknown>][] = [
      ['LIE', { audio: { file_id: 'LIE', mime_type: 'audio/mpeg' } }],
      ['JUNK', { voice: { file_id: 'JUNK' } }],
      ['AAC', { audio: { file_id: 'AAC', mime_type: 'audio/aac' } }],
      ['ADTS', { audio: { file_id: 'ADTS', mime_type: 'audio/mpeg' } }],
    ];
    for (const [id, n] of cases) {
      const before = f.calls.length;
      await tgHook(env, businessMessage('BC-ME', n as any));
      await runLastVoiceJob(env, queued);
      assert.equal(lastVoiceError(db), 'unsupported_format', id);
      if (id === 'AAC') assert.deepEqual(fileCalls({ calls: f.calls.slice(before) }), { getFile: 0, download: 0 }, 'an unadmitted type is refused before any call');
    }
    assert.equal(aiCalls.length, 0);
    assert.equal(dayCount(db), 0);
    for (const m of await waitingNotes(env, uid)) {
      assert.deepEqual([m.transcription_failure.reason, m.transcription_failure.sentence, m.transcription_failure.retry], ['unsupported_format', UNSUPPORTED, null]);
    }
  } finally { f.restore(); }
});

test('D756 #1896 job: a WhatsApp download over 5 MB reaches no model, with D754\'s own sentence', async () => {
  const { env, db, queued, aiCalls } = await world({ seed: true });
  await waHook(env, waPayload(PNID, {
    contacts: [{ profile: { name: 'Priya Shah' }, wa_id: WA_CUSTOMER }],
    messages: [{ from: WA_CUSTOMER, id: 'wamid.BIG', timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-BIG', mime_type: 'audio/ogg', voice: true } }],
  }));
  const [t] = (await call(env, ME, 'GET', '/threads')).body.items;
  await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  await consentGiven(env, db, t.uid);
  const f = mockFetch((url) => {
    if (url.hostname === 'graph.facebook.com') return { json: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA-BIG', mime_type: 'audio/ogg', file_size: 3000, id: 'MEDIA-BIG' } };
    if (url.hostname === 'lookaside.fbsbx.com') return { body: new Uint8Array(6 * 1024 * 1024).fill(1), headers: { 'content-type': 'audio/ogg' } };
    return undefined;
  });
  try {
    await runLastVoiceJob(env, queued);
    assert.equal(f.calls.length, 2, 'the lookup and the download');
    assert.equal(aiCalls.length, 0, 'no model ran');
    // A note queued by the consent carries no webhook event, so its code is on the note.
    assert.equal(db.prepare('SELECT transcribe_error FROM channel_thread_messages').get().transcribe_error, 'too_large');
    assert.equal(dayCount(db), 0);
    const [note] = await waitingNotes(env, t.uid);
    assert.equal(note.transcription_failure.sentence, 'This recording is larger than Axal can take from WhatsApp (5 MB). Record it with the in-app recorder instead.');
  } finally { f.restore(); }
});

test('D756 #1896 logs and rows: a network throw, a 500, an oversize stream and a mismatch log codes only, never the token, path or file id', async (t) => {
  const { env, db, queued } = await world({ seed: true });
  const lines: string[] = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    t.mock.method(console, m, (...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
  }
  const big = bigStream();
  const f = mockFetch(telegramFiles({
    NETFAIL: { throws: true }, SERVER: { status: 500, bytes: new Uint8Array(0) }, HUGESTREAM: { bytes: big.stream }, MISMATCH: { bytes: AUDIO.WEBM },
  }));
  try {
    await assignedTelegramChat(env);
    for (const id of ['NETFAIL', 'SERVER', 'HUGESTREAM', 'MISMATCH']) {
      await tgHook(env, businessMessage('BC-ME', { audio: { file_id: id, mime_type: 'audio/mpeg' } }));
      await runLastVoiceJob(env, queued);
    }
    assert.ok(lines.some((l) => l.includes('telegram file download failed code=')), 'the adapter logs a code');
    const all = lines.join('\n');
    for (const s of [SECRETS.TELEGRAM_CHANNEL_BOT_TOKEN, '/file/bot', 'music/', 'NETFAIL', 'SERVER', 'HUGESTREAM', 'MISMATCH']) {
      assert.equal(all.includes(s), false, `a log line carries ${s}`);
    }
    const codes = new Set(['provider_unreachable', 'provider_unavailable', 'too_large', 'unsupported_format', 'network']);
    const errors = [
      ...db.prepare(`SELECT error FROM channel_events WHERE kind = 'voice' AND error IS NOT NULL`).all().map((r: any) => r.error),
      ...db.prepare('SELECT transcribe_error AS error FROM channel_thread_messages WHERE transcribe_error IS NOT NULL').all().map((r: any) => r.error),
    ];
    assert.ok(errors.length >= 4);
    for (const e of errors) assert.ok(codes.has(e), `an unexpected error value: ${e}`);
  } finally { f.restore(); }
});
