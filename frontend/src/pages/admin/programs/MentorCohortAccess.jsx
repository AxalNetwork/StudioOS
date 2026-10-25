// D953 (#2371) — Programs › Mentor cohort access (PG4–PG6), from the reads
// that exist. This file is the routed page at
// `/admin/programs/mentor-cohorts` (Overview), `/how-it-runs` and `/people`
// (`guard(['admin'])` in App.jsx; `/admin/advisor-cohorts` redirects to People
// with `?moved=advisor-cohorts`) and board S18's file: its default export is
// one `AdminBoardFrame` named "Advisor cohort access", board S18's name, and
// the page sits in `MentorBody` inside it. People mounts the assignments
// console's body, never its default export, so the page has one rail.
//
// D962 (#2795) completes it: Overview's four tiles, Mentors per cohort, Needs
// you whose rows open Assign or End access, Recent activity; How it runs
// from part 1's playbook store with the editor; People with its toolbar,
// columns and dialogs; Activity; and the phone pages (PG20b–PG20d).
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { actionPrimary, usePhoneWidth } from '../../../ui';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import { AdvisorCohortAssignmentsBody } from '../AdvisorCohortAssignments';
import ActivityTab, { RecentActivity } from './ActivityTab';
import { AssignDialog, EndDialog } from './MentorDialogs';
import PlaybookEditor, { useProgramDetail } from './PlaybookEditor';
import ProgramFrame from './ProgramFrame';
import { MentorTabs } from './ProgramTabs';
import { BlockFailed, CARD, Card, ChartCard, EYE, H2, LINK, Pill, Skeleton, SUB, Tile } from './parts';
import { useMentorReads } from './useProgramReads';
import {
  ENDED_WINDOW_LINE, FOUNDERS_WAIT, HIDDEN_LINE, MENTOR_ACTIVITY_GAP, NO_MENTORS, endedInWindow, hiddenFrom,
  mentorsPerCohort, needsActions, nextCohort, noMentorsLine, sessionsFrom,
} from './programPagesModel';
import {
  ACTIVE_MENTORS_LINE, CYCLE_FIXED, ET, WITHIN_500, cohortName, coveredLine, cycleForStrip, hostsFrom, hostsLine, isFailed,
  isReady, mentorFigures, routeFor, weekLines,
} from './programsModel';

const cyclesOf = (timeline) => (isReady(timeline) && Array.isArray(timeline.data?.cycles) ? timeline.data.cycles : []);

/** PG16b: no assignment has ever been made. A failed read is never this. */
function NoMentors({ timeline, onAssign }) {
  const line = noMentorsLine(nextCohort(timeline));
  return (
    <section className={`${CARD} flex flex-col items-center gap-2 px-6 py-10 text-center`} data-testid="programs-mentor-none">
      <span aria-hidden="true" className="text-[22px] font-bold text-axal-violet dark:text-violet-300">+</span>
      <h2 className={H2}>{NO_MENTORS}</h2>
      {line ? <p className={`m-0 ${SUB}`} data-testid="programs-mentor-none-next">{line}</p> : null}
      <button type="button" className={actionPrimary} onClick={onAssign} data-testid="programs-mentor-none-assign">Assign a mentor</button>
    </section>
  );
}

