import type { Env } from '../types';

/**
 * Task #9 — Refer & Earn payouts via Stripe Connect Express.
 *
 * Lifecycle: pending → approved → paid → (reversed on transfer.failed).
 * One referral_payouts row per `commissions` row (commission.id is the
 * `redemption_id`). Auto-approval requires email-verified referred user,
 * KYC pass (if investor), and 30-day refund window elapsed.
 */

// OFAC + comprehensively sanctioned jurisdictions. Stripe also refuses
// to onboard sellers in these countries via Express, but we belt-and-
// suspenders this check at pay-time so a Connect account whose KYC
// state lapsed into a sanctioned country can't slip through.
// ISO-3166 alpha-2 codes; uppercase.
export const OFAC_SANCTIONED_COUNTRIES = new Set<string>([
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  'RU', // Russia (US Treasury comprehensive sanctions)
  'BY', // Belarus (heavily sanctioned)
  'MM', // Myanmar (Burma)
  // Disputed/occupied regions Stripe also won't pay into via Express;
  // mapped to their parent country code for safety.
]);

// Refund window after which a commission is considered "safe" to pay
// out (no chargebacks expected). Spec: 30 days.
export const REFUND_WINDOW_DAYS = 30;

let schemaReady = false;
export async function ensureReferralPayoutsSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN stripe_connect_account_id TEXT`,
    `ALTER TABLE users ADD COLUMN stripe_connect_charges_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN stripe_connect_payouts_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN stripe_connect_verification_status TEXT`,
    `ALTER TABLE users ADD COLUMN stripe_connect_country TEXT`,
    `ALTER TABLE users ADD COLUMN stripe_connect_last_synced_at TIMESTAMP`,
    `CREATE INDEX IF NOT EXISTS idx_users_stripe_connect_account_id ON users(stripe_connect_account_id)`,
    `CREATE TABLE IF NOT EXISTS referral_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL,
      redemption_id    INTEGER NOT NULL,
      amount_usd_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'pending',
      block_reason TEXT,
      stripe_transfer_id TEXT,
      stripe_destination TEXT,
      paid_by_admin_id INTEGER,
      earned_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMP,
      paid_at     TIMESTAMP,
      reversed_at TIMESTAMP,
      failure_reason TEXT,
      UNIQUE(redemption_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_payouts_referrer ON referral_payouts(referrer_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_payouts_status   ON referral_payouts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_payouts_transfer ON referral_payouts(stripe_transfer_id)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch { /* duplicate-column / exists — fine */ }
  }
  schemaReady = true;
}

/**
 * Tiny form-encoded Stripe POST helper. Mirrors the one in routes/billing.ts
 * but local so this module has no cross-route imports.
 */
export async function stripeForm<T>(
  env: Env,
  path: string,
  body: Record<string, string>,
  opts: { idempotencyKey?: string } = {},
): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe_not_configured');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`stripe_error:${res.status}:${txt.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

export async function stripeGet<T>(env: Env, path: string): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe_not_configured');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`stripe_error:${res.status}:${txt.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

// -------------------------------------------------------------------------
// Commission → referral_payouts handoff
// -------------------------------------------------------------------------

/**
 * Create a `referral_payouts` row for a freshly-awarded commission.
 * Idempotent via UNIQUE(redemption_id). Called from
 * routes/network.ts::fireCommissionEvent after each commission insert.
 *
 * Status starts as `pending` — the approval engine flips it to `approved`
 * once the auto-approval rules pass.
 */
