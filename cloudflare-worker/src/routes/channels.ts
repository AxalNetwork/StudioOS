/**
 * D684 / #1576. Mount channels at /api/channels and adminChannels at
 * /api/admin/channels. Webhook paths stay outside index.ts's auth middleware.
 * S01 owns the mounts. No provider payload or exception is logged.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireSuperAdmin } from '../auth';
import { sha256Hex } from '../rpc/secret';
import { activeMember, IntakeError } from '../services/interviewIntake';
import { encryptColumn, decryptColumn } from '../services/columnCipher';
import { encryptCredentials } from '../integrations/secrets';
import { run as aiRun, audioMinutesFromBytes } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { availability, memberConnection, connectionForTelegram, connectionForWhatsApp, providerAvailable, type ChannelConnection } from '../services/channels/connections';
import { claimEvent, finishEvent, releaseEvent } from '../services/channels/events';
import { createLinkCode, consumeLinkCode } from '../services/channels/linkCodes';
import { beginOutbound, finishOutbound, applyDeliveryStatus } from '../services/channels/outbound';
import { storeInbound, storeMessage, applyEdit, applyDelete, assignThread, setThreadIgnored, listThreads, readThread, threadForReply, forgetConnection } from '../services/channels/threads';
import { registerChannelJob, enqueueChannelJob, type ChannelJobPayload } from '../services/channels/jobs';
import { CHANNEL_LIMITS, type InboundEvent, type InboundMessage, type MessagingProvider, type SendResult } from '../services/channels/types';
import { boundedBytes, identifier, object, secret, normaliseTelegram, verifyTelegram, sendTelegram, fetchTelegramMedia, setTelegramWebhook } from '../services/channels/telegram';
import { normaliseWhatsApp, verifyWhatsApp, whatsAppChallenge, replyWindowOpen, sendWhatsApp, fetchWhatsAppMedia, exchangeWhatsAppSignup } from '../services/channels/whatsapp';

export const channels = new Hono<{ Bindings: Env }>();
export const adminChannels = new Hono<{ Bindings: Env }>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const ack = () => json({ ok: true });
const error = (code: string, status: number) => json({ error: code }, status);
const messaging = (v: string): v is MessagingProvider => v === 'telegram' || v === 'whatsapp';
const positive = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

function safeError(e: unknown): Response {
  if (e instanceof IntakeError) return error(e.code, e.status);
  const message = e instanceof Error ? e.message : '';
  if (message === 'Unauthorized') return error('unauthorized', 401);
  if (['Forbidden', 'Admin required', 'Super admin required'].includes(message)) return error('forbidden', 403);
  if (message === 'body_too_large') return error('body_too_large', 413);
  if (message === 'invalid_json') return error('invalid_json', 400);
  if (message === 'client_key_conflict') return error('client_key_conflict', 409);
  return error('channel_unavailable', 503);
}
channels.onError(e => safeError(e));
adminChannels.onError(e => safeError(e));

async function bodyBytes(request: Request): Promise<Uint8Array> {
  return boundedBytes(new Response(request.body, { headers: request.headers }), CHANNEL_LIMITS.maxBodyBytes);
}
async function bodyObject(request: Request): Promise<Record<string, any>> {
  const bytes = await bodyBytes(request);
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))); }
  catch { throw new Error('invalid_json'); }
}
async function user(c: any) {
  const member = await requireAuth(c);
  await activeMember(c.env, member.id);
  return member;
}

/** Fail closed without KV. Keys contain only a hashed connection/member identifier. */
export async function channelRateLimit(env: Env, scope: string, limit: number = CHANNEL_LIMITS.eventsPerMinute): Promise<boolean> {
  if (!env.RATE_LIMITS) throw new Error('rate_limit_unavailable');
  const bucket = Math.floor(Date.now() / 60_000);
  const key = 'channel:' + await sha256Hex(scope) + ':' + bucket;
  const count = Number(await env.RATE_LIMITS.get(key) ?? 0);
  if (!Number.isFinite(count) || count < 0) throw new Error('rate_limit_unavailable');
  if (count >= limit) return false;
  await env.RATE_LIMITS.put(key, String(count + 1), { expirationTtl: 120 });
  return true;
}
async function connection(env: Env, event: InboundEvent): Promise<ChannelConnection | null> {
  if (!('connectionRef' in event)) return null;
  return event.provider === 'telegram' ? connectionForTelegram(env, event.connectionRef) : connectionForWhatsApp(env, event.connectionRef);
}

