/**
 * D927 (#2723) — the reads behind Partner invitations' Overview and one
 * invitation, part 4 of #2370. The three routes live in `admin_partners.ts`;
 * this file is what they read.
 *
 *   GET /api/admin/partners/overview          → { as_of, tiles, needs_you, c1, c2, c3, c4 }
 *   GET /api/admin/partners/invitations/:id   → { invitation, steps, offers_seen, chosen_deal, refusals, history }
 *   GET /api/admin/partners/offers/preview?types=a,b  → { types, offers }
 *
 * NOTHING HERE CHANGES STATE OR LOGS A VIEW. Every statement is a SELECT. The
 * invitee's token routes flip Sent to Opened and write an activity row, so
 * they are never called; the profile's answers stay a separate, logged read
 * (D923 §3), and the offers an invitee saw carry no answer verbatim (§2).
 *
 * EACH BLOCK FAILS ON ITS OWN (D893's pattern): `{ available: true, … }`, or
 * `{ available: false, reason }` with a sentence, never the database's text
 * and never a zero. Within the tiles and Needs you, each tile and each kind
 * fails alone too.
 *
 * TIME. D1's zone-less stamps (`created_at`, `signed_at`, `redeemed_at`, an
 * activity row's `created_at`) are UTC; `expires_at` and `last_sent_at` carry
 * their Z. Every comparison is made here, on epoch ms, by one rule (`ms`).
 *
 * THE WORDS (D923 §2, Guard I). Stored stages: sent, viewed (Opened),
 * profiled (Profile done), proposed (Offers shown), selected (Offer chosen),
 * finalized (Agreement out), signed, revoked. Lapsed: `expires_at` has passed
 * and the invitation is not signed, revoked or stored `expired`. A stored
 * `expired` keeps its one meaning: signed after the link lapsed, deal voided.
 * Since D924 a resend keeps the stage, so the stored stage is the stage.
 */
import type { Env } from '../types';
import { buildProposals, ALL_PARTNER_DEAL_TYPES, type PartnerDealType, type PartnerProposalDraft } from '../services/partnerDeals';
import { mergeTokensIn } from '../services/mergeFields';
import { isAutoMergeKey, templateBodyFor } from './esign';

const DAY = 86_400_000;
const WEEKS = 12;
export const OPEN_STAGES = ['sent', 'viewed', 'profiled', 'proposed', 'selected', 'finalized'] as const;
/** How many of the most recently signed the median is taken over. */
export const MEDIAN_OVER = 10;
/** D923 §2: "ending soon" is within 30 days on this page. */
export const SOON_DAYS = 30;
const REVSHARE_DAYS = 365;
/** The five fields finalize fills (`partner_onboarding.ts`); the frontend's `FINALIZE_FILLS` is the same list. */
export const FINALIZE_FILLS: readonly string[] = Object.freeze(['partner_name', 'partner_email', 'effective_date', 'deal_type', 'term_months']);

type Block<T extends object> = ({ available: true } & T) | { available: false; reason: string };

/** A stamp as epoch ms. A zone-less D1 stamp is UTC. Null when absent or unparseable. */
export function ms(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  const t = Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
}
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

async function block<T extends object>(what: string, read: () => Promise<T>): Promise<Block<T>> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    console.warn('[admin_partners_reads] %s unreadable:', what, (e as Error)?.message);
    return { available: false, reason: `${what} could not be read. That is not the same as none.` };
  }
}

const all = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results || []) as T[];

