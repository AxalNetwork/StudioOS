/**
 * D659 — the Validate cycle's reads: four figures, six cards, six record
 * tables. Mounted by `routes/cycle_validate.ts` at `/api/cycles/validate`.
 *
 * EVERY CARD READS ITS OWN STORES AND FAILS ON ITS OWN. Each card below is a
 * function of `(ctx)` that loads exactly the rows it draws, with no `.catch`
 * that would turn a failed read into an empty one: a throw reaches
 * `safeCard`, which makes that card `unreadable` and leaves the other five
 * as they are. The loaders the older pages use swallow errors (an empty pain
 * map rather than a broken one); this file asks them for `strict` reads.
 *
 * NOTHING IS STORED. Counts, statuses, shares, trends and the `next` line are
 * all computed here from records, the way `routes/founder_validate.ts`
 * computes its board. `next` names a number it counted, never a template.
 *
 * THE SPIN-OUT LAB READS THROUGH THE SAME FUNCTIONS. A Lab venture is an
 * ordinary `projects` row; its interviews, waitlist and pain groups are the
 * rows below. `labDiscovery` is the Lab discovery page's own funnel,
 * readiness and claim counts, moved here so the cycle read and the Lab page
 * give one answer (`frontend/src/lib/labDiscovery.js` is the page's copy and
 * the test holds the two equal).
 */
import type { Env } from '../types';
import {
  safeCard, safeFigure, seriesState, countState, PAGE_SIZE, pageNumber,
  type Card, type CardState, type Figure,
} from './cycleCards';
import {
  loadPainGroupModel, getPainGroupsView, normPhrase, resolvePhrase, safeParseStrings, severityLevel,
  type PainGroupModel, type PainGroupsView, type PainSeverityLevel,
} from './painGroups';
import { evidenceFor, verdictFor, laneFor } from '../routes/_founder_validate_helpers';
import { seedSegmentFromIcp, WAITLIST_TARGET_KEY } from './validateWriters';
import { claimFills } from './fills/provenance';

export const CYCLE = 'validate';
export const QUESTION = 'Is this worth building?';

export const MODULES = [
  { slug: 'problem-discovery', name: 'Problem discovery' },
  // D685 §5.4: its table is the interviews, so the list says so.
  { slug: 'customer-research', name: 'Customer research', records_title: 'Interviews' },
  { slug: 'ideal-customer-profile', name: 'Ideal customer profile' },
  { slug: 'market-intelligence', name: 'Market intelligence' },
  { slug: 'demand-signals', name: 'Demand and urgency signals' },
  { slug: 'experiments', name: 'Experiments and evidence' },
] as const;
export type ModuleSlug = (typeof MODULES)[number]['slug'];

/** The Lab's own gate, as `SpinoutLabDiscoveryPage` applies it. */
export const LAB_MIN_INTERVIEWS = 3;

export type Ctx = { env: Env; projectId: number; today: string };

const href = (ctx: Ctx, slug: string) => `/validate/${slug}?project=${ctx.projectId}`;
/** D685 §5.4 — the setup modal's own route. */
const recordHref = (ctx: Ctx) => `/validate/record?project=${ctx.projectId}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `YYYY-MM-DD` `n` days before `today`. */
export function daysBefore(today: string, n: number): string {
  const t = Date.parse(`${today}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Loaders — strict: a failed read throws
// ---------------------------------------------------------------------------

export type InterviewRow = {
  id: number;
  interviewee_name: string | null;
  interviewee_role: string | null;
  interviewee_company: string | null;
  interview_date: string | null;
  icp_fit: string | null;
  quote_consent: number | null;
  pains_json: string | null;
  hypotheses_json: string | null;
  notes: string | null;
  stage: string | null;
  segment_id: number | null;
  invited_at: string | null;
  booked_at: string | null;
  done_at: string | null;
  channel: string | null;
  created_at: string | null;
};

async function loadInterviews(ctx: Ctx): Promise<InterviewRow[]> {
  const res = await ctx.env.DB.prepare(
    `SELECT id, interviewee_name, interviewee_role, interviewee_company, interview_date,
            icp_fit, quote_consent, pains_json, hypotheses_json, notes,
            stage, segment_id, invited_at, booked_at, done_at, channel, created_at
       FROM discovery_interviews WHERE project_id = ? ORDER BY id`,
  ).bind(ctx.projectId).all<InterviewRow>();
  return res.results || [];
}

/**
 * HELD MEANS A CONVERSATION THAT HAPPENED. An interview with no `stage` was
 * logged before migration 440 gave it one, and the log form records a
 * conversation after it took place — so it reads as `done`. A lead, an
 * invitation or a booking is not an interview yet.
 */
export const isHeld = (iv: { stage: string | null }) => iv.stage == null || iv.stage === 'done';

