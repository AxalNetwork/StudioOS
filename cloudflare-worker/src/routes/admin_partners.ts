/**
 * Task #8 (X-1) — Admin endpoints for the partner deal engine.
 *
 * Mounted at `/api/admin/partners` (separate from the legacy
 * `/api/partners` directory). All endpoints require admin auth.
 *
 * Endpoints:
 *   POST   /invitations            — create + email a partner invitation
 *   GET    /invitations            — list invitations (filter by status / email)
 *   POST   /invitations/:id/resend — re-send the magic-link email
 *   POST   /invitations/:id/revoke — revoke an unsigned invitation
 *   GET    /deals                  — list active partner deals
 *   POST   /deals/:id/terminate    — terminate an active deal
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { sendPartnerInvitationEmail } from '../services/email';
import { ALL_PARTNER_DEAL_TYPES, type PartnerDealType } from '../services/partnerDeals';

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

async function logAdminAction(
  env: Env, adminId: number, adminEmail: string, action: string, details: Record<string, unknown>,
): Promise<void> {
  try {
    const actorHash = await hashEmail(adminEmail);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actorHash, adminId).run();
  } catch (e) { console.warn('[admin_partners] activity log failed', e); }
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)`,
    ).bind(adminId, action, JSON.stringify(details)).run();
  } catch (e) { /* admin_audit_log may not exist in some envs */ }
}

// ---------- Invitations ----------

admin_partners.post('/invitations', async (c) => {
  const admin = await requireAdmin(c);
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.recipient_email || '').trim().toLowerCase();
  const name = String(body.recipient_name || '').trim();
  const personalMessage = String(body.personal_message || '').slice(0, 2000);
  const allowedRaw = Array.isArray(body.allowed_deal_types) ? body.allowed_deal_types : [];
  const allowed = allowedRaw
    .map((t: unknown) => String(t).toLowerCase())
    .filter((t: string) => (ALL_PARTNER_DEAL_TYPES as string[]).includes(t)) as PartnerDealType[];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json({ error: 'Valid recipient_email required' }, 400);
  }
  if (allowed.length === 0) {
    return c.json({ error: 'allowed_deal_types must include at least one valid type', valid: ALL_PARTNER_DEAL_TYPES }, 400);
  }

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
  const emailSent = await sendPartnerInvitationEmail(
    c.env, email, name, admin.name || 'Axal VC', link, personalMessage,
  );

  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_created', {
    invitation_id: invitationId, recipient_email: email, allowed_deal_types: allowed,
    email_sent: emailSent,
  });

  return c.json({
    id: invitationId, token, link, expires_at: expiresAt,
    email_sent: emailSent, allowed_deal_types: allowed,
  }, 201);
});

