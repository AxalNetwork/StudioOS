/**
 * Task #8 (X-1) — Admin endpoints for the partner deal engine.
 *
 * Mounted at `/api/admin/partners` (separate from the legacy
 * `/api/partners` directory). All endpoints require admin auth.
 *
 * Endpoints:
 *   POST   /invitations            — create + email a partner invitation
 *   GET    /invitations            — list invitations: search, filters, sort, pages, total (D926)
 *   GET    /invitations/lookup     — an open invitation and a member for one address (D926)
 *   (D927: GET /overview, GET /invitations/:id and GET /offers/preview are in
 *   admin_partners_reads.ts, mounted beside this router.)
 *   POST   /invitations/:id/resend — re-send the magic-link email
 *   POST   /invitations/:id/revoke — revoke an unsigned invitation
 *   GET    /deals                  — list deals: states, search, filters, sort, pages, total (D926)
 *   POST   /deals/:id/terminate    — terminate an active deal
 *   GET    /links                  — partner accounts and firms, unattached first
 *   POST   /links                  — attach (or detach) one account to one firm
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireBranchNotSuspended } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { sendPartnerInvitationEmailResult } from '../services/email';
import { ALL_PARTNER_DEAL_TYPES, activatePartnerDealOnSignature, type PartnerDealType } from '../services/partnerDeals';
import { ensurePartnerDirectoryColumns } from '../services/partnerDirectorySchema';
// Task #43 — revocation paths must drop investor_dealroom_max to the
// free-tier cap, not the hardcoded `5` (which is the *professional* cap).
// Sourcing the value from INVESTOR_QUOTAS keeps the column in sync with
// the user's actual tier even if the free cap shifts later.
import { INVESTOR_QUOTAS } from '../middleware/requireInvestorTier';
import { clampLimit, parseOffset } from '../util/pagination';
import { likeNeedleLower } from '../util/likeSearch';
import { renewPartnerInvitationSigningLink } from './esign';
import { clientIp } from '../util/clientIp';

const admin_partners = new Hono<{ Bindings: Env }>();

const INVITE_TTL_DAYS = 14;

function genInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function appUrl(env: Env): string {
  return env.APP_URL || 'https://axal.vc';
}

// ---------- Invitations ----------

admin_partners.post('/invitations', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.recipient_email || '').trim().toLowerCase();
  const name = String(body.recipient_name || '').trim();
  const personalMessage = String(body.personal_message || '').slice(0, 2000);
  const allowedRaw = Array.isArray(body.allowed_deal_types) ? body.allowed_deal_types : [];
  const allowed = [...new Set<string>(allowedRaw
    .map((t: unknown) => String(t).toLowerCase())
    .filter((t: string) => (ALL_PARTNER_DEAL_TYPES as string[]).includes(t)))] as PartnerDealType[];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json({ error: 'Valid recipient_email required' }, 400);
  }
  if (allowed.length === 0) {
    return c.json({ error: 'allowed_deal_types must include at least one valid type', valid: ALL_PARTNER_DEAL_TYPES }, 400);
  }

  if (allowed.length > 3) return c.json({ error: 'too_many_deal_types' }, 400);

  const token = genInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000).toISOString();

  const ins: any = await c.env.DB.prepare(
    `INSERT INTO partner_invitations
       (token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types,
        personal_message, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  ).bind(
    token, email, name || null, admin.id, JSON.stringify(allowed),
    personalMessage || null, expiresAt,
  ).first();

  const invitationId = Number(ins.id);
  const link = `${appUrl(c.env)}/partners/onboard?token=${token}`;
  const sendResult = await sendPartnerInvitationEmailResult(
    c.env, email, name, admin.name || 'Axal VC', link, personalMessage,
  );

  const emailSent = sendResult.ok;
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET last_sent_at = ?, send_count = 1, last_send_ok = ?, last_send_reason = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), emailSent ? 1 : 0, sendResult.reason, invitationId).run();

  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_created', {
    invitation_id: invitationId, recipient_email: email, allowed_deal_types: allowed,
    email_sent: emailSent,
  });

  return c.json({
    id: invitationId, token, link, expires_at: expiresAt,
    email_sent: emailSent, allowed_deal_types: allowed,
  }, 201);
});

/**
 * D926 (#2722) — the Invitations list, searched, filtered, sorted and paged
 * here, with an exact `total`. STATIC SQL: every filter is a bound value that
 * is NULL when it was not asked for, and the sort is a bound `CASE ?9`, so no
 * request text is ever spliced into a statement (the `apiUsageReport.ts`
 * shape).
 *
 *   ?1  now, as ISO — Lapsed and "sent within" are measured from it
 *   ?2  q: a name-or-email LIKE pattern, wildcards escaped
 *   ?3  stage: a JSON array of D923 §2's stored words and `lapsed`
 *   ?4  deal_type: one of the types the invitation offered (its first three)
 *   ?5  invited_by: a user id
 *   ?6  sent_within: days since the first send
 *   ?7  status (today's exact stored-status filter)
 *   ?8  email (today's address filter, D924's escaping)
 *   ?9  sort, ?10 limit and ?11 offset, on the page only; the count binds ?1–?8
 *
 * LAPSED is D923's rule and D924's: the link's `expires_at` has passed and
 * the invitation is not Signed, Revoked or a stored `expired`. Nothing writes
 * it; it is computed on each read. A lapsed row answers to `lapsed` and not to
 * its stored stage, as its pill says (the page's `STAGE_CHIPS`).
 */
