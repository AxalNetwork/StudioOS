/**
 * D7651 part 2 (#7651) — the Eadwyn summary of all of your readings, under the
 * readings card's CSV export on `/research/markets` (canvas D7039, board RMP-12).
 *
 * Read from `GET /api/research/market-readings/summary`, which computes it from
 * the stored readings with no model call (the owner's answer A, 2026-11-19).
 * Each line is one row of the card: what it prices, its scope, the range to
 * the cent in mono and unbroken at 390, the comparable count, the run date and
 * its age word. Above them, the Worker's counts: readings stored, current,
 * ageing and stale, and the newest run date. Loading, Unavailable with Try
 * again, and No readings recorded each say so rather than draw a figure.
 */
import React from 'react';
import { DataState } from '../../ui';
import { NotRecorded } from '../../workspaces/canvasKit';
import { READINGS_SUMMARY_COPY, readingsSummaryView } from './marketReadingRead';

const AGE_WORD = { current: 'current', ageing: 'ageing', stale: 'stale' };
const AGE_INK = {
  current: 'text-axal-muted dark:text-gray-400',
  ageing: 'text-amber-800 dark:text-amber-300',
  stale: 'text-red-700 dark:text-red-300',
};

/** `read` is `useRead`'s `{ status, data, reload }`; `data` is `{ summary }`. */
export default function ReadingsSummary({ read }) {
  const status = read?.status;
  const loading = status === 'loading' && !read?.data;
  const failed = status === 'unreadable' || status === 'not_found';
  const view = !loading && !failed ? readingsSummaryView(read?.data?.summary) : null;
  return (
    <section
      data-testid="markets-readings-summary"
      aria-labelledby="markets-readings-summary-heading"
      aria-busy={loading ? 'true' : 'false'}
      className="mt-3 min-w-0 rounded-[12px] border border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-900 dark:bg-violet-950/40"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="markets-readings-summary-heading" className="text-[10px] font-extrabold uppercase tracking-[.09em] text-violet-800 dark:text-violet-300">
          {READINGS_SUMMARY_COPY.heading}
        </h3>
        <span className="text-[11px] text-axal-muted dark:text-gray-400">{READINGS_SUMMARY_COPY.basis}</span>
      </div>
      {loading ? (
        <p role="status" className="mt-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">{READINGS_SUMMARY_COPY.loading}</p>
      ) : null}
      {failed ? (
        <div className="mt-1.5">
          <DataState
            state="unavailable"
            what={READINGS_SUMMARY_COPY.unreadableWhat}
            claim={READINGS_SUMMARY_COPY.unreadableClaim}
            onRetry={read?.reload}
            retryLabel="Try again"
            announce="always"
            as="p"
          />
        </div>
      ) : null}
      {view?.state === 'none' ? (
        <p data-testid="markets-readings-summary-none" className="mt-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">{READINGS_SUMMARY_COPY.none}</p>
      ) : null}
      {view?.state === 'not_recorded' ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400">
          <NotRecorded />
          <span>{READINGS_SUMMARY_COPY.unreadableWhat} is not recorded.</span>
        </p>
      ) : null}
      {view?.state === 'recorded' ? (
        <>
          <p data-testid="markets-readings-summary-facts" className="mt-1.5 break-words text-[12px] text-axal-muted dark:text-gray-400">{view.facts}</p>
          <ul className="mt-1.5 space-y-1">
            {view.lines.map((l) => (
              <li key={l.uid} className="break-words text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-100">
                {l.state === 'recorded' ? (
                  <>{l.lead}: <b className="whitespace-nowrap font-mono font-bold">{l.range}</b>{l.tail}</>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-2">{l.metric}: <NotRecorded /></span>
                )}
                {l.age ? <span className={`text-[11.5px] ${AGE_INK[l.age]}`}> · {AGE_WORD[l.age]}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
