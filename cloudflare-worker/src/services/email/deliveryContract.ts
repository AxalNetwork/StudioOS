/**
 * D8536 (#8536) — the delivery contract for critical transactional email.
 *
 * Every send in a critical flow (sign-in, invitations, billing, signatures,
 * operational alerts) goes through `deliverWithReference` and:
 *
 *   1. carries a SEND REFERENCE — the flow, the subject record the email is
 *      about, and the attempt (one issuance of that record's link). A retry of
 *      the same issuance computes the same reference; a replacement link is a
 *      new attempt and so a new reference.
 *   2. answers a STATE — `queued` (handed to the job queue), `accepted` (the
 *      provider answered 2xx), `refused` (nothing was accepted, a retry is
 *      safe) or `timed_out` (the request left and no answer came). `delivered`
 *      and `bounced` are admitted by the ledger for a provider that reports
 *      them; Gmail's send API reports neither, so nothing writes them today.
 *   3. is BOUND TO ITS RECIPIENT — the address is read from the subject record
 *      (`SUBJECTS` below), never passed in by the caller.
 *
 * THE LEDGER (`email_send_refs`, migration 202611250054_8536) is what makes a
 * retry reconcile instead of send twice: a reference whose row is `accepted`,
 * `timed_out` or still `sending` is answered from the row and the provider is
 * not called. Only `queued` and `refused` rows may be claimed for a send, and
 * the claim is one conditional UPSERT, so two concurrent retries cannot both
 * hold it. Neither the address nor the link is ever written to the ledger or
 * to a log line.
 *
 * Gmail has no idempotency key on `messages.send` that this code relies on.
 * The reference is ours: a `timed_out` send is never re-sent under the same
 * reference, because the request may have been accepted. Recovering from it
 * is a new attempt (a replacement link, which invalidates the old one).
 */
import type { Env } from '../../types';
import type { ProviderOutcome } from './gmail';

export type DeliveryFlow = 'sign_in' | 'invitation' | 'billing' | 'signature' | 'alert';
export type DeliveryState = 'queued' | 'accepted' | 'refused' | 'timed_out' | 'delivered' | 'bounced';

/**
 * The subject records a critical email can be about, each with the flow it
 * belongs to and the one query that names its recipient. A kind not listed
 * here cannot be sent under the contract.
 */
const SUBJECTS = {
  /** A sign-in or sign-up link: one `magic_link_tokens` row is one issuance. */
  magic_link_token: {
    flow: 'sign_in',
    sql: 'SELECT email AS addr FROM magic_link_tokens WHERE id = ?',
  },
  /** A company invitation, while it is still pending. */
  company_invitation: {
    flow: 'invitation',
    sql: "SELECT email AS addr FROM company_invitations WHERE id = ? AND status = 'pending'",
  },
  /**
   * D8536 part 2 — a native e-sign recipient, while it still waits to sign.
   * The attempt is the signing token's issuance plus the occasion
   * (`signingAttempt` in routes/esign.ts), so a reminder is its own send and a
   * retry of the same reminder reconciles.
   */
  esign_recipient: {
    flow: 'signature',
    sql: "SELECT recipient_email AS addr FROM esign_recipients WHERE id = ? AND status = 'pending'",
  },
  /** A signed PDF forwarded to a legal partner: the forward log row, written before the send, names the address. */
  esign_forward: {
    flow: 'signature',
    sql: 'SELECT forwarded_to AS addr FROM esign_forward_log WHERE id = ?',
  },
  /** A Stripe receipt: the `invoice_email_log` row for one invoice or charge, written before the send. */
  invoice_receipt: {
    flow: 'billing',
    sql: 'SELECT recipient AS addr FROM invoice_email_log WHERE id = ?',
  },
  /** A storefront order's confirmation: the buyer the order row names. */
  order_receipt: {
    flow: 'billing',
    sql: 'SELECT u.email AS addr FROM orders o JOIN users u ON u.id = o.user_id WHERE o.order_ref = ?',
  },
  /** An operational alert to one admin: the `notifications` row written for that admin, while the admin is active. */
  admin_alert: {
    flow: 'alert',
    sql: "SELECT u.email AS addr FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ? AND u.role = 'admin' AND u.is_active = 1",
  },
} as const satisfies Record<string, { flow: DeliveryFlow; sql: string }>;

export type SubjectKind = keyof typeof SUBJECTS;

export interface SendReference {
  flow: DeliveryFlow;
  subject: { kind: SubjectKind; id: number | string };
  /** Which issuance of the subject's link this is. Stable across retries of that issuance. */
  attempt: number | string;
}

export interface DeliveryResult {
  ref: string;
  state: DeliveryState;
  reason: string | null;
  /** True when the answer came from the ledger and the provider was not called. */
  reconciled: boolean;
}

const PART = /^[A-Za-z0-9_.-]{1,80}$/;

/** The reference as one string: `flow:kind:id:attempt`. Throws on a malformed reference. */
export function refKey(ref: SendReference): string {
  const spec = SUBJECTS[ref.subject.kind];
  if (!spec) throw new Error(`email contract: unknown subject kind ${String(ref.subject.kind)}`);
  if (spec.flow !== ref.flow) throw new Error(`email contract: ${ref.subject.kind} belongs to ${spec.flow}, not ${ref.flow}`);
  const id = String(ref.subject.id);
  const attempt = String(ref.attempt);
  if (!PART.test(id) || !PART.test(attempt)) throw new Error('email contract: malformed subject id or attempt');
  return `${ref.flow}:${ref.subject.kind}:${id}:${attempt}`;
}