const INVITATION_FILTERED = `
  WITH f AS (
    SELECT pi.id, pi.token, pi.recipient_email, pi.recipient_name, pi.allowed_deal_types,
           pi.status, pi.expires_at, pi.created_at, pi.viewed_at, pi.signed_at,
           pi.resulting_user_id, pi.resulting_deal_id, pi.envelope_id, pi.revoked_at,
           pi.last_sent_at, pi.send_count, pi.last_send_ok, pi.last_send_reason,
           pi.invited_by_user_id, u.name AS invited_by_name,
           CASE WHEN pi.status NOT IN ('signed','revoked','expired')
                 AND julianday(pi.expires_at) < julianday(?1) THEN 1 ELSE 0 END AS lapsed_now
      FROM partner_invitations pi
      LEFT JOIN users u ON u.id = pi.invited_by_user_id
     WHERE (?7 IS NULL OR pi.status = ?7)
       AND (?8 IS NULL OR LOWER(pi.recipient_email) LIKE ?8 ESCAPE '\\')
       AND (?2 IS NULL OR LOWER(COALESCE(pi.recipient_name, '')) LIKE ?2 ESCAPE '\\'
                       OR LOWER(pi.recipient_email) LIKE ?2 ESCAPE '\\')
       AND (?4 IS NULL OR EXISTS (
             SELECT 1 FROM json_each(CASE WHEN json_valid(pi.allowed_deal_types) THEN pi.allowed_deal_types ELSE '[]' END) t
              WHERE t.type = 'text' AND CAST(t.key AS INTEGER) < 3 AND LOWER(t.value) = ?4))
       AND (?5 IS NULL OR pi.invited_by_user_id = ?5)
       AND (?6 IS NULL OR julianday(pi.created_at) >= julianday(?1) - ?6)
  )
  SELECT * FROM f
   WHERE (?3 IS NULL OR (CASE WHEN f.lapsed_now = 1 THEN 'lapsed' ELSE f.status END)
                        IN (SELECT value FROM json_each(?3)))`;

const INVITATION_PAGE_SQL = `SELECT * FROM (` + INVITATION_FILTERED + `) AS g
   ORDER BY
     CASE WHEN ?9 IN ('oldest_open', 'expires_soonest')
          THEN CASE WHEN g.status IN ('signed','revoked','expired') THEN 1 ELSE 0 END END,
     CASE WHEN ?9 = 'oldest_open' THEN julianday(g.created_at) END ASC,
     CASE WHEN ?9 = 'expires_soonest' THEN julianday(g.expires_at) END ASC,
     CASE WHEN ?9 = 'name' THEN CASE WHEN TRIM(COALESCE(g.recipient_name, '')) = '' THEN 1 ELSE 0 END END,
     CASE WHEN ?9 = 'name' THEN LOWER(TRIM(g.recipient_name)) END ASC,
     CASE WHEN ?9 = 'name' THEN LOWER(g.recipient_email) END ASC,
     CASE WHEN ?9 = 'stage' THEN
       CASE WHEN g.status = 'signed' THEN 8
            WHEN g.status IN ('revoked','expired') THEN 10
            WHEN g.lapsed_now = 1 THEN 9
            WHEN g.status = 'sent' THEN 1 WHEN g.status = 'viewed' THEN 2
            WHEN g.status = 'profiled' THEN 3 WHEN g.status = 'proposed' THEN 4
            WHEN g.status = 'selected' THEN 5 WHEN g.status = 'finalized' THEN 6
            ELSE 11 END END ASC,
     julianday(g.created_at) DESC, g.id DESC
   LIMIT ?10 OFFSET ?11`;

const INVITATION_COUNT_SQL = `SELECT COUNT(*) AS n FROM (` + INVITATION_FILTERED + `) AS g`;

/** D923 §2's stored stages, and `lapsed`, which is computed. */
export const INVITATION_STAGES = ['sent', 'viewed', 'profiled', 'proposed', 'selected', 'finalized', 'signed', 'revoked', 'expired', 'lapsed'] as const;
export const INVITATION_SORTS = ['newest', 'oldest_open', 'expires_soonest', 'name', 'stage'] as const;
/** Today's cap when a caller sends no `limit`; an asked-for page is at most 100 rows. */
const LIST_DEFAULT_LIMIT = 200;
const PAGE_MAX = 100;
const WITHIN_MAX_DAYS = 3650;

/** Repeated and comma-separated values alike: `?stage=sent&stage=viewed` or `?stage=sent,viewed`. */
function manyOf(c: any, name: string): string[] | null {
  const raw: string[] = c.req.queries(name) || [];
  const out = raw.flatMap((v) => String(v).split(',')).map((v) => v.trim().toLowerCase()).filter(Boolean);
  return out.length ? [...new Set(out)] : null;
}

/**
 * A `LIKE ? ESCAPE '\'` pattern for a free-text search, or null when blank.
 * `likeNeedleLower` escapes `%` and `_`; the backslash is escaped first, so a
 * search for a literal `\` matches a backslash and nothing else.
 */
function searchPattern(raw: unknown): string | null {
  return likeNeedleLower(String(raw ?? '').replace(/\\/g, '\\\\'), 1);
}

/** A positive whole number of at most `max`; `undefined` when absent, `null` when malformed. */
function wholeParam(raw: string | undefined, max: number): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/** `limit` and `offset`: today's 200 when no limit is asked for, else at most 100. */
function pageParams(c: any): { limit: number; offset: number } {
  const raw = c.req.query('limit');
  const limit = raw === undefined ? LIST_DEFAULT_LIMIT : clampLimit(raw, PAGE_MAX, PAGE_MAX);
  return { limit, offset: parseOffset(c.req.query('offset')) };
}

