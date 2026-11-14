import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireFactor, requireStepUp, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { stripeCall } from './billing';
import { ensureAdminAuditLogTable } from './admin';
import { logAdminAction } from '../services/adminAudit';
import { clawbackReferralCommissionForRefund, type ClawbackResult } from '../services/referralCommissions';
import { refusalBody } from '../util/refusal';
import { paymentChangeReason, stripeMode } from '../services/catalog';
import {
  buildRefundReview, decideRefundPolicy, fromStripe, resolveRefundTarget, reviewIdempotencyKey, verifyReview,
  type RefundTarget, type StripeCharge,
} from '../services/refundReview';

// Task #11 (II) — Admin billing actions. Mounted at `/api/admin/billing`
// BEFORE the catch-all `/api/admin` in index.ts so the nested routes resolve
// here (same mount-precedence trick as `/api/admin/telegram` | `/x` | `/news`).
//
// No edge SSO layer sits in front of /api/admin — Task #33 removed it
// (index.ts) — so the gate is in the handler: each write enforces
// `requireFactor('totp')` + `requireStepUp` +
// an admin check so a money move needs a RECENT strong-factor re-auth, not
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

/** D224 — the shortest written refund reason accepted. Exported for the SPA's own check. */
export const REFUND_REASON_MIN = 12;

// D5037 — the target, the policy and the review live in services/refundReview.ts, read the same way by the review
// (which moves nothing) and by the write below.

/** A refund's audit-safe summary of the review it was confirmed from. */
const reviewSummary = (t: RefundTarget, requested: number) => ({
  gross_cents: fromStripe(t.gross, t.currency),
  refunded_before_cents: fromStripe(t.refunded, t.currency),
  remaining_before_cents: fromStripe(t.remaining, t.currency),
  requested_cents: fromStripe(requested, t.currency),
  full: requested === t.remaining,
});

