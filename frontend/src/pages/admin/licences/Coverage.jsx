/**
 * #4707 — the HQ licence page's coverage and renewals. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useMemo, useState } from 'react';
import { coverageCells, renewalPipeline, sortCells } from '../../../lib/licenceCoverage';

/* ------------------------------------------------------------------ */

/**
 * H2 — EU coverage as 27 cells, and the renewal pipeline beside it.
 *
 * THE THREE CELL STATES ARE NOT THREE SHADES OF ONE IDEA. Held-active and
 * held-suspended are both TAKEN — a suspended licence keeps its territory, and
 * a grid that freed those cells would invite the double-issue the ledger's
 * UNIQUE index exists to prevent. Free is the third, and it is the reason the
 * grid is 27 cells rather than a list of holders.
 */
/**
 * SORT MODES, and why `state` is the one that ships selected (D146). The canvas
 * draws the control with the first segment styled as chosen, and that is the
 * segment labelled "By state" — so this changes the order the grid opens in,
 * which is a visible change and is meant to be. Grouping is what makes the
 * white space countable at a glance; A–Z is one click away and is the order
 * `coverageCells()` already emits.
 */
export const COVERAGE_SORTS = [
  { key: 'state', label: 'By state' },
  { key: 'az', label: 'A–Z' },
];

/**
 * #4700 — `items` is the summary's coverage (every licence that holds a
 * country) and `renewals` its soonest renewals with their total, both over the
 * whole ledger rather than the page on screen.
 */
export function Coverage({ items, renewals, onOpen }) {
  const { cells, held_active: active, held_suspended: suspended, free, outside_eu: outside } =
    useMemo(() => coverageCells(items), [items]);
  const [sort, setSort] = useState('state');
  const ordered = useMemo(() => sortCells(cells, sort), [cells, sort]);
  const pipeline = useMemo(() => renewalPipeline(renewals?.items || []), [renewals]);

  const tone = {
    held_active: 'border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200',
    held_suspended: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    free: 'border-gray-200 bg-white text-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500',
  };

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-testid="hq-coverage">
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">EU territory coverage</h2>
          <span className="text-[11.5px] text-gray-500">
            {active} held · {suspended} suspended · {free} white space
          </span>
        </div>
        {/* The sort control, on SecurityPage's HQ filter-chip shape: same tier,
            same oxblood accent, `aria-pressed` carrying the state so the choice
            is readable to a screen reader and not only to the eye. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="hq-coverage-sort">
          {COVERAGE_SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                sort === s.key
                  ? 'border-rose-200 bg-rose-50 text-[#881337] dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
          {ordered.map((c) => {
            const cls = `rounded-md border px-1.5 py-1 text-center ${tone[c.state]}`;
            const label = c.licence
              ? `${c.name} — ${c.licence.licence_ref} (${c.licence.status})`
              : `${c.name} — available`;
            const body = (
              <>
                <div className="text-[12px] font-bold tabular-nums">{c.code}</div>
                <div className="truncate text-[9.5px] leading-tight">
                  {c.licence ? c.licence.licence_ref : '—'}
                </div>
              </>
            );
            // A HELD CELL OPENS ITS LICENCE; WHITE SPACE STAYS A DIV. There is
            // nothing to open behind a country nobody holds, and a button that
            // refuses is the `still_an_admin` mistake D134 named — it teaches
            // the operator that some of this grid's controls are a lie.
            return c.licence ? (
              <button
                key={c.code}
                type="button"
                onClick={() => onOpen?.(c.licence.uid)}
                title={label}
                data-testid={`coverage-${c.code}`}
                data-state={c.state}
                className={`${cls} hover:brightness-95`}
              >
                {body}
              </button>
            ) : (
              <div
                key={c.code}
                title={label}
                data-testid={`coverage-${c.code}`}
                data-state={c.state}
                className={cls}
              >
                {body}
              </div>
            );
          })}
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-gray-500">
          A suspended licence still holds its countries — releasing them is a termination, not a
          suspension — so those cells are taken, not free.
          {outside.length > 0 && (
            <> Outside the EU and not on this grid: <span className="font-medium">{outside.join(' ')}</span>.</>
          )}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Renewal pipeline</h2>
        {pipeline.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-gray-500">
            No licence on the ledger carries a renewal date yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800" data-testid="hq-renewal-pipeline">
            {pipeline.map((p) => (
              <li key={p.uid} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{p.licence_ref}</span> · {p.brand_name}
                </span>
                <span className={`shrink-0 tabular-nums ${
                  p.days === null ? 'text-gray-400'
                    : p.days < 0 ? 'font-semibold text-rose-700 dark:text-rose-300'
                      : p.days <= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'
                }`}>
                  {/* An overdue renewal is kept and marked, never dropped for
                      sorting below zero — it is the most important row here. */}
                  {p.days === null ? p.renews_on : p.days < 0 ? `${-p.days}d overdue` : `${p.days}d`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {renewals && renewals.complete === false && (
          <p className="mt-2 text-[11px] text-gray-500" data-testid="hq-renewal-pipeline-partial">
            The {pipeline.length} soonest of {renewals.total} renewals.
          </p>
        )}
      </div>
    </div>
  );
}