admin_partners.get('/invitations', async (c) => {
  await requireAdmin(c);
  const status = c.req.query('status') || null;
  const emailQ = c.req.query('email');
  const emailLike = emailQ ? `%${emailQ.toLowerCase().replace(/[\\%_]/g, m => `\\${m}`)}%` : null;

  const stages = manyOf(c, 'stage');
  if (stages && stages.some((s) => !(INVITATION_STAGES as readonly string[]).includes(s))) {
    return c.json({ error: 'unknown_stage', valid: INVITATION_STAGES }, 400);
  }
  const dealType = (c.req.query('deal_type') || '').trim().toLowerCase() || null;
  if (dealType && !(ALL_PARTNER_DEAL_TYPES as string[]).includes(dealType)) {
    return c.json({ error: 'unknown_deal_type', valid: ALL_PARTNER_DEAL_TYPES }, 400);
  }
  const invitedBy = wholeParam(c.req.query('invited_by'), Number.MAX_SAFE_INTEGER);
  if (invitedBy === null) return c.json({ error: 'invited_by must be a user id' }, 400);
  const sentWithin = wholeParam(c.req.query('sent_within'), WITHIN_MAX_DAYS);
  if (sentWithin === null) return c.json({ error: `sent_within must be 1 to ${WITHIN_MAX_DAYS} days` }, 400);
  const sort = (c.req.query('sort') || 'newest').trim().toLowerCase();
  if (!(INVITATION_SORTS as readonly string[]).includes(sort)) {
    return c.json({ error: 'unknown_sort', valid: INVITATION_SORTS }, 400);
  }
  const { limit, offset } = pageParams(c);

  const filters = [
    new Date().toISOString(), searchPattern(c.req.query('q')), stages ? JSON.stringify(stages) : null,
    dealType, invitedBy ?? null, sentWithin ?? null, status, emailLike,
  ];
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(INVITATION_PAGE_SQL).bind(...filters, sort, limit, offset).all(),
    c.env.DB.prepare(INVITATION_COUNT_SQL).bind(...filters).first<{ n: number }>(),
  ]);
  const items = (rows.results || []).map(({ lapsed_now: _lapsed, ...r }: any) => ({
    ...r,
    allowed_deal_types: safeJsonArray(r.allowed_deal_types),
    link: `${appUrl(c.env)}/partners/onboard?token=${r.token}`,
    is_expired: !['signed', 'revoked'].includes(r.status) && new Date(r.expires_at).getTime() < Date.now(),
  }));
  return c.json({ items, total: Number(count?.n ?? 0), limit, offset, sort });
});

/**
 * D926 (#2722) — the create lookup, for PI4's two warnings: an open invitation
 * to this address ("Open it instead?", a warning, never a refusal) and a
 * member who owns it. An exact, lower-cased match. It answers the member's
 * role and nothing else about the account. A lapsed invitation is open here,
 * because a resend reopens it (D923 §3); Signed, Revoked and a stored
 * `expired` are not.
 */