/** Unknown tenants leave no rows. Claim precedes mutation, provider calls and queueing. */
export async function processChannelEvent(env: Env, event: InboundEvent): Promise<number> {
  if (event.kind === 'ignored') return 200;
  let conn: ChannelConnection | null = null;
  if ('connectionRef' in event) {
    conn = await connection(env, event);
    if (!conn) return 200;
    try { await activeMember(env, conn.userId); } catch (e) { if (e instanceof IntakeError) return 200; throw e; }
  }
  if (event.kind === 'connection') {
    const linked = await env.DB.prepare("SELECT user_id FROM integrations WHERE provider_key = 'telegram' AND external_account_id = ? AND status = 'active'")
      .bind(event.telegramUserId).first<{ user_id: number }>();
    if (!linked) return 200;
    try { await activeMember(env, linked.user_id); } catch (e) { if (e instanceof IntakeError) return 200; throw e; }
  }
  const id = await claimEvent(env, event.provider, await sha256Hex(event.eventId),
    event.kind === 'message' ? (event.voice ? 'voice' : event.side === 'me' ? 'echo' : 'message') : event.kind === 'delete' ? 'edit' : event.kind);
  if (!id) return 200;
  let stored = false;
  try {
    const scope = conn ? 'connection:' + conn.integrationId : event.kind === 'link' ? 'link:' + event.telegramUserId
      : event.kind === 'connection' ? 'connection:' + event.businessConnectionId : '';
    if (!(await channelRateLimit(env, scope))) { await releaseEvent(env, id); return 429; }
    if (event.kind === 'link') {
      const userId = await consumeLinkCode(env, event.code, 'telegram');
      if (!userId) { await finishEvent(env, id, 'ignored'); return 200; }
      stored = true; // Consuming a one-time code is a durable write; do not pretend a retry can unconsume it.
      await activeMember(env, userId);
      const existing = await env.DB.prepare("SELECT uid, external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'telegram'")
        .bind(userId).first<{ uid: string; external_account_id: string | null }>();
      if (existing?.external_account_id && existing.external_account_id !== event.telegramUserId) {
        await finishEvent(env, id, 'ignored', { error: 'disconnect_first' }); return 200;
      }
      await env.DB.prepare(
        "INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, external_account_id, external_account_name, config_json) VALUES (?, ?, 'telegram', 'active', 'webhook', ?, ?, '{}') "
        + "ON CONFLICT(user_id, provider_key) DO UPDATE SET status = 'active', external_account_id = excluded.external_account_id, external_account_name = excluded.external_account_name, updated_at = datetime('now')",
      ).bind(existing?.uid ?? crypto.randomUUID(), userId, event.telegramUserId, event.displayName).run();
      stored = true;
      await finishEvent(env, id, 'done', { userId });
      await sendTelegram(env, null, event.chatId, 'Telegram linked. Connect this bot in Telegram Business to import the chats you choose.');
      return 200;
    }
    if (event.kind === 'connection') {
      const linked = await env.DB.prepare("SELECT id, user_id FROM integrations WHERE provider_key = 'telegram' AND external_account_id = ? AND status = 'active'")
        .bind(event.telegramUserId).first<{ id: number; user_id: number }>();
      if (!linked) { await finishEvent(env, id, 'ignored'); return 200; }
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO telegram_business_connections (uid, business_connection_id, telegram_user_id, user_id, is_enabled, can_reply, rights_json) VALUES (?, ?, ?, ?, ?, ?, ?) "
          + "ON CONFLICT(business_connection_id) DO UPDATE SET user_id = excluded.user_id, is_enabled = excluded.is_enabled, can_reply = excluded.can_reply, rights_json = excluded.rights_json, updated_at = datetime('now') WHERE telegram_business_connections.telegram_user_id = excluded.telegram_user_id",
        ).bind(crypto.randomUUID(), event.businessConnectionId, event.telegramUserId, linked.user_id,
          event.isEnabled ? 1 : 0, event.canReply ? 1 : 0, JSON.stringify(event.rights)),
        env.DB.prepare("UPDATE integrations SET config_json = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(JSON.stringify({ business_connection_id: event.businessConnectionId, can_reply: event.canReply }), linked.id),
      ]);
      stored = true;
      await finishEvent(env, id, 'done', { userId: linked.user_id });
      return 200;
    }
    if (!conn) { await finishEvent(env, id, 'ignored'); return 200; }
    if (event.kind === 'status') {
      const ours = await env.DB.prepare("SELECT id FROM channel_outbound WHERE provider = 'whatsapp' AND user_id = ? AND external_message_id = ?")
        .bind(conn.userId, event.externalMessageId).first();
      if (ours) { await applyDeliveryStatus(env, event.externalMessageId, event.status, event.errorCode); stored = true; }
    } else if (event.kind === 'edit') { await applyEdit(env, conn, event); stored = true; }
    else if (event.kind === 'delete') { await applyDelete(env, conn, event); stored = true; }
    else if (event.kind === 'message') {
      if (event.side === 'me') {
        const ours = await env.DB.prepare('SELECT 1 FROM channel_outbound WHERE provider = ? AND user_id = ? AND external_message_id = ?')
          .bind(event.provider, conn.userId, event.externalMessageId).first();
        if (ours) { await finishEvent(env, id, 'ignored', { userId: conn.userId }); return 200; }
      }
      if (event.voice) {
        const encoded = await encryptColumn(env, 'channel_events', 'voice_job', id, JSON.stringify(event));
        await enqueueChannelJob(env, 'channel_followup', event.provider, String(id), {
          event_id: id, integration_id: conn.integrationId, user_id: conn.userId, connection_ref: event.connectionRef, message_enc: encoded,
        });
        stored = true;
      } else {
        const result = await storeInbound(env, conn, event);
        stored = true;
        await finishEvent(env, id, 'done', { userId: conn.userId, threadId: result.thread?.id, sessionId: 'sessionId' in result ? result.sessionId : null });
        return 200;
      }
    }
    await finishEvent(env, id, event.kind === 'message' && event.voice ? 'stored' : 'done', { userId: conn.userId });
    return 200;
  } catch {
    if (stored) return 200;
    await releaseEvent(env, id);
    return 503;
  }
}

