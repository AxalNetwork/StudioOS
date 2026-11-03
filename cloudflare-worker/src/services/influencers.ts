/**
 * D4289 P1 (#4290) — the Influencer program's membership: applying, HQ's
 * decision, the member's state and HQ's changes to it. Routes live in
 * routes/influencer.ts (the member's) and routes/admin_influencers.ts (HQ's).
 *
 * A PROGRAM AND A MEMBERSHIP, NOT A ROLE (D-a). Any member can apply. An
 * admitted influencer is a row in `influencers`; `/me` reads it as
 * `influencer_active`, and nothing touches `users.role`.
 *
 * TERMS REUSE D958 (D-b). Admitting makes the member a referral partner in the
 * `influencers` segment and opens DRAFT terms copied from their tier's
 * defaults (`influencer_tier_defaults`, the Super Admin's settings). Nothing is
 * paid on a draft: the Super Admin approves the terms and the influencer signs
 * them, as for every referral partner. A member who is already a referral
 * partner keeps their row and segment; the draft is added to it.
 *
 * THE BENEFIT (D-l). While active, an influencer holds Investor Pro through
 * the granted-tier columns partner deals use (`users.investor_tier`, status
 * `influencer_grant`). It is set only when the member has no investor plan of
 * their own that it would overwrite, and `influencers.investor_grant` records
 * that it was set, so a pause or an end takes back only what this program gave.
 *
 * Every write is one guarded UPDATE first (so two admins deciding at once make
 * one decision), then one batch for the rest. Every event goes to the
 * append-only `influencer_events`. Amounts and rates are the tier defaults'
 * data, never literals here (D1050).
 */
import type { Env } from '../types';
import { INVESTOR_QUOTAS } from '../middleware/requireInvestorTier';

export const TIERS = ['affiliate_creator', 'verified_influencer', 'strategic_creator', 'strategic_partner'] as const;
export type Tier = typeof TIERS[number];
export const TIER_LABEL: Record<Tier, string> = {
  affiliate_creator: 'Affiliate Creator',
  verified_influencer: 'Verified Influencer',
  strategic_creator: 'Strategic Creator',
  strategic_partner: 'Strategic Partner',
};
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v);

export const MEMBER_STATUSES = ['active', 'paused', 'ended'] as const;
export type MemberStatus = typeof MEMBER_STATUSES[number];

/** The Influencer terms the applicant accepts (D-i). A new wording gets a new version. */
export const CONSENT_VERSION = '2026-11-03';
/** The rules the applicant ticks one by one (IN9 step 3). */
export const CONSENT_RULES = ['disclosure', 'no_deal_promotion', 'no_self_referral'] as const;

/** A declined member may apply again this many days after the decision (D4289 §1.3). */
export const REAPPLY_DAYS = 90;
/** A reason, a question or a decline is at least this long, so it says something. */
export const REASON_MIN = 10;
export const REASON_MAX = 2000;


import { INFLUENCER_RULE } from './influencerActions';
export { INFLUENCER_ACTIONS, INFLUENCER_RULE } from './influencerActions';

/** The investor plan states a grant may replace: nothing paid, nothing in force. */
const GRANTABLE_STATUSES = ['free', 'cancelled', 'canceled', 'unpaid', 'incomplete_expired', 'partner_expired', 'partner_revoked', 'influencer_ended', 'influencer_grant'];
const GRANT_TIER = 'professional' as const;

export class InfluencerRefusal extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: 400 | 403 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}
const refusal = (status: 400 | 403 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) =>
  new InfluencerRefusal(status, code, sentence, extra);

const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const uidOf = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const msOf = (sql: string | null | undefined) => (sql ? Date.parse(`${String(sql).replace(' ', 'T')}Z`) : NaN);

// ─────────────────────────────────────────────── the application's answers

export type Channel = { kind: string; url: string; audience: number | null };
export type Answers = {
  channels: Channel[]; regions: string[]; topics: string[]; why: string;
  consent: Record<typeof CONSENT_RULES[number], true>;
};

const CHANNEL_KINDS = ['youtube', 'x', 'linkedin', 'instagram', 'tiktok', 'newsletter', 'podcast', 'blog', 'community', 'other'] as const;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const words = (v: unknown, maxItems: number, maxLen: number): string[] | null => {
  if (!Array.isArray(v) || !v.length || v.length > maxItems) return null;
  const out = v.map((x) => text(x, maxLen));
  return out.every((x): x is string => x !== null) ? out : null;
};

