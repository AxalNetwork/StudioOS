import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Circle } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, SUBMISSION_STATUS, formatDay } from './learningModel';
import { answerCounter, checkedOf, exerciseAnswer } from './assessmentModel';

const ACCEPTED_LINE = 'Accepted. There is nothing to resubmit.';

/**
 * One exercise: its instructions, the member's answer (a text, or a
 * checklist), its review status (Submitted, Accepted, Needs work), the
 * reviewer's feedback, and a resubmit (D562; data D559, `GET
 * /api/learning/exercises/:uid` and `POST …/submissions`).
 *
 * Props, in the route's shape:
 *   status      'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   exercise    { uid, title, instructions, submission_kind: 'text' | 'checklist',
 *               checklist: [item] | null, status, published_at }
 *   submission  the member's latest from that read's `submissions`: { uid, body,
 *               status, feedback, submitted_at, reviewed_at }, or null before the
 *               first answer. A checklist's `body` is the indexes checked, as
 *               JSON. The route sends no reviewer's name.
 *   history     the earlier submissions, newest first
 *   onSubmit(answer)  the body the route takes: { body } or { checked }
 *   busy, error (the route's refusal, as it came)
 *
 * AN ACCEPTED ANSWER IS FINISHED: there is nothing to resubmit, so the form is
 * not drawn. Other states retain the current answer for the next submission.
 * Resubmitting adds a row, so the earlier answers stay (D559) and are listed.
 */
