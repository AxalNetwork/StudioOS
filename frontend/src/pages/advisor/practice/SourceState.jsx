import React from 'react';

/**
 * `SourceState` — #4834 (D4834): one source's state in Practice, in the five
 * forms Practice v2's PX-08 draws and with its wording: loading, a successful
 * empty, unreadable ("… could not be read · Try again", never 0), not recorded
 * (the record exists, the field was never stored) and withheld ("Not shared
 * with you").
 *
 * A STAND-IN, KEPT SMALL ON PURPOSE. #5129 builds the shared state component
 * for every workspace; when it lands, this file is swapped for it and its
 * callers keep their props. Nothing here is Earnings-specific, and it holds no
 * layout beyond its own box, so a source that fails takes only its own box with
 * it: one failing source never blanks the page.
 *
 * `kind`: 'loading' | 'empty' | 'unreadable' | 'not_recorded' | 'withheld'.
 * `source` names the thing in the sentence ("Payout information"); `title`
 * and `children` carry an empty state's two lines or a not-recorded reason.
 */
export default function SourceState({ kind, source = 'This', title, children, onRetry, testid }) {
  const box = 'rounded-[10px] border px-3 py-2.5 text-[12px] leading-relaxed';
  if (kind === 'loading') {
    return (
      <div className={`${box} border-axal-hairline dark:border-gray-700`} role="status" aria-busy="true" data-testid={testid}>
        <span aria-hidden="true" className="block h-2.5 w-3/5 rounded bg-axal-hairline dark:bg-gray-800" />
        <span aria-hidden="true" className="mt-1.5 block h-2.5 w-4/5 rounded bg-axal-hairline dark:bg-gray-800" />
        <span className="mt-2 block text-[11px] text-axal-faint dark:text-gray-400">Loading {source.toLowerCase()}…</span>
      </div>
    );
  }
  if (kind === 'unreadable') {
    return (
      <div className={`${box} flex flex-wrap items-center gap-2 border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200`}
        role="alert" data-testid={testid}>
        <span aria-hidden="true" className="font-extrabold">✕</span>
        <span className="font-bold">{source} could not be read.</span>
        {children ? <span className="w-full text-[11.5px] font-normal">{children}</span> : null}
        {onRetry ? (
          <button type="button" onClick={onRetry}
            className="ml-auto min-h-[36px] rounded-lg border border-red-300 bg-white px-3 py-1 text-[12px] font-semibold text-red-900 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-red-800 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-950">
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  if (kind === 'not_recorded') {
    return (
      <span className="text-axal-faint italic dark:text-gray-400" data-testid={testid}>
        Not recorded{children ? <span className="not-italic"> · {children}</span> : null}
      </span>
    );
  }
  if (kind === 'withheld') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-700 dark:text-gray-300" data-testid={testid}>
        <span aria-hidden="true">◌</span> Withheld · Not shared with you
      </span>
    );
  }
  // 'empty': a read that succeeded and found nothing.
  return (
    <div className={`${box} flex gap-2 border-axal-hairline dark:border-gray-700`} data-testid={testid}>
      <span aria-hidden="true" className="font-extrabold text-axal-faint">0</span>
      <div>
        <b>{title}</b>
        {children ? <div className="text-axal-muted dark:text-gray-400">{children}</div> : null}
      </div>
    </div>
  );
}
