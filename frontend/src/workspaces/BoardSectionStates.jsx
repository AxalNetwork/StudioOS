import React from 'react';
import { DataState, Unrecorded } from '../ui';

/**
 * D4828 (#4828, EX-04 and EX-14) — a bucket board section's states and rows on
 * #5129's shared components, for a board that sets `states: 'platform'`
 * (Expertise). `BucketBoard.jsx` draws these in place of its own loading,
 * failed and table markup for that board only; every other board is unchanged.
 */

/**
 * One section's loading, refused or unavailable state, or null once it is ready.
 *
 * Loading is said by word as well as drawn. A failed read is Unavailable with
 * this section's own Try again, never a 0 and never the empty line. A refusal
 * the board names in `refusals` (`{ code: sentence }`: the Advisor licence on
 * Expertise) is Refused, with no Try again, because reading again cannot change
 * the answer. One slow or failed source leaves every other section as it is
 * (#4697): each section reads its own source's state.
 */
export function BoardSectionState({ title, state, source, refusals = null }) {
  if (state === 'loading') {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{`Loading ${title}…`}</span>
        <DataState state="loading" size="block" />
      </div>
    );
  }
  if (state !== 'error') return null;
  const refusal = source?.code && refusals ? refusals[source.code] : null;
  if (refusal) return <DataState state="refused" size="block" claim={refusal} />;
  return (
    <DataState state="unavailable" size="block" claim={source?.error} announce="always"
      onRetry={typeof source?.retry === 'function' ? source.retry : undefined} retryLabel="Try again"
      reason="Other sections are unaffected. Nothing is shown rather than an empty list, because an empty list would say you have no records." />
  );
}

// An absent cell is #5129's Not recorded chip, never a blank or a dash.
const cellOf = (c) => c ?? <Unrecorded />;

/**
 * A section's rows with no sideways table (EX-04, EX-16). Below 768px each row
 * is a block: its first cell as the heading, then each other cell beside its
 * column's name. From 768px the canvas's grid, which fits without scrolling.
 */
export function BoardRows({ slug, columns, cols, rows }) {
  return (
    <>
      <ul className="m-0 list-none p-0 md:hidden" data-testid={`board-rows-${slug}`}>
        {rows.map((cells, i) => (
          <li key={i} className="border-t border-axal-ground py-2 first:border-t-0 dark:border-gray-800">
            <div className="text-[12px] font-semibold text-axal-ink dark:text-gray-100">{cellOf(cells[0])}</div>
            <dl className="m-0 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-gray-700 dark:text-gray-300">
              {cells.slice(1).map((c, j) => (
                <div key={j} className="flex gap-1">
                  <dt className="text-gray-600 dark:text-gray-400">{columns[j + 1]}</dt>
                  <dd className="m-0">{cellOf(c)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden md:block" data-testid={`board-grid-${slug}`}>
        <div className="grid gap-3" style={{ gridTemplateColumns: cols }}>
          {columns.map((head) => (
            <span key={head} className="pb-2 text-left text-[10px] font-extrabold uppercase tracking-[.07em] text-gray-600 dark:text-gray-300">
              {head}
            </span>
          ))}
        </div>
        {rows.map((cells, i) => (
          <div key={i} className="grid items-center gap-3" style={{ gridTemplateColumns: cols }}>
            {cells.map((c, j) => (
              <span key={j} className="min-w-0 break-words border-t border-axal-ground py-2 text-[11.5px] tabular-nums text-gray-700 dark:border-gray-800 dark:text-gray-300">
                {cellOf(c)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
