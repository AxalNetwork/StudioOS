/**
 * Task #6 (W-1) — Investor seats (Institutional-only colleague invites).
 *
 *   GET    /api/investor-seats           — list seats owned by caller
 *   POST   /api/investor-seats/invite    — invite colleague (≤4 active)
 *   POST   /api/investor-seats/accept    — accept by token (any auth user)
 *   DELETE /api/investor-seats/:id       — revoke
 *
 * Accepted seats inherit the primary's tier transparently via
 * `investor_seat_primary_user_id` on the seat user's row.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  ensureInvestorPaywallSchema,
  effectiveInvestorTier,
  INVESTOR_QUOTAS,
  type InvestorUser,
} from '../middleware/requireInvestorTier';

const seats = new Hono<{ Bindings: Env }>();

seats.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureInvestorPaywallSchema(c.env);
  await next();
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

seats.get('/', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const rows = await c.env.DB.prepare(
    `SELECT id, seat_email, seat_user_id, invited_at, accepted_at, revoked_at
     FROM investor_seats WHERE primary_user_id = ?
     ORDER BY invited_at DESC`
  ).bind(user.id).all();
  return c.json({ seats: rows.results || [], cap: INVESTOR_QUOTAS.institutional.seats });
});

seats.post('/invite', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (effectiveInvestorTier(user) !== 'institutional' && user.role !== 'admin') {
    return c.json({
      error: 'investor_tier_required',
      required: 'institutional',
      message: 'Seat invites are an Institutional feature.',
      checkout_path: '/api/billing/investor/checkout',
    }, 402);
  }
  const body = await c.req.json().catch(() => ({} as { email?: string }));
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'invalid_email' }, 400);

  const cnt = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM investor_seats
     WHERE primary_user_id = ? AND revoked_at IS NULL`
  ).bind(user.id).first<{ n: number }>();
  const active = Number(cnt?.n ?? 0);
  if (active >= INVESTOR_QUOTAS.institutional.seats) {
    return c.json({
      error: 'seat_cap_exceeded',
      message: `Institutional plan supports up to ${INVESTOR_QUOTAS.institutional.seats} colleague seats.`,
      cap: INVESTOR_QUOTAS.institutional.seats,
      used: active,
    }, 409);
  }

  // Generate a single-use invite token.
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  const token = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');

  try {
    await c.env.DB.prepare(
      `INSERT INTO investor_seats (primary_user_id, seat_email, invite_token)
       VALUES (?, ?, ?)`
    ).bind(user.id, email, token).run();
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/UNIQUE/i.test(msg)) return c.json({ error: 'already_invited' }, 409);
    throw e;
  }
  await c.env.DB.prepare(
    `UPDATE users SET investor_seat_count = investor_seat_count + 1 WHERE id = ?`
  ).bind(user.id).run();

  return c.json({ ok: true, email, invite_token: token });
});

seats.post('/accept', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const body = await c.req.json().catch(() => ({} as { token?: string }));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ error: 'token_required' }, 400);

  const seat = await c.env.DB.prepare(
    `SELECT id, primary_user_id, seat_email, accepted_at, revoked_at
     FROM investor_seats WHERE invite_token = ?`
  ).bind(token).first<{
    id: number; primary_user_id: number; seat_email: string;
    accepted_at: string | null; revoked_at: string | null;
  }>();
  if (!seat) return c.json({ error: 'invalid_token' }, 404);
  if (seat.revoked_at) return c.json({ error: 'invite_revoked' }, 410);
  if (seat.accepted_at) return c.json({ error: 'already_accepted' }, 409);
  if (seat.seat_email.toLowerCase() !== String(user.email).toLowerCase()) {
    return c.json({ error: 'email_mismatch' }, 403);
  }

  // Mirror primary's tier onto the seat user so paywall checks pass.
  // Cascade is also re-applied on webhook tier changes / trial downgrades.
  const primary = await c.env.DB.prepare(
    `SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?`
  ).bind(seat.primary_user_id).first<{ investor_tier: string | null; investor_subscription_status: string | null }>();
  const inheritedTier = primary?.investor_tier ?? 'institutional';
  const inheritedStatus = primary?.investor_subscription_status ?? 'active';
  await c.env.DB.prepare(
    `UPDATE investor_seats SET seat_user_id = ?, accepted_at = CURRENT_TIMESTAMP,
                                invite_token = NULL
     WHERE id = ?`
  ).bind(user.id, seat.id).run();
  await c.env.DB.prepare(
    `UPDATE users SET investor_seat_primary_user_id = ?,
                       role = 'investor',
                       investor_tier = ?,
                       investor_subscription_status = ?
     WHERE id = ?`
  ).bind(seat.primary_user_id, inheritedTier, inheritedStatus, user.id).run();
  return c.json({ ok: true, primary_user_id: seat.primary_user_id, tier: inheritedTier });
});

seats.delete('/:id', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad_id' }, 400);
  const seat = await c.env.DB.prepare(
    `SELECT id, primary_user_id, seat_user_id, revoked_at FROM investor_seats WHERE id = ?`
  ).bind(id).first<{ id: number; primary_user_id: number; seat_user_id: number | null; revoked_at: string | null }>();
  if (!seat) return c.json({ error: 'not_found' }, 404);
  if (seat.primary_user_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (seat.revoked_at) return c.json({ ok: true, already_revoked: true });
  await c.env.DB.prepare(
    `UPDATE investor_seats SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(id).run();
  if (seat.seat_user_id) {
    // Drop the link AND reset the seat user back to free so they don't keep
    // Institutional access after revocation.
    await c.env.DB.prepare(
      `UPDATE users SET investor_seat_primary_user_id = NULL,
                         investor_tier = 'free',
                         investor_subscription_status = 'free'
       WHERE id = ? AND investor_seat_primary_user_id = ?`
    ).bind(seat.seat_user_id, seat.primary_user_id).run();
  }
  await c.env.DB.prepare(
    `UPDATE users SET investor_seat_count = MAX(0, investor_seat_count - 1) WHERE id = ?`
  ).bind(seat.primary_user_id).run();
  return c.json({ ok: true });
});

/**
 * Cron-friendly downgrader: any users whose investor_trial_ends_at is in
 * the past AND status='trialing' → tier='free', status='free'.
 */
export async function downgradeExpiredInvestorTrials(env: Env): Promise<{ scanned: number; downgraded: number }> {
  await ensureInvestorPaywallSchema(env);
  const due = await env.DB.prepare(
    `SELECT id FROM users
     WHERE role = 'investor'
       AND investor_subscription_status = 'trialing'
       AND investor_trial_ends_at IS NOT NULL
       AND investor_trial_ends_at <= datetime('now')`
  ).all<{ id: number }>();
  const ids = (due.results || []).map((r) => r.id);
  if (ids.length === 0) return { scanned: 0, downgraded: 0 };
  for (const id of ids) {
    await env.DB.prepare(
      `UPDATE users SET investor_tier = 'free', investor_subscription_status = 'free'
       WHERE id = ?`
    ).bind(id).run();
    // Cascade to seat colleagues so they don't keep paid access.
    await env.DB.prepare(
      `UPDATE users SET investor_tier = 'free', investor_subscription_status = 'free'
       WHERE investor_seat_primary_user_id = ?`
    ).bind(id).run();
  }
  return { scanned: ids.length, downgraded: ids.length };
}

export default seats;
