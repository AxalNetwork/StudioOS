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
// Task #43 — single source of truth for the per-tier dealroom cap. Used
// in the expirePartnerDeals revocation paths below; the synchronous
// activate/redeem grant paths still import dynamically because they
// also need ensureInvestorPaywallSchema in the same await.
import { INVESTOR_QUOTAS } from '../middleware/requireInvestorTier';

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
  /**
   * Task #9 (X-2) — short excerpt of the binding contract clauses the
   * partner will sign at finalize time. Surfaced in the proposal card +
   * review screen so the partner has informed consent BEFORE the e-sign
   * envelope is sent. Plain-text, ~3-6 lines; full contract is rendered
   * inside the e-sign envelope itself.
   */
  contract_excerpt: string;
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
        contract_excerpt:
          'EQUITY PARTNERSHIP AGREEMENT — Partner shall receive 0.5%–2.0% equity in Axal VC Management LLC (the operating company; Axal VC Holdings LLC is the passive parent and holds platform IP), vesting over 48 months with a 12-month cliff. Partner shall provide ' +
          (profile.capacity_per_month || '5–10') + ' hours per month of venture-partner services. Either party may terminate for cause on 30 days written notice. Unvested equity reverts on termination.',
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
        contract_excerpt:
          'SERVICES PARTNERSHIP AGREEMENT — Partner agrees to deliver a minimum of two (2) Statement-of-Work engagements per calendar year for Axal portfolio companies. Compensation per SOW (cash and/or 0.1%–0.5% equity-for-services). Partner is an independent contractor; no employment relationship is created. IP assignment per individual SOW.',
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
        contract_excerpt:
          'DEAL SOURCING & REVENUE SHARE AGREEMENT — Partner shall earn 5% of Axal management fees on founder-sourced deals closed within 365 days of introduction, and 10% of management fees on LP capital introduced. Attribution determined by Partner\'s unique referral code. Payments quarterly in arrears. Term auto-renews unless cancelled 60 days prior.',
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
        contract_excerpt:
          'CAPITAL PARTNERSHIP AGREEMENT — Partner commits ' + (capital ? '$' + capital.toLocaleString() : 'a minimum of $250,000') + ' across Axal-sponsored vehicles over 24 months. Partner receives pro-rata co-invest rights on all SPVs ≥ $500k and a 50% management-fee offset on capital sourced from Partner\'s network. Subject to KYC, accreditation verification, and execution of vehicle-specific subscription docs.',
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
        contract_excerpt:
          'CUSTOM PARTNERSHIP AGREEMENT — Bespoke terms to be drafted by Axal counsel. Outline: ' + (profile.motivation || 'see attached SOW') + '. Final binding terms will be presented inside the e-sign envelope before signature.',
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
            pi.status AS invitation_status, pi.expires_at AS invitation_expires_at,
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
  // Invitation revocation/expiry must block activation even if the
  // recipient still has a stale signing token in their inbox. The
  // admin revoke path also voids the envelope, but check here too —
  // belt-and-braces — so any race or missed envelope void can't slip
  // a deal through.
  if (deal.invitation_status === 'revoked') {
    try {
      await env.DB.prepare(
        `UPDATE partner_deals SET status = 'voided' WHERE id = ? AND status != 'active'`,
      ).bind(deal.id).run();
    } catch { /* best-effort */ }
    console.warn('[partnerDeals] activation blocked — invitation revoked', { deal_id: deal.id });
    return { activated: false, partner_deal_id: deal.id, user_id: null };
  }
  if (deal.invitation_expires_at &&
      new Date(deal.invitation_expires_at).getTime() <= Date.now()) {
    try {
      await env.DB.prepare(
        `UPDATE partner_invitations SET status = 'expired' WHERE id = ? AND status NOT IN ('signed','revoked')`,
      ).bind(deal.invitation_id).run();
      await env.DB.prepare(
        `UPDATE partner_deals SET status = 'voided' WHERE id = ? AND status != 'active'`,
      ).bind(deal.id).run();
    } catch { /* best-effort */ }
    console.warn('[partnerDeals] activation blocked — invitation expired', { deal_id: deal.id });
    return { activated: false, partner_deal_id: deal.id, user_id: null };
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
    // Do NOT overwrite an existing non-admin role (founder/investor/advisor)
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

  // Task #1 (DB) — assign AXP-id at deal-activation time so the
  // contract record + admin profile pane both surface it. Idempotent
  // (no-op if the user already has one).
  try {
    const { assignPartnerPublicId } = await import('./publicIds');
    await assignPartnerPublicId(env, userId);
  } catch {}

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
      // Task #43 — single-source the dealroom cap from INVESTOR_QUOTAS
      // instead of the local `institutional ? 999 : 5` ternary so the
      // grant column tracks the canonical per-tier cap (and matches the
      // billing-flow paths in routes/billing.ts that already do this).
      const { ensureInvestorPaywallSchema, INVESTOR_QUOTAS } = await import('../middleware/requireInvestorTier');
      await ensureInvestorPaywallSchema(env);
      const investorTier = grantedInvestor as 'free' | 'professional' | 'institutional';
      const dealroomMax = INVESTOR_QUOTAS[investorTier].dealroom_max;
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
      // Task #43 — same INVESTOR_QUOTAS sourcing as the grant path above.
      const { ensureInvestorPaywallSchema, INVESTOR_QUOTAS } = await import('../middleware/requireInvestorTier');
      await ensureInvestorPaywallSchema(env);
      const investorTier = deal.granted_tier_investor as 'free' | 'professional' | 'institutional';
      const dealroomMax = INVESTOR_QUOTAS[investorTier].dealroom_max;
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
                              investor_dealroom_max = ?
             WHERE id = ?
               AND investor_tier = ?
               AND investor_subscription_status = 'partner_grant'`,
        ).bind(INVESTOR_QUOTAS.free.dealroom_max, d.user_id, d.granted_tier_investor).run();
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
                                investor_dealroom_max = ?
               WHERE id = ?
                 AND investor_tier = ?
                 AND investor_subscription_status = 'partner_referral'`,
          ).bind(INVESTOR_QUOTAS.free.dealroom_max, r.redeemed_by_user_id, r.granted_tier_investor).run();
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

