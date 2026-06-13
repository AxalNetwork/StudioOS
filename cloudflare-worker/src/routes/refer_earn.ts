import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { devPaymentFallbackAllowed } from '../util/paymentMode';
import {
  ensureReferralPayoutsSchema,
  stripeForm,
  stripeGet,
  syncConnectAccount,
  runApprovalEngine,
  evaluateAutoApproval,
  buildTaxSummary,
  OFAC_SANCTIONED_COUNTRIES,
} from '../services/referralPayouts';

/**
 * Task #9 — Refer & Earn payouts via Stripe Connect Express.
 *
 *   POST /api/refer-earn/connect/onboard      → create Express acct + onboarding link
 *   GET  /api/refer-earn/connect/status       → snapshot the user's Connect account
 *   POST /api/refer-earn/connect/login-link   → hosted Express dashboard link
 *   GET  /api/refer-earn/dashboard            → totals + connect snapshot
 *   GET  /api/refer-earn/payouts/me           → ledger rows for the caller
 *   GET  /api/refer-earn/admin/payouts        → admin queue
 *   POST /api/refer-earn/admin/payouts/:id/approve  → manual approve
 *   POST /api/refer-earn/admin/payouts/:id/pay      → fire Stripe Transfer
 *   POST /api/refer-earn/admin/run-approval-engine  → sweep pending → approved
 *   GET  /api/refer-earn/admin/tax-summary?year=YYYY → 1099-MISC candidates
 */

interface ConnectUser extends User {
  stripe_connect_account_id?: string | null;
  stripe_connect_charges_enabled?: number | boolean | null;
  stripe_connect_payouts_enabled?: number | boolean | null;
  stripe_connect_verification_status?: string | null;
  stripe_connect_country?: string | null;
  stripe_connect_last_synced_at?: string | null;
}

const refer = new Hono<{ Bindings: Env }>();

function boolish(v: unknown): boolean {
  return v === 1 || v === true || String(v) === '1';
}

async function loadConnectUser(env: Env, userId: number): Promise<ConnectUser | null> {
  return await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<ConnectUser>();
}

// ---------------------------------------------------------------------------
// 1. Connect onboarding
// ---------------------------------------------------------------------------

refer.post('/connect/onboard', async (c) => {
  const user = (await requireAuth(c)) as ConnectUser;
  await ensureReferralPayoutsSchema(c.env);
  const key = c.env.STRIPE_SECRET_KEY;
  const appUrl = c.env.APP_URL || 'http://localhost:5000';
  if (!key) {
    if (!devPaymentFallbackAllowed(c.env)) return c.json({ error: 'stripe_not_configured' }, 503);
    // Dev fallback so the UI flow is testable without real Stripe.
    return c.json({
      url: `${appUrl}/refer-earn?connect=dev`,
      account_id: null,
      dev: true,
    });
  }
  let acctId = user.stripe_connect_account_id || null;
  if (!acctId) {
    try {
      const acct = await stripeForm<{ id: string }>(c.env, '/accounts', {
        type: 'express',
        'capabilities[transfers][requested]': 'true',
        email: user.email,
        'business_type': 'individual',
        'metadata[user_id]': String(user.id),
        'metadata[purpose]': 'refer_earn',
      }, { idempotencyKey: `refer-earn-acct-${user.id}` });
      acctId = acct.id;
      await c.env.DB.prepare(
        `UPDATE users SET stripe_connect_account_id = ? WHERE id = ?`,
      ).bind(acctId, user.id).run();
    } catch (e) {
      return c.json({ error: 'connect_account_create_failed', detail: (e as Error).message }, 502);
    }
  }
  try {
    const link = await stripeForm<{ url: string }>(c.env, '/account_links', {
      account: acctId,
      refresh_url: `${appUrl}/refer-earn?connect=refresh`,
      return_url: `${appUrl}/refer-earn?connect=return`,
      type: 'account_onboarding',
    });
    return c.json({ url: link.url, account_id: acctId });
  } catch (e) {
    return c.json({ error: 'connect_link_failed', detail: (e as Error).message }, 502);
  }
});