// D5037 — POST /api/admin/billing/refund/review — LOOK UP AND REVIEW. MOVES NO MONEY.
//
// Body: exactly one of `payment_intent` / `charge`, and optionally `amount` (Stripe minor units) or `amount_major`
// (what a person typed, read in the charge's own currency, D5029). Answers what the operator must see before
// confirming: the payment's identifiers, the customer and the account it maps to, gross, refunded to date, what is
// left, the requested amount and whether it is the whole of it, the product policy (allowed, blocked or unavailable)
// with its note and whether an override is needed, and the referral clawback it would cause. With them, a
// `review_token` the refund below requires: signed over these facts, for this admin, for ten minutes.
//
// Super admin, as the refund is. No step-up: it is a read, and the step-up guards the confirmation, where money moves.
// No audit row: nothing changed. Stripe is only ever GET here.
adminBilling.post('/refund/review', async (c) => {
  const admin = await requireSuperAdmin(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const built = await buildRefundReview(c.env, admin.id, body as Record<string, unknown>);
  if (!built.ok) {
    return c.json({ error: built.message, code: built.code, ...(('extra' in built && built.extra) || {}) }, built.status);
  }
  return c.json({ ok: true, review: built.review, review_token: built.review_token });
});

// BLOCK-PAY-02 — POST /api/admin/billing/refund — CONFIRM A REVIEWED REFUND.
//
// D5037: THE TARGET AND THE AMOUNT COME FROM THE REVIEW, never from this body. The body carries the `review_token`
// `/refund/review` issued, a REQUIRED written `reason` (D224), and, when the review's policy was blocked or
// unavailable, `override_policy: true` with a written `override_reason`. Optional: `stripe_reason` (Stripe's closed
// enum), `target_user_id` for audit linkage, `idempotency_key`. A body that names a target or an amount is refused:
// the operator confirms what they reviewed, or reviews again.
//
// BEFORE STRIPE IS ASKED TO REFUND, the write re-reads the target and re-decides the policy with the same code the
// review used, and refuses (`review_stale`) when either moved: another refund landed, or the policy changed. A
// requested amount above what is left is refused; it cannot be, since the review refused it and the remaining has not
// moved, but the check is here so the write does not lean on the review alone.
//
// D224 — A REFUND IS HQ'S GOVERNED ACTION. `requireSuperAdminWriteBar` keeps the TOTP session, the recent step-up and
// the Super Admin elevation, checked first, in the order `POST /impersonate` checks them. On a branch it refuses with
// "HQ only". The reason is checked before anything else is read, so a refused request moves nothing.
//
// IDEMPOTENT. The key is the caller's, or one derived from the review, so a double click or a retry of one confirmed
// review is one refund, and a second refund of the same charge needs a second review.
adminBilling.post('/refund', async (c) => {
  const adminUser = await requireSuperAdminWriteBar(c);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const targetUserId = Number.isInteger(body.target_user_id) ? (body.target_user_id as number) : null;
  const clientIdemKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim().slice(0, 255) : '';
  const overridePolicy = body.override_policy === true;
  const overrideReason = typeof body.override_reason === 'string' ? body.override_reason.trim() : '';

  if (reason.length < REFUND_REASON_MIN) {
    return c.json({
      error: `A refund needs a written reason of at least ${REFUND_REASON_MIN} characters, saying why this money goes back.`,
      code: 'reason_required',
    }, 400);
  }
  const verified = await verifyReview(c.env, body.review_token, adminUser.id);
  if (!verified.ok) {
    return c.json({ error: verified.message, code: verified.code }, verified.code === 'review_required' ? 400 : 409);
  }
  const claims = verified.claims;
  for (const k of ['payment_intent', 'charge', 'amount', 'amount_major']) {
    if (body[k] != null) {
      return c.json({ error: 'The payment and the amount are the ones you reviewed. To change either, look the payment up again.', code: 'review_fixed', field: k }, 400);
    }
  }

  // Re-read the target and re-decide the policy, with the code the review used.
  const resolved = await resolveRefundTarget(c.env, claims.pi ? { paymentIntentId: claims.pi } : { chargeId: claims.ch });
  if (!resolved.ok) return c.json({ error: resolved.message, code: resolved.code }, resolved.status);
  const t = resolved.target;
  const policy = await decideRefundPolicy(c.env, t);
  if (t.charge !== claims.ch || t.remaining !== claims.rem || t.currency !== claims.cur || policy.state !== claims.ps) {
    return c.json({
      error: 'The payment changed since you reviewed it, so nothing was refunded. Look it up again and check the new figures.',
      code: 'review_stale',
      now: { remaining_cents: fromStripe(t.remaining, t.currency), currency: t.currency, policy_state: policy.state },
    }, 409);
  }
  const requested = claims.req ?? t.remaining;
  if (t.remaining <= 0) return c.json({ error: 'Nothing is left to refund on this charge.', code: 'nothing_refundable' }, 409);
  if (requested > t.remaining) return c.json({ error: 'That is more than is left to refund on this charge.', code: 'over_remaining' }, 409);

  // Blocked and unavailable both need the Super Admin's explicit, written override. Unavailable is never read as
  // allowed: nobody decided it.
  const overridden = policy.state !== 'allowed';
  if (overridden) {
    if (!overridePolicy) {
      return c.json(policy.state === 'blocked'
        ? { error: 'Refund blocked by product policy', code: 'refund_policy_blocked', reason: policy.reason, kind: policy.kind, note: policy.note }
        : { error: 'The refund policy for this payment could not be resolved. Refunding it needs an explicit override with a written reason.', code: 'policy_unavailable', reason: policy.reason, kind: policy.kind, note: policy.note }, 409);
    }
    if (overrideReason.length < REFUND_REASON_MIN) {
      return c.json({
        error: `Overriding the refund policy needs its own written reason of at least ${REFUND_REASON_MIN} characters.`,
        code: 'override_reason_required',
      }, 400);
    }
  }

  const form: Record<string, string> = {};
  if (claims.pi) form.payment_intent = claims.pi;
  else form.charge = claims.ch;
  form.amount = String(requested);
  // Stripe's own `reason` is its closed enum, taken from `stripe_reason` when the caller names one (or from `reason`
  // when that is itself an enum value, the shape callers used before D224). The written reason goes to metadata.
  const stripeReason = typeof body.stripe_reason === 'string' ? body.stripe_reason.trim() : '';
  if (STRIPE_REFUND_REASONS.has(stripeReason)) form.reason = stripeReason;
  else if (STRIPE_REFUND_REASONS.has(reason)) form.reason = reason;
  // Who and why, on the refund in Stripe, so it is traceable from the dashboard too.
  form['metadata[admin_user_id]'] = String(adminUser.id);
  if (targetUserId != null) form['metadata[target_user_id]'] = String(targetUserId);
  form['metadata[admin_reason]'] = reason.slice(0, 500);
  form['metadata[product_kind]'] = policy.kind;
  form['metadata[policy_state]'] = policy.state;
  if (overridden) {
    form['metadata[policy_override]'] = '1';
    if (policy.state === 'unavailable') form['metadata[policy_unavailable]'] = '1';
    if (policy.reason) form['metadata[policy_reason]'] = policy.reason.slice(0, 200);
    form['metadata[override_reason]'] = overrideReason.slice(0, 500);
  }

  const idempotencyKey = clientIdemKey || await reviewIdempotencyKey(claims);

  let refund: StripeRefund;
  try {
    refund = await stripeCall<StripeRefund>(c.env, '/refunds', form, { idempotencyKey });
  } catch (e) {
    const msg = (e as Error).message || 'stripe_error';
    if (msg === 'stripe_not_configured') {
      return c.json({ error: 'Stripe is not configured', code: 'stripe_not_configured' }, 503);
    }
    // stripeCall throws `stripe_error:<status>:<body>` — surface the upstream status and message so the admin sees
    // WHY, instead of a generic 500. Explicit failure over silent fallback.
    const m = /^stripe_error:(\d+):([\s\S]*)$/.exec(msg);
    const upstreamStatus = m ? Number(m[1]) : 502;
    const detail = m ? m[2] : msg;
    const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502;
    return c.json({ error: 'Stripe refund failed', code: 'stripe_error', upstream_status: upstreamStatus, detail }, status);
  }

  // Clawback the referral commission tied to this purchase (Task #11). The customer refund has already landed, so
  // this is best-effort: it never throws, and a failure is surfaced and audited rather than rolling the refund back.
  // The charge is re-read AFTER the refund: `amount` is the proportional denominator and `amount_refunded` the
  // cumulative figure, so sequential partial refunds reverse their share correctly.
  const clawbackPaymentIntent = refund.payment_intent || t.payment_intent || null;
  let chargeAmountCents: number | null = t.gross;
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

  // Audit AFTER the refund lands so the row carries the real refund id and status. D224: through `logAdminAction`
  // (D159), one call, so one row in each store per refund; best-effort, because the money has already moved.
  await logAdminAction(c.env, adminUser.id, adminUser.email || '', 'billing_refund', {
    refund_id: refund.id,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    payment_intent: refund.payment_intent,
    charge: refund.charge,
    reason,
    target_user_id: targetUserId,
    product_kind: policy.kind,
    policy_state: policy.state,
    policy_allowed: policy.state === 'allowed',
    policy_reason: policy.reason,
    policy_override: overridden,
    override_reason: overridden ? overrideReason : null,
    policy_note: policy.note,
    review: reviewSummary(t, requested),
    clawback,
  });

  // D5299 (#5299): the refund's revenue-ledger row, keyed as Stripe's `charge.refunded` for it will be, so the two make
  // one row. Best-effort like the audit above, because the money has already moved; a failure is logged, and the
  // webhook still records the refund.
  try {
    const { recordHqRefund } = await import('../services/financialEvents');
    await recordHqRefund(c.env, {
      refund, refundedBefore: t.refunded, customer: t.customer, metadata: t.metadata, adminUserId: adminUser.id,
      livemode: stripeMode(c.env) === 'unconfigured' ? null : stripeMode(c.env) === 'live',
    });
  } catch (e) {
    console.error('[admin/billing] refund not recorded in the revenue ledger', refund.id, (e as Error).message);
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
      state: policy.state,
      allowed: policy.state === 'allowed',
      reason: policy.reason,
      overridden,
      note: policy.note,
    },
    clawback,
  });
});

