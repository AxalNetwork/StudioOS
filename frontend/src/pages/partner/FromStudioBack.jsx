/**
 * D8733 (#8733) — what a page opened from the Studio firm feed draws: "Back to Studio · Firm feed" (SOP05, SOP06,
 * SOP11D) and, when the item it was asked for is not there, a notice that says so and opens nothing (SOP08,
 * SOP11F). Both key off `?from=studio`, which only the feed's links carry: the same page opened any other way draws
 * neither.
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CircleMinus } from 'lucide-react';
import { feedReturnHref, readFeedReturn } from './feedReturn';

/** True when this page was opened from the Studio firm feed. */
export function useFromStudio() {
  const [params] = useSearchParams();
  return params.get('from') === 'studio';
}

export const BACK_LABEL = 'Back to Studio · Firm feed';

/** The link itself, to the feed as the partner left it (the kept return record), or to the module. */
export function BackToFeedLink({ className = '' }) {
  return (
    <Link to={feedReturnHref()} className={`inline-flex min-h-[44px] items-center gap-1 text-[13px] font-semibold text-[#7c3aed] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c3aed] dark:text-[#a78bfa] ${className}`} data-testid="link-back-to-feed">
      <ArrowLeft size={14} aria-hidden="true" />{BACK_LABEL}
    </Link>
  );
}

/** The bar over a zone opened from the feed. Nothing when the page was opened any other way. */
export function FromStudioBack() {
  if (!useFromStudio()) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="from-studio-back">
      <BackToFeedLink />
      <span className="text-[13px] text-[#6b6577] dark:text-gray-400">You opened this from an alert on your Studio.</span>
    </div>
  );
}

/**
 * The name the feed's alert gave this item, when the kept return record opened it (the same `param=value` in its
 * link), so a notice names the client rather than a uid. Null otherwise.
 */
export function feedItemName(param, value, record = readFeedReturn()) {
  if (!record?.to || !value) return null;
  const q = new URLSearchParams(String(record.to).split('?')[1] || '');
  return q.get(param) === String(value) ? (record.who || null) : null;
}

/**
 * SOP08 A, SOP11F — the item asked for is not here. The Worker answers only for the acting firm's records, so a
 * removed item and another firm's read the same, and the copy does not say which. `checked` says every page was
 * read before deciding.
 */
export function NotFoundNotice({ name, where, checked = false, onShowAll, showAllLabel }) {
  const fromStudio = useFromStudio();
  return (
    <div role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[14px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" data-testid="focus-not-found">
      <CircleMinus size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <b>{name || 'This engagement'} is not on your firm’s {where}</b>
        <span className="text-[13px]">
          Nothing was opened. It may have been removed since your Studio loaded, or it is not one of this firm’s engagements.
          {checked ? ' Every page was checked.' : ''}
        </span>
        <div className="flex flex-wrap gap-x-4">
          {fromStudio && <BackToFeedLink />}
          {onShowAll && (
            <button type="button" onClick={onShowAll} className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-[#7c3aed] hover:underline dark:text-[#a78bfa]">{showAllLabel}</button>
          )}
        </div>
      </div>
    </div>
  );
}
