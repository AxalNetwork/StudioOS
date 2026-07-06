import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireFactor, requireStepUp } from '../auth';
import { stripeCall } from './billing';
import { ensureAdminAuditLogTable } from './admin';
import { clawbackReferralCommissionForRefund, type ClawbackResult } from '../services/referralPayouts';

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

// Minimal shapes of the Stripe objects we read back. No Stripe SDK in the
// Worker (see billing.ts::stripeCall) — we hand-type only the fields we touch.
interface StripePaymentIntent {
  id: string;
  amount: number;
  amount_received?: number;
  currency: string;
  latest_charge?: string | null;
  metadata?: Record<string, string>;
}
interface StripeCharge {
  id: string;
  amount: number;
  amount_captured?: number;
  amount_refunded?: number;
  currency: string;
  paid?: boolean;
  refunded?: boolean;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
  created?: number;
  description?: string | null;
}

// Incorporation statuses past which filing has begun → no refund (Task #11
// policy). 'paid' is intentionally still refundable: the packet pipeline is
// enqueued on 'paid' but the no-refund line is drawn once filing actually
// progresses (packet_processing and beyond).
const INCORPORATION_FILED_STATUSES = new Set([
  'packet_processing', 'filed', 'submitted', 'in_review', 'completed', 'active',
]);

// Session cancellation window — refunds for an advisorship/expert booking are
// only allowed when the session is still at least this far in the future.
const SESSION_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

interface RefundPolicyDecision {
  allowed: boolean;
  // Why a refund is blocked (only set when allowed=false), machine-readable.
  reason?: string;
  // Product family the decision was made against, for audit/UX context.
  kind: string;
  // Free-text note carried into the audit row (e.g. proration guidance).
  note?: string;
  // Charge total in minor units, used downstream for proportional clawback.
  chargeAmountCents?: number | null;
  // Resolved PaymentIntent id (so the clawback can key off it).
  paymentIntentId?: string | null;
}

/**
 * Encode the per-product refund policy (Task #11):
 *   - incorporation  → no refund once filing has begun
 *   - expert_booking → 24h cancellation window (must be >24h before the session)
 *   - subscription   → allowed; refunds should be prorated (admin sets amount)
 *   - everything else → allowed
 *
 * Resolves product context from the PaymentIntent/charge `metadata.kind` and a
 * D1 lookup of the owning order row. Never throws — on any lookup failure it
 * fails OPEN (allowed) with a note, because the admin retains override and the
 * money-movement guardrails (step-up, audit) still apply.
 */
