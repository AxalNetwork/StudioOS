/**
 * Studio's one glance, for both tiers (D443).
 *
 * THE PAGE USED TO ASK FOUR BRANCH ROUTES. Each refuses on HQ (`Branch only`),
 * so an admin who is not on a branch was told the figures were not recorded
 * because of the deployment, before any database had been asked. This asks
 * the database this Worker is attached to, and names the figures it will not
 * invent.
 *
 * A PER-SUBSIDIARY FIGURE IS NOT READ ON HQ. Seat use, the eleven approval
 * lanes, the agreements that end inside the window, and the share rate are
 * facts about one licence. No row on HQ names the licence it belongs to (U1),
 * so counting HQ's own tables would be a different measurement wearing that
 * name. Those four come back `recorded: false` with the reason, never as zero.
 *
 * WHAT HQ'S OWN DATABASE DOES ANSWER. The programme clock is the platform's,
 * not a subsidiary's, and the pending-account count is the part that is not,
 * so the clock is returned and the count is left null. The master template
 * library and the published benchmark copy are HQ's stores; a branch reads
 * the copies HQ pushed, which live in its own database.
 *
 * No live branch exercised this. The reads run on whichever D1 this Worker
 * has, and the tests run them on node:sqlite.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { branchHome, programmeBounds } from './branchHome';
import { branchLicencePayload } from '../routes/licence';

export const HQ_SEATS_REASON =
  'Seat use is a subsidiary figure. No account on HQ names the licence it sits under (U1), '
  + 'so the user table on this database is not that count and is not shown as zero.';

export const HQ_QUEUES_REASON =
  'The approval queues this card draws are a subsidiary\'s lanes. HQ-held queues are decided '
  + 'in their own consoles, and summing the rows in HQ\'s tables would be a different board. '
  + 'No row names a licence (U1), so no per-subsidiary pressure is read here.';

export const HQ_AGREEMENTS_REASON =
  'Agreements that end inside the window are the subsidiary\'s own stores. HQ\'s database is '
  + 'not that territory\'s ledger, and no agreement row names a licence (U1), so none are '
  + 'counted here and none are shown as zero.';

export const HQ_SHARE_REASON =
  'The share rate is a term on a subsidiary\'s licence. This studio is HQ, and no row names '
  + 'which licence it would be (U1), so no rate is read from the ledger and none is shown as zero.';

export const HQ_PENDING_REASON =
  'Accounts still pending this week are a subsidiary\'s. No cohort row on HQ names the licence '
  + 'it belongs to (U1), so that count is not taken from this database and is not shown as zero.';

export const HQ_LICENCE_REASON =
  'This studio is HQ. No row here names the licence whose host and brand kit would be shown (U1), '
  + 'so neither is read from the ledger and neither is shown as absent.';

const TEMPLATES_UNREADABLE =
  'The template library could not be read on this database. That is not the same as it being empty.';

const BENCHMARKS_UNREADABLE =
  'The benchmark copy could not be read on this database. That is not the same as HQ having published nothing.';

const NEVER_PUSHED =
  'HQ has not pushed its master library to this branch yet. The library lives at HQ and '
  + 'travels on a push, so until then this branch has nothing to instantiate — which is a '
  + 'different thing from HQ having no templates.';

type RecordedFalse = { recorded: false; reason: string };

async function templateCopy(env: Env): Promise<
  | { recorded: true; available: true; items: { slug: string }[]; pushed_at: string | null; never_pushed_reason?: string }
  | { recorded: true; available: false; reason: string }
> {
  try {
    const q = await env.DB.prepare(
      `SELECT slug FROM branch_templates ORDER BY category, title`,
    ).all<{ slug: string }>();
    const sync = await env.DB.prepare(
      'SELECT pushed_at FROM branch_templates_sync WHERE id = 1',
    ).first<{ pushed_at: string }>();
    const items = q.results || [];
    return {
      recorded: true,
      available: true,
      items,
      pushed_at: sync?.pushed_at ?? null,
      ...(sync ? {} : { never_pushed_reason: NEVER_PUSHED }),
    };
  } catch (e) {
    console.error('[studio-glance] templates', (e as Error).message);
    return { recorded: true, available: false, reason: TEMPLATES_UNREADABLE };
  }
}

async function hqLibrary(env: Env): Promise<
  | { recorded: true; available: true; items: { slug: string }[]; pushed_at: null; empty_reason?: string }
  | { recorded: true; available: false; reason: string }
> {
  try {
    const q = await env.DB.prepare(
      `SELECT slug FROM legal_templates WHERE is_active = 1 ORDER BY category, title`,
    ).all<{ slug: string }>();
    const items = q.results || [];
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

async function benchmarksOf(env: Env): Promise<
  | { recorded: true; benchmarks_available: true; benchmarks: unknown[] }
  | { recorded: true; benchmarks_available: false; benchmarks_reason: string }
> {
  try {
    const q = await env.DB.prepare(
      `SELECT metric_key, label, median_value, unit, n_branches, period, pushed_at
         FROM branch_benchmarks ORDER BY metric_key`,
    ).all();
    return { recorded: true, benchmarks_available: true, benchmarks: q.results || [] };
  } catch (e) {
    console.error('[studio-glance] benchmarks', (e as Error).message);
    return { recorded: true, benchmarks_available: false, benchmarks_reason: BENCHMARKS_UNREADABLE };
  }
}

function hqPerSubsidiary(): {
  seats: RecordedFalse;
  approvals: RecordedFalse;
  agreements: RecordedFalse;
  revenue: RecordedFalse;
  licence: RecordedFalse;
} {
  return {
    seats: { recorded: false, reason: HQ_SEATS_REASON },
    approvals: { recorded: false, reason: HQ_QUEUES_REASON },
    agreements: { recorded: false, reason: HQ_AGREEMENTS_REASON },
    revenue: { recorded: false, reason: HQ_SHARE_REASON },
    licence: { recorded: false, reason: HQ_LICENCE_REASON },
  };
}

/**
 * HQ. The clock and the two HQ stores are read. The four per-subsidiary
 * figures are not, and `hqPerSubsidiary` is the whole of that refusal — a
 * query added beside it would be counting a table this tier must not treat
 * as a subsidiary's.
 */
