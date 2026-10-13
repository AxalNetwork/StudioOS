/**
 * D684 — every message Axal sends on a member's behalf.
 *
 * `beginOutbound` claims a `client_key` (the caller's idempotency key, e.g. the
 * composer's per-message uuid): a repeat of the same key returns the existing
 * row and the caller must not send again. The send result then moves the row to
 * 'submitted' (the provider accepted it) or 'failed'. Only WhatsApp status
 * webhooks move it further, to 'delivered' or 'read' — Telegram never does, and
 * nothing in Axal may call a Telegram message delivered.
 */
import type { Env } from '../../types';
import { refKey } from './events';
import type { MessagingProvider, SendResult } from './types';

export interface OutboundRow {
  id: number; uid: string; provider: MessagingProvider; user_id: number; thread_id: number | null;
  client_key: string; external_message_id: string | null; status: string; error_code: string | null;
}

/** The new row, or `{ existing }` when this client_key was already used. */
export async function beginOutbound(
  env: Env, provider: MessagingProvider, userId: number, threadId: number | null, clientKey: string,
): Promise<{ row: OutboundRow; existing: boolean }> {
  const key = String(clientKey ?? '').trim().slice(0, 100);
  if (!key) throw new Error('client_key_required');
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_outbound (uid, provider, user_id, thread_id, client_key) VALUES (?, ?, ?, ?, ?) RETURNING *`,
  ).bind(crypto.randomUUID(), provider, userId, threadId, key).first<OutboundRow>();
  if (inserted) return { row: inserted, existing: false };
  const row = await env.DB.prepare('SELECT * FROM channel_outbound WHERE client_key = ?').bind(key).first<OutboundRow>();
  if (!row || Number(row.user_id) !== Number(userId)) throw new Error('client_key_conflict');
  return { row, existing: true };
}

/** The provider's message id is stored as its `refKey` hash. */
export async function finishOutbound(env: Env, id: number, result: SendResult): Promise<void> {
  const row = await env.DB.prepare('SELECT provider FROM channel_outbound WHERE id = ?').bind(id).first<{ provider: MessagingProvider }>();
  const ext = result.externalMessageId && row ? await refKey(row.provider, result.externalMessageId) : null;
  await env.DB.prepare(
    `UPDATE channel_outbound SET status = ?, external_message_id = ?, error_code = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(result.ok ? 'submitted' : 'failed', ext, result.ok ? null : (result.code ?? 'send_failed'), id).run();
}

/** Whether a provider message id is one Axal sent (a provider's copy of our own reply). */
export async function isOurSend(env: Env, provider: MessagingProvider, externalMessageId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS hit FROM channel_outbound WHERE provider = ? AND external_message_id = ?')
    .bind(provider, await refKey(provider, externalMessageId)).first();
  return !!row;
}

const RANK: Record<string, number> = { pending: 0, submitted: 1, delivered: 2, read: 3, failed: 4 };

/**
 * A WhatsApp status report. Statuses only move forward (a late 'delivered'
 * never overwrites 'read'); 'failed' always lands.
 */
export async function applyDeliveryStatus(
  env: Env, externalMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', errorCode: string | null,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, status FROM channel_outbound WHERE provider = 'whatsapp' AND external_message_id = ?`,
  ).bind(await refKey('whatsapp', externalMessageId)).first<{ id: number; status: string }>();
  if (!row) return false;
  const next = status === 'sent' ? 'submitted' : status;
  if (next !== 'failed' && (RANK[next] ?? 0) <= (RANK[row.status] ?? 0)) return true;
  await env.DB.prepare(
    `UPDATE channel_outbound SET status = ?, error_code = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(next, next === 'failed' ? (errorCode ?? 'failed') : null, row.id).run();
  return true;
}