refer.get('/connect/status', async (c) => {
  const user = (await requireAuth(c)) as ConnectUser;
  await ensureReferralPayoutsSchema(c.env);
  const fresh = await loadConnectUser(c.env, user.id);
  if (!fresh?.stripe_connect_account_id) {
    return c.json({
      connected: false,
      charges_enabled: false,
      payouts_enabled: false,
      verification_status: null,
      country: null,
      payouts_blocked_reason: 'connect_not_started',
    });
  }
  // Best-effort refresh from Stripe so the UI is current. On failure we
  // serve the persisted snapshot — the webhook will catch up eventually.
  let snap: Awaited<ReturnType<typeof syncConnectAccount>> | null = null;
  if (c.env.STRIPE_SECRET_KEY) {
    try {
      snap = await syncConnectAccount(c.env, user.id, fresh.stripe_connect_account_id);
    } catch (e) {
      console.warn('[refer-earn] connect/status sync failed:', (e as Error).message);
    }
  }
  const charges = snap ? snap.charges_enabled : boolish(fresh.stripe_connect_charges_enabled);
  const payouts = snap ? snap.payouts_enabled : boolish(fresh.stripe_connect_payouts_enabled);
  const status = snap ? snap.verification_status : (fresh.stripe_connect_verification_status || 'unverified');
  const country = snap ? snap.country : (fresh.stripe_connect_country || null);
  // Block reason: must be charges_enabled AND verified (and not in OFAC).
  let blockReason: string | null = null;
  if (!charges) blockReason = 'charges_not_enabled';
  else if (status !== 'verified' && !payouts) blockReason = 'verification_pending';
  else if (country && OFAC_SANCTIONED_COUNTRIES.has(country.toUpperCase())) blockReason = `sanctioned_country:${country}`;
  return c.json({
    connected: true,
    account_id: fresh.stripe_connect_account_id,
    charges_enabled: charges,
    payouts_enabled: payouts,
    verification_status: status,
    country,
    payouts_blocked_reason: blockReason,
    disabled_reason: snap?.disabled_reason || null,
    requirements_currently_due: snap?.requirements_currently_due || [],
  });
});

refer.post('/connect/login-link', async (c) => {
  const user = (await requireAuth(c)) as ConnectUser;
  await ensureReferralPayoutsSchema(c.env);
  const fresh = await loadConnectUser(c.env, user.id);
  if (!fresh?.stripe_connect_account_id) {
    return c.json({ error: 'connect_not_started' }, 400);
  }
  if (!c.env.STRIPE_SECRET_KEY) {
    if (!devPaymentFallbackAllowed(c.env)) return c.json({ error: 'stripe_not_configured' }, 503);
    return c.json({ url: `${c.env.APP_URL || 'http://localhost:5000'}/refer-earn?login=dev`, dev: true });
  }
  try {
    const link = await stripeForm<{ url: string }>(
      c.env,
      `/accounts/${encodeURIComponent(fresh.stripe_connect_account_id)}/login_links`,
      {},
    );
    return c.json({ url: link.url });
  } catch (e) {
    return c.json({ error: 'login_link_failed', detail: (e as Error).message }, 502);
  }
});

// ---------------------------------------------------------------------------
// 5. Referrer dashboard
// ---------------------------------------------------------------------------

