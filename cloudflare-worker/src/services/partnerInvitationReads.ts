/**
 * D927 / #2723 — Partner invitations part 4: the reads behind the Overview
 * (PI1) and behind one invitation (PI3), and the offer preview (PI4).
 *
 * READ ONLY. Nothing here writes a row, logs a view or calls the invitee's
 * token routes (which move Sent to Opened). The profile's answers are not
 * returned: they stay a separate, logged read (D923 §3).
 *
 * The words and rules are D923 §2's:
 *   · open      — status sent, viewed, profiled, proposed, selected or
 *                 finalized, and the link has not lapsed;
 *   · lapsed    — one of those statuses with `expires_at` passed. A stored
 *                 `expired` keeps its own meaning (signed after the link
 *                 lapsed, deal voided) and is not lapsed;
 *   · the agreement-ready rule — the Partner Services body cannot be read or
 *     has none, or it holds a field finalize leaves empty: a sender field
 *     outside the five finalize fills, or any `counterparty.*` field.
 * D1's zone-less stamps are UTC.
 *
 * Each overview block answers alone in D893's shape: `{ available: true, … }`
 * or `{ available: false, unreadable: true, reason }`, never zeros.
 */
import type { Env } from '../types';
import { ALL_PARTNER_DEAL_TYPES, buildProposals, type PartnerDealType } from './partnerDeals';
import { isAutoMergeKey, templateBodyFor } from '../routes/esign';
import { mergeTokensIn } from './mergeFields';

type Unreadable = { available: false; unreadable: true; reason: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
export const CHART_WEEKS = 12;
export const MEDIAN_OVER_SIGNED = 10;
export const OPEN_STAGES = ['sent', 'viewed', 'profiled', 'proposed', 'selected', 'finalized'] as const;
export const DEAL_STATES = ['proposed', 'awaiting_signature', 'active', 'term_over', 'terminated', 'expired', 'voided'] as const;
export const ATTRIBUTIONS = ['referral', 'deal_sourcing_revshare'] as const;
/** The five fields finalize fills (`routes/partner_onboarding.ts`). */
export const FINALIZE_FILLS = new Set(['partner_name', 'partner_email', 'effective_date', 'deal_type', 'term_months']);
const REVSHARE_WINDOW_DAYS = 365;

/** The onboarding activity row each stage is entered with (`partner_onboarding.ts`). */
const STEP_ACTIONS = {
  viewed: 'partner_invitation_viewed',
  profiled: 'partner_profile_saved',
  proposed: 'partner_proposals_generated',
  selected: 'partner_proposal_selected',
  finalized: 'partner_envelope_started',
} as const;

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[partner-invitation-reads]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return {
    available: false,
    unreadable: true,
    reason: `${what} could not be read on this database. That is not the same as none.`,
  };
};

async function block<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}

function once<T>(read: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= read());
}

async function all(env: Env, sql: string, binds: unknown[] = []): Promise<any[]> {
  const r: any = await env.DB.prepare(sql).bind(...binds).all();
  if ((r && 'success' in r && !r.success) || !Array.isArray(r?.results)) throw new Error('rows were not returned');
  return r.results;
}

export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const v = value.trim();
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : v.replace(' ', 'T') + 'Z');
}
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

const isOpenStage = (s: unknown) => (OPEN_STAGES as readonly string[]).includes(String(s));
export const isLapsed = (inv: { status?: unknown; expires_at?: unknown }, now: number) =>
  isOpenStage(inv.status) && timestamp(inv.expires_at) < now;
export const isOpen = (inv: { status?: unknown; expires_at?: unknown }, now: number) =>
  isOpenStage(inv.status) && !(timestamp(inv.expires_at) < now);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── the agreement-ready rule (D923 §2), on the Worker ──────────────────────

export type AgreementReadiness =
  | { state: 'ready' }
  | { state: 'not_ready'; why: 'template_has_no_body' | 'template_unreadable' | 'fields'; fields?: string[] };