// D224 — GET /api/admin/billing/refunds — the refunds HQ issued, for Revenue.
//
// READ FROM THE AUDIT ROWS, NOT FROM STRIPE. Every refund issued here writes
// one `billing_refund` row (above), so the rows ARE the local record of what
// HQ refunded and when, with the written reason beside each. Refunds made in
// the Stripe dashboard never pass through this route and are not in it; the
// payload says so rather than letting the count read as Stripe's.
//
// Super admin only, the same as the Revenue page that reads it. Amounts stay
// integer minor units per currency and are never summed across currencies.
export const REFUND_WINDOW_DAYS = 30;
adminBilling.get('/refunds', async (c) => {
  await requireSuperAdmin(c);
  try {
    await ensureAdminAuditLogTable(c.env);
    const res = await c.env.DB.prepare(
      `SELECT id, admin_user_id, filters_json, exported_at
         FROM admin_audit_log
        WHERE action = 'billing_refund'
          AND datetime(exported_at) >= datetime('now', ?)
        ORDER BY datetime(exported_at) DESC, id DESC`,
    ).bind(`-${REFUND_WINDOW_DAYS} days`).all<{ id: number; admin_user_id: number; filters_json: string | null; exported_at: string }>();
    const items: Array<Record<string, unknown>> = [];
    const byCurrency = new Map<string, { currency: string; count: number; amount_cents: number }>();
    let unreadableRows = 0;
    for (const row of res.results || []) {
      let d: Record<string, unknown> | null = null;
      try { d = row.filters_json ? JSON.parse(row.filters_json) : null; } catch { d = null; }
      const amount = d && Number.isInteger(d.amount) ? (d.amount as number) : null;
      const currency = d && typeof d.currency === 'string' ? d.currency.toUpperCase() : null;
      // A row whose amount or currency cannot be read is counted as such and
      // kept out of every total, never folded in as a zero.
      if (amount === null || currency === null) { unreadableRows += 1; continue; }
      const b = byCurrency.get(currency) || { currency, count: 0, amount_cents: 0 };
      b.count += 1;
      b.amount_cents += amount;
      byCurrency.set(currency, b);
      items.push({
        audit_id: row.id,
        refund_id: typeof d?.refund_id === 'string' ? d.refund_id : null,
        status: typeof d?.status === 'string' ? d.status : null,
        amount_cents: amount,
        currency,
        reason: typeof d?.reason === 'string' && d.reason ? d.reason : null,
        target_user_id: Number.isInteger(d?.target_user_id) ? d?.target_user_id : null,
        policy_override: d?.policy_override === true,
        admin_user_id: row.admin_user_id,
        issued_at: row.exported_at,
      });
    }
    return c.json({
      available: true,
      window_days: REFUND_WINDOW_DAYS,
      source: 'Refunds issued through HQ, from their audit rows. A refund made in the Stripe dashboard is not listed here.',
      count: items.length,
      unreadable_rows: unreadableRows,
      by_currency: [...byCurrency.values()],
      items,
    });
  } catch {
    return c.json({ available: false, reason: 'The refund audit rows could not be read.' });
  }
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
// D892 §6 — plan rows left at `incomplete`: the owner's reconciliation
// -------------------------------------------------------------------------

// POST /api/admin/billing/subscriptions/reconcile-incomplete
//   { dry_run?: boolean, reason?: string, after?: number, limit?: number }
//   → { dry_run, checked, counts, results, next_after }
//
// Founder and investor rows that hold a subscription at `incomplete` are read
// again from Stripe, one page at a time by user id, and each result says what
// Stripe reports and what the row takes (`reconcileIncompleteRows`,
// services/planSubscription.ts): a live subscription its plan and status, an
// expired or canceled one free, an unpaid one its status; anything else is
// left as it is.
//
// A DRY RUN UNLESS `dry_run: false`. A dry run only reads Stripe and needs a
// Super Admin. Writing takes the write bar (a TOTP session, a recent step-up,
// the holder) and a written reason, as the other payment writes do (D1009).
// Every run, dry or written, is audited once through `logAdminAction`, with
// each row's outcome and whether it was written, and that includes a run that
// fails: a row whose write fails is `failed` and the walk goes on, so the
// answer is 200 and says which rows were written. Only a page that cannot be
// read answers 503, and nothing has been written then. The audit write itself
// stays best-effort (D159). The owner runs it against production; no deploy
// or cron runs it.
adminBilling.post('/subscriptions/reconcile-incomplete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const write = body?.dry_run === false;
  const admin = write ? await requireSuperAdminWriteBar(c) : await requireSuperAdmin(c);
  const reason = paymentChangeReason(body);
  if (write && !reason) {
    return c.json({ error: 'reason_required', message: 'Give a reason of 1 to 500 characters for rewriting these plan rows.' }, 400);
  }
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);
  const { reconcileIncompleteRows, RECONCILE_LIMIT_MAX } = await import('../services/planSubscription');
  const whole = (v: unknown, fallback: number) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : fallback);
  const after = whole(body?.after, 0);
  const limit = Math.max(1, Math.min(RECONCILE_LIMIT_MAX, whole(body?.limit, 25)));
  let result: Awaited<ReturnType<typeof reconcileIncompleteRows>> | null = null;
  try {
    result = await reconcileIncompleteRows(c.env, { write, after, limit });
  } catch (e) {
    // Only the page read throws, before any row is touched.
    console.warn('[admin/billing] incomplete reconcile failed', (e as Error).message);
  }
  const results = result?.results ?? [];
  await logAdminAction(c.env, admin.id, admin.email, write ? 'billing_incomplete_reconcile' : 'billing_incomplete_reconcile_dry_run', {
    dry_run: !write, after, limit, checked: result?.checked ?? 0, counts: result?.counts ?? null, next_after: result?.next_after ?? null,
    written: results.filter((r) => r.written).length,
    // Each row names its member with D159's one spelling. A run spans many
    // members, so the action itself names none at the top level.
    results: results.map((r) => ({ target_user_id: r.user_id, family: r.family, subscription_id: r.subscription_id, outcome: r.outcome, written: r.written })),
    ...(result ? {} : { failed: 'page_unreadable' }),
    ...(reason ? { reason } : {}),
  });
  if (!result) {
    return c.json(refusalBody({
      code: 'reconcile_unavailable',
      message: 'The plan rows could not be read. Nothing was written; try again in a moment.',
      audience: 'admin',
    }), 503);
  }
  return c.json({ dry_run: !write, ...result });
});

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
  const status = upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502;
  // D278 — Stripe's JSON is the admin's to read on `upstream`, never `detail`.
  return c.json(refusalBody({
    code: 'stripe_error',
    message: 'Stripe did not accept the request. Nothing changed; the upstream field says why.',
    raw: m ? m[2] : msg,
    audience: 'admin',
    extra: { code: 'stripe_error', upstream_status: upstreamStatus },
  }), status);
}

export default adminBilling;
