import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeApi } from '../../../lib/api/narrative';
import { reportError } from '../../../lib/log';
import {
  ANSWER_FOOT, OBJECTIONS_CAPPED, OBJECTIONS_FROM, OBJECTIONS_NONE, OBJECTIONS_UNREADABLE,
  answerItHref, objectionRow, objectionsOf,
} from './narrativeModel';

/**
 * D913 (#2697) — the objections investors raised, counted from Capital
 * relationships' feedback (`GET /narrative/objections`):
 *   - `ObjectionsPanel`, NAR10, the panel beside Story's writing surface. It
 *     reads on its own; "Answer it" asks Eadwyn to draft the open section so it
 *     answers that objection (`onAnswer`), which writes nothing.
 *   - `ObjectionsCard`, NAR1's "Objections heard" on Home, from the module
 *     read's `parts.narrative.objections`; its "Answer it" opens Story on it.
 * A failed read says so, never an empty list. An admin reads, with no Answer it.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const ASK = 'inline-flex w-fit shrink-0 items-center rounded-[9px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[12px] font-bold text-axal-violet disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

function Head({ count }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
      <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Objections heard</h2>
      <span className={`text-[11.5px] ${MUTED}`}>{OBJECTIONS_FROM}{count != null ? ` · ${count}` : ''}</span>
    </div>
  );
}

function Body({ view, onRetry, row }) {
  if (view.status === 'loading') return <div className="m-4 h-16 animate-pulse rounded-lg bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="objections-loading" />;
  if (view.status !== 'ok') {
    return (
      <div role="alert" className="flex flex-col gap-2 px-4 py-3" data-testid="objections-unreadable">
        <span className="text-[12.5px] text-red-700 dark:text-red-300">{OBJECTIONS_UNREADABLE}</span>
        {onRetry ? <button type="button" className={GHOST} onClick={onRetry} data-testid="objections-retry">Try again</button> : null}
      </div>
    );
  }
  if (!view.items.length) return <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="objections-none">{OBJECTIONS_NONE}</p>;
  return (
    <>
      <ul className="m-0 list-none p-0">{view.items.map((o) => row(objectionRow(o)))}</ul>
      {view.capped ? <p className={`m-0 px-4 pb-3 text-[11.5px] ${MUTED}`} data-testid="objections-capped">{OBJECTIONS_CAPPED}</p> : null}
    </>
  );
}

const ROW = 'flex flex-wrap items-start justify-between gap-2 border-b border-axal-ground px-4 py-2.5 last:border-b-0 dark:border-gray-800';

/**
 * NAR10. `canAnswer` is false for an admin, a live-deck version or no open
 * section; `aiOn` false greys Answer it with the page's own reason.
 */
export function ObjectionsPanel({ projectId, canAnswer, aiOn, busy, focusKey = null, sectionLabel = null, onAnswer, offLine }) {
  const [state, setState] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    narrativeApi.objections(projectId).then(
      (r) => { if (alive) setState(objectionsOf(r)); },
      (e) => { if (alive) setState({ status: 'unreadable' }); reportError('narrative:objections', e); },
    );
    return () => { alive = false; };
  }, [projectId, tick]);
  return (
    <aside className={`${CARD} flex flex-col`} aria-label="Objections heard" data-testid="story-objections">
      <Head count={state.status === 'ok' ? state.items.length : null} />
      <Body view={state} onRetry={retry} row={(r) => (
        <li key={r.key} className={`${ROW} ${r.key === focusKey ? 'bg-axal-lavender dark:bg-violet-950/30' : ''}`} aria-current={r.key === focusKey ? 'true' : undefined} data-testid={`story-objection-${r.key}`}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={`text-[13px] font-semibold ${INK}`}>{r.text}</span>
            <span className={`text-[12px] ${MUTED}`}>{r.sub}</span>
          </span>
          {canAnswer ? (
            <button type="button" className={ASK} disabled={!aiOn || busy} title={!aiOn ? offLine : undefined}
              aria-label={sectionLabel ? `Answer it in ${sectionLabel}` : 'Answer it'} onClick={() => onAnswer(r.key)} data-testid={`story-objection-answer-${r.key}`}>
              Answer it
            </button>
          ) : null}
        </li>
      )} />
      {canAnswer && state.status === 'ok' && state.items.length ? <p className={`m-0 border-t border-axal-hairline px-4 py-2.5 text-[11.5px] dark:border-gray-800 ${MUTED}`} data-testid="story-objections-foot">{ANSWER_FOOT}</p> : null}
    </aside>
  );
}

/** NAR1's "Objections heard", from the module read's part. */
export function ObjectionsCard({ part, search = '', admin = false }) {
  const view = objectionsOf(part?.objections);
  const newest = Array.isArray(part?.versions) && part.versions[0] ? part.versions[0].version : null;
  return (
    <section className={CARD} data-testid="narrative-objections">
      <Head count={view.status === 'ok' ? view.items.length : null} />
      <Body view={view} row={(r) => (
        <li key={r.key} className={ROW} data-testid="narrative-objection-row">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={`text-[13px] font-semibold ${INK}`}>{r.text}</span>
            <span className={`text-[12px] ${MUTED}`}>{r.sub}</span>
          </span>
          {!admin && newest != null ? <Link className={`${LINK} text-[12px]`} to={answerItHref(r.key, search, newest)} data-testid="narrative-objection-answer">Answer it ›</Link> : null}
        </li>
      )} />
    </section>
  );
}
