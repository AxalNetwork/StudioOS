import React from 'react';
import { Link } from 'react-router-dom';
import { Check, CirclePlay, FileText, ListChecks, PenLine, Radio } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import {
  NOT_LIVE, byPosition, courseProgress, durationLabel, lessonDone, lessonHref, lessonKindLabel, minutesLabel, totalSeconds,
} from './learningModel';

/** One icon per lesson kind, so the kind reads at a glance; the label says it in words. */
export const LESSON_ICON = { video: CirclePlay, reading: FileText, exercise: PenLine, exam: ListChecks, webinar: Radio };

/**
 * A course's outline: its modules in order, then each module's lessons, each
 * with a kind icon, a length and a tick once completed (D562; data #1158).
 *
 * Props, in the shape #1158 plans for `GET /api/learning/courses/:slug`:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   course    { slug, title, level, estimated_minutes }
 *   modules   [{ uid, title, position, lessons: [{ uid, title, position, kind,
 *               ref_uid, required, duration_seconds, progress: { status } }] }]
 *   reason    the line `unrecorded` shows; onRetry for `unreadable`
 *   compact   the lesson player's side outline: no summary, the current lesson marked
 *   currentLessonUid
 *
 * A LESSON'S LENGTH IS NOT A LESSONS COLUMN. #1158 gives `duration_seconds` to
 * a video item, and nothing to a reading or an exercise, so a lesson with no
 * length says "Length not recorded", and a module totals its lessons only when
 * every one of them has a length.
 */
export default function CourseOutline({
  status, course, modules, reason = NOT_LIVE.catalogue, onRetry, compact = false, currentLessonUid,
}) {
  const ordered = byPosition(modules).map((m) => ({ ...m, lessons: byPosition(m?.lessons) }));
  const progress = courseProgress(ordered);
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the course outline',
    claim: 'This is not a claim that the course has no lessons.',
    isEmpty: progress.total === 0,
    empty: { title: 'No lessons yet', body: 'This course has no lessons published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  const meta = status === 'ready' && progress.total
    ? `${ordered.length} module${ordered.length === 1 ? '' : 's'} · ${progress.total} lesson${progress.total === 1 ? '' : 's'}`
    : null;
  return (
    <SectionCard title={compact ? 'Course outline' : 'Outline'} meta={meta} testid="course-outline">
      {block || (
        <>
          {!compact && <CourseSummary course={course} modules={ordered} progress={progress} />}
          <ol className="space-y-4" data-testid="course-modules">
            {ordered.map((m, index) => (
              <CourseModule key={m.uid || index} module={m} index={index} slug={course?.slug} compact={compact} currentLessonUid={currentLessonUid} />
            ))}
          </ol>
        </>
      )}
    </SectionCard>
  );
}

function CourseSummary({ course, modules, progress }) {
  const level = course?.level ? titleCase(course.level) : null;
  const length = minutesLabel(course?.estimated_minutes);
  // The first lesson not yet ticked is where "Continue" goes.
  const next = modules.flatMap((m) => m.lessons).find((l) => !lessonDone(l));
  const nextHref = next ? lessonHref(course?.slug, next) : null;
  return (
    <div className="mb-4 space-y-3 border-b border-axal-hairline pb-4 dark:border-gray-800" data-testid="course-summary">
      <div className="flex flex-wrap gap-1.5">
        {level ? <Pill tone="neutral">{level}</Pill> : <Pill tone="neutral"><Unrecorded>Level not recorded</Unrecorded></Pill>}
        {length ? <Pill tone="neutral">{length}</Pill> : <Pill tone="neutral"><Unrecorded>Length not recorded</Unrecorded></Pill>}
        <Pill tone="neutral">{progress.total} lesson{progress.total === 1 ? '' : 's'}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800"
          role="progressbar"
          aria-label="Course progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent ?? 0}
        >
          <div className="h-full rounded-full bg-axal-violet" style={{ width: `${progress.percent ?? 0}%` }} />
        </div>
        <span className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-course-progress">
          {progress.percent}% · {progress.done} of {progress.total} lessons
        </span>
        {nextHref && (
          <Link
            to={nextHref}
            className="rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep"
            data-testid="link-course-continue"
          >
            {progress.done ? 'Continue' : 'Start'}
          </Link>
        )}
      </div>
    </div>
  );
}

function CourseModule({ module, index, slug, compact, currentLessonUid }) {
  const total = totalSeconds(module.lessons);
  const count = module.lessons.length;
  return (
    <li data-testid={`course-module-${index + 1}`}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">
          Module {index + 1} · {module.title || <Unrecorded>Title not recorded</Unrecorded>}
        </h3>
        {!compact && (
          <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500">
            {count} lesson{count === 1 ? '' : 's'} · {durationLabel(total) || 'length not recorded'}
          </span>
        )}
      </div>
      <ul className="divide-y divide-axal-hairline rounded-axal-md border border-axal-hairline dark:divide-gray-800 dark:border-gray-800">
        {module.lessons.map((lesson, i) => (
          <LessonRow key={lesson.uid || i} lesson={lesson} slug={slug} current={lesson.uid && lesson.uid === currentLessonUid} />
        ))}
      </ul>
    </li>
  );
}

function LessonRow({ lesson, slug, current }) {
  const Icon = LESSON_ICON[lesson.kind] || FileText;
  const href = lessonHref(slug, lesson);
  const length = durationLabel(lesson.duration_seconds);
  const done = lessonDone(lesson);
  const optional = lesson.required === false || lesson.required === 0;
  const title = lesson.title || 'Untitled lesson';
  return (
    <li
      className={`flex items-center gap-3 px-3 py-2 text-[12.5px] ${current ? 'bg-axal-lavender dark:bg-violet-900/30' : ''}`}
      aria-current={current ? 'step' : undefined}
      data-testid={`lesson-row-${lesson.uid}`}
    >
      <Icon size={15} aria-hidden="true" className="flex-none text-axal-violet dark:text-violet-300" />
      <span className="min-w-0 flex-1">
        {href
          ? <Link to={href} className="font-medium text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{title}</Link>
          : <span className="font-medium text-axal-ink dark:text-gray-100">{title}</span>}
        <span className="text-axal-faint dark:text-gray-500"> · {lessonKindLabel(lesson.kind)}</span>
        {optional && <span className="ml-1.5"><Pill tone="neutral">Optional</Pill></span>}
      </span>
      <span className="flex-none tabular-nums text-axal-muted dark:text-gray-400">
        {length || <Unrecorded reason="No length is recorded for this lesson.">Length not recorded</Unrecorded>}
      </span>
      {done ? (
        <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-emerald-700 text-white dark:bg-emerald-500" role="img" aria-label="Completed" data-testid={`lesson-done-${lesson.uid}`}>
          <Check size={11} aria-hidden="true" />
        </span>
      ) : (
        <span className="inline-block h-[18px] w-[18px] flex-none rounded-full border border-axal-hairline dark:border-gray-700" role="img" aria-label="Not completed" />
      )}
    </li>
  );
}