export async function agreementReadiness(env: Env): Promise<AgreementReadiness> {
  let resolved: Awaited<ReturnType<typeof templateBodyFor>>;
  try {
    resolved = await templateBodyFor(env, 'partner_services');
  } catch {
    return { state: 'not_ready', why: 'template_unreadable' };
  }
  if (!resolved) return { state: 'not_ready', why: 'template_has_no_body' };
  const unfilled = [...mergeTokensIn(resolved.body)]
    .filter((k) => k.startsWith('counterparty.') || (!isAutoMergeKey(k) && !FINALIZE_FILLS.has(k)));
  return unfilled.length ? { state: 'not_ready', why: 'fields', fields: unfilled } : { state: 'ready' };
}

// ── shared reads ───────────────────────────────────────────────────────────

/** First and latest time each invitation's onboarding step was recorded. */
async function readStepRows(env: Env, invitationId: number | null) {
  const rows = await all(env,
    `SELECT CAST(json_extract(details, '$.invitation_id') AS INTEGER) AS invitation_id, action,
            MIN(created_at) AS first_at, MAX(created_at) AS last_at, COUNT(*) AS n
       FROM activity_logs
      WHERE action IN ('partner_invitation_viewed','partner_profile_saved','partner_proposals_generated',
                       'partner_proposal_selected','partner_envelope_started')
        AND json_valid(details)
        AND (? IS NULL OR CAST(json_extract(details, '$.invitation_id') AS INTEGER) = ?)
      GROUP BY 1, 2`, [invitationId, invitationId]);
  const by = new Map<number, Record<string, { first_at: string; last_at: string; n: number }>>();
  for (const r of rows) {
    const id = Number(r.invitation_id);
    if (!Number.isFinite(id)) continue;
    const m = by.get(id) ?? {};
    m[r.action] = { first_at: r.first_at, last_at: r.last_at, n: Number(r.n) };
    by.set(id, m);
  }
  return by;
}

/** When the invitation entered the stage it is in now, or NaN when no row says. */
function enteredStageAt(inv: any, steps: Record<string, { last_at: string }> | undefined): number {
  if (inv.status === 'sent') return timestamp(inv.created_at);
  if (inv.status === 'viewed') {
    const v = timestamp(inv.viewed_at);
    return Number.isFinite(v) ? v : timestamp(steps?.[STEP_ACTIONS.viewed]?.last_at);
  }
  const action = (STEP_ACTIONS as Record<string, string>)[inv.status];
  return action ? timestamp(steps?.[action]?.last_at) : Number.NaN;
}

// ── GET /api/admin/partners/overview ───────────────────────────────────────

