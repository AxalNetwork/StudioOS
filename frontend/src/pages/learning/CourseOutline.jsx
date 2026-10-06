import React from 'react';
import { Link } from 'react-router-dom';
import { Check, CirclePlay, ExternalLink, FileText, ListChecks, PenLine, Radio } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { LearningEmpty, NotLiveYet, SectionCard, stateBlock } from './LearningStates';
import {
  NOT_LIVE, byPosition, courseProgress, durationLabel, lessonDone, lessonHref, lessonKindLabel, minutesLabel, totalSeconds,
} from './learningModel';

/** One icon per lesson kind, so the kind reads at a glance; the label says it in words. */
export const LESSON_ICON = { video: CirclePlay, reading: FileText, exercise: PenLine, exam: ListChecks, webinar: Radio };

/**
 * A course's outline: its modules in order, then each module's lessons, each
 * with a kind icon, a length and a tick once completed (D562; data D557,
 * `GET /api/learning/courses/:slug`).
 *
 * Props, in the route's shape:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   course    { uid, slug, title, level, estimated_minutes, … }, or null for no such course
 *   modules   [{ uid, title, position, lessons: [{ uid, title, position, kind,
 *               ref_uid, required, progress: { status } | null }] }]
 *   progress  the route's own `{ required, completed, percent }`, measured over
 *             required lessons; without it the summary counts the ticks
 *   reason    the line `unrecorded` shows; onRetry for `unreadable`
 *   compact   the lesson player's side outline: no summary, the current lesson marked
 *
 * THE ROUTE SENDS NO LESSON LENGTH. A lesson's length would come from the item
 * it opens, and `GET /courses/:slug` does not join it. So when no lesson
 * carries `duration_seconds`, the outline says once that lengths are not
 * recorded, rather than "Length not recorded" on every row; a lesson that does
 * carry one shows it, and a module totals only when every lesson has one.
 */
