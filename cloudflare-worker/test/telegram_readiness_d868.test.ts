/**
 * D868 (#2514): Telegram's rollout gates, on the readiness harness WhatsApp's
 * check uses (D861, `_channel_readiness.ts`): each gate on an isolated D1
 * fixture per environment, and a source mutation that must fail it.
 *
 * These checks certify code behaviour, not live credentials, the owner's
 * Premium check or an operator's authorization to switch the channel on. The
 * switch from `canary` to `on` is the owner's own PR to wrangler.toml.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/telegram_readiness_d868.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as telegram from '../src/services/channels/telegram.ts';
import * as threads from '../src/services/channels/threads.ts';
import * as events from '../src/services/channels/events.ts';
import * as connections from '../src/services/channels/connections.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { ME, INTERVIEW, SECRETS, AUDIO, send } from './_channels_fixture.ts';
import { AT, readinessFixture as fixture, runReadiness, type Mutation } from './_channel_readiness.ts';

const TEXT = 'Synthetic readiness message.';
/** The published caps, deliberately not read from the implementation's constants. */
const FIVE_MB = 5 * 1024 * 1024;
const NOTES_PER_DAY = 50;
const PURGE_DAYS = 30;

type Api = { telegram: typeof telegram; threads: typeof threads; events: typeof events; connections: typeof connections };
const original: Api = { telegram, threads, events, connections };

const message = (over = {}) => ({
  externalChatId: 'd868-chat', externalMessageId: 'd868-message', side: 'contact' as const,
  contactName: null, text: TEXT, kind: 'text' as const, sentAt: AT.toISOString(), ...over,
});
const tg = (env: any) => connections.memberConnection(env, ME, 'telegram').then((c) => c!);

async function secret(environment: string, api = original) {
  await fixture(environment, async ({ env }) => {
    const right = SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET;
    assert.equal(await api.telegram.verifyTelegramSecret(env, right), 'ok');
    assert.equal(await api.telegram.verifyTelegramSecret(env, right + 'x'), 'mismatch');
    assert.equal(await api.telegram.verifyTelegramSecret(env, null), 'missing');
    assert.equal(await api.telegram.verifyTelegramSecret({ ...env, TELEGRAM_CHANNEL_WEBHOOK_SECRET: '' }, right), 'unconfigured');
  });
}

async function notesConsent(environment: string, api = original) {
  await fixture(environment, async ({ env, queued, aiCalls }) => {
    const conn = await tg(env);
    const stored = await api.threads.storeMessage(env, conn, message());
    const t = { ...stored.thread!, status: 'assigned' as const, session_id: 1, interview_id: INTERVIEW, consent_state: 'awaiting' as const };
    await api.threads.storeVoiceNote(env, conn, {
      kind: 'message', provider: 'telegram', eventId: 'd868-voice', connectionRef: 'd868-connection',
      externalChatId: 'd868-chat', externalMessageId: 'd868-voice', side: 'contact', contactName: null,
      text: null, voice: { fileRef: 'd868-file', mime: 'audio/ogg', durationSec: 1 }, sentAt: AT.toISOString(),
    } as any);
    // D684: an assigned Telegram chat's text flows at once; D756 §1.5: its notes wait for the contact's YES.
    for (const state of ['awaiting', 'declined', 'withdrawn'] as const) {
      const waiting = { ...t, consent_state: state };
      assert.equal(api.threads.inInterview(waiting), true, `text should flow while ${state}`);
      assert.equal(await api.threads.queueVoiceTranscriptions(env, waiting), 0, `a note was queued while ${state}`);
    }
    assert.equal(queued.length, 0);
    assert.equal(aiCalls.length, 0);
    assert.equal(await api.threads.queueVoiceTranscriptions(env, { ...t, consent_state: 'given' as const }), 1);
  });
}

/** Every Bot API call the voice fetch makes; optional generated audio, never a real download. */
function botApi(fileSize: number | null, bodySize?: number) {
  const calls: string[] = [];
  const route = (url: URL) => {
    calls.push(url.pathname.replace(/bot[^/]+/, 'bot<token>'));
    if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'f', file_size: fileSize, file_path: 'voice/file.ogg' } } };
    if (bodySize !== undefined) {
      const bytes = new Uint8Array(bodySize); bytes.set(AUDIO.OGG);
      return { body: bytes, headers: { 'content-type': 'application/octet-stream' } };
    }
    return { status: 500, json: { ok: false } };
  };
  return { calls, route };
}