export async function readOverview(env: Env, now = Date.now()) {
  const invitations = once(() => all(env,
    `SELECT id, status, created_at, expires_at, viewed_at, signed_at, revoked_at, envelope_id,
            last_sent_at, last_send_ok, last_send_reason
       FROM partner_invitations`));
  const deals = once(() => all(env,
    `SELECT id, invitation_id, user_id, deal_type, status, expires_at, activated_at, created_at FROM partner_deals`));
  const redemptions = once(() => all(env,
    `SELECT partner_deal_id, attribution_kind, redeemed_at FROM partner_referral_redemptions`));
  const steps = once(() => readStepRows(env, null));

  const currentMonday = mondayOf(now);
  const chartStart = currentMonday - (CHART_WEEKS - 1) * WEEK;
  const weekIndex = (ms: number) => (ms >= chartStart && ms < currentMonday + WEEK ? Math.floor((ms - chartStart) / WEEK) : -1);
  const weeks = () => Array.from({ length: CHART_WEEKS }, (_, i) => ({ week_start: isoDay(chartStart + i * WEEK), ...(i === CHART_WEEKS - 1 ? { to_date: true } : {}) }));
  const dealState = (d: any) => (d.status === 'active' && timestamp(d.expires_at) < now ? 'term_over' : d.status);

  const tiles = {
    open: await block('The open invitations', async () => {
      const rows = (await invitations()).filter((i) => isOpen(i, now));
      const first = rows.map((i) => timestamp(i.created_at)).filter(Number.isFinite);
      return { count: rows.length, oldest_first_sent_at: first.length ? iso(Math.min(...first)) : null };
    }),
    lapsed: await block('The lapsed invitations', async () => ({ count: (await invitations()).filter((i) => isLapsed(i, now)).length })),
    signed_90d: await block('The signed invitations', async () => ({
      count: (await invitations()).filter((i) => timestamp(i.signed_at) >= now - 90 * DAY).length,
    })),
    days_to_sign: await block('The days from first send to signed', async () => {
      const signed = (await invitations())
        .filter((i) => Number.isFinite(timestamp(i.signed_at)) && Number.isFinite(timestamp(i.created_at)))
        .sort((a, b) => timestamp(b.signed_at) - timestamp(a.signed_at))
        .slice(0, MEDIAN_OVER_SIGNED);
      const days = signed.map((i) => (timestamp(i.signed_at) - timestamp(i.created_at)) / DAY);
      const m = median(days);
      // None signed is "None signed yet", never a median of zero.
      return { median_days: m == null ? null : Math.round(m * 10) / 10, over_signed: signed.length };
    }),
    active_deals: await block('The active deals', async () => {
      const active = (await deals()).filter((d) => d.status === 'active');
      const ending = active.filter((d) => { const t = timestamp(d.expires_at); return t >= now && t <= now + 30 * DAY; });
      return { count: active.length, ending_within_30d: ending.length, term_over_not_closed: active.filter((d) => timestamp(d.expires_at) < now).length };
    }),
    awaiting_signature: await block('The agreements awaiting signature', async () => {
      const inv = new Map((await invitations()).map((i) => [Number(i.id), i]));
      const rows = (await deals()).filter((d) => d.status === 'awaiting_signature');
      // A signature on a lapsed invitation's agreement is voided at activation.
      return { count: rows.length, invitation_lapsed: rows.filter((d) => { const i = inv.get(Number(d.invitation_id)); return !!i && isLapsed(i, now); }).length };
    }),
    redemptions_90d: await block('The referral redemptions', async () => ({
      count: (await redemptions()).filter((r) => timestamp(r.redeemed_at) >= now - 90 * DAY).length,
    })),
    failed_sends_30d: await block('The failed sends', async () => {
      // Part 1's columns hold each invitation's latest send, so this counts
      // invitations whose latest send in the last 30 days did not go.
      const rows = (await invitations()).filter((i) => Number(i.last_send_ok) === 0 && i.last_send_ok != null && timestamp(i.last_sent_at) >= now - 30 * DAY);
      const by_reason: Record<string, number> = {};
      for (const r of rows) by_reason[r.last_send_reason ?? 'not_recorded'] = (by_reason[r.last_send_reason ?? 'not_recorded'] || 0) + 1;
      return { count: rows.length, by_reason };
    }),
  };

  const needsKinds = {
    lapsed: await block('The lapsed invitations', async () => ({
      rows: (await invitations()).filter((i) => isLapsed(i, now)).map((i) => ({ kind: 'lapsed', id: Number(i.id), stage: i.status, lapsed_at: i.expires_at })),
    })),
    agreement_blocked: await block('The agreement check', async () => {
      const ready = await agreementReadiness(env);
      const at = (await invitations()).filter((i) => i.status === 'selected' && isOpen(i, now));
      return {
        agreement: ready,
        rows: ready.state === 'not_ready' ? at.map((i) => ({ kind: 'agreement_blocked', id: Number(i.id) })) : [],
      };
    }),
    failed_send: await block('The failed sends', async () => ({
      rows: (await invitations())
        .filter((i) => isOpenStage(i.status) && i.last_send_ok != null && Number(i.last_send_ok) === 0)
        .map((i) => ({ kind: 'failed_send', id: Number(i.id), reason: i.last_send_reason ?? null, last_sent_at: i.last_sent_at ?? null })),
    })),
    deal_ending: await block('The deals ending soon', async () => ({
      rows: (await deals())
        .filter((d) => d.status === 'active' && timestamp(d.expires_at) >= now && timestamp(d.expires_at) <= now + 30 * DAY)
        .map((d) => ({ kind: 'deal_ending', id: Number(d.id), ends_at: d.expires_at })),
    })),
    unattached_account: await block('The partner accounts', async () => ({
      rows: (await all(env, `SELECT id FROM users WHERE role = 'partner' AND partner_id IS NULL ORDER BY id`))
        .map((u) => ({ kind: 'unattached_account', id: Number(u.id) })),
    })),
    due_diligence_open: await block('The due-diligence cases', async () => {
      const cases = await all(env,
        `SELECT id, uid, subject_id, status FROM dd_cases WHERE subject_type = 'partner' AND status IN ('open','in_review')`);
      const bySubject = new Map(cases.map((k) => [Number(k.subject_id), k]));
      return {
        rows: (await deals())
          .filter((d) => d.user_id != null && d.status === 'active' && bySubject.has(Number(d.user_id)))
          .map((d) => ({ kind: 'due_diligence_open', id: Number(d.id), case_uid: bySubject.get(Number(d.user_id))!.uid, case_status: bySubject.get(Number(d.user_id))!.status })),
      };
    }),
    revshare_closing: await block('The rev-share windows', async () => {
      const per = new Map<number, number>();
      for (const r of await redemptions()) {
        if (r.attribution_kind !== 'deal_sourcing_revshare') continue;
        const closes = timestamp(r.redeemed_at) + REVSHARE_WINDOW_DAYS * DAY;
        if (closes >= now && closes <= now + 30 * DAY) per.set(Number(r.partner_deal_id), (per.get(Number(r.partner_deal_id)) || 0) + 1);
      }
      return { rows: [...per.entries()].sort((a, b) => a[0] - b[0]).map(([id, windows]) => ({ kind: 'revshare_closing', id, windows })) };
    }),
  };
  const needs_you = {
    available: true as const,
    kinds: needsKinds,
    rows: Object.values(needsKinds).flatMap((k: any) => (k.available ? k.rows : [])),
    // A kind that could not be read is named, so the total is never taken as complete.
    unreadable_kinds: Object.entries(needsKinds).filter(([, k]: any) => !k.available).map(([kind]) => kind),
  };

  const c1 = await block('Where open invitations stand', async () => {
    const stepRows = await steps();
    const stages = Object.fromEntries(OPEN_STAGES.map((s) => [s, { count: 0, oldest_entered_at: null as string | null, oldest_days: null as number | null, entered_not_recorded: 0 }]));
    for (const i of await invitations()) {
      if (!isOpen(i, now)) continue;
      const st = stages[i.status];
      st.count++;
      const at = enteredStageAt(i, stepRows.get(Number(i.id)));
      if (!Number.isFinite(at)) { st.entered_not_recorded++; continue; }
      if (st.oldest_entered_at == null || at < timestamp(st.oldest_entered_at)) {
        st.oldest_entered_at = iso(at);
        st.oldest_days = Math.max(0, Math.floor((now - at) / DAY));
      }
    }
    const inv = await invitations();
    return {
      stages,
      closed: {
        signed: inv.filter((i) => i.status === 'signed').length,
        lapsed: inv.filter((i) => isLapsed(i, now)).length,
        revoked: inv.filter((i) => i.status === 'revoked').length,
        // Stored `expired`: signed after the link lapsed, deal voided.
        signed_after_lapse: inv.filter((i) => i.status === 'expired').length,
      },
    };
  });

  const c2 = await block('Invitations sent and signed per week', async () => {
    const w = weeks().map((x) => ({ ...x, sent: 0, signed: 0 }));
    for (const i of await invitations()) {
      const s = weekIndex(timestamp(i.created_at)); if (s >= 0) w[s].sent++;
      const g = weekIndex(timestamp(i.signed_at)); if (g >= 0) w[g].signed++;
    }
    return { weeks: w };
  });

  const c3 = await block('Deals by type and state', async () => {
    const by: Record<string, Record<string, number>> = {};
    for (const t of ALL_PARTNER_DEAL_TYPES) by[t] = { ...Object.fromEntries(DEAL_STATES.map((s) => [s, 0])), other: 0 };
    for (const d of await deals()) {
      const t = (ALL_PARTNER_DEAL_TYPES as string[]).includes(d.deal_type) ? d.deal_type : null;
      if (!t) continue;
      const s = dealState(d);
      if ((DEAL_STATES as readonly string[]).includes(s)) by[t][s]++; else by[t].other++;
    }
    return { by_type: by };
  });

  const c4 = await block('Redemptions per week', async () => {
    const w = weeks().map((x) => ({ ...x, referral: 0, deal_sourcing_revshare: 0, other: 0 }));
    for (const r of await redemptions()) {
      const k = weekIndex(timestamp(r.redeemed_at));
      if (k < 0) continue;
      if (r.attribution_kind === 'referral' || r.attribution_kind === 'deal_sourcing_revshare') w[k][r.attribution_kind as 'referral' | 'deal_sourcing_revshare']++;
      else w[k].other++;
    }
    return { weeks: w };
  });

  return { as_of: iso(now), tiles, needs_you, c1, c2, c3, c4 };
}

