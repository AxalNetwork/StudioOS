import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RailFrame, WorkerRail } from '../../ui';
import { titleCase } from '../../lib/absence';
import CourseOutline, { CourseResources } from './CourseOutline';
import LessonPlayer from './LessonPlayer';
import MyLearning from './MyLearning';
import { LearningEmpty, LearningHeader, NotLiveYet, SectionCard } from './LearningStates';
import { NOT_LIVE, findLesson, lessonHref, lessonKindLabel, videoPlayback } from './learningModel';
import { markItemComplete, markLessonComplete, readCourse, readItem, readMe } from './learningReads';
import useLearningRead from './useLearningRead';

/**
 * The learner pages that read the Learning store (D562 stage 2, D557's
 * routes): a course, a lesson, a standalone video or reading, and My
 * learning. Each is a pure view drawn from a read's state, and a container
 * that makes the read; the coming-soon gate is applied before any of them is
 * mounted (`LearningPage.jsx`), so a gated profile never reads at all.
 */

const LEARNING = { to: '/learning', label: 'Learning' };

/** A read's state as the status a component draws: a 404 is "ready, with nothing to show". */
export const statusOf = (state) => (state.status === 'missing' ? 'ready' : state.status === 'idle' ? 'loading' : state.status);

function LearnerRail({ coverage }) {
  return (
    <WorkerRail
      workspace="Learning"
      // Violet, the founder accent: the canvas draws the learner's Learning
      // in #7c3aed for every profile it serves.
      role="founder"
      stance="Read-only learning view"
      note="Eadwyn reads back what this page has loaded, on a click. It does not mark progress, register you, submit an answer or sit an exam."
      coverage={coverage}
    />
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the rail says a course page loaded: only what the read returned. */
export function courseCoverage(state) {
  if (state.status !== 'ready') return [];
  const lessons = (state.modules || []).reduce((n, m) => n + (m.lessons || []).length, 0);
  const p = state.progress;
  return [
    `${plural(state.modules.length, 'module')} and ${plural(lessons, 'lesson')} in “${state.course.title}”`,
    p && Number(p.required) ? `${p.completed} of ${plural(Number(p.required), 'required lesson')} completed` : null,
  ].filter(Boolean);
}

// ── /learning/courses/:slug ───────────────────────────────────────────────

export function CourseView({ state, onRetry }) {
  const course = state.status === 'ready' ? state.course : null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]" data-testid="course-view">
      <CourseOutline status={statusOf(state)} course={course} modules={state.modules || []} progress={state.progress} onRetry={onRetry} />
      {course && (
        <div className="space-y-4">
          <CourseResources status="ready" resources={course.resources} />
          <SectionCard title="Certificate" testid="course-certificate">
            <NotLiveYet line="Certificates are not issued for courses yet." testid="course-certificate-line" />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

export function CoursePage({ slug }) {
  const [state, retry] = useLearningRead(() => readCourse(slug), [slug], { scope: 'course' });
  const course = state.status === 'ready' ? state.course : null;
  return (
    <RailFrame rail={<LearnerRail coverage={courseCoverage(state)} />} data-testid="learning-course">
      <div className="space-y-4">
        <LearningHeader title={course?.title || 'Course'} sub={course?.summary || undefined} back={LEARNING} />
        <CourseView state={state} onRetry={retry} />
      </div>
    </RailFrame>
  );
}

// ── /learning/courses/:slug/:lesson ───────────────────────────────────────

/** A lesson that opens somewhere else: an event (a webinar lesson) or an exercise or exam. */
function LessonElsewhere({ lesson, slug }) {
  const href = lessonHref(slug, lesson);
  if (lesson.kind === 'webinar') {
    return (
      <SectionCard title={lesson.title || 'Webinar'} testid="lesson-elsewhere">
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">This lesson is a live event.</p>
        {href && <Link to={href} className="mt-2 inline-flex text-[12.5px] font-semibold text-axal-violet-deep underline dark:text-violet-300">Open the event</Link>}
      </SectionCard>
    );
  }
  return (
    <SectionCard title={lesson.title || lessonKindLabel(lesson.kind)} testid="lesson-elsewhere">
      <NotLiveYet line={lesson.kind === 'exam' ? NOT_LIVE.exams : NOT_LIVE.exercises} />
    </SectionCard>
  );
}

export function LessonView({ courseState, itemState, lessonUid, onMark, marking, markError, onRetryCourse, onRetryItem }) {
  const course = courseState.status === 'ready' ? courseState.course : null;
  const found = course ? findLesson(courseState.modules, lessonUid) : null;
  const step = (l) => (l ? { title: l.title, href: lessonHref(course.slug, l) } : null);
  let main;
  if (statusOf(courseState) !== 'ready') {
    main = <LessonPlayer status={statusOf(courseState)} onRetry={onRetryCourse} />;
  } else if (!found) {
    main = <LessonPlayer status="ready" lesson={null} item={null} />;
  } else if (found.lesson.kind !== 'video' && found.lesson.kind !== 'reading') {
    main = <LessonElsewhere lesson={found.lesson} slug={course.slug} />;
  } else if (statusOf(itemState) !== 'ready') {
    main = <LessonPlayer status={statusOf(itemState)} onRetry={onRetryItem} />;
  } else if (itemState.status === 'missing') {
    main = (
      <SectionCard title={found.lesson.title || 'Lesson'} testid="lesson-player">
        <LearningEmpty title="Not available" body="The video or reading this lesson opens is not published." />
      </SectionCard>
    );
  } else {
    const item = itemState.item;
    main = (
      <LessonPlayer
        status="ready"
        lesson={found.lesson}
        item={item}
        video={videoPlayback(item)}
        transcript={item.transcript}
        moduleTitle={found.lesson.module?.title}
        position={`${found.index + 1} of ${found.total}`}
        prev={step(found.prev)}
        next={step(found.next)}
        completed={found.lesson.progress?.status === 'completed'}
        onMarkComplete={onMark}
        marking={marking}
        markError={markError}
      />
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]" data-testid="lesson-view">
      <div className="min-w-0">{main}</div>
      <div className="space-y-4">
        <CourseOutline compact status={statusOf(courseState)} course={course} modules={courseState.modules || []} currentLessonUid={lessonUid} onRetry={onRetryCourse} />
        {course && <CourseResources status="ready" resources={course.resources} />}
      </div>
    </div>
  );
}

/**
 * The item read as this lesson may draw it. Moving to the next lesson renders
 * once before its item is asked for, so a reply for another item is "loading"
 * here: the last lesson's video is never drawn under this one's title.
 */
export function itemFor(state, uid) {
  return state?.status === 'ready' && state.item?.uid !== uid ? { status: 'loading' } : state;
}

export function LessonPage({ slug, lessonUid }) {
  const [courseState, retryCourse, setCourseState] = useLearningRead(() => readCourse(slug), [slug], { scope: 'lesson-course' });
  const found = courseState.status === 'ready' ? findLesson(courseState.modules, lessonUid) : null;
  const refUid = found && (found.lesson.kind === 'video' || found.lesson.kind === 'reading') ? found.lesson.ref_uid : null;
  const [itemRead, retryItem] = useLearningRead(() => readItem(refUid), [refUid], { enabled: Boolean(refUid), scope: 'lesson-item' });
  const itemState = itemFor(itemRead, refUid);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState('');
  useEffect(() => { setMarkError(''); }, [lessonUid]);
  const onMark = async () => {
    setMarking(true);
    setMarkError('');
    try {
      const fresh = await markLessonComplete({ course: courseState.course, lessonUid, slug });
      setCourseState({ status: 'ready', ...fresh });
    } catch (err) {
      setMarkError(err?.message || 'Your progress could not be saved.');
    } finally {
      setMarking(false);
    }
  };
  const course = courseState.status === 'ready' ? courseState.course : null;
  return (
    <RailFrame rail={<LearnerRail coverage={courseCoverage(courseState)} />} data-testid="learning-lesson">
      <div className="space-y-4">
        <LearningHeader
          title={found?.lesson.title || 'Lesson'}
          sub={course ? [course.title, found?.lesson.module?.title].filter(Boolean).join(' · ') : undefined}
          back={{ to: `/learning/courses/${encodeURIComponent(slug)}`, label: course?.title || 'Course' }}
        />
        <LessonView
          courseState={courseState} itemState={itemState} lessonUid={lessonUid}
          onMark={onMark} marking={marking} markError={markError} onRetryCourse={retryCourse} onRetryItem={retryItem}
        />
      </div>
    </RailFrame>
  );
}

// ── /learning/videos/:uid and /learning/items/:uid ────────────────────────

export function ItemView({ state, onRetry, onMark, marking, markError }) {
  if (state.status === 'missing') {
    return (
      <SectionCard title="Not available" testid="lesson-player">
        <LearningEmpty title="No such video or reading" body="It does not exist, or it is not published." cta={{ label: 'Back to Learning', to: '/learning' }} />
      </SectionCard>
    );
  }
  const item = state.status === 'ready' ? state.item : null;
  return (
    <LessonPlayer
      status={statusOf(state)}
      lesson={null}
      item={item}
      video={videoPlayback(item)}
      transcript={item?.transcript ?? null}
      completed={state.progress?.status === 'completed'}
      onMarkComplete={item ? onMark : undefined}
      marking={marking}
      markError={markError}
      onRetry={onRetry}
    />
  );
}

export function ItemPage({ uid }) {
  const [state, retry, setState] = useLearningRead(() => readItem(uid), [uid], { scope: 'item' });
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState('');
  const onMark = async () => {
    setMarking(true);
    setMarkError('');
    try {
      const progress = await markItemComplete(uid);
      setState((s) => ({ ...s, progress }));
    } catch (err) {
      setMarkError(err?.message || 'Your progress could not be saved.');
    } finally {
      setMarking(false);
    }
  };
  const item = state.status === 'ready' ? state.item : null;
  return (
    <RailFrame rail={<LearnerRail coverage={item ? [`One ${item.kind}: “${item.title}”`] : []} />} data-testid="learning-item">
      <div className="space-y-4">
        <LearningHeader
          eyebrow={item ? `Learning · ${titleCase(item.kind)}` : 'Learning'}
          title={item?.title || 'Video'}
          sub={item?.summary || undefined}
          back={LEARNING}
        />
        <ItemView state={state} onRetry={retry} onMark={onMark} marking={marking} markError={markError} />
      </div>
    </RailFrame>
  );
}

// ── /learning/me ──────────────────────────────────────────────────────────

/** My learning from `GET /api/learning/me`; exercises and exams wait on #1160. */
export function MeView({ state, onRetry }) {
  return (
    <MyLearning
      progress={{
        status: statusOf(state),
        data: state.status === 'ready' ? { in_progress: state.in_progress, completed: state.completed } : null,
        onRetry,
      }}
    />
  );
}

export function MePage({ sub }) {
  const [state, retry] = useLearningRead(readMe, [], { scope: 'me' });
  const coverage = state.status === 'ready'
    ? [`${state.in_progress.length} started and ${state.completed.length} completed`]
    : [];
  return (
    <RailFrame rail={<LearnerRail coverage={coverage} />} data-testid="learning-me">
      <div className="space-y-4">
        <LearningHeader title="My learning" sub={sub} back={LEARNING} />
        <MeView state={state} onRetry={retry} />
      </div>
    </RailFrame>
  );
}