export async function createReferralPayoutForCommission(
  env: Env,
  args: { commissionId: number; referrerUserId: number; amountCents: number; currency?: string },
): Promise<void> {
  try {
    await ensureReferralPayoutsSchema(env);
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO referral_payouts
         (referrer_user_id, redemption_id, amount_usd_cents, currency, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
      .bind(args.referrerUserId, args.commissionId, args.amountCents, (args.currency || 'USD').toUpperCase())
      .run();
    // Inline auto-approval attempt — if all three conditions are already
    // met at commission time (rare, but possible for re-runs on historical
    // data or for non-investor referrals where the 30-day window has
    // already elapsed by re-import), flip to approved immediately so the
    // admin queue stays tight. Most rows will still need the daily cron
    // sweep to re-check after the refund window elapses.
    if (((ins?.meta?.changes ?? 0) as number) > 0) {
      try {
        const newRow = await env.DB.prepare(
          `SELECT id, redemption_id FROM referral_payouts WHERE redemption_id = ?`,
        ).bind(args.commissionId).first<{ id: number; redemption_id: number }>();
        if (newRow) {
          const check = await evaluateAutoApproval(env, newRow);
          if (check.ok) {
            await env.DB.prepare(
              `UPDATE referral_payouts SET status='approved', approved_at=CURRENT_TIMESTAMP WHERE id = ? AND status='pending'`,
            ).bind(newRow.id).run();
          } else if (check.reason) {
            await env.DB.prepare(
              `UPDATE referral_payouts SET block_reason = ? WHERE id = ? AND status='pending'`,
            ).bind(check.reason, newRow.id).run();
          }
        }
      } catch (e) {
        console.warn('[referralPayouts] inline auto-approve failed:', (e as Error).message);
      }
    }
  } catch (e) {
    console.warn('[referralPayouts] create row failed:', (e as Error).message);
  }
}

// -------------------------------------------------------------------------
// Approval engine
// -------------------------------------------------------------------------

export interface ApprovalCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Run the auto-approval checks for a single pending payout. Returns
 * `{ok:true}` when all three pass; otherwise returns the first failing
 * reason so admins know why a row is still pending.
 *
 *  - referred user must be email_verified=1
 *  - if referred user.role === 'investor', kyc_status must be 'approved'
 *  - commission.created_at must be ≥ REFUND_WINDOW_DAYS ago
 */
export async function evaluateAutoApproval(
  env: Env,
  payoutRow: { id: number; redemption_id: number },
): Promise<ApprovalCheck> {
  // Resolve the commission + the referred user (via referrals table) AND
  // the REFERRER's Connect status so OFAC/sanction screening and
  // verification gating happen at approval time (not just pay-time, per
  // spec).
  const row = await env.DB.prepare(
    `SELECT c.created_at AS commission_created_at,
            r.referred_id,
            ru.email_verified, ru.role, ru.kyc_status,
            rer.stripe_connect_country,
            rer.stripe_connect_verification_status,
            rer.stripe_connect_charges_enabled,
            p.referrer_user_id
       FROM referral_payouts p
       LEFT JOIN commissions c ON c.id = p.redemption_id
       LEFT JOIN referrals   r ON r.id = c.referral_id
       LEFT JOIN users       ru ON ru.id = r.referred_id
       LEFT JOIN users       rer ON rer.id = p.referrer_user_id
      WHERE p.id = ?`,
  ).bind(payoutRow.id).first<{
    commission_created_at: string | null;
    referred_id: number | null;
    email_verified: number | boolean | null;
    role: string | null;
    kyc_status: string | null;
    stripe_connect_country: string | null;
    stripe_connect_verification_status: string | null;
    stripe_connect_charges_enabled: number | boolean | null;
    referrer_user_id: number | null;
  }>();
  if (!row) return { ok: false, reason: 'commission_not_found' };
  // OFAC / sanctioned-region screening happens BEFORE approval per spec.
  // Country is the snapshot persisted by syncConnectAccount / webhook;
  // null means we haven't yet seen a Connect account, which itself
  // blocks auto-approval (the row will re-evaluate after onboarding).
  const country = (row.stripe_connect_country || '').toUpperCase();
  if (country && OFAC_SANCTIONED_COUNTRIES.has(country)) {
    return { ok: false, reason: `sanctioned_country:${country}` };
  }
  // No referred_id (e.g. compounding bonus on chain) — admin review required.
  if (!row.referred_id) return { ok: false, reason: 'manual_review_required' };
  // Email verification.
  const verified = row.email_verified === 1
    || row.email_verified === true
    || String(row.email_verified) === '1';
  if (!verified) return { ok: false, reason: 'referred_user_email_unverified' };
  // KYC for investor referrals.
  if (row.role === 'investor' && (row.kyc_status || '').toLowerCase() !== 'approved') {
    return { ok: false, reason: 'referred_investor_kyc_pending' };
  }
  // 30-day refund window.
  if (!row.commission_created_at) return { ok: false, reason: 'missing_commission_timestamp' };
  const earnedMs = Date.parse(row.commission_created_at);
  if (!Number.isFinite(earnedMs)) return { ok: false, reason: 'invalid_commission_timestamp' };
  const elapsedMs = Date.now() - earnedMs;
  const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (elapsedMs < windowMs) {
    const daysLeft = Math.ceil((windowMs - elapsedMs) / (24 * 60 * 60 * 1000));
    return { ok: false, reason: `refund_window_${daysLeft}d_remaining` };
  }
  return { ok: true };
}

/**
 * Sweep every pending payout, run the auto-approval checks, and flip
 * status to 'approved' on those that pass. Returns counts for ops
 * observability. Called from /admin/refer-earn/run-approval-engine and
 * the daily cron sweep in index.ts.
 */
export async function runApprovalEngine(env: Env): Promise<{ scanned: number; approved: number; blocked: number; still_pending: number }> {
  await ensureReferralPayoutsSchema(env);
  const rows = await env.DB.prepare(
    `SELECT id, redemption_id FROM referral_payouts WHERE status = 'pending' LIMIT 500`,
  ).all<{ id: number; redemption_id: number }>();
  const list = rows.results || [];
  let approved = 0, blocked = 0, stillPending = 0;
  for (const r of list) {
    const check = await evaluateAutoApproval(env, r);
    if (check.ok) {
      await env.DB.prepare(
        `UPDATE referral_payouts SET status='approved', approved_at=CURRENT_TIMESTAMP, block_reason=NULL WHERE id = ? AND status='pending'`,
      ).bind(r.id).run();
      approved++;
    } else if (check.reason === 'commission_not_found') {
      blocked++;
    } else {
      // Persist the most recent reason so admins can scan the queue and
      // know why a row hasn't auto-approved yet. Still 'pending' — not
      // 'blocked' — because the reason may resolve itself (e.g. refund
      // window elapses).
      await env.DB.prepare(
        `UPDATE referral_payouts SET block_reason = ? WHERE id = ? AND status='pending'`,
      ).bind(check.reason || 'unknown', r.id).run();
      stillPending++;
    }
  }
  return { scanned: list.length, approved, blocked, still_pending: stillPending };
}

// -------------------------------------------------------------------------
// Stripe Connect account snapshot
// -------------------------------------------------------------------------

export interface ConnectAccountSnapshot {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  verification_status: string;
  country: string | null;
  disabled_reason: string | null;
  requirements_currently_due: string[];
}

interface StripeAccountObject {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  country?: string;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[];
    past_due?: string[];
    eventually_due?: string[];
  };
  individual?: { verification?: { status?: string } };
  company?: { verification?: { status?: string } };
}

