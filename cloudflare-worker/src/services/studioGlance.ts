/**
 * Studio's one glance, for both tiers (D443, corrected by D447).
 *
 * THE PAGE USED TO ASK FOUR BRANCH ROUTES. Each refuses on HQ (`Branch only`),
 * so an admin who is not on a branch was told the figures were not recorded
 * because of the deployment, before any database had been asked. This asks
 * the database this Worker is attached to, and names the figures it will not
 * invent.
 *
 * HQ'S OWN FIGURES ARE SHOWN, LABELLED AS HQ'S (D555, reversing that part of
 * D443/D447). The owner: "What is the point of having an overview if users
 * need to click every time on a page to have the information". So HQ reads its
 * own database and says whose figures they are ("HQ-held accounts · axal.vc"):
 *   · `accounts` — this database's accounts by role, new in 7 and 30 days,
 *     people still exploring (the Exploring lane's own count) and projects in
 *     Trash. Aggregates only: no name, email or id reaches the payload.
 *   · `approvals` — the lanes on `HeldApprovals.jsx`, each counted with its
 *     console's own pending predicate (`laneCounts`, D130), worst first. A lane
 *     with no pending notion (`NOT_LANED`) says so; Content to HQ is not
 *     applicable; a lane whose read fails is unreadable and the rest answer.
 *   · `insights` — sign-ups per week, AI spend this month, open tickets
 *     (`ticketBacklog`, HQ Support's read), and the accounts active last week
 *     on `ACTIVE_ACCOUNT_BASIS` (D893: `activity_logs` records every signed-in
 *     request, so the old "not recorded" sentence was no longer true).
 *
 * WHAT STAYS UNREAD ON HQ. Seat use and the share rate are terms of one
 * subsidiary's licence, and no row on HQ names a licence (U1). They stay
 * `recorded: false` with the reason, never zero. So does the territory
 * benchmark (D148): HQ pushes the median and keeps no copy.
 *
 * AGREEMENTS AND THE PENDING-ACCOUNT COUNT ARE THIS DATABASE'S (D447). They
 * are not a subsidiary figure. `programmeClock` and `agreementsExpiring` are
 * the same reads `branchHome` makes. Striking either read would put the
 * refusal back, and that refusal would cite S22, not U1.
 *
 * HQ DOES NOT READ `branch_benchmarks`. That table is the copy a branch keeps
 * after HQ pushes a median. Nothing on HQ writes it. The glance says so:
 * `insights.recorded` is false, and the reason is that HQ pushes the median
 * and keeps no copy.
 *
 * WHAT HQ'S OWN DATABASE DOES ANSWER. The programme clock is the platform's.
 * The master template library is HQ's store, read through `listTemplates`.
 * A branch reads the copies HQ pushed, through the same readers the branch
 * routes use.
 *
 * A READ OF THE BRANCH LICENCE CAN WRITE. The first read of a missing copy
 * asks HQ and stores the answer (`applyLicenceCopy`). This is not a pure read
 * on that path. Suspension still does not gate the route: a frozen branch
 * can see the copy.
 *
 * No live branch exercised this. The reads run on whichever D1 this Worker
 * has, and the tests run them on node:sqlite.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import {
  agreementsExpiring,
  branchHome,
  programmeClock,
  SHARE_AMOUNT_REASON,
} from './branchHome';
import { branchLicencePayload } from '../routes/licence';
import { readBranchTemplateCopy } from '../routes/branch_templates';
import { readBranchBenchmarks } from '../routes/branch_insights';
import { listTemplates } from './legalTemplateStore';
import { queuePressure } from './branchHome';
import { NOT_LANED } from './approvalSources';
import { ticketBacklog } from './supportQueues';
import { ACTIVE_ACCOUNT_BASIS, loadBranchWeeklyActives, weekAxis } from './activeAccounts';

export const HQ_SEATS_REASON =
  'Seat use is a subsidiary figure. No account on HQ names the licence it sits under (U1), '
  + 'so the user table on this database is not that count and is not shown as zero.';

/** Whose figures the HQ glance shows (D555). */
export const HQ_SCOPE_LABEL = 'HQ-held accounts · axal.vc';

export const HQ_SHARE_REASON =
  'The share rate is a term on a subsidiary\'s licence. This studio is HQ, and no row names '
  + 'which licence it would be (U1), so no rate is read from the ledger and none is shown as zero.';