admin_partners.get('/invitations/lookup', async (c) => {
  await requireAdmin(c);
  const email = String(c.req.query('email') || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ error: 'Valid email required' }, 400);
  const [open, member] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, created_at FROM partner_invitations
        WHERE LOWER(recipient_email) = ? AND status NOT IN ('signed','revoked','expired')
        ORDER BY julianday(created_at) DESC, id DESC LIMIT 1`,
    ).bind(email).first<{ id: number; created_at: string }>(),
    c.env.DB.prepare(`SELECT role FROM users WHERE LOWER(email) = ? LIMIT 1`).bind(email).first<{ role: string }>(),
  ]);
  return c.json({
    open_invitation: open ? { id: Number(open.id), created_at: open.created_at } : null,
    member: member ? { role: member.role } : null,
  });
});

admin_partners.post('/invitations/:id/resend', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const id = parseInt(c.req.param('id'), 10);
  const inv: any = await c.env.DB.prepare(
    `SELECT * FROM partner_invitations WHERE id = ?`,
  ).bind(id).first();
  if (!inv) return c.json({ error: 'Invitation not found' }, 404);
  if (inv.status === 'signed') return c.json({ error: 'Already signed' }, 409);
  if (inv.status === 'revoked') return c.json({ error: 'Invitation has been revoked' }, 409);

  // Bump expiry on resend so the recipient gets a fresh 14-day window.
  const newExpires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000).toISOString();
  const extended = await c.env.DB.prepare(
    `UPDATE partner_invitations SET expires_at = ? WHERE id = ? AND status NOT IN ('signed','revoked')`,
  ).bind(newExpires, id).run();
  if (!extended.meta?.changes) {
    const current: any = await c.env.DB.prepare('SELECT status FROM partner_invitations WHERE id = ?').bind(id).first();
    if (!current) return c.json({ error: 'Invitation not found' }, 404);
    return current.status === 'signed'
      ? c.json({ error: 'Already signed' }, 409)
      : c.json({ error: 'Invitation has been revoked' }, 409);
  }

  const link = `${appUrl(c.env)}/partners/onboard?token=${inv.token}`;
  const renewed = inv.envelope_id
    ? await renewPartnerInvitationSigningLink(c.env, id, admin, newExpires, clientIp(c.req.raw))
    : null;
  if (!renewed) {
    // Renewal can lose a race with revocation. Do not turn that refusal into
    // an onboarding email for a link that is no longer usable.
    const current: any = await c.env.DB.prepare('SELECT status FROM partner_invitations WHERE id = ?').bind(id).first();
    if (!current) return c.json({ error: 'Invitation not found' }, 404);
    if (current.status === 'signed') return c.json({ error: 'Already signed' }, 409);
    if (current.status === 'revoked') return c.json({ error: 'Invitation has been revoked' }, 409);
  }
  const sendResult = renewed ?? await sendPartnerInvitationEmailResult(
    c.env, inv.recipient_email, inv.recipient_name || '',
    admin.name || 'Axal VC', link, inv.personal_message || '',
  );
  const emailSent = sendResult.ok;
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET last_sent_at = ?, send_count = send_count + 1, last_send_ok = ?, last_send_reason = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), emailSent ? 1 : 0, sendResult.reason, id).run();

  // D927: say whether the pending signing link was renewed. null: no partner
  // signature was pending, so the onboarding email went instead. not_renewed:
  // the renewal email failed and the link already in the inbox was restored.
  const signingLink: 'renewed' | 'not_renewed' | null = renewed ? (renewed.ok ? 'renewed' : 'not_renewed') : null;
  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_resent', {
    invitation_id: id, email_sent: emailSent, signing_link: signingLink,
  });
  return c.json({ ok: true, email_sent: emailSent, link, expires_at: newExpires, signing_link: signingLink });
});

admin_partners.post('/invitations/:id/revoke', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').slice(0, 500);
  const upd = await c.env.DB.prepare(
    `UPDATE partner_invitations
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_by_user_id = ?
      WHERE id = ? AND status NOT IN ('signed','revoked')`,
  ).bind(admin.id, id).run();
  if ((upd.meta?.changes || 0) === 0) {
    return c.json({ error: 'Cannot revoke (already signed, already revoked, or not found)' }, 409);
  }

  // Proactively invalidate any downstream signing path. If the
  // recipient already finalized a proposal, an envelope exists with
  // a long-lived signing token in their inbox; flip both the deal
  // and the envelope/recipient to a non-completable state so the
  // stale token can't activate the deal post-revocation. Activation
  // also re-checks invitation status as belt-and-braces.
  const failures: Array<{ step: string; envelope_id?: number }> = [];
  let voidedDeals = 0;
  let voidedEnvelopes = 0;
  try {
    const dr = await c.env.DB.prepare(
      `UPDATE partner_deals SET status = 'voided', void_reason = 'admin_revoked'
         WHERE invitation_id = ?
           AND status IN ('proposed','awaiting_signature')`,
    ).bind(id).run();
    voidedDeals = dr.meta?.changes || 0;

    const envIds: any = await c.env.DB.prepare(
      `SELECT envelope_id FROM partner_deals
         WHERE invitation_id = ? AND envelope_id IS NOT NULL`,
    ).bind(id).all();
    for (const row of (envIds?.results || []) as any[]) {
      try {
        const er = await c.env.DB.prepare(
          `UPDATE esign_envelopes SET status = 'voided'
             WHERE id = ? AND status NOT IN ('completed','voided')`,
        ).bind(row.envelope_id).run();
        if ((er.meta?.changes || 0) > 0) voidedEnvelopes += 1;
        await c.env.DB.prepare(
          `UPDATE esign_recipients SET status = 'declined'
             WHERE envelope_id = ? AND status NOT IN ('signed','declined')`,
        ).bind(row.envelope_id).run().catch(() => { failures.push({ step: 'decline_recipients', envelope_id: row.envelope_id }); });
      } catch { failures.push({ step: 'void_envelope', envelope_id: row.envelope_id }); }
    }
  } catch { failures.push({ step: 'revoke_cascade' }); }

  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_revoked', {
    invitation_id: id, reason,
    voided_deals: voidedDeals, voided_envelopes: voidedEnvelopes, failures,
  });
  return c.json({ ok: true, voided_deals: voidedDeals, voided_envelopes: voidedEnvelopes, failures });
});

// ---------- Deals ----------

// Task #26 — Top deals by referral redemptions (admin operational counter).
// Used by the admin Partner Invitations page to surface which active deals
// are driving the most network growth. `status` defaults to 'active'; pass
// `status=all` to rank across every lifecycle state. `limit` is clamped 1..50.
admin_partners.get('/deals/top', async (c) => {
  await requireAdmin(c);
  const limit = clampLimit(c.req.query('limit'), 10, 50);
  const status = c.req.query('status') || 'active';
  const where = status === 'all' ? '' : 'WHERE pd.status = ?';
  const binds: unknown[] = status === 'all' ? [limit] : [status, limit];
  const rows = await c.env.DB.prepare(
    `SELECT pd.id, pd.deal_type, pd.referral_code, pd.granted_tier_founder,
            pd.granted_tier_investor, pd.status, pd.expires_at, pd.activated_at,
            pd.created_at, u.email AS partner_email, u.name AS partner_name,
            (SELECT COUNT(*) FROM partner_referral_redemptions WHERE partner_deal_id = pd.id) AS redemptions_count
       FROM partner_deals pd
       LEFT JOIN users u ON u.id = pd.user_id
       ${where}
      ORDER BY redemptions_count DESC, pd.created_at DESC
      LIMIT ?`,
  ).bind(...binds).all();
  return c.json({ items: rows.results || [], status, limit });
});

// Task #26 — Per-deal redemption drill-down. Lists every user who has
// redeemed this deal's referral code, with the date and granted tiers.
// For `deal_sourcing_revshare` deals, each redemption also returns
// `revshare_window_remaining_days` — days left in the 365-day attribution
// window measured from the redemption date (intro). Returns 0 once expired.
admin_partners.get('/deals/:id/redemptions', async (c) => {
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const deal: any = await c.env.DB.prepare(
    `SELECT pd.id, pd.deal_type, pd.referral_code, pd.expires_at, pd.status,
            pd.granted_tier_founder, pd.granted_tier_investor,
            u.email AS partner_email, u.name AS partner_name
       FROM partner_deals pd
       LEFT JOIN users u ON u.id = pd.user_id
      WHERE pd.id = ?`,
  ).bind(id).first();
  if (!deal) return c.json({ error: 'Deal not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT prr.id, prr.redeemed_at, prr.granted_tier_founder, prr.granted_tier_investor,
            prr.granted_until, prr.attribution_kind,
            u.id AS user_id, u.name AS redeemer_name, u.email AS redeemer_email
       FROM partner_referral_redemptions prr
       LEFT JOIN users u ON u.id = prr.redeemed_by_user_id
      WHERE prr.partner_deal_id = ?
      ORDER BY prr.redeemed_at DESC LIMIT 500`,
  ).bind(id).all();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM partner_referral_redemptions WHERE partner_deal_id = ?`,
  ).bind(id).first<{ n: number }>();
  const isRevshare = String(deal.deal_type) === 'deal_sourcing_revshare';
  const ATTRIBUTION_DAYS = 365;
  const now = Date.now();
  const items = (rows.results || []).map((r: any) => {
    let revshareWindowRemainingDays: number | null = null;
    if (isRevshare && r.redeemed_at) {
      const t = new Date(r.redeemed_at).getTime();
      if (Number.isFinite(t)) {
        const end = t + ATTRIBUTION_DAYS * 86400 * 1000;
        revshareWindowRemainingDays = Math.max(0, Math.ceil((end - now) / 86400000));
      }
    }
    return { ...r, revshare_window_remaining_days: revshareWindowRemainingDays };
  });

  return c.json({
    deal: {
      id: deal.id, deal_type: deal.deal_type, referral_code: deal.referral_code,
      expires_at: deal.expires_at, status: deal.status,
      granted_tier_founder: deal.granted_tier_founder,
      granted_tier_investor: deal.granted_tier_investor,
      partner_email: deal.partner_email, partner_name: deal.partner_name,
    },
    items,
    redemptions_count: items.length,
    redemptions_total: Number(total?.n || 0),
    truncated: Number(total?.n || 0) > items.length,
    revshare_attribution_days: isRevshare ? ATTRIBUTION_DAYS : null,
  });
});

/**
 * D926 (#2722) — the Deals list, searched, filtered, sorted and paged here,
 * with an exact `total`. Static SQL with bound filters, as the invitations:
 *
 *   ?1  now, as ISO — "ends within" is measured from it
 *   ?2  status: a JSON array of states, or NULL for `all`
 *   ?3  deal_type
 *   ?4  ends_within: days; only an active deal with an end date answers
 *   ?5  q: partner name, email or referral code, wildcards escaped
 *   ?6  has_redemptions: 1, or NULL
 *   ?7  sort, ?8 limit and ?9 offset, on the page only; the count binds ?1–?6
 *
 * BEFORE SIGNING, a deal has no `user_id`, so its partner's name and address
 * come from the invitation it was offered under (`invitation_id`). After
 * signing they are the account's, as today.
 */
const DEAL_FILTERED = `
  WITH f AS (
    SELECT pd.id, pd.invitation_id, pd.user_id, pd.deal_type, pd.proposal_json,
           pd.granted_tier_founder, pd.granted_tier_investor, pd.term_months,
           pd.referral_code, pd.envelope_id, pd.status, pd.activated_at,
           pd.expires_at, pd.terminated_at, pd.termination_reason, pd.created_at, pd.void_reason,
           pd.activation_error, pd.activation_failed_at, pd.activation_preserved_founder,
           pd.activation_preserved_investor, terminator.name AS terminated_by_name,
           CASE WHEN pd.user_id IS NULL THEN inv.recipient_email ELSE u.email END AS partner_email,
           CASE WHEN pd.user_id IS NULL THEN inv.recipient_name ELSE u.name END AS partner_name,
           (SELECT COUNT(*) FROM partner_referral_redemptions WHERE partner_deal_id = pd.id) AS redemptions_count
      FROM partner_deals pd
      LEFT JOIN users u ON u.id = pd.user_id
      LEFT JOIN users terminator ON terminator.id = pd.terminated_by_user_id
      LEFT JOIN partner_invitations inv ON inv.id = pd.invitation_id
     WHERE (?2 IS NULL OR pd.status IN (SELECT value FROM json_each(?2)))
       AND (?3 IS NULL OR pd.deal_type = ?3)
       AND (?4 IS NULL OR (pd.status = 'active' AND pd.expires_at IS NOT NULL
                           AND julianday(pd.expires_at) <= julianday(?1) + ?4))
  )
  SELECT * FROM f
   WHERE (?5 IS NULL OR LOWER(COALESCE(f.partner_name, '')) LIKE ?5 ESCAPE '\\'
                     OR LOWER(COALESCE(f.partner_email, '')) LIKE ?5 ESCAPE '\\'
                     OR LOWER(COALESCE(f.referral_code, '')) LIKE ?5 ESCAPE '\\')
     AND (?6 IS NULL OR f.redemptions_count > 0)`;

const DEAL_PAGE_SQL = `SELECT * FROM (` + DEAL_FILTERED + `) AS g
   ORDER BY
     CASE WHEN ?7 = 'ends_soonest'
          THEN CASE WHEN g.status = 'active' AND g.expires_at IS NOT NULL THEN 0 ELSE 1 END END,
     CASE WHEN ?7 = 'ends_soonest' AND g.status = 'active' THEN julianday(g.expires_at) END ASC,
     CASE WHEN ?7 = 'most_redemptions' THEN g.redemptions_count END DESC,
     CASE WHEN ?7 = 'partner'
          THEN CASE WHEN TRIM(COALESCE(g.partner_name, g.partner_email, '')) = '' THEN 1 ELSE 0 END END,
     CASE WHEN ?7 = 'partner' THEN LOWER(COALESCE(NULLIF(TRIM(g.partner_name), ''), g.partner_email)) END ASC,
     julianday(g.created_at) DESC, g.id DESC
   LIMIT ?8 OFFSET ?9`;

const DEAL_COUNT_SQL = `SELECT COUNT(*) AS n FROM (` + DEAL_FILTERED + `) AS g`;

/** partner_deals' six states (the vocabulary note at terminate). */
export const DEAL_STATES = ['proposed', 'awaiting_signature', 'active', 'terminated', 'expired', 'voided'] as const;
export const DEAL_SORTS = ['newest', 'ends_soonest', 'most_redemptions', 'partner'] as const;

admin_partners.get('/deals', async (c) => {
  await requireAdmin(c);
  // Today's call sends one state, or none for Active. `all` matches every state;
  // it used to be bound as a state named "all" and match nothing.
  const asked = manyOf(c, 'status') || ['active'];
  const statuses = asked.includes('all') ? null : asked;
  if (statuses && statuses.some((s) => !(DEAL_STATES as readonly string[]).includes(s))) {
    return c.json({ error: 'unknown_status', valid: [...DEAL_STATES, 'all'] }, 400);
  }
  const dealType = (c.req.query('deal_type') || '').trim().toLowerCase() || null;
  if (dealType && !(ALL_PARTNER_DEAL_TYPES as string[]).includes(dealType)) {
    return c.json({ error: 'unknown_deal_type', valid: ALL_PARTNER_DEAL_TYPES }, 400);
  }
  const endsWithin = wholeParam(c.req.query('ends_within'), WITHIN_MAX_DAYS);
  if (endsWithin === null) return c.json({ error: `ends_within must be 1 to ${WITHIN_MAX_DAYS} days` }, 400);
  const hasRaw = (c.req.query('has_redemptions') || '').trim().toLowerCase();
  if (hasRaw && !['1', 'true', '0', 'false'].includes(hasRaw)) return c.json({ error: 'has_redemptions must be true or false' }, 400);
  const sort = (c.req.query('sort') || 'newest').trim().toLowerCase();
  if (!(DEAL_SORTS as readonly string[]).includes(sort)) return c.json({ error: 'unknown_sort', valid: DEAL_SORTS }, 400);
  const { limit, offset } = pageParams(c);

  const filters = [
    new Date().toISOString(), statuses ? JSON.stringify(statuses) : null, dealType, endsWithin ?? null,
    searchPattern(c.req.query('q')), hasRaw === '1' || hasRaw === 'true' ? 1 : null,
  ];
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(DEAL_PAGE_SQL).bind(...filters, sort, limit, offset).all(),
    c.env.DB.prepare(DEAL_COUNT_SQL).bind(...filters).first<{ n: number }>(),
  ]);
  const items = (rows.results || []).map((r: any) => ({
    ...r, proposal: safeJsonObject(r.proposal_json), proposal_json: undefined,
  }));
  return c.json({ items, total: Number(count?.n ?? 0), limit, offset, sort });
});

admin_partners.post('/deals/:id/terminate', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').slice(0, 500);
  if (!reason) return c.json({ error: 'reason is required' }, 400);

  // Snapshot the deal before termination so we can revoke tier grants.
  // NOTE on status vocabulary: partner_deals uses
  //   proposed | awaiting_signature | active | terminated | expired | voided
  // (voided = killed by admin revoke before activation). esign_recipients
  // uses pending | signing | signed | declined. Keep these enums in sync
  // when adding new transition paths.
  const deal: any = await c.env.DB.prepare(
    `SELECT id, user_id, granted_tier_founder, granted_tier_investor
       FROM partner_deals WHERE id = ? AND status = 'active'`,
  ).bind(id).first();
  if (!deal) return c.json({ error: 'Deal is not active or not found' }, 409);

  const terminated = await c.env.DB.prepare(
    `UPDATE partner_deals
        SET status = 'terminated', terminated_at = CURRENT_TIMESTAMP,
            terminated_by_user_id = ?, termination_reason = ?
      WHERE id = ? AND status = 'active'`,
  ).bind(admin.id, reason, id).run();
  if ((terminated.meta?.changes || 0) === 0) return c.json({ error: 'Deal is not active or not found' }, 409);
  const failures: Array<{ step: string; user_id?: number }> = [];
  let partnerTiersReverted = false;

  // Guard both tier and grant source: a later paid subscription is never revoked.
  const revertedMembers = new Set<number>();
  async function revert(userId: number, founder: string | null, investor: string | null, source: string, partner: boolean) {
    if (founder) {
      try {
        const r = await c.env.DB.prepare(
          `UPDATE users SET subscription_tier = 'free', subscription_status = 'partner_revoked', subscription_renews_at = NULL
           WHERE id = ? AND subscription_tier = ? AND subscription_status = ?`,
        ).bind(userId, founder, source).run();
        if ((r.meta?.changes || 0) > 0) {
          if (partner) partnerTiersReverted = true;
          else revertedMembers.add(Number(userId));
        }
      } catch { failures.push({ step: partner ? 'partner_founder_revoke' : 'redeemer_founder_revoke', user_id: userId }); }
    }
    if (investor) {
      try {
        const r = await c.env.DB.prepare(
          `UPDATE users SET investor_tier = 'free', investor_subscription_status = 'partner_revoked',
                            investor_subscription_renews_at = NULL, investor_dealroom_max = ?
           WHERE id = ? AND investor_tier = ? AND investor_subscription_status = ?`,
        ).bind(INVESTOR_QUOTAS.free.dealroom_max, userId, investor, source).run();
        if ((r.meta?.changes || 0) > 0) {
          if (partner) partnerTiersReverted = true;
          else revertedMembers.add(Number(userId));
        }
      } catch { failures.push({ step: partner ? 'partner_investor_revoke' : 'redeemer_investor_revoke', user_id: userId }); }
    }
  }
  if (deal.user_id) await revert(deal.user_id, deal.granted_tier_founder, deal.granted_tier_investor, 'partner_grant', true);
  try {
    const reds = await c.env.DB.prepare(
      `SELECT redeemed_by_user_id, granted_tier_founder, granted_tier_investor
         FROM partner_referral_redemptions WHERE partner_deal_id = ?`,
    ).bind(id).all();
    for (const r of (reds.results || []) as any[]) {
      await revert(r.redeemed_by_user_id, r.granted_tier_founder, r.granted_tier_investor, 'partner_referral', false);
    }
  } catch { failures.push({ step: 'redeemers_read' }); }
  const result = { members_revoked: revertedMembers.size, partner_tiers_reverted: partnerTiersReverted, failures };
  await logAdminAction(c.env, admin.id, admin.email, 'partner_deal_terminated', { deal_id: id, reason, ...result });
  return c.json({ ok: true, ...result });
});

// A completed signature may be retried; other lifecycle states cannot be resurrected.
admin_partners.post('/deals/:id/activate', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const deal = await c.env.DB.prepare(
    `SELECT pd.status, pd.envelope_id, e.status AS envelope_status
       FROM partner_deals pd LEFT JOIN esign_envelopes e ON e.id = pd.envelope_id WHERE pd.id = ?`,
  ).bind(id).first<{ status: string; envelope_id: number; envelope_status: string }>();
  if (!deal || deal.status !== 'awaiting_signature' || deal.envelope_status !== 'completed') {
    return c.json({ error: 'Deal must await activation of its own completed agreement' }, 409);
  }
  try {
    const result = await activatePartnerDealOnSignature(c.env, deal.envelope_id);
    await logAdminAction(c.env, admin.id, admin.email, 'partner_deal_activation_retried', { deal_id: id, activated: result?.activated || false });
    if (!result?.activated) return c.json({ error: 'Deal cannot be activated' }, 409);
    return c.json(result);
  } catch {
    await logAdminAction(c.env, admin.id, admin.email, 'partner_deal_activation_retried', { deal_id: id, failed: true });
    return c.json({ error: 'Activation failed; retry after resolving the failure', code: 'activation_failed' }, 503);
  }
});

// ---------- Service Provider Directory approval (Task #53 admin tools) ----------
//
// Admin lists every partner with their current directory_listed /
// directory_featured flags and toggles them via POST. Public
// `/api/public/partners` (see routes/public.ts) only returns rows
// where `directory_listed = 1`, so flipping `listed` to 0 removes a
// partner from /directory immediately. Featuring without listing is
// allowed by the schema but the public route hides the row anyway
// (featured-but-unlisted is treated as a soft draft).

admin_partners.get('/directory', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await ensurePartnerDirectoryColumns(c.env);
  const q = String(c.req.query('q') || '').trim().toLowerCase();
  const params: unknown[] = [];
  let where = `1=1`;
  if (q) {
    // `1`, not the helper's default: this search accepts a single character
    // today and D128 is a de-duplication, not a behaviour change.
    const like = likeNeedleLower(q, 1)!;
    where += ` AND (lower(name) LIKE ? ESCAPE '\\' OR lower(coalesce(company,'')) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')`;
    params.push(like, like, like);
  }
  const rs = await c.env.DB.prepare(
    `SELECT id, uid, name, company, email, specialization, status, referrals_count,
            COALESCE(directory_listed, 0)   AS directory_listed,
            COALESCE(directory_featured, 0) AS directory_featured,
            directory_decided_at, directory_decided_by, created_at
       FROM partners
      WHERE ${where}
      ORDER BY directory_featured DESC, directory_listed DESC,
               referrals_count DESC, name ASC
      LIMIT 500`,
  ).bind(...params).all();
  void admin;
  return c.json({ partners: rs.results || [], total: (rs.results || []).length });
});

