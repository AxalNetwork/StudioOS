/**
 * D4819 (#4819), Build part 1 — the ledger's true zero state (board L00), the
 * one-line territory coverage that expands to the existing matrix, and seat
 * utilisation said as Not recorded in operator language.
 *
 * Production holds no licence, so this is the page HQ sees today. "No
 * licences have been issued" and Issue first licence lead; why it is empty is
 * a disclosure; the matrix, search, filters and renewal analytics wait until
 * there is something to search, filter or renew.
 */
import React, { useId, useMemo, useState } from 'react';
import { coverageCells } from '../../../lib/licenceCoverage';

export function LedgerZero({ onIssue }) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  return (
    <section
      className="mt-4 flex flex-col items-start gap-3 rounded-xl border border-gray-200 bg-white px-6 py-8 sm:px-11 sm:py-10 dark:border-gray-800 dark:bg-gray-900"
      data-testid="licence-zero"
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400">Ledger · 0 licences</span>
      <h2 className="text-[26px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100">No licences have been issued</h2>
      <p className="max-w-[620px] text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        Issue the first licence to a real legal entity and assign its territory, commercial terms and administrators.
      </p>
      <button
        type="button" onClick={onIssue} data-testid="licence-issue-first"
        className="min-h-[40px] rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Issue first licence
      </button>
      <button
        type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} aria-controls={whyId}
        className="mt-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300" data-testid="licence-zero-why"
      >
        Why is this empty? {why ? '▴' : '▾'}
      </button>
      {why && (
        <p id={whyId} className="max-w-[620px] rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
          StudioOS does not seed fictional subsidiaries or licence agreements. The ledger fills only when HQ issues a licence.
        </p>
      )}
    </section>
  );
}

/**
 * "27 available · 0 held · 0 suspended", from the summary's real coverage,
 * and View territory coverage to open the matrix (`children`). Unavailable,
 * with Retry, when the summary could not be read: never 27 free by default.
 */
export function CoverageLine({ items, unavailable, onRetry, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const c = useMemo(() => coverageCells(items || []), [items]);
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="licence-coverage-line">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">EU territory coverage</h2>
          {unavailable ? (
            <p className="mt-1 text-[13px] font-semibold text-red-700 dark:text-red-300">
              ! Unavailable{' '}
              <button type="button" onClick={onRetry} className="text-xs font-semibold text-indigo-700 underline dark:text-indigo-300">Retry</button>
            </p>
          ) : !items ? (
            <p className="mt-1 text-[13px] text-gray-400 dark:text-gray-500">Reading…</p>
          ) : (
            <p className="mt-1 text-[13px] text-gray-800 dark:text-gray-200" data-testid="licence-coverage-counts">
              <b className="font-mono">{c.free}</b> available · <b className="font-mono">{c.held_active}</b> held · <b className="font-mono">{c.held_suspended}</b> suspended
            </p>
          )}
        </div>
        {!unavailable && items && (
          <button
            type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={panelId}
            data-testid="licence-coverage-toggle"
            className="min-h-[32px] rounded-md border border-gray-300 px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {open ? 'Hide territory coverage' : 'View territory coverage'}
          </button>
        )}
      </div>
      {open && !unavailable && items && <div id={panelId}>{children}</div>}
    </section>
  );
}

/** Seat utilisation, in operator language. The server's reason names an internal identifier; this does not. */
export function SeatUtilisation() {
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="licence-seat-utilisation">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        Seat utilisation — <span className="font-medium italic text-gray-500 dark:text-gray-400">Not recorded</span>
      </h2>
      <p className="mt-1 text-[12.5px] text-gray-600 dark:text-gray-400">
        HQ cannot reliably attribute account usage to individual licences yet. Branch-level usage remains available on HQ Home and the branch console.
      </p>
    </section>
  );
}