admin_partners.get('/invitations', async (c) => {
  await requireAdmin(c);
  const status = c.req.query('status');
  const emailQ = c.req.query('email');
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status) { conds.push('status = ?'); params.push(status); }
  if (emailQ) { conds.push('LOWER(recipient_email) LIKE ?'); params.push(`%${emailQ.toLowerCase()}%`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT pi.id, pi.token, pi.recipient_email, pi.recipient_name, pi.allowed_deal_types,
            pi.status, pi.expires_at, pi.created_at, pi.viewed_at, pi.signed_at,
            pi.resulting_user_id, pi.resulting_deal_id, pi.envelope_id, pi.revoked_at,
            u.name AS invited_by_name
       FROM partner_invitations pi
       LEFT JOIN users u ON u.id = pi.invited_by_user_id
       ${where}
       ORDER BY pi.created_at DESC LIMIT 200`,
  ).bind(...params).all();
  const items = (rows.results || []).map((r: any) => ({
    ...r,
    allowed_deal_types: safeJsonArray(r.allowed_deal_types),
    link: `${appUrl(c.env)}/partners/onboard?token=${r.token}`,
    is_expired: new Date(r.expires_at).getTime() < Date.now(),
  }));
  return c.json({ items });
});

admin_partners.post('/invitations/:id/resend', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const inv: any = await c.env.DB.prepare(
    `SELECT * FROM partner_invitations WHERE id = ?`,
  ).bind(id).first();
  if (!inv) return c.json({ error: 'Invitation not found' }, 404);
  if (inv.status === 'signed') return c.json({ error: 'Already signed' }, 409);
  if (inv.status === 'revoked') return c.json({ error: 'Invitation has been revoked' }, 409);

  // Bump expiry on resend so the recipient gets a fresh 14-day window.
  const newExpires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET expires_at = ?, status = 'sent' WHERE id = ?`,
  ).bind(newExpires, id).run();

  const link = `${appUrl(c.env)}/partners/onboard?token=${inv.token}`;
  const emailSent = await sendPartnerInvitationEmail(
    c.env, inv.recipient_email, inv.recipient_name || '',
    admin.name || 'Axal VC', link, inv.personal_message || '',
  );

  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_resent', {
    invitation_id: id, email_sent: emailSent,
  });
  return c.json({ ok: true, email_sent: emailSent, link, expires_at: newExpires });
});

admin_partners.post('/invitations/:id/revoke', async (c) => {
  const admin = await requireAdmin(c);
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
  let voidedDeals = 0;
  let voidedEnvelopes = 0;
  try {
    const dr = await c.env.DB.prepare(
      `UPDATE partner_deals SET status = 'voided'
         WHERE invitation_id = ?
           AND status IN ('proposed','awaiting_signature')`,
    ).bind(id).run();
    voidedDeals = dr.meta?.changes || 0;

    const envIds: any = await c.env.DB.prepare(
      `SELECT envelope_id FROM partner_deals
         WHERE invitation_id = ? AND envelope_id IS NOT NULL`,
    ).bind(id).all().catch(() => ({ results: [] }));
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
        ).bind(row.envelope_id).run().catch(() => {});
      } catch (e) { console.warn('[admin_partners] void envelope failed', row.envelope_id, e); }
    }
  } catch (e) { console.warn('[admin_partners] revoke cascade failed', e); }

  await logAdminAction(c.env, admin.id, admin.email, 'partner_invitation_revoked', {
    invitation_id: id, reason,
    voided_deals: voidedDeals, voided_envelopes: voidedEnvelopes,
  });
  return c.json({ ok: true, voided_deals: voidedDeals, voided_envelopes: voidedEnvelopes });
});

// ---------- Deals ----------

admin_partners.get('/deals', async (c) => {
  await requireAdmin(c);
  const status = c.req.query('status') || 'active';
  const rows = await c.env.DB.prepare(
    `SELECT pd.id, pd.invitation_id, pd.user_id, pd.deal_type, pd.proposal_json,
            pd.granted_tier_founder, pd.granted_tier_investor, pd.term_months,
            pd.referral_code, pd.envelope_id, pd.status, pd.activated_at,
            pd.expires_at, pd.terminated_at, pd.termination_reason, pd.created_at,
            u.email AS partner_email, u.name AS partner_name,
            (SELECT COUNT(*) FROM partner_referral_redemptions WHERE partner_deal_id = pd.id) AS redemptions_count
       FROM partner_deals pd
       LEFT JOIN users u ON u.id = pd.user_id
      WHERE pd.status = ?
      ORDER BY pd.created_at DESC LIMIT 200`,
  ).bind(status).all();
  const items = (rows.results || []).map((r: any) => ({
    ...r, proposal: safeJsonObject(r.proposal_json), proposal_json: undefined,
  }));
  return c.json({ items });
});