admin_partners.post('/:id/directory', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await ensurePartnerDirectoryColumns(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid partner id' }, 400);
  const body = await c.req.json().catch(() => ({}));

  const row = await c.env.DB.prepare(
    `SELECT id, name, email,
            COALESCE(directory_listed, 0)   AS directory_listed,
            COALESCE(directory_featured, 0) AS directory_featured
       FROM partners WHERE id = ?`,
  ).bind(id).first<{
    id: number; name: string; email: string;
    directory_listed: number; directory_featured: number;
  }>();
  if (!row) return c.json({ error: 'partner not found' }, 404);

  const nextListed   = typeof body.listed   === 'boolean' ? (body.listed   ? 1 : 0) : row.directory_listed;
  // Featuring implies listed — you can't promote a partner who isn't
  // visible. The reverse is fine (listed but not featured).
  let   nextFeatured = typeof body.featured === 'boolean' ? (body.featured ? 1 : 0) : row.directory_featured;
  if (nextFeatured && !nextListed) nextFeatured = 0;

  await c.env.DB.prepare(
    `UPDATE partners
        SET directory_listed     = ?,
            directory_featured   = ?,
            directory_decided_at = datetime('now'),
            directory_decided_by = ?
      WHERE id = ?`,
  ).bind(nextListed, nextFeatured, admin.id, id).run();

  await logAdminAction(c.env, admin.id, admin.email, 'partner_directory_toggled', {
    partner_id: id, partner_name: row.name,
    listed:   { from: !!row.directory_listed,   to: !!nextListed   },
    featured: { from: !!row.directory_featured, to: !!nextFeatured },
  });

  return c.json({
    ok: true,
    partner: {
      id, listed: !!nextListed, featured: !!nextFeatured,
    },
  });
});

