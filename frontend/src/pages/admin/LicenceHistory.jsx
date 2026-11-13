/**
 * D4707 (#4707) — the licence's History tab: newest first, a page at a time,
 * each row naming who did it, what it changed (before → after) and how it
 * ended. "Load older" walks the whole record; nothing is cut at a fixed cap.
 * A page that could not be read says so beside the rows already shown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminLicenceHistoryApi } from '../../lib/api/adminLicenceHistory';
import { reportError } from '../../lib/log';
import { actorLabel, changeRows, eventLabel, outcomeLabel } from './licenceHistoryModel';
import { EVENTS_PAGE_DEFAULT } from '../../lib/licenceContracts';

/** One page of history: the contract's default (#4707). */
export const HISTORY_PAGE = EVENTS_PAGE_DEFAULT;

export function HistoryRow({ e }) {
  const ch = changeRows(e.change);
  return (
    <li data-testid="licence-history-row" className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-gray-900 dark:text-gray-100">{eventLabel(e.event)}</span>
        <span className="text-xs text-gray-600 dark:text-gray-400">by {actorLabel(e.actor)}</span>
        <time className="text-xs text-gray-500" dateTime={e.created_at}>{String(e.created_at || '').slice(0, 16).replace('T', ' ')}</time>
        <span data-testid="licence-history-outcome" className="text-xs text-gray-600 dark:text-gray-400">{outcomeLabel(e.outcome)}</span>
      </div>
      {e.note && <p className="mt-1 text-gray-700 dark:text-gray-300">{e.note}</p>}
      {ch.state === 'changes' && (
        <table className="mt-2 w-full text-xs">
          <caption className="sr-only">What changed</caption>
          <thead>
            <tr className="text-left text-gray-500">
              <th scope="col" className="pr-3 font-medium">Field</th>
              <th scope="col" className="pr-3 font-medium">Before</th>
              <th scope="col" className="font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {ch.rows.map((r) => (
              <tr key={r.field}>
                <th scope="row" className="pr-3 text-left font-normal text-gray-600 dark:text-gray-400">{r.label}</th>
                <td className="pr-3 text-gray-700 dark:text-gray-300">{r.before}</td>
                <td className="text-gray-900 dark:text-gray-100">{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ch.state === 'not_recorded' && <p className="mt-1 text-xs text-gray-500">Change: Not recorded.</p>}
      {ch.state === 'unreadable' && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Change: Unreadable.</p>}
    </li>
  );
}

export default function LicenceHistory({ licence }) {
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const page = useCallback(async (before) => {
    setBusy(true); setErr(null);
    try {
      const r = await adminLicenceHistoryApi.events(licence.uid, { before, limit: HISTORY_PAGE });
      setItems((prev) => (before === null ? r.items : [...(prev || []), ...r.items]));
      setNext(r.next_before ?? null);
    } catch (e) {
      reportError('licence_history_failed', e);
      setErr(e?.message || 'The history could not be read.');
    } finally { setBusy(false); }
  }, [licence.uid]);
  useEffect(() => { page(null); }, [page]);

  return (
    <div data-testid="licence-history">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">History</h3>
      {items === null && !err && <p className="mt-2 text-sm text-gray-500">Loading…</p>}
      {items === null && err && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          Unreadable: {err} This is not a claim that nothing happened.
        </p>
      )}
      {items !== null && items.length === 0 && <p className="mt-2 text-sm text-gray-600">Nothing recorded yet.</p>}
      {items !== null && items.length > 0 && (
        <ul className="mt-2 space-y-2">{items.map((e) => <HistoryRow key={e.id} e={e} />)}</ul>
      )}
      {items !== null && err && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{err}</p>}
      {next !== null && (
        <button
          type="button" data-testid="licence-history-older" disabled={busy} onClick={() => page(next)}
          className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
        >
          {busy ? 'Loading…' : 'Load older'}
        </button>
      )}
      <p className="mt-3 text-[11px] text-gray-500">
        Append-only. A contract dispute is exactly the case where an overwritten status is
        useless, so nothing here is ever edited or removed.
      </p>
    </div>
  );
}