/** The body's answers, as stored, or the refusal that names what is missing. */
export function readAnswers(b: any): Answers {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw refusal(400, 'invalid_request', 'Send the application as an object.');
  const raw = b.channels;
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) throw refusal(400, 'channels_required', 'Name from 1 to 10 channels, each with its link.');
  const channels: Channel[] = [];
  for (const ch of raw) {
    const kind = typeof ch?.kind === 'string' && (CHANNEL_KINDS as readonly string[]).includes(ch.kind) ? ch.kind : null;
    const url = text(ch?.url, 500);
    let parsed: URL | null = null;
    try { parsed = url ? new URL(url) : null; } catch { parsed = null; }
    if (!kind || !parsed || !/^https?:$/.test(parsed.protocol)) {
      throw refusal(400, 'channel_invalid', `Each channel is one of ${CHANNEL_KINDS.join(', ')}, with an http or https link.`);
    }
    const audience = ch?.audience == null ? null : Number(ch.audience);
    if (audience !== null && !(Number.isSafeInteger(audience) && audience >= 0)) throw refusal(400, 'audience_invalid', 'An audience size is a whole number, or left out.');
    channels.push({ kind, url: parsed.toString(), audience });
  }
  const regions = words(b.regions, 20, 80);
  if (!regions) throw refusal(400, 'regions_required', 'Name the regions your audience is in, at most 20.');
  const topics = words(b.topics, 20, 80);
  if (!topics) throw refusal(400, 'topics_required', 'Name the topics you cover, at most 20.');
  const why = text(b.why, 2000);
  if (!why) throw refusal(400, 'why_required', 'Say why Axal, in at most 2000 characters.');
  if (b.consent_version !== CONSENT_VERSION) {
    throw refusal(400, 'terms_version', 'The Influencer terms have changed since you opened them. Read them again and accept the current version.', { consent_version: CONSENT_VERSION });
  }
  const consent = b.consent && typeof b.consent === 'object' ? b.consent : {};
  const missing = CONSENT_RULES.filter((r) => consent[r] !== true);
  if (missing.length) throw refusal(400, 'terms_not_accepted', 'Accept each Influencer rule: label every promotion as paid, promote no deal or fund, and never refer yourself.', { missing });
  return { channels, regions, topics, why, consent: { disclosure: true, no_deal_promotion: true, no_self_referral: true } };
}

// ─────────────────────────────────────────────── the member's side

type AppRow = {
  id: number; uid: string; user_id: number; answers_json: string; consent_version: string; status: string; tier: string | null;
  reason: string | null; decided_by: number | null; decided_at: string | null; created_at: string; updated_at: string;
};
type MemberRow = {
  id: number; uid: string; user_id: number; tier: Tier; status: MemberStatus; handle: string | null; partner_id: number | null;
  application_id: number | null; admitted_by: number; admitted_at: string; investor_grant: number; updated_at: string;
};