refer.get('/dashboard', async (c) => {
  const user = (await requireAuth(c)) as ConnectUser;
  await ensureReferralPayoutsSchema(c.env);
  const fresh = (await loadConnectUser(c.env, user.id)) || (user as ConnectUser);

  // Ledger totals — earned (pending+approved), approved, paid.
  const totals = await c.env.DB.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN status='pending'   THEN amount_usd_cents ELSE 0 END), 0) AS pending_cents,
        COALESCE(SUM(CASE WHEN status='approved'  THEN amount_usd_cents ELSE 0 END), 0) AS approved_cents,
        COALESCE(SUM(CASE WHEN status='paid'      THEN amount_usd_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN status='reversed'  THEN amount_usd_cents ELSE 0 END), 0) AS reversed_cents,
        COUNT(*)                                                                         AS total_rows
       FROM referral_payouts WHERE referrer_user_id = ?`,
  ).bind(user.id).first<{
    pending_cents: number; approved_cents: number; paid_cents: number; reversed_cents: number; total_rows: number;
  }>();

  // Anonymised referral history: show first 2 chars of local-part + domain
  // so the referrer can identify "their" referee without leaking PII.
  const history = await c.env.DB.prepare(
    `SELECT p.id, p.amount_usd_cents, p.currency, p.status, p.block_reason,
            p.earned_at, p.approved_at, p.paid_at,
            r.referred_id,
            u.email AS referred_email,
            c.source_type, c.description
       FROM referral_payouts p
       LEFT JOIN commissions c ON c.id = p.redemption_id
       LEFT JOIN referrals   r ON r.id = c.referral_id
       LEFT JOIN users       u ON u.id = r.referred_id
      WHERE p.referrer_user_id = ?
      ORDER BY p.earned_at DESC
      LIMIT 200`,
  ).bind(user.id).all<{
    id: number; amount_usd_cents: number; currency: string; status: string;
    block_reason: string | null; earned_at: string; approved_at: string | null; paid_at: string | null;
    referred_id: number | null; referred_email: string | null;
    source_type: string | null; description: string | null;
  }>();

  const anonymizedHistory = (history.results || []).map((row) => {
    let masked: string | null = null;
    if (row.referred_email) {
      const at = row.referred_email.indexOf('@');
      if (at > 0) {
        const head = row.referred_email.slice(0, Math.min(2, at));
        masked = `${head}***${row.referred_email.slice(at)}`;
      } else {
        masked = '***';
      }
    }
    return {
      id: row.id,
      amount_usd_cents: row.amount_usd_cents,
      currency: row.currency,
      status: row.status,
      block_reason: row.block_reason,
      earned_at: row.earned_at,
      approved_at: row.approved_at,
      paid_at: row.paid_at,
      source_type: row.source_type,
      description: row.description,
      referred_email_masked: masked,
    };
  });

  // Connect status (cached snapshot — /connect/status does the live sync).
  const charges = boolish(fresh.stripe_connect_charges_enabled);
  const payouts = boolish(fresh.stripe_connect_payouts_enabled);
  const status = fresh.stripe_connect_verification_status || null;
  const country = fresh.stripe_connect_country || null;
  let payoutsBlockedReason: string | null = null;
  if (!fresh.stripe_connect_account_id) payoutsBlockedReason = 'connect_not_started';
  else if (!charges) payoutsBlockedReason = 'charges_not_enabled';
  else if (status !== 'verified' && !payouts) payoutsBlockedReason = 'verification_pending';
  else if (country && OFAC_SANCTIONED_COUNTRIES.has(country.toUpperCase())) payoutsBlockedReason = `sanctioned_country:${country}`;

  return c.json({
    totals: {
      pending_cents: totals?.pending_cents ?? 0,
      approved_cents: totals?.approved_cents ?? 0,
      paid_cents: totals?.paid_cents ?? 0,
      reversed_cents: totals?.reversed_cents ?? 0,
      lifetime_cents: (totals?.pending_cents ?? 0) + (totals?.approved_cents ?? 0) + (totals?.paid_cents ?? 0),
    },
    connect: {
      connected: !!fresh.stripe_connect_account_id,
      account_id: fresh.stripe_connect_account_id || null,
      charges_enabled: charges,
      payouts_enabled: payouts,
      verification_status: status,
      country,
      payouts_blocked_reason: payoutsBlockedReason,
      last_synced_at: fresh.stripe_connect_last_synced_at || null,
    },
    history: anonymizedHistory,
  });
});

refer.get('/payouts/me', async (c) => {
  const user = await requireAuth(c);
  await ensureReferralPayoutsSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, amount_usd_cents, currency, status, block_reason,
            stripe_transfer_id, earned_at, approved_at, paid_at, reversed_at,
            failure_reason
       FROM referral_payouts
      WHERE referrer_user_id = ?
      ORDER BY earned_at DESC
      LIMIT 200`,
  ).bind(user.id).all();
  return c.json(rows.results || []);
});

// ---------------------------------------------------------------------------
// Admin queue + pay
// ---------------------------------------------------------------------------

refer.get('/admin/payouts', async (c) => {
  await requireAdmin(c);
  await ensureReferralPayoutsSchema(c.env);
  const url = new URL(c.req.url);
  const statusFilter = url.searchParams.get('status');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 200);
  let sql = `SELECT p.*,
                    u.email      AS referrer_email,
                    u.name       AS referrer_name,
                    u.stripe_connect_account_id,
                    u.stripe_connect_charges_enabled,
                    u.stripe_connect_payouts_enabled,
                    u.stripe_connect_verification_status,
                    u.stripe_connect_country
               FROM referral_payouts p
               JOIN users u ON u.id = p.referrer_user_id`;
  const params: unknown[] = [];
  if (statusFilter) {
    sql += ` WHERE p.status = ?`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY p.earned_at DESC LIMIT ?`;
  params.push(limit);
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(rows.results || []);
});

refer.post('/admin/run-approval-engine', async (c) => {
  await requireAdmin(c);
  const out = await runApprovalEngine(c.env);
  return c.json({ ok: true, ...out });
});

refer.post('/admin/payouts/:id/approve', async (c) => {
  const admin = await requireAdmin(c);
  await ensureReferralPayoutsSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  const r = await c.env.DB.prepare(
    `UPDATE referral_payouts
        SET status='approved', approved_at=CURRENT_TIMESTAMP,
            block_reason = 'manual_admin_approval'
      WHERE id = ? AND status IN ('pending')`,
  ).bind(id).run();
  if (((r?.meta?.changes ?? 0) as number) === 0) return c.json({ error: 'not_pending' }, 409);
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('referral_payout_manual_approved', ?, ?, ?)`,
  ).bind(`Admin manually approved referral payout #${id}`, await hashEmail(admin.email), admin.id).run();
  return c.json({ ok: true, status: 'approved' });
});

