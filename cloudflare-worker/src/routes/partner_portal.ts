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
import { requirePartnerProfile, mapError } from './_t13t14t15_helpers';
import { ensurePartnerGuidanceColumns } from '../services/partnerGuidanceSchema';

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
      let revshareWindowClosesAt: string | null = null;
      if (isRevshare && r.redeemed_at) {
        const t = new Date(r.redeemed_at).getTime();
        if (Number.isFinite(t)) {
          const end = t + ATTRIBUTION_DAYS * 86400 * 1000;
          revshareWindowRemainingDays = Math.max(0, Math.ceil((end - nowMs) / 86400000));
          // Task #49 — also expose the absolute close date so the
          // partner-portal badge can show the exact date in its hover
          // tooltip (matches the urgency emails partners receive at
          // 30/7/1 days).
          revshareWindowClosesAt = new Date(end).toISOString();
        }
      }
      return {
        ...r,
        revshare_window_remaining_days: revshareWindowRemainingDays,
        revshare_window_closes_at: revshareWindowClosesAt,
      };
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

  // Partner profile state (accepting_intros) for the opt-out toggle.
  const partnerRow: any = await c.env.DB.prepare(
    `SELECT id, accepting_intros FROM partners WHERE id = (SELECT partner_id FROM users WHERE id = ?)`
  ).bind(user.id).first();

  return c.json({
    deal: { ...deal, proposal: safeJsonObject(deal.proposal_json), proposal_json: undefined },
    redemptions_count: redemptionsCount,
    redemptions: redemptions.results || [],
    revshare_attribution_days: isRevshare ? ATTRIBUTION_DAYS : null,
    next_milestones: milestones,
    partner: partnerRow ? { id: partnerRow.id, accepting_intros: partnerRow.accepting_intros } : null,
  });
});

portal.patch('/accepting-intros', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json();
  const value = body.accepting_intros === true || body.accepting_intros === 1 ? 1 : 0;
  const row: any = await c.env.DB.prepare(
    `UPDATE partners SET accepting_intros = ? WHERE id = (SELECT partner_id FROM users WHERE id = ?) RETURNING id, accepting_intros`,
  ).bind(value, user.id).first();
  if (!row) return c.json({ error: 'Partner not found' }, 404);
  return c.json({ partner_id: row.id, accepting_intros: row.accepting_intros });
});

// ---- Office-hours booking guidance (partner-authored) --------------------
// Columns live on `partners` (D1 migration 160_partner_office_hours_guidance).
// The founder-facing Office Hours drawer renders these verbatim; when a field
// is NULL the UI shows an explicit "not published yet" state. Nothing here is
// ever generated on the partner's behalf.
//
// Ownership: the target row is ALWAYS resolved from the authenticated user via
// requirePartnerProfile() (role gate `partner`/`admin`, then users.partner_id,
// then partners.email). No partner_id is accepted from the body or the URL, so
// one partner cannot write another partner's guidance.
const G_MAX = { when_to_book: 600, stage_fit: 60, session_outcome: 120, bring_item: 120 };
const G_BRING_MAX = 5;
// Shown when the guidance columns are genuinely missing (bootstrap failed and
// migration 160 has not been applied). Generic on purpose — never echo the raw
// D1 "no such column: …" text back to the client.
const GUIDANCE_UNAVAILABLE = 'Booking guidance is temporarily unavailable';

function guidanceDto(row: any) {
  let bring: string[] = [];
  try {
    const raw = JSON.parse(row?.oh_bring_json || '[]');
    if (Array.isArray(raw)) bring = raw.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, G_BRING_MAX);
  } catch { bring = []; }
  return {
    when_to_book: row?.oh_when_to_book || null,
    stage_fit: row?.oh_stage_fit || null,
    session_outcome: row?.oh_session_outcome || null,
    bring: bring,
    updated_at: row?.oh_guidance_updated_at || null,
  };
}

// Trim → cap → empty means "unpublish this field" (NULL), never '' in the DB.
//
// Strings ONLY — never String(v) coercion. This copy is published verbatim as
// guidance attributed to a real named partner, so a non-string JSON value
// (object / array / number) must NOT be stringified into `[object Object]`,
// `a,b` or `42` and shown to founders as that partner's own words. Anything
// that is not a string is treated as "no value" (see isBadText for the 400).
function normText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n/g, '\n').trim().slice(0, max);
  return s ? s : null;
}
/** True when a supplied field is present but is not a string (→ 400). */
function isBadText(v: unknown): boolean {
  return v !== undefined && v !== null && typeof v !== 'string';
}

portal.get('/office-hours-guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!(await ensurePartnerGuidanceColumns(c.env))) return c.json({ detail: GUIDANCE_UNAVAILABLE }, 503);
    const partner = await requirePartnerProfile(c.env, user);
    const row = await c.env.DB.prepare(
      `SELECT id, name, oh_when_to_book, oh_stage_fit, oh_session_outcome,
              oh_bring_json, oh_guidance_updated_at
         FROM partners WHERE id = ?`,
    ).bind(partner.id).first<any>();
    if (!row) return c.json({ detail: 'Partner not found' }, 404);
    return c.json({ partner_id: row.id, guidance: guidanceDto(row) });
  } catch (e) { return mapError(c, e); }
});