/** The address the subject record names, or null when the record is gone or no longer sendable. */
export async function recipientOf(env: Env, ref: SendReference): Promise<string | null> {
  const spec = SUBJECTS[ref.subject.kind];
  if (!spec) return null;
  const row = await env.DB.prepare(spec.sql).bind(ref.subject.id).first<{ addr: string | null }>();
  const addr = String(row?.addr || '').trim();
  return addr || null;
}

/** A stored state as the contract answers it: a row still `sending` is a request that may have left. */
function answered(state: string): DeliveryState {
  return state === 'sending' ? 'timed_out' : (state as DeliveryState);
}

async function readRow(env: Env, key: string): Promise<{ state: string; reason: string | null } | null> {
  return await env.DB.prepare('SELECT state, reason FROM email_send_refs WHERE ref = ?')
    .bind(key).first<{ state: string; reason: string | null }>();
}

/**
 * Record that this reference was handed to the queue. Returns the reference's
 * state as the ledger now holds it: `queued` for a new reference, or the state
 * an earlier attempt left (`accepted`, `timed_out`, …), which the caller
 * answers instead of enqueueing again. `null` when the ledger cannot be read.
 */
export async function recordQueued(env: Env, ref: SendReference): Promise<DeliveryState | null> {
  const key = refKey(ref);
  try {
    await env.DB.prepare(
      `INSERT INTO email_send_refs (ref, flow, subject_kind, subject_id, attempt, state, tries)
       VALUES (?, ?, ?, ?, ?, 'queued', 0)
       ON CONFLICT(ref) DO NOTHING`,
    ).bind(key, ref.flow, ref.subject.kind, String(ref.subject.id), String(ref.attempt)).run();
    const row = await readRow(env, key);
    return row ? answered(row.state) : null;
  } catch (e: any) {
    console.error('[email/contract] ledger unavailable at enqueue', e?.name || 'Error');
    return null;
  }
}

/** Settled states: a retry of the reference answers these from the ledger. */
export function isSettled(state: DeliveryState | null): boolean {
  return state === 'accepted' || state === 'timed_out' || state === 'delivered' || state === 'bounced';
}

/**
 * Send once under `ref`, reconciling with any earlier attempt.
 *
 * `provider` is called with the address the subject record names and returns
 * what the provider did. `tries` bounds in-call retries, which happen only
 * after `refused` for a transient reason (`provider_auth`, `provider_refused`):
 * nothing was accepted, so trying again cannot make a second email.
 *
 * When the ledger cannot be read (the migration has not reached this
 * database), the send still happens once and is not reconciled: a sign-in
 * link that never leaves is worse than one that could, on a retry, leave twice.
 */
export async function deliverWithReference(
  env: Env,
  ref: SendReference,
  provider: (to: string) => Promise<ProviderOutcome>,
  opts: { tries?: number } = {},
): Promise<DeliveryResult> {
  const key = refKey(ref);
  const to = await recipientOf(env, ref);
  if (!to) return { ref: key, state: 'refused', reason: 'no_recipient', reconciled: false };

  const maxTries = Math.max(1, Math.min(3, opts.tries ?? 1));
  let last: ProviderOutcome | null = null;
  for (let i = 0; i < maxTries; i++) {
    let claimed = true;
    let ledger = true;
    try {
      const won = await env.DB.prepare(
        `INSERT INTO email_send_refs (ref, flow, subject_kind, subject_id, attempt, state, tries)
         VALUES (?, ?, ?, ?, ?, 'sending', 1)
         ON CONFLICT(ref) DO UPDATE SET state = 'sending', tries = email_send_refs.tries + 1,
                                        reason = NULL, updated_at = datetime('now')
          WHERE email_send_refs.state IN ('queued', 'refused')
         RETURNING tries`,
      ).bind(key, ref.flow, ref.subject.kind, String(ref.subject.id), String(ref.attempt)).first();
      claimed = !!won;
    } catch (e: any) {
      console.error('[email/contract] ledger unavailable, sending unreconciled', e?.name || 'Error');
      ledger = false;
    }
    if (!claimed) {
      const row = await readRow(env, key);
      const state = answered(row?.state || 'sending');
      return { ref: key, state, reason: row?.reason ?? null, reconciled: true };
    }

    last = await provider(to);
    if (ledger) {
      try {
        await env.DB.prepare(
          `UPDATE email_send_refs SET state = ?, reason = ?, provider_message_id = ?, updated_at = datetime('now')
            WHERE ref = ?`,
        ).bind(last.state, last.reason, last.state === 'accepted' ? last.providerId : null, key).run();
      } catch (e: any) {
        console.error('[email/contract] ledger write failed', e?.name || 'Error');
      }
    }
    const transient = last.state === 'refused' && (last.reason === 'provider_auth' || last.reason === 'provider_refused');
    if (!transient || !ledger) break;
  }
  return { ref: key, state: last!.state, reason: last!.reason, reconciled: false };
}
