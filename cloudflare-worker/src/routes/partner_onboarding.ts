/**
 * Task #8 (X-1) — Public, token-gated partner onboarding endpoints.
 *
 * Mounted at `/api/partner-onboard`. No JWT auth — every endpoint
 * accepts the magic-link token (`/:token`). The token is the only
 * authentication artifact; expired/revoked invitations are rejected
 * BEFORE any state mutation.
 *
 * Flow:
 *   GET  /:token              → invitation details (flips status → viewed)
 *   POST /:token/profile      → upsert partner_profiles
 *   POST /:token/propose      → server returns 1-3 proposals
 *   POST /:token/select       → caller picks a proposal (creates partner_deals row)
 *   POST /:token/finalize     → starts the e-sign envelope (Y-1 partner_msa)
 *   GET  /:token/status       → poll envelope progress
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';
import { createAndSendEnvelope } from './esign';
import {
  buildProposals, ALL_PARTNER_DEAL_TYPES,
  type PartnerDealType, type PartnerProposalDraft,
} from '../services/partnerDeals';

const onboard = new Hono<{ Bindings: Env }>();

interface InvitationRow {
  id: number;
  token: string;
  recipient_email: string;
  recipient_name: string | null;
  invited_by_user_id: number;
  allowed_deal_types: string;
  personal_message: string | null;
  status: string;
  expires_at: string;
  viewed_at: string | null;
  signed_at: string | null;
  envelope_id: number | null;
  resulting_deal_id: number | null;
}

async function loadInvitation(env: Env, token: string): Promise<InvitationRow | null> {
  const row: any = await env.DB.prepare(
    `SELECT id, token, recipient_email, recipient_name, invited_by_user_id,
            allowed_deal_types, personal_message, status, expires_at,
            viewed_at, signed_at, envelope_id, resulting_deal_id
       FROM partner_invitations WHERE token = ? LIMIT 1`,
  ).bind(token).first();
  return row || null;
}

function isExpired(inv: InvitationRow): boolean {
  return new Date(inv.expires_at).getTime() < Date.now();
}

function gateInvitation(inv: InvitationRow | null): { ok: true; inv: InvitationRow } | { ok: false; status: number; error: string } {
  if (!inv) return { ok: false, status: 404, error: 'Invitation not found' };
  if (inv.status === 'revoked') return { ok: false, status: 410, error: 'Invitation has been revoked' };
  if (inv.status === 'signed')  return { ok: false, status: 409, error: 'Invitation already signed' };
  if (isExpired(inv))           return { ok: false, status: 410, error: 'Invitation has expired' };
  return { ok: true, inv };
}

/**
 * Returns 409 when an envelope has already been started for this
 * invitation (deal status awaiting_signature or active). Used to
 * block /profile, /propose, /select after finalize so concurrent
 * clicks can't spawn parallel deals or envelopes.
 */
async function rejectIfDealStarted(env: Env, invitationId: number): Promise<{ status: string } | null> {
  const r: any = await env.DB.prepare(
    `SELECT status FROM partner_deals
       WHERE invitation_id = ? AND status IN ('awaiting_signature','active')
       ORDER BY id DESC LIMIT 1`,
  ).bind(invitationId).first();
  return r ? { status: String(r.status) } : null;
}

function parseAllowed(s: string | null): PartnerDealType[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t: unknown) => (ALL_PARTNER_DEAL_TYPES as string[]).includes(String(t))) as PartnerDealType[];
  } catch { return []; }
}