/** What the member and HQ read of an application. HQ's identity is never in it. */
export function applicationView(r: AppRow) {
  let answers: unknown = null;
  try { answers = JSON.parse(r.answers_json); } catch { answers = null; }
  return {
    uid: r.uid, status: r.status, tier: r.tier, tier_label: r.tier && isTier(r.tier) ? TIER_LABEL[r.tier] : null,
    answers, consent_version: r.consent_version,
    // The decline's reason, or HQ's question when it asked for more; the applicant reads both.
    reason: r.reason ?? null, decided_at: r.decided_at ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function memberView(m: MemberRow) {
  return {
    uid: m.uid, tier: m.tier, tier_label: TIER_LABEL[m.tier], status: m.status, handle: m.handle ?? null,
    admitted_at: m.admitted_at, investor_pro: Number(m.investor_grant) === 1,
  };
}

/** The date a declined member may apply again, or null when nothing holds them. */
export function reapplyAfter(latest: { status: string; decided_at: string | null } | null, now: number): string | null {
  if (!latest || latest.status !== 'declined' || !latest.decided_at) return null;
  const at = msOf(latest.decided_at) + REAPPLY_DAYS * 86_400_000;
  return Number.isFinite(at) && at > now ? dayOf(at) : null;
}

const latestApplication = (env: Env, userId: number) =>
  env.DB.prepare('SELECT * FROM influencer_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').bind(userId).first<AppRow>();
const memberOf = (env: Env, userId: number) =>
  env.DB.prepare('SELECT * FROM influencers WHERE user_id = ?').bind(userId).first<MemberRow>();

/** `GET /api/influencer/me`: the member's application and membership. */
export async function influencerMe(env: Env, userId: number, now = Date.now()) {
  const [app, member] = await Promise.all([latestApplication(env, userId), memberOf(env, userId)]);
  return {
    membership: member ? memberView(member) : null,
    application: app ? applicationView(app) : null,
    reapply_after: reapplyAfter(app ?? null, now),
    consent_version: CONSENT_VERSION,
  };
}

const event = (env: Env, e: { userId: number; applicationId?: number | null; influencerId?: number | null; event: string; detail?: Record<string, unknown> | null; actor?: number | null; at: string }) =>
  env.DB.prepare(
    `INSERT INTO influencer_events (user_id, application_id, influencer_id, event, detail_json, actor_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(e.userId, e.applicationId ?? null, e.influencerId ?? null, e.event, e.detail ? JSON.stringify(e.detail) : null, e.actor ?? null, e.at);

/**
 * `POST /api/influencer/apply`. One open application per member. An open one
 * HQ asked more of is answered by applying again: its answers are replaced
 * and it goes back to HQ. A member already admitted, or declined less than 90
 * days ago, is refused with why.
 */
export async function applyAsInfluencer(env: Env, userId: number, body: unknown, now = Date.now()) {
  const answers = readAnswers(body);
  const at = sqlTime(now);
  const member = await memberOf(env, userId);
  if (member && member.status !== 'ended') throw refusal(409, 'already_influencer', 'You are already an Axal influencer.', { membership: memberView(member) });
  const latest = await latestApplication(env, userId);
  if (latest?.status === 'applied') throw refusal(409, 'application_open', 'Your application is with HQ. We reply within 5 business days.', { application: applicationView(latest) });
  const after = reapplyAfter(latest ?? null, now);
  if (after) throw refusal(409, 'reapply_later', `You can apply again from ${after}.`, { reapply_after: after });
  const json = JSON.stringify(answers);
  if (latest?.status === 'more_requested') {
    const r = await env.DB.prepare(
      `UPDATE influencer_applications SET answers_json = ?, consent_version = ?, status = 'applied', updated_at = ?
        WHERE id = ? AND status = 'more_requested'`,
    ).bind(json, CONSENT_VERSION, at, latest.id).run();
    if (!Number(r.meta?.changes)) throw refusal(409, 'application_changed', 'Your application changed while you were answering. Read it again.');
    await event(env, { userId, applicationId: latest.id, event: 'applied', detail: { answered_question: true }, actor: userId, at }).run();
    return applicationView((await env.DB.prepare('SELECT * FROM influencer_applications WHERE id = ?').bind(latest.id).first<AppRow>())!);
  }
  const uid = uidOf('ifa');
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO influencer_applications (uid, user_id, answers_json, consent_version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'applied', ?, ?)`,
      ).bind(uid, userId, json, CONSENT_VERSION, at, at),
      env.DB.prepare(
        `INSERT INTO influencer_events (user_id, application_id, event, actor_user_id, created_at)
         SELECT ?, id, 'applied', ?, ? FROM influencer_applications WHERE uid = ?`,
      ).bind(userId, userId, at, uid),
    ]);
  } catch (e) {
    // The open-application index: a second press, or another tab, got there first.
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw refusal(409, 'application_open', 'Your application is with HQ. We reply within 5 business days.');
    throw e;
  }
  return applicationView((await env.DB.prepare('SELECT * FROM influencer_applications WHERE uid = ?').bind(uid).first<AppRow>())!);
}

// ─────────────────────────────────────────────── HQ's side

export const APPLICATION_FILTERS = ['applied', 'more_requested', 'admitted', 'declined', 'withdrawn', 'open', 'all'] as const;

