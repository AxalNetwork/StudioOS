/**
 * D4805 (#4805) — notices that follow a decision, from durable state.
 *
 * A notice used to be sent by the route after the decision committed, so a
 * Worker that died in between, or a notice that threw, lost it with no record.
 * Now `noticeStatement` is one of the statements of the decision's own batch:
 * the notice exists exactly when the decision does. `deliverOutbox` sends it
 * after the commit and marks it delivered; `retryOutbox` (the ten-minute cron)
 * sends the ones that did not land. A retry only sends: it never touches the
 * decision, so nothing is decided or written twice.
 *
 * Delivery is at least once. A row is claimed by bumping `attempts` for a short
 * window before it is sent, so two ticks do not send it together; a row that
 * fails MAX_ATTEMPTS times is left for HQ to read in the table rather than
 * retried for ever.
 */
import type { Env } from '../types';
import { notify, type NotifyChannel } from './notify';

export const OUTBOX_MAX_ATTEMPTS = 5;
/** A row someone claimed less than this long ago is not claimed again. */
export const OUTBOX_CLAIM_WINDOW_MS = 5 * 60_000;
export const OUTBOX_RETRY_CAP = 50;

export type Notice = { userId: number; type: string; title: string; body: string; link: string; channels?: NotifyChannel[] };

/** The INSERT that records a notice; put it in the decision's batch, after the guard. */
export function noticeStatement(env: Env, n: Notice): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO program_outbox (kind, user_id, payload_json) VALUES ('notice', ?, ?)`)
    .bind(n.userId, JSON.stringify({ type: n.type, title: n.title, body: n.body, link: n.link, channels: n.channels ?? ['in_app', 'email'] }));
}

type Row = { id: number; user_id: number; payload_json: string };

async function send(env: Env, row: Row, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - OUTBOX_CLAIM_WINDOW_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE program_outbox SET attempts = attempts + 1, last_attempt_at = ?
      WHERE id = ? AND delivered_at IS NULL AND attempts < ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
  ).bind(now.toISOString(), row.id, OUTBOX_MAX_ATTEMPTS, since).run();
  if (!Number(claim.meta?.changes)) return false;
  try {
    const p = JSON.parse(row.payload_json);
    // `notify` never throws on a failure: it answers null, which is also what it answers when the member's
    // preferences switched every channel off. Either way nothing was recorded as delivered, so the row stays
    // pending and is tried again (at most OUTBOX_MAX_ATTEMPTS times, so a suppressed notice is not chased for ever).
    const id = await notify(env, { userId: Number(row.user_id), type: String(p.type), title: String(p.title), body: String(p.body), link: String(p.link), channels: p.channels });
    if (id === null) throw new Error('notify answered null');
    await env.DB.prepare('UPDATE program_outbox SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL').bind(now.toISOString(), row.id).run();
    return true;
  } catch (e) {
    console.error('[program_outbox] notice not delivered', row.id, (e as Error)?.message);
    return false;
  }
}

/** Sends the pending notices of one member, right after their decision committed. Never throws. */
export async function deliverOutbox(env: Env, userId: number, now: Date = new Date()): Promise<number> {
  try {
    const rows = (await env.DB.prepare(
      'SELECT id, user_id, payload_json FROM program_outbox WHERE user_id = ? AND delivered_at IS NULL AND attempts < ? ORDER BY id LIMIT 20',
    ).bind(userId, OUTBOX_MAX_ATTEMPTS).all<Row>()).results || [];
    let sent = 0;
    for (const row of rows) if (await send(env, row, now)) sent += 1;
    return sent;
  } catch (e) {
    console.error('[program_outbox] could not read the pending notices', (e as Error)?.message);
    return 0;
  }
}

export type OutboxRetry = { available: true; tried: number; sent: number } | { available: false; reason: string };

/** The cron's retry: every notice that has not landed, oldest first, a bounded number a tick. */
export async function retryOutbox(env: Env, now: Date = new Date()): Promise<OutboxRetry> {
  let rows: Row[];
  try {
    rows = (await env.DB.prepare(
      'SELECT id, user_id, payload_json FROM program_outbox WHERE delivered_at IS NULL AND attempts < ? ORDER BY id LIMIT ?',
    ).bind(OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_CAP).all<Row>()).results || [];
  } catch (e) {
    return { available: false, reason: `The pending notices could not be read: ${(e as Error).message}` };
  }
  let sent = 0;
  for (const row of rows) if (await send(env, row, now)) sent += 1;
  return { available: true, tried: rows.length, sent };
}