export default function ExercisePanel({
  status, exercise, submission, history = [], onSubmit, busy = false, error = '',
  reason = NOT_LIVE.exercises, onRetry, formId,
}) {
  const isChecklist = exercise?.submission_kind === 'checklist';
  const items = Array.isArray(exercise?.checklist) ? exercise.checklist : [];
  const redo = submission?.status === 'needs_work';
  const [draft, setDraft] = useState(!isChecklist ? submission?.body || '' : '');
  const [checked, setChecked] = useState(() => (redo && isChecklist ? checkedOf(submission.body, items.length) || [] : []));
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
  const max = exercise?.answer_max_chars ?? undefined;
  const answerable = isChecklist || (Boolean(draft.trim()) && (!Number.isFinite(max) || [...draft].length <= max));
  const reviewedDay = formatDay(submission?.reviewed_at) || 'Not recorded';
  const reviewer = submission?.reviewer_name || 'Reviewer not recorded';
  const statusLine = !submission ? 'Submit when you are ready. You can resubmit after a review.'
    : submission.status === 'submitted' ? `Submitted ${formatDay(submission.submitted_at) || 'Not recorded'}. ${reviewer} reads it next.`
    : submission.status === 'accepted' ? `Accepted ${reviewedDay}.`
    : submission.status === 'needs_work' ? `Sent back ${reviewedDay}. Edit your answer and resubmit.` : null;
  const hasReview = Boolean(submission?.feedback || submission?.reviewed_at || accepted || redo);
  const toggle = (i) => setChecked((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]));
  const submit = (event) => {
    event.preventDefault();
    if (onSubmit && answerable) onSubmit(exerciseAnswer(isChecklist ? 'checklist' : 'text', { text: draft, checked }));
  };

  return (
    <div className="grid min-w-0 gap-4 [overflow-wrap:anywhere] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="exercise-panel">
      <div className="min-w-0 space-y-4">
        <SectionCard title="Instructions">
          {instructions
            ? <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="exercise-instructions"><ReactMarkdown>{instructions}</ReactMarkdown></div>
            : <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded reason="The author has written no instructions." /> · The author has written no instructions.</p>}
        </SectionCard>
        <SectionCard title="Your answer" meta={submission?.submitted_at ? `submitted ${formatDay(submission.submitted_at)}` : null} testid="exercise-answer">
          {submission && (isChecklist
            ? <ChecklistAnswer items={items} checked={checkedOf(submission.body, items.length)} />
            : accepted && submission.body && (
              <p className="mb-3 whitespace-pre-wrap rounded-axal-md bg-axal-ground p-3 text-[13px] leading-relaxed text-gray-700 dark:bg-gray-950 dark:text-gray-300" data-testid="exercise-submitted-body">
                {submission.body}
              </p>
            ))}
          {!submission && <p className="mb-3 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="exercise-not-submitted">You have not submitted an answer yet.</p>}
          {accepted ? (
            <>
              <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="exercise-accepted">{ACCEPTED_LINE}</p>
              {!isChecklist && typeof submission.body === 'string' && <span className="text-xs tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-exercise-count">{answerCounter(submission.body, max)}</span>}
            </>
          ) : (
            <form id={formId} onSubmit={submit} className="space-y-2" data-testid="form-exercise-answer">
              {isChecklist ? (
                <fieldset className="space-y-1.5" data-testid="exercise-checklist">
                  <legend className="sr-only">Your checklist</legend>
                  {items.length === 0 && <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>This checklist has no items.</Unrecorded></p>}
                  {items.map((item, i) => (
                    <label
                      key={i}
                      className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-axal-md border px-3 py-2 text-[13px] text-axal-ink dark:text-gray-100 ${checked.includes(i) ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'}`}
                    >
                      <input type="checkbox" checked={checked.includes(i)} onChange={() => toggle(i)} className="mt-0.5 accent-violet-600" data-testid={`input-exercise-check-${i}`} />
                      <span>{item}</span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <>
                  <label htmlFor="exercise-answer" className="mb-1 block text-xs font-medium text-axal-ink dark:text-gray-200">Write your answer</label>
                  <textarea
                    id="exercise-answer"
                    rows={4}
                    maxLength={max}
                    required
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="h-[110px] w-full max-w-full rounded-axal-md border border-axal-hairline bg-white p-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    placeholder="Write your answer"
                    data-testid="input-exercise-answer"
                  />
                </>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="text-exercise-count">
                  {isChecklist ? `${checked.length} of ${items.length} done` : answerCounter(draft, max)}
                </span>
                {!formId && <ExerciseSubmit submission={submission} busy={busy} disabled={!onSubmit || !answerable} unavailable={!onSubmit} />}
              </div>
              {error && <p className="text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="exercise-error">{error}</p>}
            </form>
          )}
        </SectionCard>
      </div>
      <div className="order-first min-w-0 space-y-4 lg:order-last">
        <SectionCard title="Status" testid="exercise-status">
          {current || !submission ? (
            <div className="space-y-2">
              <Pill tone={current?.tone || 'neutral'} dot>{current?.label || 'Not submitted yet'}</Pill>
              <p className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{statusLine}</p>
            </div>
          ) : <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>Status not recorded</Unrecorded></p>}
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
          {submission && !accepted && (
            <p className="mt-3 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="exercise-keeps">Resubmitting keeps your earlier answers.</p>
          )}
        </SectionCard>
        <SectionCard
          title="Reviewer’s feedback"
          testid="exercise-feedback"
        >
          {hasReview && <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-axal-muted dark:text-gray-400" data-testid="exercise-reviewer">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-axal-ground dark:bg-gray-900">{[...(submission?.reviewer_name || '').trim()][0]?.toUpperCase() || '—'}</span>
            <span className="min-w-0 break-words">{reviewer} · {reviewedDay}</span>
          </div>}
          {submission?.feedback
            ? <p className="whitespace-pre-wrap border-l-2 border-axal-lavender-edge pl-2.5 text-[13px] leading-relaxed text-gray-700 dark:border-violet-800 dark:text-gray-300">{submission.feedback}</p>
            : <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No review yet.</p>}
        </SectionCard>
      </div>
    </div>
  );
}

/** LR10's header action; the same control serves an embedded lesson form. */
export function ExerciseSubmit({ submission, formId, busy = false, disabled = false, unavailable = false }) {
  const accepted = submission?.status === 'accepted';
  return <button type="submit" form={formId} disabled={accepted || busy || disabled}
    title={accepted ? ACCEPTED_LINE : unavailable ? 'Answers cannot be submitted from here.' : undefined}
    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-axal-sm bg-axal-violet px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
    data-testid="button-exercise-submit">{accepted ? 'Resubmit' : busy ? 'Submitting…' : submission?.status === 'needs_work' ? 'Resubmit' : 'Submit'}</button>;
}

/**
 * A submitted checklist: every item, ticked or not, from the indexes the
 * route stored. A body that is not such a list is said to be unreadable as a
 * checklist rather than drawn as "nothing done".
 */
export function ChecklistAnswer({ items, checked }) {
  if (!checked) {
    return <p className="mb-3 text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>This answer cannot be read as a checklist.</Unrecorded></p>;
  }
  return (
    <ul className="mb-3 space-y-1 rounded-axal-md bg-axal-ground p-3 text-[13px] dark:bg-gray-950" data-testid="exercise-submitted-checklist">
      {items.map((item, i) => {
        const done = checked.includes(i);
        const Icon = done ? Check : Circle;
        return (
          <li key={i} className={`flex items-start gap-2 ${done ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
            <Icon size={14} aria-hidden="true" className={`mt-0.5 flex-none ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-faint dark:text-gray-600'}`} />
            <span>{item}</span>
            <span className="sr-only">{done ? '(done)' : '(not done)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