async function evaluateRefundPolicy(
  env: Env,
  opts: { paymentIntentId?: string; chargeId?: string },
): Promise<RefundPolicyDecision> {
  let pi: StripePaymentIntent | null = null;
  let charge: StripeCharge | null = null;
  try {
    if (opts.paymentIntentId) {
      pi = await stripeCall<StripePaymentIntent>(env, `/payment_intents/${encodeURIComponent(opts.paymentIntentId)}`, {}, { method: 'GET' });
    } else if (opts.chargeId) {
      charge = await stripeCall<StripeCharge>(env, `/charges/${encodeURIComponent(opts.chargeId)}`, {}, { method: 'GET' });
      if (charge?.payment_intent) {
        pi = await stripeCall<StripePaymentIntent>(env, `/payment_intents/${encodeURIComponent(charge.payment_intent)}`, {}, { method: 'GET' });
      }
    }
  } catch (e) {
    // Couldn't read the object — fail open but say so. The refund still needs
    // step-up + audit, and the admin can proceed knowingly.
    return { allowed: true, kind: 'unknown', note: `policy_lookup_failed:${(e as Error).message.slice(0, 80)}` };
  }

  const meta = pi?.metadata || charge?.metadata || {};
  const kind = (meta.kind || '').toLowerCase();
  const paymentIntentId = pi?.id || charge?.payment_intent || opts.paymentIntentId || null;
  const chargeAmountCents = (charge?.amount ?? pi?.amount ?? null);

  // --- Incorporation: no refund after filing has begun. ------------------
  if (kind === 'incorporation') {
    let status: string | null = null;
    try {
      const incId = meta.incorporation_id ? Number(meta.incorporation_id) : null;
      const r = incId
        ? await env.DB.prepare(`SELECT status FROM incorporations WHERE id = ? LIMIT 1`).bind(incId).first<{ status: string }>()
        : (paymentIntentId
          ? await env.DB.prepare(`SELECT status FROM incorporations WHERE stripe_payment_intent = ? LIMIT 1`).bind(paymentIntentId).first<{ status: string }>()
          : null);
      status = r?.status ?? null;
    } catch { /* table missing in dev — fail open below */ }
    if (status && INCORPORATION_FILED_STATUSES.has(status.toLowerCase())) {
      return { allowed: false, reason: `incorporation_filed:${status}`, kind, chargeAmountCents, paymentIntentId };
    }
    return { allowed: true, kind, note: status ? `incorporation_status:${status}` : 'incorporation_status:unknown', chargeAmountCents, paymentIntentId };
  }

  // --- Expert booking: 24h cancellation window. --------------------------
  if (kind === 'expert_booking') {
    try {
      const bid = meta.booking_id ? Number(meta.booking_id) : null;
      const r = bid
        ? await env.DB.prepare(`SELECT scheduled_at FROM expert_bookings WHERE id = ? LIMIT 1`).bind(bid).first<{ scheduled_at: string | null }>()
        : (paymentIntentId
          ? await env.DB.prepare(`SELECT scheduled_at FROM expert_bookings WHERE stripe_payment_intent_id = ? LIMIT 1`).bind(paymentIntentId).first<{ scheduled_at: string | null }>()
          : null);
      const scheduledAt = r?.scheduled_at ? Date.parse(r.scheduled_at) : NaN;
      if (Number.isFinite(scheduledAt)) {
        if (scheduledAt - Date.now() < SESSION_CANCEL_WINDOW_MS) {
          return { allowed: false, reason: 'session_cancel_window_passed', kind, chargeAmountCents, paymentIntentId };
        }
      }
    } catch { /* table missing in dev — fail open below */ }
    return { allowed: true, kind, note: 'session_within_cancel_window', chargeAmountCents, paymentIntentId };
  }

  // --- Subscriptions: allowed; refunds should be prorated. ---------------
  if (kind === 'tier' || kind === 'investor' || kind === 'mi_pro' || kind === 'subscription') {
    return { allowed: true, kind, note: 'subscription_refund_should_be_prorated', chargeAmountCents, paymentIntentId };
  }

  return { allowed: true, kind: kind || 'unknown', chargeAmountCents, paymentIntentId };
}

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
  const overridePolicy = body.override_policy === true;

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

  // Encode the per-product refund policy. A blocked decision stops the refund
  // UNLESS the admin explicitly overrides — the override is recorded in Stripe
  // metadata + the audit row so a forced refund is never silent.
  const policy = await evaluateRefundPolicy(c.env, {
    paymentIntentId: paymentIntent || undefined,
    chargeId: charge || undefined,
  });
  if (!policy.allowed && !overridePolicy) {
    return c.json({
      error: 'Refund blocked by product policy',
      code: 'refund_policy_blocked',
      reason: policy.reason,
      kind: policy.kind,
    }, 409);
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
  form['metadata[product_kind]'] = policy.kind;
  // Record a forced refund (policy said no, admin overrode) so it's auditable
  // from the Stripe dashboard, not just our DB.
  if (!policy.allowed && overridePolicy) {
    form['metadata[policy_override]'] = '1';
    if (policy.reason) form['metadata[policy_reason]'] = policy.reason.slice(0, 200);
  }

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

  // Clawback the referral commission tied to this purchase (Task #11). The
  // customer refund has already landed, so this is best-effort: it never
  // throws and a failure is surfaced + audited rather than rolling back the
  // refund. Reverses the Connect transfer proportionally for a partial refund.
  const clawbackPaymentIntent = refund.payment_intent || policy.paymentIntentId || paymentIntent || null;
  // The clawback sizes each reversal proportionally to THIS refund's share of
  // the original charge, and finalizes the ledger only once the charge is FULLY
  // refunded. Both need authoritative figures, so fetch the charge AFTER the
  // refund: `amount` is the proportional denominator, `amount_refunded` is the
  // cumulative figure (covers sequential partial refunds correctly). Never
  // infer full-vs-partial from the request shape — a no-amount "refund the
  // remaining balance" call is a partial in money terms once a prior partial
  // refund exists.
  let chargeAmountCents = policy.chargeAmountCents ?? null;
  let chargeRefundedToDateCents: number | null = null;
  if (refund.charge) {
    try {
      const ch = await stripeCall<StripeCharge>(c.env, `/charges/${encodeURIComponent(refund.charge)}`, {}, { method: 'GET' });
      chargeAmountCents = ch?.amount ?? chargeAmountCents;
      chargeRefundedToDateCents = ch?.amount_refunded ?? null;
    } catch (e) {
      console.error('[admin/billing] charge fetch for clawback proportion failed', refund.charge, (e as Error).message);
    }
  }
  let clawback: ClawbackResult = { outcome: 'no_commission' };
  if (clawbackPaymentIntent) {
    clawback = await clawbackReferralCommissionForRefund(c.env, {
      paymentIntentId: clawbackPaymentIntent,
      refundedAmountCents: refund.amount,
      chargeAmountCents,
      chargeRefundedToDateCents,
      adminId: adminUser.id,
      refundId: refund.id,
    });
    if (clawback.outcome === 'error') {
      console.error('[admin/billing] commission clawback failed after refund', refund.id, clawback.detail);
    }
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
        product_kind: policy.kind,
        policy_allowed: policy.allowed,
        policy_reason: policy.reason || null,
        policy_override: !policy.allowed && overridePolicy,
        policy_note: policy.note || null,
        clawback,
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
    policy: {
      kind: policy.kind,
      allowed: policy.allowed,
      reason: policy.reason || null,
      overridden: !policy.allowed && overridePolicy,
      note: policy.note || null,
    },
    clawback,
  });
});