// ── GET /api/admin/partners/invitations/:id ────────────────────────────────

function allowedTypes(raw: unknown): PartnerDealType[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(arr) ? arr.map((t) => String(t).toLowerCase()).filter((t) => (ALL_PARTNER_DEAL_TYPES as string[]).includes(t)) as PartnerDealType[] : [];
  } catch { return []; }
}

const parseJson = (raw: unknown) => { try { return JSON.parse(String(raw)); } catch { return null; } };

export async function readInvitation(env: Env, id: number, now = Date.now()) {
  const inv: any = await env.DB.prepare(
    `SELECT pi.id, pi.recipient_email, pi.recipient_name, pi.allowed_deal_types, pi.personal_message, pi.status,
            pi.expires_at, pi.created_at, pi.viewed_at, pi.signed_at, pi.resulting_user_id, pi.resulting_deal_id,
            pi.envelope_id, pi.revoked_at, pi.last_sent_at, pi.send_count, pi.last_send_ok, pi.last_send_reason,
            u.name AS invited_by_name
       FROM partner_invitations pi LEFT JOIN users u ON u.id = pi.invited_by_user_id
      WHERE pi.id = ?`,
  ).bind(id).first();
  if (!inv) return null;

  const steps = await block('The step dates', async () => {
    const s = (await readStepRows(env, id)).get(id) ?? {};
    const first = (a: string) => s[a]?.first_at ?? null;
    return {
      sent: inv.created_at ?? null,
      opened: inv.viewed_at ?? first(STEP_ACTIONS.viewed),
      profile_done: first(STEP_ACTIONS.profiled),
      offers_shown: first(STEP_ACTIONS.proposed),
      offer_chosen_first: first(STEP_ACTIONS.selected),
      offer_chosen_latest: s[STEP_ACTIONS.selected]?.last_at ?? null,
      agreement_out: first(STEP_ACTIONS.finalized),
      signed: inv.signed_at ?? null,
    };
  });

  const offers_seen = await block('The offers the invitee saw', async () => {
    const shown = ((await readStepRows(env, id)).get(id) ?? {})[STEP_ACTIONS.proposed];
    const profile: any = await env.DB.prepare(`SELECT * FROM partner_profiles WHERE invitation_id = ?`).bind(id).first();
    // Offers are computed, never stored: shown only once the invitee asked for them.
    if (!shown || !profile) return { shown: false, offers: null };
    return { shown: true, offers: buildProposals(allowedTypes(inv.allowed_deal_types), profile) };
  });

  const chosen_deal = await block('The chosen deal', async () => {
    const deal: any = await env.DB.prepare(
      `SELECT id, deal_type, status, term_months, granted_tier_founder, granted_tier_investor, proposal_json,
              envelope_id, created_at, activated_at, expires_at, void_reason
         FROM partner_deals WHERE invitation_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(id).first();
    if (!deal) return { deal: null, envelope: null };
    const envelopeId = deal.envelope_id ?? inv.envelope_id ?? null;
    let envelope: any = null;
    if (envelopeId != null) {
      const e: any = await env.DB.prepare(`SELECT id, status, created_at, completed_at FROM esign_envelopes WHERE id = ?`).bind(envelopeId).first();
      // The partner's own pending signing link: its expiry only, never the token.
      const r: any = await env.DB.prepare(
        `SELECT token_expires_at FROM esign_recipients WHERE envelope_id = ? AND LOWER(recipient_email) = LOWER(?) AND status = 'pending'
          ORDER BY id LIMIT 1`,
      ).bind(envelopeId, inv.recipient_email).first();
      envelope = e ? { id: Number(e.id), status: e.status, sent_at: e.created_at ?? null, completed_at: e.completed_at ?? null,
        signing_link_expires_at: r?.token_expires_at ?? null } : null;
    }
    const { proposal_json, ...rest } = deal;
    return { deal: { ...rest, proposal: parseJson(proposal_json) }, envelope };
  });

  const agreement_refusals = await block('The agreement refusals', async () => {
    const rows = await all(env,
      `SELECT created_at, details FROM activity_logs
        WHERE action = 'partner_envelope_refused' AND json_valid(details)
          AND CAST(json_extract(details, '$.invitation_id') AS INTEGER) = ?
        ORDER BY created_at, id`, [id]);
    return { items: rows.map((r) => { const d = parseJson(r.details) || {}; return { at: r.created_at, code: d.code ?? null, fields: Array.isArray(d.fields) ? d.fields : [] }; }) };
  });

  const history = await block('The admin history', async () => {
    const rows = await all(env,
      `SELECT a.id, a.action, a.exported_at, a.filters_json, u.name AS admin_name
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action IN ('partner_invitation_created','partner_invitation_resent','partner_invitation_revoked')
          AND json_valid(a.filters_json)
          AND CAST(json_extract(a.filters_json, '$.invitation_id') AS INTEGER) = ?
        ORDER BY a.exported_at, a.id`, [id]);
    const items: any[] = rows.map((r) => {
      const d = parseJson(r.filters_json) || {};
      const action = String(r.action).replace('partner_invitation_', '');
      const item: Record<string, unknown> = { at: r.exported_at, action, by: r.admin_name ?? null };
      if (action !== 'revoked') item.email_sent = typeof d.email_sent === 'boolean' ? d.email_sent : null;
      if (action === 'resent' && 'signing_link' in d) item.signing_link = d.signing_link ?? null;
      if (action === 'revoked') item.reason = typeof d.reason === 'string' && d.reason ? d.reason : null;
      return item;
    });
    // D924's signing-link renewals, from the envelope's own audit trail.
    const envelopeIds = new Set<number>();
    if (inv.envelope_id != null) envelopeIds.add(Number(inv.envelope_id));
    const renewals: any[] = [];
    for (const envelopeId of envelopeIds) {
      const ev = await all(env,
        `SELECT e.ts, e.action, e.meta, e.signer_id, u.name AS admin_name FROM esign_audit_events e LEFT JOIN users u ON u.id = e.signer_id
          WHERE e.envelope_id = ? AND e.action IN ('partner_signing_link_renewed','partner_signing_link_renewal_failed')
          ORDER BY e.ts, e.id`, [envelopeId]);
      for (const r of ev) {
        const m = parseJson(r.meta) || {};
        renewals.push({ at: r.ts, action: 'signing_link_renewal', by: r.admin_name ?? null,
          renewed: m.link_renewed === true, previous_link_restored: m.previous_link_restored === true });
      }
    }
    return { items, signing_link_renewals: renewals };
  });

  const { allowed_deal_types, ...row } = inv;
  return {
    invitation: {
      ...row,
      allowed_deal_types: allowedTypes(allowed_deal_types),
      is_lapsed: isLapsed(inv, now),
    },
    steps, offers_seen, chosen_deal, agreement_refusals, history,
  };
}

// ── GET /api/admin/partners/offers/preview?types= ──────────────────────────

/** The phrases `buildProposals` takes from the invitee's profile, per type. */
const PROFILE_DEPENDENT: Record<string, Array<{ field: string; what: string }>> = {
  equity_partnership: [
    { field: 'terms.time_commitment', what: 'equity_hours' },
    { field: 'contract_excerpt', what: 'equity_hours' },
  ],
  capital_partnership: [
    { field: 'terms.capital_commitment_usd', what: 'capital_commitment' },
    { field: 'granted_tier_investor', what: 'capital_tier' },
    { field: 'contract_excerpt', what: 'capital_commitment' },
  ],
  custom: [
    { field: 'terms.description', what: 'custom_text' },
    { field: 'contract_excerpt', what: 'custom_text' },
  ],
};

export function offerPreview(rawTypes: string | undefined) {
  const asked = String(rawTypes ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const unknown = asked.filter((t) => !(ALL_PARTNER_DEAL_TYPES as string[]).includes(t));
  const types = [...new Set(asked.filter((t) => !unknown.includes(t)))] as PartnerDealType[];
  // A neutral profile: every profile-dependent phrase shows its default.
  const offers = buildProposals(types, {}).map((p) => ({ ...p, profile_dependent: PROFILE_DEPENDENT[p.deal_type] ?? [] }));
  return { types, unknown, not_offered: types.slice(3), offers, source: 'worker' as const };
}

