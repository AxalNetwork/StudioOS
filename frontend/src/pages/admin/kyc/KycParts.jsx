/**
 * D1235 (#3243) — the small parts Renewals and Audit share: a tile that says
 * "Not recorded" with its reason rather than 0, a block that says it could
 * not be read with Try again, the chips and the pager. People keeps its own
 * (`consoles/KycConsole.jsx`).
 */
import React from 'react';

export const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const BTN = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';
export const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** A count, or "Not recorded" with why. `reading` while the read runs. */
export function Tile({ t, reading, testId }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 p-3`} data-testid={testId}>
      <span className={EYE}>{t.label}</span>
      {reading ? <span className={`text-[13px] ${MUTED}`}>Reading…</span>
        : t.value == null ? <span className={`text-[13px] font-semibold ${MUTED}`} data-testid={`${testId}-unrecorded`}>Not recorded</span>
          : <span className="font-mono text-[22px] font-bold tabular-nums" data-testid={`${testId}-value`}>{t.value.toLocaleString('en-GB')}</span>}
      {!reading && t.sub && <span className={`text-[12px] ${MUTED}`}>{t.sub}</span>}
    </div>
  );
}

/** A read that failed: what is missing, never an empty list, and Try again. */
export function ReadFailed({ what, detail, onRetry, testId }) {
  return (
    <div className="flex flex-col gap-1" role="alert" data-testid={testId}>
      <p className="m-0 text-[13px] font-semibold">{what} could not be read. This is not a sign that there are none.</p>
      {detail && <p className={`m-0 text-[12.5px] ${MUTED}`}>{detail}</p>}
      <button type="button" className={`${BTN} w-fit`} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

export function Chip({ on, onClick, children, testId }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} data-testid={testId}
      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${on
        ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200'
        : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
      {children}
    </button>
  );
}

export function Pager({ page, pageSize, total, onPage, testId }) {
  const last = Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
  if (last <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2" data-testid={testId}>
      <button type="button" className={BTN} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</button>
      <span className={`text-[12.5px] ${MUTED}`}>Page {page} of {last}</span>
      <button type="button" className={BTN} disabled={page >= last} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</button>
    </div>
  );
}

/**
 * Two series as columns over one scale, a table beside it for a screen
 * reader. Every value here was counted, so a 0 is drawn as no column.
 */
export function TwoColumns({ rows, a, b, testId }) {
  const max = Math.max(1, ...rows.map((r) => r[a.key] + r[b.key]));
  const every = rows.length > 16 ? Math.ceil(rows.length / 8) : 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[150px] items-end gap-[3px]" data-testid={testId} aria-hidden="true">
        {rows.map((r, i) => (
          <div key={r.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${r.label}: ${r[a.key]} ${a.word}, ${r[b.key]} ${b.word}`}>
            <div className="flex w-full flex-col justify-end" style={{ height: 120 }}>
              <div className={b.cls} style={{ height: `${(r[b.key] / max) * 120}px` }} />
              <div className={a.cls} style={{ height: `${(r[a.key] / max) * 120}px` }} />
            </div>
            <span className={`w-full truncate text-center text-[10px] ${MUTED}`}>{i % every === 0 ? r.label : ''}</span>
          </div>
        ))}
      </div>
      <div className={`flex flex-wrap gap-3 text-[11.5px] ${MUTED}`}>
        <span><i className={`mr-1 inline-block h-2 w-2 rounded-sm ${a.cls}`} />{a.legend}</span>
        <span><i className={`mr-1 inline-block h-2 w-2 rounded-sm ${b.cls}`} />{b.legend}</span>
      </div>
      <table className="sr-only">
        <thead><tr><th>When</th><th>{a.legend}</th><th>{b.legend}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td>{r[a.key]}</td><td>{r[b.key]}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
