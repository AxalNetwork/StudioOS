import React from 'react';
import { Link } from 'react-router-dom';
import { CirclePlay, PenLine } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, SUBMISSION_STATUS, durationLabel, formatDay } from './learningModel';

/**
 * Everything one member has started, finished, submitted or sat (D562).
 *
 * THREE STORES, THREE STATES. The progress rows are #1158's `GET
 * /api/learning/me`; exercise submissions and exam attempts are #1160's. They
 * merge separately and can fail separately, so each prop carries its own
 * `{ status, data, onRetry }` and one failed read never blanks the others.
 *
 *   progress   data: { in_progress: [row], completed: [row] }, each row
 *              { subject_kind: 'course' | 'item' | 'lesson', subject_uid, title,
 *                item_kind, percent, started_at, completed_at, duration_seconds, href }
 *   exercises  data: [{ exercise_uid, title, status, href }]
 *   exams      data: [{ exam_uid, title, score_percent, passed, href }]
 *
 * Certificates are not planned by any of the five tasks, so that card says so.
 */
export default function MyLearning({ progress = { status: 'unrecorded' }, exercises = { status: 'unrecorded' }, exams = { status: 'unrecorded' } }) {
  const inProgress = (progress.data?.in_progress || []).filter((r) => r.subject_kind === 'course');
  const completed = (progress.data?.completed || []).filter((r) => r.subject_kind === 'course');
  const videos = [...(progress.data?.in_progress || []), ...(progress.data?.completed || [])]
    .filter((r) => r.subject_kind === 'item' && r.item_kind === 'video');
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="my-learning">
      <div className="min-w-0 space-y-4">
        <Part title="Courses in progress" state={progress} rows={inProgress} reason={NOT_LIVE.progress} what="your courses" empty="No course in progress." testid="my-courses-in-progress">
          {(row) => <ProgressRow row={row} />}
        </Part>
        <Part title="Completed" state={progress} rows={completed} reason={NOT_LIVE.progress} what="your completed courses" empty="No course completed yet." testid="my-courses-completed">
          {(row) => (
            <RowLine href={row.href} title={row.title}>
              <span className="tabular-nums">{formatDay(row.completed_at) || 'date not recorded'}</span>
            </RowLine>
          )}
        </Part>
      </div>
      <div className="min-w-0 space-y-4">
        <Part title="Videos watched" state={progress} rows={videos} reason={NOT_LIVE.progress} what="your videos" empty="No video watched yet." testid="my-videos">
          {(row) => (
            <RowLine href={row.href} title={row.title} icon={CirclePlay}>
              <span className="tabular-nums">
                {[durationLabel(row.duration_seconds), formatDay(row.completed_at || row.started_at)].filter(Boolean).join(' · ') || 'not recorded'}
              </span>
            </RowLine>
          )}
        </Part>
        <Part title="Exercises" state={exercises} rows={exercises.data || []} reason={NOT_LIVE.exercises} what="your exercises" empty="No exercise submitted yet." testid="my-exercises">
          {(row) => (
            <RowLine href={row.href} title={row.title} icon={PenLine}>
              {SUBMISSION_STATUS[row.status]
                ? <Pill tone={SUBMISSION_STATUS[row.status].tone}>{SUBMISSION_STATUS[row.status].label}</Pill>
                : <Unrecorded>Status not recorded</Unrecorded>}
            </RowLine>
          )}
        </Part>
      </div>
      <div className="min-w-0 space-y-4">
        <Part title="Exam results" state={exams} rows={exams.data || []} reason={NOT_LIVE.exams} what="your exam results" empty="No exam sat yet." testid="my-exams">
          {(row) => (
            <RowLine href={row.href} title={row.title}>
              {row.score_percent !== null && row.score_percent !== undefined
                ? <span className="inline-flex items-center gap-1.5 tabular-nums">{Math.round(Number(row.score_percent))}% <Pill tone={row.passed === true || row.passed === 1 ? 'ok' : 'danger'}>{row.passed === true || row.passed === 1 ? 'Pass' : 'Fail'}</Pill></span>
                : <Unrecorded>Score not recorded</Unrecorded>}
            </RowLine>
          )}
        </Part>
        <SectionCard title="Certificates" testid="my-certificates">
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
            <Unrecorded reason="Certificates are not issued for courses yet." />
            <span className="block">Certificates are not issued for courses yet.</span>
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

function Part({ title, state, rows, reason, what, empty, testid, children }) {
  const block = stateBlock({
    status: state.status, reason, onRetry: state.onRetry, what,
    claim: 'This is not a claim that you have none.',
    isEmpty: rows.length === 0,
    empty: { title: empty },
  });
  return (
    <SectionCard title={title} meta={state.status === 'ready' && rows.length ? String(rows.length) : null} testid={testid}>
      {block || <ul className="space-y-2">{rows.map((row, i) => <li key={row.subject_uid || row.exercise_uid || row.exam_uid || i}>{children(row)}</li>)}</ul>}
    </SectionCard>
  );
}

function RowLine({ href, title, icon: Icon, children }) {
  const label = title || 'Untitled';
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon size={14} aria-hidden="true" className="flex-none text-axal-violet dark:text-violet-300" />}
        {href
          ? <Link to={href} className="truncate font-medium text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{label}</Link>
          : <span className="truncate font-medium text-axal-ink dark:text-gray-100">{label}</span>}
      </span>
      <span className="flex-none text-axal-muted dark:text-gray-400">{children}</span>
    </div>
  );
}

function ProgressRow({ row }) {
  const p = Number(row.percent);
  const has = row.percent !== null && row.percent !== undefined && Number.isFinite(p);
  return (
    <div className="space-y-1">
      <RowLine href={row.href} title={row.title}>
        <span className="tabular-nums">{has ? `${Math.round(p)}%` : <Unrecorded>Progress not recorded</Unrecorded>}</span>
      </RowLine>
      {has && (
        <div className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
          <div className="h-full rounded-full bg-axal-violet" style={{ width: `${Math.max(0, Math.min(100, Math.round(p)))}%` }} />
        </div>
      )}
    </div>
  );
}