async function hqGlance(env: Env, now: number) {
  const clock = programmeBounds(now);
  const programme = clock.open_week === null
    ? { recorded: true as const, ...clock }
    : { recorded: true as const, ...clock, pending_accounts: null, reason: HQ_PENDING_REASON };
  const [templates, insights] = await Promise.all([hqLibrary(env), benchmarksOf(env)]);
  return {
    tier: 'hq' as const,
    branch: null,
    ...hqPerSubsidiary(),
    programme,
    templates,
    insights,
  };
}

async function branchGlance(env: Env, code: string, now: number) {
  const [home, lic, templates, insights] = await Promise.all([
    branchHome(env, now),
    branchLicencePayload(env, code),
    templateCopy(env),
    benchmarksOf(env),
  ]);
  const pushed = 'licence' in lic;
  const seats = pushed
    ? {
      recorded: true as const,
      seats: lic.licence.seats,
      seats_used_by_type: lic.licence.seats_used_by_type,
      seats_used_basis: lic.licence.seats_used_basis,
    }
    : { recorded: false as const, reason: lic.message };
  const licence = pushed
    ? {
      recorded: true as const,
      revenue_share_bps: lic.licence.revenue_share_bps,
      suspended_at: lic.licence.suspended_at,
      status: lic.licence.status,
      kind: lic.licence.kind,
      domain: lic.licence.domain,
      domain_available: lic.licence.domain_available,
      domain_reason: lic.licence.domain_reason,
      brand_kit: null,
      brand_kit_available: false as const,
      brand_kit_reason:
        'The brand kit is held on the licence ledger at HQ and is not copied onto this branch.',
    }
    : { recorded: false as const, reason: lic.message };
  return {
    tier: 'branch' as const,
    branch: code,
    seats,
    approvals: { recorded: true as const, lanes: home.queue_pressure },
    programme: { recorded: true as const, ...home.programme },
    agreements: { recorded: true as const, ...home.agreements },
    revenue: { recorded: true as const, ...home.revenue },
    licence,
    templates,
    insights,
  };
}

export async function studioGlance(env: Env, now = Date.now()) {
  const code = branchOf(env);
  if (!code) return hqGlance(env, now);
  return branchGlance(env, code, now);
}
