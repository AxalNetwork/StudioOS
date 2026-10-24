import React, { useEffect, useState } from 'react';
import { reportError } from '../../../lib/log';
import { Lightbox, Unreadable, Unrecorded, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { dataOf, isFailed, isLoading, isStale, rangeText } from './labDesksModel';

/**
 * D970 (#2755) — what the Hosts, Formation and Graduation tabs draw with: the
 * card, the pills and chips, a tile in each of its states, a read's state
 * line, the pager, the dialog's buttons and the one-sentence refusal. Class
 * strings follow AdminLab (D937) and Partner invitations (D923), so the admin
 * pages read as one family; only declared `axal-*` tokens, each with its dark
 * pair.
 */

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const INPUT = 'min-h-[36px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const MONO = 'font-mono text-[12px] tabular-nums text-axal-ink dark:text-gray-100';
export const TH = 'px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
export const TD = 'px-2.5 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
export const AMBER = 'text-amber-800 dark:text-amber-300';
const BODY = 'flex flex-col gap-3.5 px-5 py-4';

const TONES = {
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
};

/** A status pill: always its word, the glyph only beside it. */
export function Pill({ tone = 'muted', glyph, children, testId }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-normal ${TONES[tone] || TONES.muted}`} data-testid={testId}>
      {glyph ? <span aria-hidden="true">{glyph}</span> : null}{children}
    </span>
  );
}

/** A filter chip: a toggle button that says whether it is on. */
export function Chip({ on, onClick, children, testId }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
      className={`inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] ${on
        ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
        : 'border-axal-hairline bg-white font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`}>
      {children}
    </button>
  );
}

/** A labelled select for a toolbar filter or sort; the label is read, never only a placeholder. */
export function Select({ label, value, onChange, options, testId }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} data-testid={testId} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * One read, made alone. `tick` reads it again; a read that answered keeps its
 * rows while it is read again, and one that then fails keeps them as stale.
 * `load` is rebuilt every render and is not a dependency.
 */
export function useRead(scope, tick, load) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null });
  useEffect(() => {
    let live = true;
    setRead((r) => (r.data !== null ? { ...r, status: r.status === 'error' ? 'loading' : r.status } : { status: 'loading', data: null, error: null }));
    Promise.resolve().then(load).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null }); },
      (error) => {
        reportError(`admin-lab:${scope}`, error);
        if (live) setRead((r) => ({ status: 'error', data: r.data, error }));
      },
    );
    return () => { live = false; };
    // `load` is rebuilt every render; `scope` and `tick` say when to call it.
  }, [scope, tick]);
  return read;
}

/**
 * A read's state for its block: Reading…, Unreadable with Try again, or, after
 * a failed refresh, the "Could not refresh" line above the rows that stay.
 * Draws nothing when the read is good.
 */
export function ReadState({ read, what, claim, onRetry, testId }) {
  if (isLoading(read)) return <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-loading`}>Reading…</span>;
  if (isFailed(read)) return <div data-testid={`${testId}-unreadable`}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
  if (isStale(read)) {
    return (
      <p role="status" className={`m-0 flex flex-wrap items-center gap-2 text-[12px] font-semibold ${AMBER}`} data-testid={`${testId}-stale`}>
        {`Could not refresh ${what.charAt(0).toLowerCase()}${what.slice(1)}. The rows below are from the last read.`}
        <button type="button" onClick={onRetry} className="underline">Try again</button>
      </p>
    );
  }
  return null;
}

export const hasRows = (read) => dataOf(read) !== null;

/** A tile: ready, loading, unreadable (with Try again) or unrecorded (with its line). */
export function Tile({ t, onRetry }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`lab-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' ? <span className="font-mono text-[15px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
      {t.state === 'ready' ? (
        <>
          <span className="font-mono text-[24px] font-medium tracking-[-.02em] text-axal-ink dark:text-gray-100">{t.value}</span>
          {t.sub ? <span className={SUB}>{t.sub}</span> : null}
          {t.cover ? <span className={SUB}>{t.cover}</span> : null}
        </>
      ) : null}
      {t.state === 'unrecorded' ? (
        <>
          <span className="text-[15px] font-bold"><Unrecorded reason={t.reason} /></span>
          <span className={SUB}>{t.reason}</span>
        </>
      ) : null}
      {t.state === 'unreadable' ? <Unreadable what={t.label} claim={t.reason} onRetry={onRetry} /> : null}
    </div>
  );
}

/** "1–25 of 42" and the two page buttons. */
export function Pager({ shown, onPage, testId }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid={testId}>
      <span className={`font-mono text-[12px] text-axal-muted dark:text-gray-400`}>{rangeText(shown)}</span>
      {shown.pages > 1 ? (
        <span className="flex gap-2">
          <button type="button" className={actionGhost} disabled={shown.page <= 1} onClick={() => onPage(shown.page - 1)}>Previous</button>
          <button type="button" className={actionGhost} disabled={shown.page >= shown.pages} onClick={() => onPage(shown.page + 1)}>Next</button>
        </span>
      ) : null}
    </div>
  );
}

/** A refusal, as one sentence in place, inside the dialog it answers. */
export function Refusal({ text, testId }) {
  if (!text) return null;
  return <p role="alert" className="m-0 text-[12.5px] font-semibold leading-normal text-red-700 dark:text-red-300" data-testid={testId}>{text}</p>;
}

/** A result line in place of a toast. */
export function Done({ children, testId }) {
  return (
    <div role="status" className="rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * A write in a dialog: `run(write)` records the reply or the refusal, which
 * stay inside the dialog until Done; closing after a write reads the tab again.
 */
export function useWrite(onChanged, refusals, toText) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [reply, setReply] = useState(null);
  const run = async (write) => {
    setBusy(true); setRefusal(null);
    try { setReply((await write()) || {}); } catch (e) { setRefusal(toText(e, refusals)); } finally { setBusy(false); }
  };
  const finish = (onClose) => () => { if (busy) return; if (reply) onChanged(); onClose(); };
  return { busy, refusal, reply, run, finish };
}

/**
 * The in-page dialog every change opens (never a browser pop-up): its title,
 * what it changes, the fields, then Cancel and the action, or one Done after
 * the write. The refusal sits under the buttons.
 */
export function Dialog({ title, sub, onClose, w, action, tone = 'primary', disabled, onAction, testId, children, done }) {
  const close = w.finish(onClose);
  const footer = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {w.reply ? <button type="button" className={actionPrimary} onClick={close} data-testid={`${testId}-done`}>Done</button> : (
          <>
            <button type="button" className={actionGhost} onClick={close} disabled={w.busy}>Cancel</button>
            <button type="button" className={tone === 'danger' ? actionDanger : actionPrimary} onClick={onAction} disabled={disabled || w.busy} data-testid={`${testId}-go`}>
              {w.busy ? 'Saving…' : action}
            </button>
          </>
        )}
      </div>
      <Refusal text={w.refusal} testId={`${testId}-refusal`} />
    </div>
  );
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={close} testId={testId} footer={footer} pageBelow="lg">
      <div className={BODY}>
        {children}
        {w.reply && done ? <Done testId={`${testId}-result`}>{done}</Done> : null}
      </div>
    </Lightbox>
  );
}

/** A radio list with nothing chosen until the admin chooses. */
export function Radios({ name, value, onChange, options, disabled, testId }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid={testId}>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-[36px] items-center gap-2.5 rounded-[8px] border border-axal-hairline px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} data-testid={`${testId}-${o.value}`} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A field's label above its control. */
export function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={EYE}>{label}</span>
      {children}
    </label>
  );
}