async function audit(env: Env, inv: InvitationRow, action: string, details?: Record<string, unknown>): Promise<void> {
  try {
    const actorHash = await hashEmail(inv.recipient_email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor) VALUES (?, ?, ?)`,
    ).bind(action, JSON.stringify({ invitation_id: inv.id, ...(details || {}) }), actorHash).run();
  } catch (e) { console.warn('[partner_onboarding] audit failed', e); }
}

// ---------- GET /:token ----------

onboard.get('/:token', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  const gate = gateInvitation(inv);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status as 404 | 409 | 410);
  if (gate.inv.status === 'sent') {
    await c.env.DB.prepare(
      `UPDATE partner_invitations SET status = 'viewed', viewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'sent'`,
    ).bind(gate.inv.id).run();
    await audit(c.env, gate.inv, 'partner_invitation_viewed');
  }
  // Don't leak invited_by user PII; just include the admin's display name.
  const admin: any = await c.env.DB.prepare(
    `SELECT name FROM users WHERE id = ?`,
  ).bind(gate.inv.invited_by_user_id).first();
  const profile: any = await c.env.DB.prepare(
    `SELECT * FROM partner_profiles WHERE invitation_id = ?`,
  ).bind(gate.inv.id).first();
  const deal: any = await c.env.DB.prepare(
    `SELECT id, deal_type, proposal_json, status, envelope_id FROM partner_deals
        WHERE invitation_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(gate.inv.id).first();
  return c.json({
    invitation: {
      id: gate.inv.id,
      recipient_email: gate.inv.recipient_email,
      recipient_name: gate.inv.recipient_name,
      personal_message: gate.inv.personal_message,
      allowed_deal_types: parseAllowed(gate.inv.allowed_deal_types),
      status: gate.inv.status,
      expires_at: gate.inv.expires_at,
    },
    admin_name: admin?.name || 'Axal VC',
    profile: profile || null,
    deal: deal ? { ...deal, proposal: safeJsonObject(deal.proposal_json), proposal_json: undefined } : null,
  });
});

// ---------- POST /:token/profile ----------

onboard.post('/:token/profile', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  const gate = gateInvitation(inv);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status as 404 | 409 | 410);
  const started = await rejectIfDealStarted(c.env, gate.inv.id);
  if (started) return c.json({ error: `Cannot edit profile — deal is already ${started.status}` }, 409);
  const body = await c.req.json().catch(() => ({}));

  const fields = {
    full_name: strOrNull(body.full_name, 200),
    organization: strOrNull(body.organization, 200),
    role_title: strOrNull(body.role_title, 200),
    expertise: strOrNull(body.expertise, 1000),
    sectors: strOrNull(body.sectors, 1000),
    geography: strOrNull(body.geography, 200),
    capacity_per_month: strOrNull(body.capacity_per_month, 100),
    capital_capacity_usd: Number.isFinite(Number(body.capital_capacity_usd))
      ? Math.max(0, Math.min(1_000_000_000, Math.floor(Number(body.capital_capacity_usd))))
      : null,
    motivation: strOrNull(body.motivation, 4000),
    prior_deals: strOrNull(body.prior_deals, 4000),
    linkedin_url: strOrNull(body.linkedin_url, 500),
    raw_chat_json: typeof body.raw_chat_json === 'object' && body.raw_chat_json !== null
      ? JSON.stringify(body.raw_chat_json).slice(0, 64_000)
      : '{}',
  };

  await c.env.DB.prepare(
    `INSERT INTO partner_profiles
       (invitation_id, full_name, organization, role_title, expertise, sectors, geography,
        capacity_per_month, capital_capacity_usd, motivation, prior_deals, linkedin_url, raw_chat_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(invitation_id) DO UPDATE SET
       full_name = excluded.full_name,
       organization = excluded.organization,
       role_title = excluded.role_title,
       expertise = excluded.expertise,
       sectors = excluded.sectors,
       geography = excluded.geography,
       capacity_per_month = excluded.capacity_per_month,
       capital_capacity_usd = excluded.capital_capacity_usd,
       motivation = excluded.motivation,
       prior_deals = excluded.prior_deals,
       linkedin_url = excluded.linkedin_url,
       raw_chat_json = excluded.raw_chat_json,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    gate.inv.id, fields.full_name, fields.organization, fields.role_title, fields.expertise,
    fields.sectors, fields.geography, fields.capacity_per_month, fields.capital_capacity_usd,
    fields.motivation, fields.prior_deals, fields.linkedin_url, fields.raw_chat_json,
  ).run();

  await c.env.DB.prepare(
    `UPDATE partner_invitations SET status = 'profiled' WHERE id = ? AND status IN ('sent','viewed')`,
  ).bind(gate.inv.id).run();

  await audit(c.env, gate.inv, 'partner_profile_saved', { has_capital: !!fields.capital_capacity_usd });
  return c.json({ ok: true });
});

// ---------- POST /:token/propose ----------

onboard.post('/:token/propose', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  const gate = gateInvitation(inv);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status as 404 | 409 | 410);
  const started = await rejectIfDealStarted(c.env, gate.inv.id);
  if (started) return c.json({ error: `Cannot regenerate proposals — deal is already ${started.status}` }, 409);
  const profile: any = await c.env.DB.prepare(
    `SELECT * FROM partner_profiles WHERE invitation_id = ?`,
  ).bind(gate.inv.id).first();
  if (!profile) return c.json({ error: 'Submit profile first' }, 412);
  const allowed = parseAllowed(gate.inv.allowed_deal_types);
  const proposals = buildProposals(allowed, profile);
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET status = 'proposed' WHERE id = ? AND status IN ('viewed','profiled')`,
  ).bind(gate.inv.id).run();
  await audit(c.env, gate.inv, 'partner_proposals_generated', { count: proposals.length });
  return c.json({ proposals });
});