// ---------- Firm links ----------
//
// THE THING THE GAP CARD HAS BEEN PROMISING. Every partner surface resolves
// through `users.partner_id` and nothing else (D57), and an account without one
// gets a card saying "an admin can attach it" — which, until these two
// endpoints, nothing could do. Measured against production on 2026-09-07: 8 of
// 26 partner accounts were attached and 18 were not.
//
// EXPLICIT IDS, NEVER A MATCH. There is no search-and-guess here on purpose:
// the caller names a user and a firm, both are loaded and checked, and anything
// unresolvable is a 4xx rather than a best effort. Matching accounts to firms on
// a mutable string is the exact hole D57 closed on the read side, and rebuilding
// it on the write side with an admin's name on it would be worse, not better.
//
// PARTNER ACCOUNTS ONLY. An admin cannot attach their OWN sign-in to a firm
// here, and that is a boundary rather than an omission. Reading one firm's
// clients, quotes and engagements as an admin is impersonation — it names whose
// book is being opened and writes an `impersonation_sessions` row — which is
// the same rule `AdvisorPreviewNotice` states for the advisor half. A silent
// self-attach would be the one act with neither a subject nor an audit trail.

admin_partners.get('/links', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  void admin;
  // Unattached first: this list IS the work queue, so the rows that need a
  // decision sort above the ones that already have one.
  const accounts = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.partner_id,
            p.name AS firm_name, p.company AS firm_company
       FROM users u
       LEFT JOIN partners p ON p.id = u.partner_id
      WHERE lower(u.role) = 'partner'
      ORDER BY (u.partner_id IS NOT NULL) ASC, lower(u.email) ASC
      LIMIT 500`,
  ).all();
  // `accounts` per firm is a count and not a flag: `users.partner_id` is not
  // unique, several sign-ins may belong to one firm, and a firm with none is
  // recorded rather than deleted.
  const firms = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.company, p.email,
            (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id) AS accounts
       FROM partners p
      ORDER BY lower(p.name) ASC
      LIMIT 500`,
  ).all();
  const rows = (accounts.results || []) as Array<{ partner_id: number | null }>;
  return c.json({
    accounts: rows,
    firms: firms.results || [],
    attached: rows.filter((r) => r.partner_id != null).length,
    unattached: rows.filter((r) => r.partner_id == null).length,
  });
});

