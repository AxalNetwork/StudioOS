import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Pill, RailFrame, Unrecorded, WorkerRail } from '../../ui';
import { titleCase } from '../../lib/absence';
import ExercisePanel from './ExercisePanel';
import ExamFlow from './ExamFlow';
import { LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, SectionCard } from './LearningStates';
import { STATUS_NOTICE } from './studioActions';
import { readCourse } from './learningReads';
import useLearningRead from './useLearningRead';
import { assessmentHref, checklistOf, courseContext } from './assessmentModel';
import {
  addExamQuestion, deleteExamQuestion, markSubmission, orRefusal, readAttemptsReview, readExam, readExamAttempts,
  readExercise, readStudioExam, readStudioExams, readStudioExercise, readStudioExercises, readSubmissionsReview,
  saveExam, saveExercise, setExamStatus, setExerciseStatus, startExamAttempt, submitExamAttempt,
  submitExerciseAnswer, updateExamQuestion,
} from './assessmentReads';
import { AttemptsReview, StudioExamBuilder, StudioExerciseEditor, SubmissionsReview } from './StudioAssessmentEditors';

/**
 * Exercises and exams in the Learning center (D562 stage 3, D559's routes):
 * each surface a pure view drawn from a read's state, and the container that
 * reads and writes for it. Every call goes through `assessmentReads.js`.
 *
 *   /learning/exercises/:slug   ExercisePage   (the segment carries the uid)
 *   /learning/exams/:slug       ExamPage
 *   an exercise or exam lesson  AssessmentLesson, in the lesson page
 *   /learning/studio?exercise=, ?exam=, ?new=exercise|exam   StudioAssessment
 *   the read-only review        ExerciseReview, ExamReview: the Super Admin,
 *                               or an admin assigned to a program holding it
 *
 * The coming-soon gate is applied before any of these is mounted
 * (`LearningPage.jsx`), so a gated profile never reads at all.
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A read's state as the status a component draws: a 404 is "ready, with nothing to show". */
const statusOf = (state) => (state.status === 'missing' ? 'ready' : state.status === 'idle' ? 'loading' : state.status);

function AssessmentRail({ coverage }) {
  return (
    <WorkerRail
      workspace="Learning"
      // Violet, the founder accent, as on every learner page.
      role="founder"
      stance="Read-only learning view"
      note="Eadwyn reads back what this page has loaded, on a click. It does not write or submit an answer, start an exam or choose an option."
      coverage={coverage}
    />
  );
}

/** A Super Admin can open a draft or an archived one; members cannot, and the header says so. */
export function NotPublished({ row }) {
  if (!row?.status || row.status === 'published') return null;
  return <Pill tone="warn" data-testid="pill-not-published">{titleCase(row.status)} · members cannot open it</Pill>;
}

/** The course an exercise or exam was opened from (`?course=<slug>`), read to name it in the header. */
function useCourseContext(kind, uid) {
  const [params] = useSearchParams();
  const slug = params.get('course') || '';
  const [course] = useLearningRead(() => readCourse(slug), [slug], { enabled: Boolean(slug), scope: `${kind}-course` });
  return courseContext(course, kind, uid, slug);
}

// ── /learning/exercises/:slug ─────────────────────────────────────────────

/** The exercise and the member's own submissions, newest first: the latest is the one the status speaks of. */
export function ExerciseView({ state, onSubmit, busy = false, error = '', onRetry }) {
  const ready = state.status === 'ready';
  const submissions = ready ? state.submissions : [];
  return (
    <ExercisePanel
      // A new submission starts a fresh form under the answer it stored.
      key={submissions[0]?.uid || 'none'}
      status={statusOf(state)}
      exercise={ready ? state.exercise : null}
      submission={submissions[0] || null}
      history={submissions.slice(1)}
      onSubmit={ready ? onSubmit : undefined}
      busy={busy}
      error={error}
      onRetry={onRetry}
    />
  );
}