admin_partners.post('/deals/:id/terminate', async (c) => {
  const admin = await requireAdmin(c);
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

  await c.env.DB.prepare(
    `UPDATE partner_deals
        SET status = 'terminated', terminated_at = CURRENT_TIMESTAMP,
            terminated_by_user_id = ?, termination_reason = ?
      WHERE id = ? AND status = 'active'`,
  ).bind(admin.id, reason, id).run();

  // Revoke tier grants from the partner. We only revoke if the user's
  // current tier still matches what THIS deal granted (subscription_status
  // = 'partner_grant' / 'partner_referral'), so we don't clobber a paying
  // subscription that may have replaced the grant during the deal's life.
  if (deal.user_id) {
    if (deal.granted_tier_founder) {
      try {
        await c.env.DB.prepare(
          `UPDATE users SET subscription_tier = 'free',
                              subscription_status = 'partner_revoked',
                              subscription_renews_at = NULL
             WHERE id = ?
               AND subscription_tier = ?
               AND subscription_status = 'partner_grant'`,
        ).bind(deal.user_id, deal.granted_tier_founder).run();
      } catch (e) { console.warn('[admin_partners] revoke founder tier failed', e); }
    }
    if (deal.granted_tier_investor) {
      try {
        await c.env.DB.prepare(
          `UPDATE users SET investor_tier = 'free',
                              investor_subscription_status = 'partner_revoked',
                              investor_subscription_renews_at = NULL,
                              investor_dealroom_max = 5
             WHERE id = ?
               AND investor_tier = ?
               AND investor_subscription_status = 'partner_grant'`,
        ).bind(deal.user_id, deal.granted_tier_investor).run();
      } catch (e) { console.warn('[admin_partners] revoke investor tier failed', e); }
    }
  }

  // Cascade revocation to every prior redeemer of this deal — same
  // policy as the daily expiry sweep, so termination has immediate
  // effect across the whole partner's referral chain (not just their
  // own grant). Paid upgrades that replaced a partner_referral status
  // mid-term are preserved by the status='partner_referral' guard.
  let redemptionsRevoked = 0;
  try {
    const reds: any = await c.env.DB.prepare(
      `SELECT redeemed_by_user_id, granted_tier_founder, granted_tier_investor
         FROM partner_referral_redemptions WHERE partner_deal_id = ?`,
    ).bind(id).all().catch(() => ({ results: [] }));
    for (const r of (reds?.results || []) as any[]) {
      if (r.granted_tier_founder) {
        const u = await c.env.DB.prepare(
          `UPDATE users SET subscription_tier = 'free',
                              subscription_status = 'partner_revoked',
                              subscription_renews_at = NULL
             WHERE id = ?
               AND subscription_tier = ?
               AND subscription_status = 'partner_referral'`,
        ).bind(r.redeemed_by_user_id, r.granted_tier_founder).run();
        if ((u.meta?.changes || 0) > 0) redemptionsRevoked += 1;
      }
      if (r.granted_tier_investor) {
        const u = await c.env.DB.prepare(
          `UPDATE users SET investor_tier = 'free',
                              investor_subscription_status = 'partner_revoked',
                              investor_subscription_renews_at = NULL,
                              investor_dealroom_max = 5
             WHERE id = ?
               AND investor_tier = ?
               AND investor_subscription_status = 'partner_referral'`,
        ).bind(r.redeemed_by_user_id, r.granted_tier_investor).run();
        if ((u.meta?.changes || 0) > 0) redemptionsRevoked += 1;
      }
    }
  } catch (e) { console.warn('[admin_partners] terminate redemption revoke failed', e); }

  await logAdminAction(c.env, admin.id, admin.email, 'partner_deal_terminated', {
    deal_id: id, reason,
    revoked_tier_founder: deal.granted_tier_founder,
    revoked_tier_investor: deal.granted_tier_investor,
    redemptions_revoked: redemptionsRevoked,
  });
  return c.json({
    ok: true,
    tiers_revoked: !!(deal.granted_tier_founder || deal.granted_tier_investor),
    redemptions_revoked: redemptionsRevoked,
  });
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