channels.post('/telegram/webhook', async c => {
  const verified = await verifyTelegram(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? null);
  if (verified !== 'ok') return error(verified === 'unavailable' ? 'provider_unavailable' : 'invalid_signature', verified === 'unavailable' ? 503 : 401);
  const payload = await bodyObject(c.req.raw);
  const msg = object(payload.business_message ?? payload.edited_business_message);
  const ref = identifier(msg.business_connection_id);
  const bc = ref ? await c.env.DB.prepare('SELECT telegram_user_id FROM telegram_business_connections WHERE business_connection_id = ?')
    .bind(ref).first<{ telegram_user_id: string }>() : null;
  const event = normaliseTelegram(payload, bc?.telegram_user_id ?? null);
  if (event.kind === 'link' && !(await channelRateLimit(c.env, 'link-ip:' + (c.req.header('CF-Connecting-IP') ?? 'unknown'), 20))) return error('rate_limited', 429);
  const status = await processChannelEvent(c.env, event);
  return status === 200 ? ack() : error(status === 429 ? 'rate_limited' : 'channel_unavailable', status);
});
channels.get('/whatsapp/webhook', async c => {
  const result = await whatsAppChallenge(c.env, new URL(c.req.url).searchParams);
  return result.challenge ? new Response(result.challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
    : error(result.status === 503 ? 'provider_unavailable' : 'invalid_signature', result.status);
});
channels.post('/whatsapp/webhook', async c => {
  if (!secret(c.env, 'WHATSAPP_APP_SECRET')) return error('provider_unavailable', 503);
  const bytes = await bodyBytes(c.req.raw);
  const verified = await verifyWhatsApp(c.env, bytes, c.req.header('X-Hub-Signature-256') ?? null);
  if (verified !== 'ok') return error(verified === 'unavailable' ? 'provider_unavailable' : 'invalid_signature', verified === 'unavailable' ? 503 : 401);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { return error('invalid_json', 400); }
  for (const event of normaliseWhatsApp(payload)) {
    const status = await processChannelEvent(c.env, event);
    if (status !== 200) return error(status === 429 ? 'rate_limited' : 'channel_unavailable', status);
  }
  return ack();
});

const listChannels = async (c: any) => {
  const member = await user(c);
  const connections = await Promise.all((['telegram', 'whatsapp'] as const).map(async provider => {
    const conn = await memberConnection(c.env, member.id, provider);
    return conn ? { provider, connected: true, uid: conn.integrationUid, can_reply: conn.canReply } : { provider, connected: false };
  }));
  const providers = availability(c.env).map(({ provider, available }) => ({ provider, available }));
  const pending = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM channel_threads t JOIN integrations i ON i.id = t.integration_id AND i.status = 'active' WHERE t.user_id = ? AND t.status = 'pending'")
    .bind(member.id).first() as { count: number } | null;
  return json({ providers, connections, pending_count: Number(pending?.count ?? 0) });
};
channels.get('', listChannels);
channels.get('/', listChannels);
channels.post('/telegram/link', async c => {
  const member = await user(c);
  if (!providerAvailable(c.env, 'telegram')) return error('provider_unavailable', 503);
  if (!(await channelRateLimit(c.env, 'member-link:' + member.id, 10))) return error('rate_limited', 429);
  const username = secret(c.env, 'TELEGRAM_CHANNEL_BOT_USERNAME');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return error('provider_unavailable', 503);
  const issued = await createLinkCode(c.env, member.id, 'telegram');
  return json({ code: issued.code, url: 'https://t.me/' + username + '?start=' + issued.code, expires_at: issued.expiresAt });
});
channels.post('/whatsapp/connect', async c => {
  const member = await user(c);
  if (!providerAvailable(c.env, 'whatsapp')) return error('provider_unavailable', 503);
  if (!(await channelRateLimit(c.env, 'member-signup:' + member.id, 10))) return error('rate_limited', 429);
  const body = await bodyObject(c.req.raw);
  const wabaId = identifier(body.waba_id, /^\d{1,30}$/), phoneNumberId = identifier(body.phone_number_id, /^\d{1,30}$/);
  if (!wabaId || !phoneNumberId || typeof body.code !== 'string' || !body.code || body.code.length > 4096) return error('invalid_signup', 400);
  const existing = await c.env.DB.prepare("SELECT uid, external_account_id FROM integrations WHERE user_id = ? AND provider_key = 'whatsapp'")
    .bind(member.id).first<{ uid: string; external_account_id: string | null }>();
  if (existing?.external_account_id && existing.external_account_id !== phoneNumberId) return error('disconnect_first', 409);
  const assigned = await c.env.DB.prepare("SELECT user_id FROM integrations WHERE provider_key = 'whatsapp' AND external_account_id = ? AND status = 'active'")
    .bind(phoneNumberId).first<{ user_id: number }>();
  if (assigned && Number(assigned.user_id) !== member.id) return error('connection_conflict', 409);
  let result: Awaited<ReturnType<typeof exchangeWhatsAppSignup>>;
  try { result = await exchangeWhatsAppSignup(c.env, { code: body.code, wabaId, phoneNumberId }); }
  catch { return error('signup_failed', 502); }
  const uid = existing?.uid ?? crypto.randomUUID();
  const enc = await encryptCredentials(c.env, uid, { access_token: result.accessToken });
  await c.env.DB.prepare(
    "INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, external_account_id, external_account_name, config_json, credentials_enc) VALUES (?, ?, 'whatsapp', 'active', 'oauth2', ?, ?, ?, ?) "
    + "ON CONFLICT(user_id, provider_key) DO UPDATE SET status = 'active', external_account_id = excluded.external_account_id, external_account_name = excluded.external_account_name, config_json = excluded.config_json, credentials_enc = excluded.credentials_enc, updated_at = datetime('now')",
  ).bind(uid, member.id, phoneNumberId, result.maskedNumber, JSON.stringify({ waba_id: wabaId, phone_number_id: phoneNumberId }), enc).run();
  return json({ ok: true, uid });
});
channels.delete('/:provider', async c => {
  const member = await user(c), provider = c.req.param('provider');
  if (!messaging(provider)) return error('unknown_provider', 404);
  const owned = await c.env.DB.prepare('SELECT id FROM integrations WHERE user_id = ? AND provider_key = ?')
    .bind(member.id, provider).first<{ id: number }>();
  if (owned) {
    await forgetConnection(c.env, owned.id);
    await c.env.DB.prepare("UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, external_account_id = NULL, external_account_name = NULL, config_json = '{}' WHERE id = ? AND user_id = ?")
      .bind(owned.id, member.id).run();
  }
  if (provider === 'telegram') {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE telegram_business_connections SET user_id = NULL, is_enabled = 0, can_reply = 0 WHERE user_id = ?').bind(member.id),
      c.env.DB.prepare("UPDATE channel_link_codes SET used_at = datetime('now') WHERE user_id = ? AND provider = 'telegram' AND used_at IS NULL").bind(member.id),
    ]);
  }
  return ack();
});
channels.get('/threads', async c => {
  const member = await user(c), status = c.req.query('status');
  if (status && !['pending', 'assigned', 'ignored'].includes(status)) return error('invalid_status', 400);
  return json({ items: await listThreads(c.env, member.id, { status: status as 'pending' | 'assigned' | 'ignored' | undefined }) });
});
channels.get('/threads/:uid', async c => json(await readThread(c.env, (await user(c)).id, c.req.param('uid'))));
channels.post('/threads/:uid/assign', async c => {
  const member = await user(c), body = await bodyObject(c.req.raw);
  const create = object(body.create);
  if (positive(body.interview_id) && !body.create) return json(await assignThread(c.env, member.id, c.req.param('uid'), { interviewId: Number(body.interview_id) }));
  if (!body.interview_id && positive(create.project_id) && typeof create.interviewee_name === 'string' && create.interviewee_name.trim()) {
    return json(await assignThread(c.env, member.id, c.req.param('uid'), { projectId: Number(create.project_id), intervieweeName: create.interviewee_name }));
  }
  return error('invalid_assignment', 400);
});
channels.post('/threads/:uid/ignore', async c => {
  const member = await user(c), body = await bodyObject(c.req.raw);
  await setThreadIgnored(c.env, member.id, c.req.param('uid'), body.ignored !== false);
  return ack();
});

