import React from 'react';
import { Unreadable, Unrecorded } from '../../../ui';
import { READING, statusTone, statusWord } from './eventsDeskModel';

/**
 * D915 (#2368) — the pieces every tab of the Events desk draws with: the
 * card, the pills, a tile in each of its states, and the one-sentence refusal.
 * Class strings follow Admin › Insights (D893) so the two admin pages read as
 * one family; only declared `axal-*` tokens, each with its dark pair.
 */

export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
export const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const INPUT = 'min-h-[36px] rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const TONES = {
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
};
const GLYPH = { draft: '✎', pending_review: '◷', published: '✓', rejected: '↩', cancelled: '✕' };

export function Pill({ tone = 'muted', children, testId }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-normal ${TONES[tone] || TONES.muted}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** A status in the canvas's words; the stored `rejected` reads "Sent back". */
export function StatusPill({ status }) {
  return (
    <Pill tone={statusTone(status)}>
      {GLYPH[status] ? <span aria-hidden="true">{GLYPH[status]}</span> : null}
      {statusWord(status)}
    </Pill>
  );
}

export function Card({ title, meta, children, className = '', testId }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4 ${className}`} data-testid={testId}>
      {title || meta ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          {title ? <h2 className={H2}>{title}</h2> : null}
          {meta ? <span className={SUB}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A tile: `state` is ready, loading, unreadable or missing (Guard G's "Not in
 * this read"). `words` marks a value that is a sentence, not a number. `note`
 * is a value nothing records yet.
 */
export function Tile({ t, onRetry }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`events-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' ? <span className="font-mono text-[15px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
      {t.state === 'ready' ? (
        <span className={t.words
          ? 'text-[15px] font-bold leading-snug text-axal-muted dark:text-gray-400'
          : 'font-mono text-[24px] font-medium tracking-[-.02em] text-axal-ink dark:text-gray-100'}>
          {t.value}
        </span>
      ) : null}
      {t.state === 'ready' && t.sub ? <span className={SUB}>{t.sub}</span> : null}
      {t.state === 'missing' ? <><span className="text-[13px] font-bold text-axal-muted dark:text-gray-400">Not in this read</span><span className={SUB}>{t.reason}</span></> : null}
      {t.state === 'unreadable' ? <Unreadable what={t.label} claim={t.reason || ''} onRetry={onRetry} /> : null}
      {t.note ? <span className="text-[12px]"><Unrecorded reason={t.note.reason}>{t.note.text}</Unrecorded></span> : null}
    </div>
  );
}

/** A refusal, as one sentence under the action it answers (D915 §3). */
export function Refusal({ text, testId = 'events-refusal' }) {
  if (!text) return null;
  return <p role="alert" className="m-0 text-[12.5px] font-semibold leading-normal text-red-700 dark:text-red-300" data-testid={testId}>{text}</p>;
}

/** A confirmation line over a list, in place of a toast (EV4b). */
export function Done({ children, testId = 'events-done' }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid={testId}>
      {children}
    </div>
  );
}
