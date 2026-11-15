/**
 * D5900 (#5900, Deals v2 DX1b) — the one score component: a scope, its band
 * and confidence, and its evidence state. Deal flow's card, table and peek
 * draw it through `FlowCells.ScopeCell`; the deal page, Screening and Compare
 * take the same `scopeCell` and draw it here.
 *
 * It draws only what the Worker sent: the band and confidence word from
 * `POST /api/venture-scores/batch`, never a number, never 0. Each absence has
 * its own mark and word (Not scored, Not enough recorded, Not expected yet,
 * Unreadable, Locked, Not shared), and the marks carry no text, so the words
 * read the same with or without them. Change is not drawn: no investor read
 * sends one (D5900).
 */
import React from 'react';
import { scoreView } from './dealCardModel';

const MUTED = 'text-axal-muted dark:text-gray-400';
const CONF_DOT = { High: 'bg-violet-600 dark:bg-violet-400', Medium: 'bg-violet-400 dark:bg-violet-500', Low: 'border border-violet-400 bg-transparent dark:border-violet-500' };

/** The mark for each family: a shape, never a figure. */
function Mark({ family }) {
  if (family === 'locked') {
    return (
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" className="shrink-0 text-axal-ink dark:text-gray-100" data-mark="locked">
        <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="currentColor" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (family === 'unreadable') {
    return (
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" className="shrink-0 text-red-600 dark:text-red-400" data-mark="unreadable">
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 3.2v3.4M6 8.4v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (family === 'missing') return <span aria-hidden="true" className="inline-block h-0 w-2.5 shrink-0 border-b border-dashed border-gray-400 dark:border-gray-500" data-mark="missing" />;
  if (family === 'not_recorded') return <span aria-hidden="true" className="inline-block h-px w-2.5 shrink-0 bg-gray-400 dark:bg-gray-500" data-mark="not_recorded" />;
  if (family === 'not_expected') return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full border border-dotted border-gray-400 dark:border-gray-500" data-mark="not_expected" />;
  if (family === 'not_shared') return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-sm border border-dashed border-gray-400 dark:border-gray-500" data-mark="not_shared" />;
  return null;
}

/** Each family's word style, so no two absences look alike. */
const WORD = {
  missing: `${MUTED} italic`,
  not_recorded: MUTED,
  not_expected: `${MUTED} opacity-80`,
  unreadable: 'font-semibold text-red-700 dark:text-red-300',
  locked: 'font-semibold text-axal-ink dark:text-gray-100',
  not_shared: `${MUTED} underline decoration-dashed underline-offset-2`,
  loading: MUTED,
};

/**
 * One scope's score. `cell` is `flowModel.scopeCell(scores, key)`; `label` the
 * scope's name, said first ("Team: Strong, high confidence"). `words` writes
 * the confidence, else a dot carries it (the table's compact cells).
 */
export function ScopeScore({ cell, label, words = true, testId }) {
  const v = scoreView(cell, label);
  if (v.family !== 'value') {
    return (
      <span role="img" aria-label={v.announce} title={v.title || undefined} className={`inline-flex items-center gap-1 text-[12px] ${WORD[v.family] || MUTED}`}
        data-testid={testId} data-kind={cell?.kind} data-family={v.family}>
        <Mark family={v.family} />{v.word}
      </span>
    );
  }
  return (
    <span role="img" aria-label={v.announce} title={v.title || undefined}
      className={`inline-flex items-center gap-1 text-[12.5px] ${v.low ? 'font-medium text-gray-600 dark:text-gray-300' : 'font-semibold text-axal-ink dark:text-gray-100'}`}
      data-testid={testId} data-kind="scored" data-family="value" data-confidence={v.confidence || 'none'}>
      {v.word}
      {v.confidence && (words
        ? <span className={`font-normal ${MUTED}`}>· {v.confidence}</span>
        : <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${CONF_DOT[v.confidence] || CONF_DOT.Low}`} />)}
    </span>
  );
}

export default ScopeScore;