function MentorOverview({ reads, phone, open }) {
  const now = Date.now();
  const f = mentorFigures(reads.assignments, reads.timeline);
  const hosts = hostsFrom(reads.hosts, now);
  const needs = needsActions(f);
  const hidden = hiddenFrom(reads.assignments);
  const ended = endedInWindow(reads.history, now);
  const perCohort = mentorsPerCohort(reads.assignments, reads.timeline);
  const failedWhat = isFailed(reads.assignments) ? 'The mentor assignments' : 'The cohort cycles';
  const tiles = f.state === 'ready'
    ? [
      { key: 'mentors', label: 'Active mentors', state: 'ready', value: f.mentors.toLocaleString('en-US'), sub: ACTIVE_MENTORS_LINE, cover: f.capped ? `Counted ${WITHIN_500} assignments.` : null },
      { key: 'covered', label: 'Cohorts covered', state: 'ready', value: f.total ? `${f.covered.toLocaleString('en-US')} of ${f.total.toLocaleString('en-US')}` : '0', sub: coveredLine(f), cover: f.capped ? `Counted ${WITHIN_500} assignments.` : null },
    ]
    : ['mentors', 'covered'].map((key) => ({ key, label: key === 'mentors' ? 'Active mentors' : 'Cohorts covered', state: f.state, reason: `${failedWhat} could not be read. That is not the same as none.` }));
  tiles.push(hidden.state === 'ready'
    ? { key: 'hidden', label: 'Founders hidden from a mentor', state: 'ready', value: hidden.text, sub: HIDDEN_LINE }
    : { key: 'hidden', label: 'Founders hidden from a mentor', state: hidden.state, reason: hidden.reason });
  tiles.push(ended.state === 'ready'
    ? { key: 'ended', label: 'Ended', state: 'ready', value: ended.text, sub: ENDED_WINDOW_LINE }
    : { key: 'ended', label: 'Ended', state: ended.state, reason: 'The access history could not be read. That is not the same as none.' });
  const none = isReady(reads.assignments) && Array.isArray(reads.assignments.data?.items) && !reads.assignments.data.items.length;
  const needsCard = (
    <Card title="Needs you" meta={f.state === 'ready' ? needs.length.toLocaleString('en-US') : null} testId="programs-mentor-needs">
      {f.state === 'loading' ? <Skeleton lines={2} /> : null}
      {f.state === 'unreadable' ? <BlockFailed what={failedWhat} onRetry={reads.reload} testId="programs-mentor-needs-unreadable" /> : null}
      {f.state === 'ready' && !needs.length ? <p className={`m-0 ${SUB}`} data-testid="programs-mentor-needs-none">Nothing here needs you now.</p> : null}
      {f.state === 'ready' && needs.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {needs.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`programs-mentor-needs-${row.key}`}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="self-start"><Pill tone="amber"><span aria-hidden="true">!</span>{row.kind}</Pill></span>
                <span className="text-[13px] leading-snug text-axal-ink dark:text-gray-100">{row.text}</span>
              </span>
              <button type="button" onClick={() => open(row.open)} className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`programs-mentor-needs-${row.key}-act`}>{row.action}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="programs-mentor-overview">
      {none ? <NoMentors timeline={reads.timeline} onAssign={() => open({ dialog: 'assign' })} /> : null}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
      </div>
      {phone ? needsCard : (
        <>
          <div className="grid gap-3.5 lg:grid-cols-2">
            <ChartCard title="Mentors per cohort" testId="programs-mentor-per-cohort" onRetry={reads.reload}
              b={perCohort.state === 'ready'
                ? { state: 'ready', chart: perCohort.rows.length ? { type: 'hbar', rows: perCohort.rows, axis: 'mentors' } : null, alt: perCohort.alt, notes: perCohort.notes, window: `Cohorts scheduled or running. ${FOUNDERS_WAIT}` }
                : { state: perCohort.state, what: failedWhat }}>
              {perCohort.state === 'ready' && !perCohort.rows.length ? <p className={`m-0 ${SUB}`}>No cohort is scheduled or running.</p> : null}
            </ChartCard>
            {needsCard}
          </div>
          <div className="grid gap-3.5 lg:grid-cols-2">
            <RecentActivity read={reads.recent} cycles={cyclesOf(reads.timeline)} gap={MENTOR_ACTIVITY_GAP} onRetry={reads.reload}
              seeAll={<Link to="/admin/programs/mentor-cohorts/activity" className={LINK} data-testid="programs-mentor-recent-all">See all</Link>} testId="programs-mentor-recent" />
            <Card title="Office-hours hosts" testId="programs-mentor-hosts">
              <p className={`m-0 ${SUB}`}>Hosts are approved on the Spin-Out Lab page.</p>
              {hosts.state === 'loading' ? <Skeleton lines={1} /> : null}
              {hosts.state === 'unreadable' ? <BlockFailed what="The office-hours hosts" onRetry={reads.reload} testId="programs-mentor-hosts-unreadable" /> : null}
              {hosts.state === 'ready' ? <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="programs-mentor-hosts-line">{hostsLine(hosts)}</span> : null}
              <Link to="/admin/programs/spinout-lab" className={`${LINK} self-start`}>Open Spin-Out Lab</Link>
            </Card>
          </div>
        </>
      )}
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

/**
 * How we measure it (item 6): mentors per cohort from Overview, founders
 * hidden (part 7) and sessions booked with a mentor (part 1), each read now.
 */
function Measures({ reads }) {
  const hidden = hiddenFrom(reads.assignments);
  const sessions = sessionsFrom(reads.sessions);
  const line = (label, node, testId) => (
    <li className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{label}</span>
      {node}
    </li>
  );
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="programs-mentor-measures">
      {line('Mentors per cohort', <span className={SUB}>Drawn on Overview, one bar per cohort scheduled or running.</span>, 'programs-mentor-measure-per-cohort')}
      {line('Founders hidden', hidden.state === 'ready'
        ? <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{`${hidden.text} now · ${HIDDEN_LINE}`}</span>
        : hidden.state === 'loading' ? <Skeleton lines={1} /> : <BlockFailed what="Founders hidden" onRetry={reads.reload} />, 'programs-mentor-measure-hidden')}
      {line('Sessions booked with a mentor', sessions.state === 'ready' ? (
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{`${sessions.total.toLocaleString('en-US')} across the ${sessions.rows.length} newest cohorts`}</span>
          {sessions.rows.filter((r) => r.mentors).slice(0, 4).map((r) => <span key={r.key} className={SUB}>{`${r.label}: ${r.sessions.toLocaleString('en-US')}`}</span>)}
          {sessions.rule ? <span className={SUB}>{sessions.rule}</span> : null}
        </span>
      ) : sessions.state === 'loading' ? <Skeleton lines={1} /> : <BlockFailed what="Sessions booked with a mentor" onRetry={reads.reload} />, 'programs-mentor-measure-sessions')}
    </ul>
  );
}

function MentorHowItRuns({ reads, superAdmin }) {
  const fill = (key, section) => {
    if (key === 'cycle') return <CycleStrip timeline={reads.timeline} onRetry={reads.reload} />;
    if (key === 'measure') return <Measures reads={reads} />;
    if (key === 'terms') {
      return (
        <div className="flex flex-col gap-1">
          {section.templates.length
            ? <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="programs-mentor-terms-templates">{`Linked templates: ${section.templates.join(', ')}`}</p>
            : <p className="m-0 text-[13.5px] text-axal-ink dark:text-gray-100" data-testid="programs-mentor-terms-none">No contract template is linked to this program yet.</p>}
          <Link to="/admin/contracts?tab=templates" className={`${LINK} self-start`}>Open contract templates</Link>
        </div>
      );
    }
    return null;
  };
  return <PlaybookEditor program="mentor-cohorts" superAdmin={superAdmin} detail={reads.detail} fill={fill} testId="programs-mentor-how" />;
}

function MentorBody() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const phone = usePhoneWidth();
  const { tab } = routeFor(pathname);
  const reads = useMentorReads(tab);
  const detail = useProgramDetail('mentor-cohorts', tab === 'how');
  const [dialog, setDialog] = useState(null);
  const [writes, setWrites] = useState(0);
  const changed = () => { setWrites((w) => w + 1); reads.reload(); };
  const cycles = cyclesOf(reads.timeline);
  const cohortOf = (r) => { const c = cycles.find((x) => Number(x.id) === Number(r.cohort_cycle_id)); return c ? cohortName(c) : `Cycle #${r.cohort_cycle_id}`; };
  const open = (o) => setDialog(o);
  return (
    <ProgramFrame
      program="mentor-cohorts"
      superAdmin={superAdmin}
      actionsOnPhone={false}
      actions={<button type="button" onClick={() => open({ dialog: 'assign' })} className={`${actionPrimary} w-full sm:w-auto`} data-testid="programs-mentor-assign">Assign a mentor</button>}
      tabs={<MentorTabs />}
    >
      {tab === 'overview' ? <MentorOverview reads={reads} phone={phone} open={open} /> : null}
      {tab === 'how' ? <MentorHowItRuns reads={{ ...reads, detail }} superAdmin={superAdmin} /> : null}
      {tab === 'people' ? <AdvisorCohortAssignmentsBody embedded onChanged={reads.reload} refresh={writes} /> : null}
      {tab === 'activity' ? <ActivityTab program="mentor-cohorts" cycles={cycles} gap={MENTOR_ACTIVITY_GAP} testId="programs-mentor-activity" /> : null}
      {dialog?.dialog === 'assign' ? <AssignDialog assignments={reads.assignments} timeline={reads.timeline} cycleId={dialog.cycleId || null} onClose={() => setDialog(null)} onAssigned={changed} /> : null}
      {dialog?.dialog === 'end' ? <EndDialog row={dialog.row} cohort={cohortOf(dialog.row)} onClose={() => setDialog(null)} onEnded={changed} /> : null}
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
