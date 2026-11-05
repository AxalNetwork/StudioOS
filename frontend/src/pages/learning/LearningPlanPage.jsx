// D3959 (#3959) — /learning/plan, "My learning plan": what the member has put
// on their calendar to learn, upcoming and past, the goals they set, and "Add
// a study block". Composed from Learning's boards (LR12 "My learning" for the
// list, LR1's "Your progress" strip for the goals, `design/incoming/Learning
// Stream · Boards.dc.html`); the row actions are the Calendar's (CAL19).
//
// One read: `learningPlanApi.list` over the 30 days behind and 60 ahead (the
// Worker allows 92). Each row is one occurrence. A plan with nothing done shows
// nothing done, never "0%".
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RailFrame, actionGhost, actionPrimary } from '../../ui';
import { listPlan } from './planReads';
import { reportError } from '../../lib/log';
import { LearningHeader, SectionCard } from './LearningStates';
import { PlanSheet } from './PlanSheet';
import { PlanRowActions } from './PlanRowActions';
import { PLAN_SUB, PLAN_TITLE, STUDY_BLOCK_LABEL, goalRows, splitPlan, statusLine } from './learningPlanModel';

const DAY = 86_400_000;
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const LEARNING = { to: '/learning', label: 'Learning' };

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Row({ row, onChanged }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-800" data-testid={`plan-row-${row.key}`}>
      <div className="min-w-0">
        <p className={`m-0 text-[11px] font-bold uppercase tracking-wide ${MUTED}`}>{row.kindWord} · {when(row.at)}{row.minutes ? ` · ${row.minutes} min` : ''}{row.repeat && row.item.repeat !== 'none' ? ` · ${row.repeat}` : ''}</p>
        <p className={`m-0 text-[14px] font-semibold ${INK}`}>
          {row.href ? <Link to={row.href} className="hover:underline">{row.title}</Link> : row.title}
        </p>
        {!row.available ? <p className={MUTED}>This item is no longer open to you.</p> : null}
        <p className={MUTED} data-testid={`plan-status-${row.key}`}>{statusLine(row)}</p>
      </div>
      <PlanRowActions item={row.item} onChanged={onChanged} />
    </li>
  );
}

export default function LearningPlanPage() {
  const [state, setState] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    const now = Date.now();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    listPlan({ from: new Date(now - 30 * DAY).toISOString(), to: new Date(now + 60 * DAY).toISOString() }).then(
      (r) => { if (live) setState({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [] }); },
      (e) => { reportError('Learning:plan-read', e); if (live) setState({ status: 'error' }); },
    );
    return () => { live = false; };
  }, [tick]);

  const ready = state.status === 'ready';
  const { upcoming, past } = ready ? splitPlan(state.items) : { upcoming: [], past: [] };
  const goals = ready ? goalRows(state.items) : [];
  return (
    <RailFrame data-testid="learning-plan">
      <div className="space-y-4">
        <LearningHeader title={PLAN_TITLE} sub={PLAN_SUB} back={LEARNING}
          action={<button type="button" className={actionPrimary} onClick={() => setAdding(true)} data-testid="plan-add-study">{STUDY_BLOCK_LABEL}</button>} />
        {state.status === 'loading' ? <SectionCard title="Your plan" testid="plan-loading"><p className={MUTED} role="status">Reading your plan…</p></SectionCard> : null}
        {state.status === 'error' ? (
          <SectionCard title="Your plan" testid="plan-unreadable">
            <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">Your plan could not be read. That is not the same as an empty plan.</p>
            <button type="button" className={`${actionGhost} mt-2`} onClick={retry}>Try again</button>
          </SectionCard>
        ) : null}
        {ready && goals.length ? (
          <SectionCard title="Goals" testid="plan-goals">
            <ul className="m-0 list-none p-0">
              {goals.map((g) => (
                <li key={g.uid} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5" data-testid={`plan-goal-${g.uid}`}>
                  <span className={`text-[13px] ${INK}`}><strong>{g.text}</strong> <span className={MUTED}>· {g.title}</span></span>
                  <span className={MUTED}>{g.target ? `By ${g.target} · ` : ''}{g.state}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
        {ready ? (
          <SectionCard title="Upcoming" testid="plan-upcoming">
            {upcoming.length ? <ul className="m-0 list-none p-0">{upcoming.map((r) => <Row key={r.key} row={r} onChanged={retry} />)}</ul> : (
              <p className={MUTED} data-testid="plan-empty">Nothing planned yet. Open a course, lesson, webinar, exercise or exam and choose Add to my plan, or add a study block.</p>
            )}
          </SectionCard>
        ) : null}
        {ready && past.length ? (
          <SectionCard title="Past 30 days" testid="plan-past">
            <ul className="m-0 list-none p-0">{past.map((r) => <Row key={r.key} row={r} onChanged={retry} />)}</ul>
          </SectionCard>
        ) : null}
      </div>
      {adding ? <PlanSheet subject={{ kind: 'study_block' }} onClose={() => setAdding(false)} onDone={() => { setAdding(false); retry(); }} /> : null}
    </RailFrame>
  );
}