/** A send accepted before a storage outage can repair its transcript on retry. */
async function recordReply(
  env: Env, conn: ChannelConnection, thread: { id: number; external_chat_id: string },
  outbound: { uid: string; external_message_id: string | null }, text: string,
): Promise<void> {
  if (!outbound.external_message_id) return;
  const claim = await claimEvent(env, conn.provider, await sha256Hex('reply-record:' + outbound.uid), 'echo');
  if (!claim) return;
  let stored = false;
  try {
    await storeMessage(env, conn, {
      externalChatId: thread.external_chat_id, externalMessageId: outbound.external_message_id, side: 'me', contactName: null,
      text, kind: 'text', sentAt: new Date().toISOString(), origin: 'axal',
    });
    stored = true;
    await finishEvent(env, claim, 'done', { userId: conn.userId, threadId: thread.id });
  } catch {
    if (stored) return;
    await releaseEvent(env, claim);
    throw new Error('reply_record_unavailable');
  }
}

export async function replyToThread(env: Env, userId: number, uid: string, text: string, clientKey: string): Promise<Response> {
  const thread = await threadForReply(env, userId, uid);
  const conn = await memberConnection(env, userId, thread.provider);
  if (!conn || conn.integrationId !== thread.integration_id) return error('not_connected', 409);
  if (!conn.canReply) return error('no_reply_right', 409);
  const last = thread.provider === 'whatsapp' ? thread.last_inbound_at : thread.last_message_at;
  if (!replyWindowOpen(last)) return error('window_closed', 409);
  if (!(await channelRateLimit(env, 'reply:' + conn.integrationId, 30))) return error('rate_limited', 429);
  const outbound = await beginOutbound(env, thread.provider, userId, thread.id, clientKey);
  if (outbound.existing) {
    if (Number(outbound.row.thread_id) !== thread.id || outbound.row.provider !== thread.provider) return error('client_key_conflict', 409);
    if (['submitted', 'delivered', 'read'].includes(outbound.row.status)) await recordReply(env, conn, thread, outbound.row, text);
    return json({ ok: outbound.row.status !== 'failed', uid: outbound.row.uid, status: outbound.row.status });
  }
  let result: SendResult;
  if (thread.provider === 'telegram') {
    const bc = await env.DB.prepare('SELECT business_connection_id FROM telegram_business_connections WHERE user_id = ? AND is_enabled = 1 AND can_reply = 1 ORDER BY updated_at DESC LIMIT 1')
      .bind(userId).first<{ business_connection_id: string }>();
    result = bc ? await sendTelegram(env, bc.business_connection_id, thread.external_chat_id, text) : { ok: false, code: 'no_reply_right' };
  } else {
    const row = await env.DB.prepare("SELECT external_account_id FROM integrations WHERE id = ? AND user_id = ? AND status = 'active'")
      .bind(conn.integrationId, userId).first<{ external_account_id: string }>();
    result = row ? await sendWhatsApp(env, conn, row.external_account_id, thread.external_chat_id, text, thread.last_inbound_at) : { ok: false, code: 'not_connected' };
  }
  await finishOutbound(env, outbound.row.id, result);
  if (result.ok && result.externalMessageId) await recordReply(env, conn, thread, { uid: outbound.row.uid, external_message_id: result.externalMessageId }, text);
  return json({ ok: result.ok, uid: outbound.row.uid, status: result.ok ? 'submitted' : 'failed', ...(result.ok ? {} : { error: result.code ?? 'send_failed' }) }, result.ok ? 200 : 502);
}
channels.post('/threads/:uid/reply', async c => {
  const member = await user(c), body = await bodyObject(c.req.raw);
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4096
      || !identifier(body.client_key, /^[A-Za-z0-9_-]{1,100}$/)) return error('invalid_reply', 400);
  return replyToThread(c.env, member.id, c.req.param('uid'), body.text.trim(), body.client_key);
});
channels.post('/:provider/test', async c => {
  const member = await user(c), provider = c.req.param('provider'), body = await bodyObject(c.req.raw);
  if (!messaging(provider)) return error('unknown_provider', 404);
  const conn = await memberConnection(c.env, member.id, provider);
  if (!conn) return error('not_connected', 409);
  if (provider === 'telegram') {
    if (!(await channelRateLimit(c.env, 'test:' + conn.integrationId, 10))) return error('rate_limited', 429);
    const row = await c.env.DB.prepare("SELECT external_account_id FROM integrations WHERE id = ? AND user_id = ?")
      .bind(conn.integrationId, member.id).first<{ external_account_id: string }>();
    const result = row ? await sendTelegram(c.env, null, row.external_account_id, 'Your Axal Telegram connection is working.') : { ok: false };
    return json({ ok: result.ok, status: result.ok ? 'submitted' : 'failed' }, result.ok ? 200 : 502);
  }
  if (typeof body.thread_uid !== 'string' || !identifier(body.client_key, /^[A-Za-z0-9_-]{1,100}$/)) return error('test_thread_required', 400);
  const thread = await threadForReply(c.env, member.id, body.thread_uid);
  if (thread.provider !== provider) return error('thread_not_found', 404);
  return replyToThread(c.env, member.id, thread.uid, 'Your Axal WhatsApp connection is working.', body.client_key);
});
adminChannels.post('/telegram/webhook', async c => {
  const admin = await requireSuperAdmin(c);
  const ok = await setTelegramWebhook(c.env, new URL(c.req.url).origin);
  if (!ok) return error('webhook_registration_failed', 502);
  await c.env.DB.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)')
    .bind(admin.id, 'channel_webhook_registered', JSON.stringify({ provider: 'telegram' })).run();
  return ack();
});