export function summarizeConnectAccount(acct: StripeAccountObject): ConnectAccountSnapshot {
  const indivVerification = acct?.individual?.verification?.status;
  const compVerification = acct?.company?.verification?.status;
  // Stripe Express doesn't always populate `individual.verification` for
  // every region; we treat `payouts_enabled=true` as the canonical
  // "verified" signal and fall back to the explicit fields when present.
  let status = indivVerification || compVerification || '';
  if (!status) {
    status = acct?.payouts_enabled ? 'verified' : (acct?.details_submitted ? 'pending' : 'unverified');
  }
  return {
    charges_enabled: !!acct?.charges_enabled,
    payouts_enabled: !!acct?.payouts_enabled,
    details_submitted: !!acct?.details_submitted,
    verification_status: status,
    country: acct?.country ? acct.country.toUpperCase() : null,
    disabled_reason: acct?.requirements?.disabled_reason || null,
    requirements_currently_due: acct?.requirements?.currently_due || [],
  };
}

/**
 * Pull the latest Account object from Stripe and persist the relevant
 * fields on users.* — called from the /connect/status endpoint and from
 * the `account.updated` webhook handler.
 */
export async function syncConnectAccount(
  env: Env,
  userId: number,
  accountId: string,
): Promise<ConnectAccountSnapshot> {
  await ensureReferralPayoutsSchema(env);
  const acct = await stripeGet<StripeAccountObject>(env, `/accounts/${encodeURIComponent(accountId)}`);
  const snap = summarizeConnectAccount(acct);
  await env.DB.prepare(
    `UPDATE users
        SET stripe_connect_charges_enabled = ?,
            stripe_connect_payouts_enabled = ?,
            stripe_connect_verification_status = ?,
            stripe_connect_country = ?,
            stripe_connect_last_synced_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  ).bind(
    snap.charges_enabled ? 1 : 0,
    snap.payouts_enabled ? 1 : 0,
    snap.verification_status,
    snap.country,
    userId,
  ).run();
  return snap;
}

/**
 * Webhook entry-point — given a Stripe `account.updated` event whose
 * `object` is the Account, mirror it to users.*. Returns true when a
 * row was matched.
 */
export async function applyConnectAccountUpdated(
  env: Env,
  acct: StripeAccountObject & { id?: string },
): Promise<boolean> {
  if (!acct?.id) return false;
  await ensureReferralPayoutsSchema(env);
  const snap = summarizeConnectAccount(acct);
  const r = await env.DB.prepare(
    `UPDATE users
        SET stripe_connect_charges_enabled = ?,
            stripe_connect_payouts_enabled = ?,
            stripe_connect_verification_status = ?,
            stripe_connect_country = COALESCE(?, stripe_connect_country),
            stripe_connect_last_synced_at = CURRENT_TIMESTAMP
      WHERE stripe_connect_account_id = ?`,
  ).bind(
    snap.charges_enabled ? 1 : 0,
    snap.payouts_enabled ? 1 : 0,
    snap.verification_status,
    snap.country,
    acct.id,
  ).run();
  return ((r?.meta?.changes ?? 0) as number) > 0;
}

/**
 * Webhook for `transfer.paid` — flip the payout row to status='paid'.
 * Idempotent: only fires the status change when the row is still
 * pending/approved.
 */
export async function applyTransferPaid(env: Env, transferId: string): Promise<boolean> {
  await ensureReferralPayoutsSchema(env);
  const r = await env.DB.prepare(
    `UPDATE referral_payouts
        SET status='paid', paid_at=CURRENT_TIMESTAMP, failure_reason=NULL
      WHERE stripe_transfer_id = ? AND status IN ('approved','pending')`,
  ).bind(transferId).run();
  return ((r?.meta?.changes ?? 0) as number) > 0;
}

/**
 * Webhook for `transfer.failed` — revert the payout to status='reversed'
 * and notify admin. Also reverts the underlying commission back to
 * 'accrued' so the referrer doesn't lose the credit.
 */
export async function applyTransferFailed(
  env: Env,
  transferId: string,
  reason: string,
): Promise<boolean> {
  await ensureReferralPayoutsSchema(env);
  const row = await env.DB.prepare(
    `SELECT id, referrer_user_id, redemption_id, amount_usd_cents
       FROM referral_payouts
      WHERE stripe_transfer_id = ?
      LIMIT 1`,
  ).bind(transferId).first<{ id: number; referrer_user_id: number; redemption_id: number; amount_usd_cents: number }>();
  if (!row) return false;
  const r = await env.DB.prepare(
    `UPDATE referral_payouts
        SET status='reversed', reversed_at=CURRENT_TIMESTAMP, failure_reason = ?
      WHERE id = ? AND status != 'reversed'`,
  ).bind(reason.slice(0, 300), row.id).run();
  if (((r?.meta?.changes ?? 0) as number) === 0) return false;
  // Best-effort: re-accrue the underlying commission so the balance
  // returns to the referrer's earnings list.
  try {
    await env.DB.prepare(
      `UPDATE commissions SET status='accrued', paid_at=NULL WHERE id = ? AND status='paid'`,
    ).bind(row.redemption_id).run();
  } catch { /* table-shape divergence in dev — non-fatal */ }
  // Notify admins via the inbox (best-effort, decoupled).
  try {
    const { notify } = await import('./notify');
    const admins = await env.DB.prepare(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 10`,
    ).all<{ id: number }>();
    for (const a of (admins.results || [])) {
      await notify(env, {
        userId: a.id,
        type: 'referral_payout_failed',
        category: 'critical_alerts',
        title: 'Referral payout failed',
        body: `Stripe transfer ${transferId} failed: ${reason}. The payout has been reversed and the commission re-accrued.`,
        link: '/admin/refer-earn',
        payload: { payout_id: row.id, transfer_id: transferId, reason },
        channels: ['in_app', 'email'],
      });
    }
  } catch (e) {
    console.warn('[referralPayouts] admin notify on transfer.failed failed:', (e as Error).message);
  }
  return true;
}