export function ExercisePage({ uid }) {
  const [state, retry, setState] = useLearningRead(() => readExercise(uid), [uid], { scope: 'exercise' });
  const context = useCourseContext('exercise', uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async (answer) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const stored = await submitExerciseAnswer(uid, answer);
      setState((s) => (s.status === 'ready' ? { ...s, submissions: [stored, ...s.submissions] } : s));
    } catch (err) {
      setError(err?.message || 'Your answer could not be submitted.');
    } finally {
      setBusy(false);
    }
  };
  const exercise = state.status === 'ready' ? state.exercise : null;
  const coverage = exercise ? [`One exercise: “${exercise.title}”`, `${plural(state.submissions.length, 'submission')} of yours`] : [];
  return (
    <RailFrame rail={<AssessmentRail coverage={coverage} />} data-testid="learning-exercise">
      <div className="space-y-4">
        <LearningHeader eyebrow="Learning · Exercise" title={exercise?.title || 'Exercise'} sub={context.sub} back={context.back} action={<NotPublished row={exercise} />} />
        <ExerciseView state={state} onSubmit={onSubmit} busy={busy} error={error} onRetry={retry} />
      </div>
    </RailFrame>
  );
}

// ── /learning/exams/:slug ─────────────────────────────────────────────────

/**
 * The exam from its two reads, the intro and the member's attempts, which
 * fail apart; `attempt` is the one being sat and `result` the one just
 * submitted, both held by the page.
 */
export function ExamView({
  examState, attemptsState, attempt = null, result = null, onStart, onSubmit, busy = false, error = '', onRetryExam, onRetryAttempts, now,
}) {
  const ready = examState.status === 'ready';
  const attemptsReady = attemptsState.status === 'ready';
  return (
    <ExamFlow
      status={statusOf(examState)}
      exam={ready ? examState.exam : null}
      attempts={attemptsReady ? attemptsState.attempts || [] : []}
      attemptsLeft={attemptsReady ? attemptsState.attemptsLeft : undefined}
      attemptsStatus={statusOf(attemptsState)}
      onRetryAttempts={onRetryAttempts}
      attempt={attempt}
      result={result}
      now={now}
      onStart={ready ? onStart : undefined}
      onSubmit={onSubmit}
      busy={busy}
      error={error}
      onRetry={onRetryExam}
    />
  );
}

export function ExamPage({ uid }) {
  const [examState, retryExam] = useLearningRead(() => readExam(uid), [uid], { scope: 'exam' });
  const [attemptsState, retryAttempts] = useLearningRead(() => readExamAttempts(uid), [uid], { scope: 'exam-attempts' });
  const context = useCourseContext('exam', uid);
  const [attempt, setAttempt] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const started = await startExamAttempt(uid);
      setResult(null);
      setAttempt(started);
    } catch (err) {
      setError(err?.message || 'The exam could not be started.');
    } finally {
      setBusy(false);
      // A start counts against the limit, and a refusal may follow one made elsewhere.
      retryAttempts();
    }
  };
  const onSubmit = async (answers) => {
    if (busy || !attempt) return;
    const sitting = attempt;
    setBusy(true);
    setError('');
    try {
      const graded = await submitExamAttempt(uid, sitting.uid, answers);
      setResult({ ...graded, questions: sitting.questions });
      setAttempt(null);
    } catch (err) {
      setError(err?.message || 'Your answers could not be submitted.');
      // The clock ran out, or it was submitted already: the attempt is closed,
      // and the list read again says how it ended.
      if (err?.status === 409 || err?.status === 404) setAttempt(null);
    } finally {
      setBusy(false);
      retryAttempts();
    }
  };
  const exam = examState.status === 'ready' ? examState.exam : null;
  const counted = exam && exam.question_count !== null && exam.question_count !== undefined && Number.isFinite(Number(exam.question_count));
  const coverage = exam ? [
    `One exam: “${exam.title}”${counted ? `, ${plural(Number(exam.question_count), 'question')}` : ''}`,
    attemptsState.status === 'ready'
      ? `${plural(attemptsState.attempts.length, 'attempt')} of yours${attemptsState.attemptsLeft === null ? '' : `, ${attemptsState.attemptsLeft} left`}`
      : null,
  ].filter(Boolean) : [];
  return (
    <RailFrame rail={<AssessmentRail coverage={coverage} />} data-testid="learning-exam">
      <div className="space-y-4">
        <LearningHeader eyebrow="Learning · Exam" title={exam?.title || 'Exam'} sub={context.sub} back={context.back} action={<NotPublished row={exam} />} />
        <ExamView
          examState={examState} attemptsState={attemptsState} attempt={attempt} result={result}
          onStart={onStart} onSubmit={onSubmit} busy={busy} error={error} onRetryExam={retryExam} onRetryAttempts={retryAttempts}
        />
      </div>
    </RailFrame>
  );
}

