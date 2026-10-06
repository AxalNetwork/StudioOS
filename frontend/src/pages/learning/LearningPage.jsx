import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkerRail } from '../../ui';
import { isSuperAdminUser } from '../../lib/shellRole';
import { COMING_SOON_LINE, learningComingSoon } from './learningAccess';
import { NOT_LIVE } from './learningModel';
import { ComingSoonCard, LearningFrame, LearningHeader, NotLiveYet, SectionCard } from './LearningStates';
import LearningHome from './LearningHome';
import CourseOutline from './CourseOutline';
import LessonPlayer from './LessonPlayer';
import WebinarPanel from './WebinarPanel';
import ExercisePanel from './ExercisePanel';
import ExamFlow from './ExamFlow';
import MyLearning from './MyLearning';
import ProgramLearnersTable, { LearnerRecord, ReadOnlyStrip } from './ProgramLearnersTable';
import StudioContentTable from './StudioContentTable';
import ProgramsTable from './ProgramsTable';
import ProgramDetail from './ProgramDetail';

/**
 * Every Learning route renders this page (D562), one `view` per route in
 * `frontend/src/routes/learning.jsx`:
 *
 *   home            /learning                                  every signed-in profile
 *   course          /learning/courses/:slug                    "
 *   lesson          /learning/courses/:slug/:lesson            "
 *   webinar         /learning/webinars/:slug                   "
 *   exercise        /learning/exercises/:slug                  "
 *   exam            /learning/exams/:slug                      "
 *   me              /learning/me                               "
 *   programs        /learning/programs                         admin (the assigned admin's list)
 *   program         /learning/programs/:program                admin (read-only)
 *   studio          /learning/studio                           Super Admin
 *   studioPrograms  /learning/studio/programs                  Super Admin
 *   studioProgram   /learning/studio/programs/:program         Super Admin
 *
 * THE COMING-SOON GATE (`learningAccess.js`, temporary, owner's request of
 * 2026-10-06). A gated profile on the home keeps Articles; on any other
 * Learning route it sees the same coming-soon card IN PLACE, at the URL it
 * asked for, rather than being redirected: a shared link to a course says what
 * is going on where it lands, and a redirect to the home would look like a
 * broken link. The admin and Super Admin routes are guarded to those roles in
 * the route module, so a gated profile never reaches them at all.
 *
 * NO LEARNING CLIENT EXISTS YET. #1158 adds `lib/api/learning.js`, and #1159
 * to #1162 extend it. Until a surface's client lands it is drawn in its
 * "Not recorded" state with the line that says which store it waits on, and
 * nothing here calls a route that does not exist.
 */

const LEARNING = { to: '/learning', label: 'Learning' };

/** One entry per view: who it is for, and the header the canvas draws. */
export const LEARNING_VIEWS = {
  course: { tier: 'member', title: 'Course', back: () => LEARNING },
  lesson: { tier: 'member', title: 'Lesson', back: (p) => (p.slug ? { to: `/learning/courses/${encodeURIComponent(p.slug)}`, label: 'Course' } : LEARNING) },
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
    sub: 'Author videos, courses, webinars, exercises and exams. Only a Super Admin sees this page.',
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

/** A card the canvas draws for something no planned store holds. */
function NotStored({ title, line, testid }) {
  return (
    <SectionCard title={title} testid={testid}>
      <NotLiveYet line={line} testid={`${testid}-line`} />
    </SectionCard>
  );
}

/** What each view draws for a profile the gate admits, until its store merges. */
export function ViewBody({ view }) {
  switch (view) {
    case 'course':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <CourseOutline status="unrecorded" reason={NOT_LIVE.catalogue} />
          <div className="space-y-4">
            <NotStored title="Certificate" line="Certificates are not issued for courses yet." testid="course-certificate" />
            <NotStored title="Resources" line="Course resources are not stored yet." testid="course-resources" />
          </div>
        </div>
      );
    case 'lesson':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <LessonPlayer status="unrecorded" reason={NOT_LIVE.catalogue} />
          <CourseOutline compact status="unrecorded" reason={NOT_LIVE.catalogue} />
        </div>
      );
    case 'webinar':
      return <WebinarPanel status="unrecorded" reason={NOT_LIVE.webinars} />;
    case 'exercise':
      return <ExercisePanel status="unrecorded" reason={NOT_LIVE.exercises} />;
    case 'exam':
      return <ExamFlow status="unrecorded" reason={NOT_LIVE.exams} />;
    case 'me':
      return <MyLearning />;
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
    case 'studio':
      return (
        <>
          <StudioContentTable status="unrecorded" reason={NOT_LIVE.studio} />
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
            <Link to="/learning/studio/programs" className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300" data-testid="link-studio-programs">
              Regional programs
            </Link>
            {' '}group this content for a region, with their admins and members.
          </p>
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
  studio: <WaitingAction label="New content" reason={NOT_LIVE.studio} testid="button-studio-new" />,
  studioPrograms: <WaitingAction label="New program" reason={NOT_LIVE.programs} testid="button-program-new" />,
};

/** The rail, with a literal accent per tier: violet for learners, steel for an admin, oxblood for HQ. */
function SubPageRail({ tier, gated }) {
  const unavailable = gated
    ? [['Courses, videos, webinars and more', COMING_SOON_LINE]]
    : [['This page’s records', 'The Learning service is not live yet, so this page has nothing loaded to read back.']];
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

/** Any Learning route but the home: its header, then its body or the coming-soon card. */
export function LearningSubPage({ view, gated }) {
  const params = useParams();
  const config = LEARNING_VIEWS[view];
  if (!config) return null;
  return (
    <LearningFrame testid={`learning-${view}`} rail={<SubPageRail tier={config.tier} gated={gated} />}>
      <LearningHeader title={config.title} sub={config.sub} back={config.back(params)} action={gated ? null : HEADER_ACTION[view]} />
      {gated ? <ComingSoonCard /> : <ViewBody view={view} />}
    </LearningFrame>
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