/** The Monday 00:00 UTC that starts the week holding `t`. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** The last 12 week starts, oldest first; the last is the current week. */
export function weekStarts(now: number): number[] {
  const current = weekStart(now);
  return Array.from({ length: WEEKS }, (_, i) => current - (WEEKS - 1 - i) * 7 * DAY);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Inv = {
  id: number; recipient_email: string; recipient_name: string | null; status: string; created_at: string; expires_at: string;
  signed_at: string | null; viewed_at: string | null; revoked_at: string | null; envelope_id: number | null;
  last_sent_at: string | null; send_count: number | null; last_send_ok: number | null; last_send_reason: string | null;
};

const INV_COLUMNS = `id, recipient_email, recipient_name, status, created_at, expires_at, signed_at, viewed_at, revoked_at,
  envelope_id, last_sent_at, send_count, last_send_ok, last_send_reason`;

/** Lapsed: the link's time has passed and the invitation is still open (D923 §2). */
export const isLapsed = (inv: { status: string; expires_at: string | null }, now: number) => {
  if (['signed', 'revoked', 'expired'].includes(inv.status)) return false;
  const e = ms(inv.expires_at);
  return e !== null && e < now;
};
export const isOpen = (inv: { status: string; expires_at: string | null }, now: number) =>
  (OPEN_STAGES as readonly string[]).includes(inv.status) && !isLapsed(inv, now);

/** The onboarding activity actions that date each stage (`partner_onboarding.ts` `audit`). */
const STEP_ACTIONS = {
  opened: 'partner_invitation_viewed',
  profile_done: 'partner_profile_saved',
  offers_shown: 'partner_proposals_generated',
  offer_chosen: 'partner_proposal_selected',
  agreement_out: 'partner_envelope_started',
} as const;

type StepRow = { invitation_id: number; action: string; created_at: string };

/** Every onboarding step row, by invitation. One SELECT; the actions are literal. */
async function stepRows(env: Env, invitationId: number | null = null): Promise<StepRow[]> {
  const rows = await all<StepRow>(env,
    `SELECT CAST(json_extract(details, '$.invitation_id') AS INTEGER) AS invitation_id, action, created_at
       FROM activity_logs
      WHERE action IN ('partner_invitation_viewed', 'partner_profile_saved', 'partner_proposals_generated',
                       'partner_proposal_selected', 'partner_envelope_started')
        AND json_valid(details)
        AND (? IS NULL OR CAST(json_extract(details, '$.invitation_id') AS INTEGER) = ?)
      ORDER BY id`, invitationId, invitationId);
  return rows.filter((r) => Number.isFinite(Number(r.invitation_id)));
}

/** When each invitation first reached each stage, from its activity rows; and the latest choice. */
export function stepDates(rows: StepRow[]) {
  const by = new Map<number, Record<string, number | null>>();
  for (const r of rows) {
    const id = Number(r.invitation_id);
    const t = ms(r.created_at);
    if (t === null) continue;
    const d = by.get(id) || { opened: null, profile_done: null, offers_shown: null, offer_chosen_first: null, offer_chosen_latest: null, agreement_out: null };
    const set = (k: string) => { if (d[k] === null || t < (d[k] as number)) d[k] = t; };
    if (r.action === STEP_ACTIONS.opened) set('opened');
    if (r.action === STEP_ACTIONS.profile_done) set('profile_done');
    if (r.action === STEP_ACTIONS.offers_shown) set('offers_shown');
    if (r.action === STEP_ACTIONS.agreement_out) set('agreement_out');
    if (r.action === STEP_ACTIONS.offer_chosen) {
      set('offer_chosen_first');
      if (d.offer_chosen_latest === null || t > (d.offer_chosen_latest as number)) d.offer_chosen_latest = t;
    }
    by.set(id, d);
  }
  return by;
}

/** When an open invitation entered the stage it is at: its first send, or that stage's activity row. */
function enteredStage(inv: Inv, dates: Record<string, number | null> | undefined): number | null {
  switch (inv.status) {
    case 'sent': return ms(inv.created_at);
    case 'viewed': return dates?.opened ?? ms(inv.viewed_at);
    case 'profiled': return dates?.profile_done ?? null;
    case 'proposed': return dates?.offers_shown ?? null;
    case 'selected': return dates?.offer_chosen_first ?? null;
    case 'finalized': return dates?.agreement_out ?? null;
    default: return null;
  }
}

/* ------------------------------------------------------------------ *
 * The agreement-ready rule (D923 §2), in the Worker
 * ------------------------------------------------------------------ */

/**
 * The Partner Services agreement cannot be sent yet when it has no body, or
 * when it holds a field finalize leaves empty: a sender field outside the five
 * finalize fills, or any `counterparty.*` field. A template that cannot be
 * read throws, so the caller says nothing either way.
 */
export async function agreementReady(env: Env): Promise<{ ready: boolean; why: 'no_body' | 'fields' | null; fields: string[] }> {
  const resolved = await templateBodyFor(env, 'partner_services');
  if (!resolved) return { ready: false, why: 'no_body', fields: [] };
  const unfilled = [...mergeTokensIn(resolved.body)]
    .filter((k) => k.startsWith('counterparty.') || (!isAutoMergeKey(k) && !FINALIZE_FILLS.includes(k)));
  return unfilled.length ? { ready: false, why: 'fields', fields: unfilled } : { ready: true, why: null, fields: [] };
}

/* ------------------------------------------------------------------ *
 * GET /overview
 * ------------------------------------------------------------------ */

type Deal = { id: number; invitation_id: number | null; user_id: number | null; deal_type: string; status: string; expires_at: string | null; created_at: string };

export async function partnersOverview(env: Env, now = Date.now()) {
  // Each store is read once, lazily, and shared by the blocks that need it; a
  // store that fails costs only the blocks that read it.
  const memo = <T>(f: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ||= f()); };
  const invitations = memo(() => all<Inv>(env, `SELECT ${INV_COLUMNS} FROM partner_invitations`));
  const deals = memo(() => all<Deal>(env, 'SELECT id, invitation_id, user_id, deal_type, status, expires_at, created_at FROM partner_deals'));
  const redemptions = memo(() => all<{ id: number; partner_deal_id: number; attribution_kind: string; redeemed_at: string }>(env,
    'SELECT id, partner_deal_id, attribution_kind, redeemed_at FROM partner_referral_redemptions'));
  const steps = memo(() => stepRows(env).then(stepDates));

  const since = (days: number) => now - days * DAY;
  const tiles = await block('The tiles', async () => ({
    open: await block('Open invitations', async () => {
      const open = (await invitations()).filter((i) => isOpen(i, now));
      const first = open.map((i) => ms(i.created_at)).filter((t): t is number => t !== null);
      return { count: open.length, oldest_first_send: first.length ? iso(Math.min(...first)) : null };
    }),
    lapsed: await block('Lapsed invitations', async () => ({ count: (await invitations()).filter((i) => isLapsed(i, now)).length })),
    signed_90d: await block('Signed invitations', async () => ({
      count: (await invitations()).filter((i) => { const t = ms(i.signed_at); return t !== null && t >= since(90); }).length,
    })),
    median_days_to_sign: await block('Days to sign', async () => {
      const signed = (await invitations())
        .map((i) => ({ sent: ms(i.created_at), signed: ms(i.signed_at) }))
        .filter((x): x is { sent: number; signed: number } => x.sent !== null && x.signed !== null)
        .sort((a, b) => b.signed - a.signed)
        .slice(0, MEDIAN_OVER);
      const m = median(signed.map((x) => (x.signed - x.sent) / DAY));
      // None signed is null ("None signed yet"), never 0.
      return { median_days: m === null ? null : Math.round(m * 10) / 10, over: signed.length };
    }),
    active_deals: await block('Active deals', async () => {
      const active = (await deals()).filter((d) => d.status === 'active');
      const ends = active.map((d) => ms(d.expires_at));
      return {
        count: active.length,
        ending_30d: ends.filter((t) => t !== null && t >= now && t < now + SOON_DAYS * DAY).length,
        // Past its end, before the daily sweep: "Term ended, not yet closed", never negative days.
        term_over: ends.filter((t) => t !== null && t < now).length,
      };
    }),
    awaiting_signature: await block('Agreements awaiting signature', async () => {
      const [d, inv] = [await deals(), await invitations()];
      const byId = new Map(inv.map((i) => [i.id, i]));
      const awaiting = d.filter((x) => x.status === 'awaiting_signature');
      // A signature on a lapsed invitation's agreement is voided at activation (D923 §2).
      return { count: awaiting.length, invitation_lapsed: awaiting.filter((x) => { const i = x.invitation_id ? byId.get(x.invitation_id) : null; return i ? isLapsed(i, now) : false; }).length };
    }),
    redemptions_90d: await block('Referral redemptions', async () => ({
      count: (await redemptions()).filter((r) => { const t = ms(r.redeemed_at); return t !== null && t >= since(90); }).length,
    })),
    failed_sends_30d: await block('Failed sends', async () => ({
      // D924 keeps the last send per invitation, so this counts invitations whose last send, in the last 30 days, was not sent.
      count: (await invitations()).filter((i) => { const t = ms(i.last_sent_at); return i.last_send_ok === 0 && t !== null && t >= since(30); }).length,
    })),
  }));

  // ── Needs you: one list of rows, each kind read on its own.
  type Row = { kind: string; id: number | string; [k: string]: unknown };
  const kinds: Record<string, Block<{ count: number }>> = {};
  const items: Row[] = [];
  const kind = async (name: string, what: string, read: () => Promise<Row[]>) => {
    const b = await block(what, async () => { const rows = await read(); items.push(...rows); return { count: rows.length }; });
    kinds[name] = b;
  };
  await kind('lapsed', 'Lapsed invitations', async () => (await invitations()).filter((i) => isLapsed(i, now))
    .map((i) => ({ kind: 'lapsed', id: i.id, stage: i.status, lapsed_at: iso(ms(i.expires_at)) })));
  await kind('agreement_blocked', 'The agreement check', async () => {
    const at = (await invitations()).filter((i) => i.status === 'selected' && !isLapsed(i, now));
    if (!at.length) return [];
    const rule = await agreementReady(env);
    return rule.ready ? [] : at.map((i) => ({ kind: 'agreement_blocked', id: i.id, why: rule.why, fields: rule.fields }));
  });
  await kind('send_failed', 'Failed sends', async () => (await invitations())
    .filter((i) => i.last_send_ok === 0 && !['signed', 'revoked', 'expired'].includes(i.status))
    .map((i) => ({ kind: 'send_failed', id: i.id, reason: i.last_send_reason, last_sent_at: iso(ms(i.last_sent_at)) })));
  await kind('deal_ending', 'Deals ending soon', async () => (await deals())
    .filter((d) => { const t = ms(d.expires_at); return d.status === 'active' && t !== null && t >= now && t < now + SOON_DAYS * DAY; })
    .map((d) => ({ kind: 'deal_ending', id: d.id, deal_type: d.deal_type, ends_at: iso(ms(d.expires_at)) })));
  await kind('unattached_account', 'Partner accounts', async () => (await all<{ id: number }>(env,
    "SELECT id FROM users WHERE lower(role) = 'partner' AND partner_id IS NULL ORDER BY id"))
    .map((u) => ({ kind: 'unattached_account', id: u.id })));
  await kind('dd_open', 'Due diligence cases', async () => {
    const signed = (await deals()).filter((d) => d.status === 'active' && d.user_id != null);
    if (!signed.length) return [];
    const cases = await all<{ uid: string; subject_id: number; status: string }>(env,
      "SELECT uid, subject_id, status FROM dd_cases WHERE subject_type = 'partner' AND status IN ('open', 'in_review')");
    const open = new Map(cases.map((c) => [Number(c.subject_id), c]));
    return signed.filter((d) => open.has(Number(d.user_id)))
      .map((d) => ({ kind: 'dd_open', id: d.id, case_uid: open.get(Number(d.user_id))!.uid, case_status: open.get(Number(d.user_id))!.status }));
  });
  await kind('revshare_closing', 'Rev-share windows', async () => {
    const revshare = new Set((await deals()).filter((d) => d.deal_type === 'deal_sourcing_revshare').map((d) => d.id));
    return (await redemptions())
      .filter((r) => revshare.has(Number(r.partner_deal_id)))
      .map((r) => ({ r, end: (ms(r.redeemed_at) ?? NaN) + REVSHARE_DAYS * DAY }))
      .filter(({ end }) => Number.isFinite(end) && end >= now && end < now + SOON_DAYS * DAY)
      .map(({ r, end }) => ({ kind: 'revshare_closing', id: r.id, deal_id: Number(r.partner_deal_id), window_closes_at: iso(end) }));
  });
  const unreadable = Object.entries(kinds).filter(([, b]) => !b.available).map(([k]) => k);
  const needs_you = { available: true as const, total: items.length, kinds, unreadable, items };

  const c1 = await block('Where invitations stand', async () => {
    const [inv, dates] = [await invitations(), await steps()];
    const open = inv.filter((i) => isOpen(i, now));
    const stages = OPEN_STAGES.map((stage) => {
      const at = open.filter((i) => i.status === stage);
      const entered = at.map((i) => enteredStage(i, dates.get(i.id)));
      const known = entered.filter((t): t is number => t !== null);
      return { stage, count: at.length, oldest_in_stage_since: known.length ? iso(Math.min(...known)) : null, undated: entered.length - known.length };
    });
    return {
      stages,
      closed: {
        signed: inv.filter((i) => i.status === 'signed').length,
        lapsed: inv.filter((i) => isLapsed(i, now)).length,
        revoked: inv.filter((i) => i.status === 'revoked').length,
        signed_after_lapse: inv.filter((i) => i.status === 'expired').length,
      },
    };
  });

  const starts = weekStarts(now);
  const bucket = (t: number | null) => (t === null ? -1 : starts.findIndex((s, i) => t >= s && t < (starts[i + 1] ?? s + 7 * DAY)));
  const c2 = await block('Invitations per week', async () => {
    const inv = await invitations();
    const weeks = starts.map((s, i) => ({ week_start: iso(s)!.slice(0, 10), current: i === starts.length - 1, sent: 0, signed: 0 }));
    for (const i of inv) {
      const a = bucket(ms(i.created_at)); if (a >= 0) weeks[a].sent += 1;
      const b = bucket(ms(i.signed_at)); if (b >= 0) weeks[b].signed += 1;
    }
    return { weeks };
  });
  const c3 = await block('Deals by type and state', async () => {
    const counts = new Map<string, { deal_type: string; state: string; count: number }>();
    for (const d of await deals()) {
      const end = ms(d.expires_at);
      const state = d.status === 'active' && end !== null && end < now ? 'term_over' : d.status;
      const key = `${d.deal_type}|${state}`;
      const row = counts.get(key) || { deal_type: d.deal_type, state, count: 0 };
      row.count += 1;
      counts.set(key, row);
    }
    return { rows: [...counts.values()].sort((a, b) => a.deal_type.localeCompare(b.deal_type) || a.state.localeCompare(b.state)) };
  });
  const c4 = await block('Redemptions per week', async () => {
    const weeks = starts.map((s, i) => ({ week_start: iso(s)!.slice(0, 10), current: i === starts.length - 1, referral: 0, deal_sourcing_revshare: 0 }));
    for (const r of await redemptions()) {
      const w = bucket(ms(r.redeemed_at));
      if (w < 0) continue;
      if (r.attribution_kind === 'deal_sourcing_revshare') weeks[w].deal_sourcing_revshare += 1;
      else weeks[w].referral += 1;
    }
    return { weeks };
  });

  return { as_of: iso(now), tiles, needs_you, c1, c2, c3, c4 };
}

