// D953 (#2371) — Programs › Mentor cohort access (PG4–PG6), from the reads
// that exist. This file is the routed page at
// `/admin/programs/mentor-cohorts` (Overview), `/how-it-runs` and `/people`
// (`guard(['admin'])` in App.jsx; `/admin/advisor-cohorts` redirects to People
// with `?moved=advisor-cohorts`) and board S18's file: its default export is
// one `AdminBoardFrame` named "Advisor cohort access", board S18's name, and
// the page sits in `MentorBody` inside it. People mounts the assignments
// console's body, never its default export, so the page has one rail.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import { AdvisorCohortAssignmentsBody } from '../AdvisorCohortAssignments';
import ProgramFrame from './ProgramFrame';
import { MentorTabs } from './ProgramTabs';
import { BlockFailed, Card, EYE, HowItRuns, LINK, Pill, Skeleton, SUB, Tile, Unread } from './parts';
import { useMentorReads } from './useProgramReads';
import {
  ACTIVE_MENTORS_LINE, CYCLE_FIXED, ET, HOW_IT_RUNS, MENTOR_MEASURES, NOT_READ_YET, WITHIN_500, cohortName, coveredLine,
  cycleForStrip, hostsFrom, hostsLine, isFailed, mentorFigures, mentorNeeds, routeFor, weekLines,
} from './programsModel';

const HIDDEN_REASON = 'Founders’ choices are stored; no admin read counts them yet.';