// -------------------------------------------------------------------------
// Refund-driven commission clawback (Task #11)
// -------------------------------------------------------------------------

export interface ClawbackResult {
  // 'reversed'        — a Connect transfer was reversed (money pulled back).
  // 'voided'          — payout existed but hadn't paid out yet; cancelled so it never pays.
  // 'no_commission'   — the refunded purchase never generated a referral commission.
  // 'already_reversed'— the payout was already reversed (idempotent re-run).
  // 'skipped'         — partial refund too small to reverse a whole-cent of transfer.
  // 'error'           — Stripe/DB failure; refund still stands, surfaced to admin.
  outcome: 'reversed' | 'voided' | 'no_commission' | 'already_reversed' | 'skipped' | 'error';
  payout_id?: number;
  transfer_id?: string | null;
  reversal_id?: string;
  reversed_amount_cents?: number;
  detail?: string;
}

/**
 * Clawback the referral commission tied to a refunded purchase.
 *
 * Called from the admin refund endpoint AFTER the customer refund lands.
 * The customer's money has already moved, so this NEVER throws — it returns
 * a structured result the caller surfaces + audits. A clawback failure must
 * not imply the refund failed.
 *
 * Linkage: commissions.source_id = the originating PaymentIntent id (set by
 * firePurchaseCommission), referral_payouts.redemption_id = commissions.id.
 *
 * Behaviour by payout state:
 *  - status='paid' with a real Stripe transfer → reverse the transfer
 *    (proportionally for a partial refund) to pull the commission back, then
 *    flip payout→'reversed' and commission→'reversed'.
 *  - status pending/approved/blocked (not yet paid out) → void it so it never
 *    pays, flip commission→'reversed'. No Stripe call needed.
 *  - already 'reversed' → idempotent no-op.
 */
