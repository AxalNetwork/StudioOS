/**
 * D861 (#2506): rollout gates on isolated D1 fixtures for each environment.
 * These checks certify code behaviour, not Meta approval, W1/W2 integration,
 * live credentials or an operator's authorization to enable the channel.
 */
import assert from 'node:assert/strict';
import * as whatsapp from '../src/services/channels/whatsapp.ts';
import * as threads from '../src/services/channels/threads.ts';
import * as events from '../src/services/channels/events.ts';
import * as connections from '../src/services/channels/connections.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { ME, INTERVIEW, sign } from './_channels_fixture.ts';
import { AT, readinessFixture as fixture, runReadiness, type Mutation } from './_channel_readiness.ts';

const TEXT = 'Synthetic readiness message.';
type Api = { whatsapp: typeof whatsapp; threads: typeof threads; events: typeof events; connections: typeof connections };
const original: Api = { whatsapp, threads, events, connections };

const message = (over = {}) => ({
  externalChatId: 'd861-chat', externalMessageId: 'd861-message', side: 'contact' as const,
  contactName: null, text: TEXT, kind: 'text' as const, sentAt: AT.toISOString(), ...over,
});

async function signature(environment: string, api = original) {
  await fixture(environment, async ({ env }) => {
    const raw = '{"object":"whatsapp_business_account","entry":[]}';
    const bytes = new TextEncoder().encode(raw).buffer;
    assert.equal(await api.whatsapp.verifyWhatsAppSignature(env, bytes, sign(raw)), 'ok');
    assert.equal(await api.whatsapp.verifyWhatsAppSignature(env, bytes, sign(raw + ' ')), 'mismatch');
    assert.equal(await api.whatsapp.verifyWhatsAppSignature(env, bytes, null), 'missing');
    assert.equal(await api.whatsapp.verifyWhatsAppSignature({ ...env, WHATSAPP_APP_SECRET: '' }, bytes, sign(raw)), 'unconfigured');
  });
}

async function consent(environment: string, api = original) {
  await fixture(environment, async ({ env, queued, aiCalls }) => {
    const conn = (await connections.memberConnection(env, ME, 'whatsapp'))!;
    const stored = await api.threads.storeMessage(env, conn, message());
    assert.ok(stored.thread);
    const t = { ...stored.thread!, status: 'assigned' as const, session_id: 1, interview_id: INTERVIEW, consent_state: 'awaiting' as const };
    await api.threads.storeVoiceNote(env, conn, {
      kind: 'message', provider: 'whatsapp', eventId: 'd861-voice', connectionRef: 'd861-connection',
      externalChatId: 'd861-chat', externalMessageId: 'd861-voice', side: 'contact', contactName: null,
      text: null, voice: { fileRef: 'd861-media', mime: 'audio/ogg', durationSec: 1 }, sentAt: AT.toISOString(),
    });
    for (const state of ['awaiting', 'declined', 'withdrawn'] as const) {
      const denied = { ...t, consent_state: state };
      assert.equal(api.threads.inInterview(denied), false, state);
      assert.equal(await api.threads.queueVoiceTranscriptions(env, denied), 0, state);
    }
    assert.equal(queued.length, 0);
    assert.equal(aiCalls.length, 0);
    const allowed = { ...t, consent_state: 'given' as const };
    assert.equal(api.threads.inInterview(allowed), true);
    assert.equal(await api.threads.queueVoiceTranscriptions(env, allowed), 1);
  });
}

async function voiceCap(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = (await connections.memberConnection(env, ME, 'whatsapp'))!;
    // Published cap, deliberately not derived from the implementation constant.
    for (let i = 0; i < 50; i++) assert.equal(await api.events.reserveTranscription(env, conn.integrationId, AT), true);
    assert.equal(await api.events.reserveTranscription(env, conn.integrationId, AT), false);
    assert.equal(await api.events.reserveTranscription(env, conn.integrationId, new Date('2026-10-23T00:00:00Z')), true);
    db.exec('DROP TABLE channel_counters');
    await assert.rejects(() => api.events.reserveTranscription(env, conn.integrationId, AT));
  });
}

async function connectionLimit(environment: string, api = original) {
  await fixture(environment, async ({ env }) => {
    const conn = (await connections.memberConnection(env, ME, 'whatsapp'))!;
    for (let i = 0; i < 120; i++) assert.equal(await api.events.connectionOverLimit(env, conn.integrationId, AT), false);
    assert.equal(await api.events.connectionOverLimit(env, conn.integrationId, AT), true);
    assert.equal(await api.events.connectionOverLimit(env, conn.integrationId, new Date('2026-10-22T12:01:00Z')), false);
    const other = (await connections.memberConnection(env, ME, 'telegram'))!;
    assert.equal(await api.events.connectionOverLimit(env, other.integrationId, AT), false);
  });
}