// ---------------------------------------------------------------------------
// Task #38 — Rev-share attribution-window expiry warnings.
// ---------------------------------------------------------------------------
//
// Background. `partner_referral_redemptions` rows whose
// `attribution_kind = 'deal_sourcing_revshare'` carry a 365-day
// attribution window measured from `redeemed_at` (matches the per-
// redemption countdown the partner portal already renders, see
// routes/partner_portal.ts:54). When the window closes the partner
// stops earning rev-share on that redeemer's deals — Task #26 made
// the countdown visible in the UI; this cron turns it into a real
// reminder so partners who don't open the portal still see it.
//
// Idempotency. Per-(redemption_id, threshold) dedupe lives in
// `partner_revshare_window_notifications` (see migration 033). We
// `INSERT OR IGNORE` and only send when meta.changes === 1, so
// concurrent cron runs / lease handoffs never double-page.
//
// Thresholds: 30 / 7 / 1 days remaining. Each redemption gets up
// to three warnings over its lifetime; admins get one digest per
// run summarising every warning fired.

const REVSHARE_THRESHOLDS_DAYS: ReadonlyArray<number> = [30, 7, 1];
const REVSHARE_ATTRIBUTION_DAYS = 365;

interface RevshareDueRow {
  redemption_id: number;
  redeemed_at: string;
  partner_deal_id: number;
  partner_user_id: number | null;
  partner_email: string | null;
  partner_name: string | null;
  redeemer_name: string | null;
  redeemer_email: string | null;
  referral_code: string | null;
}

