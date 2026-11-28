/**
 * D9025 (#9025): the shared directory's search box, true total and cursor pager (D7676 NPD-01, NPD-09,
 * NPD-15), used by People (#9025) and the Organizations directory (#9071). Each takes what the page read;
 * none reads the Worker or counts rows itself.
 */
import { useEffect, useId, useState } from 'react';
import { DataState } from '../../../ui/Honesty.jsx';
import { rangeLabel, totalLine } from './directoryModel.js';

export const INK = 'text-axal-ink dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const CARD = 'rounded-2xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900 sm:p-5';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[44px]';
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-500 dark:hover:bg-violet-400`;

/** The search box. The term is applied on submit, so typing does not reset the page under the reader. */
export function DirectorySearchForm({ q, onSearch, label, placeholder }) {
  const id = useId();
  const [draft, setDraft] = useState(q || '');
  useEffect(() => { setDraft(q || ''); }, [q]);
  return (
    <form role="search" className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSearch(draft.trim()); }}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="min-h-[38px] min-w-0 flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink placeholder:text-axal-faint dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500 max-md:min-h-[44px] md:max-w-[520px]"
      />
      <button type="submit" className={GHOST}>Search</button>
      {q ? <button type="button" className={GHOST} onClick={() => { setDraft(''); onSearch(''); }}>Clear search</button> : null}
    </form>
  );
}

/** The true total, announced politely after each search (NPD-15). Never 0 while unknown. */
export function DirectoryTotal({ state, total, q, noun }) {
  return (
    <p role="status" aria-live="polite" className={`m-0 text-[13px] font-bold ${INK}`} data-directory-total={state === 'ready' ? String(total) : state}>
      {totalLine({ state, total, q, noun })}
    </p>
  );
}

/**
 * "1–50 of 137 · sorted by name", then Previous and Next. Cursor pages cannot jump to a numbered page,
 * so there are no page numbers (a departure from NPD-01's 1 2 3).
 */
export function DirectoryPager({ page, shown, total, hasNext, onPrev, onNext, noun = 'people' }) {
  if (total === null || total === undefined) return null;
  return (
    <nav aria-label={`Pages of ${noun}`} className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className={`text-[12px] ${MUTED}`}>{rangeLabel(page, shown, total)} · sorted by name</span>
      <span className="flex gap-2">
        <button type="button" className={GHOST} onClick={onPrev} disabled={page <= 1}>‹ Previous</button>
        <button type="button" className={GHOST} onClick={onNext} disabled={!hasNext}>Next ›</button>
      </span>
    </nav>
  );
}

/** A later page that could not be read: what is shown stays, and the total is still the server's (NPD-09). */
export function LaterPageFailed({ page, shown, onRetry, noun = 'people' }) {
  return (
    <DataState
      state="unavailable"
      size="block"
      announce="always"
      what={`Page ${page}`}
      claim={`The ${shown} ${noun} already shown stay. Nothing is erased.`}
      onRetry={onRetry}
      retryLabel={`Try page ${page} again`}
      data-later-page-failed={page}
    />
  );
}
