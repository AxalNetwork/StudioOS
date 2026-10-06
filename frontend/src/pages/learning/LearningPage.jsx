import React from 'react';
import { useParams } from 'react-router-dom';
import { RailFrame, WorkerRail } from '../../ui';
import { isSuperAdminUser } from '../../lib/shellRole';
import { COMING_SOON_LINE, learningComingSoon } from './learningAccess';
import { NOT_LIVE } from './learningModel';
import { ComingSoonCard, LearningHeader } from './LearningStates';
import LearningHome from './LearningHome';
import { CoursePage, ItemPage, LessonPage, MePage } from './LearningWired';
import LearningStudio from './LearningStudio';
import WebinarPanel from './WebinarPanel';
import ExercisePanel from './ExercisePanel';
import ExamFlow from './ExamFlow';
import ProgramLearnersTable, { LearnerRecord, ReadOnlyStrip } from './ProgramLearnersTable';
import ProgramsTable from './ProgramsTable';
import ProgramDetail from './ProgramDetail';

/**
 * Every Learning route renders this page (D562), one `view` per route in
 * `frontend/src/routes/learning.jsx`:
 *
 *   home            /learning                                  every signed-in profile but exploring
 *   course          /learning/courses/:slug                    "            reads D557
 *   lesson          /learning/courses/:slug/:lesson            "            reads D557
 *   item            /learning/videos/:uid, /learning/items/:uid "           reads D557
 *   webinar         /learning/webinars/:slug                   "            waits on #1161
 *   exercise        /learning/exercises/:slug                  "            waits on #1160
 *   exam            /learning/exams/:slug                      "            waits on #1160
 *   me              /learning/me                               "            reads D557
 *   programs        /learning/programs                         admin        waits on #1159
 *   program         /learning/programs/:program                admin        waits on #1159
 *   studio          /learning/studio                           Super Admin  reads and writes D557
 *   studioPrograms  /learning/studio/programs                  Super Admin  waits on #1159
 *   studioProgram   /learning/studio/programs/:program         Super Admin  waits on #1159
 *
 * THE COMING-SOON GATE (`learningAccess.js`, temporary, owner's request of
 * 2026-10-06) is applied here, before any view mounts, so a gated profile
 * never makes a Learning read. On the home it keeps Articles; on any other
 * Learning route it sees the same coming-soon card IN PLACE, at the URL it
 * asked for, rather than being redirected: a shared link to a course says what
 * is going on where it lands, and a redirect to the home would look like a
 * broken link. The admin and Super Admin routes are guarded to those roles in
 * the route module, so a gated profile never reaches them at all.
 */

const LEARNING = { to: '/learning', label: 'Learning' };

/** One entry per view: who it is for, and the header the canvas draws. */
export const LEARNING_VIEWS = {
  course: { tier: 'member', title: 'Course', back: () => LEARNING },
  lesson: { tier: 'member', title: 'Lesson', back: (p) => (p.slug ? { to: `/learning/courses/${encodeURIComponent(p.slug)}`, label: 'Course' } : LEARNING) },
  item: { tier: 'member', title: 'Video', back: () => LEARNING },
  webinar: { tier: 'member', title: 'Webinar', back: () => LEARNING },
  exercise: { tier: 'member', title: 'Exercise', back: () => LEARNING },
  exam: { tier: 'member', title: 'Exam', back: () => LEARNING },
  me: { tier: 'member', title: 'My learning', sub: 'Everything you have started, finished, submitted or sat.', back: () => LEARNING },
  programs: { tier: 'admin', title: 'Programs', sub: 'Programs a Super Admin has assigned to you.', back: () => LEARNING },
  program: {
    tier: 'admin', title: 'Program',
    sub: 'Read-only. What each enrolled member has completed in the content a Super Admin assigned to you.',
    back: () => ({ to: '/learning/programs', label: 'Programs' }),
  },
  studio: {
    tier: 'super', title: 'Learning studio',
    sub: 'Author videos, readings and courses. Only a Super Admin sees this page.',
    back: () => LEARNING,
  },
  studioPrograms: {
    tier: 'super', title: 'Regional programs',
    sub: 'Programs group content for a region. Assign admins and enrol members here.',
    back: () => ({ to: '/learning/studio', label: 'Learning studio' }),
  },
  studioProgram: {
    tier: 'super', title: 'Program',
    sub: 'Content in order, assigned admins and members.',
    back: () => ({ to: '/learning/studio/programs', label: 'Regional programs' }),
  },
};

/**
 * The views that read the Learning store (stage 2). Each renders its own
 * frame, because its header and its rail come from what it read. A page is
 * keyed by what it reads, so moving to another course or item starts from
 * "loading" rather than drawing the last one's reply for a frame; a lesson
 * keeps its course's read and swaps only the item.
 */
