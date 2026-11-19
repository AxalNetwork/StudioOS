/**
 * D7177 (#7177, canvas D7043 boards RS-15 A and RS-15 D) — the company
 * directory's selection: the bar under the results and Review selection.
 *
 * Both limits are stated before any project is chosen: Compare takes 2 to 6,
 * Add to research up to 25. A control that cannot act stays focusable with
 * `aria-disabled` and says why in visible text tied by `aria-describedby`,
 * never a tooltip only. Review lists every pick with the page it was ticked
 * on and Remove; removing moves focus to the next row, or to the heading
 * after the last. On a phone the bar is fixed to the bottom of the screen
 * with 44px targets, and Review opens as a bottom sheet.
 */
import React, { useEffect, useRef } from 'react';
import Sheet from '../../ui/Sheet.jsx';
import { ADD_MAX, COMPARE_MAX, COMPARE_MIN, LIMIT_LINE, otherPages, selectionRules } from './comparisonSave.js';

const QUIET = 'inline-flex min-h-[44px] items-center justify-center rounded-lg px-2 text-[12px] font-semibold text-axal-muted underline sm:min-h-[32px] dark:text-gray-400';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-3 text-[12px] font-semibold text-white hover:bg-violet-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-[32px] dark:bg-violet-600 dark:hover:bg-violet-500';
const WHY = 'inline-flex items-center gap-1 text-[12px] font-semibold';