let revshareNotifSchemaReady = false;
async function ensureRevshareNotifSchema(env: Env): Promise<boolean> {
  if (revshareNotifSchemaReady) return true;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS partner_revshare_window_notifications (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         redemption_id INTEGER NOT NULL REFERENCES partner_referral_redemptions(id),
         threshold_days INTEGER NOT NULL,
         notified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE(redemption_id, threshold_days)
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_prwn_redemption
         ON partner_revshare_window_notifications(redemption_id)`,
    ).run();
    revshareNotifSchemaReady = true;
    return true;
  } catch (e) {
    console.error('[partnerDeals] revshare notif schema migration failed', e);
    return false;
  }
}

interface FiredWarning {
  redemption_id: number;
  threshold_days: number;
  partner_user_id: number | null;
  partner_email: string | null;
  partner_name: string | null;
  redeemer_name: string | null;
  redeemer_email: string | null;
  referral_code: string | null;
  closes_at: string;
}

/**
 * Daily sweep — find every deal_sourcing_revshare redemption whose
 * 365-day attribution window will close in 30 / 7 / 1 days and send
 * the partner a one-shot warning per threshold (in_app + email),
 * then a single digest email per admin summarising the batch.
 *
 * Idempotent: each (redemption_id, threshold_days) tuple is recorded
 * in `partner_revshare_window_notifications` BEFORE the email/notify
 * call so concurrent runs that race on the same row see meta.changes
 * === 0 and skip dispatch (no double emails).
 *
 * Returns counts for cron logging.
 */
export async function notifyExpiringRevshareWindows(env: Env): Promise<{
  warnings_sent: number;
  partner_emails_sent: number;
  admin_digest_sent: number;
}> {
  const out = { warnings_sent: 0, partner_emails_sent: 0, admin_digest_sent: 0 };
  if (!(await ensureRevshareNotifSchema(env))) return out;

  const fired: FiredWarning[] = [];

  for (const threshold of REVSHARE_THRESHOLDS_DAYS) {
    // Redemptions for which we've crossed the (365 - threshold)-day
    // mark since `redeemed_at` but the window hasn't fully closed.
    // The NOT EXISTS arm ensures we don't re-query rows already
    // notified for this threshold even before INSERT OR IGNORE runs.
    const dueRows: any = await env.DB.prepare(
      `SELECT prr.id            AS redemption_id,
              prr.redeemed_at   AS redeemed_at,
              prr.partner_deal_id,
              pd.user_id        AS partner_user_id,
              pu.email          AS partner_email,
              pu.name           AS partner_name,
              ru.name           AS redeemer_name,
              ru.email          AS redeemer_email,
              pd.referral_code  AS referral_code
         FROM partner_referral_redemptions prr
         JOIN partner_deals pd ON pd.id = prr.partner_deal_id
         LEFT JOIN users pu ON pu.id = pd.user_id
         LEFT JOIN users ru ON ru.id = prr.redeemed_by_user_id
        WHERE prr.attribution_kind = 'deal_sourcing_revshare'
          AND datetime(prr.redeemed_at, '+' || ? || ' days') > datetime('now')
          AND datetime(prr.redeemed_at, '+' || ? || ' days') <= datetime('now')
          AND NOT EXISTS (
            SELECT 1 FROM partner_revshare_window_notifications w
             WHERE w.redemption_id = prr.id AND w.threshold_days = ?
          )`,
    ).bind(
      REVSHARE_ATTRIBUTION_DAYS,
      REVSHARE_ATTRIBUTION_DAYS - threshold,
      threshold,
    ).all().catch((e) => {
      console.error('[partnerDeals] revshare due lookup failed', e);
      return { results: [] };
    });

    const due: RevshareDueRow[] = (dueRows?.results || []) as RevshareDueRow[];
    if (due.length === 0) continue;

    // Lazy-import notify so this service stays free of route deps and
    // we don't pay the import cost on the hot redemption path.
    const { notify } = await import('./notify');

    for (const row of due) {
      // Atomic claim. If another isolate already inserted this tuple,
      // meta.changes === 0 and we skip the notify call.
      let claimed = false;
      try {
        const r: any = await env.DB.prepare(
          `INSERT OR IGNORE INTO partner_revshare_window_notifications
             (redemption_id, threshold_days) VALUES (?, ?)`,
        ).bind(row.redemption_id, threshold).run();
        const changes = r?.meta?.changes ?? r?.meta?.rows_written ?? 0;
        claimed = Number(changes) === 1;
      } catch (e) {
        console.warn('[partnerDeals] revshare dedupe insert failed', row.redemption_id, threshold, e);
      }
      if (!claimed) continue;

      const closesAt = new Date(
        new Date(row.redeemed_at).getTime() + REVSHARE_ATTRIBUTION_DAYS * 86400_000,
      ).toISOString();
      const dayWord = threshold === 1 ? 'day' : 'days';
      const redeemerLabel = row.redeemer_name || row.redeemer_email || 'a redeemer';
      const title = `Rev-share attribution window closes in ${threshold} ${dayWord}`;
      const body =
        `Your 365-day attribution window for ${redeemerLabel}` +
        (row.referral_code ? ` (referral code ${row.referral_code})` : '') +
        ` closes in ${threshold} ${dayWord} (on ${closesAt.slice(0, 10)}). ` +
        `Deals closed before then still earn you rev-share — see your partner portal for details.`;

      out.warnings_sent += 1;
      fired.push({
        redemption_id: row.redemption_id,
        threshold_days: threshold,
        partner_user_id: row.partner_user_id,
        partner_email: row.partner_email,
        partner_name: row.partner_name,
        redeemer_name: row.redeemer_name,
        redeemer_email: row.redeemer_email,
        referral_code: row.referral_code,
        closes_at: closesAt,
      });

      if (row.partner_user_id) {
        try {
          await notify(env, {
            userId: row.partner_user_id,
            type: 'partner_revshare_window_closing',
            title,
            body,
            link: '/partners/portal',
            channels: ['in_app', 'email'],
            // 'deals' bucket already exists in the notification-prefs
            // matrix; partners can opt out from Settings → Notifications.
            category: 'deals',
            payload: {
              redemption_id: row.redemption_id,
              threshold_days: threshold,
              closes_at: closesAt,
              referral_code: row.referral_code,
            },
          });
          if (row.partner_email) out.partner_emails_sent += 1;
        } catch (e) {
          console.warn('[partnerDeals] partner notify failed', row.redemption_id, e);
        }
      }
    }
  }

  if (fired.length > 0) {
    try {
      const { sendNotificationEmail } = await import('./email');
      const admins: any = await env.DB.prepare(
        `SELECT id, email, name FROM users WHERE role = 'admin' AND is_active = 1`,
      ).all().catch(() => ({ results: [] }));
      const adminRows: Array<{ id: number; email: string; name: string | null }> =
        (admins?.results || []) as any[];

      const lines = fired.map((f) => {
        const partner = f.partner_name || f.partner_email || `user ${f.partner_user_id}`;
        const redeemer = f.redeemer_name || f.redeemer_email || 'unknown redeemer';
        return `• ${partner} → ${redeemer} (${f.referral_code || 'no code'}) — ${f.threshold_days}d remaining, closes ${f.closes_at.slice(0, 10)}`;
      });
      const subject = `[Axal] Rev-share window warnings: ${fired.length} sent`;
      const body =
        `Daily rev-share attribution-window cron fired ${fired.length} warning${fired.length === 1 ? '' : 's'}:\n\n` +
        lines.join('\n') +
        `\n\nAdmin panel: /admin/partners`;

      // Counter is the number of admins we successfully emailed (not
      // a 0/1 flag) so cron telemetry reflects actual reach.
      for (const a of adminRows) {
        if (!a.email) continue;
        const ok = await sendNotificationEmail(env, a.email, subject, body);
        if (ok) out.admin_digest_sent += 1;
      }
    } catch (e) {
      console.warn('[partnerDeals] admin digest send failed', e);
    }
  }

  return out;
}
