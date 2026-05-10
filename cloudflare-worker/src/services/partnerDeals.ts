/**
 * Task #8 (X-1) — Partner deal engine helpers.
 *
 * Centralises:
 *   - allowed deal-type catalog + default proposals
 *   - activation/grant logic invoked by the e-sign completion hook
 *   - referral redemption invoked by /auth/register
 *
 * Kept out of routes/* so both the public onboarding routes and the
 * esign signature webhook can reach the same logic without circular
 * imports.
 */
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';

export type PartnerDealType =
  | 'equity_partnership'
  | 'services_partnership'
  | 'deal_sourcing_revshare'
  | 'capital_partnership'
  | 'custom';

export const ALL_PARTNER_DEAL_TYPES: PartnerDealType[] = [
  'equity_partnership',
  'services_partnership',
  'deal_sourcing_revshare',
  'capital_partnership',
  'custom',
];

export interface PartnerProposalDraft {
  deal_type: PartnerDealType;
  label: string;
  summary: string;
  terms: Record<string, string | number>;
  granted_tier_founder: string | null;
  granted_tier_investor: string | null;
  term_months: number;
}

export interface PartnerProfileInput {
  full_name?: string | null;
  organization?: string | null;
  role_title?: string | null;
  expertise?: string | null;
  sectors?: string | null;
  geography?: string | null;
  capacity_per_month?: string | null;
  capital_capacity_usd?: number | null;
  motivation?: string | null;
  prior_deals?: string | null;
  linkedin_url?: string | null;
  raw_chat_json?: unknown;
}

/**
 * Build 1-3 default proposals from the admin's allowed-types list and the
 * partner profile signal. Profile fields nudge term length / granted tier
 * but never invent deal types not on the admin's allow-list.
 */
export function buildProposals(
  allowedTypes: PartnerDealType[],
  profile: PartnerProfileInput,
): PartnerProposalDraft[] {
  const valid = allowedTypes.filter(t => ALL_PARTNER_DEAL_TYPES.includes(t));
  if (valid.length === 0) return [];
  const out: PartnerProposalDraft[] = [];
  const capital = Number(profile.capital_capacity_usd || 0);

  for (const t of valid.slice(0, 3)) {
    if (t === 'equity_partnership') {
      out.push({
        deal_type: t,
        label: 'Equity Partnership',
        summary: 'Long-term equity stake in Axal StudioOS in exchange for sustained venture-partner involvement.',
        terms: {
          equity_pct: '0.5%–2.0% (vested 4yr, 1yr cliff)',
          time_commitment: profile.capacity_per_month || '5–10 hrs/month',
          board_observer: 'Optional, on a per-deal basis',
        },
        granted_tier_founder: 'founder_pro',
        granted_tier_investor: 'professional',
        term_months: 24,
      });
    } else if (t === 'services_partnership') {
      out.push({
        deal_type: t,
        label: 'Services Partnership',
        summary: 'Operating-partner engagement: legal, finance, design, GTM, or technical services for Axal portfolio.',
        terms: {
          rate: 'Negotiated per SOW (cash + equity-for-services optional)',
          equity_for_services_band: '0.1%–0.5% per engagement',
          minimum_engagements_per_year: 2,
        },
        granted_tier_founder: 'founder_pro',
        granted_tier_investor: null,
        term_months: 12,
      });
    } else if (t === 'deal_sourcing_revshare') {
      out.push({
        deal_type: t,
        label: 'Deal Sourcing Revenue Share',
        summary: 'Bring qualified founders or LPs to Axal in exchange for a tracked one-time grant + revenue share on closed deals.',
        terms: {
          founder_revshare_pct: '5% of Axal fees on deals closed within 12 months of intro',
          lp_revshare_pct: '10% of management fees on capital introduced',
          attribution_window_days: 365,
        },
        granted_tier_founder: 'founder_pro',
        granted_tier_investor: 'professional',
        term_months: 12,
      });
    } else if (t === 'capital_partnership') {
      const tier = capital >= 1_000_000 ? 'institutional' : 'professional';
      out.push({
        deal_type: t,
        label: 'Capital Partnership',
        summary: 'LP-style commitment to Axal vehicles with co-invest rights and dedicated dealroom access.',
        terms: {
          capital_commitment_usd: capital || 'TBD (≥ $250k)',
          co_invest_rights: 'Pro-rata on all SPVs ≥ $500k',
          mgmt_fee_offset_pct: '50% of carry on capital sourced from network',
        },
        granted_tier_founder: 'founder_pro',
        granted_tier_investor: tier,
        term_months: 24,
      });
    } else {
      out.push({
        deal_type: 'custom',
        label: 'Custom Deal',
        summary: 'Bespoke arrangement to be drafted with Axal counsel before signature.',
        terms: { description: profile.motivation || 'See attached SOW' },
        granted_tier_founder: 'founder_pro',
        granted_tier_investor: null,
        term_months: 12,
      });
    }
  }
  return out;
}

