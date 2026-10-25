/**
 * Task #6 (W-1) — Investor seats (Institutional-only colleague invites).
 *
 *   GET    /api/investor-seats            — list seats owned by caller (never the link)
 *   POST   /api/investor-seats/invite     — invite colleague (≤4 active); the link, once
 *   POST   /api/investor-seats/invitation — what an invite offers, read by its token (D632)
 *   POST   /api/investor-seats/accept     — accept by token (any auth user)
 *   DELETE /api/investor-seats/:id        — revoke
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
import { hashEmail } from '../util/hashEmail';

const seats = new Hono<{ Bindings: Env }>();

seats.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureInvestorPaywallSchema(c.env);
  await next();
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicBase(env: Env): string {
  return String((env as any).PUBLIC_BASE_URL || (env as any).APP_URL || 'https://axal.vc').replace(/\/+$/, '');
}

/** The accept URL. The token stays in the query; it is never a response field. */
export function inviteLink(env: Env, token: string): string {
  return `${publicBase(env)}/investor-seats/accept?token=${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The company-invitation mail path: Gmail when it is configured, otherwise
 * false. A missing credential is the ordinary case, not an error the inviter
 * should read as "sent".
 */
async function emailSeatInvite(env: Env, to: string, inviterName: string, link: string): Promise<boolean> {
  if (!(env as any).GMAIL_CLIENT_ID || !(env as any).GMAIL_CLIENT_SECRET || !(env as any).GMAIL_REFRESH_TOKEN) {
    return false;
  }
  try {
    const { sendRawEmail } = await import('../services/email/gmail');
    const who = String(inviterName || 'An investor').replace(/[\r\n]/g, ' ').slice(0, 80);
    const safeWho = escapeHtml(who);
    const safeLink = escapeHtml(link);
    return await sendRawEmail(env, {
      to,
      from: 'Axal VC <noreply@axal.vc>',
      replyTo: 'noreply@axal.vc',
      subject: `${who} invited you to a colleague seat`,
      text: `${who} invited you to share their Institutional investor account on Axal VC.\n\nAccept: ${link}\n\nThe link works only for this email address.\n`,
      html: `<p>${safeWho} invited you to share their Institutional investor account on Axal VC.</p><p><a href="${safeLink}">Accept the seat</a></p>`,
    });
  } catch (e) {
    console.warn('[investor-seats] invite email failed', e);
    return false;
  }
}

/**
 * One seat as its inviter reads it. D632: the link is shown once, in the
 * invite reply, and never again — the list carries the seat's state and no
 * link, and its query never selects the token.
 */
export function seatForInviter(row: Record<string, unknown>) {
  const state = row.revoked_at ? 'revoked' : row.accepted_at ? 'accepted' : 'invited';
  return {
    id: row.id,
    seat_email: row.seat_email,
    seat_user_id: row.seat_user_id,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
    revoked_at: row.revoked_at,
    state,
  };
}

/**
 * D632 — every seat write records its actor in `activity_logs`. A failed log
 * line must not undo a write that has already happened, so it only warns.
 */
async function logSeatAct(env: Env, user: InvestorUser, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    const actor = await hashEmail(String(user.email || ''));
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(action, JSON.stringify(details), actor, user.id).run();
  } catch (e) {
    console.warn('[investor-seats] activity log failed', action, (e as Error).message);
  }
}

/** Whether the inviting account's plan still covers seats. Fail-closed. */
async function primaryCover(env: Env, primaryId: number): Promise<{ ok: true; tier: string; status: string } | { ok: false; error: 'primary_unavailable' | 'primary_not_institutional' }> {
  const primary = await env.DB.prepare(
    `SELECT investor_tier, investor_subscription_status FROM users WHERE id = ?`
  ).bind(primaryId).first<{ investor_tier: string | null; investor_subscription_status: string | null }>();
  if (!primary) return { ok: false, error: 'primary_unavailable' };
  const tier = (primary.investor_tier ?? 'free').toLowerCase();
  const status = (primary.investor_subscription_status ?? 'free').toLowerCase();
  // D1052: past_due is Stripe still retrying, and keeps the plan's seats.
  const lapsed = status === 'cancelled' || status === 'unpaid';
  if (tier !== 'institutional' || lapsed) return { ok: false, error: 'primary_not_institutional' };
  return { ok: true, tier, status };
}

/** `ab***@firm.com` — enough for the holder of a link to see it was not theirs. */
export function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

async function listOwned(c: any) {
  const user = (await requireAuth(c)) as InvestorUser;
  const rows = await c.env.DB.prepare(
    `SELECT id, seat_email, seat_user_id, invited_at, accepted_at, revoked_at
     FROM investor_seats WHERE primary_user_id = ?
     ORDER BY invited_at DESC`
  ).bind(user.id).all();
  const seatsOut = (rows.results || []).map((row: Record<string, unknown>) => seatForInviter(row));
  return c.json({
    seats: seatsOut,
    cap: INVESTOR_QUOTAS.institutional.seats,
    used: seatsOut.filter((s: { state: string }) => s.state !== 'revoked').length,
  });
}
// The client calls `/investor-seats/`. Hono does not treat that as `/`.
seats.get('/', listOwned);
seats.get('', listOwned);

seats.post('/invite', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  // Only the Institutional *primary buyer* can invite. Seat colleagues
  // (rows with investor_seat_primary_user_id set) inherit the tier but
  // MUST NOT be able to issue further invites — otherwise they could
  // multiply seats beyond purchased entitlement.
  if (user.investor_seat_primary_user_id != null && user.role !== 'admin') {
    return c.json({
      error: 'forbidden',
      message: 'Seat colleagues cannot invite additional seats. Ask the account owner.',
    }, 403);
  }
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
  if (!EMAIL_RE.test(email)) return c.json({ error: 'invalid_email', message: 'Enter a valid email address.' }, 400);

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
    if (/UNIQUE/i.test(msg)) return c.json({ error: 'already_invited', message: 'This address already has a seat on your plan.' }, 409);
    throw e;
  }
  await c.env.DB.prepare(
    `UPDATE users SET investor_seat_count = investor_seat_count + 1 WHERE id = ?`
  ).bind(user.id).run();
  const created = await c.env.DB.prepare(
    `SELECT id FROM investor_seats WHERE primary_user_id = ? AND seat_email = ?`
  ).bind(user.id, email).first<{ id: number }>();

  const invite_link = inviteLink(c.env, token);
  const email_sent = await emailSeatInvite(c.env, email, user.name || 'An investor', invite_link);
  await logSeatAct(c.env, user, 'investor_seat_invited', { seat_id: created?.id ?? null, email_sent });
  // D632 — the only reply that ever carries the link. The list does not.
  return c.json({ ok: true, id: created?.id ?? null, email, email_sent, invite_link });
});

/**
 * D632 — what the invitation offers, read by the person holding its link,
 * before anything changes. The token is a body field, not a path or query
 * part, so it stays out of request logs. Read-only: no row is written.
 *
 * `state` is one of `open`, `revoked`, `accepted`, `wrong_account`,
 * `plan_lapsed`. The invited address is shown only masked, and only to a
 * signed-in account it was not sent to.
 */
seats.post('/invitation', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const body = await c.req.json().catch(() => ({} as { token?: string }));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ error: 'token_required', message: 'This invitation link is missing its token.' }, 400);
  const seat = await c.env.DB.prepare(
    `SELECT s.id, s.primary_user_id, s.seat_email, s.seat_user_id, s.accepted_at, s.revoked_at,
            u.name AS inviter_name
     FROM investor_seats s LEFT JOIN users u ON u.id = s.primary_user_id
     WHERE s.invite_token = ?`
  ).bind(token).first<{
    id: number; primary_user_id: number; seat_email: string; seat_user_id: number | null;
    accepted_at: string | null; revoked_at: string | null; inviter_name: string | null;
  }>();
  if (!seat) return c.json({ error: 'invalid_token', message: 'This invitation link is not valid. Ask the inviter for a new one.' }, 404);

  // The firm name is the inviter's investor profile. A missing row is "not
  // recorded"; a read that fails is said apart from that, never as a blank.
  let firm: string | null = null;
  let firm_readable = true;
  try {
    const p = await c.env.DB.prepare(
      `SELECT firm_name FROM investor_profiles WHERE user_id = ?`
    ).bind(seat.primary_user_id).first<{ firm_name: string | null }>();
    firm = p?.firm_name ? String(p.firm_name) : null;
  } catch {
    firm_readable = false;
  }

  const mine = String(seat.seat_email).toLowerCase() === String(user.email || '').toLowerCase();
  let state: string;
  if (seat.revoked_at) state = 'revoked';
  else if (seat.accepted_at) state = 'accepted';
  else if (!mine) state = 'wrong_account';
  else state = (await primaryCover(c.env, seat.primary_user_id)).ok ? 'open' : 'plan_lapsed';

  return c.json({
    state,
    inviter: { name: seat.inviter_name || null, firm, firm_readable },
    yours: seat.accepted_at != null && seat.seat_user_id === user.id,
    role: user.role,
    ...(state === 'wrong_account' ? { invited_email: maskEmail(seat.seat_email) } : {}),
  });
});

seats.post('/accept', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const body = await c.req.json().catch(() => ({} as { token?: string; confirm_role_change?: boolean }));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ error: 'token_required', message: 'This invitation link is missing its token.' }, 400);

  const seat = await c.env.DB.prepare(
    `SELECT id, primary_user_id, seat_email, accepted_at, revoked_at
     FROM investor_seats WHERE invite_token = ?`
  ).bind(token).first<{
    id: number; primary_user_id: number; seat_email: string;
    accepted_at: string | null; revoked_at: string | null;
  }>();
  if (!seat) return c.json({ error: 'invalid_token', message: 'This invitation link is not valid. Ask the inviter for a new one.' }, 404);
  if (seat.revoked_at) return c.json({ error: 'invite_revoked', message: 'The inviter revoked this seat. Ask them for a new link.' }, 410);
  if (seat.accepted_at) return c.json({ error: 'already_accepted', message: 'This seat has already been accepted.' }, 409);
  if (seat.seat_email.toLowerCase() !== String(user.email).toLowerCase()) {
    return c.json({ error: 'email_mismatch', message: 'This invitation was sent to a different email address. Sign in with that account.' }, 403);
  }

  // Mirror primary's tier onto the seat user so paywall checks pass.
  // Fail-CLOSED: if the primary row is missing, or no longer Institutional,
  // or has lapsed (cancelled/unpaid; D1052 keeps past_due), reject the acceptance — a
  // stale invite must never grant paid access on its own.
  const cover = await primaryCover(c.env, seat.primary_user_id);
  if (!cover.ok && cover.error === 'primary_unavailable') return c.json({ error: 'primary_unavailable', message: 'The inviting account no longer exists.' }, 410);
  if (!cover.ok) {
    return c.json({
      error: 'primary_not_institutional',
      message: 'The inviting account is no longer on an active Institutional plan.',
    }, 410);
  }
  // An admin keeps the admin role. Accepting must not turn them into an investor.
  if (String(user.role) === 'admin') {
    return c.json({
      error: 'admin_cannot_take_seat',
      message: 'An admin account cannot take a colleague seat.',
    }, 409);
  }
  // Anyone who is not already an investor changes role. That is said, then confirmed.
  if (String(user.role) !== 'investor' && body.confirm_role_change !== true) {
    return c.json({
      error: 'role_change_needs_confirmation',
      role: user.role,
      message: `Accepting this seat changes your ${user.role} account into an investor account.`,
    }, 409);
  }
  const inheritedTier = cover.tier;
  const inheritedStatus = cover.status;
  // D632 — the token stays on the row, so the same link later reads "already
  // accepted" rather than "not valid". `accepted_at` is what keeps it single-use.
  await c.env.DB.prepare(
    `UPDATE investor_seats SET seat_user_id = ?, accepted_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(user.id, seat.id).run();
  await c.env.DB.prepare(
    `UPDATE users SET investor_seat_primary_user_id = ?,
                       role = 'investor',
                       investor_tier = ?,
                       investor_subscription_status = ?
     WHERE id = ?`
  ).bind(seat.primary_user_id, inheritedTier, inheritedStatus, user.id).run();
  await logSeatAct(c.env, user, 'investor_seat_accepted', { seat_id: seat.id, primary_user_id: seat.primary_user_id, previous_role: user.role });
  return c.json({ ok: true, primary_user_id: seat.primary_user_id, tier: inheritedTier });
});

seats.delete('/:id', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad_id', message: 'That seat id is not valid.' }, 400);
  const seat = await c.env.DB.prepare(
    `SELECT id, primary_user_id, seat_user_id, revoked_at FROM investor_seats WHERE id = ?`
  ).bind(id).first<{ id: number; primary_user_id: number; seat_user_id: number | null; revoked_at: string | null }>();
  if (!seat) return c.json({ error: 'not_found', message: 'That seat does not exist.' }, 404);
  if (seat.primary_user_id !== user.id && user.role !== 'admin') {
    return c.json({ error: 'forbidden', message: 'Only the account that bought the plan can revoke its seats.' }, 403);
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
  await logSeatAct(c.env, user, 'investor_seat_revoked', { seat_id: id, had_accepted: seat.seat_user_id != null });
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
       AND datetime(investor_trial_ends_at) <= datetime('now')`
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