export const HQ_LICENCE_REASON =
  'This studio is HQ. No row here names the licence whose host and brand kit would be shown (U1), '
  + 'so neither is read from the ledger and neither is shown as absent.';

export const HQ_BENCHMARK_REASON =
  'HQ pushes the territory median and keeps no copy (D148).';

export const CONTENT_TO_HQ_REASON =
  'Not applicable to HQ-held accounts: there is no branch to raise content from.';

const LANE_UNREADABLE = 'This lane\'s store could not be read on this database. That is not the same as nothing pending.';
const ACCOUNTS_UNREADABLE = 'The account table could not be read on this database. That is not the same as no accounts.';

const TEMPLATES_UNREADABLE =
  'The template library could not be read on this database. That is not the same as it being empty.';

const LICENCE_UNREADABLE =
  'The table this branch keeps its licence copy in could not be read, so this is not a claim that HQ has not pushed a licence.';

type RecordedFalse = { recorded: false; reason: string };

async function templateCopy(env: Env) {
  const copy = await readBranchTemplateCopy(env);
  if (!copy.available) {
    return { recorded: true as const, available: false as const, reason: copy.reason || TEMPLATES_UNREADABLE };
  }
  return {
    recorded: true as const,
    available: true as const,
    items: copy.items.map((row) => ({ slug: row.slug })),
    pushed_at: copy.pushed_at,
    ...(copy.never_pushed_reason ? { never_pushed_reason: copy.never_pushed_reason } : {}),
  };
}

async function hqLibrary(env: Env): Promise<
  | { recorded: true; available: true; items: { slug: string }[]; pushed_at: null; empty_reason?: string }
  | { recorded: true; available: false; reason: string }
> {
  try {
    const rows = await listTemplates(env);
    const items = rows.map((row) => ({ slug: row.slug }));
    return {
      recorded: true,
      available: true,
      items,
      pushed_at: null,
      ...(items.length === 0
        ? { empty_reason: 'The master library was read and it holds no active template.' }
        : {}),
    };
  } catch (e) {
    console.error('[studio-glance] hq library', (e as Error).message);
    return { recorded: true, available: false, reason: TEMPLATES_UNREADABLE };
  }
}

function hqPerSubsidiary(): {
  seats: RecordedFalse;
  revenue: RecordedFalse;
  licence: RecordedFalse;
} {
  return {
    seats: { recorded: false, reason: HQ_SEATS_REASON },
    revenue: { recorded: false, reason: HQ_SHARE_REASON },
    licence: { recorded: false, reason: HQ_LICENCE_REASON },
  };
}

/**
 * HQ's accounts, as counts. `exploring` is the Exploring lane's own count
 * (passed in from `queuePressure`), so the card and the lane cannot disagree.
 */