// ── An exercise or exam lesson, inside a course ───────────────────────────

/**
 * What `/learning/courses/:slug/:lesson` shows for an exercise or exam lesson:
 * a way into the exercise or exam it names (D559's `checkRef` makes its
 * `ref_uid` one of that kind), with the course carried along so that page
 * names the course and leads back to it.
 */
export function AssessmentLesson({ lesson, slug }) {
  const kind = lesson?.kind === 'exam' ? 'exam' : 'exercise';
  const href = assessmentHref(kind, lesson?.ref_uid, slug);
  return (
    <SectionCard title={lesson?.title || titleCase(kind)} testid="lesson-elsewhere">
      <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
        {kind === 'exam'
          ? 'This lesson is an exam. Your answers are marked against its pass mark.'
          : 'This lesson is an exercise. You submit an answer, and it is reviewed.'}
      </p>
      {href ? (
        <Link to={href} className="mt-2 inline-flex text-[12.5px] font-semibold text-axal-violet-deep underline dark:text-violet-300" data-testid="link-lesson-assessment">
          {kind === 'exam' ? 'Open the exam' : 'Open the exercise'}
        </Link>
      ) : (
        <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400"><Unrecorded reason={`This lesson names no ${kind}.`} /> · This lesson names no {kind}.</p>
      )}
    </SectionCard>
  );
}

// ── The studio ────────────────────────────────────────────────────────────

/**
 * The studio's exercise and exam lists, for the content table and the course
 * builder's choice. `upsert(kind, row)` puts a write's reply in place.
 */
export function useStudioAssessments() {
  const [exercises, retryExercises, setExercises] = useLearningRead(readStudioExercises, [], { scope: 'studio-exercises' });
  const [exams, retryExams, setExams] = useLearningRead(readStudioExams, [], { scope: 'studio-exams' });
  const upsert = useCallback((kind, row) => {
    if (!row?.uid) return;
    const set = kind === 'exam' ? setExams : setExercises;
    set((s) => (s.status === 'ready' ? { ...s, rows: [row, ...s.rows.filter((r) => r.uid !== row.uid)] } : s));
  }, [setExams, setExercises]);
  return { exercises, exams, retryExercises, retryExams, upsert };
}

/**
 * One exercise or exam in the studio: its editor, then the review of its
 * learners' work. `uid` null creates a draft, then opens it at its own
 * address (`?exercise=<uid>` or `?exam=<uid>`). Every write shows the route's
 * refusal in its own words, beside what was being changed, and draws what the
 * route answered. `onStored(kind, row)` hands each stored row to the list.
 */
