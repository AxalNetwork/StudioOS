import React from 'react';
import { useParams } from 'react-router-dom';
import { RailFrame, WorkerRail } from '../../ui';
import { isSuperAdminUser } from '../../lib/shellRole';
import { COMING_SOON_LINE, learningComingSoon } from './learningAccess';
import { ComingSoonCard, LearningHeader } from './LearningStates';
import LearningHome from './LearningHome';
import { CoursePage, ItemPage, LessonPage, MePage } from './LearningWired';
import LearningStudio from './LearningStudio';
import { ExamPage, ExercisePage } from './LearningAssessments';
import { ProgramPage, ProgramsPage } from './LearningPrograms';
import { StudioProgramPage, StudioProgramsPage } from './ProgramStudio';
import { WebinarPage } from './LearningWebinars';

/**
 * Every Learning route renders this page (D562), one `view` per route in
 * `frontend/src/routes/learning.jsx`:
 *
 *   home            /learning                                  every signed-in profile but exploring
 *   course          /learning/courses/:slug                    "            reads D557
 *   lesson          /learning/courses/:slug/:lesson            "            reads D557 (and D559's links)
 *   item            /learning/videos/:uid, /learning/items/:uid "           reads D557, plays D561's uploads
 *   webinar         /learning/webinars/:slug                   "            reads and registers, D560
 *   exercise        /learning/exercises/:slug                  "            reads and submits, D559
 *   exam            /learning/exams/:slug                      "            reads and sits, D559
 *   me              /learning/me                               "            reads D557
 *   programs        /learning/programs                         admin        reads D558
 *   program         /learning/programs/:program                admin        reads D558
 *   studio          /learning/studio                           Super Admin  reads and writes D557, D559, D560, D561
 *   studioPrograms  /learning/studio/programs                  Super Admin  reads and writes D558
 *   studioProgram   /learning/studio/programs/:program         Super Admin  reads and writes D558
 *
 * The `:slug` of a webinar, an exercise and an exam carries its uid: D559 and
 * D560 name them by uid (D562 departure 8).
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
 * Every view, wired to its store: D557's in stage 2, and in stage 3 D558's
 * programs, D559's exercises and exams and D560's webinars. Each renders its
 * own frame, because its header and its rail come from what it read. A page
 * is keyed by what it reads, so moving to another course, item, webinar,
 * exercise, exam or program starts from "loading" rather than drawing the
 * last one's reply for a frame; a lesson keeps its course's read and swaps
 * only the item.
 */
const WIRED = {
  course: ({ params }) => <CoursePage key={params.slug} slug={params.slug} />,
  lesson: ({ params }) => <LessonPage key={params.slug} slug={params.slug} lessonUid={params.lesson} />,
  item: ({ params }) => <ItemPage key={params.uid} uid={params.uid} />,
  webinar: ({ params }) => <WebinarPage key={params.slug} uid={params.slug} />,
  exercise: ({ params }) => <ExercisePage key={params.slug} uid={params.slug} />,
  exam: ({ params }) => <ExamPage key={params.slug} uid={params.slug} />,
  me: ({ config }) => <MePage sub={config.sub} />,
  programs: ({ config }) => <ProgramsPage sub={config.sub} />,
  program: ({ params, config }) => <ProgramPage key={params.program} uid={params.program} sub={config.sub} />,
  studio: ({ config }) => <LearningStudio sub={config.sub} />,
  studioPrograms: ({ config }) => <StudioProgramsPage sub={config.sub} />,
  studioProgram: ({ params, config }) => <StudioProgramPage key={params.program} uid={params.program} sub={config.sub} />,
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

/**
 * The rail beside the coming-soon card, with a literal accent per tier:
 * violet for learners, steel for an admin, oxblood for HQ. An admin browsing
 * as a held profile ("View as") can stand on an admin route and see the card.
 */
function SubPageRail({ tier }) {
  const unavailable = [['Courses, videos, webinars and more', COMING_SOON_LINE]];
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

/** Any Learning route but the home: its wired view, or, for a profile the gate holds, the coming-soon card in place. */
export function LearningSubPage({ view, gated }) {
  const params = useParams();
  const config = LEARNING_VIEWS[view];
  const Wired = WIRED[view];
  if (!config || !Wired) return null;
  if (!gated) return <Wired params={params} config={config} />;
  return (
    <RailFrame rail={<SubPageRail tier={config.tier} />} data-testid={`learning-${view}`}>
      <div className="space-y-4">
        <LearningHeader title={config.title} sub={config.sub} back={config.back(params)} />
        <ComingSoonCard />
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