async function voiceSize(environment: string, api = original) {
  const note = (size: number | null) => ({ file: 'd868-file', mime: 'audio/ogg', media: 'voice' as const, size });
  // Declared over 5 MB: refused before any call.
  const over = botApi(10);
  await fixture(environment, async ({ env }) => {
    const r = await api.telegram.fetchTelegramVoice(env, note(FIVE_MB + 1));
    assert.deepEqual([r.ok, (r as any).code], [false, 'too_large']);
  }, over.route);
  assert.equal(over.calls.length, 0, 'a note declared over 5 MB reached the Bot API');
  // Declared exactly 5 MB, but getFile reports more: refused after getFile, before any download.
  const late = botApi(FIVE_MB + 1);
  await fixture(environment, async ({ env }) => {
    const r = await api.telegram.fetchTelegramVoice(env, note(FIVE_MB));
    assert.deepEqual([r.ok, (r as any).code], [false, 'too_large']);
  }, late.route);
  assert.deepEqual(late.calls.map((c) => c.split('/').pop()), ['getFile'], 'a file over 5 MB was downloaded');
  // D865 keeps the 5 MiB cap inclusive, including at the streamed-body boundary.
  const exact = botApi(FIVE_MB, FIVE_MB);
  await fixture(environment, async ({ env }) => {
    const r = await api.telegram.fetchTelegramVoice(env, note(FIVE_MB));
    assert.equal(r.ok, true, 'an exact-limit audio file must remain admitted');
    if (r.ok) { assert.equal(r.bytes.byteLength, FIVE_MB); assert.equal(r.mime, 'audio/ogg'); }
  }, exact.route);
  assert.equal(exact.calls.length, 2);
  // Neither the message nor getFile declares the size: the download still has a bound.
  const streamed = botApi(null, FIVE_MB + 1);
  await fixture(environment, async ({ env, aiCalls }) => {
    const r = await api.telegram.fetchTelegramVoice(env, note(null));
    assert.equal(r.ok, false, 'an undeclared oversize download must be refused');
    assert.deepEqual(r, { ok: false, code: 'too_large', retryable: false });
    assert.equal(aiCalls.length, 0);
  }, streamed.route);
  assert.equal(streamed.calls.length, 2);
}

async function videoNotes(environment: string, api = original) {
  assert.equal(api.telegram.TELEGRAM_VIDEO_NOTES, false, 'D865 keeps round videos off until support is verified');
  const bot = botApi(10);
  await fixture(environment, async ({ env }) => {
    const r = await api.telegram.fetchTelegramVoice(env, { file: 'd868-video', mime: 'video/mp4', media: 'video_note', size: 10 });
    assert.deepEqual([r.ok, (r as any).code], [false, 'video_note_unsupported']);
  }, bot.route);
  assert.equal(bot.calls.length, 0, 'a round video reached the Bot API');
}

async function voiceCap(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = await tg(env);
    for (let i = 0; i < NOTES_PER_DAY; i++) assert.equal(await api.events.reserveTranscription(env, conn.integrationId, AT), true);
    assert.equal(await api.events.reserveTranscription(env, conn.integrationId, AT), false);
    assert.equal(await api.events.reserveTranscription(env, conn.integrationId, new Date('2026-10-23T00:00:00Z')), true);
    db.exec('DROP TABLE channel_counters');
    await assert.rejects(() => api.events.reserveTranscription(env, conn.integrationId, AT));
  });
}

async function purge(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = await tg(env);
    for (const days of [PURGE_DAYS - 1, PURGE_DAYS, PURGE_DAYS + 1]) {
      const at = new Date(AT.getTime() - days * 86400_000).toISOString();
      const stored = await api.threads.storeMessage(env, conn, message({ externalChatId: 'd868-age-' + days, externalMessageId: 'd868-age-' + days, sentAt: at }));
      db.prepare('UPDATE channel_threads SET last_message_at = ? WHERE uid = ?').run(at, stored.thread!.uid);
    }
    const purged = await api.threads.purgeExpired(env, AT);
    assert.equal(purged.messages, 1);
    assert.equal(purged.threads, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM channel_threads WHERE provider = 'telegram'").get().n, 2);
  });
}

async function encryptedText(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = await tg(env);
    await api.threads.storeMessage(env, conn, message());
    const row = db.prepare('SELECT uid, text_enc FROM channel_thread_messages').get();
    assert.match(row.text_enc, /^v1\./);
    assert.equal(row.text_enc.includes(TEXT), false);
    assert.equal(await decryptColumn(env, 'channel_thread_messages', 'text_enc', row.uid, row.text_enc), TEXT);
  });
}

