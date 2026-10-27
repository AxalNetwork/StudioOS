/**
 * D1240 (#3253) — the cells Deal flow's board and table share: a scope's band
 * with its confidence (never a number), the fit, the ask, days in stage and
 * the owner. Every missing value is a word with its reason, never 0.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { daysWord, fitCell, moneyText, scopeCell } from './flowModel';

const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const CONF_DOT = { High: 'bg-violet-600 dark:bg-violet-400', Medium: 'bg-violet-400 dark:bg-violet-500', Low: 'bg-violet-200 dark:bg-violet-800' };

/** A scope's band and its confidence; `words` writes the confidence, else a dot carries it with its label. */
export function ScopeCell({ scores, scope, words = true, testId }) {
  const c = scopeCell(scores, scope);
  if (c.kind !== 'scored') {
    return <span className={`${MUTED} ${c.kind === 'locked' ? 'font-semibold' : ''}`} title={c.title || undefined} data-testid={testId} data-kind={c.kind}>{c.word}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" title={c.title} data-testid={testId} data-kind="scored">
      {c.word}
      {c.confidence && (words
        ? <span className="font-normal text-axal-muted dark:text-gray-400">· {c.confidence}</span>
        : <span className={`inline-block h-1.5 w-1.5 rounded-full ${CONF_DOT[c.confidence] || CONF_DOT.Low}`} aria-label={`${c.confidence} confidence`} role="img" />)}
    </span>
  );
}

/** Fit to my thesis (D1239): its own number with confidence, "Set your thesis", or why there is none. */
export function FitCell({ fit, testId }) {
  const c = fitCell(fit);
  if (c.kind === 'not_set') return <Link to="/account" className="text-[12px] font-semibold text-sky-700 underline hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100" title={c.title} data-testid={testId}>{c.word}</Link>;
  if (c.kind !== 'scored') return <span className={MUTED} title={c.title || undefined} data-testid={testId}>{c.word}</span>;
  return <span className="text-[12.5px] font-semibold text-sky-800 dark:text-sky-200" title={c.title} data-testid={testId}>{c.word}{c.confidence && <span className="font-normal text-axal-muted dark:text-gray-400"> · {c.confidence}</span>}</span>;
}

export function AskCell({ row, withInstrument = true }) {
  const m = moneyText(row.ask, row.currency);
  if (!m) return <span className={MUTED} title="No ask is recorded on this round.">Ask not recorded</span>;
  return <span>{m}{withInstrument && row.instrument ? <span className={MUTED}> · {row.instrument}</span> : null}</span>;
}

export function DaysCell({ row }) {
  const d = daysWord(row.daysInStage);
  return d ? <span>{d}</span> : <span className={MUTED} title={row.inFlow ? 'The stage’s start is not recorded.' : 'Not on your deals.'}>—</span>;
}

export function OwnerCell({ row }) {
  if (!row.owner) return <span className={MUTED} title={row.inFlow ? 'Unassigned' : 'Not on your deals.'}>—</span>;
  return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10.5px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200" title={row.owner.name || 'Owner not named'}>{row.owner.initials || '?'}</span>;
}

/** The venture: a door to the deal only where DEAL's rule holds (`can_open`). D1241: `onPeek` adds Details, the peek (DLS7). */
export function VentureCell({ row, onPeek = null }) {
  return (
    <span className="flex min-w-0 flex-col">
      {row.canOpen
        ? <Link to={`/deals/${row.id}`} className="truncate font-semibold text-axal-ink underline hover:text-violet-700 dark:text-gray-100 dark:hover:text-violet-300" data-testid={`dealflow-open-${row.id}`}>{row.name}</Link>
        : <span className="truncate font-semibold text-axal-ink dark:text-gray-100" title="Opens once you are invited or commit.">{row.name}</span>}
      {row.sector && <span className={`${MUTED} truncate`}>{row.sector}</span>}
      {onPeek && <button type="button" className="w-fit text-[11.5px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100" onClick={() => onPeek(row)} aria-haspopup="dialog" data-testid={`dealflow-peek-${row.id}`}>Details</button>}
    </span>
  );
}