/** The day a held interview took place, as the record states it. */
export function heldDate(iv: { done_at: string | null; interview_date: string | null; created_at: string | null }): string | null {
  const d = (iv.done_at || '').slice(0, 10) || String(iv.interview_date || '').trim().slice(0, 10) || (iv.created_at || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function loadSeverities(ctx: Ctx) {
  const res = await ctx.env.DB.prepare(
    `SELECT s.interview_id, s.phrase_norm, s.severity
       FROM interview_pain_severities s
       JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE i.project_id = ?`,
  ).bind(ctx.projectId).all<{ interview_id: number; phrase_norm: string; severity: string }>();
  return res.results || [];
}

type HypRow = {
  id: number; code: string; claim: string; sort_order: number; retired_at: string | null;
  sprint: string | null; owner_user_id: number | null; owner_name: string | null;
  inconclusive_at: string | null; updated_at: string | null;
};
type LinkRow = { id: number; hypothesis_id: number; pain_group_id: number; direction: string; strength: string | null; created_at: string | null };

async function loadHypotheses(ctx: Ctx): Promise<{ hyps: HypRow[]; links: LinkRow[] }> {
  const hyps = await ctx.env.DB.prepare(
    `SELECT h.id, h.code, h.claim, h.sort_order, h.retired_at, h.sprint, h.owner_user_id,
            u.name AS owner_name, h.inconclusive_at, h.updated_at
       FROM hypotheses h LEFT JOIN users u ON u.id = h.owner_user_id
      WHERE h.project_id = ? AND h.retired_at IS NULL
      ORDER BY h.sort_order, h.id`,
  ).bind(ctx.projectId).all<HypRow>();
  const links = await ctx.env.DB.prepare(
    `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction, l.strength, l.created_at
       FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id
      WHERE h.project_id = ? AND h.retired_at IS NULL`,
  ).bind(ctx.projectId).all<LinkRow>();
  return { hyps: hyps.results || [], links: links.results || [] };
}

// ---------------------------------------------------------------------------
// Pain themes, on three severity levels
// ---------------------------------------------------------------------------

export type Theme = {
  key: string;
  title: string;
  group_id: number | null;
  mentions: number;
  severe: number;
  real: number;
  mild: number;
  /** The level most interviews gave it; `null` when none judged it. */
  severity: PainSeverityLevel | null;
  first_mention: string | null;
  last_30d: number;
  prior_30d: number;
  supports: string[];
};

/**
 * The pain map's themes, counted the way `painGroups.analyzePains` counts
 * them — one interview counts once per theme however many ways it named it —
 * with a severity split on Severe / Real / Mild instead of need / nice.
 */
export function themesOf(
  interviews: InterviewRow[],
  model: PainGroupModel,
  severities: Array<{ interview_id: number; phrase_norm: string; severity: string }>,
  today: string,
  supportsByGroup: Map<number, string[]> = new Map(),
): Theme[] {
  const sevBy = new Map<string, string>();
  for (const r of severities) sevBy.set(`${r.interview_id}\u0000${r.phrase_norm}`, r.severity);
  const cut30 = daysBefore(today, 30);
  const cut60 = daysBefore(today, 60);
  type Acc = { key: string; title: string; groupId: number | null; ivs: Set<number>; lv: Record<PainSeverityLevel, Set<number>>; first: string | null; recent: Set<number>; prior: Set<number> };
  const acc = new Map<string, Acc>();
  for (const iv of interviews) {
    const seen = new Set<string>();
    const d = heldDate(iv);
    for (const phrase of safeParseStrings(iv.pains_json)) {
      const display = phrase.trim();
      const norm = normPhrase(display);
      if (!norm) continue;
      const r = resolvePhrase(norm, display, model);
      let a = acc.get(r.key);
      if (!a) {
        a = { key: r.key, title: r.title, groupId: r.groupId, ivs: new Set(), lv: { severe: new Set(), real: new Set(), mild: new Set() }, first: null, recent: new Set(), prior: new Set() };
        acc.set(r.key, a);
      }
      if (!seen.has(r.key)) {
        seen.add(r.key);
        a.ivs.add(iv.id);
        if (d) {
          if (a.first == null || d < a.first) a.first = d;
          if (d > cut30 && d <= today) a.recent.add(iv.id);
          else if (d > cut60 && d <= cut30) a.prior.add(iv.id);
        }
      }
      const level = severityLevel(sevBy.get(`${iv.id}\u0000${norm}`));
      if (level) a.lv[level].add(iv.id);
    }
  }
  return [...acc.values()].map((a) => {
    const severe = a.lv.severe.size; const real = a.lv.real.size; const mild = a.lv.mild.size;
    const top = Math.max(severe, real, mild);
    const severity: PainSeverityLevel | null = top === 0 ? null : severe === top ? 'severe' : real === top ? 'real' : 'mild';
    return {
      key: a.key, title: a.title, group_id: a.groupId, mentions: a.ivs.size,
      severe, real, mild, severity, first_mention: a.first,
      last_30d: a.recent.size, prior_30d: a.prior.size,
      supports: a.groupId != null ? (supportsByGroup.get(a.groupId) || []) : [],
    };
  }).sort((x, y) => y.mentions - x.mentions || x.title.localeCompare(y.title));
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export const CLAIM_STATUSES = ['untested', 'testing', 'supported', 'refuted', 'inconclusive', 'not_recorded'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type Claim = {
  id: number; code: string; claim: string; status: ClaimStatus;
  evidence: number; strength: string | null; sprint: string | null;
  owner: string | null; updated_at: string | null;
  supporting: number; contradicting: number; fit_unrecorded: number;
};

const STRENGTH_RANK: Record<string, number> = { anecdote: 1, pattern: 2, measured: 3 };

/**
 * One status per claim. Supported and Refuted are the founder board's own
 * computed verdict; a founder's Inconclusive mark sits under them, so a
 * claim the evidence later decides leaves Inconclusive by itself. A claim
 * whose deciding interviews have no ICP fit recorded is `not_recorded`.
 */
export function claimsOf(hyps: HypRow[], links: LinkRow[], interviews: InterviewRow[], model: PainGroupModel): Claim[] {
  // The founder board's own hop: phrase → alias → group (`loadEvidenceBase`).
  const ivGroups = interviews.map((iv) => {
    const groups = new Set<number>();
    for (const p of safeParseStrings(iv.pains_json)) {
      const gid = model.aliasByNorm.get(normPhrase(p));
      if (gid) groups.add(gid);
    }
    return { icp_fit: iv.icp_fit, groups };
  });
  const linksBy = new Map<number, LinkRow[]>();
  for (const l of links) {
    if (!linksBy.has(l.hypothesis_id)) linksBy.set(l.hypothesis_id, []);
    linksBy.get(l.hypothesis_id)!.push(l);
  }
  return hyps.map((h) => {
    const ls = linksBy.get(h.id) || [];
    const e = evidenceFor(ls, ivGroups);
    const verdict = verdictFor(e);
    const lane = laneFor(verdict, e);
    const status: ClaimStatus = verdict === 'validated' ? 'supported'
      : verdict === 'invalidated' ? 'refuted'
        : h.inconclusive_at ? 'inconclusive'
          : lane === 'none' ? 'untested'
            : lane === 'testing' ? 'testing'
              : 'not_recorded';
    let strength: string | null = null;
    for (const l of ls) {
      if (l.strength && (strength == null || (STRENGTH_RANK[l.strength] || 0) > (STRENGTH_RANK[strength] || 0))) strength = l.strength;
    }
    return {
      id: Number(h.id), code: h.code, claim: h.claim, status,
      evidence: e.supporting + e.contradicting, strength, sprint: h.sprint,
      owner: h.owner_name ?? null, updated_at: h.updated_at,
      supporting: e.supporting, contradicting: e.contradicting, fit_unrecorded: e.fitUnrecorded,
    };
  });
}

/** The Lab page's per-interview claims: `hypotheses_json` items by status. */
export function interviewClaimsOf(interviews: Array<{ hypotheses_json?: string | null; hypotheses?: unknown }>) {
  let total = 0; let validated = 0; let invalidated = 0;
  for (const iv of interviews) {
    const items = Array.isArray(iv.hypotheses) ? iv.hypotheses : safeParseJsonArray(iv.hypotheses_json);
    for (const h of items as any[]) {
      total += 1;
      if (h?.status === 'validated') validated += 1;
      if (h?.status === 'invalidated') invalidated += 1;
    }
  }
  return { total, validated, invalidated, inconclusive: total - validated - invalidated };
}

function safeParseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ---------------------------------------------------------------------------
// The Spin-Out Lab's discovery figures, generalised
// ---------------------------------------------------------------------------

/**
 * `SpinoutLabDiscoveryPage`'s funnel, four-item readiness and claim counts,
 * computed from the same three reads the page makes: the interviews, the
 * customer waitlist (`audience = 'customer'`, as the page's waitlist route
 * filters) and the pain-group view. Kept line for line with
 * `frontend/src/lib/labDiscovery.js`; `cycle_validate_d659.test.ts` feeds both
 * the same rows and requires the same answer.
 */
export function labDiscovery(
  interviews: Array<{ pains_json?: string | null; hypotheses_json?: string | null; notes?: string | null }>,
  signups: Array<{ crm_status: string | null }>,
  painData: PainGroupsView | null,
  minInterviews: number = LAB_MIN_INTERVIEWS,
) {
  const ivs = interviews.map((iv) => ({ pains: safeParseJsonArray(iv.pains_json), hyps: safeParseJsonArray(iv.hypotheses_json), notes: iv.notes }));
  const claims = interviewClaimsOf(interviews);
  const painRows = [
    ...(painData?.groups || []).map((g: any) => ({ count: Number(g.count ?? 0) || 0 })),
    ...(painData?.ungrouped || []).map((u: any) => ({ count: Number(u.count) || 0 })),
  ].filter((p) => p.count > 0);
  const distinctPains = painRows.length
    || new Set(ivs.flatMap((iv) => iv.pains.map((p) => String(p).trim().toLowerCase()).filter(Boolean))).size;
  const contacted = signups.filter((s) => s.crm_status && s.crm_status !== 'new').length;
  const painConfirmed = ivs.filter((iv) => iv.pains.length > 0).length;
  const solutionFit = ivs.filter((iv) => iv.hyps.some((h: any) => h?.status === 'validated')).length;
  const reached = signups.length + ivs.length;
  const funnel = [
    { label: 'Reached', sub: 'Leads + interviews', n: reached },
    { label: 'Engaged', sub: 'Contacted or interviewed', n: contacted + ivs.length },
    { label: 'Pain confirmed', sub: 'Interviews with a logged pain', n: painConfirmed },
    { label: 'Solution-fit', sub: 'A hypothesis validated', n: solutionFit },
  ].map((f) => ({ ...f, pct: reached ? Math.round((f.n / reached) * 100) : 0 }));
  const notesCount = ivs.filter((iv) => (iv.notes || '').trim().length > 0).length;
  const readiness = [
    { label: `Minimum ${minInterviews} interviews logged`, ok: ivs.length >= minInterviews },
    { label: 'Top 3 pain points identified', ok: distinctPains >= 3 },
    { label: 'Notes attached to every interview', ok: ivs.length > 0 && notesCount === ivs.length },
    { label: 'At least one hypothesis validated', ok: claims.validated > 0 },
  ];
  return { hypotheses: claims, distinct_pains: distinctPains, funnel, readiness, notes_count: notesCount };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** A sparkline is drawn only through three or more recorded points. */
const sparkOrNone = (points: number[]) => (seriesState(points) === 'ok' ? points : []);

async function interviewsFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'interviews_this_month', label: 'Interviews this month', unit: 'interviews', source: 'discovery_interviews' }, async () => {
    // Bucketed in SQL from the day each held interview took place.
    const row = await ctx.env.DB.prepare(
      `WITH held AS (
         SELECT COALESCE(substr(done_at, 1, 10), NULLIF(trim(interview_date), ''), substr(created_at, 1, 10)) AS d
           FROM discovery_interviews
          WHERE project_id = ? AND (stage IS NULL OR stage = 'done'))
       SELECT COUNT(*) AS total,
              SUM(CASE WHEN substr(d, 1, 7) = substr(?, 1, 7) AND d <= ? THEN 1 ELSE 0 END) AS this_month,
              SUM(CASE WHEN d > date(?, '-30 days') AND d <= ? THEN 1 ELSE 0 END) AS last30,
              SUM(CASE WHEN d > date(?, '-60 days') AND d <= date(?, '-30 days') THEN 1 ELSE 0 END) AS prior30
         FROM held`,
    ).bind(ctx.projectId, ctx.today, ctx.today, ctx.today, ctx.today, ctx.today, ctx.today)
      .first<{ total: number; this_month: number | null; last30: number | null; prior30: number | null }>();
    const weeks = await weeklyHeld(ctx, 8);
    const total = Number(row?.total ?? 0);
    if (total === 0) {
      return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No interview logged yet' };
    }
    return {
      value: Number(row?.this_month ?? 0),
      delta_30d: Number(row?.last30 ?? 0) - Number(row?.prior30 ?? 0),
      spark: sparkOrNone(weeks),
      state: 'ok', as_of: ctx.today, reason: null,
    };
  });
}

/** Held interviews per week, oldest first, the last `n` weeks — in SQL. */
async function weeklyHeld(ctx: Ctx, n: number): Promise<number[]> {
  const res = await ctx.env.DB.prepare(
    `WITH held AS (
       SELECT COALESCE(substr(done_at, 1, 10), NULLIF(trim(interview_date), ''), substr(created_at, 1, 10)) AS d
         FROM discovery_interviews
        WHERE project_id = ? AND (stage IS NULL OR stage = 'done'))
     SELECT CAST((julianday(?) - julianday(d)) / 7 AS INTEGER) AS wk, COUNT(*) AS n
       FROM held
      WHERE julianday(d) <= julianday(?) AND julianday(?) - julianday(d) < ? * 7
      GROUP BY wk`,
  ).bind(ctx.projectId, ctx.today, ctx.today, ctx.today, n).all<{ wk: number; n: number }>();
  const out = new Array(n).fill(0);
  for (const r of res.results || []) {
    const wk = Number(r.wk);
    if (wk >= 0 && wk < n) out[n - 1 - wk] = Number(r.n);
  }
  return out;
}

/** Customer-waitlist sign-ups per week, oldest first, the last `n` weeks — in SQL. */
async function weeklySignups(ctx: Ctx, n: number): Promise<{ weeks: number[]; total: number; last30: number }> {
  const res = await ctx.env.DB.prepare(
    `SELECT CAST((julianday(?) - julianday(substr(created_at, 1, 10))) / 7 AS INTEGER) AS wk, COUNT(*) AS n
       FROM waitlist_signups
      WHERE project_id = ? AND (audience IS NULL OR audience = 'customer')
        AND julianday(substr(created_at, 1, 10)) <= julianday(?)
        AND julianday(?) - julianday(substr(created_at, 1, 10)) < ? * 7
      GROUP BY wk`,
  ).bind(ctx.today, ctx.projectId, ctx.today, ctx.today, n).all<{ wk: number; n: number }>();
  const tot = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN substr(created_at, 1, 10) > date(?, '-30 days') THEN 1 ELSE 0 END) AS last30
       FROM waitlist_signups WHERE project_id = ? AND (audience IS NULL OR audience = 'customer')`,
  ).bind(ctx.today, ctx.projectId).first<{ total: number; last30: number | null }>();
  const weeks = new Array(n).fill(0);
  for (const r of res.results || []) {
    const wk = Number(r.wk);
    if (wk >= 0 && wk < n) weeks[n - 1 - wk] = Number(r.n);
  }
  return { weeks, total: Number(tot?.total ?? 0), last30: Number(tot?.last30 ?? 0) };
}

/** Running total at the end of each week, from per-week additions and the total now. */
function cumulative(weeks: number[], totalNow: number): number[] {
  const out = new Array(weeks.length).fill(0);
  let running = totalNow;
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    out[i] = running;
    running -= weeks[i];
  }
  return out;
}

async function painThemesFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'pain_themes', label: 'Pain themes', unit: 'themes', source: 'discovery_interviews · pain_groups' }, async () => {
    const [interviews, model, sev] = await Promise.all([loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), loadSeverities(ctx)]);
    const themes = themesOf(interviews, model, sev, ctx.today);
    if (themes.length === 0) {
      return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No pain logged yet' };
    }
    const cut30 = daysBefore(ctx.today, 30);
    const ends = Array.from({ length: 8 }, (_, i) => daysBefore(ctx.today, (7 - i) * 7));
    const spark = ends.map((end) => themes.filter((t) => t.first_mention != null && t.first_mention <= end).length);
    return {
      value: themes.length,
      delta_30d: themes.filter((t) => t.first_mention != null && t.first_mention > cut30).length,
      spark: sparkOrNone(spark), state: 'ok', as_of: ctx.today, reason: null,
    };
  });
}

async function hypothesesFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'hypotheses_supported', label: 'Hypotheses supported', unit: 'supported', source: 'hypotheses' }, async () => {
    const [{ hyps, links }, interviews, model] = await Promise.all([loadHypotheses(ctx), loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true })]);
    if (hyps.length > 0) {
      const claims = claimsOf(hyps, links, interviews, model);
      const supported = claims.filter((c) => c.status === 'supported').length;
      // The change over 30 days needs to know what was supported 30 days ago,
      // which only the verdict history records — and only from the day it
      // started. Before that it is not recorded, not zero.
      const history = await ctx.env.DB.prepare(
        `SELECT hypothesis_id, lane, observed_at FROM hypothesis_verdict_history
          WHERE project_id = ? ORDER BY observed_at, id`,
      ).bind(ctx.projectId).all<{ hypothesis_id: number; lane: string; observed_at: string }>();
      const obs = history.results || [];
      const cutoff = daysBefore(ctx.today, 30);
      const covered = obs.length > 0 && obs[0].observed_at.slice(0, 10) <= cutoff;
      const supportedAt = (day: string) => {
        const latest = new Map<number, string>();
        for (const o of obs) if (o.observed_at.slice(0, 10) <= day) latest.set(Number(o.hypothesis_id), o.lane);
        return [...latest.values()].filter((l) => l === 'validated').length;
      };
      return {
        value: supported, unit: `of ${claims.length}`,
        delta_30d: covered ? supported - supportedAt(cutoff) : null,
        spark: covered ? sparkOrNone(Array.from({ length: 8 }, (_, i) => supportedAt(daysBefore(ctx.today, (7 - i) * 7)))) : [],
        state: 'ok', as_of: ctx.today,
        reason: covered ? null : 'The change over 30 days is not recorded: verdict history starts later',
      };
    }
    // No project-level claim yet: the Lab's per-interview claims are the record.
    const lab = interviewClaimsOf(interviews);
    if (lab.total > 0) {
      return {
        value: lab.validated, unit: `of ${lab.total}`, delta_30d: null, spark: [], state: 'ok', as_of: ctx.today,
        reason: 'Counted from the claims logged on each interview; no history of them is recorded',
      };
    }
    return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No hypothesis written yet' };
  });
}

async function waitlistFigure(ctx: Ctx): Promise<Figure> {
  return safeFigure({ key: 'waitlist_signups', label: 'Waitlist sign-ups', unit: 'sign-ups', source: 'waitlist_signups' }, async () => {
    const { weeks, total, last30 } = await weeklySignups(ctx, 8);
    if (total === 0) {
      return { value: null, delta_30d: null, spark: [], state: 'empty', as_of: ctx.today, reason: 'No waitlist sign-up yet' };
    }
    return { value: total, delta_30d: last30, spark: sparkOrNone(cumulative(weeks, total)), state: 'ok', as_of: ctx.today, reason: null };
  });
}

export async function figures(ctx: Ctx): Promise<Figure[]> {
  return Promise.all([interviewsFigure(ctx), painThemesFigure(ctx), hypothesesFigure(ctx), waitlistFigure(ctx)]);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

type CardBody = Omit<Card, 'slug' | 'name' | 'range' | 'caption'>;
const meta = (slug: ModuleSlug, range: string, caption: string, source: string) => ({
  slug, name: MODULES.find((m) => m.slug === slug)!.name, range, caption, source,
});

export async function problemDiscoveryCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('problem-discovery', 'All time', 'Pain themes by how many interviews mention each, shaded by severity.', 'Interviews and pain groups'), async (): Promise<CardBody> => {
    const [interviews, model, sev, { hyps, links }] = await Promise.all([
      loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), loadSeverities(ctx), loadHypotheses(ctx),
    ]);
    const themes = themesOf(interviews, model, sev, ctx.today, supportsByGroup(hyps, links));
    if (themes.length === 0) {
      return { state: 'empty', series: null, next: { text: 'Record your first session', href: recordHref(ctx) }, reason: 'No interviews yet. Pain themes appear as interviews are logged.' };
    }
    const ungrouped = themes.filter((t) => t.group_id == null);
    const unjudged = themes.filter((t) => t.severity == null);
    const next = ungrouped.length > 0
      ? { text: `Group the ${plural(ungrouped.length, 'pain that sits', 'pains that sit')} in no theme`, href: href(ctx, 'problem-discovery') }
      : unjudged.length > 0
        ? { text: `Judge how much ${plural(unjudged.length, 'theme', 'themes')} hurt`, href: href(ctx, 'problem-discovery') }
        : null;
    return {
      state: countState(themes.length),
      series: { themes: themes.slice(0, 8).map((t) => ({ theme: t.title, mentions: t.mentions, severity: t.severity, severe: t.severe, real: t.real, mild: t.mild })), more: Math.max(0, themes.length - 8) },
      next, reason: null,
    };
  });
}

function supportsByGroup(hyps: HypRow[], links: LinkRow[]): Map<number, string[]> {
  const code = new Map(hyps.map((h) => [Number(h.id), h.code]));
  const out = new Map<number, string[]>();
  for (const l of links) {
    if (l.direction !== 'supports' || !code.has(Number(l.hypothesis_id))) continue;
    if (!out.has(l.pain_group_id)) out.set(l.pain_group_id, []);
    out.get(l.pain_group_id)!.push(code.get(Number(l.hypothesis_id))!);
  }
  return out;
}

async function loadCustomerSignups(ctx: Ctx) {
  const res = await ctx.env.DB.prepare(
    `SELECT id, name, email, crm_status, created_at, promoted_interview_id
       FROM waitlist_signups WHERE project_id = ? AND audience = 'customer'
      ORDER BY created_at DESC, id DESC`,
  ).bind(ctx.projectId).all<{ id: number; name: string | null; email: string; crm_status: string | null; created_at: string | null; promoted_interview_id: number | null }>();
  return res.results || [];
}

/**
 * The recruiting pipeline, counted by the stage each record has REACHED.
 * Interviews carry their stage; the customer waitlist carries a CRM status
 * whose `invited` and `followed_up` are an invitation. A promoted sign-up is
 * already an interview and is counted there, once.
 */
export function pipelineOf(interviews: InterviewRow[], signups: Array<{ crm_status: string | null }>) {
  const st = (s: string | null) => (s == null ? 'done' : s);
  const done = interviews.filter((i) => st(i.stage) === 'done').length;
  const booked = done + interviews.filter((i) => i.stage === 'booked').length;
  const wlInvited = signups.filter((s) => s.crm_status === 'invited' || s.crm_status === 'followed_up').length;
  const wlNew = signups.filter((s) => s.crm_status == null || s.crm_status === 'new').length;
  const invited = booked + interviews.filter((i) => i.stage === 'invited').length + wlInvited;
  const lead = invited + interviews.filter((i) => i.stage === 'lead').length + wlNew;
  return { lead, invited, booked, done };
}

export async function customerResearchCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('customer-research', 'Last 12 weeks', 'Interviews per week, beside the recruiting pipeline.', 'Interviews and the customer waitlist'), async (): Promise<CardBody> => {
    const [interviews, signups, weeks, painData] = await Promise.all([
      loadInterviews(ctx), loadCustomerSignups(ctx), weeklyHeld(ctx, 12),
      getPainGroupsView(ctx.env, ctx.projectId, { strict: true }),
    ]);
    if (interviews.length === 0 && signups.length === 0) {
      return { state: 'empty', series: null, next: { text: 'Record your first session', href: recordHref(ctx) }, reason: 'No interviews yet. Validate starts with the first conversation.' };
    }
    const funnel = pipelineOf(interviews, signups);
    const waitingSlot = interviews.filter((i) => i.stage === 'invited' && !i.booked_at).length;
    const newLeads = signups.filter((s) => s.crm_status == null || s.crm_status === 'new').length;
    const held = interviews.filter(isHeld).length;
    const next = waitingSlot > 0
      ? { text: `Book the ${plural(waitingSlot, 'invited lead', 'invited leads')} with no slot yet`, href: href(ctx, 'customer-research') }
      : newLeads > 0
        ? { text: `Invite the ${plural(newLeads, 'new waitlist lead', 'new waitlist leads')}`, href: href(ctx, 'customer-research') }
        : held < LAB_MIN_INTERVIEWS
          ? { text: `Log ${plural(LAB_MIN_INTERVIEWS - held, 'more interview', 'more interviews')}`, href: href(ctx, 'customer-research') }
          : null;
    const state: CardState = seriesState(weeks);
    return {
      state: state === 'empty' ? 'too_little' : state,
      series: {
        weeks: weeks.map((n, i) => ({ week_start: daysBefore(ctx.today, (12 - i) * 7 - 1), interviews: n })),
        funnel,
        lab: labDiscovery(interviews, signups, painData),
      },
      next,
      reason: state === 'ok' ? null : `${plural(weeks.filter((w) => w > 0).length, 'week', 'weeks')} with an interview in the last 12. The chart appears at 3.`,
    };
  });
}

type SegmentRow = { id: number; name: string; source: string; updated_at: string | null };

async function loadSegments(ctx: Ctx): Promise<SegmentRow[]> {
  const res = await ctx.env.DB.prepare(
    `SELECT id, name, source, updated_at FROM customer_segments
      WHERE project_id = ? AND archived_at IS NULL ORDER BY id`,
  ).bind(ctx.projectId).all<SegmentRow>();
  return res.results || [];
}

export type SegmentSummary = {
  id: number | null; name: string; source: string | null;
  interviews: number; strong: number; partial: number; none: number; unrecorded: number;
  /** anecdote under three interviews, pattern from three; null with none. */
  evidence: 'anecdote' | 'pattern' | null;
  updated_at: string | null;
};

/**
 * Interviews by fit, per segment. EVIDENCE STOPS AT PATTERN: Measured needs a
 * measured signal tied to a segment, and no store links a demand signal or a
 * payment to a segment yet. Saying Measured from interview counts alone would
 * be the overclaim the canvas's own legend exists to prevent.
 */
export function segmentsOf(segments: SegmentRow[], interviews: InterviewRow[]): { segments: SegmentSummary[]; unassigned: number } {
  const held = interviews.filter(isHeld);
  const summary = (id: number | null, name: string, source: string | null, updated: string | null): SegmentSummary => {
    const ivs = held.filter((i) => (i.segment_id ?? null) === id);
    const n = ivs.length;
    return {
      id, name, source, interviews: n,
      strong: ivs.filter((i) => i.icp_fit === 'strong').length,
      partial: ivs.filter((i) => i.icp_fit === 'partial').length,
      none: ivs.filter((i) => i.icp_fit === 'none').length,
      unrecorded: ivs.filter((i) => i.icp_fit == null).length,
      evidence: n === 0 ? null : n < 3 ? 'anecdote' : 'pattern',
      updated_at: updated,
    };
  };
  const known = new Set(segments.map((s) => Number(s.id)));
  return {
    segments: segments.map((s) => summary(Number(s.id), s.name, s.source, s.updated_at)),
    unassigned: held.filter((i) => i.segment_id == null || !known.has(Number(i.segment_id))).length,
  };
}

export async function icpCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('ideal-customer-profile', 'All time', 'Interviews by fit, for each segment.', 'Customer segments and interviews'), async (): Promise<CardBody> => {
    // The first segment is the founder's own confirmed ICP definition, copied
    // once (see `seedSegmentFromIcp`). Nothing else is ever written by a read.
    await seedSegmentFromIcp(ctx.env, ctx.projectId);
    const [segments, interviews] = await Promise.all([loadSegments(ctx), loadInterviews(ctx)]);
    if (segments.length === 0) {
      return { state: 'empty', series: null, next: { text: 'Start the profile', href: href(ctx, 'ideal-customer-profile') }, reason: 'No segment yet. Write who your customer is.' };
    }
    const { segments: rows, unassigned } = segmentsOf(segments, interviews);
    const assigned = rows.reduce((a, s) => a + s.interviews, 0);
    const thin = rows.filter((s) => s.interviews < 3).sort((a, b) => a.interviews - b.interviews)[0];
    const next = unassigned > 0
      ? { text: `Put the ${plural(unassigned, 'interview', 'interviews')} with no segment into one`, href: href(ctx, 'ideal-customer-profile') }
      : thin
        ? { text: `Interview ${3 - thin.interviews} more ${3 - thin.interviews === 1 ? 'person' : 'people'} from ${thin.name}`, href: href(ctx, 'ideal-customer-profile') }
        : null;
    return {
      state: countState(assigned),
      series: { segments: rows.map((s) => ({ id: s.id, name: s.name, strong: s.strong, partial: s.partial, weak: s.none, not_recorded: s.unrecorded })), unassigned },
      next,
      reason: assigned < 3 ? `${plural(assigned, 'interview', 'interviews')} placed in a segment so far. The chart appears at 3.` : null,
    };
  });
}

type MarketFigure = { value: number | null; source: string | null; reason: string | null };

async function loadMarket(ctx: Ctx) {
  const p = await ctx.env.DB.prepare('SELECT tam, sam, som FROM projects WHERE id = ?')
    .bind(ctx.projectId).first<{ tam: number | null; sam: number | null; som: number | null }>();
  const fig = (v: number | null | undefined): MarketFigure => {
    const n = Number(v);
    if (v == null || !Number.isFinite(n) || n <= 0) return { value: null, source: null, reason: 'No figure entered' };
    // No store records where a total, serviceable or obtainable figure came
    // from — only the sizing INPUTS carry a sourced fill. Said, not guessed.
    return { value: n, source: null, reason: 'No source recorded for this figure' };
  };
  return { tam: fig(p?.tam), sam: fig(p?.sam), som: fig(p?.som) };
}

async function loadMarketReadiness(ctx: Ctx) {
  const marks = await ctx.env.DB.prepare(
    'SELECT item, marked_at FROM market_readiness_marks WHERE project_id = ?',
  ).bind(ctx.projectId).all<{ item: string; marked_at: string }>();
  const sources = await ctx.env.DB.prepare(
    'SELECT id, title, url, kind, created_at FROM market_sources WHERE project_id = ? ORDER BY id',
  ).bind(ctx.projectId).all<{ id: number; title: string; url: string | null; kind: string; created_at: string }>();
  const m = new Map((marks.results || []).map((r) => [r.item, r.marked_at]));
  return {
    positioning_map: m.get('positioning_map') ?? null,
    assumptions_reviewed: m.get('assumptions_reviewed') ?? null,
    sources: sources.results || [],
  };
}

export { loadMarketReadiness };

type TrackedCompetitor = { id: string; name: string; kind: string; latest_signal: string | null; latest_on: string | null; source_url: string | null; source_kind: string | null };

/** The project's tracked list: every analysis's candidates, one per name. */
async function loadTracked(ctx: Ctx): Promise<TrackedCompetitor[]> {
  const cands = await ctx.env.DB.prepare(
    `SELECT c.id, c.name, c.category, c.created_at
       FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
      WHERE a.project_id = ? ORDER BY c.created_at, c.id`,
  ).bind(ctx.projectId).all<{ id: string; name: string; category: string; created_at: string }>();
  const sigs = await ctx.env.DB.prepare(
    `SELECT s.candidate_id, s.label, s.signal_type, COALESCE(s.observed_on, substr(s.created_at, 1, 10)) AS on_day,
            s.source_url, s.source_kind
       FROM competitor_signals s JOIN competitor_analyses a ON a.id = s.analysis_id
      WHERE a.project_id = ? ORDER BY on_day DESC, s.created_at DESC`,
  ).bind(ctx.projectId).all<{ candidate_id: string | null; label: string | null; signal_type: string; on_day: string | null; source_url: string | null; source_kind: string | null }>();
  const latest = new Map<string, any>();
  for (const s of sigs.results || []) if (s.candidate_id && !latest.has(s.candidate_id)) latest.set(s.candidate_id, s);
  const byName = new Map<string, TrackedCompetitor>();
  for (const c of cands.results || []) {
    const key = String(c.name || '').trim().toLowerCase();
    if (!key) continue;
    const s = latest.get(c.id);
    const prev = byName.get(key);
    if (prev && (!s || (prev.latest_on && s.on_day && prev.latest_on >= s.on_day))) continue;
    byName.set(key, {
      id: c.id, name: c.name, kind: c.category === 'adjacent' ? 'adjacent' : 'direct',
      latest_signal: s ? (s.label || s.signal_type) : null, latest_on: s ? s.on_day : null,
      source_url: s ? s.source_url : null, source_kind: s ? s.source_kind : null,
    });
  }
  return [...byName.values()];
}

export async function marketCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('market-intelligence', 'As recorded', 'Total, serviceable and obtainable market, each with its source.', 'Market figures and the competitor list'), async (): Promise<CardBody> => {
    const [market, tracked, readiness] = await Promise.all([loadMarket(ctx), loadTracked(ctx), loadMarketReadiness(ctx)]);
    const defined = [market.tam, market.sam, market.som].filter((f) => f.value != null).length;
    if (defined === 0 && tracked.length === 0) {
      return { state: 'empty', series: null, next: { text: 'Add the total market, with its source', href: href(ctx, 'market-intelligence') }, reason: 'No market size yet.' };
    }
    const missing = market.tam.value == null ? 'total' : market.sam.value == null ? 'serviceable' : market.som.value == null ? 'obtainable' : null;
    const next = missing
      ? { text: `Add the ${missing} market`, href: href(ctx, 'market-intelligence') }
      : tracked.length < 3
        ? { text: `Track ${3 - tracked.length} more ${3 - tracked.length === 1 ? 'competitor' : 'competitors'}`, href: href(ctx, 'market-intelligence') }
        : !readiness.positioning_map
          ? { text: 'Complete the positioning map', href: href(ctx, 'market-intelligence') }
          : null;
    return {
      state: 'ok',
      series: {
        tam: market.tam, sam: market.sam, som: market.som,
        competitors_tracked: tracked.length,
        readiness: { positioning_map: readiness.positioning_map != null, assumptions_reviewed: readiness.assumptions_reviewed != null, sources: readiness.sources.length },
      },
      next, reason: null,
    };
  });
}

async function loadDemand(ctx: Ctx) {
  const signals = await ctx.env.DB.prepare(
    `SELECT id, kind, who, amount_cents, currency, period, signal_date, status, source_kind
       FROM demand_signals WHERE project_id = ? ORDER BY signal_date DESC, id DESC`,
  ).bind(ctx.projectId).all<{ id: number; kind: string; who: string | null; amount_cents: number | null; currency: string | null; period: string | null; signal_date: string; status: string; source_kind: string }>();
  // A paid deposit or pilot IS a pre-sale, and the revenue ledger already
  // holds it with its proof. Read, never copied.
  const paid = await ctx.env.DB.prepare(
    `SELECT id, revenue_type, customer, amount_cents, currency, received_on, verification
       FROM revenue_entries WHERE project_id = ? AND revenue_type IN ('deposit', 'pilot')
      ORDER BY received_on DESC, id DESC`,
  ).bind(ctx.projectId).all<{ id: number; revenue_type: string; customer: string; amount_cents: number; currency: string; received_on: string; verification: string }>();
  return { signals: signals.results || [], paid: paid.results || [] };
}

export async function demandCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('demand-signals', 'Last 13 weeks', 'Waitlist sign-ups against the bar you set, and the share calling it a need-to-have.', 'Waitlist, demand signals and the revenue ledger'), async (): Promise<CardBody> => {
    const [{ weeks, total }, bar, demand, sev, interviews] = await Promise.all([
      weeklySignups(ctx, 13),
      ctx.env.DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
        .bind(ctx.projectId, WAITLIST_TARGET_KEY).first<{ target_value: number }>(),
      loadDemand(ctx), loadSeverities(ctx), loadInterviews(ctx),
    ]);
    // Need-to-have: of the interviews in which a severity was judged at all,
    // those that judged a pain Severe or Real (an old `need` reads as Severe).
    const projectIvs = new Set(interviews.map((i) => Number(i.id)));
    const judged = new Set<number>(); const need = new Set<number>();
    for (const s of sev) {
      if (!projectIvs.has(Number(s.interview_id))) continue;
      const lv = severityLevel(s.severity);
      if (!lv) continue;
      judged.add(Number(s.interview_id));
      if (lv === 'severe' || lv === 'real') need.add(Number(s.interview_id));
    }
    const counts: Record<string, number> = { loi: 0, pre_sale: 0, waitlist: 0, need_to_have: 0, would_pay: 0 };
    for (const s of demand.signals) if (s.status !== 'to_confirm' && s.kind in counts) counts[s.kind] += 1;
    counts.pre_sale += demand.paid.length;
    const toConfirm = demand.signals.filter((s) => s.status === 'to_confirm').length;
    if (total === 0 && demand.signals.length === 0 && demand.paid.length === 0 && judged.size === 0) {
      return { state: 'empty', series: null, next: { text: 'Connect a landing page', href: href(ctx, 'demand-signals') }, reason: 'No waitlist connected.' };
    }
    const next = !bar
      ? { text: 'Set the bar for waitlist sign-ups', href: href(ctx, 'demand-signals') }
      : toConfirm > 0
        ? { text: `Confirm the ${plural(toConfirm, 'signal', 'signals')} waiting`, href: href(ctx, 'demand-signals') }
        : null;
    const state = seriesState(weeks);
    return {
      state: state === 'empty' && (demand.signals.length > 0 || demand.paid.length > 0 || judged.size > 0) ? 'too_little' : state,
      series: {
        signups: cumulative(weeks, total).map((n, i) => ({ week_start: daysBefore(ctx.today, (13 - i) * 7 - 1), total: n })),
        bar: bar ? Number(bar.target_value) : null,
        bar_reason: bar ? null : 'No bar set',
        need_to_have: judged.size > 0 ? { interviews: need.size, of: judged.size } : null,
        need_to_have_reason: judged.size > 0 ? null : 'No interview has a pain judged yet',
        signals: counts,
      },
      next,
      reason: state === 'ok' ? null : `${plural(weeks.filter((w) => w > 0).length, 'week', 'weeks')} with a sign-up in the last 13. The line appears at 3.`,
    };
  });
}

export async function experimentsCard(ctx: Ctx): Promise<Card> {
  return safeCard(meta('experiments', 'Last 8 weeks', 'Hypotheses by status; evidence added per week.', 'Hypotheses and their evidence'), async (): Promise<CardBody> => {
    const [{ hyps, links }, interviews, model] = await Promise.all([loadHypotheses(ctx), loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true })]);
    const lab = interviewClaimsOf(interviews);
    if (hyps.length === 0 && lab.total === 0) {
      return { state: 'empty', series: null, next: { text: 'Write the claim you most need to be true', href: href(ctx, 'experiments') }, reason: 'No hypothesis yet.' };
    }
    const claims = claimsOf(hyps, links, interviews, model);
    const statuses = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, claims.filter((c) => c.status === s).length]));
    // Evidence added per week, by strength — bucketed in SQL.
    const wk = await ctx.env.DB.prepare(
      `SELECT CAST((julianday(?) - julianday(substr(l.created_at, 1, 10))) / 7 AS INTEGER) AS wk,
              COALESCE(l.strength, 'not_recorded') AS strength, COUNT(*) AS n
         FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id
        WHERE h.project_id = ? AND h.retired_at IS NULL
          AND julianday(substr(l.created_at, 1, 10)) <= julianday(?)
          AND julianday(?) - julianday(substr(l.created_at, 1, 10)) < 56
        GROUP BY wk, strength`,
    ).bind(ctx.today, ctx.projectId, ctx.today, ctx.today).all<{ wk: number; strength: string; n: number }>();
    const weeks = Array.from({ length: 8 }, (_, i) => ({ week_start: daysBefore(ctx.today, (8 - i) * 7 - 1), anecdote: 0, pattern: 0, measured: 0, not_recorded: 0 }));
    for (const r of wk.results || []) {
      const i = 7 - Number(r.wk);
      if (i < 0 || i > 7) continue;
      const k = (['anecdote', 'pattern', 'measured'].includes(r.strength) ? r.strength : 'not_recorded') as 'anecdote' | 'pattern' | 'measured' | 'not_recorded';
      weeks[i][k] += Number(r.n);
    }
    const inSprint = claims.find((c) => c.sprint && c.status === 'testing');
    const untested = claims.find((c) => c.status === 'untested');
    const next = inSprint
      ? { text: `Close ${inSprint.sprint} with a result for ${inSprint.code}`, href: href(ctx, 'experiments') }
      : untested
        ? { text: `Link evidence to ${untested.code}`, href: href(ctx, 'experiments') }
        : null;
    const n = claims.length || lab.total;
    return {
      state: countState(n),
      series: { statuses, weeks, interview_claims: lab },
      next,
      reason: n < 3 ? `${plural(n, 'hypothesis', 'hypotheses')} so far. The chart appears at 3.` : null,
    };
  });
}

export async function cards(ctx: Ctx): Promise<Card[]> {
  return Promise.all([
    problemDiscoveryCard(ctx), customerResearchCard(ctx), icpCard(ctx),
    marketCard(ctx), demandCard(ctx), experimentsCard(ctx),
  ]);
}

export const CARD_FOR: Record<ModuleSlug, (ctx: Ctx) => Promise<Card>> = {
  'problem-discovery': problemDiscoveryCard,
  'customer-research': customerResearchCard,
  'ideal-customer-profile': icpCard,
  'market-intelligence': marketCard,
  'demand-signals': demandCard,
  experiments: experimentsCard,
};

// ---------------------------------------------------------------------------
// Module records — search, filters, sort, pages
// ---------------------------------------------------------------------------

export type RecordQuery = { q: string; filter: Record<string, string>; sort: string; page: number };
export type Records = {
  cols: string[]; rows: Array<Record<string, unknown>>; total: number; page: number; page_size: number;
  /** Experiments only: false when `fill_provenance` could not be read (#1523). */
  fills_recorded?: boolean;
};

/** `filter=key:value,key:value` → a map, each part charset-checked. */
export function parseFilter(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(raw ?? '').split(',')) {
    const [k, v] = part.split(':');
    if (!k || v == null) continue;
    if (!/^[a-z_]{1,32}$/.test(k) || !/^[A-Za-z0-9_ .-]{1,60}$/.test(v)) continue;
    out[k] = v;
  }
  return out;
}

export function recordQuery(params: { q?: unknown; filter?: unknown; sort?: unknown; page?: unknown }): RecordQuery {
  return {
    q: String(params.q ?? '').trim().slice(0, 120).toLowerCase(),
    filter: parseFilter(params.filter),
    sort: /^[a-z_]{1,32}$/.test(String(params.sort ?? '')) ? String(params.sort) : '',
    page: pageNumber(params.page),
  };
}

function paged(cols: string[], rows: Array<Record<string, unknown>>, page: number): Records {
  const start = (page - 1) * PAGE_SIZE;
  return { cols, rows: rows.slice(start, start + PAGE_SIZE), total: rows.length, page, page_size: PAGE_SIZE };
}

const has = (q: string, ...vals: Array<unknown>) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q));

async function problemRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const [interviews, model, sev, { hyps, links }] = await Promise.all([
    loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), loadSeverities(ctx), loadHypotheses(ctx),
  ]);
  let rows = themesOf(interviews, model, sev, ctx.today, supportsByGroup(hyps, links)).filter((t) => has(rq.q, t.title));
  const f = rq.filter;
  if (f.severity) rows = rows.filter((t) => (f.severity === 'not_recorded' ? t.severity == null : t.severity === f.severity));
  if (f.hypothesis === 'linked') rows = rows.filter((t) => t.supports.length > 0);
  if (f.hypothesis === 'unlinked') rows = rows.filter((t) => t.supports.length === 0);
  if (rq.sort === 'trend') rows.sort((a, b) => (b.last_30d - b.prior_30d) - (a.last_30d - a.prior_30d));
  else if (rq.sort === 'theme') rows.sort((a, b) => a.title.localeCompare(b.title));
  return paged(['Theme', 'Mentions', 'Severity', 'Trend', 'Supports'], rows.map((t) => ({
    id: t.group_id, theme: t.title, mentions: t.mentions, severity: t.severity,
    trend: t.last_30d - t.prior_30d, supports: t.supports.length ? t.supports : null,
  })), rq.page);
}

/** Customer research is the one table paged in SQL: it is the one that grows. */
async function researchRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const f = rq.filter;
  const icp = ['strong', 'partial', 'none'].includes(f.icp) ? f.icp : f.icp === 'not_recorded' ? 'not_recorded' : '';
  const consent = ['agreed', 'declined', 'not_asked'].includes(f.consent) ? f.consent : '';
  // D685: `pipeline` is the recruiting picker's filter, the three stages still to come.
  const stage = ['lead', 'invited', 'booked', 'done', 'pipeline'].includes(f.stage) ? f.stage : '';
  const channel = ['in_person', 'video', 'phone', 'text', 'manual'].includes(f.channel) ? f.channel : '';
  const like = rq.q ? `%${rq.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : '';
  // Every condition is a bound parameter; an empty one switches itself off.
  // The statement is literal twice over (count and page) rather than spliced.
  const binds = [ctx.projectId, like, like, like, icp, icp, icp, consent, consent, consent, consent, stage, stage, stage, channel, channel];
  const sort = rq.sort === 'oldest' || rq.sort === 'name' || rq.sort === 'booked' ? rq.sort : 'newest';
  const total = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM discovery_interviews
      WHERE project_id = ?
        AND (? = '' OR lower(interviewee_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(interviewee_company, '')) LIKE ? ESCAPE '\\')
        AND (? = '' OR (? = 'not_recorded' AND icp_fit IS NULL) OR icp_fit = ?)
        AND (? = '' OR (? = 'agreed' AND quote_consent = 1) OR (? = 'declined' AND quote_consent = 0) OR (? = 'not_asked' AND quote_consent IS NULL))
        AND (? = '' OR COALESCE(stage, 'done') = ? OR (? = 'pipeline' AND stage IN ('lead', 'invited', 'booked')))
        AND (? = '' OR channel = ?)`,
  ).bind(...binds).first<{ n: number }>();
  const rows = await ctx.env.DB.prepare(
    `SELECT id, interviewee_name, interviewee_company, icp_fit, quote_consent, channel, stage,
            COALESCE(substr(done_at, 1, 10), NULLIF(trim(interview_date), ''), substr(created_at, 1, 10)) AS d
       FROM discovery_interviews
      WHERE project_id = ?
        AND (? = '' OR lower(interviewee_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(interviewee_company, '')) LIKE ? ESCAPE '\\')
        AND (? = '' OR (? = 'not_recorded' AND icp_fit IS NULL) OR icp_fit = ?)
        AND (? = '' OR (? = 'agreed' AND quote_consent = 1) OR (? = 'declined' AND quote_consent = 0) OR (? = 'not_asked' AND quote_consent IS NULL))
        AND (? = '' OR COALESCE(stage, 'done') = ? OR (? = 'pipeline' AND stage IN ('lead', 'invited', 'booked')))
        AND (? = '' OR channel = ?)
      ORDER BY CASE WHEN ? = 'booked' THEN CASE stage WHEN 'booked' THEN 0 WHEN 'invited' THEN 1 WHEN 'lead' THEN 2 ELSE 3 END END ASC,
               CASE WHEN ? = 'name' THEN lower(interviewee_name) END ASC,
               CASE WHEN ? = 'oldest' THEN d END ASC,
               CASE WHEN ? = 'newest' THEN d END DESC,
               CASE WHEN ? = 'oldest' THEN id END ASC,
               id DESC
      LIMIT ? OFFSET ?`,
  ).bind(...binds, sort, sort, sort, sort, sort, PAGE_SIZE, (rq.page - 1) * PAGE_SIZE).all<any>();
  return {
    cols: ['Interviewee', 'Company', 'Date', 'ICP fit', 'Consent', 'Channel', 'Stage'],
    rows: (rows.results || []).map((r) => ({
      id: r.id, interviewee: r.interviewee_name, company: r.interviewee_company ?? null,
      date: r.d ?? null, icp_fit: r.icp_fit ?? null,
      consent: r.quote_consent === 1 ? 'agreed' : r.quote_consent === 0 ? 'declined' : null,
      channel: r.channel ?? null, stage: r.stage ?? 'done',
    })),
    total: Number(total?.n ?? 0), page: rq.page, page_size: PAGE_SIZE,
  };
}

async function icpRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const [segments, interviews] = await Promise.all([loadSegments(ctx), loadInterviews(ctx)]);
  let rows = segmentsOf(segments, interviews).segments.filter((s) => has(rq.q, s.name));
  if (rq.filter.evidence) rows = rows.filter((s) => (rq.filter.evidence === 'not_recorded' ? s.evidence == null : s.evidence === rq.filter.evidence));
  if (rq.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  else if (rq.sort === 'strong') rows.sort((a, b) => b.strong - a.strong);
  else rows.sort((a, b) => b.interviews - a.interviews);
  return paged(['Segment', 'Interviews', 'Strong fit', 'Evidence', 'Updated'], rows.map((s) => ({
    id: s.id, segment: s.name, interviews: s.interviews, strong_fit: s.strong, evidence: s.evidence, updated: s.updated_at,
  })), rq.page);
}

async function marketRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  let rows = (await loadTracked(ctx)).filter((c) => has(rq.q, c.name, c.latest_signal));
  if (rq.filter.kind) rows = rows.filter((c) => c.kind === rq.filter.kind);
  if (rq.filter.signal === 'has') rows = rows.filter((c) => c.latest_signal != null);
  if (rq.filter.signal === 'none') rows = rows.filter((c) => c.latest_signal == null);
  if (rq.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  else rows.sort((a, b) => String(b.latest_on ?? '').localeCompare(String(a.latest_on ?? '')));
  return paged(['Company', 'Kind', 'Latest signal', 'Date', 'Source'], rows.map((c) => ({
    id: /^[a-z0-9][a-z0-9_-]*$/.test(String(c.id)) ? c.id : null,
    company: c.name, kind: c.kind, latest_signal: c.latest_signal, date: c.latest_on,
    source: c.source_url ?? c.source_kind ?? null,
  })), rq.page);
}

async function demandRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const [demand, signups] = await Promise.all([
    loadDemand(ctx),
    ctx.env.DB.prepare(
      `SELECT id, name, created_at FROM waitlist_signups
        WHERE project_id = ? AND (audience IS NULL OR audience = 'customer') ORDER BY created_at DESC, id DESC`,
    ).bind(ctx.projectId).all<{ id: number; name: string | null; created_at: string | null }>(),
  ]);
  type Row = { key: string; signal: string; who: string | null; amount_cents: number | null; currency: string | null; period: string | null; date: string | null; counts: string };
  let rows: Row[] = [
    ...demand.signals.map((s) => ({ key: `signal-${s.id}`, signal: s.kind, who: s.who, amount_cents: s.amount_cents, currency: s.currency, period: s.period, date: s.signal_date, counts: s.status })),
    ...demand.paid.map((p) => ({ key: `revenue-${p.id}`, signal: 'pre_sale', who: p.customer, amount_cents: p.amount_cents, currency: p.currency, period: 'once', date: p.received_on, counts: 'confirmed' })),
    // A sign-up's name is shown when they gave one; an address is not a name.
    ...(signups.results || []).map((w) => ({ key: `waitlist-${w.id}`, signal: 'waitlist', who: w.name ?? null, amount_cents: null, currency: null, period: null, date: (w.created_at || '').slice(0, 10) || null, counts: 'counted' })),
  ];
  rows = rows.filter((r) => has(rq.q, r.signal, r.who));
  if (rq.filter.kind) rows = rows.filter((r) => r.signal === rq.filter.kind);
  if (rq.filter.period === '30' || rq.filter.period === '90') {
    const cut = daysBefore(ctx.today, Number(rq.filter.period));
    rows = rows.filter((r) => r.date != null && r.date > cut);
  }
  rows.sort((a, b) => (rq.sort === 'oldest' ? String(a.date ?? '').localeCompare(String(b.date ?? '')) : String(b.date ?? '').localeCompare(String(a.date ?? ''))));
  return paged(['Signal', 'Who', 'Amount', 'Date', 'Counts'], rows.map((r) => ({
    id: r.key, signal: r.signal, who: r.who, amount_cents: r.amount_cents, currency: r.currency, period: r.period, date: r.date, counts: r.counts,
  })), rq.page);
}

/**
 * Eadwyn's mark on one claim (D424, #1523), from the board's own reader
 * (`claimFills`): `eadwyn` for a claim it proposed and the founder accepted as
 * written, `eadwyn_edited` when the founder corrected it before accepting,
 * `null` for a founder's own claim (or one rewritten since), and
 * `unreadable` when `fill_provenance` could not be read, so a failed read never
 * passes for "every claim was typed by hand".
 */
export type ClaimProvenance = 'eadwyn' | 'eadwyn_edited' | 'unreadable' | null;

async function experimentRecords(ctx: Ctx, rq: RecordQuery): Promise<Records> {
  const [{ hyps, links }, interviews, model] = await Promise.all([loadHypotheses(ctx), loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true })]);
  // One read for every claim, never allowed to cost the table.
  let fillsRecorded = true;
  const fills = await claimFills(ctx.env, ctx.projectId, hyps).catch(() => {
    fillsRecorded = false;
    return new Map<number, { edited: boolean }>();
  });
  const provenanceOf = (id: number): ClaimProvenance => {
    if (!fillsRecorded) return 'unreadable';
    const f = fills.get(id);
    return f ? (f.edited ? 'eadwyn_edited' : 'eadwyn') : null;
  };
  let rows = claimsOf(hyps, links, interviews, model).filter((c) => has(rq.q, c.code, c.claim));
  if (rq.filter.status) rows = rows.filter((c) => c.status === rq.filter.status);
  if (rq.filter.sprint) rows = rows.filter((c) => c.sprint === rq.filter.sprint);
  if (rq.filter.strength) rows = rows.filter((c) => (rq.filter.strength === 'not_recorded' ? c.strength == null : c.strength === rq.filter.strength));
  if (rq.sort === 'status') rows.sort((a, b) => CLAIM_STATUSES.indexOf(a.status) - CLAIM_STATUSES.indexOf(b.status));
  else if (rq.sort === 'code') rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  else rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  return {
    ...paged(['Hypothesis', 'Status', 'Evidence', 'Sprint', 'Owner', 'Source'], rows.map((c) => ({
      id: c.id, hypothesis: `${c.code} · ${c.claim}`, status: c.status,
      evidence: c.evidence, strength: c.strength, sprint: c.sprint, owner: c.owner,
      provenance: provenanceOf(c.id),
    })), rq.page),
    fills_recorded: fillsRecorded,
  };
}

export const RECORDS_FOR: Record<ModuleSlug, (ctx: Ctx, rq: RecordQuery) => Promise<Records>> = {
  'problem-discovery': problemRecords,
  'customer-research': researchRecords,
  'ideal-customer-profile': icpRecords,
  'market-intelligence': marketRecords,
  'demand-signals': demandRecords,
  experiments: experimentRecords,
};
