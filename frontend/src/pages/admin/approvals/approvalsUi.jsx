/**
 * D5882 (#5882): what Approvals' views share, moved out of AdminApprovals.jsx unchanged: the styles, the age and urgency pills, one read answered alone (`useRead`), a lane's Waiting cell, a chart with its table, and the failed card.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChartTable } from '../../../ui';
import { LANE_FAILED, NOT_YET } from './approvalsModel';
import { errorRef, urgencyPill } from './inboxModel';
import { startApprovalRead } from './approvalReads';

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
export const NEW_PILL = 'ml-1.5 rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[10.5px] font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
export const CHIP = 'inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-[36px] rounded-full border px-3 text-[12.5px] font-bold';
export const CHIP_ON = 'border-axal-violet bg-axal-lavender text-axal-ink dark:bg-violet-950/40 dark:text-gray-100';
export const CHIP_OFF = 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400';
export const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[8px] sm:min-h-[36px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
export const BTN_SM = 'inline-flex min-h-[44px] items-center justify-center rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:bg-gray-50 sm:min-h-[30px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const BTN_PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[8px] sm:min-h-[36px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
export const SELECT = 'min-h-[44px] rounded-[7px] sm:min-h-[36px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export const PILL = {
  warn: 'border-amber-300 bg-amber-50 text-axal-amber-deep dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  bad: 'border-axal-destructive-edge bg-axal-destructive-tint text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  plain: 'border-axal-hairline bg-gray-50 text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
};

/** The age band's pill; under 24 hours has none (APR1). */
export function BandPill({ band }) {
  if (!band?.tone) return null;
  return <span className={`ml-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[band.tone]}`}>{band.label}</span>;
}

/** D4814: the Waiting column's pill, in words (never colour alone): "! Overdue", "◷ Due soon". */
export function UrgencyPill({ sla }) {
  const p = urgencyPill(sla);
  if (!p) return null;
  return <span className={`ml-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[p.tone]}`}>{p.text}</span>;
}

/**
 * One read, answered alone: `{ status: 'loading' | 'ready' | 'error', reply,
 * error, reload }`. `key` says when to read again; `enabled` false reads nothing.
 */
export function useRead(fn, key, enabled = true) {
  const [state, setState] = useState({ status: 'loading', reply: null, error: null });
  const [tick, setTick] = useState(0);
  const call = useRef(fn);
  call.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    setState((s) => ({ ...s, status: 'loading' }));
    return startApprovalRead(call.current,
      (reply) => setState({ status: 'ready', reply, error: null }),
      (error) => setState({ status: 'error', reply: null, error }),
    );
  }, [key, tick, enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** A lane's Waiting cell: a number, "Could not be read" with Try again, or not counted yet with why. */
export function WaitingCell({ v, onRetry }) {
  if (v.state === 'loading') return <span aria-label="Reading" className="inline-block h-2 w-8 rounded bg-axal-hairline dark:bg-gray-700" />;
  if (v.state === 'unreadable') {
    return (
      <span className="text-axal-destructive dark:text-red-300" data-testid={`approvals-lane-failed-${v.key}`}>
        {LANE_FAILED} <button type="button" className="underline" onClick={onRetry}>Try again</button>
      </span>
    );
  }
  if (v.state === 'unrecorded') return <span title={v.reason} className={`cursor-help ${SUB}`} data-testid={`approvals-lane-unrecorded-${v.key}`}>{NOT_YET}</span>;
  return <span className={MONO} data-testid={`approvals-lane-count-${v.key}`}>{v.count.toLocaleString('en-US')}</span>;
}

/** A chart with its one-sentence summary for a screen reader and "View as table" (D915 §6). */
export function ChartCard({ title, testId, chart, alt, legend, foot, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 px-4 py-3`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>{title}</h2>
        {chart ? (
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} className="min-h-[44px] text-[12px] font-bold text-axal-violet sm:min-h-0 dark:text-violet-300" data-testid={`${testId}-toggle`}>
            {asTable ? 'View as chart' : 'View as table'}
          </button>
        ) : null}
      </div>
      {legend}
      {chart && asTable ? <ChartTable chart={chart} caption={title} />
        : <div role="img" aria-label={alt} className="min-w-0" data-testid={`${testId}-img`}>{children}</div>}
      {foot ? <p className={`m-0 ${SUB}`}>{foot}</p> : null}
    </section>
  );
}

/** "We could not load …" with the reference a person can pass on (APR13b). */
export function FailedCard({ title, line, error, onRetry, testId }) {
  const ref = errorRef(error);
  return (
    <div className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} role="alert" data-testid={testId}>
      <h2 className={H2}>{title}</h2>
      <p className={`m-0 ${SUB}`}>{line}</p>
      <button type="button" className={LINK} onClick={onRetry}>Try again</button>
      {ref ? (
        <details className={SUB} data-testid={`${testId}-details`}>
          <summary className="cursor-pointer">Details</summary>
          <span className={MONO}>{ref}</span>
        </details>
      ) : null}
    </div>
  );
}
