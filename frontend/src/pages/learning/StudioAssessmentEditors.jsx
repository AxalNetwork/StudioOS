import React, { useId, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import {
  ConfirmRow, DANGER, ErrorLine, Field, INPUT, PRIMARY, SECONDARY, StatusActions,
} from './studioParts';
import { SUBMISSION_STATUS, byPosition, formatDay } from './learningModel';
import {
  FROZEN_LINE, attemptOutcome, checkedOf, examForm, exerciseForm, optionLetter, questionForm, scoreOf, withoutOption,
} from './assessmentModel';

/**
 * The studio's exercise editor and exam builder, and the read-only review of
 * learners' work (D562 stage 3; D559's `admin_learning_assessment.ts` and the
 * `/review/*` reads in `learning_assessment.ts`). Each draws from props and
 * fetches nothing: `LearningAssessments.jsx` holds the reads and writes.
 *
 * The canvas's "Exercise editor" (title, instructions, answer) and "Exam
 * builder" (each question with its kind and correct answer, the pass mark,
 * the limits and whether answers are revealed), in the studio's own parts.
 */

const VISIBILITY_HINT = 'Program-only content opens to the members of a program that holds it.';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function VisibilityField({ id, value, onChange }) {
  return (
    <Field id={id} label="Visibility" hint={VISIBILITY_HINT}>
      <select id={id} className={INPUT} value={value} onChange={onChange}>
        <option value="open">Open to every member</option>
        <option value="program">Program-only</option>
      </select>
    </Field>
  );
}

// ── The exercise editor ───────────────────────────────────────────────────

/**
 * Create or edit one exercise, for the Super Admin.
 *
 *   exercise  the stored row (`GET /admin/learning/exercises/:uid`: its
 *             `checklist_json` is the raw stored list), or null to create one
 *   onSave(form), onStatus(action), busy, error (the route's words), notice
 *
 * THE ANSWER'S KIND IS SET ONCE. `POST /exercises` takes `submission_kind`
 * and `PATCH` does not, so a stored exercise shows its kind rather than a
 * choice the route would ignore. A checklist takes 1 to 30 items.
 */
export function StudioExerciseEditor({ exercise, onSave, onStatus, busy = false, error = '', notice = '' }) {
  const [form, setForm] = useState(() => exerciseForm(exercise));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  const isChecklist = form.submission_kind === 'checklist';
  const setItem = (i) => (event) => setForm((f) => ({ ...f, checklist: f.checklist.map((x, j) => (j === i ? event.target.value : x)) }));
  return (
    <SectionCard title={exercise ? 'Edit exercise' : 'New exercise'} meta={exercise ? `/learning/exercises/${exercise.uid}` : 'created as a draft'} testid="studio-exercise-editor">
      {exercise && <div className="mb-4"><StatusActions status={exercise.status} what="exercise" onStatus={onStatus} busy={busy} /></div>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => { event.preventDefault(); onSave(form); }}
        data-testid="form-studio-exercise"
      >
        <Field id={id('title')} label="Title" full>
          <input id={id('title')} className={INPUT} value={form.title} onChange={set('title')} data-testid="input-exercise-title" />
        </Field>
        <Field id={id('instructions')} label="Instructions" hint="Markdown. What to produce, how long it should be, and what the reviewer looks for." full>
          <textarea id={id('instructions')} rows={8} className={INPUT} value={form.instructions} onChange={set('instructions')} data-testid="input-exercise-instructions" />
        </Field>
        {exercise ? (
          <div>
            <span className="mb-1 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Answer</span>
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="text-exercise-kind">
              {isChecklist ? 'A checklist' : 'A written answer'} · set when the exercise was created
            </p>
          </div>
        ) : (
          <Field id={id('kind')} label="Answer" hint="Set once: it cannot be changed after the exercise is created.">
            <select id={id('kind')} className={INPUT} value={form.submission_kind} onChange={set('submission_kind')} data-testid="select-exercise-kind">
              <option value="text">A written answer</option>
              <option value="checklist">A checklist</option>
            </select>
          </Field>
        )}
        <VisibilityField id={id('visibility')} value={form.visibility} onChange={set('visibility')} />
        {isChecklist && (
          <fieldset className="space-y-2 sm:col-span-2" data-testid="studio-exercise-checklist">
            <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Checklist items</legend>
            {form.checklist.map((item, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <input aria-label={`Item ${i + 1}`} className={INPUT} value={item} onChange={setItem(i)} placeholder="What the member ticks when it is done" />
                <button
                  type="button"
                  className={SECONDARY}
                  onClick={() => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, j) => j !== i) }))}
                  disabled={form.checklist.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={SECONDARY}
              onClick={() => setForm((f) => ({ ...f, checklist: [...f.checklist, ''] }))}
              disabled={form.checklist.length >= 30}
              data-testid="button-exercise-add-item"
            >
              Add an item
            </button>
            <p className="text-[11.5px] text-axal-faint dark:text-gray-500">From 1 to 30 items, each up to 300 characters. Blank rows are not sent.</p>
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-exercise-save">
            {busy ? 'Saving…' : exercise ? 'Save changes' : 'Create draft'}
          </button>
          {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
        </div>
        <div className="sm:col-span-2"><ErrorLine error={error} /></div>
      </form>
    </SectionCard>
  );
}

// ── The exam builder ──────────────────────────────────────────────────────

/**
 * Create or edit one exam, and its questions, for the Super Admin.
 *
 *   exam      the authoring tree (`GET /admin/learning/exams/:uid`): the exam,
 *             `attempt_count`, and `questions` with their `correct` indexes,
 *             which only this read carries; or null to create one
 *   handlers  { onSave, onStatus, onAddQuestion, onUpdateQuestion,
 *               onDeleteQuestion }, the question writes resolving true once
 *               they went through
 *   busy, error ({ where: 'fields' | 'questions', message }), notice
 *
 * QUESTIONS FREEZE AT THE FIRST ATTEMPT (D559). Once `attempt_count` is above
 * zero the route refuses every question write, so the controls are not
 * offered and the route's own sentence says why.
 */
export function StudioExamBuilder({ exam, handlers, busy = false, error = null, notice = '' }) {
  const [form, setForm] = useState(() => examForm(exam));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  return (
    <div className="space-y-4" data-testid="studio-exam-builder">
      <SectionCard title={exam ? 'Edit exam' : 'New exam'} meta={exam ? `/learning/exams/${exam.uid}` : 'created as a draft'} testid="studio-exam-fields">
        {exam && <div className="mb-4"><StatusActions status={exam.status} what="exam" onStatus={handlers.onStatus} busy={busy} /></div>}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => { event.preventDefault(); handlers.onSave(form); }}
          data-testid="form-studio-exam"
        >
          <Field id={id('title')} label="Title" full>
            <input id={id('title')} className={INPUT} value={form.title} onChange={set('title')} data-testid="input-exam-title" />
          </Field>
          <Field id={id('intro')} label="Intro" hint="Shown before an attempt starts. It holds no question: the questions arrive when the attempt starts." full>
            <textarea id={id('intro')} rows={3} className={INPUT} value={form.intro} onChange={set('intro')} />
          </Field>
          <Field id={id('pass')} label="Pass mark (%)" hint="A whole number from 0 to 100.">
            <input id={id('pass')} inputMode="numeric" className={INPUT} value={form.pass_mark_percent} onChange={set('pass_mark_percent')} data-testid="input-exam-pass" />
          </Field>
          <Field id={id('limit')} label="Time limit (minutes)" hint="Empty for no time limit.">
            <input id={id('limit')} inputMode="numeric" className={INPUT} value={form.time_limit_minutes} onChange={set('time_limit_minutes')} data-testid="input-exam-limit" />
          </Field>
          <Field id={id('attempts')} label="Attempts" hint="Empty for no limit. Every attempt started counts.">
            <input id={id('attempts')} inputMode="numeric" className={INPUT} value={form.max_attempts} onChange={set('max_attempts')} data-testid="input-exam-attempts" />
          </Field>
          <Field id={id('reveal')} label="After each submission, show">
            <select id={id('reveal')} className={INPUT} value={form.reveal} onChange={set('reveal')} data-testid="select-exam-reveal">
              <option value="score">The score only</option>
              <option value="score_and_answers">The score and the correct answers</option>
            </select>
          </Field>
          <VisibilityField id={id('visibility')} value={form.visibility} onChange={set('visibility')} />
          <label className="flex items-center gap-2 self-end text-[12.5px] text-axal-ink dark:text-gray-200">
            <input type="checkbox" checked={form.shuffle} onChange={(e) => setForm((f) => ({ ...f, shuffle: e.target.checked }))} className="accent-violet-600" data-testid="input-exam-shuffle" />
            Shuffle the question order for each attempt
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-exam-save">
              {busy ? 'Saving…' : exam ? 'Save changes' : 'Create draft'}
            </button>
            {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
          </div>
          <div className="sm:col-span-2"><ErrorLine error={error?.where === 'fields' ? error.message : ''} /></div>
        </form>
      </SectionCard>
      {exam && <QuestionsEditor exam={exam} handlers={handlers} busy={busy} error={error?.where === 'questions' ? error.message : ''} />}
    </div>
  );
}

function QuestionsEditor({ exam, handlers, busy, error }) {
  const questions = byPosition(exam.questions);
  const started = Number(exam.attempt_count);
  const frozen = Number.isFinite(started) && started > 0;
  const [adding, setAdding] = useState(false);
  return (
    <SectionCard title="Questions" meta={plural(questions.length, 'question')} testid="studio-exam-questions">
      {frozen && (
        <p className="mb-3 rounded-axal-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-axal-amber-deep dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="studio-exam-frozen">
          {FROZEN_LINE} ({plural(started, 'attempt')} started.)
        </p>
      )}
      <ErrorLine error={error} testid="studio-questions-error" />
      {questions.length === 0 && <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No question yet. An exam needs one before it is published.</p>}
      <ol className="space-y-2">
        {questions.map((q, i) => <QuestionLine key={q.uid} question={q} index={i} handlers={handlers} busy={busy} frozen={frozen} />)}
      </ol>
      {!frozen && (
        <div className="mt-3">
          {adding ? (
            <QuestionForm
              busy={busy} submitLabel="Add question"
              onSubmit={(form) => handlers.onAddQuestion(form).then((ok) => { if (ok) setAdding(false); })}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className={SECONDARY} onClick={() => setAdding(true)} disabled={busy} data-testid="button-add-question">Add a question</button>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function QuestionLine({ question, index, handlers, busy, frozen }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const correct = Array.isArray(question.correct) ? question.correct : [];
  if (editing && !frozen) {
    return (
      <li>
        <QuestionForm
          question={question} busy={busy} submitLabel="Save question"
          onSubmit={(form) => handlers.onUpdateQuestion(question.uid, form).then((ok) => { if (ok) setEditing(false); })}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="space-y-1.5 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-800" data-testid={`studio-question-${question.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="text-axal-faint dark:text-gray-500">
          Question {index + 1} · {question.kind === 'multiple' ? 'Multiple choice' : 'Single choice'} · correct: {correct.map(optionLetter).join(', ') || 'not recorded'}
        </span>
        {!frozen && (
          <span className="flex flex-wrap gap-1">
            <button type="button" className={SECONDARY} onClick={() => setEditing(true)} disabled={busy}>Edit</button>
            <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy} data-testid={`button-delete-question-${question.uid}`}>Delete</button>
          </span>
        )}
      </div>
      <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{question.prompt}</p>
      <ul className="space-y-0.5 text-[12.5px]">
        {(question.options || []).map((o, i) => {
          const right = correct.includes(i);
          return (
            <li key={i} className={`flex items-start gap-1.5 ${right ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-axal-muted dark:text-gray-400'}`}>
              <span className="w-4 flex-none">{optionLetter(i)}.</span>
              <span>{o}</span>
              {right && <Check size={13} aria-label="Correct" className="mt-0.5 flex-none" />}
            </li>
          );
        })}
      </ul>
      {confirming && (
        <ConfirmRow
          text="Delete this question?"
          action="Delete question"
          busy={busy}
          onConfirm={() => { setConfirming(false); handlers.onDeleteQuestion(question.uid); }}
          onCancel={() => setConfirming(false)}
          testid={`studio-confirm-question-${question.uid}`}
        />
      )}
    </li>
  );
}

/**
 * Add a question, or edit one: its prompt, single or multiple choice, 2 to 10
 * options, and which are correct (exactly one for a single choice). The form
 * always sends the question whole, which the edit route asks for whenever the
 * options or the kind change.
 */
export function QuestionForm({ question, onSubmit, onCancel, busy, submitLabel }) {
  const [form, setForm] = useState(() => questionForm(question));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const multiple = form.kind === 'multiple';
  const toggle = (i) => setForm((f) => ({
    ...f,
    correct: multiple ? (f.correct.includes(i) ? f.correct.filter((x) => x !== i) : [...f.correct, i]) : [i],
  }));
  return (
    <form
      className="grid gap-2 rounded-axal-md bg-axal-ground p-3 dark:bg-gray-950/40"
      onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}
      data-testid="form-studio-question"
    >
      <Field id={id('prompt')} label="Question">
        <textarea id={id('prompt')} rows={2} className={INPUT} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} data-testid="input-question-prompt" />
      </Field>
      <Field id={id('kind')} label="Answers">
        <select
          id={id('kind')}
          className={INPUT}
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, correct: e.target.value === 'single' ? f.correct.slice(0, 1) : f.correct }))}
          data-testid="select-question-kind"
        >
          <option value="single">Single choice: one correct option</option>
          <option value="multiple">Multiple choice: every correct option, no partial credit</option>
        </select>
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Options, with the correct {multiple ? 'ones' : 'one'} marked</legend>
        {form.options.map((o, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex flex-none items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={id('correct')}
                checked={form.correct.includes(i)}
                onChange={() => toggle(i)}
                className="accent-violet-600"
                data-testid={`input-question-correct-${i}`}
              />
              {optionLetter(i)} correct
            </label>
            <input
              aria-label={`Option ${optionLetter(i)}`}
              className={INPUT}
              value={o}
              onChange={(e) => setForm((f) => ({ ...f, options: f.options.map((x, j) => (j === i ? e.target.value : x)) }))}
              data-testid={`input-question-option-${i}`}
            />
            <button type="button" className={SECONDARY} onClick={() => setForm((f) => withoutOption(f, i))} disabled={form.options.length <= 2}>Remove</button>
          </div>
        ))}
        <button type="button" className={SECONDARY} onClick={() => setForm((f) => ({ ...f, options: [...f.options, ''] }))} disabled={form.options.length >= 10}>
          Add an option
        </button>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-question-save">{submitLabel}</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── The read-only review of learners' work ────────────────────────────────

/** The route's refusal (403), in its own words: the review is not this viewer's to read. */
function Refused({ refused, testid }) {
  return <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid={testid}>{refused}</p>;
}

/**
 * One exercise's submissions, every learner's, newest first (`GET
 * /api/learning/review/exercises/:uid/submissions`). A learner is a name and
 * a uid: the route sends no email.
 *
 *   status, refused (the route's 403 sentence), submissions
 *   kind, checklist  the exercise's answer kind and items, where the caller
 *                    knows them (the review read sends neither); without
 *                    them an answer is drawn as the text it is
 *   onReview(uid, { status, feedback })  the Super Admin's mark, resolving
 *                    true once it went through; absent, the list is read-only
 *   busy, error ({ at: submission uid, message }), onRetry
 *
 * A submission waiting on a review offers Accept and Needs work. Needs work
 * needs feedback, which the route says in its own words if it is missing.
 */
export function SubmissionsReview({
  status, refused = '', submissions = [], kind, checklist = null, onReview, busy = false, error = null, onRetry,
}) {
  const block = refused ? <Refused refused={refused} testid="review-submissions-refused" /> : stateBlock({
    status, onRetry,
    reason: 'Submissions are not read here.',
    what: 'the submissions',
    claim: 'This is not a claim that nobody has submitted.',
    isEmpty: submissions.length === 0,
    empty: { title: 'No submission yet', body: 'Answers appear here once a learner submits one.' },
  });
  return (
    <SectionCard title="Submissions" meta={!block && submissions.length ? String(submissions.length) : null} testid="review-submissions">
      {block || (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
          {submissions.map((s, i) => (
            <SubmissionRow key={s.uid || i} submission={s} kind={kind} checklist={checklist} onReview={onReview} busy={busy} error={error?.at === s.uid ? error.message : ''} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SubmissionRow({ submission: s, kind, checklist, onReview, busy, error }) {
  const [feedback, setFeedback] = useState('');
  const ids = useId();
  const st = SUBMISSION_STATUS[s.status];
  return (
    <li className="space-y-2 py-3" data-testid={`review-submission-${s.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="font-semibold text-axal-ink dark:text-gray-100">{s.learner_name || <Unrecorded>Learner not recorded</Unrecorded>}</span>
        <span className="flex flex-wrap items-center gap-2">
          {st ? <Pill tone={st.tone}>{st.label}</Pill> : <Unrecorded>Status not recorded</Unrecorded>}
          <span className="tabular-nums text-axal-muted dark:text-gray-400">
            submitted {formatDay(s.submitted_at) || 'on a date not recorded'}{s.reviewed_at ? ` · reviewed ${formatDay(s.reviewed_at)}` : ''}
          </span>
        </span>
      </div>
      <ReviewedAnswer body={s.body} kind={kind} checklist={checklist} />
      {s.feedback && (
        <p className="whitespace-pre-wrap border-l-2 border-axal-lavender-edge pl-2.5 text-[12.5px] text-axal-muted dark:border-violet-800 dark:text-gray-400">
          Feedback: {s.feedback}
        </p>
      )}
      {onReview && s.status === 'submitted' && (
        <div className="space-y-2 rounded-axal-md bg-axal-ground p-3 dark:bg-gray-950/40" data-testid={`review-mark-${s.uid}`}>
          <label htmlFor={`${ids}-feedback`} className="block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Feedback for the learner</label>
          <textarea
            id={`${ids}-feedback`}
            rows={2}
            className={INPUT}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Needs work says what needs work."
            data-testid={`input-review-feedback-${s.uid}`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => onReview(s.uid, { status: 'accepted', feedback })} data-testid={`button-review-accept-${s.uid}`}>
              Accept
            </button>
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => onReview(s.uid, { status: 'needs_work', feedback })} data-testid={`button-review-needs-work-${s.uid}`}>
              Needs work
            </button>
          </div>
          <ErrorLine error={error} testid={`review-error-${s.uid}`} />
        </div>
      )}
    </li>
  );
}

/** A learner's answer: the text, or a checklist's items ticked or not when the exercise's items are known. */
function ReviewedAnswer({ body, kind, checklist }) {
  if (kind === 'checklist') {
    const items = Array.isArray(checklist) ? checklist : null;
    const checked = checkedOf(body, items ? items.length : undefined);
    if (!checked) return <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>This answer cannot be read as a checklist.</Unrecorded></p>;
    if (!items) {
      return (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
          {checked.length ? `Items ${checked.map((i) => i + 1).join(', ')} checked.` : 'No item checked.'}
        </p>
      );
    }
    return (
      <ul className="space-y-0.5 rounded-axal-md bg-axal-ground p-2.5 text-[12.5px] dark:bg-gray-950" data-testid="review-checklist">
        {items.map((item, i) => {
          const done = checked.includes(i);
          const Icon = done ? Check : Circle;
          return (
            <li key={i} className={`flex items-start gap-1.5 ${done ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
              <Icon size={13} aria-label={done ? 'Done' : 'Not done'} className={`mt-0.5 flex-none ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-faint dark:text-gray-600'}`} />
              <span>{item}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  const text = String(body ?? '').trim();
  return text
    ? <p className="whitespace-pre-wrap rounded-axal-md bg-axal-ground p-2.5 text-[12.5px] leading-relaxed text-gray-700 dark:bg-gray-950 dark:text-gray-300">{text}</p>
    : <p className="text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded>No answer text recorded.</Unrecorded></p>;
}

/**
 * One exam's attempts, every learner's, newest first (`GET
 * /api/learning/review/exams/:uid/attempts`): when each started and was
 * submitted, the score and the outcome. Read-only, and scores only: the route
 * never sends a learner's answers here.
 */
export function AttemptsReview({ status, refused = '', attempts = [], onRetry }) {
  const block = refused ? <Refused refused={refused} testid="review-attempts-refused" /> : stateBlock({
    status, onRetry,
    reason: 'Attempts are not read here.',
    what: 'the attempts',
    claim: 'This is not a claim that nobody has sat this exam.',
    isEmpty: attempts.length === 0,
    empty: { title: 'No attempt yet', body: 'Attempts appear here once a learner starts this exam.' },
  });
  return (
    <SectionCard title="Attempts" meta={!block && attempts.length ? String(attempts.length) : null} testid="review-attempts">
      {block || (
        <>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {attempts.map((a, i) => {
              const score = scoreOf(a);
              const outcome = attemptOutcome(a);
              return (
                <li key={a.uid || i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]" data-testid={`review-attempt-${a.uid}`}>
                  <span className="font-semibold text-axal-ink dark:text-gray-100">{a.learner_name || <Unrecorded>Learner not recorded</Unrecorded>}</span>
                  <span className="flex flex-wrap items-center gap-2 tabular-nums text-axal-muted dark:text-gray-400">
                    <span>started {formatDay(a.started_at) || 'on a date not recorded'}{a.submitted_at ? ` · submitted ${formatDay(a.submitted_at)}` : ''}</span>
                    {a.submitted_at && <span>{score !== null ? `${score}%` : 'Score not recorded'}</span>}
                    <Pill tone={outcome.tone}>{outcome.label}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11.5px] text-axal-faint dark:text-gray-500">Scores only: this read never carries a learner’s answers.</p>
        </>
      )}
    </SectionCard>
  );
}