/**
 * Generate a one-time partner referral code. Format: PART-XXXXXXXX.
 * Insertion uses the UNIQUE constraint as the dedupe ground-truth — caller
 * retries on conflict (extremely unlikely with 8 hex chars = 4B keyspace).
 */
export function genPartnerReferralCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `PART-${hex}`;
}

/**
 * Activate a partner deal once the e-sign envelope reaches `completed`.
 * Idempotent: if the deal is already active, returns the existing record.
 *
 * Side-effects (each best-effort, errors logged but never thrown):
 *   - upserts a `users` row with role='partner' (or promotes existing)
 *   - links partner_profiles.user_id
 *   - flips partner_deals → active + writes activated_at, expires_at,
 *     and the partner referral code
 *   - opens a DD case (subject_type='partner') with KYB always; KYC +
 *     Accreditation are seeded automatically by sectionsFor('partner')
 *     so the CAPITAL_PARTNERSHIP-specific gating is a function of
 *     reviewer assignment, not seeding
 *   - seeds Trust Center obligations for the new partner
 */
export async function activatePartnerDealOnSignature(
  env: Env,
  envelopeId: number,
): Promise<{ activated: boolean; partner_deal_id: number; user_id: number | null } | null> {
  const deal: any = await env.DB.prepare(
    `SELECT pd.*, pi.recipient_email, pi.recipient_name, pi.invited_by_user_id,
            pp.full_name, pp.organization, pp.role_title, pp.expertise
       FROM partner_deals pd
       JOIN partner_invitations pi ON pi.id = pd.invitation_id
       LEFT JOIN partner_profiles pp ON pp.invitation_id = pi.id
      WHERE pd.envelope_id = ? LIMIT 1`,
  ).bind(envelopeId).first();
  if (!deal) return null;
  if (deal.status === 'active') {
    return { activated: false, partner_deal_id: deal.id, user_id: deal.user_id };
  }

  // Ensure partner user exists. Match by email (case-insensitive). If found,
  // promote to role='partner' unless already admin (admin > partner).
  const email = String(deal.recipient_email).toLowerCase();
  const existing: any = await env.DB.prepare(
    `SELECT id, role FROM users WHERE LOWER(email) = ? LIMIT 1`,
  ).bind(email).first();

  let userId: number;
  if (existing?.id) {
    userId = Number(existing.id);
    // Do NOT overwrite an existing non-admin role (founder/investor/mentor)
    // with 'partner' — that would silently demote access on role-gated
    // surfaces. The deal grants tier benefits via subscription_tier /
    // investor_tier columns regardless of users.role; primary role is
    // preserved. Only promote when the row is at the default 'partner'
    // (set by /auth/register for placeholder accounts) or unset.
    if (!existing.role || existing.role === 'partner') {
      await env.DB.prepare(`UPDATE users SET role = 'partner' WHERE id = ?`).bind(userId).run();
    }
  } else {
    const ins: any = await env.DB.prepare(
      `INSERT INTO users (email, name, role, email_verified) VALUES (?, ?, 'partner', 1) RETURNING id`,
    ).bind(deal.recipient_email, deal.recipient_name || deal.full_name || deal.recipient_email).first();
    userId = Number(ins.id);
  }

  // Generate referral code with retry on UNIQUE collision. We only
  // adopt the candidate once the UPDATE actually persists (changes>=1)
  // so a lost race or a UNIQUE-failed retry can't surface a code that
  // doesn't exist in the database.
  let referralCode = deal.referral_code as string | null;
  if (!referralCode) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = genPartnerReferralCode();
      try {
        const upd = await env.DB.prepare(
          `UPDATE partner_deals SET referral_code = ? WHERE id = ? AND referral_code IS NULL`,
        ).bind(candidate, deal.id).run();
        if ((upd.meta?.changes || 0) > 0) {
          referralCode = candidate;
          break;
        }
      } catch (e) { /* UNIQUE collision — retry with a new code */ }
    }
    if (!referralCode) {
      // Lost the race to a concurrent activation — re-read the persisted code.
      const row: any = await env.DB.prepare(
        `SELECT referral_code FROM partner_deals WHERE id = ?`,
      ).bind(deal.id).first();
      referralCode = row?.referral_code || null;
    }
  }

  // Grant tiers in users table per deal terms.
  const grantedFounder = deal.granted_tier_founder as string | null;
  const grantedInvestor = deal.granted_tier_investor as string | null;
  const termMonths = Number(deal.term_months || 12);
  const expiresAt = new Date(Date.now() + termMonths * 30 * 86400 * 1000).toISOString();

  if (grantedFounder) {
    try {
      await env.DB.prepare(
        `UPDATE users SET subscription_tier = ?, subscription_status = 'partner_grant', subscription_renews_at = ? WHERE id = ?`,
      ).bind(grantedFounder, expiresAt, userId).run();
    } catch (e) { console.warn('[partnerDeals] founder tier grant failed', e); }
  }
  if (grantedInvestor) {
    try {
      const { ensureInvestorPaywallSchema } = await import('../middleware/requireInvestorTier');
      await ensureInvestorPaywallSchema(env);
      const dealroomMax = grantedInvestor === 'institutional' ? 999 : 5;
      await env.DB.prepare(
        `UPDATE users SET investor_tier = ?, investor_subscription_status = 'partner_grant',
                          investor_subscription_renews_at = ?, investor_dealroom_max = ?
           WHERE id = ?`,
      ).bind(grantedInvestor, expiresAt, dealroomMax, userId).run();
    } catch (e) { console.warn('[partnerDeals] investor tier grant failed', e); }
  }

  // Flip deal → active.
  await env.DB.prepare(
    `UPDATE partner_deals
        SET status = 'active', user_id = ?, activated_at = CURRENT_TIMESTAMP, expires_at = ?
      WHERE id = ?`,
  ).bind(userId, expiresAt, deal.id).run();

  // Mark invitation signed and link the resulting user.
  await env.DB.prepare(
    `UPDATE partner_invitations
        SET status = 'signed', signed_at = CURRENT_TIMESTAMP,
            resulting_user_id = ?, resulting_deal_id = ?
      WHERE id = ?`,
  ).bind(userId, deal.id, deal.invitation_id).run();

  // Link profile to the new user.
  try {
    await env.DB.prepare(
      `UPDATE partner_profiles SET user_id = ? WHERE invitation_id = ?`,
    ).bind(userId, deal.invitation_id).run();
  } catch {}

  // Open DD case (subject_type='partner'). KYB is ALWAYS seeded as
  // active. KYC + Accreditation are gated to capital_partnership only —
  // for non-capital deal types they are seeded with verdict='n_a' and
  // status='completed' so reviewers don't have to clear them. AML
  // (compliance_aml) is always active because every partner needs
  // sanctions screening regardless of deal type.
  try {
    const { sectionsFor } = await import('./dueDiligence');
    const sections = sectionsFor('partner');
    const isCapital = deal.deal_type === 'capital_partnership';
    const naForNonCapital = new Set(['kyc_individual', 'accreditation']);
    const uidBytes = new Uint8Array(16);
    crypto.getRandomValues(uidBytes);
    const ddUid = Array.from(uidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const ddIns: any = await env.DB.prepare(
      `INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id)
       VALUES (?, 'partner', ?, ?, ?) RETURNING id`,
    ).bind(ddUid, userId, deal.organization || deal.full_name || deal.recipient_email, deal.invited_by_user_id).first();
    if (ddIns?.id) {
      const ddCaseId = Number(ddIns.id);
      for (const s of sections) {
        const skipForNonCapital = !isCapital && naForNonCapital.has(s.key);
        if (skipForNonCapital) {
          await env.DB.prepare(
            `INSERT INTO dd_sections (case_id, section_key, title, weight, status, verdict, completed_at)
             VALUES (?, ?, ?, ?, 'completed', 'n_a', CURRENT_TIMESTAMP)`,
          ).bind(ddCaseId, s.key, s.title, s.weight).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO dd_sections (case_id, section_key, title, weight)
             VALUES (?, ?, ?, ?)`,
          ).bind(ddCaseId, s.key, s.title, s.weight).run();
        }
      }
    }
  } catch (e) { console.warn('[partnerDeals] DD case open failed', (e as Error).message); }

  // Seed Trust Center obligations for partner role + deal-conditional
  // legal obligations. The base seeder only handles tos_v1/privacy_v1
  // for the partner role; the X-1 spec requires:
  //   • partner_msa_v1 — always required (the deal we just signed)
  //   • kyb_v1         — always required (entity verification)
  //   • kyc_v1         — required ONLY for capital_partnership
  //   • accreditation_v1 — required ONLY for capital_partnership
  // Non-capital deals get rows seeded with required=0/status='waived'
  // so the Trust Center surface still shows "n/a" rather than hiding
  // the obligation entirely (auditable trail).
  try {
    const { seedObligations, ensureTrustSchema } = await import('./trust');
    await seedObligations(env, userId, 'partner');
    await ensureTrustSchema(env);
    const isCapital = deal.deal_type === 'capital_partnership';
    const dealConditional: Array<{ key: string; required: 0 | 1 }> = [
      { key: 'partner_msa_v1', required: 1 },
      { key: 'kyb_v1',         required: 1 },
      { key: 'kyc_v1',           required: isCapital ? 1 : 0 },
      { key: 'accreditation_v1', required: isCapital ? 1 : 0 },
    ];
    for (const o of dealConditional) {
      // partner_msa_v1 is satisfied by THIS envelope; KYB and the
      // capital-only rows start as 'pending'. Non-capital rows get
      // required=0 / status='waived' so reviewers see them as n/a.
      const initialStatus = o.key === 'partner_msa_v1'
        ? 'satisfied'
        : (o.required ? 'pending' : 'waived');
      const evidenceUuid = o.key === 'partner_msa_v1'
        ? (await env.DB.prepare(`SELECT envelope_uuid FROM esign_envelopes WHERE id = ?`).bind(envelopeId).first() as any)?.envelope_uuid || null
        : null;
      try {
        await env.DB.prepare(
          `INSERT INTO legal_obligations (user_id, obligation_key, required, status, evidence_envelope_uuid)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, obligation_key) DO UPDATE SET
             required   = excluded.required,
             status     = CASE WHEN excluded.status = 'satisfied' THEN 'satisfied'
                               WHEN legal_obligations.status = 'satisfied' THEN 'satisfied'
                               WHEN excluded.required = 0 THEN 'waived'
                               ELSE legal_obligations.status END,
             evidence_envelope_uuid = COALESCE(excluded.evidence_envelope_uuid, legal_obligations.evidence_envelope_uuid),
             updated_at = CURRENT_TIMESTAMP`,
        ).bind(userId, o.key, o.required, initialStatus, evidenceUuid).run();
      } catch (e) { console.warn('[partnerDeals] obligation seed failed', o.key, e); }
    }
  } catch (e) { console.warn('[partnerDeals] trust seed failed', e); }

  // Send confirmation email + in-app notify.
  try {
    const { notify } = await import('./notify');
    await notify(env, {
      userId,
      type: 'partner_deal_activated',
      title: `Welcome to the Axal partner network`,
      body: `Your ${deal.deal_type.replace(/_/g, ' ')} agreement is live. Your one-time referral code is ${referralCode || '(pending)'} — share it to grant network access for ${termMonths} months.`,
      link: '/partner-portal',
      channels: ['in_app', 'email'],
    });
  } catch (e) { console.warn('[partnerDeals] notify failed', e); }

  // Audit hashed-actor.
  try {
    const actorHash = await hashEmail(deal.recipient_email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'partner_deal_activated',
      JSON.stringify({ deal_id: deal.id, deal_type: deal.deal_type, term_months: termMonths, referral_code: referralCode }),
      actorHash, userId,
    ).run();
  } catch {}

  return { activated: true, partner_deal_id: Number(deal.id), user_id: userId };
}

/**
 * Called from /auth/register when a referral code is presented. Returns
 * the deal whose code was redeemed (or null if not a partner code), and
 * applies the deal's granted tiers to the new user for the deal's
 * remaining term.
 *
 * Self-redemption (the partner using their own code) is rejected.
 */
export async function redeemPartnerReferralCode(
  env: Env,
  newUserId: number,
  refCode: string,
): Promise<{ partner_deal_id: number } | null> {
  if (!refCode) return null;
  const code = refCode.toUpperCase();
  if (!code.startsWith('PART-')) return null;
  const deal: any = await env.DB.prepare(
    `SELECT id, user_id, deal_type, granted_tier_founder, granted_tier_investor, expires_at, status
       FROM partner_deals WHERE referral_code = ? LIMIT 1`,
  ).bind(code).first();
  if (!deal || deal.status !== 'active') return null;
  // Hard expiry enforcement: a deal whose term has passed must NOT
  // grant new redemptions. Auto-transition the deal to 'expired' so
  // future calls short-circuit on the status check above and the
  // cron sweep is just a backstop.
  const nowMs = Date.now();
  if (deal.expires_at && new Date(deal.expires_at).getTime() <= nowMs) {
    try {
      await env.DB.prepare(
        `UPDATE partner_deals SET status = 'expired' WHERE id = ? AND status = 'active'`,
      ).bind(deal.id).run();
    } catch { /* best-effort */ }
    return null;
  }
  if (Number(deal.user_id) === Number(newUserId)) return null; // self-redeem guard
  // Use the deal's remaining term (capped at expires_at) for the redeemer.
  const grantedUntil = deal.expires_at as string | null;

  // Apply tier grants.
  if (deal.granted_tier_founder) {
    try {
      await env.DB.prepare(
        `UPDATE users SET subscription_tier = ?, subscription_status = 'partner_referral', subscription_renews_at = ? WHERE id = ?`,
      ).bind(deal.granted_tier_founder, grantedUntil, newUserId).run();
    } catch (e) { console.warn('[partnerDeals] redeem founder tier failed', e); }
  }
  if (deal.granted_tier_investor) {
    try {
      const { ensureInvestorPaywallSchema } = await import('../middleware/requireInvestorTier');
      await ensureInvestorPaywallSchema(env);
      const dealroomMax = deal.granted_tier_investor === 'institutional' ? 999 : 5;
      await env.DB.prepare(
        `UPDATE users SET investor_tier = ?, investor_subscription_status = 'partner_referral',
                          investor_subscription_renews_at = ?, investor_dealroom_max = ?
           WHERE id = ?`,
      ).bind(deal.granted_tier_investor, grantedUntil, dealroomMax, newUserId).run();
    } catch (e) { console.warn('[partnerDeals] redeem investor tier failed', e); }
  }

  const attribution = deal.deal_type === 'deal_sourcing_revshare' ? 'deal_sourcing_revshare' : 'referral';
  try {
    await env.DB.prepare(
      `INSERT INTO partner_referral_redemptions
         (partner_deal_id, redeemed_by_user_id, granted_tier_founder, granted_tier_investor, granted_until, attribution_kind)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(partner_deal_id, redeemed_by_user_id) DO NOTHING`,
    ).bind(
      deal.id, newUserId, deal.granted_tier_founder, deal.granted_tier_investor, grantedUntil, attribution,
    ).run();
  } catch (e) { console.warn('[partnerDeals] redemption insert failed', e); }

  return { partner_deal_id: Number(deal.id) };
}

/**
 * Daily sweep — flip every partner_deal whose term has passed to
 * status='expired' and revoke any tier grants whose status still
 * reflects the partner grant (subscription_status='partner_grant'
 * /'partner_referral'). Paying subscriptions that replaced a grant
 * mid-term are NOT clobbered. Returns counts for cron logging.
 */
export async function expirePartnerDeals(env: Env): Promise<{
  deals_expired: number;
  founder_grants_revoked: number;
  investor_grants_revoked: number;
  redemptions_revoked: number;
}> {
  let dealsExpired = 0;
  let founderRevoked = 0;
  let investorRevoked = 0;
  let redemptionsRevoked = 0;

  // 1. Snapshot deals that need to be expired so we can revoke tiers
  //    BEFORE we lose the granted_tier_* values from a status flip.
  const dueRows: any = await env.DB.prepare(
    `SELECT id, user_id, granted_tier_founder, granted_tier_investor
       FROM partner_deals
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND datetime(expires_at) <= datetime('now')`,
  ).all().catch(() => ({ results: [] }));
  const due: any[] = (dueRows?.results || []) as any[];

  for (const d of due) {
    try {
      const upd = await env.DB.prepare(
        `UPDATE partner_deals SET status = 'expired' WHERE id = ? AND status = 'active'`,
      ).bind(d.id).run();
      if ((upd.meta?.changes || 0) === 0) continue;
      dealsExpired += 1;

      // Revoke tier on the partner themselves (only if their current
      // tier still reflects this grant — paid upgrades are preserved).
      if (d.user_id && d.granted_tier_founder) {
        const r = await env.DB.prepare(
          `UPDATE users SET subscription_tier = 'free',
                              subscription_status = 'partner_expired',
                              subscription_renews_at = NULL
             WHERE id = ?
               AND subscription_tier = ?
               AND subscription_status = 'partner_grant'`,
        ).bind(d.user_id, d.granted_tier_founder).run();
        if ((r.meta?.changes || 0) > 0) founderRevoked += 1;
      }
      if (d.user_id && d.granted_tier_investor) {
        const r = await env.DB.prepare(
          `UPDATE users SET investor_tier = 'free',
                              investor_subscription_status = 'partner_expired',
                              investor_subscription_renews_at = NULL,
                              investor_dealroom_max = 5
             WHERE id = ?
               AND investor_tier = ?
               AND investor_subscription_status = 'partner_grant'`,
        ).bind(d.user_id, d.granted_tier_investor).run();
        if ((r.meta?.changes || 0) > 0) investorRevoked += 1;
      }

      // Revoke tier on every redeemer of this deal under the same
      // "only-if-still-partner_referral" guard.
      const reds: any = await env.DB.prepare(
        `SELECT redeemed_by_user_id, granted_tier_founder, granted_tier_investor
           FROM partner_referral_redemptions WHERE partner_deal_id = ?`,
      ).bind(d.id).all().catch(() => ({ results: [] }));
      for (const r of (reds?.results || []) as any[]) {
        if (r.granted_tier_founder) {
          const u = await env.DB.prepare(
            `UPDATE users SET subscription_tier = 'free',
                                subscription_status = 'partner_expired',
                                subscription_renews_at = NULL
               WHERE id = ?
                 AND subscription_tier = ?
                 AND subscription_status = 'partner_referral'`,
          ).bind(r.redeemed_by_user_id, r.granted_tier_founder).run();
          if ((u.meta?.changes || 0) > 0) redemptionsRevoked += 1;
        }
        if (r.granted_tier_investor) {
          const u = await env.DB.prepare(
            `UPDATE users SET investor_tier = 'free',
                                investor_subscription_status = 'partner_expired',
                                investor_subscription_renews_at = NULL,
                                investor_dealroom_max = 5
               WHERE id = ?
                 AND investor_tier = ?
                 AND investor_subscription_status = 'partner_referral'`,
          ).bind(r.redeemed_by_user_id, r.granted_tier_investor).run();
          if ((u.meta?.changes || 0) > 0) redemptionsRevoked += 1;
        }
      }
    } catch (e) { console.warn('[partnerDeals] expire deal failed', d.id, e); }
  }

  return {
    deals_expired: dealsExpired,
    founder_grants_revoked: founderRevoked,
    investor_grants_revoked: investorRevoked,
    redemptions_revoked: redemptionsRevoked,
  };
}
