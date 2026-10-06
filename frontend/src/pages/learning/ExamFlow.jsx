import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { Card, Pill, Stat, StatGrid, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, attemptsLeft, byPosition, formatClock, formatDay, minutesLabel, secondsLeft } from './learningModel';

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

/** `options_json` as `{ key, label }` rows, whether it holds strings or objects. */
export function optionRows(options) {
  return (options || []).map((o, i) => (typeof o === 'string'
    ? { key: String(i), label: o }
    : { key: String(o?.key ?? i), label: String(o?.label ?? o?.text ?? '') }));
}

const BUTTON = 'rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BUTTON} border border-axal-hairline text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:text-gray-200`;

/**
 * An exam in three steps: the intro, one question per screen against a timer,
 * and the result, with the correct answers only when the exam allows it
 * (D562; data #1160).
 *
 * Props, in the shape #1160 plans:
 *   status    'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   exam      { uid, title, intro, pass_mark_percent, time_limit_minutes,
 *               max_attempts, reveal: 'score' | 'score_and_answers', question_count }
 *   attempts  the member's own attempts, newest first: [{ uid, started_at,
 *               submitted_at, score_percent, passed }]
 *   attempt   one in progress: { uid, started_at, questions: [{ uid, position,
 *               prompt, kind: 'single' | 'multiple', options }] }, or null
 *   result    the last submitted one: { score_percent, passed, correct_count,
 *               question_count, submitted_at, answers? }, or null
 *   now       the clock in ms (a test pins it); onStart, onSubmit(answers), busy
 *
 * NO PAYLOAD HERE EVER CARRIES A CORRECT ANSWER BEFORE IT MAY. #1160 grades on
 * the server and leaves `correct_json` out of everything a member reads until
 * the attempt is submitted and `reveal` allows it, so `result.answers` is drawn
 * only when `exam.reveal` is `score_and_answers`. Otherwise the result says the
 * answers are hidden.
 */
