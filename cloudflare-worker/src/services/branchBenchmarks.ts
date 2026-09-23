/**
 * The anonymised platform median, computed at HQ and pushed to every branch
 * (S6 + S11, D148).
 *
 * WHAT #252 ACTUALLY SAID. `branch_benchmarks` has existed since migration 256
 * with **no writer and no reader**. This file is the writer's producer: the one
 * place that decides what a median is allowed to be computed from, and what HQ
 * must refuse to publish.
 *
 * IN `services/`, NOT `util/`. `util/README.md` draws the line at domain
 * knowledge — *"if a helper knows what a deal or a fund is, it belongs in
 * ../services/"* — and this knows what a branch, a seat and a backlog are.
 * `renewalSweep`, `complianceLadder` and `hqEscalationSla` are the precedents.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE THRESHOLD IS THREE, AND THE REASON IS ARITHMETIC RATHER THAN POLICY.
 * ────────────────────────────────────────────────────────────────────────────
 * Migration 256's own header says HQ *"withholds the row entirely below its own
 * k-threshold"* and does not say what k is. It has to be 3:
 *
 *   n = 1 — the median IS that branch's own figure, which is the "never another
 *           branch's figure" the same header forbids, published under a name
 *           that hides whose it is;
 *   n = 2 — the median is the mean of the two, so a branch that knows its own
 *           number subtracts itself and reads the other one EXACTLY;
 *   n = 3 — the smallest n at which no single branch is recoverable from the
 *           median plus its own value.
 *
 * So below three branches HQ publishes NOTHING, and the branch screen says so.
 * With zero branches provisioned that is what ships today — which is the honest
 * answer, not a gap: the alternative is a tick against a median of one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT CAN HONESTLY BE MEDIANED, MEASURED RATHER THAN CHOSEN FROM THE CANVAS.
 * ────────────────────────────────────────────────────────────────────────────
 * S6 draws four stats: Accounts, Activation, Programme throughput and Revenue
 * share. Read against `branchOverview()` — the only cross-branch call that
 * returns comparable per-branch numbers — exactly three fields are measurements
 * and one is not:
 *
 *   accounts.total   ✅ a count of active accounts
 *   seats_used       ✅ a count, with its own stated basis (D127)
 *   backlog.count    ✅ the four local queues, oldest-first (D130)
 *   revenue_mtd_cents ❌ `null` BY CONSTRUCTION, with its own reason — and
 *                       `branchRevenueSummary` agrees: every stream it returns
 *                       is `available: false`.
 *
 * Activation and programme throughput have no branch-side read at all. So three
 * of S6's four drawn stats cannot be benchmarked, and this file publishes the
 * three metrics that can be rather than inventing the rest. The page states the
 * difference; `METRICS` below is what the test reads, so adding a fourth metric
 * without a source fails rather than going quietly stale.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AN UNREADABLE BRANCH IS EXCLUDED FROM n, NEVER COUNTED AS A ZERO.
 * ────────────────────────────────────────────────────────────────────────────
 * `fanOut` returns three states and the middle one is the one that gets
 * forgotten: `unreadable` is not a claim that the branch is down. A branch that
 * did not answer contributes nothing — not a zero, which would drag every
 * median toward the floor and make the platform look worse the flakier its
 * network is. `n_branches` is therefore the count that ANSWERED, and it travels
 * with the median so the screen can say "of N".
 */
import type { Env } from '../types';
import { fanOut, type BranchResult } from './branches';
import { branchOf } from '../util/branch';
import type { BranchOverview } from '../rpc/branchOps';
import { weekAxis } from './activeAccounts';

/**
 * The smallest number of answering branches a median may be published over.
 *
 * Exported so the test reads it rather than restating it, and so the argument
 * above has exactly one place to live.
 */
export const MIN_BRANCHES = 3;

/**
 * D210 — THE OVERVIEW IS THE TYPE `branchOverview()` RETURNS, not a shape
 * written here from memory. The hand-written one said `backlog` was an array of
 * lanes; the producer returns `{ count, oldest_at } | null`. So the backlog
 * metric's reader tested `Array.isArray` on an object, returned `null` for
 * every branch, and `approvals_backlog` could never be published — while its
 * test passed, because the test's fixture was written to the same wrong shape.
 * `Partial` because an answer crosses a binding and is read defensively.
 */
type Overview = Partial<BranchOverview>;

export type BenchmarkRow = {
  metric_key: string;
  label: string;
  median_value: number;
  unit: string;
  n_branches: number;
  period: string;
};

/**
 * The metrics HQ is willing to publish, and how each is read off one branch's
 * overview.
 *
 * A metric belongs here only if `branchOverview()` returns a real number for
 * it. `revenue_mtd_cents` does not qualify — it is `null` by construction with
 * its own reason — and adding it would publish a median of nothing.
 */
