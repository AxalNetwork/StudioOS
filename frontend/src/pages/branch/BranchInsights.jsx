import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

/**
 * Branch · Insights — canvas S6, and the producer that unblocked it (D148).
 *
 * WHAT THE NOTICE THIS REPLACES PROMISED, AND HOW MUCH OF IT SURVIVED
 * MEASUREMENT. It said: *"Accounts, activation, programme throughput and
 * revenue share for the quarter, plus a benchmark shown as a single tick
 * against the anonymised platform median."* Of the four stats, **two** have a
 * branch-side source and two do not, and the fourth — revenue share — is the
 * interesting one: the RATE is on the licence HQ pushed and the AMOUNT is not
 * knowable here, which is why the HQ overview's own revenue figure is `null` by
 * construction. A rate times a number nobody has is not a figure. The page
 * draws the two it has and names the three it does not, each with the reason
 * the SERVER supplies.
 *
 * THE TICK IS AGAINST A MEDIAN, NEVER A RANK, and that is the canvas's own
 * rule: *"a tick, never a ranked list."* The bar below carries the median, this
 * branch's value and `n branches` — and the `n` is not decoration. Migration
 * 256 says HQ withholds a row entirely below its k-threshold, and D148 pins
 * that at three: at one branch the median IS that branch's figure, and at two a
 * branch subtracts its own and reads the other's exactly.
 *
 * SO WITH THIS PLATFORM'S SIZE THE BENCHMARK IS AN ABSENCE, AND THAT IS THE
 * DELIVERABLE. No branch is provisioned, so HQ computes nothing and pushes
 * nothing, and the page says why rather than drawing a tick against a median of
 * one. Three read states, not two — unreadable, published-nothing, published —
 * because an empty list standing in for all three is the defect D107 fixed on
 * the licence copy and D147 fixed on the template copy.
 */

/** Where this branch's own value sits between 0 and twice the median. */
function tickPercent(value, med) {
  if (!Number.isFinite(value) || !Number.isFinite(med) || med <= 0) return null;
  // THE SCALE IS TWO MEDIANS WIDE so the median itself sits at the centre and a
  // branch above it has somewhere to go. Clamped, because a branch at five
  // times the median must still render inside its own bar rather than escaping
  // it — the figure beside the bar is what carries the magnitude.
  return Math.max(0, Math.min(100, (value / (med * 2)) * 100));
}

/** The branch's own figure for a metric HQ published a median of. */
function ownValue(stats, key) {
  if (!stats) return null;
  if (key === 'accounts_total') return stats.accounts;
  if (key === 'seats_used') return stats.seats_used;
  // `approvals_backlog` is HQ's cross-branch metric and this page does not read
  // the branch's own board — /branch/approvals does, and a second count here
  // would be the tile-vs-table disagreement D128 ended. The median renders
  // without a tick.
  return null;
}

export default function BranchInsights() {
  const [data, setData] = useState(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await api.branchInsights());
    } catch (e) {
      setFailed(true);
      setData(null);
      reportError('BranchInsights:load', e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = data?.stats;
  const benchmarks = data?.benchmarks || [];

  return (
    <BranchZone workspace="Insights">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Insights</h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
          What this territory measures about itself, and where it sits against the anonymised
          platform median.
        </p>
      </header>

      <Card className="mb-4" data-testid="branch-insights-stats">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">This territory</h2>
        {data === undefined ? (
          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : failed ? (
          <div className="mt-2">
            <Unreadable
              what="this territory's figures"
              claim="This is not a claim that the territory holds nothing — the read itself did not complete."
              onRetry={load}
            />
          </div>
        ) : data?.stats_available === false ? (
          <div className="mt-2">
            <Unreadable what="this territory's figures" claim={data.stats_reason} onRetry={load} />
          </div>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] text-gray-500 dark:text-gray-400">Accounts</dt>
                <dd
                  className="text-2xl font-semibold text-gray-900 tabular-nums dark:text-gray-100"
                  data-testid="branch-stat-accounts">
                  {stats?.accounts}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500 dark:text-gray-400">Seats used</dt>
                <dd
                  className="text-2xl font-semibold text-gray-900 tabular-nums dark:text-gray-100"
                  data-testid="branch-stat-seats">
                  {stats?.seats_used}
                </dd>
              </div>
            </dl>
            {/* THE FIGURE CARRIES WHAT IT MEANS. Seats used counts roles, not a
                seat ledger, and the sentence is the SERVER's — the same one the
                HQ overview sends, so two surfaces cannot explain one number two
                ways. */}
            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">{stats?.seats_used_basis}</p>
          </>
        )}
      </Card>

      <Card className="mb-4" data-testid="branch-benchmarks">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Against the platform median</h2>
        <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">
          A tick against the median, never a ranked list — no other territory appears here.
        </p>
        <div className="mt-3">
          {data === undefined || failed ? null : data?.benchmarks_available === false ? (
            <Unreadable what="the benchmark copy" claim={data.benchmarks_reason} onRetry={load} />
          ) : !benchmarks.length ? (
            <Unrecorded reason={data?.benchmarks_empty_reason}>No benchmark published</Unrecorded>
          ) : (
            <ul className="space-y-4" data-testid="branch-benchmarks-list">
              {benchmarks.map((b) => {
                const mine = ownValue(stats, b.metric_key);
                const pct = tickPercent(mine, b.median_value);
                return (
                  <li key={b.metric_key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{b.label}</span>
                      <span className="text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
                        median {b.median_value} · {b.n_branches} branches · {b.period}
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
                      {/* The median is the centre of the scale, always drawn. */}
                      <div className="absolute inset-y-0 left-1/2 w-px bg-gray-400 dark:bg-gray-500" />
                      {pct !== null && (
                        <div
                          className="absolute inset-y-0 w-1 rounded-full bg-slate-700 dark:bg-slate-300"
                          style={{ left: `${pct}%` }}
                          data-testid={`branch-tick-${b.metric_key}`}
                        />
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
                      {pct === null
                        ? 'This territory’s own figure for this metric is not read on this page, so the median is shown without a tick.'
                        : `You: ${mine}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      {/* WHAT S6 DRAWS AND THIS CANNOT COMPUTE, read off the payload rather than
          typed here — so the day one of them gains a source, this list shrinks
          by itself instead of going stale. */}
      {!!(data?.unavailable || []).length && (
        <Card data-testid="branch-insights-unavailable">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Not measured here</h2>
          <ul className="mt-2 space-y-2">
            {(data.unavailable || []).map((u) => (
              <li key={u.stat}>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{u.stat}</div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{u.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </BranchZone>
  );
}
