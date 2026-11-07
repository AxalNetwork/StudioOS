/**
 * #4650 (D4650) — LR1's "Recommended for you": the member's next learning
 * action and the reason it was chosen, from `GET /api/learning/plan/next`
 * (services/learningNext.ts), with "Add to my plan" through the plan's own
 * sheet. Nothing found is the server's empty state, never an invented
 * suggestion; a failed read says so and is not an empty list.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../../ui';
import { learningPlanApi } from '../../lib/api/learningPlan';
import { LearningLoading, LearningUnreadable, SectionCard } from './LearningStates';
import { AddToPlan } from './PlanSheet';
import { NEXT_UNREADABLE_CLAIM, RECOMMENDED_TITLE, nextView } from './learningModel';
import useLearningRead from './useLearningRead';

export function NextForYouCard({ state, onRetry }) {
  let body;
  if (state.status === 'loading' || state.status === 'idle') body = <LearningLoading rows={1} what="your next step" />;
  else if (state.status !== 'ready') body = <LearningUnreadable what="Your next step" claim={NEXT_UNREADABLE_CLAIM} onRetry={onRetry} />;
  else {
    const v = nextView(state);
    body = v.kind === 'empty'
      ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="next-empty">{v.text}</p>
      : (
        <div className="space-y-2" data-testid="next-action">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {v.label && <Pill tone="info">{v.label}</Pill>}
            <Link to={v.href} className="min-w-0 truncate text-[13.5px] font-semibold text-axal-ink hover:underline dark:text-gray-100" data-testid="next-link">{v.title}</Link>
          </div>
          <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="next-reason">{v.reason}</p>
          {v.plan && <AddToPlan subject={v.plan} />}
        </div>
      );
  }
  return <SectionCard title={RECOMMENDED_TITLE} testid="section-recommended">{body}</SectionCard>;
}

export default function NextForYou() {
  const [state, retry] = useLearningRead(() => learningPlanApi.next(), [], { scope: 'next' });
  return <NextForYouCard state={state} onRetry={retry} />;
}
