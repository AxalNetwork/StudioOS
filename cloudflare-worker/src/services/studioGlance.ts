/**
 * Studio's one glance, for both tiers (D443, corrected by D447).
 *
 * THE PAGE USED TO ASK FOUR BRANCH ROUTES. Each refuses on HQ (`Branch only`),
 * so an admin who is not on a branch was told the figures were not recorded
 * because of the deployment, before any database had been asked. This asks
 * the database this Worker is attached to, and names the figures it will not
 * invent.
 *
 * A PER-SUBSIDIARY FIGURE IS NOT READ ON HQ. Seat use, the eleven approval
 * lanes, and the share rate are facts about one licence. No row on HQ names
 * the licence it belongs to (U1), so counting HQ's own user table or summing
 * its approval rows would be a different measurement wearing that name. Those
 * come back `recorded: false` with the reason, never as zero.
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

export const HQ_SEATS_REASON =
  'Seat use is a subsidiary figure. No account on HQ names the licence it sits under (U1), '
  + 'so the user table on this database is not that count and is not shown as zero.';

export const HQ_QUEUES_REASON =
  'The approval queues this card draws are a subsidiary\'s lanes. HQ-held queues are decided '
  + 'in their own consoles, and summing the rows in HQ\'s tables would be a different board. '
  + 'No row names a licence (U1), so no per-subsidiary pressure is read here.';

export const HQ_SHARE_REASON =
  'The share rate is a term on a subsidiary\'s licence. This studio is HQ, and no row names '
  + 'which licence it would be (U1), so no rate is read from the ledger and none is shown as zero.';

export const HQ_LICENCE_REASON =
  'This studio is HQ. No row here names the licence whose host and brand kit would be shown (U1), '
  + 'so neither is read from the ledger and neither is shown as absent.';

export const HQ_INSIGHTS_REASON =
  'HQ pushes the median and keeps no copy.';

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
  approvals: RecordedFalse;
  revenue: RecordedFalse;
  licence: RecordedFalse;
} {
  return {
    seats: { recorded: false, reason: HQ_SEATS_REASON },
    approvals: { recorded: false, reason: HQ_QUEUES_REASON },
    revenue: { recorded: false, reason: HQ_SHARE_REASON },
    licence: { recorded: false, reason: HQ_LICENCE_REASON },
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
 * HQ. The clock, the pending-account count, the dated agreements and the
 * master library are read. Seats, the lanes, the share rate and the licence
 * summary are not. The benchmark copy is not: HQ pushes it and keeps none.
 */
async function hqGlance(env: Env, now: number) {
  const [programme, agreements, templates] = await Promise.all([
    programmeClock(env, now),
    agreementsExpiring(env, now),
    hqLibrary(env),
  ]);
  return {
    tier: 'hq' as const,
    branch: null,
    ...hqPerSubsidiary(),
    programme: { recorded: true as const, ...programme },
    agreements: { recorded: true as const, ...agreements },
    templates,
    insights: { recorded: false as const, reason: HQ_INSIGHTS_REASON },
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
