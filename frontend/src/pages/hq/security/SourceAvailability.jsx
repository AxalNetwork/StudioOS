import React from 'react';
import StatusBadge from './StatusBadge.jsx';
import { SOURCE_LABELS } from './overviewModel.js';

/**
 * D4800 (#4800, canvas SEB "SourceAvailability", SE10c "Partial") — "n of n
 * sources read", with each source's name, rows and reason behind a
 * disclosure, so the evidence model stays visible without the store names
 * sitting in the primary reading path.
 *
 * The count is the ledger's own `sources[]` from `/governance`. A filter on
 * Events reads fewer stores, and the line says which filter it counted under
 * rather than presenting a narrower read as the whole.
 *
 * Partial is never presented as clear: a failed source is named in the
 * summary line itself, with Retry, not only inside the disclosure.
 */
export default function SourceAvailability({ sources, onRetry, filterLabel, compact = false, children, 'data-testid': testId = 'security-sources' }) {
  const { state, read, total, rows } = sources;
  const failed = rows.filter((s) => !s.available);
  let summary;
  if (state === 'unreadable') summary = <StatusBadge state="unavailable" label="Sources could not be read" />;
  else if (state !== 'ready') summary = <span className="text-[12px] text-axal-faint">Reading sources…</span>;
  else summary = <StatusBadge state={failed.length || total === 0 ? 'unavailable' : 'healthy'} label={`${read} of ${total} sources read`} />;

  return (
    <div className={compact ? 'flex flex-col items-start gap-1 sm:items-end' : 'space-y-2'} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {summary}
        {state === 'ready' && filterLabel && <span className="text-[11px] text-axal-faint">under the {filterLabel} filter on Events</span>}
        {(state === 'unreadable' || failed.length > 0) && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-axal-hairline bg-white px-2 py-0.5 text-[11px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            Retry
          </button>
        )}
      </div>
      {failed.length > 0 && (
        <p className="text-[11.5px] text-axal-muted" data-testid={`${testId}-partial`}>
          {failed.map((s) => SOURCE_LABELS[s.table] || s.table).join(', ')} could not be read; rows from {failed.length === 1 ? 'it' : 'them'} may be missing.
        </p>
      )}
      <details className="text-[11.5px]">
        <summary className="cursor-pointer font-semibold text-axal-violet-deep dark:text-violet-300">Source details</summary>
        {rows.length > 0 && (
          <ul className="mt-1.5 space-y-0.5" data-testid={`${testId}-list`}>
            {rows.map((s) => (
              <li key={s.table} className="flex flex-wrap items-center gap-1.5 text-axal-faint">
                <StatusBadge state={s.available ? 'healthy' : 'unavailable'} label={SOURCE_LABELS[s.table] || s.table} />
                <span className="font-mono text-[10.5px]">{s.table}</span>
                <span>· {s.available ? `${Number(s.rows).toLocaleString()} rows read` : s.reason || 'did not answer'}</span>
              </li>
            ))}
          </ul>
        )}
        {children && <div className="mt-2 space-y-1.5 leading-relaxed text-axal-faint">{children}</div>}
      </details>
    </div>
  );
}