// ---------- POST /:token/select ----------

onboard.post('/:token/select', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  const gate = gateInvitation(inv);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status as 404 | 409 | 410);
  const started = await rejectIfDealStarted(c.env, gate.inv.id);
  if (started) return c.json({ error: `Cannot change selection — deal is already ${started.status}` }, 409);
  const body = await c.req.json().catch(() => ({}));
  const allowed = parseAllowed(gate.inv.allowed_deal_types);
  // Recompute server-side from profile so the client cannot fabricate
  // tier grants. Accept either `proposal_id` (1-based index into the
  // server-recomputed proposals array, per the X-2 spec) OR `deal_type`
  // (backward-compat path used by curl-driven flows).
  const profile: any = await c.env.DB.prepare(
    `SELECT * FROM partner_profiles WHERE invitation_id = ?`,
  ).bind(gate.inv.id).first();
  if (!profile) return c.json({ error: 'Submit profile first' }, 412);
  const proposals = buildProposals(allowed, profile);

  let chosen: PartnerProposalDraft | undefined;
  if (body.proposal_id != null) {
    const idx = Number(body.proposal_id) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= proposals.length) {
      return c.json({ error: 'proposal_id out of range', count: proposals.length }, 400);
    }
    chosen = proposals[idx];
  } else if (body.deal_type) {
    const dealType = String(body.deal_type).toLowerCase() as PartnerDealType;
    if (!allowed.includes(dealType)) {
      return c.json({ error: 'Selected deal_type was not offered on this invitation' }, 400);
    }
    chosen = proposals.find(p => p.deal_type === dealType);
  } else {
    return c.json({ error: 'proposal_id or deal_type required' }, 400);
  }
  if (!chosen) return c.json({ error: 'No matching proposal could be generated' }, 400);

  // Prefer updating an existing 'proposed' deal row over inserting duplicates.
  const existing: any = await c.env.DB.prepare(
    `SELECT id FROM partner_deals WHERE invitation_id = ? AND status = 'proposed' ORDER BY id DESC LIMIT 1`,
  ).bind(gate.inv.id).first();
  let dealId: number;
  if (existing?.id) {
    dealId = Number(existing.id);
    await c.env.DB.prepare(
      `UPDATE partner_deals SET deal_type = ?, proposal_json = ?,
              granted_tier_founder = ?, granted_tier_investor = ?, term_months = ?
        WHERE id = ?`,
    ).bind(
      chosen.deal_type, JSON.stringify(chosen),
      chosen.granted_tier_founder, chosen.granted_tier_investor, chosen.term_months, dealId,
    ).run();
  } else {
    const ins: any = await c.env.DB.prepare(
      `INSERT INTO partner_deals
         (invitation_id, deal_type, proposal_json, granted_tier_founder, granted_tier_investor, term_months, status)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed') RETURNING id`,
    ).bind(
      gate.inv.id, chosen.deal_type, JSON.stringify(chosen),
      chosen.granted_tier_founder, chosen.granted_tier_investor, chosen.term_months,
    ).first();
    dealId = Number(ins.id);
  }
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET status = 'selected' WHERE id = ?`,
  ).bind(gate.inv.id).run();
  await audit(c.env, gate.inv, 'partner_proposal_selected', { deal_id: dealId, deal_type: chosen.deal_type });
  return c.json({ deal_id: dealId, proposal: chosen });
});

// ---------- POST /:token/finalize ----------

onboard.post('/:token/finalize', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  const gate = gateInvitation(inv);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status as 404 | 409 | 410);
  const deal: any = await c.env.DB.prepare(
    `SELECT id, deal_type, term_months, envelope_id, status, proposal_json
       FROM partner_deals WHERE invitation_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(gate.inv.id).first();
  if (!deal) return c.json({ error: 'Select a proposal before finalizing' }, 412);
  if (deal.envelope_id) {
    // Idempotent — return the existing signing URL via esign route.
    const env: any = await c.env.DB.prepare(
      `SELECT er.signing_token FROM esign_recipients er WHERE er.envelope_id = ? LIMIT 1`,
    ).bind(deal.envelope_id).first();
    return c.json({
      envelope_id: deal.envelope_id,
      signing_url: env?.signing_token ? `${c.env.APP_URL || 'https://app.axal.vc'}/esign/${env.signing_token}` : null,
      already_started: true,
    });
  }
  const profile: any = await c.env.DB.prepare(
    `SELECT * FROM partner_profiles WHERE invitation_id = ?`,
  ).bind(gate.inv.id).first();

  const sent = await createAndSendEnvelope(c.env, {
    adminUserId: gate.inv.invited_by_user_id,
    adminName: 'Axal VC',
    recipientUserId: null,
    recipientEmail: gate.inv.recipient_email,
    recipientName: profile?.full_name || gate.inv.recipient_name || gate.inv.recipient_email,
    documentType: 'partner_msa_v1',
    // Required: partitions the createAndSendEnvelope dedupe key so two
    // different partner invitations don't collide on (partner_msa_v1, user_id=null).
    dealId: deal.id,
    appUrl: c.env.APP_URL || 'https://app.axal.vc',
    mergeFields: {
      partner_name: profile?.full_name || gate.inv.recipient_name || gate.inv.recipient_email,
      partner_email: gate.inv.recipient_email,
      effective_date: new Date().toISOString().slice(0, 10),
      deal_type: String(deal.deal_type).replace(/_/g, ' '),
      term_months: String(deal.term_months || 12),
    },
  });
  if (!sent) return c.json({ error: 'Could not start envelope' }, 500);

  await c.env.DB.prepare(
    `UPDATE partner_deals SET envelope_id = ?, status = 'awaiting_signature' WHERE id = ?`,
  ).bind(sent.envelope_id, deal.id).run();
  await c.env.DB.prepare(
    `UPDATE partner_invitations SET status = 'finalized', envelope_id = ? WHERE id = ?`,
  ).bind(sent.envelope_id, gate.inv.id).run();
  await audit(c.env, gate.inv, 'partner_envelope_started', {
    deal_id: deal.id, envelope_id: sent.envelope_id, email_sent: sent.email_sent,
  });
  return c.json({
    envelope_id: sent.envelope_id, envelope_uuid: sent.envelope_uuid,
    signing_url: sent.signing_url, email_sent: sent.email_sent,
  });
});