const WIRED = {
  course: ({ params }) => <CoursePage key={params.slug} slug={params.slug} />,
  lesson: ({ params }) => <LessonPage key={params.slug} slug={params.slug} lessonUid={params.lesson} />,
  item: ({ params }) => <ItemPage key={params.uid} uid={params.uid} />,
  me: ({ config }) => <MePage sub={config.sub} />,
  studio: ({ config }) => <LearningStudio sub={config.sub} />,
};

/** The links an admin gets on the home, since the sidebar entries are #1164's. */
export function adminLinks(user, activeRole, gated) {
  if (gated || activeRole !== 'admin') return [];
  return [
    { to: '/learning/me', label: 'My learning' },
    { to: '/learning/programs', label: 'Programs assigned to you' },
    ...(isSuperAdminUser(user) ? [{ to: '/learning/studio', label: 'Learning studio' }] : []),
  ];
}

const DISABLED_ACTION = 'cursor-not-allowed rounded-axal-sm bg-axal-violet px-3.5 py-2 text-[13px] font-semibold text-white opacity-50';

/** A write the canvas draws in the header, held until its route exists. */
function WaitingAction({ label, reason, testid }) {
  return <button type="button" disabled title={reason} className={DISABLED_ACTION} data-testid={testid}>{label}</button>;
}

/** What each view that waits on a store draws for a profile the gate admits. */
export function ViewBody({ view }) {
  switch (view) {
    case 'webinar':
      return <WebinarPanel status="unrecorded" reason={NOT_LIVE.webinars} />;
    case 'exercise':
      return <ExercisePanel status="unrecorded" reason={NOT_LIVE.exercises} />;
    case 'exam':
      return <ExamFlow status="unrecorded" reason={NOT_LIVE.exams} />;
    case 'programs':
      return <ProgramsTable scope="assigned" status="unrecorded" reason={NOT_LIVE.programs} />;
    case 'program':
      return (
        <>
          <ReadOnlyStrip />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <ProgramLearnersTable status="unrecorded" reason={NOT_LIVE.programs} />
            <LearnerRecord status="unrecorded" reason={NOT_LIVE.programs} />
          </div>
        </>
      );
    case 'studioPrograms':
      return <ProgramsTable scope="studio" status="unrecorded" reason={NOT_LIVE.programs} />;
    case 'studioProgram':
      return <ProgramDetail status="unrecorded" reason={NOT_LIVE.programs} />;
    default:
      return null;
  }
}

const HEADER_ACTION = {
  studioPrograms: <WaitingAction label="New program" reason={NOT_LIVE.programs} testid="button-program-new" />,
};

/** The rail, with a literal accent per tier: violet for learners, steel for an admin, oxblood for HQ. */
function SubPageRail({ tier, gated }) {
  const unavailable = gated
    ? [['Courses, videos, webinars and more', COMING_SOON_LINE]]
    : [['This page’s records', 'The store this page reads is not live yet, so this page has nothing loaded to read back.']];
  if (tier === 'super') {
    return (
      <WorkerRail
        workspace="Learning studio"
        role="super_admin"
        stance="Authoring view"
        note="Eadwyn reads back what this page has loaded. It does not publish, assign, enrol or edit anything: every write here is the Super Admin’s own."
        unavailable={unavailable}
      />
    );
  }
  if (tier === 'admin') {
    return (
      <WorkerRail
        workspace="Learning programs"
        role="admin"
        stance="Read-only program view"
        note="Eadwyn reads back what this page has loaded. A program view writes nothing: content and enrolment are managed at HQ."
        unavailable={unavailable}
      />
    );
  }
  return (
    <WorkerRail
      workspace="Learning"
      role="founder"
      stance="Read-only learning view"
      note="Eadwyn reads back what this page has loaded, on a click. It does not mark progress, register you, submit an answer or sit an exam."
      unavailable={unavailable}
    />
  );
}

/** Any Learning route but the home: the coming-soon card, a wired view, or a view waiting on its store. */
export function LearningSubPage({ view, gated }) {
  const params = useParams();
  const config = LEARNING_VIEWS[view];
  if (!config) return null;
  const Wired = WIRED[view];
  if (!gated && Wired) return <Wired params={params} config={config} />;
  return (
    <RailFrame rail={<SubPageRail tier={config.tier} gated={gated} />} data-testid={`learning-${view}`}>
      <div className="space-y-4">
        <LearningHeader title={config.title} sub={config.sub} back={config.back(params)} action={gated ? null : HEADER_ACTION[view]} />
        {gated ? <ComingSoonCard /> : <ViewBody view={view} />}
      </div>
    </RailFrame>
  );
}

/**
 * The page. `user` and `activeRole` come from the route module's
 * `routeTools`: the role is the one being browsed, so an admin using
 * "View as" sees what that profile sees.
 */
export default function LearningPage({ view = 'home', user, activeRole }) {
  const gated = learningComingSoon(user, activeRole ?? user?.role);
  if (view === 'home') return <LearningHome gated={gated} links={adminLinks(user, activeRole ?? user?.role, gated)} />;
  return <LearningSubPage view={view} gated={gated} />;
}