/** Deferred voice work: no retained audio; encrypted queue metadata; member budget only. */
export async function channelFollowup(env: Env, payload: ChannelJobPayload): Promise<void> {
  const id = Number(payload.event_id);
  if (!positive(id) || !messaging(String(payload.provider))) throw new Error('invalid_channel_job');
  const row = await env.DB.prepare('SELECT status FROM channel_events WHERE id = ? AND provider = ?')
    .bind(id, payload.provider).first<{ status: string }>();
  if (!row || row.status === 'done' || row.status === 'ignored') return;
  const plain = await decryptColumn(env, 'channel_events', 'voice_job', id, typeof payload.message_enc === 'string' ? payload.message_enc : null);
  if (!plain) throw new Error('voice_metadata_unreadable');
  let event: InboundMessage;
  try { event = JSON.parse(plain); } catch { throw new Error('invalid_channel_job'); }
  if (event.kind !== 'message' || event.provider !== payload.provider || !event.voice || event.connectionRef !== payload.connection_ref) throw new Error('invalid_channel_job');
  const conn = await connection(env, event);
  if (!conn || conn.integrationId !== Number(payload.integration_id) || conn.userId !== Number(payload.user_id)) {
    await finishEvent(env, id, 'ignored'); return;
  }
  try { await activeMember(env, conn.userId); } catch (e) { if (!(e instanceof IntakeError)) throw new Error('channel_unavailable'); await finishEvent(env, id, 'ignored'); return; }
  const ignored = await env.DB.prepare("SELECT 1 FROM channel_threads WHERE integration_id = ? AND external_chat_id = ? AND status = 'ignored'")
    .bind(conn.integrationId, event.externalChatId).first();
  if (ignored) { await finishEvent(env, id, 'ignored'); return; }
  const media = event.provider === 'telegram' ? await fetchTelegramMedia(env, event.voice.fileRef)
    : await fetchWhatsAppMedia(env, conn, event.voice.fileRef);
  const result = await aiRun(env, {
    task: 'transcribe', userId: conn.userId, surface: AI_SURFACE.validateInterviews,
    audio: media.bytes, audioMime: media.mime ?? event.voice.mime ?? 'audio/ogg',
    audioMinutes: audioMinutesFromBytes(media.bytes.byteLength),
  });
  if (!result.ok) throw new Error('voice_transcription_unavailable');
  const outcome = await storeInbound(env, conn, event, result.output ?? '');
  await finishEvent(env, id, 'done', { userId: conn.userId, threadId: outcome.thread?.id }).catch(() => {});
}
registerChannelJob('channel_followup', 'telegram', channelFollowup);
registerChannelJob('channel_followup', 'whatsapp', channelFollowup);
export default channels;