async function retention(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = (await connections.memberConnection(env, ME, 'whatsapp'))!;
    for (const days of [29, 30, 31]) {
      const at = new Date(AT.getTime() - days * 86400_000).toISOString();
      const stored = await api.threads.storeMessage(env, conn, message({
        externalChatId: 'd861-age-' + days, externalMessageId: 'd861-age-' + days, sentAt: at,
      }));
      db.prepare('UPDATE channel_threads SET last_message_at = ? WHERE uid = ?').run(at, stored.thread!.uid);
    }
    const purged = await api.threads.purgeExpired(env, AT);
    assert.equal(purged.messages, 1);
    assert.equal(purged.threads, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM channel_thread_messages').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM channel_threads').get().n, 2);
  });
}

async function encryptedText(environment: string, api = original) {
  await fixture(environment, async ({ env, db }) => {
    const conn = (await connections.memberConnection(env, ME, 'whatsapp'))!;
    await api.threads.storeMessage(env, conn, message());
    const row = db.prepare('SELECT uid, text_enc FROM channel_thread_messages').get();
    assert.match(row.text_enc, /^v1\./);
    assert.equal(row.text_enc.includes(TEXT), false);
    assert.equal(await decryptColumn(env, 'channel_thread_messages', 'text_enc', row.uid, row.text_enc), TEXT);
    assert.equal(await decryptColumn(env, 'channel_thread_messages', 'text_enc', 'another-row', row.text_enc), null);
  });
}

async function rollout(environment: string, api = original) {
  await fixture(environment, async ({ env }) => {
    const founder: any = { role: 'founder' };
    const admin: any = { role: 'admin', is_super_admin: 1 };
    for (const value of [undefined, '', 'misspelled', 'canary']) {
      const e = { ...env, WHATSAPP_CHANNEL: value };
      assert.equal(api.connections.channelRollout(e, 'whatsapp'), 'canary');
      assert.equal(api.connections.channelOpenTo(e, 'whatsapp', founder), false);
      assert.equal(api.connections.channelOpenTo(e, 'whatsapp', admin), true);
    }
    for (const user of [founder, admin]) {
      assert.equal(api.connections.channelOpenTo({ ...env, WHATSAPP_CHANNEL: 'off' }, 'whatsapp', user), false);
      assert.equal(api.connections.channelOpenTo({ ...env, WHATSAPP_CHANNEL: 'on' }, 'whatsapp', user), true);
    }
  });
}

const mutations: Mutation<Api>[] = [
  ['signature accepts a mismatch', 'whatsapp', 'whatsapp.ts',
    " ? 'ok' : 'mismatch';", " ? 'ok' : 'ok';", signature],
  ['signature rejects valid input', 'whatsapp', 'whatsapp.ts',
    " ? 'ok' : 'mismatch';", " ? 'mismatch' : 'mismatch';", signature],
  ['consent gate removed', 'threads', 'threads.ts',
    "linked(t) && (!consentRequired(t.provider) || t.consent_state === 'given');", 'linked(t);', consent],
  ['consented chat denied', 'threads', 'threads.ts',
    "linked(t) && (!consentRequired(t.provider) || t.consent_state === 'given');", 'false;', consent],
  ['voice cap bypassed', 'events', 'events.ts', '  return !!row;', '  return true;', voiceCap],
  ['voice cap denies all', 'events', 'events.ts', '  return !!row;', '  return false;', voiceCap],
  ['minute limit bypassed', 'events', 'events.ts',
    'return Number(row?.n ?? 0) > CHANNEL_LIMITS.eventsPerMinute;', 'return false;', connectionLimit],
  ['minute limit denies all', 'events', 'events.ts',
    'return Number(row?.n ?? 0) > CHANNEL_LIMITS.eventsPerMinute;', 'return true;', connectionLimit],
  ['retention too long', 'threads', 'threads.ts',
    'now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000', 'now.getTime() - 31 * 86_400_000', retention],
  ['retention too short', 'threads', 'threads.ts',
    'now.getTime() - CHANNEL_LIMITS.pendingDays * 86_400_000', 'now.getTime() - 29 * 86_400_000', retention],
  ['pending text stored plain', 'threads', 'threads.ts',
    "textEnc: await encryptColumn(env, MSG_TABLE, 'text_enc', uid, text)", 'textEnc: text', encryptedText],
  ['pending text corrupted', 'threads', 'threads.ts',
    "textEnc: await encryptColumn(env, MSG_TABLE, 'text_enc', uid, text)", "textEnc: await encryptColumn(env, MSG_TABLE, 'text_enc', uid, 'different')", encryptedText],
  ['rollout allows everyone', 'connections', 'connections.ts',
    "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", 'return true;', rollout],
  ['rollout denies everyone', 'connections', 'connections.ts',
    "return mode === 'on' || (mode === 'canary' && isSuperAdmin(user));", 'return false;', rollout],
];
runReadiness('D861', original, { signature, consent, voiceCap, connectionLimit, retention, encryptedText, rollout }, mutations);