refer.post('/admin/payouts/:id/pay', async (c) => {
  const admin = await requireAdmin(c);
  await ensureReferralPayoutsSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);

  // Re-load the row + referrer.
  const row = await c.env.DB.prepare(
    `SELECT p.*, u.stripe_connect_account_id, u.stripe_connect_charges_enabled,
            u.stripe_connect_payouts_enabled, u.stripe_connect_country,
            u.stripe_connect_verification_status, u.email AS referrer_email
       FROM referral_payouts p
       JOIN users u ON u.id = p.referrer_user_id
      WHERE p.id = ?`,
  ).bind(id).first<{
    id: number; referrer_user_id: number; amount_usd_cents: number; currency: string;
    status: string; stripe_transfer_id: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_charges_enabled: number | boolean | null;
    stripe_connect_payouts_enabled: number | boolean | null;
    stripe_connect_country: string | null;
    stripe_connect_verification_status: string | null;
    referrer_email: string;
  }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status === 'paid') return c.json({ error: 'already_paid' }, 409);
  if (row.status !== 'approved') return c.json({ error: 'not_approved', status: row.status }, 409);
  if (!row.stripe_connect_account_id) return c.json({ error: 'referrer_not_connected' }, 400);
  if (!boolish(row.stripe_connect_charges_enabled)) return c.json({ error: 'connect_not_charges_enabled' }, 400);
  // Spec: payouts blocked until verification.status='verified'. We treat
  // `payouts_enabled` as the canonical Stripe signal because some Express
  // regions don't expose `individual.verification.status` — when payouts
  // are flagged enabled, Stripe has cleared the account; otherwise the
  // explicit verification_status must read 'verified'.
  if (
    (row.stripe_connect_verification_status || '').toLowerCase() !== 'verified'
    && !boolish(row.stripe_connect_payouts_enabled)
  ) {
    return c.json({ error: 'connect_not_verified', verification_status: row.stripe_connect_verification_status }, 400);
  }
  // OFAC / sanctioned-region guard.
  const country = (row.stripe_connect_country || '').toUpperCase();
  if (country && OFAC_SANCTIONED_COUNTRIES.has(country)) {
    await c.env.DB.prepare(
      `UPDATE referral_payouts SET status='blocked', block_reason = ? WHERE id = ?`,
    ).bind(`sanctioned_country:${country}`, id).run();
    return c.json({ error: 'sanctioned_country', country }, 403);
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    if (!devPaymentFallbackAllowed(c.env)) return c.json({ error: 'stripe_not_configured' }, 503);
    // Dev fallback — mark paid without firing a real Transfer so the
    // local UI flow round-trips end-to-end.
    const devTransferId = `tr_dev_${id}_${Date.now()}`;
    await c.env.DB.prepare(
      `UPDATE referral_payouts
          SET status='paid', paid_at=CURRENT_TIMESTAMP,
              stripe_transfer_id = ?, stripe_destination = ?,
              paid_by_admin_id = ?, failure_reason = NULL
        WHERE id = ?`,
    ).bind(devTransferId, row.stripe_connect_account_id, admin.id, id).run();
    // Mark the underlying commission paid so a subsequent transfer.failed
    // webhook can re-accrue it. (Dev path mirrors the live path.)
    try {
      await c.env.DB.prepare(
        `UPDATE commissions SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id = ? AND status='accrued'`,
      ).bind((row as { redemption_id?: number }).redemption_id ?? -1).run();
    } catch { /* table-shape divergence in dev — non-fatal */ }
    return c.json({ ok: true, dev: true, transfer_id: devTransferId });
  }

  // Real Stripe Transfer. Idempotency-Key keyed by payout id so a
  // retried admin click never double-pays.
  let transferId: string;
  try {
    const transfer = await stripeForm<{ id: string }>(
      c.env,
      '/transfers',
      {
        amount: String(row.amount_usd_cents),
        currency: (row.currency || 'usd').toLowerCase(),
        destination: row.stripe_connect_account_id,
        'metadata[payout_id]': String(row.id),
        'metadata[redemption_id]': String((row as { redemption_id?: number }).redemption_id ?? ''),
        'metadata[referrer_user_id]': String(row.referrer_user_id),
        description: `Refer & Earn payout #${row.id}`,
      },
      { idempotencyKey: `refer-earn-pay-${row.id}` },
    );
    transferId = transfer.id;
  } catch (e) {
    const msg = (e as Error).message;
    await c.env.DB.prepare(
      `UPDATE referral_payouts SET failure_reason = ? WHERE id = ?`,
    ).bind(msg.slice(0, 300), id).run();
    return c.json({ error: 'transfer_failed', detail: msg }, 502);
  }

  // We optimistically flip status to 'paid' once the transfer is created
  // because Stripe returns success synchronously for Transfers (unlike
  // Payouts). The transfer.paid webhook re-asserts paid_at + failure
  // cleanup; transfer.failed reverses.
  await c.env.DB.prepare(
    `UPDATE referral_payouts
        SET status='paid', paid_at=CURRENT_TIMESTAMP,
            stripe_transfer_id = ?, stripe_destination = ?,
            paid_by_admin_id = ?, failure_reason = NULL
      WHERE id = ?`,
  ).bind(transferId, row.stripe_connect_account_id, admin.id, id).run();
  // Mark the underlying commission as paid so `transfer.failed` can
  // re-accrue it (applyTransferFailed flips it back to 'accrued' on
  // failure, restoring the referrer's balance). Without this update the
  // failure re-accrual is a no-op and commission state drifts from
  // payout state.
  try {
    await c.env.DB.prepare(
      `UPDATE commissions SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id = ? AND status='accrued'`,
    ).bind((row as { redemption_id?: number }).redemption_id ?? -1).run();
  } catch (e) {
    console.warn('[refer-earn] commission status flip to paid failed:', (e as Error).message);
  }
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('referral_payout_paid', ?, ?, ?)`,
  ).bind(
    `Admin paid referral payout #${id} ($${(row.amount_usd_cents / 100).toFixed(2)}) — transfer ${transferId}`,
    await hashEmail(admin.email),
    admin.id,
  ).run();

  // Notify the referrer.
  try {
    const { notify } = await import('../services/notify');
    await notify(c.env, {
      userId: row.referrer_user_id,
      type: 'referral_payout_paid',
      category: 'proactive_nudges',
      title: 'Referral payout sent',
      body: `Your referral payout of $${(row.amount_usd_cents / 100).toFixed(2)} has been transferred to your Stripe account.`,
      link: '/refer-earn',
      payload: { payout_id: row.id, transfer_id: transferId },
      channels: ['in_app', 'email'],
    });
  } catch (e) {
    console.warn('[refer-earn] notify referrer on pay failed:', (e as Error).message);
  }

  return c.json({ ok: true, transfer_id: transferId, status: 'paid' });
});

refer.get('/admin/tax-summary', async (c) => {
  await requireAdmin(c);
  const url = new URL(c.req.url);
  const yearStr = url.searchParams.get('year');
  const year = yearStr ? parseInt(yearStr, 10) : new Date().getUTCFullYear();
  if (!Number.isFinite(year) || year < 2024 || year > 2100) {
    return c.json({ error: 'invalid_year' }, 400);
  }
  const rows = await buildTaxSummary(c.env, year);
  return c.json({ year, threshold_usd_cents: 60000, rows });
});

// Probe endpoint — exposes the auto-approval decision for one row.
// Useful for admins debugging "why is this still pending?". Admin-only.
refer.get('/admin/payouts/:id/evaluate', async (c) => {
  await requireAdmin(c);
  await ensureReferralPayoutsSchema(c.env);
  const id = parseInt(c.req.param('id'), 10);
  const row = await c.env.DB.prepare(
    `SELECT id, redemption_id, status FROM referral_payouts WHERE id = ?`,
  ).bind(id).first<{ id: number; redemption_id: number; status: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const check = await evaluateAutoApproval(c.env, row);
  return c.json({ id: row.id, current_status: row.status, eligible: check.ok, reason: check.reason || null });
});

export default refer;
