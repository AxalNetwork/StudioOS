/**
 * D4665 (#4665) — a send is an operation with a recorded outcome (migration 202611071530).
 *
 * The row is written BEFORE any provider I/O and is the member's hourly reservation. Its state is the
 * provider's outcome alone: `accepted` is written the moment the adapter returns, ahead of the credential
 * update, the sent-log row and the introduction record, so a failure in any of them cannot make an
 * accepted email look unsent.
 *
 *   pending → accepted | refused | uncertain;  uncertain → accepted | refused (the member's own word)
 *
 * pending, accepted and uncertain hold a place in the 20-an-hour policy; refused releases it. A replay of
 * the same operation (same `op_key`, same fingerprint) reads this row and never reaches the provider.
 */
import type { Env, User } from '../../types';

export const SENDS_PER_HOUR = 20;
/** A pending row older than this lost its Worker mid-call: whether the provider has the message is unknown. */
export const PENDING_STALE_SECONDS = 120;

export type OpState = 'pending' | 'accepted' | 'refused' | 'uncertain';
export type OpRow = {
  id: number; uid: string; user_id: number; account_id: number; op_key: string; fingerprint: string; state: OpState;
  provider_message_id: string | null; sent_uid: string | null; error_code: string | null; created_at: string; updated_at: string;
};

const stamp = (t = Date.now()) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
export const OP_KEY = /^[A-Za-z0-9_-]{16,64}$/;

async function sha256Hex(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The intended mailbox, recipient, message and what it came from. A changed message is a different operation. */
export const fingerprintOf = (m: { account_uid: string; to: string; subject: string; body: string; draft_uid: string | null; intro_uid: string | null }) =>
  sha256Hex(JSON.stringify([m.account_uid, m.to, m.subject, m.body, m.draft_uid, m.intro_uid]));

export async function opByKey(env: Env, user: User, opKey: string): Promise<OpRow | null> {
  const row = await env.DB.prepare('SELECT * FROM mail_send_ops WHERE user_id = ? AND op_key = ?').bind(user.id, opKey).first<OpRow>();
  return row ? await settle(env, row) : null;
}
export async function opByUid(env: Env, user: User, uid: string): Promise<OpRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  const row = await env.DB.prepare('SELECT * FROM mail_send_ops WHERE user_id = ? AND uid = ?').bind(user.id, uid).first<OpRow>();
  return row ? await settle(env, row) : null;
}

/** A pending row whose Worker is gone has an unknown outcome: it becomes `uncertain`, never `refused`. */
async function settle(env: Env, row: OpRow): Promise<OpRow> {
  if (row.state !== 'pending') return row;
  if (Date.parse(`${row.updated_at.replace(' ', 'T')}Z`) > Date.now() - PENDING_STALE_SECONDS * 1000) return row;
  const r = await env.DB.prepare("UPDATE mail_send_ops SET state = 'uncertain', error_code = 'interrupted', updated_at = ? WHERE id = ? AND state = 'pending'")
    .bind(stamp(), row.id).run();
  return r.meta?.changes === 1 ? { ...row, state: 'uncertain', error_code: 'interrupted' } : (await env.DB.prepare('SELECT * FROM mail_send_ops WHERE id = ?').bind(row.id).first<OpRow>()) ?? row;
}

export type Admission = { kind: 'admitted'; op: OpRow } | { kind: 'limited' } | { kind: 'existing'; op: OpRow };

/**
 * One statement counts the member's held places and inserts the row only while one is free, so two
 * concurrent sends cannot both take the last place. A second admission of the same key finds the first.
 */
export async function admit(env: Env, user: User, accountId: number, opKey: string, fingerprint: string): Promise<Admission> {
  const found = await opByKey(env, user, opKey);
  if (found) return { kind: 'existing', op: found };
  const uid = crypto.randomUUID().replace(/-/g, '');
  const at = stamp();
  const since = stamp(Date.now() - 3600_000);
  try {
    const r = await env.DB.prepare(
      `INSERT INTO mail_send_ops (uid, user_id, account_id, op_key, fingerprint, state, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'pending', ?, ?
        WHERE (SELECT COUNT(*) FROM mail_send_ops WHERE user_id = ? AND created_at > ? AND state <> 'refused') < ?`,
    ).bind(uid, user.id, accountId, opKey, fingerprint, at, at, user.id, since, SENDS_PER_HOUR).run();
    if ((r.meta?.changes ?? 0) !== 1) return { kind: 'limited' };
  } catch (e) {
    const again = await opByKey(env, user, opKey);
    if (again) return { kind: 'existing', op: again };
    throw e;
  }
  const op = await opByKey(env, user, opKey);
  if (!op) throw new Error('send operation vanished');
  return { kind: 'admitted', op };
}

/** Moves an operation to a state, only from the states given. Returns whether it moved. */
export async function settleTo(env: Env, op: OpRow, to: OpState, from: OpState[], extra: { messageId?: string | null; sentUid?: string | null; code?: string | null } = {}): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE mail_send_ops SET state = ?, provider_message_id = COALESCE(?, provider_message_id), sent_uid = COALESCE(?, sent_uid),
            error_code = ?, updated_at = ? WHERE id = ? AND state IN (SELECT value FROM json_each(?))`,
  ).bind(to, extra.messageId ?? null, extra.sentUid ?? null, extra.code ?? null, stamp(), op.id, JSON.stringify(from)).run();
  return r.meta?.changes === 1;
}

/** Never admitted to the provider: the nonce was wrong. The row is removed so the key is free again. */
export async function discard(env: Env, op: OpRow): Promise<void> {
  await env.DB.prepare("DELETE FROM mail_send_ops WHERE id = ? AND state = 'pending'").bind(op.id).run();
}

/** The shape a client sees: no ids, no fingerprint. */
export const opView = (op: OpRow) => ({
  uid: op.uid, state: op.state, provider_message_id: op.provider_message_id, sent_uid: op.sent_uid, error_code: op.error_code,
});