// -------------------------------------------------------------------------
// Disputes (Task #11) — list / read / submit evidence
// -------------------------------------------------------------------------

// Stripe dispute-evidence keys we accept from the UI. Stripe ignores unknown
// keys, but we allow-list to keep the form honest + bound the payload. Values
// are free text OR a previously-uploaded Stripe File id (`file_...`) for the
// document fields. Actual multipart file upload to files.stripe.com is out of
// scope for the Worker — admins pre-upload in the Stripe dashboard and paste
// the file id, or supply text evidence here.
const DISPUTE_EVIDENCE_FIELDS = new Set([
  'product_description', 'customer_name', 'customer_email_address',
  'billing_address', 'customer_purchase_ip', 'service_date', 'service_documentation',
  'receipt', 'refund_policy', 'refund_policy_disclosure', 'refund_refusal_explanation',
  'cancellation_policy', 'cancellation_policy_disclosure', 'cancellation_rebuttal',
  'duplicate_charge_documentation', 'duplicate_charge_explanation', 'duplicate_charge_id',
  'shipping_address', 'shipping_carrier', 'shipping_date', 'shipping_documentation', 'shipping_tracking_number',
  'access_activity_log', 'customer_communication', 'customer_signature', 'uncategorized_text',
]);

interface StripeDispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  charge: string | null;
  payment_intent: string | null;
  created: number;
  evidence_details?: { due_by?: number | null; has_evidence?: boolean; submission_count?: number };
}
interface StripeList<T> { object: string; data: T[]; has_more: boolean; }

