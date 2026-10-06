import React, { useEffect, useRef, useState } from 'react';
import { Check, Timer, X } from 'lucide-react';
import { Card, Pill, Stat, StatGrid, Unrecorded } from '../../ui';
import { LearningLoading, LearningUnreadable, SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, attemptsLeft as attemptsLeftOf, byPosition, formatClock, formatDay, minutesLabel } from './learningModel';
import {
  answerIndexes, attemptOutcome, attemptSecondsLeft, openAttemptOf, optionRows, revealedAnswers, scoreOf,
} from './assessmentModel';

/** The clock: a prop when a test pins it, otherwise a tick a second while an attempt runs. */
function useClock(fixed, running) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined || !running) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fixed, running]);
  return fixed !== undefined ? fixed : tick;
}

const BUTTON = 'rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BUTTON} border border-axal-hairline text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:text-gray-200`;

/**
 * An exam in three steps: the intro, one question per screen against the
 * server's clock, and the result, with the correct answers only when the
 * route reveals them (D562; data D559, `routes/learning_assessment.ts`).
 *
 * Props, in the routes' shapes:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   exam      `GET /exams/:uid`'s intro: { uid, title, intro, pass_mark_percent,
 *             time_limit_minutes (null: no limit), max_attempts (null: no limit),
 *             reveal: 'score' | 'score_and_answers', question_count, status }
 *   attempts  `GET /exams/:uid/attempts`, newest first: [{ uid, started_at,
 *             submitted_at, score_percent, passed, timed_out, answers_revealed }];
 *             one without `submitted_at` is still open
 *   attemptsLeft     that read's `attempts_left` (null: no limit)
 *   attemptsStatus   that read's own state, since it can fail on its own
 *   attempt   the one being sat, from `POST /exams/:uid/attempts`: { uid,
 *             started_at, deadline, questions: [{ uid, prompt, kind, options }] }
 *   result    `POST …/submit`'s attempt, with `correct_count` and
 *             `question_count`, and the `questions` this page showed
 *   now       the clock in ms (a test pins it); onStart, onSubmit(answers), busy,
 *             error (the route's refusal, as it came)
 *
 * NO PAYLOAD HERE CARRIES A CORRECT ANSWER BEFORE IT MAY. The intro holds no
 * question and an attempt no answer; `revealedAnswers` draws the correct ones
 * only when the route says it revealed them on an exam whose `reveal` allows
 * it. THE CLOCK IS THE SERVER'S: the attempt's own `deadline`, and when it runs
 * out what is chosen is submitted, once, inside the route's 30 seconds of grace.
 */