export const METRICS: Array<{
  key: string; label: string; unit: string; of: (o: Overview) => number | null;
  /**
   * D210 — a metric measured over a WEEK names the Monday it measured. A median
   * is only taken over branches that report the same Monday, and the published
   * row's period is that Monday rather than the quarter: two branches' "last
   * week" differ for an hour a week around midnight UTC on Monday, and a median
   * across two different weeks is not a figure about either.
   */
  weekOf?: (o: Overview) => string | null;
}> = [
  {
    key: 'accounts_total',
    label: 'Active accounts',
    unit: 'count',
    of: (o) => num(o?.accounts?.total),
  },
  {
    key: 'seats_used',
    label: 'Seats used',
    unit: 'count',
    of: (o) => num(o?.seats_used),
  },
  {
    key: 'approvals_backlog',
    label: 'Items awaiting a decision',
    unit: 'count',
    // `backlog` is `{ count, oldest_at }` — the four local lanes summed by
    // `backlogOf` (D130) — or null when it could not be read. A branch whose
    // backlog is unreadable contributes nothing to THIS metric while still
    // counting toward the others, the same per-lane isolation `backlogOf`
    // applies one level down.
    of: (o) => {
      const b = o?.backlog;
      if (!b || typeof b !== 'object') return null;
      const n = num(b.count);
      return n === null ? null : Math.max(0, Math.trunc(n));
    },
  },
  {
    key: 'active_accounts_week',
    label: 'Active accounts · last week',
    unit: 'count',
    // D210 — the branch counts its own week from `activity_logs` under the
    // rule HQ's Analytics page reads Analytics Engine by, so the median and
    // HQ's lines describe the same requests. `null` when the branch's log
    // began inside the week: four days are not a week's figure.
    of: (o) => num(o?.active_accounts_week),
    weekOf: (o) => (typeof o?.active_accounts_week_of === 'string' ? o.active_accounts_week_of : null),
  },
];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The median of a list, the ordinary way: the middle value, or the mean of the
 * two middles on an even count.
 *
 * IT SORTS NUMERICALLY. `Array.prototype.sort` with no comparator sorts by
 * STRING, so `[9, 10, 11]` orders as `[10, 11, 9]` and the median comes back
 * 11 — a defect that only shows up once one branch crosses a digit boundary,
 * which is exactly the kind that survives a small fixture.
 */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type BenchmarkResult = {
  period: string;
  answered: number;
  total: number;
  published: number;
  rows: BenchmarkRow[];
  /** Why nothing was published, when nothing was. Never an empty success. */
  withheld_reason?: string;
  pushed: Array<{ code: string; status: string; reason?: string }>;
};

/**
 * Compute the medians and push them to every branch.
 *
 * REPORTED, NEVER THROWN — D111's rule, the shape every HQ→branch push in this
 * codebase already uses. A branch that could not be reached does not make the
 * computation wrong, and a throw here would take the cron block down for the
 * others.
 */
export async function publishBenchmarks(env: Env, period: string): Promise<BenchmarkResult> {
  if (branchOf(env)) throw new Error('publishBenchmarks is only live on HQ');

  const answers = await fanOut<Overview>(env, 'overview');
  const ok = answers.filter((a) => a.status === 'ok' && a.data);
  const base: BenchmarkResult = {
    period, answered: ok.length, total: answers.length, published: 0, rows: [], pushed: [],
  };

  if (ok.length < MIN_BRANCHES) {
    return {
      ...base,
      withheld_reason:
        `A median over ${ok.length} branch${ok.length === 1 ? '' : 'es'} is not anonymous: at one it `
        + 'IS that branch\'s figure, and at two a branch subtracts its own and reads the other\'s '
        + `exactly. HQ publishes nothing below ${MIN_BRANCHES} answering branches.`,
    };
  }

  // The week every weekly metric is taken over: the last complete one, by
  // HQ's clock. A branch reporting any other Monday is left out of that
  // metric's median rather than mixed into it.
  const week = weekAxis(new Date().toISOString(), 2).last_complete;
  const rows: BenchmarkRow[] = [];
  for (const m of METRICS) {
    const values: number[] = [];
    for (const a of ok) {
      const o = a.data as Overview;
      if (m.weekOf && m.weekOf(o) !== week) continue;
      const v = m.of(o);
      if (v !== null) values.push(v);
    }
    // THE THRESHOLD IS PER METRIC, not per fan-out. A branch can answer and
    // still have no readable backlog, and a median over two of three branches
    // is exactly as recoverable as a median over two of two.
    if (values.length < MIN_BRANCHES) continue;
    rows.push({
      metric_key: m.key,
      label: m.label,
      median_value: median(values),
      unit: m.unit,
      n_branches: values.length,
      period: m.weekOf ? week : period,
    });
  }

  if (!rows.length) {
    return {
      ...base,
      withheld_reason:
        `${ok.length} branches answered and no metric had ${MIN_BRANCHES} readable values between `
        + 'them, so every median would have named a branch.',
    };
  }

  const pushed_at = new Date().toISOString();
  const results = await fanOut<{ ok: true }>(env, 'applyBenchmarks', [{ rows, period, pushed_at }]);
  return {
    ...base,
    published: rows.length,
    rows,
    pushed: results.map((r: BranchResult<{ ok: true }>) => ({
      code: r.code,
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
    })),
  };
}

/**
 * The period a benchmark is stamped with: the current UTC quarter.
 *
 * SAME SHAPE `revenueSummary` PARSES (`YYYY-Qn`), so a branch reading its
 * benchmark and a statement covering the same window agree by construction
 * rather than by convention.
 */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}