export default function ExamFlow({
  status, exam, attempts = [], attempt, result, now, onStart, onSubmit, busy = false, error = '',
  reason = NOT_LIVE.exams, onRetry,
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const clock = useClock(now, Boolean(attempt));
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the exam',
    claim: 'This is not a claim that you have no attempts.',
    isEmpty: !exam,
    empty: { title: 'No such exam', body: 'This exam does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Exam" testid="exam-flow">{block}</SectionCard>;

  const step = attempt ? 'taking' : result ? 'result' : 'intro';
  return (
    <div data-testid="exam-flow" data-step={step}>
      {step === 'intro' && <ExamIntro exam={exam} attempts={attempts} onStart={onStart} busy={busy} />}
      {step === 'taking' && (
        <ExamTaking
          exam={exam} attempt={attempt} clock={clock} index={index} setIndex={setIndex}
          answers={answers} setAnswers={setAnswers} onSubmit={onSubmit} busy={busy}
        />
      )}
      {step === 'result' && <ExamResult exam={exam} attempts={attempts} result={result} onStart={onStart} busy={busy} />}
      {error && <p className="mt-2 text-[12px] text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </div>
  );
}

function questionCount(exam) {
  if (Array.isArray(exam?.questions)) return exam.questions.length;
  const n = Number(exam?.question_count);
  return exam?.question_count !== null && exam?.question_count !== undefined && Number.isFinite(n) ? n : null;
}

function ExamIntro({ exam, attempts, onStart, busy }) {
  const count = questionCount(exam);
  const limit = minutesLabel(exam?.time_limit_minutes);
  const pass = Number(exam?.pass_mark_percent);
  const hasPass = exam?.pass_mark_percent !== null && exam?.pass_mark_percent !== undefined && Number.isFinite(pass);
  const left = attemptsLeft(exam, attempts);
  return (
    <Card padding="lg" data-testid="exam-intro">
      <h2 className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{exam?.title || 'Untitled exam'}</h2>
      {exam?.intro && <p className="mt-1 text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{exam.intro}</p>}
      <StatGrid cols={4} className="mt-4">
        <Stat label="Questions" value={count ?? 'Not recorded'} mono={count !== null} />
        <Stat label="Time limit" value={limit || 'No limit recorded'} mono={false} />
        <Stat label="Pass mark" value={hasPass ? `${pass}%` : 'Not recorded'} mono={hasPass} />
        <Stat label="Attempts left" value={left ?? 'Not recorded'} mono={left !== null} />
      </StatGrid>
      <p className="mt-4 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        Once you start, the timer runs until you submit. Correct answers are shown only if the exam allows it.
      </p>
      <button
        type="button"
        className={`${PRIMARY} mt-3`}
        onClick={onStart}
        disabled={!onStart || busy || left === 0}
        title={!onStart ? 'Exams cannot be started until they are live.' : left === 0 ? 'No attempts are left.' : undefined}
        data-testid="button-exam-start"
      >
        {left === 0 ? 'No attempts left' : busy ? 'Starting…' : 'Start exam'}
      </button>
    </Card>
  );
}

function ExamTaking({ exam, attempt, clock, index, setIndex, answers, setAnswers, onSubmit, busy }) {
  const questions = byPosition(attempt?.questions);
  const total = questions.length;
  const at = Math.min(index, Math.max(0, total - 1));
  const question = questions[at];
  const left = secondsLeft(attempt, exam, clock);
  const answered = questions.filter((q) => (answers[q.uid] || []).length > 0).length;
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
        {left === 0 && <p className="text-[12px] text-red-700 dark:text-red-300" role="alert">Time is up. Submit your answers.</p>}
      </fieldset>
      <div className="flex items-center justify-between gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
        <button type="button" className={SECONDARY} onClick={() => setIndex(at - 1)} disabled={at === 0} data-testid="button-exam-back">Back</button>
        {at < total - 1 ? (
          <button type="button" className={PRIMARY} onClick={() => setIndex(at + 1)} data-testid="button-exam-next">Next</button>
        ) : (
          <button
            type="button"
            className={PRIMARY}
            onClick={() => onSubmit && onSubmit(answers)}
            disabled={!onSubmit || busy}
            data-testid="button-exam-submit"
          >
            {busy ? 'Submitting…' : 'Submit answers'}
          </button>
        )}
      </div>
    </Card>
  );
}

function ExamResult({ exam, attempts, result, onStart, busy }) {
  const score = Number(result?.score_percent);
  const hasScore = result?.score_percent !== null && result?.score_percent !== undefined && Number.isFinite(score);
  const passed = result?.passed === true || result?.passed === 1;
  const pass = Number(exam?.pass_mark_percent);
  const reveal = exam?.reveal === 'score_and_answers' && Array.isArray(result?.answers);
  const left = attemptsLeft(exam, attempts);
  return (
    <Card padding="lg" data-testid="exam-result">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-extrabold tabular-nums text-axal-ink dark:text-gray-100" data-testid="text-exam-score">
          {hasScore ? `${Math.round(score)}%` : <Unrecorded>Score not recorded</Unrecorded>}
        </span>
        {hasScore && <Pill tone={passed ? 'ok' : 'danger'}>{passed ? 'Pass' : 'Fail'}</Pill>}
      </div>
      <p className="mt-1 text-[12.5px] tabular-nums text-axal-muted dark:text-gray-400">
        Pass mark {Number.isFinite(pass) && exam?.pass_mark_percent != null ? `${pass}%` : 'not recorded'}
        {result?.correct_count != null && result?.question_count != null && <> · {result.correct_count} of {result.question_count} correct</>}
        {result?.submitted_at && <> · submitted {formatDay(result.submitted_at)}</>}
      </p>
      {attempts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[12px] font-bold text-axal-ink dark:text-gray-100">Your attempts</h3>
          <ul className="mt-1 space-y-1" data-testid="exam-attempts">
            {attempts.map((a, i) => (
              <li key={a.uid || i} className="flex flex-wrap justify-between gap-2 text-[12px] tabular-nums text-axal-muted dark:text-gray-400">
                <span>{a.score_percent != null ? `${Math.round(Number(a.score_percent))}%` : 'Not submitted'}</span>
                <span>{a.score_percent != null ? (a.passed === true || a.passed === 1 ? 'Pass' : 'Fail') : ''}</span>
                <span>{formatDay(a.submitted_at || a.started_at) || 'date not recorded'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reveal ? (
        <ol className="mt-4 space-y-2" data-testid="exam-answers">
          {result.answers.map((a, i) => (
            <li key={a.question_uid || i} className="rounded-axal-md border border-axal-hairline p-3 text-[12.5px] dark:border-gray-800">
              <p className="font-semibold text-axal-ink dark:text-gray-100">{a.prompt || `Question ${i + 1}`}</p>
              <p className="mt-1 text-axal-muted dark:text-gray-400">Your answer: {(a.chosen_labels || a.chosen || []).join(', ') || 'none'}</p>
              <p className="text-emerald-700 dark:text-emerald-300">Correct: {(a.correct_labels || a.correct || []).join(', ')}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="exam-answers-hidden">
          Correct answers: hidden. This exam does not reveal them.
        </p>
      )}
      {onStart && left !== 0 && (
        <button type="button" className={`${SECONDARY} mt-4`} onClick={onStart} disabled={busy} data-testid="button-exam-retry">Try again</button>
      )}
    </Card>
  );
}