// ---------- GET /:token/status ----------

onboard.get('/:token/status', async (c) => {
  const inv = await loadInvitation(c.env, c.req.param('token'));
  if (!inv) return c.json({ error: 'Invitation not found' }, 404);
  // Reject revoked / expired tokens — bearers of stale magic links
  // must not be able to read the deal record (which carries the
  // PART-XXXX referral code and granted-tier metadata).
  if (inv.status === 'revoked') return c.json({ error: 'Invitation has been revoked' }, 410);
  if (isExpired(inv) && inv.status !== 'signed') {
    return c.json({ error: 'Invitation has expired' }, 410);
  }
  const deal: any = await c.env.DB.prepare(
    `SELECT id, status, envelope_id, activated_at, referral_code FROM partner_deals
       WHERE invitation_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(inv.id).first();
  let envelopeStatus: string | null = null;
  if (deal?.envelope_id) {
    const env: any = await c.env.DB.prepare(
      `SELECT status FROM esign_envelopes WHERE id = ?`,
    ).bind(deal.envelope_id).first();
    envelopeStatus = env?.status || null;
  }
  return c.json({
    invitation_status: inv.status,
    is_expired: isExpired(inv),
    deal: deal || null,
    envelope_status: envelopeStatus,
  });
});

// ---------- helpers ----------

function strOrNull(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}
function safeJsonObject(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export default onboard;
