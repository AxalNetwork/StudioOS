import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, SUBMISSION_STATUS, formatDay } from './learningModel';

const words = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * One exercise: its instructions, the member's answer, its review status
 * (Submitted, Accepted, Needs work), the reviewer's feedback, and a resubmit
 * (D562; data #1160).
 *
 * Props, in the shape #1160 plans:
 *   status      'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   exercise    { uid, title, instructions, submission_kind }
 *   submission  the member's latest { uid, body, status, feedback, reviewer_name,
 *               submitted_at, reviewed_at }, or null before the first answer
 *   history     earlier submissions, newest first (optional)
 *   onSubmit(body), busy, error
 *
 * AN ACCEPTED ANSWER IS FINISHED: there is nothing to resubmit, so the form is
 * not drawn. Submitted waits on a reviewer; Needs work takes a new answer.
 * Whether a resubmission keeps the earlier one is #1160's to decide, so this
 * panel draws `history` when it is sent and claims nothing when it is not.
 */
export default function ExercisePanel({
  status, exercise, submission, history = [], onSubmit, busy = false, error = '',
  reason = NOT_LIVE.exercises, onRetry,
}) {
  const [draft, setDraft] = useState(submission?.status === 'needs_work' ? submission.body || '' : '');
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the exercise',
    claim: 'This is not a claim that you have not submitted an answer.',
    isEmpty: !exercise,
    empty: { title: 'No such exercise', body: 'This exercise does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Exercise" testid="exercise-panel">{block}</SectionCard>;

  const current = submission?.status ? SUBMISSION_STATUS[submission.status] : null;
  const accepted = submission?.status === 'accepted';
  const instructions = String(exercise?.instructions ?? '').trim();
  const submit = (event) => {
    event.preventDefault();
    if (onSubmit && draft.trim()) onSubmit(draft.trim());
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="exercise-panel">
      <div className="min-w-0 space-y-4">
        <SectionCard title="Instructions">
          {instructions
            ? <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="exercise-instructions"><ReactMarkdown>{instructions}</ReactMarkdown></div>
            : <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded reason="The author has written no instructions." /> · The author has written no instructions.</p>}
        </SectionCard>
        <SectionCard title="Your answer" meta={submission?.submitted_at ? `submitted ${formatDay(submission.submitted_at)}` : null} testid="exercise-answer">
          {submission?.body && (
            <p className="mb-3 whitespace-pre-wrap rounded-axal-md bg-axal-ground p-3 text-[13px] leading-relaxed text-gray-700 dark:bg-gray-950 dark:text-gray-300" data-testid="exercise-submitted-body">
              {submission.body}
            </p>
          )}
          {!submission && <p className="mb-3 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="exercise-not-submitted">You have not submitted an answer yet.</p>}
          {accepted ? (
            <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="exercise-accepted">Accepted. There is nothing to resubmit.</p>
          ) : (
            <form onSubmit={submit} className="space-y-2" data-testid="form-exercise-answer">
              <label htmlFor="exercise-answer" className="sr-only">Your answer</label>
              <textarea
                id="exercise-answer"
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-axal-md border border-axal-hairline bg-white p-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                placeholder={submission ? 'Write your revised answer' : 'Write your answer'}
                data-testid="input-exercise-answer"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500">{words(draft)} words</span>
                <button
                  type="submit"
                  disabled={!onSubmit || busy || !draft.trim()}
                  title={onSubmit ? undefined : 'Answers cannot be submitted until exercises are live.'}
                  className="rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="button-exercise-submit"
                >
                  {busy ? 'Submitting…' : submission ? 'Resubmit' : 'Submit'}
                </button>
              </div>
              {error && <p className="text-[12px] text-red-700 dark:text-red-300" role="alert">{error}</p>}
            </form>
          )}
        </SectionCard>
      </div>
      <div className="min-w-0 space-y-4">
        <SectionCard title="Status" testid="exercise-status">
          {current ? (
            <div className="space-y-2">
              <Pill tone={current.tone} dot>{current.label}</Pill>
              <p className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400">
                Submitted {formatDay(submission.submitted_at) || <Unrecorded>date not recorded</Unrecorded>}
                {submission.reviewed_at && <> · reviewed {formatDay(submission.reviewed_at)}</>}
              </p>
            </div>
          ) : submission ? (
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>Status not recorded</Unrecorded></p>
          ) : (
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Not submitted yet.</p>
          )}
          {history.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-axal-hairline pt-3 text-[12px] dark:border-gray-800" data-testid="exercise-history">
              {history.map((h, i) => (
                <li key={h.uid || i} className="flex justify-between gap-2 text-axal-muted dark:text-gray-400">
                  <span>{SUBMISSION_STATUS[h.status]?.label || 'Status not recorded'}</span>
                  <span className="tabular-nums">{formatDay(h.submitted_at) || 'date not recorded'}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard
          title="Reviewer’s feedback"
          meta={submission?.reviewed_at ? `${submission.reviewer_name || 'Reviewer not recorded'} · ${formatDay(submission.reviewed_at)}` : null}
          testid="exercise-feedback"
        >
          {submission?.feedback
            ? <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{submission.feedback}</p>
            : <p className="text-[12.5px] text-axal-muted dark:text-gray-400">{submission?.reviewed_at ? 'The reviewer left no written feedback.' : 'No review yet.'}</p>}
        </SectionCard>
      </div>
    </div>
  );
}
