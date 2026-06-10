import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireFactor, requireStepUp } from '../auth';
import { stripeCall } from './billing';
import { ensureAdminAuditLogTable } from './admin';

// Task #11 (II) — Admin billing actions. Mounted at `/api/admin/billing`
// BEFORE the catch-all `/api/admin` in index.ts so the nested routes resolve
// here (same mount-precedence trick as `/api/admin/telegram` | `/x` | `/news`).
//
// Sits inside the existing `app.use('/api/admin/*', requireCfAccess())`
// perimeter. Each route enforces `requireFactor('totp')` + `requireStepUp` +
// `requireAdmin` so issuing a refund needs a RECENT strong-factor re-auth, not
// just a long-lived admin JWT — mirrors impersonation / billing-checkout
// step-up gating. `/api/admin/billing` is also in index.ts's COOL_OFF_PREFIXES
// so a freshly-recovered admin account can't move money during cool-off.

const adminBilling = new Hono<{ Bindings: Env }>();

// Minimal shape of Stripe's Refund object (we read it back for the audit row
// + response; no Stripe SDK in the Worker — see billing.ts::stripeCall).
interface StripeRefund {
  id: string;
  object: string;
  amount: number;
  currency: string;
  charge: string | null;
  payment_intent: string | null;
  status: string;
  reason: string | null;
}

// Stripe's `reason` is a closed enum. Any free-text admin justification is
// preserved in refund metadata + the audit row instead of being forced in here.
const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

// BLOCK-PAY-02 — POST /api/admin/billing/refund
//
// Body accepts EXACTLY ONE of `payment_intent` / `charge`, an optional
// `amount` (positive integer minor units → partial refund; omit for a full
// refund), an optional free-text `reason`, and an optional `target_user_id`
// for audit linkage. On success writes an `admin_audit_log` row
// (report_type='billing', action='billing_refund') capturing the refund id +
// status, and returns the refund summary.
adminBilling.post('/refund', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c); // BLOCK-AUTH-03 — recent strong-factor re-auth, not just a TOTP-minted session
  const adminUser = await requireAdmin(c);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const paymentIntent = typeof body.payment_intent === 'string' ? body.payment_intent.trim() : '';
  const charge = typeof body.charge === 'string' ? body.charge.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const targetUserId = Number.isInteger(body.target_user_id) ? (body.target_user_id as number) : null;
  const clientIdemKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim().slice(0, 255) : '';

  // Require exactly one charge identifier — Stripe rejects both-at-once and a
  // refund with neither is meaningless. Fail explicitly rather than guessing.
  if ((paymentIntent && charge) || (!paymentIntent && !charge)) {
    return c.json({ error: 'Provide exactly one of payment_intent or charge', code: 'invalid_target' }, 400);
  }

  // Optional partial-refund amount: positive integer minor units (e.g. cents).
  let amount: number | null = null;
  if (body.amount != null) {
    const n = Number(body.amount);
    if (!Number.isInteger(n) || n <= 0) {
      return c.json({ error: 'amount must be a positive integer in minor units', code: 'invalid_amount' }, 400);
    }
    amount = n;
  }

  const form: Record<string, string> = {};
  if (paymentIntent) form.payment_intent = paymentIntent;
  else form.charge = charge;
  if (amount != null) form.amount = String(amount);
  if (reason && STRIPE_REFUND_REASONS.has(reason)) form.reason = reason;
  // Always stamp who/why into Stripe metadata so the refund is traceable back
  // to an Axal admin from the Stripe dashboard, even if it predates this row.
  form['metadata[admin_user_id]'] = String(adminUser.id);
  if (targetUserId != null) form['metadata[target_user_id]'] = String(targetUserId);
  if (reason) form['metadata[admin_reason]'] = reason.slice(0, 500);

  // Idempotency: prefer a caller-supplied key (lets a UI mint one stable key
  // per user-intent for true double-submit protection). Absent that, derive a
  // deterministic key from admin + target + amount so an accidental retry /
  // double-click collapses to ONE refund. A genuinely-intended second refund of
  // the same amount on the same charge can pass an explicit `idempotency_key`.
  const idempotencyKey = clientIdemKey
    || `refund:${adminUser.id}:${paymentIntent || charge}:${amount ?? 'full'}`;

  let refund: StripeRefund;
  try {
    refund = await stripeCall<StripeRefund>(c.env, '/refunds', form, { idempotencyKey });
  } catch (e) {
    const msg = (e as Error).message || 'stripe_error';
    if (msg === 'stripe_not_configured') {
      return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
    }
    // stripeCall throws `stripe_error:<status>:<body>` — surface the upstream
    // status + message so the admin sees WHY (charge already refunded, unknown
    // id, etc.) instead of a generic 500. Explicit failure over silent fallback.
    const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
    const upstreamStatus = m ? Number(m[1]) : 502;
    const detail = m ? m[2] : msg;
    const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502;
    return c.json({ error: 'Stripe refund failed', code: 'stripe_error', upstream_status: upstreamStatus, detail }, status);
  }

  // Audit AFTER the refund lands so we capture the real refund id + status.
  // Best-effort (matches the admin_audit_log convention elsewhere): the money
  // has already moved, so a logging hiccup must never fail the request or imply
  // the refund didn't happen — we log loudly instead.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      adminUser.id,
      'billing_refund',
      'billing',
      targetUserId,
      JSON.stringify({
        refund_id: refund.id,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency,
        payment_intent: refund.payment_intent,
        charge: refund.charge,
        reason: reason || null,
        target_user_id: targetUserId,
      }),
    ).run();
  } catch (e) {
    console.error('[admin/billing] admin_audit_log insert failed after refund', refund.id, (e as Error).message);
  }

  return c.json({
    ok: true,
    refund: {
      id: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      payment_intent: refund.payment_intent,
      charge: refund.charge,
    },
  });
});

export default adminBilling;