function MentorOverview({ reads }) {
  const now = Date.now();
  const f = mentorFigures(reads.assignments, reads.timeline);
  const hosts = hostsFrom(reads.hosts, now);
  const needs = mentorNeeds(f);
  const failedWhat = isFailed(reads.assignments) ? 'The mentor assignments' : 'The cohort cycles';
  const tiles = f.state === 'ready'
    ? [
      { key: 'mentors', label: 'Active mentors', state: 'ready', value: f.mentors.toLocaleString('en-US'), sub: ACTIVE_MENTORS_LINE, cover: f.capped ? `Counted ${WITHIN_500} assignments.` : null },
      { key: 'covered', label: 'Cohorts covered', state: 'ready', value: f.total ? `${f.covered.toLocaleString('en-US')} of ${f.total.toLocaleString('en-US')}` : '0', sub: coveredLine(f), cover: f.capped ? `Counted ${WITHIN_500} assignments.` : null },
    ]
    : [
      { key: 'mentors', label: 'Active mentors', state: f.state, reason: `${failedWhat} could not be read. That is not the same as none.` },
      { key: 'covered', label: 'Cohorts covered', state: f.state, reason: `${failedWhat} could not be read. That is not the same as none.` },
    ];
  return (
    <div className="flex flex-col gap-4" data-testid="programs-mentor-overview">
      <div className="grid gap-3.5 sm:grid-cols-3">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
        <Tile t={{ key: 'hidden', label: 'Founders hidden from a mentor', state: 'placeholder', word: NOT_READ_YET, reason: HIDDEN_REASON }} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card title="Needs you" meta={f.state === 'ready' ? needs.length.toLocaleString('en-US') : null} testId="programs-mentor-needs">
          {f.state === 'loading' ? <Skeleton lines={2} /> : null}
          {f.state === 'unreadable' ? <BlockFailed what={failedWhat} onRetry={reads.reload} testId="programs-mentor-needs-unreadable" /> : null}
          {f.state === 'ready' && !needs.length ? <p className={`m-0 ${SUB}`} data-testid="programs-mentor-needs-none">Nothing here needs you now.</p> : null}
          {f.state === 'ready' && needs.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {needs.map((row) => (
                <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`programs-mentor-needs-${row.key}`}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="self-start"><Pill tone="amber"><span aria-hidden="true">!</span>{row.kind}</Pill></span>
                    <span className="text-[13px] leading-snug text-axal-ink dark:text-gray-100">{row.text}</span>
                  </span>
                  <Link to="/admin/programs/mentor-cohorts/people" className={`${LINK} whitespace-nowrap`}>Open People</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card title="Office-hours hosts" testId="programs-mentor-hosts">
          <p className={`m-0 ${SUB}`}>Hosts are approved on the Spin-Out Lab page.</p>
          {hosts.state === 'loading' ? <Skeleton lines={1} /> : null}
          {hosts.state === 'unreadable' ? <BlockFailed what="The office-hours hosts" onRetry={reads.reload} testId="programs-mentor-hosts-unreadable" /> : null}
          {hosts.state === 'ready' ? <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="programs-mentor-hosts-line">{hostsLine(hosts)}</span> : null}
          <Link to="/admin/programs/spinout-lab" className={`${LINK} self-start`}>Open Spin-Out Lab</Link>
        </Card>
      </div>
    </div>
  );
}

/** The cycle strip: the four weeks of the running cohort, or else the next scheduled one. */
function CycleStrip({ timeline, onRetry }) {
  if (timeline.status === 'loading') return <Skeleton lines={2} />;
  if (timeline.status === 'error') return <BlockFailed what="The cohort cycles" onRetry={onRetry} testId="programs-mentor-cycle-unreadable" />;
  const cycle = cycleForStrip(timeline);
  if (!cycle) return <p className={`m-0 ${SUB}`} data-testid="programs-mentor-cycle">No cohort is running or scheduled.</p>;
  const weeks = weekLines(cycle);
  return (
    <div className="flex flex-col gap-2" data-testid="programs-mentor-cycle">
      <span className={EYE}>{`${cohortName(cycle)} · ${cycle.status === 'active' ? 'running' : 'scheduled'}`}</span>
      {weeks.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {weeks.map((w) => (
            <li key={w.week} className="rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-1.5 font-mono text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">{w.text}</li>
          ))}
        </ul>
      ) : <p className={`m-0 ${SUB}`}>Its week windows are not set yet.</p>}
      <p className={`m-0 ${SUB}`}>{`Times are ${ET}. ${CYCLE_FIXED}`}</p>
    </div>
  );
}

function MentorHowItRuns({ reads, superAdmin }) {
  const fill = (kind) => {
    if (kind === 'cycle') return <CycleStrip timeline={reads.timeline} onRetry={reads.reload} />;
    if (kind === 'contracts') {
      return (
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13.5px] text-axal-ink dark:text-gray-100">
          <span>No template is linked to this program.</span>
          <Link to="/admin/contracts?tab=templates" className={LINK}>Open contract templates</Link>
        </p>
      );
    }
    if (kind === 'measures') {
      return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="programs-mentor-measures">
          {MENTOR_MEASURES.map((m) => (
            <li key={m.label} className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{m.label}</span>
              {m.word ? <Unread word={m.word} reason={m.reason} /> : <span className={SUB}>{m.reason}</span>}
            </li>
          ))}
        </ul>
      );
    }
    return null;
  };
  return <HowItRuns sections={HOW_IT_RUNS['mentor-cohorts']} superAdmin={superAdmin} fill={fill} testId="programs-mentor-how" />;
}

function MentorBody() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const { tab } = routeFor(pathname);
  const reads = useMentorReads(tab);
  return (
    <ProgramFrame
      program="mentor-cohorts"
      superAdmin={superAdmin}
      actions={<Link to="/admin/programs/mentor-cohorts/people" className={`${actionPrimary} w-full sm:w-auto`} data-testid="programs-mentor-assign">Assign a mentor</Link>}
      tabs={<MentorTabs />}
    >
      {tab === 'overview' ? <MentorOverview reads={reads} /> : null}
      {tab === 'how' ? <MentorHowItRuns reads={reads} superAdmin={superAdmin} /> : null}
      {tab === 'people' ? <AdvisorCohortAssignmentsBody embedded /> : null}
    </ProgramFrame>
  );
}

// D774 (#2100): S18 drew no rail. The board's page, in the Admin boards' frame.
export default function MentorCohortAccess() {
  return (
    <AdminBoardFrame workspace="Advisor cohort access" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-advisor-cohort-access">
      <MentorBody />
    </AdminBoardFrame>
  );
}
