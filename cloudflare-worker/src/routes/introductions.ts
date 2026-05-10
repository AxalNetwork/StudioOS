/**
 * Task #6 (W-1) — Investor introduction requests with quarterly quota.
 *
 *   POST /api/introductions/request   — investor → founder. Decrements
 *                                       investor_quota_intros_used; returns
 *                                       402 with code:'quota_intros_exhausted'
 *                                       when at cap.
 *   GET  /api/introductions/quota     — caller's current usage / cap.
 *   GET  /api/introductions/          — caller's intro history.
 *
 * The 3-way Founder/Investor/Axal NDA flow is owned by /api/trust/intro/*
 * (T3 Trust Center). This route only enforces the *paid quota* on top.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  ensureInvestorPaywallSchema,
  getIntroQuotaState,
  effectiveInvestorTier,
  type InvestorUser,
} from '../middleware/requireInvestorTier';

const introductions = new Hono<{ Bindings: Env }>();

introductions.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureInvestorPaywallSchema(c.env);
  await next();
});

introductions.get('/quota', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const state = await getIntroQuotaState(c.env, user.id);
  return c.json({
    tier: state.tier,
    quarter: state.quarter,
    used: state.used,
    cap: state.cap,
    remaining: Math.max(0, state.cap - state.used),
  });
});

introductions.get('/', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor' && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT uid, investor_user_id, founder_user_id, founder_id, project_id,
            message, status, quarter, created_at
     FROM investor_introductions
     WHERE investor_user_id = ?
     ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all();
  return c.json({ introductions: rows.results || [] });
});

introductions.post('/request', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (user.role !== 'investor') {
    return c.json({ error: 'investor_only' }, 403);
  }

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const founderUserId = body.founder_user_id != null ? Number(body.founder_user_id) : null;
  const founderId = body.founder_id != null ? Number(body.founder_id) : null;
  const projectId = body.project_id != null ? Number(body.project_id) : null;
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;

  if (!founderUserId && !founderId && !projectId) {
    return c.json({ error: 'target_required', message: 'Provide founder_user_id, founder_id, or project_id' }, 400);
  }

  // Quota check — paywall gate. Free investors get 3/quarter, Pro 25, Inst 100.
  const state = await getIntroQuotaState(c.env, user.id);
  if (state.used >= state.cap) {
    return c.json(
      {
        error: 'quota_exceeded',
        code: 'quota_intros_exhausted',
        message: `You have used all ${state.cap} introductions for ${state.quarter}.`,
        used: state.used,
        cap: state.cap,
        tier: state.tier,
        upgrade_to: state.tier === 'free' ? 'professional' : 'institutional',
        checkout_path: '/api/billing/investor/checkout',
      },
      402,
    );
  }

  // Atomic reserve-then-insert: bump counter first; if insert fails we
  // accept the (rare) wasted slot rather than risk double-spend on race.
  await c.env.DB.prepare(
    `UPDATE users SET investor_quota_intros_used = investor_quota_intros_used + 1
     WHERE id = ? AND investor_quota_intros_quarter = ?`
  ).bind(user.id, state.quarter).run();

  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO investor_introductions
       (uid, investor_user_id, founder_user_id, founder_id, project_id,
        message, status, quarter)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(uid, user.id, founderUserId, founderId, projectId, message, state.quarter).run();

  // The 3-way Founder/Investor/Axal NDA envelope is minted by the Trust
  // Center route POST /api/trust/intro/request — the frontend calls that
  // immediately after a successful quota grant here. We deliberately do
  // NOT couple the two writes; if the NDA flow fails the quota was still
  // spent (matches Stripe-style "reserve the slot, retry the side-effect").

  return c.json({
    ok: true,
    uid,
    used: state.used + 1,
    cap: state.cap,
    remaining: state.cap - state.used - 1,
    tier: effectiveInvestorTier(user),
  });
});

export default introductions;