/* ------------------------------------------------------------------ *
 * Offers: what the invitee saw, and the preview
 * ------------------------------------------------------------------ */

export const FROM_ANSWERS = 'From their answers';

/**
 * The phrases `buildProposals` takes from the profile: equity's hours, the
 * capital commitment and its tier, and the custom deal's text. Marked so the
 * page can say which words depend on what the invitee answers.
 */
export const PROFILE_DEPENDENT: Partial<Record<PartnerDealType, string[]>> = {
  equity_partnership: ['terms.time_commitment', 'contract_excerpt'],
  capital_partnership: ['terms.capital_commitment_usd', 'granted_tier_investor', 'contract_excerpt'],
  custom: ['terms.description', 'contract_excerpt'],
};

type Offer = PartnerProposalDraft & { profile_dependent: string[] };

/** The deal types an invitation allows, as stored. */
export function allowedTypes(raw: unknown): PartnerDealType[] {
  let arr: unknown;
  try { arr = JSON.parse(String(raw ?? '[]')); } catch { arr = []; }
  return Array.isArray(arr) ? arr.map(String).filter((t): t is PartnerDealType => (ALL_PARTNER_DEAL_TYPES as string[]).includes(t)) : [];
}

/**
 * The offers the invitee saw: `buildProposals` over their stored profile,
 * computed with no write. The profile's own words are not returned (they stay
 * the logged answers read, D923 §3): every answer quoted in an offer is
 * replaced by "From their answers", and the field is listed.
 */