// GET /api/admin/billing/disputes — list recent disputes (read-only).
adminBilling.get('/disputes', async (c) => {
  await requireAdmin(c);
  const limitRaw = Number(c.req.query('limit') || 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 25;
  try {
    const list = await stripeCall<StripeList<StripeDispute>>(c.env, `/disputes?limit=${limit}`, {}, { method: 'GET' });
    return c.json({
      ok: true,
      has_more: list.has_more,
      disputes: (list.data || []).map(summarizeDispute),
    });
  } catch (e) {
    return stripeErrorResponse(c, e);
  }
});

// GET /api/admin/billing/disputes/:id — read one dispute (read-only).
adminBilling.get('/disputes/:id', async (c) => {
  await requireAdmin(c);
  const id = c.req.param('id');
  try {
    const d = await stripeCall<StripeDispute>(c.env, `/disputes/${encodeURIComponent(id)}`, {}, { method: 'GET' });
    return c.json({ ok: true, dispute: summarizeDispute(d) });
  } catch (e) {
    return stripeErrorResponse(c, e);
  }
});

// POST /api/admin/billing/disputes/:id/evidence — attach (and optionally
// submit) dispute evidence. Money-adjacent (losing a dispute = chargeback) so
// it carries the same step-up gating as a refund. Audited.
adminBilling.post('/disputes/:id/evidence', async (c) => {
  await requireFactor(c, 'totp');
  await requireStepUp(c);
  const adminUser = await requireAdmin(c);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const submit = body.submit === true;
  const rawEvidence = (body.evidence && typeof body.evidence === 'object') ? body.evidence as Record<string, unknown> : {};

  const form: Record<string, string> = {};
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(rawEvidence)) {
    if (!DISPUTE_EVIDENCE_FIELDS.has(k)) { rejected.push(k); continue; }
    if (v == null || v === '') continue;
    form[`evidence[${k}]`] = String(v).slice(0, 20000);
    accepted.push(k);
  }
  if (accepted.length === 0) {
    return c.json({ error: 'No valid evidence fields provided', code: 'no_evidence', rejected }, 400);
  }
  if (submit) form.submit = 'true';
  form['metadata[last_evidence_admin_id]'] = String(adminUser.id);

  // Idempotency key must reflect the evidence CONTENT, not just the field
  // names — otherwise editing the text of an existing field (same field set)
  // collapses to the previous request and the new content is silently dropped.
  // Hash the actual `evidence[...]` payload so each distinct draft is a new
  // request while an exact double-submit still dedupes.
  const evidencePayload = Object.keys(form).filter((k) => k.startsWith('evidence[')).sort()
    .map((k) => `${k}=${form[k]}`).join('\u0001');
  const contentHash = fnv1aHex(`${submit ? 'submit' : 'draft'}\u0001${evidencePayload}`);

  let dispute: StripeDispute;
  try {
    dispute = await stripeCall<StripeDispute>(c.env, `/disputes/${encodeURIComponent(id)}`, form, {
      idempotencyKey: `dispute-evidence:${adminUser.id}:${id}:${contentHash}`,
    });
  } catch (e) {
    return stripeErrorResponse(c, e);
  }

  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      adminUser.id,
      'billing_dispute_evidence',
      'billing',
      null,
      JSON.stringify({ dispute_id: id, submitted: submit, fields: accepted, rejected, status: dispute.status }),
    ).run();
  } catch (e) {
    console.error('[admin/billing] audit insert failed after dispute evidence', id, (e as Error).message);
  }

  return c.json({ ok: true, submitted: submit, accepted, rejected, dispute: summarizeDispute(dispute) });
});

function summarizeDispute(d: StripeDispute) {
  return {
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    status: d.status,
    reason: d.reason,
    charge: d.charge,
    payment_intent: d.payment_intent,
    created: d.created,
    due_by: d.evidence_details?.due_by ?? null,
    has_evidence: d.evidence_details?.has_evidence ?? false,
    submission_count: d.evidence_details?.submission_count ?? 0,
  };
}

// -------------------------------------------------------------------------
// Customer LTV (Task #11) — total net paid across all Stripe customer ids
// -------------------------------------------------------------------------