/** HQ's queue, oldest first for what waits on HQ, newest first otherwise; each row with the applicant's name. */
export async function listApplications(env: Env, status: typeof APPLICATION_FILTERS[number], limit: number) {
  // What waits on HQ reads oldest first; everything else newest first (ids grow with time).
  const oldestFirst = status === 'applied' || status === 'open' ? 1 : 0;
  const rows = await env.DB.prepare(
    `SELECT a.*, COALESCE(u.display_name, u.name) AS applicant_name, u.role AS applicant_role
       FROM influencer_applications a LEFT JOIN users u ON u.id = a.user_id
      WHERE ?1 = 'all' OR (?1 = 'open' AND a.status IN ('applied', 'more_requested')) OR a.status = ?1
      ORDER BY CASE WHEN ?2 = 1 THEN a.id END ASC, a.id DESC LIMIT ?3`,
  ).bind(status, oldestFirst, limit).all<AppRow & { applicant_name: string | null; applicant_role: string | null }>();
  const counts = await env.DB.prepare(
    `SELECT SUM(status = 'applied') AS applied, SUM(status = 'more_requested') AS more_requested FROM influencer_applications`,
  ).first<{ applied: number | null; more_requested: number | null }>();
  return {
    applications: (rows.results || []).map((r) => ({
      ...applicationView(r), applicant: { user_id: Number(r.user_id), name: r.applicant_name ?? null, role: r.applicant_role ?? null },
    })),
    counts: { applied: Number(counts?.applied ?? 0), more_requested: Number(counts?.more_requested ?? 0) },
  };
}

export type TierDefault = {
  tier: Tier; label: string; position: number; percentage_bps: number | null; duration_invoices: number | null;
  offer_budget_cents: number | null; currency: string; updated_at: string;
};

/** The four tiers' defaults, in their order. A rate nobody set is null ("Not set"), never 0. */
export async function tierDefaults(env: Env): Promise<TierDefault[]> {
  const r = await env.DB.prepare('SELECT * FROM influencer_tier_defaults ORDER BY position').all<any>();
  return (r.results || []).filter((x) => isTier(x.tier)).map((x) => ({
    tier: x.tier, label: TIER_LABEL[x.tier as Tier], position: Number(x.position),
    percentage_bps: x.percentage_bps == null ? null : Number(x.percentage_bps),
    duration_invoices: x.duration_invoices == null ? null : Number(x.duration_invoices),
    offer_budget_cents: x.offer_budget_cents == null ? null : Number(x.offer_budget_cents),
    currency: String(x.currency || 'USD'), updated_at: String(x.updated_at),
  }));
}

/** The Super Admin's change to one tier's defaults. New terms copy it; terms already drafted keep theirs. */
export async function writeTierDefault(env: Env, tier: Tier, b: any, adminId: number, now = Date.now()) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw refusal(400, 'invalid_request', 'Send the tier\'s defaults as an object.');
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const intOrNull = (k: string, max: number) => {
    const v = b[k];
    if (v === null) return null;
    return Number.isSafeInteger(v) && v > 0 && v <= max ? Number(v) : 'bad';
  };
  const current = (await tierDefaults(env)).find((t) => t.tier === tier);
  if (!current) throw refusal(404, 'tier_not_found', 'That tier has no defaults.');
  const bps = has('percentage_bps') ? intOrNull('percentage_bps', 10_000) : current.percentage_bps;
  const inv = has('duration_invoices') ? intOrNull('duration_invoices', 120) : current.duration_invoices;
  const budget = has('offer_budget_cents') ? intOrNull('offer_budget_cents', 1_000_000_000) : current.offer_budget_cents;
  if (bps === 'bad') throw refusal(400, 'invalid_rate', 'A rate is from 1 to 10000 basis points, or null for "Not set".');
  if (inv === 'bad') throw refusal(400, 'invalid_duration', 'A duration is from 1 to 120 paid invoices, or null for "per signed terms".');
  if (budget === 'bad') throw refusal(400, 'invalid_budget', 'An offer budget is whole cents above 0, or null for "Not set".');
  const currency = has('currency') ? b.currency : current.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw refusal(400, 'invalid_currency', 'The currency is a three-letter code, such as USD.');
  await env.DB.prepare(
    `UPDATE influencer_tier_defaults SET percentage_bps = ?, duration_invoices = ?, offer_budget_cents = ?, currency = ?, updated_by = ?, updated_at = ?
      WHERE tier = ?`,
  ).bind(bps, inv, budget, currency, adminId, sqlTime(now), tier).run();
  return { before: current, after: (await tierDefaults(env)).find((t) => t.tier === tier)! };
}