export function StudioAssessment({ kind, uid = null, onStored }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isExam = kind === 'exam';
  const [state, retry, setState] = useLearningRead(
    () => (isExam ? readStudioExam(uid) : readStudioExercise(uid)),
    [kind, uid],
    { enabled: Boolean(uid), scope: `studio-${kind}` },
  );
  const [busy, setBusy] = useState(false);
  // "Draft created." arrives with the address the new draft opened at.
  const [said, setSaid] = useState(() => ({ notice: location.state?.notice || '' }));
  useEffect(() => {
    if (location.state?.notice) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, []);
  const run = async (where, write, done) => {
    setBusy(true);
    setSaid({});
    try {
      done(await write());
      return true;
    } catch (err) {
      setSaid({ error: { where, message: err?.message || 'The studio could not save that.' } });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const show = (row, notice = '') => {
    if (!row) return;
    setState({ status: 'ready', [kind]: row });
    onStored?.(kind, row);
    if (notice) setSaid({ notice });
  };
  const created = (row) => {
    onStored?.(kind, row);
    navigate(`/learning/studio?${kind}=${encodeURIComponent(row.uid)}`, { state: { notice: 'Draft created.' } });
  };
  const error = said.error || null;
  const notice = said.notice || '';

  if (isExam) {
    const exam = state.status === 'ready' ? state.exam : null;
    const handlers = {
      onSave: (form) => run('fields', () => saveExam({ uid, form }), uid ? (row) => show(row, 'Saved.') : created),
      onStatus: (action) => run('fields', () => setExamStatus(uid, action), (row) => show(row, STATUS_NOTICE[action])),
      onAddQuestion: (form) => run('questions', () => addExamQuestion(uid, form), (row) => show(row)),
      onUpdateQuestion: (questionUid, form) => run('questions', () => updateExamQuestion(questionUid, form), (row) => show(row)),
      onDeleteQuestion: (questionUid) => run('questions', () => deleteExamQuestion(questionUid), (row) => show(row)),
    };
    if (!uid) return <StudioExamBuilder key="new-exam" exam={null} handlers={handlers} busy={busy} error={error} notice={notice} />;
    const held = studioHeld(state, 'exam', retry);
    if (held) return held;
    return (
      <div className="space-y-4">
        <StudioExamBuilder key={exam.uid} exam={exam} handlers={handlers} busy={busy} error={error} notice={notice} />
        <ExamReview uid={exam.uid} />
      </div>
    );
  }

  const exercise = state.status === 'ready' ? state.exercise : null;
  const onSave = (form) => run('fields', () => saveExercise({ uid, form }), uid ? (row) => show(row, 'Saved.') : created);
  const onStatus = (action) => run('fields', () => setExerciseStatus(uid, action), (row) => show(row, STATUS_NOTICE[action]));
  const message = error?.where === 'fields' ? error.message : '';
  if (!uid) return <StudioExerciseEditor key="new-exercise" exercise={null} onSave={onSave} onStatus={onStatus} busy={busy} error={message} notice={notice} />;
  const held = studioHeld(state, 'exercise', retry);
  if (held) return held;
  return (
    <div className="space-y-4">
      <StudioExerciseEditor key={exercise.uid} exercise={exercise} onSave={onSave} onStatus={onStatus} busy={busy} error={message} notice={notice} />
      <ExerciseReview uid={exercise.uid} kind={exercise.submission_kind} checklist={checklistOf(exercise)} canMark />
    </div>
  );
}

/** What the studio draws for a read that is not ready: loading, unreadable, or no such one. */
function studioHeld(state, kind, retry) {
  if (state.status === 'loading' || state.status === 'idle') return <LearningLoading what={`the ${kind}`} />;
  if (state.status === 'unreadable') return <LearningUnreadable what={`The ${kind}`} claim="This is not a claim that it does not exist." onRetry={retry} />;
  if (state.status === 'missing') return <SectionCard title="Not found"><LearningEmpty title={`No such ${kind}`} body={`No ${kind} has that uid.`} /></SectionCard>;
  return null;
}

// ── The read-only review ──────────────────────────────────────────────────

/** A review read's state as `SubmissionsReview` and `AttemptsReview` take it: a 403 or a 404 is the route's sentence. */
function reviewProps(state) {
  if (state.status === 'missing') return { status: 'ready', refused: state.message || 'Not found.' };
  if (state.status === 'ready' && state.refused) return { status: 'ready', refused: state.refused };
  return { status: statusOf(state), refused: '' };
}

/**
 * Every learner's submissions to one exercise, for whoever the route admits:
 * the Super Admin, or an admin assigned to a program that holds it. `canMark`
 * (the Super Admin's: `POST /submissions/:uid/review` is hers alone) adds
 * Accept and Needs work. `kind` and `checklist` draw a checklist's answers.
 */
export function ExerciseReview({ uid, kind, checklist = null, canMark = false }) {
  const [state, retry, setState] = useLearningRead(orRefusal(() => readSubmissionsReview(uid)), [uid], { scope: 'review-submissions' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const onReview = async (submissionUid, verdict) => {
    setBusy(true);
    setError(null);
    try {
      const stored = await markSubmission(submissionUid, verdict);
      setState((s) => (s.status === 'ready' && Array.isArray(s.submissions)
        ? { ...s, submissions: s.submissions.map((x) => (x.uid === stored.uid ? { ...x, ...stored } : x)) }
        : s));
      return true;
    } catch (err) {
      setError({ at: submissionUid, message: err?.message || 'The review could not be saved.' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <SubmissionsReview
      {...reviewProps(state)}
      submissions={state.status === 'ready' ? state.submissions || [] : []}
      kind={kind}
      checklist={checklist}
      onReview={canMark ? onReview : undefined}
      busy={busy}
      error={error}
      onRetry={retry}
    />
  );
}

/** Every learner's attempts at one exam, scores only, for whoever the route admits. */
export function ExamReview({ uid }) {
  const [state, retry] = useLearningRead(orRefusal(() => readAttemptsReview(uid)), [uid], { scope: 'review-attempts' });
  return <AttemptsReview {...reviewProps(state)} attempts={state.status === 'ready' ? state.attempts || [] : []} onRetry={retry} />;
}
