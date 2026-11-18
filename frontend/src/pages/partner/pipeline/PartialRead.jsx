import React from 'react';

/**
 * #4701 — shown when a list's first page answered and a later one did not.
 * The rows above are real; the list is not known to be all of them, and the
 * totals (which the worker counts over the whole book) can be larger than the
 * rows drawn. A short list must not read as the whole list.
 */
export default function PartialRead({ data, noun, onRetry }) {
  if (!data || !data.remainder_error) return null;
  const shown = Array.isArray(data.items) ? data.items.length : 0;
  return (
    <div
      role="alert"
      data-testid="partial-read"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
    >
      <span>Showing {shown} {noun}. The rest could not be read, so this is not the whole list.</span>
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Read the rest</button>}
    </div>
  );
}

/** A background read preserves the current rows and any open editor. */
export function PipelineReadStatus({ state, onRetry }) {
  if (!state?.refreshing && !state?.refreshError) return null;
  return (
    <div role="status" data-testid="pipeline-refresh-status"
      className="mb-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
      {state.refreshing ? 'Refreshing. Your current view and draft stay open.' : 'Unreadable refresh. Showing the last successful read; your draft is still here.'}
      {state.refreshError && onRetry ? <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">Try again</button> : null}
    </div>
  );
}