export async function hqAccounts(env: Env, exploring: number | null, now = Date.now()) {
  const at = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  try {
    const [roles, fresh, inactive, trash] = await Promise.all([
      env.DB.prepare(
        `SELECT COALESCE(NULLIF(role, ''), 'no role') AS role, COUNT(*) AS n
           FROM users WHERE is_active = 1 GROUP BY 1 ORDER BY n DESC, role`,
      ).all<{ role: string; n: number }>(),
      env.DB.prepare(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime(?, '-7 days') THEN 1 ELSE 0 END) AS d7,
           SUM(CASE WHEN datetime(created_at) >= datetime(?, '-30 days') THEN 1 ELSE 0 END) AS d30
           FROM users WHERE is_active = 1`,
      ).bind(at, at).first<{ d7: number | null; d30: number | null }>(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 0`).first<{ n: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NOT NULL`).first<{ n: number }>()
        .then((r) => Number(r?.n) || 0).catch(() => null),
    ]);
    const by_role = (roles.results || []).map((r) => ({ role: String(r.role), count: Number(r.n) || 0 }));
    return {
      recorded: true as const,
      label: HQ_SCOPE_LABEL,
      total: by_role.reduce((t, r) => t + r.count, 0),
      by_role,
      new_7d: Number(fresh?.d7) || 0,
      new_30d: Number(fresh?.d30) || 0,
      deactivated: Number(inactive?.n) || 0,
      exploring,
      trash_projects: trash,
    };
  } catch (e) {
    console.error('[studio-glance] hq accounts', (e as Error).message);
    return { recorded: true as const, available: false as const, label: HQ_SCOPE_LABEL, reason: ACCOUNTS_UNREADABLE };
  }
}

/**
 * HQ's approval lanes. Every lane `HeldApprovals.jsx` draws is here: the ones
 * with a pending queue (counted by `laneCounts`, the consoles' predicates),
 * the ones with no pending notion (`NOT_LANED`, each with its reason) and
 * Content to HQ, which does not apply. `pending_total` is null when any lane
 * could not be read: a total over the lanes that answered would be smaller
 * than the truth.
 */
export function hqApprovals(pressure: Awaited<ReturnType<typeof queuePressure>>['queue_pressure']) {
  const lanes = pressure.map((l) => (l.count === null ? { ...l, reason: LANE_UNREADABLE } : l));
  const unreadable = lanes.filter((l) => l.count === null).map((l) => l.label);
  return {
    recorded: true as const,
    label: HQ_SCOPE_LABEL,
    lanes,
    pending_total: unreadable.length ? null : lanes.reduce((t, l) => t + (l.count ?? 0), 0),
    unreadable,
    no_queue: NOT_LANED.map((n) => ({ label: n.label, reason: n.reason })),
    not_applicable: [{ label: 'Content to HQ', reason: CONTENT_TO_HQ_REASON }],
  };
}

export const SIGNUP_WEEKS = 8;

/** Monday 00:00 UTC of the week holding `ms`, as 'YYYY-MM-DD'. */
function weekStart(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** HQ's headline figures. Each one answers alone: a failed read is that figure's own `available: false`. */
export async function hqInsights(env: Env, now: number) {
  const thisWeek = weekStart(now);
  const weeks: string[] = [];
  for (let i = SIGNUP_WEEKS - 1; i >= 0; i -= 1) weeks.push(weekStart(Date.parse(`${thisWeek}T00:00:00Z`) - i * 7 * 86_400_000));
  const monthKey = new Date(now).toISOString().slice(0, 7);

  const activeAxis = weekAxis(new Date(now).toISOString(), 2);
  const [signups, spend, tickets, active] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at, '-6 days', 'weekday 1') AS wk, COUNT(*) AS n
         FROM users WHERE datetime(created_at) >= datetime(?) GROUP BY wk`,
    ).bind(`${weeks[0]} 00:00:00`).all<{ wk: string; n: number }>()
      .then((r) => {
        const by = new Map((r.results || []).map((x) => [String(x.wk), Number(x.n) || 0]));
        return {
          available: true as const,
          weeks: weeks.map((w) => ({ week_start: w, count: by.get(w) ?? 0, to_date: w === thisWeek })),
        };
      })
      .catch((e) => {
        console.error('[studio-glance] signups', (e as Error).message);
        return { available: false as const, reason: ACCOUNTS_UNREADABLE };
      }),
    // The month predicate `aiSpend.ts` uses for the caller's own meter, org-wide.
    env.DB.prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(est_cost_usd), 0) AS usd
         FROM ai_usage_logs WHERE substr(created_at, 1, 7) = ?`,
    ).bind(monthKey).first<{ calls: number; usd: number }>()
      .then((r) => ({ available: true as const, month: monthKey, usd: Number(r?.usd) || 0, calls: Number(r?.calls) || 0 }))
      .catch(() => ({ available: false as const, month: monthKey, reason: 'The AI usage log could not be read on this database. That is not the same as no spend.' })),
    ticketBacklog(env)
      .then((b) => ({ available: true as const, open: b.open, by_status: b.by_status }))
      .catch(() => ({ available: false as const, reason: 'The support ticket table could not be read on this database. That is not the same as no open tickets.' })),
    // The last complete week, on the branch line's own rule (D210), which runs on any D1.
    loadBranchWeeklyActives(env, activeAxis).then((r) => (r.available
      ? { available: true as const, week: activeAxis.last_complete, value: r.values[0], basis: ACTIVE_ACCOUNT_BASIS }
      : { available: false as const, reason: 'The request log could not be read on this database. That is not the same as nobody active.' })),
  ]);
  return {
    recorded: true as const,
    label: HQ_SCOPE_LABEL,
    signups_by_week: signups,
    active_accounts: active,
    ai_spend_month: spend,
    open_tickets: tickets,
    benchmark: { recorded: false as const, reason: HQ_BENCHMARK_REASON },
  };
}

/**
 * Whether `branch_licence` can be read at all. A missing row and a missing
 * table are different claims, and the licence payload words both as
 * "not pushed" unless this probe separates them.
 */
async function branchLicenceTableReadable(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare('SELECT id FROM branch_licence WHERE id = 1').first();
    return true;
  } catch (e) {
    console.error('[studio-glance] branch_licence probe', (e as Error).message);
    return false;
  }
}

/**
 * HQ. The clock, the pending-account count, the dated agreements, the master
 * library, and HQ's own accounts, lanes and headline figures (D555) are read.
 * Seats, the share rate and the licence summary are not (U1), and neither is
 * the benchmark copy: HQ pushes it and keeps none.
 */
async function hqGlance(env: Env, now: number) {
  const [programme, agreements, templates, pressure, insights] = await Promise.all([
    programmeClock(env, now),
    agreementsExpiring(env, now),
    hqLibrary(env),
    queuePressure(env, now),
    hqInsights(env, now),
  ]);
  const exploringLane = pressure.lanes.find((l) => l.key === 'exploring');
  // D1039: the lane counts signed Explorers only; the Accounts tile still
  // counts every account in the holding role, from the lane's `holding` figure.
  const holding = exploringLane?.count == null ? null : exploringLane.sub?.holding ?? null;
  const accounts = await hqAccounts(env, holding, now);
  return {
    tier: 'hq' as const,
    branch: null,
    ...hqPerSubsidiary(),
    accounts,
    approvals: hqApprovals(pressure.queue_pressure),
    programme: { recorded: true as const, ...programme },
    agreements: { recorded: true as const, ...agreements },
    templates,
    insights,
  };
}

async function branchGlance(env: Env, code: string, now: number) {
  const [home, lic, templates, insights] = await Promise.all([
    branchHome(env, now, { includeRevenue: false }),
    branchLicencePayload(env, code),
    templateCopy(env),
    readBranchBenchmarks(env),
  ]);
  const pushed = 'licence' in lic;
  let seats: Record<string, unknown>;
  let licence: Record<string, unknown>;
  let revenue: Record<string, unknown>;
  if (pushed) {
    seats = {
      recorded: true,
      seats: lic.licence.seats,
      seats_used_by_type: lic.licence.seats_used_by_type,
      seats_used_basis: lic.licence.seats_used_basis,
    };
    licence = {
      recorded: true,
      revenue_share_bps: lic.licence.revenue_share_bps,
      suspended_at: lic.licence.suspended_at,
      status: lic.licence.status,
      kind: lic.licence.kind,
      domain: lic.licence.domain,
      domain_available: lic.licence.domain_available,
      domain_reason: lic.licence.domain_reason,
      brand_kit: null,
      brand_kit_available: false,
      brand_kit_reason:
        'The brand kit is held on the licence ledger at HQ and is not copied onto this branch.',
    };
    const bps = lic.licence.revenue_share_bps;
    revenue = {
      recorded: true,
      share_bps: bps === null || bps === undefined ? null : Number(bps),
      as_of: lic.as_of ?? null,
      amount_cents: null,
      reason: SHARE_AMOUNT_REASON,
    };
  } else {
    const tableReadable = await branchLicenceTableReadable(env);
    const pullReason = lic.pull?.reason;
    if (!tableReadable) {
      const reason = pullReason || LICENCE_UNREADABLE;
      seats = { available: false, reason };
      licence = { available: false, reason };
      revenue = { available: false, reason };
    } else {
      seats = { recorded: false, reason: lic.message };
      licence = { recorded: false, reason: lic.message, ...(pullReason ? { pull_reason: pullReason } : {}) };
      revenue = { recorded: false, reason: lic.message };
    }
  }
  return {
    tier: 'branch' as const,
    branch: code,
    seats,
    approvals: { recorded: true as const, lanes: home.queue_pressure },
    programme: { recorded: true as const, ...home.programme },
    agreements: { recorded: true as const, ...home.agreements },
    revenue,
    licence,
    templates,
    insights: { recorded: true as const, ...insights },
  };
}

export async function studioGlance(env: Env, now = Date.now()) {
  const code = branchOf(env);
  if (!code) return hqGlance(env, now);
  return branchGlance(env, code, now);
}
