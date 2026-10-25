import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesApi } from '../../lib/api/cycles';
import { Unreadable } from '../../ui';
import { adaptOverview } from './adapters';
import { CycleCard, CycleHeader } from './CycleOverview';
import { CycleBar } from './PhoneModulePage';
import {
  DOOR_LINE, FOUNDING_TEAM_LINE, LINE, NOT_YET, PLAN_TABS, PLAN_WAIT, PROGRESS_WAIT, SECTIONS, TITLE, planHref, planSearch, provedCards,
} from './buildPlanModel';

/**
 * D1063 (#2426) — Build's plan at `/build/plan` and its Progress tab at
 * `/build/plan/progress`. `CycleRoute` draws it under Build's header and tab
 * row. "What Validate proved" is the Validate overview's own cards; each
 * module's section and Progress say what they wait for (`buildPlanModel.js`).
 */

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

/** The plan's own tabs, a second level under Build's: text with an underline, each a literal link. */
export function PlanTabBar({ active, search = '' }) {
  return (
    <div className="border-b border-axal-hairline dark:border-gray-700" data-testid="plan-tabs">
      <nav aria-label="Plan" className="-mb-px flex gap-1 overflow-x-auto">
        {PLAN_TABS.map((t) => (
          <Link key={t.id} to={planHref(t.id, search)} aria-current={t.id === active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === active
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`plan-tab-${t.id}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The Build overview's door to the plan (VB2's right panel). */
export function BuildPlanDoor({ search = '' }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-[18px] py-3 dark:border-violet-800 dark:bg-violet-900/30" data-testid="build-plan-door">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{DOOR_LINE}</p>
      <Link to={`/build/plan${planSearch(search)}`} className={LINK}>Open the plan</Link>
    </section>
  );
}

/** "What Validate proved": the Validate overview's cards for the four modules the plan rests on. */
function Proved({ projectId, search }) {
  const [state, setState] = useState({ status: 'loading', cards: [] });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', cards: [] });
    cyclesApi.overview('validate', projectId)
      .then((data) => { if (alive) setState({ status: 'ready', cards: provedCards(adaptOverview('validate', data)) }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', cards: [] }); });
    return () => { alive = false; };
  }, [projectId, reload]);
  return (
    <aside className="flex min-w-0 flex-col gap-3" aria-label="What Validate proved" data-testid="plan-proved">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">What Validate proved</span>
      {state.status === 'unreadable'
        ? <Unreadable what="Validate" claim="This is not a claim that nothing was proved." onRetry={() => setReload((n) => n + 1)} />
        : state.status === 'loading'
          ? <div className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" data-testid="plan-proved-loading" />
          : state.cards.map((c) => <CycleCard key={c.slug} cycle="validate" card={c} search={search} />)}
    </aside>
  );
}

function Section({ s }) {
  return (
    <section className={CARD} data-testid={`plan-section-${s.slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>{s.name}</h2>
        <span className={PILL}>{NOT_YET}</span>
      </div>
      <p className={MUTED}>Proposes {s.kinds}.</p>
    </section>
  );
}

export default function BuildPlan({ tab = 'plan', projectId, projectStatus = 'ready', onRetryProject, search = '', cards, action, phone = false }) {
  const s = planSearch(search);
  let body;
  // No venture means no read is made: say the venture list failed, never a skeleton.
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!projectId) body = <p className={MUTED} aria-busy="true" data-testid="plan-loading">Loading…</p>;
  else if (tab === 'progress') {
    body = (
      <section className={CARD} data-testid="plan-progress">
        <h2 className={H2}>Plan items by stage</h2>
        <span className={PILL}>{NOT_YET}</span>
        <p className={MUTED}>{PROGRESS_WAIT}</p>
      </section>
    );
  } else {
    body = (
      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="plan-body">
        <Proved projectId={projectId} search={s} />
        <div className="flex min-w-0 flex-col gap-[14px]">
          <p className={MUTED} data-testid="plan-wait">{PLAN_WAIT}</p>
          {SECTIONS.map((sec) => <Section key={sec.slug} s={sec} />)}
          <p className={MUTED} data-testid="plan-founding-team">{FOUNDING_TEAM_LINE}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`build-plan-${tab}-page`}>
      {phone
        ? <CycleBar back={{ label: 'Build', to: `/build${s}` }} title={TITLE} eadwynLabel={`Build · ${TITLE}`} />
        : <CycleHeader cycle="build" cards={cards} active="plan" action={action} title={TITLE} sub={LINE} search={s} />}
      <PlanTabBar active={tab} search={s} />
      {body}
    </div>
  );
}