export default function CourseOutline({
  status, course, modules, progress, reason = NOT_LIVE.catalogue, onRetry, compact = false, currentLessonUid,
}) {
  const ordered = byPosition(modules).map((m) => ({ ...m, lessons: byPosition(m?.lessons) }));
  const ticks = courseProgress(ordered);
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the course outline',
    claim: 'This is not a claim that the course has no lessons.',
    isEmpty: !course || ticks.total === 0,
    empty: !course
      ? { title: 'No such course', body: 'This course does not exist, or it is not published.', cta: { label: 'Back to Learning', to: '/learning' } }
      : { title: 'No lessons yet', body: 'This course has no lessons published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  const lengthsSent = ordered.some((m) => m.lessons.some((l) => l && 'duration_seconds' in l));
  const meta = status === 'ready' && course && ticks.total
    ? `${ordered.length} module${ordered.length === 1 ? '' : 's'} · ${ticks.total} lesson${ticks.total === 1 ? '' : 's'}`
    : null;
  return (
    <SectionCard title={compact ? 'Course outline' : 'Outline'} meta={meta} testid="course-outline">
      {block || (
        <>
          {!compact && <CourseSummary course={course} modules={ordered} ticks={ticks} progress={progress} />}
          <ol className="space-y-4" data-testid="course-modules">
            {ordered.map((m, index) => (
              <CourseModule
                key={m.uid || index} module={m} index={index} slug={course?.slug}
                compact={compact} currentLessonUid={currentLessonUid} lengthsSent={lengthsSent}
              />
            ))}
          </ol>
          {!lengthsSent && (
            <p className="mt-3 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="course-lengths-note">
              <Unrecorded reason="The course route sends no lesson lengths.">Lesson lengths are not recorded.</Unrecorded>
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

/**
 * The progress line. The route's figure is measured over REQUIRED lessons, so
 * it says so; a course with no required lesson has no percentage, and says
 * that instead of a 0.
 */
export function progressLine(progress, ticks) {
  if (progress && Number.isFinite(Number(progress.required))) {
    const required = Number(progress.required);
    if (!required) return { percent: null, text: 'No lesson is required, so there is no percentage.' };
    const percent = Number(progress.percent);
    return { percent, text: `${percent}% · ${progress.completed} of ${required} required lesson${required === 1 ? '' : 's'}` };
  }
  return { percent: ticks.percent, text: `${ticks.percent}% · ${ticks.done} of ${ticks.total} lessons` };
}

function CourseSummary({ course, modules, ticks, progress }) {
  const level = course?.level ? titleCase(course.level) : null;
  const length = minutesLabel(course?.estimated_minutes);
  const line = progressLine(progress, ticks);
  // The first lesson not yet ticked is where "Continue" goes.
  const next = modules.flatMap((m) => m.lessons).find((l) => !lessonDone(l));
  const nextHref = next ? lessonHref(course?.slug, next) : null;
  return (
    <div className="mb-4 space-y-3 border-b border-axal-hairline pb-4 dark:border-gray-800" data-testid="course-summary">
      <div className="flex flex-wrap gap-1.5">
        {level ? <Pill tone="neutral">{level}</Pill> : <Pill tone="neutral"><Unrecorded>Level not recorded</Unrecorded></Pill>}
        {length ? <Pill tone="neutral">{length}</Pill> : <Pill tone="neutral"><Unrecorded>Length not recorded</Unrecorded></Pill>}
        <Pill tone="neutral">{ticks.total} lesson{ticks.total === 1 ? '' : 's'}</Pill>
        {course?.status && course.status !== 'published' && <Pill tone="warn">{titleCase(course.status)}</Pill>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {line.percent !== null && (
          <div
            className="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800"
            role="progressbar"
            aria-label="Course progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={line.percent}
          >
            <div className="h-full rounded-full bg-axal-violet" style={{ width: `${line.percent}%` }} />
          </div>
        )}
        <span className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-course-progress">{line.text}</span>
        {nextHref && (
          <Link
            to={nextHref}
            className="rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep"
            data-testid="link-course-continue"
          >
            {ticks.done ? 'Continue' : 'Start'}
          </Link>
        )}
      </div>
    </div>
  );
}

function CourseModule({ module, index, slug, compact, currentLessonUid, lengthsSent }) {
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
            {count} lesson{count === 1 ? '' : 's'}{lengthsSent ? ` · ${durationLabel(total) || 'length not recorded'}` : ''}
          </span>
        )}
      </div>
      <ul className="divide-y divide-axal-hairline rounded-axal-md border border-axal-hairline dark:divide-gray-800 dark:border-gray-800">
        {module.lessons.map((lesson, i) => (
          <LessonRow key={lesson.uid || i} lesson={lesson} slug={slug} current={lesson.uid && lesson.uid === currentLessonUid} lengthsSent={lengthsSent} />
        ))}
      </ul>
    </li>
  );
}

function LessonRow({ lesson, slug, current, lengthsSent }) {
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
      {lengthsSent && (
        <span className="flex-none tabular-nums text-axal-muted dark:text-gray-400">
          {length || <Unrecorded reason="No length is recorded for this lesson.">Length not recorded</Unrecorded>}
        </span>
      )}
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

/**
 * A course's resources (`resources_json`, D557): a list of `{title, url}`,
 * every url https, each opening in a new tab. An empty list is the author's
 * answer, "none"; a course read without the field at all is not recorded.
 */
export function CourseResources({ status, resources }) {
  if (status !== 'ready') return null;
  return (
    <SectionCard title="Resources" meta={Array.isArray(resources) && resources.length ? String(resources.length) : null} testid="course-resources">
      {!Array.isArray(resources) ? (
        <NotLiveYet line="This course's resources are not recorded." testid="course-resources-line" />
      ) : resources.length === 0 ? (
        <LearningEmpty title="No resources" body="The author has attached no resource to this course." />
      ) : (
        <ul className="space-y-1.5" data-testid="course-resources-list">
          {resources.map((r, i) => (
            <li key={`${r.url}-${i}`}>
              {/^https:\/\/\S+$/i.test(String(r.url || '')) ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300"
                >
                  {r.title || r.url} <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                // The route stores https links only; anything else is drawn, never linked.
                <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{r.title || 'Untitled resource'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
