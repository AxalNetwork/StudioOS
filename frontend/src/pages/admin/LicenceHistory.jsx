/**
 * D4707 (#4707), D4819 L16 (#5926) — the licence's History
 * section, an attributable timeline. Newest first, a page at a time. Each
 * entry names:
 * - what happened, in operator words (never the raw event key);
 * - when it happened;
 * - who did it;
 * - each changed field as before → after;
 * - the recorded reason;
 * - the branch outcome: the push record kept with the row, plus what the
 *   licence's `sync` says now when that push did not land.
 * A missing actor, reason or outcome reads Not recorded.
 *
 * "Load older" walks the whole record over the read's own cursor; nothing is
 * cut at a fixed cap. A failed first read is Unreadable with Try again, never
 * an empty timeline. A failed older page keeps the rows already shown and
 * offers Try again for that page.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminLicenceHistoryApi } from '../../lib/api/adminLicenceHistory';
import { reportError } from '../../lib/log';
import {
  actorLabel, branchOutcome, changeRows, eventTitle, reasonLabel, whenLabel,
} from './licenceHistoryModel';
import { EVENTS_PAGE_DEFAULT } from '../../lib/licenceContracts';

/** One page of history: the contract's default (#4707). */
export const HISTORY_PAGE = EVENTS_PAGE_DEFAULT;

const BRANCH_TONE = {
  out_of_sync: 'text-amber-800 dark:text-amber-300',
  none: 'text-gray-600 dark:text-gray-400',
  no_failure: 'text-gray-700 dark:text-gray-300',
  not_recorded: 'text-gray-500 dark:text-gray-400',
};

export function HistoryRow({ e, sync }) {
  const ch = changeRows(e.change);
  const t = eventTitle(e.event);
  const reason = reasonLabel(e);
  const branch = branchOutcome(e, sync);
  return (
    <li
      data-testid="licence-history-row"
      className="grid gap-x-4 gap-y-2 border-t border-gray-200 py-3 text-sm first:border-t-0 sm:grid-cols-[12rem_minmax(0,1fr)] dark:border-gray-800"
    >
      <div>
        <div data-testid="licence-history-title" className="font-semibold text-gray-900 dark:text-gray-100">{t.title}</div>
        {t.key && <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{t.key}</div>}
        <time className="block text-xs text-gray-500 dark:text-gray-400" dateTime={e.created_at || undefined}>{whenLabel(e.created_at)}</time>
        <div data-testid="licence-history-actor" className="text-xs text-gray-700 dark:text-gray-300">{actorLabel(e.actor, e.detail)}</div>
      </div>
      <div className="flex flex-col gap-1.5">
        {ch.state === 'changes' && (
          <dl data-testid="licence-history-changes" className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {ch.rows.map((r) => (
              <React.Fragment key={r.field}>
                <dt className="text-gray-600 dark:text-gray-400">{r.label}</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  <del className="text-gray-500 dark:text-gray-400"><span className="sr-only">Before: </span>{r.before}</del>
                  <span aria-hidden="true"> → </span>
                  <ins className="no-underline"><span className="sr-only">, after: </span>{r.after}</ins>
                </dd>
              </React.Fragment>
            ))}
          </dl>
        )}
        {ch.state === 'none' && <p className="text-xs text-gray-600 dark:text-gray-400">No field changed value.</p>}
        {ch.state === 'not_recorded' && <p className="text-xs text-gray-500 dark:text-gray-400">Change: Not recorded.</p>}
        {ch.state === 'unreadable' && <p className="text-xs text-amber-700 dark:text-amber-300">Change: Unreadable.</p>}
        <p data-testid="licence-history-reason" data-state={reason.recorded ? 'recorded' : 'not_recorded'} className="text-xs text-gray-700 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">Reason:</span> {reason.text}
        </p>
        <p data-testid="licence-history-outcome" data-state={branch.state} className={`text-xs ${BRANCH_TONE[branch.state]}`}>
          <span className="text-gray-500 dark:text-gray-400">Branch:</span> {branch.text}
          {branch.now && <span className="block text-gray-600 dark:text-gray-400">{branch.now}</span>}
        </p>
      </div>
    </li>
  );
}

export default function LicenceHistory({ licence }) {
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  // The cursor of the page that failed: null for the first page, undefined when nothing failed.
  const [failed, setFailed] = useState(undefined);
  const [busy, setBusy] = useState(false);

  const page = useCallback(async (before) => {
    setBusy(true); setFailed(undefined);
    try {
      const r = await adminLicenceHistoryApi.events(licence.uid, { before, limit: HISTORY_PAGE });
      setItems((prev) => (before === null ? r.items : [...(prev || []), ...r.items]));
      setNext(r.next_before ?? null);
      setFailed(undefined);
    } catch (e) {
      reportError('licence_history_failed', e);
      setFailed(before);
    } finally { setBusy(false); }
  }, [licence.uid]);
  useEffect(() => { page(null); }, [page]);

  const firstFailed = items === null && failed === null;
  const olderFailed = items !== null && failed !== undefined && failed !== null;

  return (
    <section data-testid="licence-history" aria-labelledby="licence-history-h">
      <h3 id="licence-history-h" className="text-sm font-medium text-gray-900 dark:text-gray-100">History</h3>
      {items === null && !firstFailed && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {firstFailed && (
        <div role="alert" data-testid="licence-history-unreadable" className="mt-2 text-sm text-red-700 dark:text-red-300">
          <p>Unreadable: the history could not be read. This is not a claim that nothing happened.</p>
          <button
            type="button" data-testid="licence-history-retry" disabled={busy} onClick={() => page(null)}
            className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100"
          >
            {busy ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}
      {items !== null && items.length === 0 && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Nothing recorded yet.</p>}
      {items !== null && items.length > 0 && (
        <ol className="mt-2">{items.map((e) => <HistoryRow key={e.id} e={e} sync={licence.sync} />)}</ol>
      )}
      {olderFailed && (
        <div role="alert" data-testid="licence-history-older-unreadable" className="mt-2 text-sm text-red-700 dark:text-red-300">
          <p>The older entries could not be read. The entries above are unchanged.</p>
          <button
            type="button" data-testid="licence-history-retry" disabled={busy} onClick={() => page(failed)}
            className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100"
          >
            {busy ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}
      {next !== null && !olderFailed && (
        <button
          type="button" data-testid="licence-history-older" disabled={busy} onClick={() => page(next)}
          className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
        >
          {busy ? 'Loading…' : 'Load older'}
        </button>
      )}
      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
        Append-only. A contract dispute is exactly the case where an overwritten status is
        useless, so nothing here is ever edited or removed.
      </p>
    </section>
  );
}