/** The reason a control cannot act, as visible text: amber when the selection is over a limit. */
function Why({ id, text, over }) {
  if (!text) return null;
  return (
    <span id={id} className={`${WHY} ${over ? 'text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid={id}>
      {over ? <span aria-hidden="true">▲</span> : null}{text}
    </span>
  );
}

/** A button that stays focusable when it cannot act, and says why through `describedBy`. */
function GatedButton({ can, describedBy, onClick, className, children, buttonRef, testId }) {
  return (
    <button type="button" ref={buttonRef} className={className} data-testid={testId}
      aria-disabled={can ? undefined : 'true'} aria-describedby={can ? undefined : describedBy}
      onClick={(e) => { if (can) onClick?.(e); }}>
      {children}
    </button>
  );
}

/**
 * The bar: N selected (and how many on other pages), Review, Clear, Add to
 * research and Compare N, with the limit line. `picks` are `{ uid, name, page }`.
 */
export function SelectionBar({ picks, page, opener, compareOpener, reviewOpener, onReview, onClear, onAdd, onCompare }) {
  const rules = selectionRules(picks.length);
  const elsewhere = otherPages(picks, page);
  const why = rules.addWhy || rules.compareWhy;
  return (
    <>
    {/* On a phone the bar is fixed to the bottom: this keeps the last rows above it. */}
    <div className="h-36 sm:hidden" aria-hidden="true" />
    <div role="region" aria-label="Selected companies" data-testid="company-selection"
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-axal-hairline bg-white px-4 py-3 shadow-lg sm:sticky sm:bottom-3 sm:mx-auto sm:w-fit sm:max-w-full sm:rounded-xl sm:border sm:px-3 sm:py-2 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-axal-ink dark:text-gray-100" aria-live="polite" data-testid="selection-count">
          <b>{rules.count}</b> selected{elsewhere ? <> · <b>{elsewhere}</b> on other pages</> : null}
        </span>
        <button type="button" ref={reviewOpener} onClick={onReview} className={QUIET} data-testid="button-selection-review">Review</button>
        <button type="button" onClick={onClear} className={QUIET} data-testid="button-selection-clear">Clear</button>
        <span className="hidden h-5 w-px bg-axal-hairline sm:inline-block dark:bg-gray-700" aria-hidden="true" />
        <GatedButton can={rules.canAdd} describedBy="selection-why" onClick={onAdd} className={SECONDARY} buttonRef={opener} testId="button-selection-add">Add to research</GatedButton>
        <GatedButton can={rules.canCompare} describedBy="selection-why" onClick={onCompare} className={PRIMARY} buttonRef={compareOpener} testId="button-selection-compare">Compare {rules.count}</GatedButton>
        {why ? <Why id="selection-why" text={why} over={rules.count > COMPARE_MAX} /> : null}
        {!why && rules.compareNote ? <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="selection-note">{rules.compareNote}</span> : null}
      </div>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="selection-limits">{LIMIT_LINE}</span>
    </div>
    </>
  );
}

/** Before anything is ticked: the hint and the limits, so they are known before a project is chosen. */
export function SelectionHint() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400" data-testid="selection-hint">
      <span>Tick companies to add them to a research project, or to compare {COMPARE_MIN} to {COMPARE_MAX} of them.</span>
      <span className="font-semibold">{LIMIT_LINE}</span>
    </p>
  );
}

/**
 * Review selection (RCC01E, RCC10B): every pick in order with its page and
 * Remove, the picks past the sixth marked over the comparison limit.
 */
export function ReviewSelection({ picks, onRemove, onClear, onAdd, onCompare, onClose, returnFocusTo }) {
  const rules = selectionRules(picks.length);
  const heading = useRef(null);
  const removers = useRef([]);
  const focusAt = useRef(null);
  useEffect(() => {
    if (focusAt.current == null) return;
    const i = focusAt.current;
    focusAt.current = null;
    (removers.current[i] || heading.current)?.focus?.();
  }, [picks.length]);
  const remove = (uid, i) => {
    focusAt.current = i < picks.length - 1 ? i : null;
    if (focusAt.current == null) heading.current?.focus?.();
    onRemove(uid);
  };
  const why = rules.addWhy || rules.compareWhy;
  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <button type="button" className={SECONDARY} onClick={onClear} data-testid="button-review-clear">Clear all</button>
      <GatedButton can={rules.canAdd} describedBy="review-why" onClick={onAdd} className={SECONDARY} testId="button-review-add">Add {rules.count} to research</GatedButton>
      <GatedButton can={rules.canCompare} describedBy="review-why" onClick={onCompare} className={PRIMARY} testId="button-review-compare">Compare {rules.canCompare ? rules.count : ''}</GatedButton>
    </div>
  );
  return (
    <Sheet label={`Your selection · ${rules.count}`} eyebrow="Review selection" title={`Your selection · ${rules.count}`} onClose={onClose}
      phone="sheet" width={480} testId="review-selection" returnFocusTo={returnFocusTo} footer={footer}>
      <div className="flex flex-col gap-3 px-5 pb-5 pt-1">
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Kept across pages and filters. {LIMIT_LINE}.</p>
        {rules.over && rules.count <= ADD_MAX ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200" data-testid="review-over">
            <b>{rules.count} selected — Compare holds {COMPARE_MAX}.</b> Remove {rules.count - COMPARE_MAX} to compare. Add to research takes all {rules.count}.
          </div>
        ) : null}
        {why ? <Why id="review-why" text={why} over={rules.over} /> : null}
        <h3 ref={heading} tabIndex={-1} className="text-[12.5px] font-bold text-axal-ink focus:outline-none dark:text-white">Selected companies</h3>
        {!picks.length ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="review-empty">Nothing is selected.</p> : (
          <ol className="flex flex-col divide-y divide-axal-hairline rounded-lg border border-axal-hairline dark:divide-gray-800 dark:border-gray-700" data-testid="review-list">
            {picks.map((p, i) => (
              <li key={p.uid} className={`flex items-center gap-3 px-3 py-2 ${i >= COMPARE_MAX ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''}`} data-testid={`review-${p.uid}`}>
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-axal-muted dark:text-gray-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] text-axal-ink dark:text-gray-100">{p.name}</b>
                  <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{[p.sector, p.country, Number.isFinite(p.page) ? `page ${p.page}` : null].filter(Boolean).join(' · ')}</small>
                </span>
                {i >= COMPARE_MAX ? <span className="shrink-0 text-[11px] font-bold text-amber-800 dark:text-amber-300">Over the limit</span> : null}
                <button type="button" ref={(el) => { removers.current[i] = el; }} className={SECONDARY} onClick={() => remove(p.uid, i)}
                  aria-label={`Remove ${p.name} from the selection`} data-testid={`button-review-remove-${p.uid}`}>Remove</button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Sheet>
  );
}
