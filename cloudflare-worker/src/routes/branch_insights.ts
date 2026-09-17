/**
 * What this territory measures about itself, and the one tick against the
 * platform median (S6, D148).
 *
 *   GET /api/branch/insights
 *
 * TWO KINDS OF NUMBER ON ONE PAYLOAD, AND THEY ARE NOT INTERCHANGEABLE. The
 * stats are read from this branch's own database and are facts about it. The
 * benchmark is a COPY HQ pushed, computed across branches, and carries HQ's
 * `pushed_at` and its own `n_branches` — because a median with no denominator
 * implies a population the screen does not know.
 *
 * S6 DRAWS FOUR STATS AND THIS SHIPS TWO, which is the measurement rather than
 * a choice. Accounts and seats used are counted here the way `branchOverview`
 * counts them (D127's definition, stated with the figure). Activation and
 * programme throughput have no branch-side read anywhere in the worker, so they
 * arrive as `unavailable` with their reasons instead of a derived-looking zero —
 * the shape `branch_home.ts` already uses for S1's three sourceless blocks.
 *
 * REVENUE SHARE IS THE FOURTH AND IT IS THE INTERESTING ABSENCE.
 * `branchOverview` returns `revenue_mtd_cents: null` BY CONSTRUCTION and
 * `branchRevenueSummary` returns every stream `available: false`: a branch's
 * subscription charges live in the Stripe API and its licence fee flows to HQ.
 * So the rate is knowable — it is on the pushed licence — and the amount is
 * not, and the payload says exactly that rather than multiplying a rate by a
 * number nobody has.
 *
 * SUSPENSION DOES NOT GATE IT, for D130's and D131's reason: the freeze guards
 * approval WRITES, and a frozen branch still needs to read where it stands.
 *
 * AN UNREADABLE TABLE IS NOT AN ABSENT BENCHMARK. A database missing
 * `branch_benchmarks` answers `benchmarks_available: false` with its reason
 * rather than the same empty list a branch HQ has never pushed to would get —
 * the #204 rule, and the distinction D147 drew one table over.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { SEAT_ROLES } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

type BenchmarkRow = {
  metric_key: string; label: string; median_value: number;
  unit: string; n_branches: number; period: string; pushed_at: string;
};

// GET /api/branch/insights
r.get('/insights', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);

    // The branch's own figures. Same query and same definition `branchOverview`
    // uses, so the number HQ reads over RPC and the number this screen prints
    // cannot disagree.
    let accounts = 0;
    let seatsUsed = 0;
    let statsAvailable = true;
    let statsReason: string | null = null;
    try {
      const q = await c.env.DB.prepare(
        'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
      ).all<{ role: string; n: number }>();
      for (const row of q.results || []) {
        const n = Number(row.n) || 0;
        accounts += n;
        if ((SEAT_ROLES as readonly string[]).includes(String(row.role))) seatsUsed += n;
      }
    } catch (e) {
      statsAvailable = false;
      statsReason = `The account table could not be read on this branch: ${(e as Error)?.message || 'unknown'}.`;
    }

    let benchmarks: BenchmarkRow[] = [];
    let benchmarksAvailable = true;
    let benchmarksReason: string | null = null;
    try {
      const q = await c.env.DB.prepare(
        `SELECT metric_key, label, median_value, unit, n_branches, period, pushed_at
           FROM branch_benchmarks ORDER BY metric_key`,
      ).all<BenchmarkRow>();
      benchmarks = q.results || [];
    } catch (e) {
      benchmarksAvailable = false;
      benchmarksReason =
        'The benchmark copy could not be read on this database (migration 256). That is not the '
        + `same as HQ having published nothing: ${(e as Error)?.message || 'the table is missing'}.`;
    }

    return c.json({
      branch,
      stats: {
        accounts: statsAvailable ? accounts : null,
        seats_used: statsAvailable ? seatsUsed : null,
        // THE FIGURE CARRIES WHAT IT MEANS, or it reads as a seat ledger. Same
        // sentence `branchOverview` sends over RPC (D127), because two
        // different explanations of one number is how two surfaces come to
        // disagree about what it counts.
        seats_used_basis:
          'Seats used is the count of active accounts whose role is one a licence sells a seat for '
          + `(${SEAT_ROLES.join(', ')}). Role is not the same thing as a licensed seat: there is no `
          + 'seat ledger, so no seat has an id and a vacant seat cannot be shown.',
      },
      stats_available: statsAvailable,
      ...(statsReason ? { stats_reason: statsReason } : {}),
      benchmarks,
      benchmarks_available: benchmarksAvailable,
      ...(benchmarksReason ? { benchmarks_reason: benchmarksReason } : {}),
      ...(benchmarksAvailable && !benchmarks.length ? {
        benchmarks_empty_reason:
          'HQ has published no benchmark yet. A median is only anonymous once enough branches '
          + 'answer — at one branch it IS that branch\'s figure, and at two a branch subtracts its '
          + 'own and reads the other\'s exactly — so HQ withholds the row rather than naming a '
          + 'territory. With the platform this size there is nothing to compare against yet.',
      } : {}),
      // THE TWO STATS S6 DRAWS AND THIS CANNOT COMPUTE, named on the payload
      // rather than written into the page: a page holding its own copy of a
      // reason is a second place to update, and the one that is not updated is
      // the one that lies (D131's rule, D140's and D147's too).
      unavailable: [
        {
          stat: 'Activation',
          reason:
            'Activation would be the share of accounts that reached a first meaningful action, and '
            + 'no branch-side read defines or counts one. Deriving it here would be inventing the '
            + 'definition on the screen.',
        },
        {
          stat: 'Programme throughput',
          reason:
            'Throughput needs assessment runs and cohort outcomes over a window, and the worker has '
            + 'no GET /sessions and no GET /results for a branch to read — the same gap D140 named '
            + 'on Programs.',
        },
        {
          stat: 'Revenue share for the quarter',
          reason:
            'The RATE is on the licence HQ pushed and the AMOUNT is not knowable here: subscription '
            + 'charges live in the Stripe API and a subsidiary charges no onward licence fee, which '
            + 'is why the revenue figure on the HQ overview is null by construction. A rate times a '
            + 'number nobody has is not a figure.',
        },
      ],
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
