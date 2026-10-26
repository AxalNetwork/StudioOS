import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbox } from '../../../ui';
import { reportError } from '../../../lib/log';
import { refusalLine } from './approvalsModel';

/**
 * D1046 (#2894) — what the three lane boards share: the card and type styles,
 * a tile, the failed card, a pager, one read answered alone, and the decision
 * dialog every decision opens (APR5, APR7, APR8).
 */

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';
export const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
export const PILL = 'ml-1.5 inline-block rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
export const WARN_PILL = 'inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
export const BTN = 'inline-flex min-h-[36px] items-center rounded-[8px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
export const BTN_PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[8px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50';
export const BTN_DANGER = 'inline-flex min-h-[36px] items-center rounded-[8px] bg-axal-destructive px-3 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50';
export const FIELD = 'w-full rounded-[8px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const SELECT = 'min-h-[34px] rounded-[8px] border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const nf = (n) => Number(n).toLocaleString('en-US');
export const PAGE = 25;

export function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-destructive dark:text-red-300`} data-testid={testId}>
      <span>{what} could not be read. That is not the same as having none.</span>
      <button type="button" className="font-bold underline" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function Tile({ label, children, sub, testId }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={testId}>
      <span className={EYE}>{label}</span>
      <div className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{children}</div>
      {sub ? <span className={SUB}>{sub}</span> : null}
    </div>
  );
}

/** A tile's figure: the number, a dash with why while it cannot be read, or … while reading. Never a 0 for a gap. */
export function Figure({ status, value }) {
  if (status === 'loading') return '…';
  if (status !== 'ready' || value == null) return <span title="This figure could not be read.">—</span>;
  return <span className={MONO}>{nf(value)}</span>;
}

/** "1–25 of 57" with Previous and Next. */
export function Pager({ page, total, onPage, testId }) {
  if (!total) return null;
  const from = page * PAGE + 1;
  const to = Math.min(total, (page + 1) * PAGE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid={testId}>
      <span className={`${SUB} ${MONO}`}>{`${from}–${to} of ${nf(total)}`}</span>
      <span className="flex gap-2">
        <button type="button" className={BTN} disabled={page === 0} onClick={() => onPage(page - 1)} data-testid={`${testId}-prev`}>Previous</button>
        <button type="button" className={BTN} disabled={to >= total} onClick={() => onPage(page + 1)} data-testid={`${testId}-next`}>Next</button>
      </span>
    </div>
  );
}

/**
 * One read, answered alone: `{ status: 'loading' | 'ready' | 'error', reply,
 * error, reload }`. `key` says when to read again; `enabled` false reads nothing.
 */
export function useLoad(fn, key, { enabled = true, what = 'approvals:board' } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', reply: null, error: null });
  const [tick, setTick] = useState(0);
  const call = useRef(fn);
  call.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setState({ status: 'loading', reply: null, error: null });
    Promise.resolve().then(() => call.current()).then(
      (reply) => { if (live) setState({ status: 'ready', reply, error: null }); },
      (error) => { reportError(`${what}`, error); if (live) setState({ status: 'error', reply: null, error }); },
    );
    return () => { live = false; };
  }, [key, tick, enabled, what]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/**
 * The one decision dialog. It says what changes (`copy.changes`), who is told
 * (`copy.told`) and what is recorded (`copy.recorded`); `blocked` is a refusal
 * known before sending (an unverified email, an expired licence), and a refusal
 * after sending is the Worker's own sentence. Nothing here uses alert or confirm.
 */
export function DecisionDialog({ copy, testId, onClose, onSend, ready = true, blocked = null, danger = false, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    if (!ready || blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend();
    } catch (e) {
      setError(refusalLine(e));
      setBusy(false);
    }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} sub={copy.changes} onClose={onClose} testId={testId} width={520}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose} data-testid={`${testId}-cancel`}>Cancel</button>
          <button type="button" className={danger ? BTN_DANGER : BTN_PRIMARY} disabled={!ready || !!blocked || busy} onClick={send} data-testid={`${testId}-send`}>
            {busy ? 'Saving…' : copy.button}
          </button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4" data-testid={`${testId}-fields`}>
        {children}
        {blocked ? <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300" data-testid={`${testId}-blocked`}>{blocked}</p> : null}
        <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid={`${testId}-told`}>{`◉ ${copy.told}`}</p>
        <p className={`m-0 ${SUB}`} data-testid={`${testId}-recorded`}>{copy.recorded}</p>
        {error ? <p role="alert" className="m-0 text-[13px] font-semibold text-axal-destructive dark:text-red-300" data-testid={`${testId}-refused`}>{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** A labelled text field inside a dialog. */
export function DialogField({ label, value, onChange, testId, placeholder = 'Write…', rows = 3, mono = false }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={EYE}>{label}</span>
      {rows > 1
        ? <textarea className={FIELD} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        : <input className={`${FIELD}${mono ? ' font-mono' : ''}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />}
    </label>
  );
}

/** The line a board shows after a decision lands. */
export function DoneLine({ text, onDismiss }) {
  if (!text) return null;
  return (
    <div role="status" className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-ink dark:text-gray-100`} data-testid="board-done">
      <span>{text}</span>
      <button type="button" className="font-bold underline" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/** A fact in a drawer: its label and value, "Not recorded" for a gap. */
export function Fact({ k, v, sub, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <dt className={EYE}>{k}</dt>
      <dd className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{v == null || v === '' ? <span className={SUB}>Not recorded</span> : v}</dd>
      {sub ? <dd className={`m-0 ${SUB}`}>{sub}</dd> : null}
    </div>
  );
}