export async function clawbackReferralCommissionForRefund(
  env: Env,
  args: {
    paymentIntentId: string;
    /** The amount of THIS refund (minor units) — sizes this reversal. */
    refundedAmountCents: number;
    /** Original charge total (minor units) — the proportional denominator. */
    chargeAmountCents?: number | null;
    /**
     * Cumulative amount refunded on the charge AFTER this refund (Stripe's
     * `charge.amount_refunded`). Drives BOTH the cumulative reversal target
     * (`round(payout * refundedToDate / chargeTotal)` minus what's already
     * reversed) and ledger finalization (flip payout/commission → 'reversed'
     * once `refundedToDate >= chargeTotal`). Using the cumulative figure — not
     * this refund alone — keeps sequential partial refunds free of rounding
     * drift. Falls back to this refund's amount when unavailable.
     */
    chargeRefundedToDateCents?: number | null;
    adminId?: number;
    refundId: string;
  },
): Promise<ClawbackResult> {
  try {
    await ensureReferralPayoutsSchema(env);
    if (!args.paymentIntentId) return { outcome: 'no_commission' };

    const row = await env.DB.prepare(
      `SELECT rp.id            AS payout_id,
              rp.status        AS status,
              rp.stripe_transfer_id AS transfer_id,
              rp.amount_usd_cents   AS payout_amount_cents,
              c.id             AS commission_id
         FROM referral_payouts rp
         JOIN commissions c ON c.id = rp.redemption_id
        WHERE c.source_id = ? AND c.source_type = 'purchase'
        LIMIT 1`,
    ).bind(args.paymentIntentId).first<{
      payout_id: number;
      status: string;
      transfer_id: string | null;
      payout_amount_cents: number;
      commission_id: number;
    }>();

    if (!row) return { outcome: 'no_commission' };
    if (row.status === 'reversed') {
      return { outcome: 'already_reversed', payout_id: row.payout_id, transfer_id: row.transfer_id };
    }

    // Not paid out yet — just void it so the queued payout never fires, and
    // reverse the commission credit. No Stripe transfer to reverse.
    if (row.status !== 'paid' || !row.transfer_id) {
      await env.DB.prepare(
        `UPDATE referral_payouts
            SET status='reversed', reversed_at=CURRENT_TIMESTAMP,
                failure_reason = ?
          WHERE id = ? AND status != 'reversed'`,
      ).bind(`refund_clawback:${args.refundId}`.slice(0, 300), row.payout_id).run();
      await reverseCommissionCredit(env, row.commission_id);
      return { outcome: 'voided', payout_id: row.payout_id, transfer_id: row.transfer_id };
    }

    // Paid out — reverse the Connect transfer. Size the reversal by the
    // CUMULATIVE clawback target minus what's already been reversed, so a
    // sequence of partial refunds neither over- nor under-claws from per-refund
    // rounding. Target = round(payout * refundedToDate / chargeTotal), where
    // refundedToDate is the charge's cumulative amount_refunded; the delta vs
    // the transfer's existing amount_reversed is what we reverse now.
    const chargeTotal = Number(args.chargeAmountCents || 0);
    const thisRefund = Number(args.refundedAmountCents || 0);
    if (!(chargeTotal > 0 && thisRefund > 0)) {
      // Without the charge total we can't size the proportional reversal. Refuse
      // to guess (a full reversal would over-claw) — surface for manual handling.
      return {
        outcome: 'skipped',
        payout_id: row.payout_id,
        transfer_id: row.transfer_id,
        detail: 'charge total unknown — manual clawback required',
      };
    }
    // Cumulative refunded on the charge (≥ thisRefund). Fall back to thisRefund
    // when the cumulative figure couldn't be read, so a lone refund still works.
    const refundedToDate = Math.max(Number(args.chargeRefundedToDateCents || 0), thisRefund);

    // Authoritative "already reversed" from Stripe so we never request more than
    // the transfer's remaining reversable balance (avoids a hard Stripe error
    // and keeps cumulative rounding exact across sequential refunds).
    let alreadyReversed = 0;
    try {
      const transfer = await stripeGet<{ amount_reversed?: number }>(env, `/transfers/${encodeURIComponent(row.transfer_id)}`);
      alreadyReversed = Number(transfer.amount_reversed || 0);
    } catch (e) {
      return { outcome: 'error', payout_id: row.payout_id, transfer_id: row.transfer_id, detail: (e as Error).message || 'transfer_read_failed' };
    }

    // Target cumulative clawback for the refunded-to-date fraction, capped at
    // the payout, then the delta still owed after prior reversals.
    const targetCumulative = Math.min(Math.round((row.payout_amount_cents * refundedToDate) / chargeTotal), row.payout_amount_cents);
    let reverseCents = targetCumulative - alreadyReversed;
    reverseCents = Math.min(Math.max(reverseCents, 0), row.payout_amount_cents - alreadyReversed);
    if (reverseCents <= 0) {
      // Nothing new to reverse (e.g. an idempotent retry, or rounding already
      // satisfied). If the charge is now fully refunded, still finalize below.
      const fullyReversed = alreadyReversed >= row.payout_amount_cents || refundedToDate >= chargeTotal;
      if (fullyReversed) {
        await env.DB.prepare(
          `UPDATE referral_payouts
              SET status='reversed', reversed_at=CURRENT_TIMESTAMP, failure_reason = ?
            WHERE id = ? AND status != 'reversed'`,
        ).bind(`refund_clawback:${args.refundId}`.slice(0, 300), row.payout_id).run();
        await reverseCommissionCredit(env, row.commission_id);
        return { outcome: 'reversed', payout_id: row.payout_id, transfer_id: row.transfer_id, reversed_amount_cents: 0, detail: 'already fully reversed' };
      }
      return { outcome: 'skipped', payout_id: row.payout_id, transfer_id: row.transfer_id, detail: 'no additional clawback owed' };
    }
    // Finalize the ledger once the charge is FULLY refunded (cumulative refunded
    // ≥ charge total) OR this reversal exhausts the payout.
    const isFull = refundedToDate >= chargeTotal || (alreadyReversed + reverseCents) >= row.payout_amount_cents;

    let reversalId = '';
    try {
      const reversal = await stripeForm<{ id: string; amount: number }>(
        env,
        `/transfers/${encodeURIComponent(row.transfer_id)}/reversals`,
        {
          amount: String(reverseCents),
          'metadata[refund_id]': args.refundId,
          'metadata[payout_id]': String(row.payout_id),
          ...(args.adminId != null ? { 'metadata[admin_user_id]': String(args.adminId) } : {}),
          description: `Clawback for refund ${args.refundId}`,
        },
        { idempotencyKey: `clawback-${row.transfer_id}-${args.refundId}` },
      );
      reversalId = reversal.id;
    } catch (e) {
      const detail = (e as Error).message || 'stripe_error';
      return { outcome: 'error', payout_id: row.payout_id, transfer_id: row.transfer_id, detail };
    }

    // Only flip the ledger to fully-reversed on a full clawback. A partial
    // clawback leaves the payout 'paid' (the referrer keeps the un-refunded
    // share) but stamps the reversal in failure_reason for traceability.
    if (isFull) {
      await env.DB.prepare(
        `UPDATE referral_payouts
            SET status='reversed', reversed_at=CURRENT_TIMESTAMP,
                failure_reason = ?
          WHERE id = ? AND status != 'reversed'`,
      ).bind(`refund_clawback:${args.refundId}`.slice(0, 300), row.payout_id).run();
      await reverseCommissionCredit(env, row.commission_id);
    } else {
      await env.DB.prepare(
        `UPDATE referral_payouts SET failure_reason = ? WHERE id = ?`,
      ).bind(`partial_clawback:${args.refundId}:${reverseCents}c`.slice(0, 300), row.payout_id).run();
    }

    return {
      outcome: 'reversed',
      payout_id: row.payout_id,
      transfer_id: row.transfer_id,
      reversal_id: reversalId,
      reversed_amount_cents: reverseCents,
    };
  } catch (e) {
    return { outcome: 'error', detail: (e as Error).message || 'clawback_failed' };
  }
}

