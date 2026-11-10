import React from 'react';
import StatusBadge from './StatusBadge.jsx';
import { SOURCE_LABELS, freshnessOf } from './overviewModel.js';

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
 *
 * D5247 — each store's last good read and its own age sit on its row in the
 * disclosure, and a store past its age is named in the summary line as Stale.
 * The evidence stores `/overview` reads (backup heartbeats, restore drill,
 * sanctions) are listed under them. A store with no recorded time says "Not
 * recorded"; nothing here is ever drawn as 0.
 */
function Freshness({ row, now }) {
  const f = freshnessOf(row, now);
  if (!f) return null;
  return f.state
    ? <span data-testid="security-source-stale"><StatusBadge state="stale" label={f.text} /></span>
    : <span className="text-axal-faint">· {f.text}</span>;
}

export default function SourceAvailability({ sources, onRetry, filterLabel, compact = false, children, 'data-testid': testId = 'security-sources' }) {
  const { state, read, total, rows, evidence = [], now = null } = sources;
  const failed = rows.filter((s) => !s.available);
  const staleNames = [...rows, ...evidence].filter((s) => s.freshness === 'stale').map((s) => SOURCE_LABELS[s.table || s.source] || s.table || s.source);
  let summary;
  if (state === 'unreadable') summary = <StatusBadge state="unavailable" label="Sources could not be read" />;
  else if (state !== 'ready') summary = <span className="text-[12px] text-axal-faint">Reading sources…</span>;
  else summary = <StatusBadge state={failed.length || total === 0 ? 'unavailable' : staleNames.length ? 'stale' : 'healthy'} label={`${read} of ${total} sources read`} />;

  return (
    <div className={compact ? 'flex flex-col items-start gap-1 sm:items-end' : 'space-y-2'} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {summary}
        {state === 'ready' && filterLabel && <span className="text-[11px] text-axal-faint">under the {filterLabel} filter on Events</span>}
        {(state === 'unreadable' || failed.length > 0) && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-axal-hairline bg-white px-2 py-0.5 text-[11px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            Retry
          </button>
        )}
      </div>
      {staleNames.length > 0 && (
        <p className="text-[11.5px] text-axal-muted" data-testid={`${testId}-stale`}>
          <StatusBadge state="stale" /> {staleNames.join(', ')} {staleNames.length === 1 ? 'is' : 'are'} past {staleNames.length === 1 ? 'its' : 'their'} age; the last good read is older than the store is written.
        </p>
      )}
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
                <Freshness row={s} now={now} />
              </li>
            ))}
          </ul>
        )}
        {evidence.length > 0 && (
          <ul className="mt-1.5 space-y-0.5" data-testid={`${testId}-evidence`}>
            {evidence.map((s) => (
              <li key={s.source} className="flex flex-wrap items-center gap-1.5 text-axal-faint">
                <StatusBadge state={s.answered ? 'healthy' : 'unavailable'} label={SOURCE_LABELS[s.source] || s.source} />
                <span className="font-mono text-[10.5px]">{s.source}</span>
                {!s.answered && <span>· did not answer</span>}
                <Freshness row={s} now={now} />
              </li>
            ))}
          </ul>
        )}
        {children && <div className="mt-2 space-y-1.5 leading-relaxed text-axal-faint">{children}</div>}
      </details>
    </div>
  );
}