// GET /api/admin/billing/ltv?user_id= — lifetime value for one user. Sums net
// (captured − refunded) across every Stripe charge on each customer id we hold
// for the user (founder, investor, and Market-Intel customers can differ).
adminBilling.get('/ltv', async (c) => {
  await requireAdmin(c);
  const userId = Number(c.req.query('user_id'));
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json({ error: 'user_id (positive integer) required', code: 'invalid_user' }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name,
            u.stripe_customer_id, u.investor_stripe_customer_id,
            mi.stripe_customer_id AS mi_stripe_customer_id,
            u.subscription_tier, u.subscription_status,
            u.investor_tier, u.investor_subscription_status,
            mi.plan AS mi_subscription_plan, mi.status AS mi_subscription_status
       FROM users u
       LEFT JOIN mi_pro_subscriptions mi ON mi.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>().catch(() => null);
  if (!user) return c.json({ error: 'user_not_found', code: 'user_not_found' }, 404);

  const customerIds = Array.from(new Set([
    user.stripe_customer_id, user.investor_stripe_customer_id, user.mi_stripe_customer_id,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0)));

  if (customerIds.length === 0) {
    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name ?? null },
      customer_ids: [],
      ltv: { gross_cents: 0, refunded_cents: 0, net_cents: 0, currency: 'usd', charge_count: 0 },
      charges: [],
      subscriptions: subscriptionSummary(user),
      note: 'no_stripe_customer',
    });
  }

  // Stripe amounts are per-currency minor units, so summing across currencies
  // into one figure is meaningless. Accumulate per-currency and report a
  // breakdown; the top-level `ltv` reflects the currency with the most charges.
  const byCurrency = new Map<string, { gross_cents: number; refunded_cents: number; charge_count: number }>();
  let count = 0;
  const charges: Array<{ id: string; amount: number; amount_refunded: number; currency: string; created: number; description: string | null; paid: boolean; refunded: boolean }> = [];
  try {
    for (const cid of customerIds) {
      // Paginate the customer's charges (Stripe caps page size at 100).
      let startingAfter = '';
      for (let page = 0; page < 20; page++) {
        const q = `/charges?customer=${encodeURIComponent(cid)}&limit=100${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ''}`;
        const list = await stripeCall<StripeList<StripeCharge>>(c.env, q, {}, { method: 'GET' });
        for (const ch of (list.data || [])) {
          if (!ch.paid) continue;
          const captured = ch.amount_captured ?? ch.amount ?? 0;
          const refundedAmt = ch.amount_refunded ?? 0;
          const cur = (ch.currency || 'usd').toLowerCase();
          const bucket = byCurrency.get(cur) || { gross_cents: 0, refunded_cents: 0, charge_count: 0 };
          bucket.gross_cents += captured;
          bucket.refunded_cents += refundedAmt;
          bucket.charge_count += 1;
          byCurrency.set(cur, bucket);
          count += 1;
          if (charges.length < 25) {
            charges.push({
              id: ch.id,
              amount: captured,
              amount_refunded: refundedAmt,
              currency: ch.currency,
              created: ch.created ?? 0,
              description: ch.description ?? null,
              paid: !!ch.paid,
              refunded: !!ch.refunded,
            });
          }
        }
        if (!list.has_more || (list.data || []).length === 0) break;
        startingAfter = list.data[list.data.length - 1].id;
      }
    }
  } catch (e) {
    return stripeErrorResponse(c, e);
  }

  charges.sort((a, b) => b.created - a.created);

  // Per-currency breakdown, busiest currency first.
  const byCurrencyArr = Array.from(byCurrency.entries())
    .map(([cur, v]) => ({ currency: cur, gross_cents: v.gross_cents, refunded_cents: v.refunded_cents, net_cents: v.gross_cents - v.refunded_cents, charge_count: v.charge_count }))
    .sort((a, b) => b.charge_count - a.charge_count);
  // Top-level summary = the dominant (most-charged) currency, so the headline
  // figure is always a real single-currency total, never a mixed-unit sum.
  const primary = byCurrencyArr[0] || { currency: 'usd', gross_cents: 0, refunded_cents: 0, net_cents: 0, charge_count: 0 };

  return c.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name ?? null },
    customer_ids: customerIds,
    ltv: { gross_cents: primary.gross_cents, refunded_cents: primary.refunded_cents, net_cents: primary.net_cents, currency: primary.currency, charge_count: primary.charge_count },
    by_currency: byCurrencyArr,
    mixed_currency: byCurrencyArr.length > 1,
    charges,
    subscriptions: subscriptionSummary(user),
  });
});

// Tiny non-crypto string hash (FNV-1a, 32-bit) → hex. Only used to derive a
// short, stable idempotency-key suffix from a payload; not security-sensitive.
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function subscriptionSummary(user: Record<string, unknown>) {
  return {
    founder: { tier: user.subscription_tier ?? null, status: user.subscription_status ?? null },
    investor: { tier: user.investor_tier ?? null, status: user.investor_subscription_status ?? null },
    market_intel: { plan: user.mi_subscription_plan ?? null, status: user.mi_subscription_status ?? null },
  };
}

// Shared Stripe-error → HTTP mapper (mirrors the refund handler's surfacing).
function stripeErrorResponse(c: Context<{ Bindings: Env }>, e: unknown) {
  const msg = (e as Error).message || 'stripe_error';
  if (msg === 'stripe_not_configured') {
    return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
  }
  const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
  const upstreamStatus = m ? Number(m[1]) : 502;
  const detail = m ? m[2] : msg;
  const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502;
  return c.json({ error: 'Stripe request failed', code: 'stripe_error', upstream_status: upstreamStatus, detail }, status);
}

export default adminBilling;
