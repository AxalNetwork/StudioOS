import React from 'react';
import { Lightbox, usePhoneWidth } from '../../../ui';

/**
 * D1014 (#2833) — the Payments page's shared pieces, so Catalogue, Stripe
 * connection and Change log draw the same buttons, cards, states and dialogs.
 * Each class carries its dark colour (PAY13).
 */

export const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
export const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400`;
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-500 dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const PILL = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
export const BAD_PILL = 'inline-flex items-center gap-1 rounded-full border border-axal-destructive-edge px-2 py-0.5 text-[11px] font-semibold text-axal-destructive dark:border-red-900 dark:text-red-300';
export const AMBER = 'rounded-[10px] border border-amber-300 bg-axal-amber/30 px-3.5 py-2.5 text-[12.5px] text-axal-amber-deep dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
export const LINK = 'font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
export const FIELD = 'h-9 rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const BIG = `${MONO} text-[22px] font-medium text-axal-ink dark:text-gray-100`;

/** PAY12's phone: below `md`, the catalogue stacks, the chart is a table, dialogs are bottom sheets. */
export const PAY_PHONE_QUERY = '(max-width: 767px)';
export const usePayPhone = () => usePhoneWidth(PAY_PHONE_QUERY);

function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

export function Reading() {
  return <><span className="font-mono text-[13px] text-axal-muted dark:text-gray-400">Reading…</span><Skeleton /></>;
}

export function Unread({ text, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-col gap-2 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid={testId}>
      <span>{text}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

/** Every Payments dialog: the shared lightbox, a bottom sheet on a phone (PAY12). */
export function PayDialog({ label, title, sub, onClose, footer, children, testId }) {
  return (
    <Lightbox label={label || title} title={title} sub={sub} onClose={onClose} footer={footer} phone="sheet" width={520} testId={testId}>
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </Lightbox>
  );
}

/** Codes only under "Technical details" (the page's rule). */
export function Technical({ children, testId }) {
  return (
    <details className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={testId}>
      <summary className="cursor-pointer font-semibold">Technical details</summary>
      <div className={`mt-1 break-all ${MONO}`}>{children}</div>
    </details>
  );
}
