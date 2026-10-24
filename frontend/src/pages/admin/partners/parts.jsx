import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { Unreadable, Unrecorded } from '../../../ui';
import {
  COPIED, READING, copyFailed, dataOf, dealState, dotsLabel, isCoolOff, isFailed, isLoading, isStale, pausedLine,
} from './partnersDeskModel';

/**
 * D923 (#2370) — the pieces every tab of Partner invitations draws with: the
 * card, the pills, the stage dots, a tile in each of its states, a read's
 * state line, the copy button with its failure path, the row menu, the pager
 * and the one-sentence refusal. Class strings follow the Events desk (D915)
 * and Admin › Insights (D893) so the admin pages read as one family; only
 * declared `axal-*` tokens, each with its dark pair.
 */

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const INPUT = 'min-h-[36px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const MONO = 'font-mono text-[12px] text-axal-ink dark:text-gray-100';
export const AMBER = 'text-amber-800 dark:text-amber-300';
export const TH = 'px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';
export const TD = 'px-2.5 py-2.5 align-top';

const TONES = {
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
};

export function Pill({ tone = 'muted', children, testId, title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-normal ${TONES[tone] || TONES.muted}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** A deal's state in the canvas's words (D923 §2); a raw state never shows. */
export function DealStatePill({ status, testId }) {
  const s = dealState(status);
  return <Pill tone={s.tone} testId={testId}><span aria-hidden="true">{s.glyph}</span>{s.word}</Pill>;
}

/**
 * The stage pill and its seven dots. The dots are a picture, so they carry
 * their text label ("Step 5 of 7: Offer chosen") and never stand alone.
 */
export function StageCell({ stage, testId, compact = false }) {
  const label = dotsLabel(stage);
  return (
    <span className="inline-flex flex-col gap-1" data-testid={testId}>
      <Pill tone={stage.tone} title={label}><span aria-hidden="true">{stage.glyph}</span>{stage.word}</Pill>
      {stage.step !== null ? (
        <span role="img" aria-label={label} title={label} className="font-mono text-[9px] tracking-[2px] text-axal-violet dark:text-violet-300">
          {Array.from({ length: 7 }, (_, i) => (i < stage.step ? '●' : '○')).join('')}
        </span>
      ) : null}
      {!compact && stage.mayLag ? <span className={`text-[11px] font-bold ${AMBER}`}>Stage may lag</span> : null}
    </span>
  );
}

export function Card({ title, meta, children, className = '', testId, headingLevel = 2 }) {
  const H = `h${headingLevel}`;
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4 ${className}`} data-testid={testId}>
      {title || meta ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          {title ? <H className={H2}>{title}</H> : null}
          {meta ? <span className={SUB}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A read that failed: `Unreadable`'s sentence ("{what} could not be read.
 * {claim}") with Try again beside it, so the block says so and the rest of
 * the page stands (D923 §2).
 */
export function Failed({ what, claim, onRetry, testId }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid={testId}>
      <Unreadable what={what} claim={claim} />
      {onRetry ? <button type="button" onClick={onRetry} className="text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button> : null}
    </div>
  );
}

/** A read that failed with 423 `recovery_cool_off_active`: paused, never "Not opened" or "Not sent". */
function Paused({ what, onRetry }) {
  return (
    <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-amber-900 dark:text-amber-200">
      {pausedLine(what)}
      {onRetry ? <button type="button" onClick={onRetry} className="underline">Try again</button> : null}
    </p>
  );
}

/**
 * A read's state for its block: Reading…, Unreadable with Try again (or
 * Paused on a cool-off), or, after a failed refresh, the "Could not refresh"
 * line above the rows that stay. Draws nothing when the read is good.
 */
export function ReadState({ read, what, claim, onRetry, testId }) {
  if (isLoading(read)) return <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={testId ? `${testId}-loading` : undefined}>{READING}</span>;
  if (isFailed(read)) {
    return (
      <div data-testid={testId ? `${testId}-unreadable` : undefined}>
        {isCoolOff(read.error) ? <Paused what={what} onRetry={onRetry} /> : <Failed what={what} claim={claim} onRetry={onRetry} />}
      </div>
    );
  }
  if (isStale(read)) {
    return (
      <p role="status" className={`m-0 flex flex-wrap items-center gap-2 text-[12px] font-semibold ${AMBER}`} data-testid={testId ? `${testId}-stale` : undefined}>
        {`Could not refresh ${what.charAt(0).toLowerCase()}${what.slice(1)}. The rows below are from the last read.`}
        {onRetry ? <button type="button" onClick={onRetry} className="underline">Try again</button> : null}
      </p>
    );
  }
  return null;
}

/** True when a block has rows to draw (fresh, or stale under its line). */
export const hasData = (read) => dataOf(read) !== null;

/**
 * A tile: `state` is ready, loading, unreadable or note. `words` marks a value
 * that is a sentence, not a number; `cover` says what a capped figure covers.
 */
export function Tile({ t, onRetry, testPrefix = 'partners-tile' }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`${testPrefix}-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' ? <span className="font-mono text-[15px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
      {t.state === 'ready' ? (
        <span className={t.words
          ? 'text-[15px] font-bold leading-snug text-axal-muted dark:text-gray-400'
          : `font-mono text-[24px] font-medium tracking-[-.02em] ${t.tone === 'amber' ? AMBER : 'text-axal-ink dark:text-gray-100'}`}>
          {t.value}
        </span>
      ) : null}
      {t.state === 'ready' && t.sub ? <span className={t.subTone === 'amber' ? `text-[12px] font-bold ${AMBER}` : SUB}>{t.sub}</span> : null}
      {t.state === 'ready' && t.extra ? <span className={`text-[12px] font-bold ${AMBER}`}>{t.extra}</span> : null}
      {t.state === 'ready' && t.cover ? <span className={SUB}>{t.cover}</span> : null}
      {t.state === 'unreadable' && t.figure ? (
        <>
          <span role="alert" className="text-[15px] font-bold leading-snug text-red-700 dark:text-red-300">{t.figure}</span>
          {t.reason ? <span className={SUB}>{t.reason}</span> : null}
          {onRetry ? <button type="button" onClick={onRetry} className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button> : null}
        </>
      ) : null}
      {t.state === 'unreadable' && !t.figure ? <Failed what={t.label} claim={t.reason || ''} onRetry={onRetry} /> : null}
      {t.state === 'note' ? <span className="text-[13px]"><Unrecorded reason={t.note.reason}>{t.note.text}</Unrecorded></span> : null}
    </div>
  );
}

/** A refusal, as one sentence in place, inside the dialog it answers (D923 §3). */
export function Refusal({ text, testId = 'partners-refusal' }) {
  if (!text) return null;
  return <p role="alert" className="m-0 text-[12.5px] font-semibold leading-normal text-red-700 dark:text-red-300" data-testid={testId}>{text}</p>;
}

/** A result line in place of a toast. */
export function Done({ children, testId = 'partners-done', tone = 'violet' }) {
  const tones = {
    violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  };
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[13px] font-semibold ${tones[tone] || tones.violet}`} data-testid={testId}>
      {children}
    </div>
  );
}

/** The clipboard, which can be missing or refuse: both are a failure the page says. */
export async function copyText(text) {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== 'function') throw new Error('The clipboard is not available here.');
  await clip.writeText(String(text));
}

/**
 * Copy, with "Copied" or "Copy failed. Select the link and copy it." On a
 * failure the value is shown in a field so it can be selected by hand. No
 * timer resets the words. `noun` names what is copied: a link by default, a
 * referral code as "code".
 */
export function CopyButton({ text, label = 'Copy', testId = 'partners-copy', showField = false, noun = 'link' }) {
  const [state, setState] = useState('idle');
  const copy = async () => {
    try { await copyText(text); setState('copied'); } catch { setState('failed'); }
  };
  return (
    <span className="inline-flex min-w-0 flex-col gap-1.5">
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={`${INPUT} min-h-[30px] font-semibold`} data-testid={testId}>{label}</button>
        {state === 'copied' ? <span role="status" className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400" data-testid={`${testId}-result`}>{COPIED}</span> : null}
        {state === 'failed' ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid={`${testId}-result`}>{copyFailed(noun)}</span> : null}
      </span>
      {state === 'failed' || showField ? (
        <input readOnly value={text} aria-label={`The ${noun}`} onFocus={(e) => e.target.select?.()} className={`${INPUT} w-full font-mono text-[12px]`} data-testid={`${testId}-field`} />
      ) : null}
    </span>
  );
}

/**
 * A row's menu, labelled "Actions for [name]": a disclosure of buttons, not
 * an ARIA menu, as on Events (D915). A click inside never reaches the row,
 * which opens on its own click and on Enter.
 *
 * FOCUS (D923 §1). Picking an item, or Escape, puts focus on ⋯ BEFORE the
 * list unmounts. The dialog or record the item opens then records ⋯ as what
 * opened it and gives focus back to it on close; unmounting the focused item
 * first is what sent focus to <body>.
 *
 * PLACEMENT. The tables scroll sideways in an `overflow-x-auto` box, and
 * `overflow-x` alone computes `overflow-y: auto`, so a list positioned
 * `absolute` under ⋯ was clipped on the last rows and on every row of a short
 * table (UsersConsole.jsx met the same). The open list is `position: fixed`
 * off ⋯'s own rect, which no overflow box clips. It opens on the side with
 * more room, capped to that room, and follows ⋯ on scroll and resize. It stays
 * beside ⋯ in the DOM, so Tab reaches its items next.
 */
export function RowMenu({ name, items, testId }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);
  const button = useRef(null);
  const listId = useId();
  const stop = (e) => e.stopPropagation();
  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect?.();
    if (!r || typeof window === 'undefined') return;
    const GAP = 6;
    const EDGE = 12;
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const right = Math.max(EDGE, window.innerWidth - r.right);
    setAt(below >= above
      ? { top: r.bottom + GAP, right, maxHeight: Math.max(96, below - GAP - EDGE) }
      : { bottom: window.innerHeight - r.top + GAP, right, maxHeight: Math.max(96, above - GAP - EDGE) });
  }, []);
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    // Capture phase, because the scroll happens on the table's own overflow box.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, place]);
  const close = () => { button.current?.focus?.(); setOpen(false); };
  const item = 'block w-full rounded-[7px] px-2.5 py-2 text-left text-[13px] font-semibold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:text-axal-muted dark:text-gray-100 dark:hover:bg-gray-800 dark:disabled:text-gray-500';
  return (
    <div className="relative" onClick={stop} onKeyDown={(e) => { stop(e); if (e.key === 'Escape' && open) close(); }} role="presentation">
      <button ref={button} type="button" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={`Actions for ${name}`}
        onClick={() => setOpen((o) => !o)} className={`${INPUT} min-h-[30px] min-w-[34px] font-bold`} data-testid={testId}>⋯</button>
      {open ? (
        <div id={listId} style={at ? { position: 'fixed', top: at.top, bottom: at.bottom, right: at.right, maxHeight: at.maxHeight } : undefined}
          className={`${CARD} ${at ? '' : 'absolute right-0 top-9 '}z-50 flex w-[260px] flex-col gap-0.5 overflow-y-auto p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`} data-testid={`${testId}-list`}>
          {items.map((it) => (it.render ? <div key={it.key} className="px-1 py-1">{it.render}</div> : (
            <button key={it.key} type="button" className={item} disabled={it.disabled}
              onClick={() => { close(); it.onSelect?.(); }} data-testid={`${testId}-${it.key}`}>{it.label}</button>
          )))}
        </div>
      ) : null}
    </div>
  );
}

export function Pager({ shown, range, onPage, testId }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={testId}>{range}</span>
      {shown.pages > 1 ? (
        <span className="flex gap-1.5">
          <button type="button" className={`${INPUT} font-semibold`} disabled={shown.page <= 1} onClick={() => onPage(shown.page - 1)}>Previous</button>
          <button type="button" className={`${INPUT} font-semibold`} disabled={shown.page >= shown.pages} onClick={() => onPage(shown.page + 1)}>Next</button>
        </span>
      ) : null}
    </div>
  );
}

/** A filter chip that toggles, with its state said (`aria-pressed`). */
export function Chip({ on, onClick, children, testId }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on
        ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
        : 'border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800'}`}>
      {children}
    </button>
  );
}

/** A labelled fact in a record: label above, value below. */
export function Fact({ label, children, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <span className={EYE}>{label}</span>
      <span className="text-[13px] leading-snug text-axal-ink dark:text-gray-100">{children}</span>
    </div>
  );
}

/** "Not read here yet" and "Not recorded", in the one muted voice (`Unrecorded`). */
export function Unread({ children, reason }) {
  return <Unrecorded reason={reason}>{children}</Unrecorded>;
}