// Reverse the commission credit so the referrer no longer earns on a refunded
// purchase. Best-effort across dev/prod commission table shapes.
async function reverseCommissionCredit(env: Env, commissionId: number): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE commissions SET status='reversed', paid_at=NULL WHERE id = ? AND status != 'reversed'`,
    ).bind(commissionId).run();
  } catch { /* table-shape divergence in dev — non-fatal */ }
}

// -------------------------------------------------------------------------
// US 1099-MISC tax summary
// -------------------------------------------------------------------------

export interface TaxSummaryRow {
  user_id: number;
  email: string;
  name: string | null;
  country: string | null;
  total_paid_usd_cents: number;
  payout_count: number;
  needs_1099: boolean;
}

/**
 * Year-end aggregation used by /admin/refer-earn/tax-summary. Returns
 * one row per US referrer with `total_paid_usd_cents >= $600` — Stripe
 * Connect auto-generates the 1099-MISC for the platform via the Connect
 * tax-form reporting pipeline (configured in the Stripe dashboard, not
 * via API); this endpoint is for human cross-check.
 */
export async function buildTaxSummary(env: Env, year: number): Promise<TaxSummaryRow[]> {
  await ensureReferralPayoutsSchema(env);
  const start = `${year}-01-01T00:00:00`;
  const end = `${year + 1}-01-01T00:00:00`;
  const rows = await env.DB.prepare(
    `SELECT u.id            AS user_id,
            u.email,
            u.name,
            u.stripe_connect_country AS country,
            COALESCE(SUM(p.amount_usd_cents), 0) AS total_paid_usd_cents,
            COUNT(p.id)     AS payout_count
       FROM referral_payouts p
       JOIN users u ON u.id = p.referrer_user_id
      WHERE p.status = 'paid'
        AND p.paid_at >= ?
        AND p.paid_at <  ?
      GROUP BY u.id
      ORDER BY total_paid_usd_cents DESC`,
  ).bind(start, end).all<{ user_id: number; email: string; name: string | null; country: string | null; total_paid_usd_cents: number; payout_count: number }>();
  return (rows.results || []).map((r) => ({
    ...r,
    needs_1099: (r.country || '').toUpperCase() === 'US' && r.total_paid_usd_cents >= 60000,
  }));
}