const reasonOf = (v: unknown, what: string) => {
  const r = typeof v === 'string' ? v.trim() : '';
  if (r.length < REASON_MIN || r.length > REASON_MAX) {
    throw refusal(400, 'reason_required', `${what} needs a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
  }
  return r;
};

/** The statements that give the member Investor Pro, only over no plan of their own, and record that it did. */
function grantStatements(env: Env, userId: number, influencerId: number) {
  return [
    env.DB.prepare(
      `UPDATE users SET investor_tier = ?, investor_subscription_status = 'influencer_grant', investor_subscription_renews_at = NULL,
              investor_dealroom_max = MAX(COALESCE(investor_dealroom_max, 0), ?)
        WHERE id = ? AND (investor_subscription_status IS NULL OR investor_subscription_status IN (SELECT value FROM json_each(?)))
          AND (investor_tier IS NULL OR investor_tier NOT IN ('professional', 'institutional') OR investor_subscription_status = 'influencer_grant')`,
    ).bind(GRANT_TIER, INVESTOR_QUOTAS[GRANT_TIER].dealroom_max, userId, JSON.stringify(GRANTABLE_STATUSES)),
    env.DB.prepare(
      `UPDATE influencers SET investor_grant = CASE WHEN EXISTS (
          SELECT 1 FROM users WHERE id = ? AND investor_subscription_status = 'influencer_grant' AND investor_tier = ?) THEN 1 ELSE 0 END
        WHERE id = ?`,
    ).bind(userId, GRANT_TIER, influencerId),
  ];
}

/** The statements that take back only the Investor Pro this program gave. */
function revokeStatements(env: Env, userId: number, influencerId: number) {
  return [
    env.DB.prepare(
      `UPDATE users SET investor_tier = 'free', investor_subscription_status = 'influencer_ended', investor_dealroom_max = ?
        WHERE id = ? AND investor_subscription_status = 'influencer_grant'
          AND EXISTS (SELECT 1 FROM influencers WHERE id = ? AND investor_grant = 1)`,
    ).bind(INVESTOR_QUOTAS.free.dealroom_max, userId, influencerId),
    env.DB.prepare('UPDATE influencers SET investor_grant = 0 WHERE id = ?').bind(influencerId),
  ];
}

export type Decision = { kind: 'admit'; tier: Tier } | { kind: 'decline'; reason: string } | { kind: 'more'; question: string };

/** `{ admit: tier } | { decline: reason } | { more: question }`, exactly one. */
export function readDecision(b: any): Decision {
  const keys = b && typeof b === 'object' && !Array.isArray(b) ? ['admit', 'decline', 'more'].filter((k) => b[k] !== undefined) : [];
  if (keys.length !== 1) throw refusal(400, 'invalid_decision', 'Send exactly one of { admit: tier }, { decline: reason } or { more: question }.');
  if (keys[0] === 'admit') {
    if (!isTier(b.admit)) throw refusal(400, 'unknown_tier', `Admit at one of ${TIERS.join(', ')}.`);
    return { kind: 'admit', tier: b.admit };
  }
  if (keys[0] === 'decline') return { kind: 'decline', reason: reasonOf(b.decline, 'A decline') };
  return { kind: 'more', question: reasonOf(b.more, 'Asking for more') };
}

/**
 * HQ's decision on an open application. Admitting makes the membership, the
 * referral partner row, the draft terms and the Investor Pro grant; declining
 * dates the 90-day wait; asking for more sends the question back.
 */
export async function decideApplication(env: Env, adminId: number, uid: string, decision: Decision, now = Date.now()) {
  const app = await env.DB.prepare('SELECT * FROM influencer_applications WHERE uid = ?').bind(uid).first<AppRow>();
  if (!app) throw refusal(404, 'application_not_found', 'No application has that id.');
  if (app.status !== 'applied' && app.status !== 'more_requested') {
    throw refusal(409, 'application_decided', 'This application was already decided. Read it again.', { application: applicationView(app) });
  }
  if (decision.kind === 'more' && app.status === 'more_requested') {
    throw refusal(409, 'awaiting_applicant', 'HQ already asked this applicant for more. Wait for their answer.');
  }
  const at = sqlTime(now);
  const userId = Number(app.user_id);
  if (decision.kind === 'admit') {
    const existing = await memberOf(env, userId);
    if (existing && existing.status !== 'ended') throw refusal(409, 'already_influencer', 'This member is already an influencer.');
  }
  const status = decision.kind === 'admit' ? 'admitted' : decision.kind === 'decline' ? 'declined' : 'more_requested';
  const reason = decision.kind === 'decline' ? decision.reason : decision.kind === 'more' ? decision.question : null;
  const tier = decision.kind === 'admit' ? decision.tier : null;
  // The one guarded write: of two admins deciding at once, one decides.
  const moved = await env.DB.prepare(
    `UPDATE influencer_applications SET status = ?, tier = ?, reason = ?, decided_by = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND status = ?`,
  ).bind(status, tier, reason, adminId, at, at, app.id, app.status).run();
  if (!Number(moved.meta?.changes)) throw refusal(409, 'application_decided', 'This application was decided while you were looking at it. Read it again.');

  if (decision.kind !== 'admit') {
    await event(env, { userId, applicationId: app.id, event: status, detail: { reason }, actor: adminId, at }).run();
    return { application: applicationView((await env.DB.prepare('SELECT * FROM influencer_applications WHERE id = ?').bind(app.id).first<AppRow>())!), membership: null };
  }

  try {
    const defaults = (await tierDefaults(env)).find((t) => t.tier === decision.tier) ?? null;
    const memberUid = uidOf('inf');
    const termsUid = `rpt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const today = dayOf(now);
    const existing = await memberOf(env, userId);
    await env.DB.batch([
      // The referral partner row (D-b); a member already a partner keeps theirs.
      env.DB.prepare(
        `INSERT OR IGNORE INTO referral_partners (user_id, segment, note, added_by, added_at, updated_at)
         VALUES (?, 'influencers', 'Admitted as an influencer.', ?, ?, ?)`,
      ).bind(userId, adminId, at, at),
      existing
        ? env.DB.prepare(
          `UPDATE influencers SET tier = ?, status = 'active', application_id = ?, admitted_by = ?, admitted_at = ?, updated_at = ?,
                  partner_id = (SELECT id FROM referral_partners WHERE user_id = ?) WHERE id = ? AND status = 'ended'`,
        ).bind(decision.tier, app.id, adminId, at, at, userId, existing.id)
        : env.DB.prepare(
          `INSERT INTO influencers (uid, user_id, tier, status, partner_id, application_id, admitted_by, admitted_at, updated_at)
           SELECT ?, ?, ?, 'active', (SELECT id FROM referral_partners WHERE user_id = ?), ?, ?, ?, ?`,
        ).bind(memberUid, userId, decision.tier, userId, app.id, adminId, at, at),
      // Draft terms from the tier's defaults; the Super Admin approves them and the influencer signs (D958).
      env.DB.prepare(
        `INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, currency, note, created_by, created_at, updated_at)
         SELECT ?, p.id, p.segment, 'draft', ?, ?, ?, ?, ?, ? FROM referral_partners p WHERE p.user_id = ?`,
      ).bind(termsUid, today, defaults?.currency ?? 'USD',
        `Drafted when admitted as ${TIER_LABEL[decision.tier]}, from the tier's defaults.`, adminId, at, at, userId),
      // Strategic Partner's rate is negotiated: its draft carries no trigger until HQ writes one.
      ...(defaults?.percentage_bps != null ? [env.DB.prepare(
        `INSERT INTO referral_partner_term_triggers (terms_id, rule_key, amount_cents, percentage_bps)
         SELECT id, ?, NULL, ? FROM referral_partner_terms WHERE uid = ?`,
      ).bind(INFLUENCER_RULE, defaults.percentage_bps, termsUid)] : []),
    ]);
    const member = (await memberOf(env, userId))!;
    await env.DB.batch([
      ...grantStatements(env, userId, member.id),
      event(env, { userId, applicationId: app.id, influencerId: member.id, event: 'admitted', detail: { tier: decision.tier, terms_uid: termsUid }, actor: adminId, at }),
    ]);
    return {
      application: applicationView((await env.DB.prepare('SELECT * FROM influencer_applications WHERE id = ?').bind(app.id).first<AppRow>())!),
      membership: memberView((await memberOf(env, userId))!),
      terms_uid: termsUid,
    };
  } catch (e) {
    // The admission did not land whole: the application goes back to HQ undecided.
    await env.DB.prepare(
      `UPDATE influencer_applications SET status = ?, tier = NULL, reason = ?, decided_by = NULL, decided_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'admitted' AND decided_at = ?`,
    ).bind(app.status, app.reason, at, app.id, at).run().catch(() => undefined);
    throw e;
  }
}

export type Change = { tier?: Tier; status?: MemberStatus; reason: string };

/** `{ tier?, status?, reason }`: at least one change, always a reason. */
export function readChange(b: any): Change {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw refusal(400, 'invalid_request', 'Send the change as an object.');
  const out: Change = { reason: '' };
  if (b.tier !== undefined) {
    if (!isTier(b.tier)) throw refusal(400, 'unknown_tier', `The tier is one of ${TIERS.join(', ')}.`);
    out.tier = b.tier;
  }
  if (b.status !== undefined) {
    if (!(MEMBER_STATUSES as readonly string[]).includes(b.status)) throw refusal(400, 'unknown_status', 'The status is active, paused or ended.');
    out.status = b.status;
  }
  if (out.tier === undefined && out.status === undefined) throw refusal(400, 'nothing_to_change', 'Change the tier, the status, or both.');
  out.reason = reasonOf(b.reason, 'A change');
  return out;
}

/**
 * HQ's change to a membership: tier, pause, resume or end, each with a reason.
 * Pausing or ending takes back the Investor Pro this program gave; resuming
 * gives it again. An ended membership changes no further (a new application
 * starts a new one).
 */
export async function changeInfluencer(env: Env, adminId: number, uid: string, change: Change, now = Date.now()) {
  const m = await env.DB.prepare('SELECT * FROM influencers WHERE uid = ?').bind(uid).first<MemberRow>();
  if (!m) throw refusal(404, 'influencer_not_found', 'No influencer has that id.');
  if (m.status === 'ended') throw refusal(409, 'influencer_ended', 'This membership has ended. The member can apply again.');
  const tier = change.tier ?? m.tier;
  const status = change.status ?? m.status;
  if (tier === m.tier && status === m.status) throw refusal(409, 'nothing_changed', 'That is already this influencer\'s tier and status.');
  const at = sqlTime(now);
  const moved = await env.DB.prepare(
    'UPDATE influencers SET tier = ?, status = ?, updated_at = ? WHERE id = ? AND tier = ? AND status = ?',
  ).bind(tier, status, at, m.id, m.tier, m.status).run();
  if (!Number(moved.meta?.changes)) throw refusal(409, 'influencer_changed', 'This influencer changed while you were looking. Read them again.');
  const userId = Number(m.user_id);
  const events: string[] = [];
  if (tier !== m.tier) events.push('tier_changed');
  if (status !== m.status) events.push(status === 'active' ? 'resumed' : status);
  await env.DB.batch([
    ...(status !== 'active' && m.status === 'active' ? revokeStatements(env, userId, m.id) : []),
    ...(status === 'active' && m.status !== 'active' ? grantStatements(env, userId, m.id) : []),
    ...events.map((ev) => event(env, {
      userId, influencerId: m.id, event: ev, actor: adminId, at,
      detail: ev === 'tier_changed' ? { from: m.tier, to: tier, reason: change.reason } : { from: m.status, to: status, reason: change.reason },
    })),
  ]);
  return { membership: memberView((await memberOf(env, userId))!), events, before: { tier: m.tier, status: m.status } };
}

/** `/me`'s `influencer_active`: 1 for an active membership, 0 otherwise or when it cannot be read. */
export async function influencerActive(env: Env, userId: number): Promise<0 | 1> {
  try {
    const r = await env.DB.prepare("SELECT 1 AS x FROM influencers WHERE user_id = ? AND status = 'active'").bind(userId).first();
    return r ? 1 : 0;
  } catch { return 0; }
}