export default function ExamFlow({
  status, exam, attempts = [], attemptsLeft, attemptsStatus = 'ready', onRetryAttempts,
  attempt, result, now, onStart, onSubmit, busy = false, error = '',
  reason = NOT_LIVE.exams, onRetry,
}) {
  const clock = useClock(now, Boolean(attempt));
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the exam',
    claim: 'This is not a claim that you have no attempts.',
    isEmpty: !exam,
    empty: { title: 'No such exam', body: 'This exam does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Exam" testid="exam-flow">{block}</SectionCard>;

  // The route's own count; without it, the limit less the attempts listed. A
  // limit the route did not send at all is not "no limit".
  const left = attemptsLeft !== undefined ? attemptsLeft
    : exam?.max_attempts === undefined ? undefined : attemptsLeftOf(exam, attempts);
  const step = attempt ? 'taking' : result ? 'result' : 'intro';
  return (
    <div data-testid="exam-flow" data-step={step}>
      {step === 'intro' && (
        <ExamIntro exam={exam} attempts={attempts} left={left} attemptsStatus={attemptsStatus} onRetryAttempts={onRetryAttempts} onStart={onStart} busy={busy} />
      )}
      {step === 'taking' && <ExamTaking key={attempt.uid || 'attempt'} exam={exam} attempt={attempt} clock={clock} onSubmit={onSubmit} busy={busy} />}
      {step === 'result' && (
        <ExamResult exam={exam} attempts={attempts} left={left} attemptsStatus={attemptsStatus} onRetryAttempts={onRetryAttempts} result={result} onStart={onStart} busy={busy} />
      )}
      {error && <p className="mt-2 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="exam-error">{error}</p>}
    </div>
  );
}

function questionCount(exam) {
  if (Array.isArray(exam?.questions)) return exam.questions.length;
  const n = Number(exam?.question_count);
  return exam?.question_count !== null && exam?.question_count !== undefined && Number.isFinite(n) ? n : null;
}

function ExamIntro({ exam, attempts, left, attemptsStatus, onRetryAttempts, onStart, busy }) {
  const count = questionCount(exam);
  const limit = minutesLabel(exam?.time_limit_minutes);
  // The route sends null for an untimed exam; a value it did not send is not recorded.
  const untimed = exam?.time_limit_minutes === null;
  const pass = Number(exam?.pass_mark_percent);
  const hasPass = exam?.pass_mark_percent !== null && exam?.pass_mark_percent !== undefined && Number.isFinite(pass);
  const known = attemptsStatus === 'ready';
  const open = known ? openAttemptOf(attempts) : null;
  const spent = known && left === 0 && !open;
  const leftValue = attemptsStatus === 'loading' ? 'Reading…' : !known ? 'Could not be read'
    : left === undefined ? 'Not recorded' : left === null ? 'No limit' : left;
  const draft = exam?.status && exam.status !== 'published';
  return (
    <Card padding="lg" data-testid="exam-intro">
      <h2 className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{exam?.title || 'Untitled exam'}</h2>
      {exam?.intro && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{exam.intro}</p>}
      <StatGrid cols={4} className="mt-4">
        <Stat label="Questions" value={count ?? 'Not recorded'} mono={count !== null} />
        <Stat label="Time limit" value={limit || (untimed ? 'No time limit' : 'Not recorded')} mono={false} />
        <Stat label="Pass mark" value={hasPass ? `${pass}%` : 'Not recorded'} mono={hasPass} />
        <Stat label="Attempts left" value={leftValue} mono={typeof leftValue === 'number'} />
      </StatGrid>
      <p className="mt-4 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        {untimed ? 'There is no time limit.' : 'Once you start, the timer runs until you submit.'} Correct answers are shown only if the exam allows it.
      </p>
      {open && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-200" data-testid="exam-open-attempt">
          You have an attempt open, started {formatDay(open.started_at) || 'on a date not recorded'}.
          {limit ? ' Its clock has run since then.' : ''} Choices are not saved until you submit, so a resumed attempt starts with none chosen.
        </p>
      )}
      {draft && (
        <p className="mt-2 text-[12.5px] text-axal-amber-deep dark:text-amber-300" data-testid="exam-draft-note">
          This exam is not published. Starting it counts as an attempt, and the first attempt fixes its questions, yours included.
        </p>
      )}
      <button
        type="button"
        className={`${PRIMARY} mt-3`}
        onClick={onStart}
        disabled={!onStart || busy || spent}
        title={!onStart ? 'This exam cannot be started from here.' : spent ? 'No attempts are left.' : undefined}
        data-testid="button-exam-start"
      >
        {spent ? 'No attempts left' : busy ? 'Starting…' : open ? 'Resume exam' : 'Start exam'}
      </button>
      <AttemptList attempts={attempts} status={attemptsStatus} onRetry={onRetryAttempts} title="Your attempts" />
    </Card>
  );
}

/** The member's own attempts: score, outcome and date, or "Open" for one still running. */
function AttemptList({ attempts, status, onRetry, title, except }) {
  if (status === 'loading') return <div className="mt-4"><LearningLoading rows={2} what="your attempts" /></div>;
  if (status === 'unreadable') {
    return <div className="mt-4"><LearningUnreadable what="Your attempts" claim="This is not a claim that you have none." onRetry={onRetry} /></div>;
  }
  const rows = (attempts || []).filter((a) => !except || a.uid !== except);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{title}</h3>
      <ul className="mt-1 space-y-1" data-testid="exam-attempts">
        {rows.map((a, i) => {
          const score = scoreOf(a);
          const outcome = attemptOutcome(a);
          return (
            <li key={a.uid || i} className="flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-axal-hairline px-2.5 py-1.5 text-[12px] tabular-nums text-axal-muted dark:border-gray-800 dark:text-gray-400">
              <span>{a.submitted_at ? (score !== null ? `${score}%` : 'Score not recorded') : 'Not submitted'}</span>
              <Pill tone={outcome.tone}>{outcome.label}</Pill>
              <span>{formatDay(a.submitted_at || a.started_at) || 'date not recorded'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExamTaking({ exam, attempt, clock, onSubmit, busy }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const questions = byPosition(attempt?.questions);
  const total = questions.length;
  const at = Math.min(index, Math.max(0, total - 1));
  const question = questions[at];
  const left = attemptSecondsLeft(attempt, exam, clock);
  const answered = questions.filter((q) => (answers[q.uid] || []).length > 0).length;
  const send = () => { if (onSubmit) onSubmit(answerIndexes(questions, answers)); };
  // When the server's clock runs out, what is chosen is sent, once: the
  // route's grace is there for this request to arrive.
  const autoSent = useRef(false);
  useEffect(() => {
    if (left === 0 && onSubmit && !busy && !autoSent.current) {
      autoSent.current = true;
      send();
    }
  }, [left, busy]);
  if (!question) {
    return <Card padding="lg" data-testid="exam-taking"><p className="text-[12.5px] text-axal-muted dark:text-gray-400">This attempt holds no questions.</p></Card>;
  }
  const multiple = question.kind === 'multiple';
  const chosen = answers[question.uid] || [];
  const choose = (key) => setAnswers((prev) => {
    const had = prev[question.uid] || [];
    const nextKeys = multiple ? (had.includes(key) ? had.filter((k) => k !== key) : [...had, key]) : [key];
    return { ...prev, [question.uid]: nextKeys };
  });
  const unanswered = total - answered;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="exam-taking">
      <div className="flex items-center justify-between gap-3 border-b border-axal-hairline px-4 py-2.5 dark:border-gray-800">
        <span className="text-[12px] tabular-nums text-axal-muted dark:text-gray-400">Question {at + 1} of {total} · {answered} answered</span>
        <span className={`inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums ${left === 0 ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} data-testid="text-exam-clock">
          <Timer size={14} aria-hidden="true" /> {left === null ? 'No time limit' : formatClock(left)}
        </span>
      </div>
      <div className="h-1 bg-axal-ground dark:bg-gray-800" aria-hidden="true">
        <div className="h-full bg-axal-violet" style={{ width: `${total ? Math.round(((at + 1) / total) * 100) : 0}%` }} />
      </div>
      <fieldset className="space-y-2 p-4">
        <legend className="mb-2 text-[14px] font-semibold text-axal-ink dark:text-gray-100">{question.prompt}</legend>
        {multiple && <p className="text-[11.5px] text-axal-faint dark:text-gray-500">Choose every answer that applies.</p>}
        {optionRows(question.options).map((o) => (
          <label
            key={o.key}
            className={`flex cursor-pointer items-center gap-2.5 rounded-axal-md border px-3 py-2 text-[13px] ${chosen.includes(o.key) ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'} text-axal-ink dark:text-gray-100`}
          >
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={`exam-${question.uid}`}
              checked={chosen.includes(o.key)}
              onChange={() => choose(o.key)}
              className="accent-violet-600"
            />
            {o.label}
          </label>
        ))}
        {left === 0 && <p className="text-[12px] text-red-700 dark:text-red-300" role="alert">Time is up. Your answers are being submitted as they stand.</p>}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
        <button type="button" className={SECONDARY} onClick={() => setIndex(at - 1)} disabled={at === 0} data-testid="button-exam-back">Back</button>
        {at < total - 1 ? (
          <button type="button" className={PRIMARY} onClick={() => setIndex(at + 1)} data-testid="button-exam-next">Next</button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            {unanswered > 0 && (
              <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="text-exam-unanswered">
                {unanswered} unanswered: an unanswered question counts as wrong.
              </span>
            )}
            <button type="button" className={PRIMARY} onClick={send} disabled={!onSubmit || busy} data-testid="button-exam-submit">
              {busy ? 'Submitting…' : 'Submit answers'}
            </button>
          </span>
        )}
      </div>
    </Card>
  );
}

function ExamResult({ exam, attempts, left, attemptsStatus, onRetryAttempts, result, onStart, busy }) {
  const score = scoreOf(result);
  const outcome = attemptOutcome(result);
  const pass = Number(exam?.pass_mark_percent);
  const revealed = revealedAnswers(exam, result);
  return (
    <Card padding="lg" data-testid="exam-result">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-extrabold tabular-nums text-axal-ink dark:text-gray-100" data-testid="text-exam-score">
          {score !== null ? `${score}%` : <Unrecorded>Score not recorded</Unrecorded>}
        </span>
        {(score !== null || outcome.label === 'Timed out') && <Pill tone={outcome.tone}>{outcome.label}</Pill>}
      </div>
      <p className="mt-1 text-[12.5px] tabular-nums text-axal-muted dark:text-gray-400">
        Pass mark {Number.isFinite(pass) && exam?.pass_mark_percent != null ? `${pass}%` : 'not recorded'}
        {result?.correct_count != null && result?.question_count != null && <> · {result.correct_count} of {result.question_count} correct</>}
        {result?.submitted_at && <> · submitted {formatDay(result.submitted_at)}</>}
      </p>
      <AttemptList attempts={attempts} status={attemptsStatus} onRetry={onRetryAttempts} title="Earlier attempts" except={result?.uid} />
      {revealed ? (
        <ol className="mt-4 space-y-2" data-testid="exam-answers">
          {revealed.map((a) => (
            <li key={a.uid || a.n} className="rounded-axal-md border border-axal-hairline p-3 text-[12.5px] dark:border-gray-800">
              <p className="flex items-start gap-1.5 font-semibold text-axal-ink dark:text-gray-100">
                {a.right
                  ? <Check size={14} aria-label="Right" className="mt-0.5 flex-none text-emerald-700 dark:text-emerald-300" />
                  : <X size={14} aria-label="Wrong" className="mt-0.5 flex-none text-red-700 dark:text-red-300" />}
                {a.prompt || `Question ${a.n}`}
              </p>
              <p className="mt-1 text-axal-muted dark:text-gray-400">Your answer: {a.chosen.join(', ') || 'none'}</p>
              <p className="text-emerald-700 dark:text-emerald-300">Correct: {a.correct.join(', ') || 'not recorded'}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="exam-answers-hidden">
          {exam?.reveal === 'score_and_answers'
            ? 'Correct answers: not sent for this attempt.'
            : 'Correct answers: hidden. This exam does not reveal them.'}
        </p>
      )}
      {onStart && attemptsStatus !== 'loading' && left !== 0 && (
        <button type="button" className={`${SECONDARY} mt-4`} onClick={onStart} disabled={busy} data-testid="button-exam-retry">Try again</button>
      )}
    </Card>
  );
}