export function offersSeen(allowed: PartnerDealType[], profile: Record<string, unknown> | null): Offer[] {
  const p = profile || {};
  const answers = [p.capacity_per_month, p.motivation].map((v) => (v == null ? '' : String(v).trim())).filter(Boolean);
  const capital = Number(p.capital_capacity_usd || 0);
  if (capital) answers.push(`$${capital.toLocaleString()}`, String(capital));
  const scrub = (s: string) => answers.reduce((out, a) => out.split(a).join(FROM_ANSWERS), s);
  return buildProposals(allowed, p as never).map((o) => {
    const terms: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(o.terms)) terms[k] = typeof v === 'number' && capital && v === capital ? FROM_ANSWERS : typeof v === 'string' ? scrub(v) : v;
    return { ...o, terms, summary: scrub(o.summary), contract_excerpt: scrub(o.contract_excerpt), profile_dependent: PROFILE_DEPENDENT[o.deal_type] || [] };
  });
}

/** The preview: `buildProposals`' text over a neutral profile, each profile-dependent phrase marked. */
export function offersPreview(types: PartnerDealType[]): Offer[] {
  return buildProposals(types, {} as never).map((o) => ({ ...o, profile_dependent: PROFILE_DEPENDENT[o.deal_type] || [] }));
}

