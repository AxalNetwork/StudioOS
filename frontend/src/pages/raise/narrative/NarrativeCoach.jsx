import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { narrativeCoachApi } from '../../../lib/api/narrativeCoach';
import { railPressHeaders } from '../../../lib/railPage';
import { useRailOption } from '../../../ui/railCrumbs';
import {
  COACH_EMPTY, COACH_LABEL, COACH_NOTE, COACH_OPTION, READY_UNREADABLE, coachFailure, droppedLine, findingLink, readyHead,
} from './coachModel';

/**
 * D1558 (#3805, deck v2 C10) — beside Story's writing surface:
 *   - **Deck ready to send** (`GET /deck-ready`, free): what still blocks
 *     sending the current deck, one row per area, each opening the editor at
 *     that card with that Grid area selected. "Ready" when nothing does.
 *   - **Coach against the deck**: one metered run under
 *     `review:narrative-coach` (`POST /narrative/:version/coach`). It answers
 *     findings, each with a proposal and, where it names one, a link to the
 *     card and area. Never a conversation: no thread, no composer. Nothing is
 *     written; the founder changes the deck or the narrative.
 * A reader reads the item and runs nothing; AI off says so and runs nothing.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const ASK = 'inline-flex w-fit shrink-0 items-center rounded-[9px] border border-axal-lavender-edge bg-axal-lavender px-3 py-1.5 text-[12px] font-bold text-axal-violet disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

export default function NarrativeCoach({ projectId, version, canRun = false, aiOn = true, offLine = null }) {
  const [ready, setReady] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const [coach, setCoach] = useState({ status: 'idle', data: null, error: null });
  useRailOption(coach.status === 'running' ? 'review:narrative-coach' : null, COACH_LABEL);

  useEffect(() => {
    if (projectId == null) return undefined;
    let live = true;
    setReady((r) => ({ status: 'loading', data: r.data }));
    narrativeCoachApi.deckReady(projectId).then(
      (data) => { if (live) setReady({ status: 'ok', data }); },
      () => { if (live) setReady({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [projectId, tick]);

  const run = useCallback(async () => {
    setCoach({ status: 'running', data: null, error: null });
    try {
      const data = await narrativeCoachApi.coach(projectId, version, railPressHeaders(COACH_OPTION));
      setCoach({ status: 'ok', data, error: null });
      if (data?.ready) setReady({ status: 'ok', data: data.ready });
    } catch (e) {
      setCoach({ status: 'error', data: null, error: coachFailure(e) });
    }
  }, [projectId, version]);

  const r = ready.data;
  const head = readyHead(ready.status, r);
  return (
    <section className={`${CARD} flex flex-col`} aria-label="Deck ready to send and the coach" data-testid="narrative-coach">
      <div className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`} data-testid="deck-ready-head">{head}</h2>
        {r?.version != null ? <span className={`text-[11.5px] ${MUTED}`}>v{r.version}</span> : null}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        {ready.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="deck-ready-error">
            <span className={`text-[12.5px] ${INK}`}>{READY_UNREADABLE}</span>
            <button type="button" className={GHOST} onClick={() => setTick((n) => n + 1)}>Try again</button>
          </div>
        ) : null}
        {r?.state === 'no_deck' ? <span className={`text-[12.5px] ${MUTED}`} data-testid="deck-ready-none">{r.label}</span> : null}
        {r?.rows?.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="deck-ready-rows">
            {r.rows.map((row) => (
              <li key={row.key}>
                <Link className={`${LINK} text-[12.5px]`} to={row.href} data-testid={`deck-ready-row-${row.key}`}>{row.label} ›</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
        <span className={`text-[12px] ${MUTED}`}>{COACH_NOTE}</span>
        {canRun && aiOn ? (
          <button type="button" className={ASK} onClick={run} disabled={coach.status === 'running' || r?.state === 'no_deck'} data-testid="narrative-coach-run">
            {coach.status === 'running' ? 'Coaching…' : COACH_LABEL}
          </button>
        ) : null}
        {canRun && !aiOn && offLine ? <span className={`text-[12px] ${MUTED}`} data-testid="narrative-coach-off">{offLine}</span> : null}
        {coach.status === 'error' ? <span role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="narrative-coach-error">{coach.error}</span> : null}
        {coach.status === 'ok' && !coach.data?.findings?.length ? <span className={`text-[12.5px] ${INK}`} data-testid="narrative-coach-empty">{COACH_EMPTY}</span> : null}
        {coach.status === 'ok' && coach.data?.findings?.length ? (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="narrative-coach-findings">
            {coach.data.findings.map((f) => (
              <li key={f.key} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`narrative-coach-finding-${f.key}`}>
                <span className={`text-[11px] font-bold uppercase tracking-[.06em] ${MUTED}`}>{f.section_label}</span>
                <span className={`text-[13px] leading-[1.5] ${INK}`}>{f.message}</span>
                {f.proposal ? <span className={`text-[12.5px] leading-[1.5] ${MUTED}`}>{f.proposal}</span> : null}
                {f.href ? <Link className={`${LINK} text-[12px]`} to={f.href} data-testid={`narrative-coach-open-${f.key}`}>{findingLink(f)} ›</Link> : null}
              </li>
            ))}
          </ol>
        ) : null}
        {coach.status === 'ok' && droppedLine(coach.data?.dropped) ? <span className={`text-[11.5px] ${MUTED}`} data-testid="narrative-coach-dropped">{droppedLine(coach.data.dropped)}</span> : null}
      </div>
    </section>
  );
}
