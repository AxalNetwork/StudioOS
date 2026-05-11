/**
 * Task #9 (X-2) — Authenticated partner portal endpoints.
 *
 * Mounted at `/api/partner-portal`. The signed-in partner reads their
 * own deal terms, granted tiers, referral code, and redemption count.
 * No admin scope; the row is matched by `user_id = caller.id`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const portal = new Hono<{ Bindings: Env }>();

function safeJsonObject(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

portal.get('/my-deal', async (c) => {
  const user = await requireAuth(c);
  const deal: any = await c.env.DB.prepare(
    `SELECT id, deal_type, proposal_json, granted_tier_founder, granted_tier_investor,
            term_months, referral_code, status, activated_at, expires_at,
            terminated_at, termination_reason, created_at
       FROM partner_deals
      WHERE user_id = ?
      ORDER BY CASE status
               WHEN 'active' THEN 0
               WHEN 'awaiting_signature' THEN 1
               WHEN 'expired' THEN 2
               WHEN 'terminated' THEN 3
               ELSE 4 END, id DESC
      LIMIT 1`,
  ).bind(user.id).first();
  if (!deal) return c.json({ deal: null, redemptions_count: 0, redemptions: [] });

  const redCountRow: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM partner_referral_redemptions WHERE partner_deal_id = ?`,
  ).bind(deal.id).first();
  const redemptionRows = await c.env.DB.prepare(
    `SELECT prr.id, prr.redeemed_at, prr.granted_tier_founder, prr.granted_tier_investor,
            prr.attribution_kind, prr.granted_until,
            u.name AS redeemer_name
       FROM partner_referral_redemptions prr
       LEFT JOIN users u ON u.id = prr.redeemed_by_user_id
      WHERE prr.partner_deal_id = ?
      ORDER BY prr.redeemed_at DESC LIMIT 50`,
  ).bind(deal.id).all();

  // Task #26 — For deal_sourcing_revshare deals, surface a per-redemption
  // "attribution window remaining" counter (365 days from intro). Plain
  // referral deals just get null so the UI can hide it.
  const isRevshare = String(deal.deal_type) === 'deal_sourcing_revshare';
  const ATTRIBUTION_DAYS = 365;
  const nowMs = Date.now();
  const redemptions = {
    results: (redemptionRows.results || []).map((r: any) => {
      let revshareWindowRemainingDays: number | null = null;
      if (isRevshare && r.redeemed_at) {
        const t = new Date(r.redeemed_at).getTime();
        if (Number.isFinite(t)) {
          const end = t + ATTRIBUTION_DAYS * 86400 * 1000;
          revshareWindowRemainingDays = Math.max(0, Math.ceil((end - nowMs) / 86400000));
        }
      }
      return { ...r, revshare_window_remaining_days: revshareWindowRemainingDays };
    }),
  };

  // Task #9 (X-2) — derive concrete next milestones for the portal UI.
  // Each entry is independently displayable: { id, title, hint,
  // status: 'done'|'pending'|'upcoming', due? }. The frontend renders
  // them in a dedicated panel so the partner always sees what to do
  // next + what's been earned.
  const redemptionsCount = Number(redCountRow?.n || 0);
  const milestones: Array<{ id: string; title: string; hint?: string; status: 'done' | 'pending' | 'upcoming'; due?: string }> = [];
  const status = String(deal.status || '');
  // Signature: only "done" when the lifecycle moved past signing
  // (active / expired / terminated). proposed / awaiting_signature
  // are "pending"; voided is also "pending" (envelope was cancelled
  // and partner cannot proceed without admin re-issuance).
  const signed = status === 'active' || status === 'expired' || status === 'terminated';
  milestones.push({
    id: 'signature',
    title: 'Signature complete',
    status: signed ? 'done' : 'pending',
    hint: signed
      ? 'Your e-signature is on file.'
      : status === 'voided'
      ? 'The signing envelope was voided. Ask your admin to issue a new invitation.'
      : status === 'awaiting_signature'
      ? 'Open the envelope from your inbox to activate your tier benefits.'
      : 'Select a proposal and send it for e-signature to proceed.',
  });
  // Activation: "done" only when active; "upcoming" while still pre-
  // signature; "pending" only for terminal-but-recoverable states.
  let activationStatus: 'done' | 'pending' | 'upcoming';
  if (status === 'active') activationStatus = 'done';
  else if (status === 'proposed' || status === 'awaiting_signature') activationStatus = 'upcoming';
  else activationStatus = 'pending';
  milestones.push({
    id: 'activation',
    title: 'Tier activation',
    status: activationStatus,
    hint: status === 'active' && (deal.granted_tier_founder || deal.granted_tier_investor)
      ? `Granted: ${[deal.granted_tier_founder && `founder=${deal.granted_tier_founder}`, deal.granted_tier_investor && `investor=${deal.granted_tier_investor}`].filter(Boolean).join(', ')}`
      : status === 'expired'
      ? 'Tier benefits ended when your term expired. Contact your admin to renew.'
      : status === 'terminated'
      ? 'Tier benefits were revoked when this partnership was terminated.'
      : status === 'voided'
      ? 'Activation requires a fresh invitation from your admin.'
      : 'Tier benefits activate the moment your signature is recorded.',
  });
  milestones.push({
    id: 'first_referral',
    title: 'First referral redemption',
    status: redemptionsCount > 0 ? 'done' : 'upcoming',
    hint: redemptionsCount > 0
      ? `${redemptionsCount} ${redemptionsCount === 1 ? 'person has' : 'people have'} redeemed your code.`
      : 'Share your referral code with a founder or investor — they unlock their tier instantly when they register.',
  });
  if (deal.expires_at && status !== 'voided' && status !== 'terminated') {
    const expiresMs = new Date(deal.expires_at).getTime();
    const now = Date.now();
    const daysLeft = Math.round((expiresMs - now) / (1000 * 60 * 60 * 24));
    milestones.push({
      id: 'renewal',
      title: daysLeft > 0 ? 'Renewal window' : 'Renewal due',
      status: daysLeft > 30 ? 'upcoming' : 'pending',
      due: deal.expires_at,
      hint: daysLeft > 0
        ? `Term ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — your admin will reach out 30 days before expiry.`
        : 'Your term has ended. Contact your admin to renew.',
    });
  }

  return c.json({
    deal: { ...deal, proposal: safeJsonObject(deal.proposal_json), proposal_json: undefined },
    redemptions_count: redemptionsCount,
    redemptions: redemptions.results || [],
    revshare_attribution_days: isRevshare ? ATTRIBUTION_DAYS : null,
    next_milestones: milestones,
  });
});

export default portal;