/** `?types=a,b`: one to three known types, or the refusal's code. */
export function parseTypes(raw: string | undefined): { types: PartnerDealType[] } | { error: string } {
  const list = [...new Set(String(raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { error: 'types_required' };
  if (list.some((t) => !(ALL_PARTNER_DEAL_TYPES as string[]).includes(t))) return { error: 'invalid_type' };
  if (list.length > 3) return { error: 'too_many_deal_types' };
  return { types: list as PartnerDealType[] };
}

/* ------------------------------------------------------------------ *
 * GET /invitations/:id
 * ------------------------------------------------------------------ */

const parseJson = (s: unknown): Record<string, unknown> | null => {
  try { const v = JSON.parse(String(s ?? '')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

export async function invitationRecord(env: Env, id: number, appUrl: string, now = Date.now()) {
  const row = await env.DB.prepare(
    `SELECT pi.*, u.name AS invited_by_name FROM partner_invitations pi LEFT JOIN users u ON u.id = pi.invited_by_user_id WHERE pi.id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const allowed = allowedTypes(row.allowed_deal_types);
  const invitation = {
    id: Number(row.id), recipient_email: row.recipient_email, recipient_name: row.recipient_name ?? null,
    allowed_deal_types: allowed, status: row.status, expires_at: row.expires_at, created_at: row.created_at,
    viewed_at: row.viewed_at ?? null, signed_at: row.signed_at ?? null, revoked_at: row.revoked_at ?? null,
    resulting_user_id: row.resulting_user_id ?? null, resulting_deal_id: row.resulting_deal_id ?? null, envelope_id: row.envelope_id ?? null,
    last_sent_at: row.last_sent_at ?? null, send_count: row.send_count ?? null, last_send_ok: row.last_send_ok ?? null, last_send_reason: row.last_send_reason ?? null,
    invited_by_name: row.invited_by_name ?? null,
    personal_message: row.personal_message ?? null,
    link: `${appUrl}/partners/onboard?token=${row.token}`,
    is_expired: isLapsed({ status: String(row.status), expires_at: String(row.expires_at ?? '') }, now),
  };

  const steps = await block('The step dates', async () => {
    const d = stepDates(await stepRows(env, id)).get(id);
    return {
      sent: iso(ms(row.created_at)),
      opened: iso(d?.opened ?? ms(row.viewed_at)),
      profile_done: iso(d?.profile_done ?? null),
      offers_shown: iso(d?.offers_shown ?? null),
      offer_chosen_first: iso(d?.offer_chosen_first ?? null),
      offer_chosen_latest: iso(d?.offer_chosen_latest ?? null),
      agreement_out: iso(d?.agreement_out ?? null),
      signed: iso(ms(row.signed_at)),
    };
  });

  const offers_seen = await block('The offers', async () => {
    const shown = await env.DB.prepare(
      `SELECT 1 AS hit FROM activity_logs WHERE action = 'partner_proposals_generated' AND json_valid(details)
          AND CAST(json_extract(details, '$.invitation_id') AS INTEGER) = ? LIMIT 1`,
    ).bind(id).first();
    if (!shown) return { seen: false, offers: [] as Offer[] };
    // The profile row is per address; its answers are for this invitation only while it names it.
    const profile = await env.DB.prepare('SELECT * FROM partner_profiles WHERE invitation_id = ?').bind(id).first<Record<string, unknown>>();
    return { seen: true, profile_on_record: Boolean(profile), offers: offersSeen(allowed, profile ?? null) };
  });

  const chosen_deal = await block('The chosen deal', async () => {
    const deal = await env.DB.prepare(
      `SELECT id, deal_type, proposal_json, status, envelope_id, void_reason, created_at, activated_at, expires_at
         FROM partner_deals WHERE invitation_id = ? OR id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(id, row.resulting_deal_id ?? -1).first<Record<string, unknown>>();
    if (!deal) return { deal: null, envelope: null };
    const envelopeId = deal.envelope_id ?? row.envelope_id ?? null;
    let envelope: Record<string, unknown> | null = null;
    if (envelopeId != null) {
      const e = await env.DB.prepare('SELECT id, status, created_at FROM esign_envelopes WHERE id = ?').bind(envelopeId).first<Record<string, unknown>>();
      // The pending partner signature's link expiry, never the link or its token.
      const r = await env.DB.prepare(
        `SELECT token_expires_at FROM esign_recipients WHERE envelope_id = ? AND LOWER(recipient_email) = LOWER(?) AND status = 'pending' ORDER BY id LIMIT 1`,
      ).bind(envelopeId, row.recipient_email).first<{ token_expires_at: string | null }>();
      envelope = e ? { id: Number(e.id), status: e.status, created_at: e.created_at, signing_link_expires_at: r?.token_expires_at ?? null } : null;
    }
    const proposal = parseJson(deal.proposal_json);
    return {
      deal: {
        id: Number(deal.id), deal_type: deal.deal_type, status: deal.status, void_reason: deal.void_reason ?? null,
        label: proposal?.label ?? null, summary: proposal?.summary ?? null,
        created_at: deal.created_at, activated_at: deal.activated_at ?? null, expires_at: deal.expires_at ?? null,
      },
      envelope,
    };
  });

  const refusals = await block('The agreement refusals', async () => {
    const rows = await all<{ details: string; created_at: string }>(env,
      `SELECT details, created_at FROM activity_logs WHERE action = 'partner_envelope_refused' AND json_valid(details)
          AND CAST(json_extract(details, '$.invitation_id') AS INTEGER) = ? ORDER BY id`, id);
    return { items: rows.map((r) => { const d = parseJson(r.details) || {}; return { at: iso(ms(r.created_at)), code: d.code ?? null, fields: Array.isArray(d.fields) ? d.fields.map(String) : [] }; }) };
  });

  const history = await block('The history', async () => {
    const admin = await all<{ action: string; filters_json: string; exported_at: string; admin_name: string | null }>(env,
      `SELECT a.action, a.filters_json, a.exported_at, u.name AS admin_name
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action IN ('partner_invitation_created', 'partner_invitation_resent', 'partner_invitation_revoked')
          AND json_valid(a.filters_json)
          AND CAST(json_extract(a.filters_json, '$.invitation_id') AS INTEGER) = ?
        ORDER BY a.id`, id);
    const links = await all<{ action: string; meta: string | null; ts: string; signer_name: string | null }>(env,
      `SELECT e.action, e.meta, e.ts, u.name AS signer_name
         FROM esign_audit_events e LEFT JOIN users u ON u.id = e.signer_id
        WHERE e.action IN ('partner_signing_link_renewed', 'partner_signing_link_renewal_failed')
          AND json_valid(e.meta)
          AND CAST(json_extract(e.meta, '$.invitation_id') AS INTEGER) = ?
        ORDER BY e.id`, id);
    const word: Record<string, string> = { partner_invitation_created: 'created', partner_invitation_resent: 'resent', partner_invitation_revoked: 'revoked' };
    const items = [
      ...admin.map((a) => {
        const d = parseJson(a.filters_json) || {};
        return {
          at: iso(ms(a.exported_at)), event: word[a.action], by: a.admin_name ?? null,
          email_sent: typeof d.email_sent === 'boolean' ? d.email_sent : null,
          reason: a.action === 'partner_invitation_revoked' ? (String(d.reason ?? '').trim() || null) : null,
        };
      }),
      ...links.map((l) => {
        const m = parseJson(l.meta) || {};
        return {
          at: iso(ms(l.ts)), event: l.action === 'partner_signing_link_renewed' ? 'signing_link_renewed' : 'signing_link_not_renewed', by: l.signer_name ?? null,
          email_sent: l.action === 'partner_signing_link_renewed',
          previous_link_restored: l.action === 'partner_signing_link_renewed' ? null : Boolean(m.previous_link_restored),
        };
      }),
    ].sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));
    return { items };
  });

  return { invitation, steps, offers_seen, chosen_deal, refusals, history };
}