admin_partners.post('/links', async (c) => {
  const admin = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

  const userId = Number((body as { user_id?: unknown }).user_id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return c.json({ error: 'invalid user id' }, 400);
  }
  // `null` detaches, which is a real answer: a firm record that turns out to
  // belong to somebody else must be removable without inventing a replacement.
  const raw = (body as { partner_id?: unknown }).partner_id;
  const firmId = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (firmId !== null && (!Number.isFinite(firmId) || firmId <= 0)) {
    return c.json({ error: 'invalid partner id' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, role, partner_id FROM users WHERE id = ?',
  ).bind(userId).first<{ id: number; email: string; role: string; partner_id: number | null }>();
  if (!user) return c.json({ error: 'user not found' }, 404);
  if (String(user.role || '').toLowerCase() !== 'partner') {
    return c.json({
      error: 'only a partner account can be attached to a firm; read a firm as an admin by impersonating one of its accounts',
    }, 400);
  }

  let firm: { id: number; name: string } | null = null;
  if (firmId !== null) {
    firm = await c.env.DB.prepare('SELECT id, name FROM partners WHERE id = ?')
      .bind(firmId).first<{ id: number; name: string }>();
    if (!firm) return c.json({ error: 'firm not found' }, 404);
  }

  await c.env.DB.prepare('UPDATE users SET partner_id = ? WHERE id = ?')
    .bind(firmId, userId).run();

  // D159 — `target_user_id`, not `user_id`: the shared logAdminAction reads
  // that key to fill `admin_audit_log.viewed_user_id`, which is what HQ's
  // governance feed joins its Target column from. This was the one call site
  // of five that named the key differently, so attaching a person to a firm
  // would have been recorded with no subject. A guard now pins the spelling.
  await logAdminAction(c.env, admin.id, admin.email, 'partner_firm_link_set', {
    target_user_id: userId,
    from: user.partner_id ?? null,
    to: firmId,
    firm_name: firm?.name ?? null,
  });

  return c.json({ ok: true, user_id: userId, partner_id: firmId, firm_name: firm?.name ?? null });
});

function safeJsonArray(s: unknown): unknown[] {
  if (typeof s !== 'string') return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
function safeJsonObject(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export default admin_partners;
