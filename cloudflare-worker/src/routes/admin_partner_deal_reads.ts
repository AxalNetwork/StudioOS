/**
 * D928 (#2724, part 5 of #2370) — the reads behind one partner deal and
 * behind Referrals. Mounted at `/api/admin/partners` BEFORE `admin_partners`,
 * with the deal id limited to digits, so `GET /deals/top` still reaches its own
 * route there.
 *
 *   GET /deals/:id                    one deal: the row, its invitation, its envelope, its due-diligence
 *                                     case and KYB section, the member's obligations per key, the history
 *   GET /deals/:id/terminate-preview  who would lose a grant if the deal were terminated now
 *   GET /redemptions                  every redemption across deals: filters, sorts, pages, an exact total
 *   GET /agreement-ready              whether the Partner Services agreement can be sent (D923 §2)
 *
 * READ ONLY. Nothing here writes. In particular the trust-score route
 * (`GET /api/trust/score/:userId`) seeds obligations before it reads them, so
 * it is not called; `legal_obligations` is read directly.
 *
 * WHO. `requireAdmin`, as every `/api/admin/partners` read.
 *
 * FAILURES. A missing deal is a 404. Any other failure, in any block, is a 5xx
 * through `mapError`: never a 404, never an empty block that reads as "none".
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { clampLimit } from '../util/pagination';
import { likeNeedleLower } from '../util/likeSearch';
import { AUTO_MERGE_KEYS, templateBodyFor } from './esign';
import { FINALIZE_MERGE_KEYS } from './partner_onboarding';
import { mergeTokensIn } from '../services/legalTemplates';

const reads = new Hono<{ Bindings: Env }>();

/** A rev-share redemption's attribution window, as `GET /deals/:id/redemptions` counts it. */
export const ATTRIBUTION_DAYS = 365;
/** The obligations activation seeds for a partner (`partnerDeals.ts`), listed first and always answered. */
export const DEAL_OBLIGATION_KEYS = ['partner_msa_v1', 'kyb_v1', 'kyc_v1', 'accreditation_v1'] as const;

const parseJson = (raw: unknown): { ok: true; value: any } | { ok: false } => {
  if (raw == null || raw === '') return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(String(raw)) }; } catch { return { ok: false }; }
};

const DIGITS = '{[0-9]+}';

// ─────────────────────────────────────────────── one deal

