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
  const redemptions = await c.env.DB.prepare(
    `SELECT prr.id, prr.redeemed_at, prr.granted_tier_founder, prr.granted_tier_investor,
            u.name AS redeemer_name
       FROM partner_referral_redemptions prr
       LEFT JOIN users u ON u.id = prr.redeemed_by_user_id
      WHERE prr.partner_deal_id = ?
      ORDER BY prr.redeemed_at DESC LIMIT 50`,
  ).bind(deal.id).all();

  return c.json({
    deal: { ...deal, proposal: safeJsonObject(deal.proposal_json), proposal_json: undefined },
    redemptions_count: Number(redCountRow?.n || 0),
    redemptions: redemptions.results || [],
  });
});

export default portal;