// PATCH is a FULL REPLACE of the guidance set, not a per-field merge: the
// editor is a single form that always posts all four fields, and clearing a
// field unpublishes it. Over-length input is truncated (same behaviour as the
// office-hours notes cap); only a non-array `bring` is rejected with 400.
portal.patch('/office-hours-guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!(await ensurePartnerGuidanceColumns(c.env))) return c.json({ detail: GUIDANCE_UNAVAILABLE }, 503);
    const partner = await requirePartnerProfile(c.env, user);
    const body = await c.req.json().catch(() => ({} as any));

    for (const k of ['when_to_book', 'stage_fit', 'session_outcome'] as const) {
      if (isBadText((body as any)[k])) return c.json({ detail: `${k} must be a string` }, 400);
    }
    const whenToBook = normText(body.when_to_book, G_MAX.when_to_book);
    const stageFit = normText(body.stage_fit, G_MAX.stage_fit);
    const sessionOutcome = normText(body.session_outcome, G_MAX.session_outcome);

    if (body.bring !== undefined && body.bring !== null && !Array.isArray(body.bring)) {
      return c.json({ detail: 'bring must be an array of strings' }, 400);
    }
    // Cap the element count BEFORE normalising: normText allocates per element,
    // so mapping a client-supplied array of arbitrary length and only then
    // slicing to 5 would let an authenticated partner force unbounded work.
    // Slice a little wider than the cap so blank rows can still be dropped.
    // Annotated: `body` is `any`, so without this the array stays `any[]` and
    // the `x is string` predicate below has an implicitly-typed parameter
    // (TS7006 under noImplicitAny).
    const bringRaw: unknown[] = Array.isArray(body.bring) ? body.bring.slice(0, G_BRING_MAX * 4) : [];
    const bring = bringRaw
      .map((x: unknown) => normText(x, G_MAX.bring_item))
      .filter((x): x is string => !!x)
      .slice(0, G_BRING_MAX);

    const anyContent = !!(whenToBook || stageFit || sessionOutcome || bring.length);
    const updatedAt = anyContent ? new Date().toISOString() : null;

    const row = await c.env.DB.prepare(
      `UPDATE partners
          SET oh_when_to_book = ?, oh_stage_fit = ?, oh_session_outcome = ?,
              oh_bring_json = ?, oh_guidance_updated_at = ?
        WHERE id = ?
      RETURNING id, oh_when_to_book, oh_stage_fit, oh_session_outcome,
                oh_bring_json, oh_guidance_updated_at`,
    ).bind(whenToBook, stageFit, sessionOutcome, JSON.stringify(bring), updatedAt, partner.id).first<any>();
    if (!row) return c.json({ detail: 'Partner not found' }, 404);
    return c.json({ partner_id: row.id, guidance: guidanceDto(row) });
  } catch (e) { return mapError(c, e); }
});

// ---- Partner firm profile (Wave 1a — BD Console Overview) -----------------
// The Operations → Overview tab previously rendered a hard-coded fictional
// firm ("BrightPath Advisory") from a frontend fixture. These two endpoints
// replace it with the partner's real row. The `partners` table is deliberately
// thin — name, company, specialization, referral code, status,
// accepting_intros — so the profile is exactly that; the UI shows honest
// empty states rather than inventing a mission statement.
//
// Ownership mirrors the guidance endpoints: the row is ALWAYS resolved from
// the authenticated user via requirePartnerProfile(); no partner id is
// accepted from the body or URL.
const P_MAX = { name: 120, company: 160, specialization: 240 };

function profileDto(row: any) {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    company: row.company || null,
    email: row.email,
    specialization: row.specialization || null,
    referral_code: row.referral_code || null,
    referrals_count: Number(row.referrals_count || 0),
    status: row.status,
    accepting_intros: !!row.accepting_intros,
    created_at: row.created_at,
  };
}

portal.get('/profile', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    return c.json({ partner: profileDto(partner) });
  } catch (e) { return mapError(c, e); }
});

// Per-field merge, not a full replace: the Overview form edits one card and
// sends only what changed. `undefined` leaves a field alone; an empty string
// clears company/specialization to NULL. `name` is NOT NULL in the schema and
// is how quotes attribute this partner to founders, so clearing it is a 400
// rather than a silent keep.
portal.patch('/profile', async (c) => {
  try {
    const user = await requireAuth(c);
    const partner = await requirePartnerProfile(c.env, user);
    const body = await c.req.json().catch(() => ({} as any));

    const sets: string[] = [];
    const params: any[] = [];
    for (const k of ['name', 'company', 'specialization'] as const) {
      const v = (body as any)[k];
      if (v === undefined) continue;
      if (v !== null && typeof v !== 'string') return c.json({ detail: `${k} must be a string` }, 400);
      const s = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, P_MAX[k]) : '';
      if (k === 'name') {
        if (!s) return c.json({ detail: 'name must be a non-empty string' }, 400);
        sets.push('name = ?'); params.push(s);
      } else {
        sets.push(`${k} = ?`); params.push(s ? s : null);
      }
    }
    if (!sets.length) return c.json({ detail: 'Nothing to update' }, 400);
    params.push(partner.id);
    const row = await c.env.DB.prepare(
      `UPDATE partners SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
    ).bind(...params).first<any>();
    if (!row) return c.json({ detail: 'Partner not found' }, 404);
    return c.json({ partner: profileDto(row) });
  } catch (e) { return mapError(c, e); }
});

export default portal;