reads.get(`/deals/:id${DIGITS}`, async (c) => {
  try {
    await requireAdmin(c);
    const id = Number(c.req.param('id'));
    const deal = await c.env.DB.prepare(
      `SELECT pd.*, u.name AS partner_name, u.email AS partner_email, u.role AS partner_role,
              t.name AS terminated_by_name,
              (SELECT COUNT(*) FROM partner_referral_redemptions WHERE partner_deal_id = pd.id) AS redemptions_total
         FROM partner_deals pd
         LEFT JOIN users u ON u.id = pd.user_id
         LEFT JOIN users t ON t.id = pd.terminated_by_user_id
        WHERE pd.id = ?`,
    ).bind(id).first<Record<string, any>>();
    if (!deal) return c.json({ error: 'not_found', message: 'There is no such deal.' }, 404);

    const proposal = parseJson(deal.proposal_json);
    const { proposal_json: _raw, ...row } = deal;

    const invitation = deal.invitation_id == null ? null : await c.env.DB.prepare(
      `SELECT pi.id, pi.status, pi.recipient_email, pi.recipient_name, pi.invited_by_user_id, u.name AS invited_by_name,
              pi.created_at, pi.last_sent_at, pi.send_count, pi.viewed_at, pi.signed_at, pi.expires_at, pi.revoked_at
         FROM partner_invitations pi LEFT JOIN users u ON u.id = pi.invited_by_user_id
        WHERE pi.id = ?`,
    ).bind(deal.invitation_id).first<Record<string, any>>();

    const envelope = deal.envelope_id == null ? null : await c.env.DB.prepare(
      `SELECT e.id, e.envelope_uuid, e.status, e.created_at AS sent_at, e.completed_at,
              (SELECT MAX(r.token_expires_at) FROM esign_recipients r WHERE r.envelope_id = e.id) AS signing_link_expires_at,
              (SELECT r.status FROM esign_recipients r WHERE r.envelope_id = e.id ORDER BY r.id LIMIT 1) AS recipient_status
         FROM esign_envelopes e WHERE e.id = ?`,
    ).bind(deal.envelope_id).first<Record<string, any>>();

    // Activation opens one case with no deal id (`partnerDeals.ts`): match on
    // the member, and on a case opened at or after this deal's activation.
    let dueDiligence: Record<string, unknown>;
    if (deal.user_id == null || !deal.activated_at) {
      dueDiligence = { match: 'not_activated', case: null, candidates: [] };
    } else {
      const cases = ((await c.env.DB.prepare(
        `SELECT dc.uid, dc.status, dc.created_at,
                (SELECT s.status FROM dd_sections s WHERE s.case_id = dc.id AND s.section_key = 'kyb_entity' ORDER BY s.id LIMIT 1) AS kyb_status,
                (SELECT s.verdict FROM dd_sections s WHERE s.case_id = dc.id AND s.section_key = 'kyb_entity' ORDER BY s.id LIMIT 1) AS kyb_verdict,
                EXISTS (SELECT 1 FROM dd_sections s WHERE s.case_id = dc.id AND s.section_key = 'kyb_entity') AS has_kyb
           FROM dd_cases dc
          WHERE dc.subject_type = 'partner' AND dc.subject_id = ? AND julianday(dc.created_at) >= julianday(?)
          ORDER BY dc.created_at, dc.id`,
      ).bind(deal.user_id, deal.activated_at).all<Record<string, any>>()).results || []);
      const shape = (k: Record<string, any>) => ({
        uid: k.uid, status: k.status, opened_at: k.created_at,
        kyb: Number(k.has_kyb) ? { status: k.kyb_status, verdict: k.kyb_verdict ?? null } : null,
      });
      dueDiligence = cases.length === 1
        ? { match: 'one', case: shape(cases[0]), candidates: [] }
        : cases.length === 0
          ? { match: 'none', case: null, candidates: [] }
          // Two cases could be this deal's (a second deal for the same member, or a case opened by hand):
          // say so, and name both, rather than pick one.
          : { match: 'ambiguous', case: null, candidates: cases.map(shape) };
    }

    let obligations: Array<Record<string, unknown>> | null = null;
    if (deal.user_id != null) {
      const rows = ((await c.env.DB.prepare(
        `SELECT obligation_key, required, status, expires_at, evidence_envelope_uuid, updated_at
           FROM legal_obligations WHERE user_id = ? ORDER BY obligation_key`,
      ).bind(deal.user_id).all<Record<string, any>>()).results || []);
      const by = new Map(rows.map((r) => [String(r.obligation_key), r]));
      const one = (key: string, r: Record<string, any> | undefined) => (r
        ? { key, recorded: true, required: Number(r.required) === 1, status: r.status, expires_at: r.expires_at ?? null, evidence_envelope_uuid: r.evidence_envelope_uuid ?? null, updated_at: r.updated_at ?? null }
        // Activation seeds these four; a key with no row was never seeded, which is not "satisfied".
        : { key, recorded: false, required: null, status: null, expires_at: null, evidence_envelope_uuid: null, updated_at: null });
      obligations = [
        ...DEAL_OBLIGATION_KEYS.map((k) => one(k, by.get(k))),
        ...rows.filter((r) => !(DEAL_OBLIGATION_KEYS as readonly string[]).includes(String(r.obligation_key))).map((r) => one(String(r.obligation_key), r)),
      ];
    }

    // The history: the row's own dates, and the audit rows that name this deal.
    const audit = ((await c.env.DB.prepare(
      `SELECT a.action, a.filters_json AS detail, a.exported_at AS at, a.admin_user_id AS by_user_id, u.name AS by_name, 'admin_audit_log' AS source
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action IN ('partner_deal_terminated', 'partner_deal_activation_retried')
          AND json_valid(a.filters_json) AND json_extract(a.filters_json, '$.deal_id') = ?
       UNION ALL
       SELECT l.action, l.details AS detail, l.created_at AS at, NULL AS by_user_id, NULL AS by_name, 'activity_logs' AS source
         FROM activity_logs l
        WHERE l.action = 'partner_deal_activated' AND json_valid(l.details) AND json_extract(l.details, '$.deal_id') = ?
        ORDER BY at, action`,
    ).bind(id, id).all<Record<string, any>>()).results || []);
    const history: Array<Record<string, unknown>> = [];
    history.push({ kind: 'created', at: deal.created_at, by_user_id: null, by_name: null, reason: null, source: 'partner_deals' });
    if (deal.activation_failed_at) history.push({ kind: 'activation_failed', at: deal.activation_failed_at, by_user_id: null, by_name: null, reason: deal.activation_error ?? null, source: 'partner_deals' });
    if (deal.activated_at) history.push({ kind: 'activated', at: deal.activated_at, by_user_id: null, by_name: null, reason: null, source: 'partner_deals' });
    for (const a of audit) {
      if (a.action === 'partner_deal_activation_retried') {
        const d = parseJson(a.detail);
        history.push({ kind: 'activation_retried', at: a.at, by_user_id: a.by_user_id, by_name: a.by_name ?? null, reason: null, outcome: d.ok && d.value ? (d.value.failed ? 'failed' : d.value.activated ? 'activated' : 'not_activated') : null, source: a.source });
      }
    }
    if (deal.terminated_at) {
      history.push({
        kind: 'terminated', at: deal.terminated_at, by_user_id: deal.terminated_by_user_id ?? null,
        by_name: deal.terminated_by_name ?? null, reason: deal.termination_reason ?? null, source: 'partner_deals',
      });
    }
    history.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

    return c.json({
      deal: {
        ...row,
        proposal: proposal.ok ? proposal.value : null,
        proposal_unreadable: !proposal.ok,
        redemptions_total: Number(deal.redemptions_total || 0),
      },
      invitation: invitation ?? null,
      invitation_missing: deal.invitation_id != null && !invitation,
      envelope: envelope ?? null,
      due_diligence: dueDiligence,
      obligations,
      history,
    });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── terminate preview

// The same guards terminate writes with (`admin_partners.ts`): a member's tier
// is reverted only while it is still the one the deal gave, and still that grant.
// The statements are constants, put together here once; no value reaches their text.
const LOSING_FROM = `FROM partner_referral_redemptions prr JOIN users u ON u.id = prr.redeemed_by_user_id
  WHERE prr.partner_deal_id = ?
    AND ((prr.granted_tier_founder IS NOT NULL AND u.subscription_tier = prr.granted_tier_founder AND u.subscription_status = 'partner_referral')
      OR (prr.granted_tier_investor IS NOT NULL AND u.investor_tier = prr.granted_tier_investor AND u.investor_subscription_status = 'partner_referral'))`;
const LOSING_MEMBERS = `SELECT u.id AS user_id, u.name, u.email, u.role,
    (prr.granted_tier_founder IS NOT NULL AND u.subscription_tier = prr.granted_tier_founder AND u.subscription_status = 'partner_referral') AS loses_founder,
    (prr.granted_tier_investor IS NOT NULL AND u.investor_tier = prr.granted_tier_investor AND u.investor_subscription_status = 'partner_referral') AS loses_investor
  ` + LOSING_FROM + ' ORDER BY prr.redeemed_at DESC, prr.id DESC LIMIT 500';

reads.get(`/deals/:id${DIGITS}/terminate-preview`, async (c) => {
  try {
    await requireAdmin(c);
    const id = Number(c.req.param('id'));
    const deal = await c.env.DB.prepare(
      `SELECT pd.id, pd.status, pd.user_id, pd.granted_tier_founder, pd.granted_tier_investor,
              u.subscription_tier, u.subscription_status, u.investor_tier, u.investor_subscription_status,
              (SELECT COUNT(*) FROM partner_referral_redemptions WHERE partner_deal_id = pd.id) AS registered
         FROM partner_deals pd LEFT JOIN users u ON u.id = pd.user_id WHERE pd.id = ?`,
    ).bind(id).first<Record<string, any>>();
    if (!deal) return c.json({ error: 'not_found', message: 'There is no such deal.' }, 404);
    // The same guards terminate writes with (`admin_partners.ts`): a tier is
    // reverted only while it is still the one the deal gave and still that grant.
    const partner = deal.user_id == null ? null : {
      user_id: deal.user_id,
      founder_still_granted: deal.granted_tier_founder != null && deal.subscription_tier === deal.granted_tier_founder && deal.subscription_status === 'partner_grant',
      investor_still_granted: deal.granted_tier_investor != null && deal.investor_tier === deal.granted_tier_investor && deal.investor_subscription_status === 'partner_grant',
    };
    const total = await c.env.DB.prepare('SELECT COUNT(*) AS n ' + LOSING_FROM).bind(id).first<{ n: number }>();
    const members = ((await c.env.DB.prepare(LOSING_MEMBERS).bind(id).all<Record<string, any>>()).results || [])
      .map((m) => ({ ...m, loses_founder: Number(m.loses_founder) === 1, loses_investor: Number(m.loses_investor) === 1 }));
    const losing = Number(total?.n || 0);
    return c.json({
      deal_id: deal.id,
      status: deal.status,
      can_terminate: deal.status === 'active',
      partner,
      registered: Number(deal.registered || 0),
      members_losing: losing,
      members,
      members_truncated: losing > members.length,
    });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── redemptions across deals

// Every filter is a bound `(? IS NULL OR …)`, so one statement serves every
// combination and no value reaches the SQL text. 365 is ATTRIBUTION_DAYS; a
// test holds the two equal. The statements are constants put together once.
const REDEMPTIONS_FROM = `FROM partner_referral_redemptions prr
  JOIN partner_deals pd ON pd.id = prr.partner_deal_id
  LEFT JOIN users m ON m.id = prr.redeemed_by_user_id
  LEFT JOIN users p ON p.id = pd.user_id
  WHERE (? IS NULL OR prr.attribution_kind = ?)
    AND (? IS NULL OR pd.user_id = ?)
    AND (? IS NULL OR prr.partner_deal_id = ?)
    AND (? IS NULL OR (pd.deal_type = 'deal_sourcing_revshare'
         AND julianday(prr.redeemed_at) + 365 >= julianday('now')
         AND julianday(prr.redeemed_at) + 365 <= julianday('now') + ?))
    AND (? IS NULL OR date(prr.redeemed_at) >= ?)
    AND (? IS NULL OR date(prr.redeemed_at) <= ?)
    AND (? IS NULL OR lower(COALESCE(m.name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(m.email, '')) LIKE ? ESCAPE '\\'
         OR lower(COALESCE(p.name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(p.email, '')) LIKE ? ESCAPE '\\'
         OR lower(COALESCE(pd.referral_code, '')) LIKE ? ESCAPE '\\')`;
const REDEMPTIONS_SELECT = `SELECT prr.id, prr.redeemed_at, prr.granted_tier_founder, prr.granted_tier_investor, prr.granted_until, prr.attribution_kind,
    m.id AS member_user_id, m.name AS member_name, m.email AS member_email, m.role AS member_role,
    pd.id AS deal_id, pd.deal_type, pd.status AS deal_status, pd.referral_code,
    p.id AS partner_user_id, p.name AS partner_name, p.email AS partner_email
  `;
export const REDEMPTION_SORTS: Record<string, string> = {
  newest: REDEMPTIONS_SELECT + REDEMPTIONS_FROM + ' ORDER BY prr.redeemed_at DESC, prr.id DESC LIMIT ? OFFSET ?',
  // Open windows first, the soonest to close first; plain referrals and closed windows after.
  window: REDEMPTIONS_SELECT + REDEMPTIONS_FROM + ` ORDER BY CASE WHEN pd.deal_type = 'deal_sourcing_revshare'
      AND julianday(prr.redeemed_at) + 365 >= julianday('now') THEN 0 ELSE 1 END, julianday(prr.redeemed_at) ASC, prr.id LIMIT ? OFFSET ?`,
  partner: REDEMPTIONS_SELECT + REDEMPTIONS_FROM + " ORDER BY lower(COALESCE(p.name, p.email, '')) ASC, prr.redeemed_at DESC, prr.id DESC LIMIT ? OFFSET ?",
};
const REDEMPTIONS_COUNT = 'SELECT COUNT(*) AS n ' + REDEMPTIONS_FROM;

reads.get('/redemptions', async (c) => {
  try {
    await requireAdmin(c);
    const q = (k: string) => (c.req.query(k) || '').trim();
    const attribution = q('attribution') || null;
    if (attribution && !['referral', 'deal_sourcing_revshare'].includes(attribution)) {
      return c.json({ error: 'invalid_attribution', message: 'attribution is referral or deal_sourcing_revshare.' }, 400);
    }
    const id = (k: string, what: string) => {
      const v = q(k);
      if (!v) return { ok: true as const, value: null };
      return /^\d+$/.test(v) ? { ok: true as const, value: Number(v) } : { ok: false as const, message: `${k} is ${what}.` };
    };
    const partner = id('partner', "the partner's user id");
    const deal = id('deal', 'a deal id');
    for (const v of [partner, deal]) if (!v.ok) return c.json({ error: 'invalid_filter', message: v.message }, 400);
    const withinRaw = q('window_within');
    if (withinRaw && (!/^\d+$/.test(withinRaw) || Number(withinRaw) > ATTRIBUTION_DAYS)) {
      return c.json({ error: 'invalid_window', message: `window_within is a number of days, 0 to ${ATTRIBUTION_DAYS}.` }, 400);
    }
    const within = withinRaw ? Number(withinRaw) : null;
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const from = q('from') || null;
    const to = q('to') || null;
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return c.json({ error: 'invalid_date', message: 'from and to are dates, YYYY-MM-DD.' }, 400);
    const needle = likeNeedleLower(q('q')) ?? null;
    const sortKey = q('sort') || 'newest';
    const sql = REDEMPTION_SORTS[sortKey];
    if (!sql) return c.json({ error: 'invalid_sort', message: `sort is one of ${Object.keys(REDEMPTION_SORTS).join(', ')}.` }, 400);
    const limit = clampLimit(c.req.query('limit'), 25, 100);
    const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
    const binds = [
      attribution, attribution,
      (partner as any).value, (partner as any).value,
      (deal as any).value, (deal as any).value,
      within, within,
      from, from, to, to,
      needle, needle, needle, needle, needle, needle,
    ];
    const total = await c.env.DB.prepare(REDEMPTIONS_COUNT).bind(...binds).first<{ n: number }>();
    const rows = ((await c.env.DB.prepare(sql).bind(...binds, limit, (page - 1) * limit).all<Record<string, any>>()).results || []);
    const now = Date.now();
    const items = rows.map((r) => {
      let days: number | null = null;
      if (r.deal_type === 'deal_sourcing_revshare' && r.redeemed_at) {
        const raw = String(r.redeemed_at);
        const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
        if (Number.isFinite(t)) days = Math.max(0, Math.ceil((t + ATTRIBUTION_DAYS * 86400000 - now) / 86400000));
      }
      return { ...r, window_days_left: days };
    });
    const n = Number(total?.n || 0);
    return c.json({ items, total: n, page, limit, pages: Math.max(1, Math.ceil(n / limit)), sort: sortKey, attribution_days: ATTRIBUTION_DAYS });
  } catch (e) { return mapError(c, e); }
});

// ─────────────────────────────────────────────── agreement ready

/** The keys a Partner Services send fills: finalize's own, and the envelope's from the recipient and the date. */
export const AGREEMENT_FILLED_KEYS: ReadonlySet<string> = new Set([...FINALIZE_MERGE_KEYS, ...AUTO_MERGE_KEYS]);

/**
 * D923 §2's rule: the agreement cannot be sent while the template has no body,
 * or names a field the send leaves empty: anything outside what finalize and
 * the envelope fill, including every `counterparty.*` key (finalize sends with
 * no recipient user, so those stay empty). When the template cannot be read,
 * nothing is said either way: a 503 with `ready: null`.
 */
reads.get('/agreement-ready', async (c) => {
  try {
    await requireAdmin(c);
    // `templateBodyFor` answers null when there is no body, and throws only when the store cannot be read.
    let resolved: Awaited<ReturnType<typeof templateBodyFor>>;
    try {
      resolved = await templateBodyFor(c.env, 'partner_services');
    } catch {
      return c.json({ ready: null, reason: 'unreadable', fields: [], message: 'The Partner Services template could not be read, so whether it is ready is not known. Try again in a moment.' }, 503);
    }
    if (!resolved) return c.json({ ready: false, reason: 'no_body', fields: [] });
    const unfilled = [...mergeTokensIn(resolved.body)].filter((k) => !AGREEMENT_FILLED_KEYS.has(k));
    if (unfilled.length) {
      return c.json({ ready: false, reason: 'unfilled_fields', fields: unfilled.map((key) => ({ key, label: key.replace(/[._]+/g, ' ').trim().replace(/^./, (x) => x.toUpperCase()) })) });
    }
    return c.json({ ready: true, reason: null, fields: [] });
  } catch (e) { return mapError(c, e); }
});

export default reads;