async function rollout(environment: string, api = original) {
  await fixture(environment, async ({ env }) => {
    const founder: any = { role: 'founder' };
    const admin: any = { role: 'admin', is_super_admin: 1 };
    for (const value of [undefined, '', 'misspelled', 'canary']) {
      const e = { ...env, TELEGRAM_CHANNEL: value };
      assert.equal(api.connections.channelRollout(e, 'telegram'), 'canary');
      assert.equal(api.connections.channelOpenTo(e, 'telegram', founder), false);
      assert.equal(api.connections.channelOpenTo(e, 'telegram', admin), true);
    }
    for (const user of [founder, admin]) {
      assert.equal(api.connections.channelOpenTo({ ...env, TELEGRAM_CHANNEL: 'off' }, 'telegram', user), false);
      assert.equal(api.connections.channelOpenTo({ ...env, TELEGRAM_CHANNEL: 'on' }, 'telegram', user), true);
    }
  });
}

const mutations: Mutation<Api>[] = [
  ['secret accepts a mismatch', 'telegram', 'telegram.ts', "constantTimeEqual(a, b) ? 'ok' : 'mismatch';", "'ok';", secret],
  ['secret accepts a missing header', 'telegram', 'telegram.ts', "  if (!presented) return 'missing';\n", '', secret],
  ['secret fails open when unset', 'telegram', 'telegram.ts', "if (!secret.trim()) return 'unconfigured';", "if (!secret.trim()) return 'ok';", secret],
  ['notes queued without the YES', 'threads', 'threads.ts',
    "  if (audioConsentRequired(thread.provider) && thread.consent_state !== 'given') return 0;\n", '', notesConsent],
  ['declared size cap removed', 'telegram', 'telegram.ts',
    "  if (note.size != null && note.size > CHANNEL_AUDIO_MAX_BYTES) return refused('too_large');\n", '', voiceSize],
  ['getFile size cap removed', 'telegram', 'telegram.ts',
    "  if (Number.isFinite(size) && size > CHANNEL_AUDIO_MAX_BYTES) return refused('too_large');\n", '', voiceSize],
  ['exact-limit declared audio refused', 'telegram', 'telegram.ts',
    'note.size > CHANNEL_AUDIO_MAX_BYTES', 'note.size >= CHANNEL_AUDIO_MAX_BYTES', voiceSize],
  ['exact-limit getFile audio refused', 'telegram', 'telegram.ts',
    'Number.isFinite(size) && size > CHANNEL_AUDIO_MAX_BYTES', 'Number.isFinite(size) && size >= CHANNEL_AUDIO_MAX_BYTES', voiceSize],
  ['streamed download bound raised', 'telegram', 'telegram.ts',
    'maxBytes: CHANNEL_AUDIO_MAX_BYTES', 'maxBytes: CHANNEL_AUDIO_MAX_BYTES * 2', voiceSize],
  ['round videos switched on', 'telegram', 'telegram.ts', 'export const TELEGRAM_VIDEO_NOTES = false;', 'export const TELEGRAM_VIDEO_NOTES = true;', videoNotes],
  ['voice cap bypassed', 'events', 'events.ts', '  return !!row;', '  return true;', voiceCap],
  ['voice cap denies all', 'events', 'events.ts', '  return !!row;', '  return false;', voiceCap],
  ['purge too late', 'threads', 'threads.ts',
    'now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000', 'now.getTime() - 31 * 86_400_000', purge],
  ['purge too early', 'threads', 'threads.ts',
    'now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000', 'now.getTime() - 29 * 86_400_000', purge],
  ['text stored plain', 'threads', 'threads.ts',
    "textEnc: await encryptColumn(env, MSG_TABLE, 'text_enc', uid, text)", 'textEnc: text', encryptedText],
  ['rollout open to everyone', 'connections', 'connections.ts',
    "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", 'return true;', rollout],
  ['rollout closed to everyone', 'connections', 'connections.ts',
    "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", 'return false;', rollout],
];

runReadiness('D868', original, { secret, notesConsent, voiceSize, videoNotes, voiceCap, purge, encryptedText, rollout }, mutations);

// The route refuses a caller without the secret before reading one byte of the body
// (routes/channels.ts). Checked through the real router; its mutation is run by hand (D868 §2).
test('D868: the webhook refuses a missing or wrong secret, and answers 503 unset, without reading the body', async () => {
  await fixture('production', async ({ env }) => {
    for (const [header, cfg, status] of [
      [null, {}, 401], ['wrong-secret', {}, 401], [SECRETS.TELEGRAM_CHANNEL_WEBHOOK_SECRET, { TELEGRAM_CHANNEL_WEBHOOK_SECRET: '' }, 503],
    ] as const) {
      let pulled = 0;
      const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode('{}')); c.close(); } }, { highWaterMark: 0 });
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (header) headers['X-Telegram-Bot-Api-Secret-Token'] = header;
      const r = await send({ ...env, ...cfg }, '/api/channels/telegram/webhook', { method: 'POST', headers, body, duplex: 'half' } as any);
      assert.equal(r.status, status, String(header));
      assert.equal(pulled, 0, `the body was read for ${header ?? 'no header'}`);
    }
  });
});
