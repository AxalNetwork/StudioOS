/**
 * Task #12 — Personal-Values Assessment.
 *
 * A paired-statement survey (~25 questions) mapped to the value dimensions
 * from the taxonomy. The user slides between two poles on each question.
 * After submitting, they see their top 3 dominant dimensions + 1 secondary
 * with a plain-English summary. The page enforces a 90-day retake window.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  Heart, ArrowLeft, ArrowRight, Send, Loader2, AlertCircle,
  RefreshCw, CheckCircle, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

const SCALE_LABELS = {
  '-2': 'Strongly left',
  '-1': 'Slightly left',
  '0': 'Neutral / balanced',
  '1': 'Slightly right',
  '2': 'Strongly right',
};

function SliderQuestion({ q, value, onChange }) {
  const v = value ?? 0;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
        <span className="inline-flex items-center rounded bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium">
          {q.family === 'founder' ? 'Founder' : 'Schwartz'}
        </span>
        <span className="font-medium text-gray-700 dark:text-slate-300">{q.label}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm font-medium">
        <span className="max-w-[40%] text-left text-gray-700 dark:text-slate-300">
          {q.statement_left}
        </span>
        <span className="max-w-[40%] text-right text-gray-700 dark:text-slate-300">
          {q.statement_right}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={v}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-rose-500"
          aria-label="Value preference"
        />
      </div>
      <div className="mt-2 text-center text-xs font-medium text-rose-600 dark:text-rose-400">
        {SCALE_LABELS[String(v)]}
      </div>
    </div>
  );
}

function SummaryCard({ title, dimensions }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
        <Heart className="h-4 w-4 text-rose-500" />
        {title}
      </h3>
      <div className="space-y-3">
        {dimensions.map((d) => (
          <div key={d.slug || d.dimension_slug}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-800 dark:text-slate-200">{d.label || d.dimension_label}</span>
              <span className="text-xs text-gray-500 dark:text-slate-400">
                score {d.score > 0 ? '+' : ''}{d.score} · confidence {(d.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-slate-700">
              <div
                className="h-2 rounded-full bg-rose-500"
                style={{
                  width: `${Math.abs(d.score) / 2 * 100}%`,
                  marginLeft: d.score < 0 ? 'auto' : '0',
                  marginRight: d.score >= 0 ? 'auto' : '0',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ValuesAssessmentPage() {
  const [step, setStep] = useState('loading'); // loading | survey | results | locked
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [vector, setVector] = useState([]);
  const [summary, setSummary] = useState(null);
  const [nextRetake, setNextRetake] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [me, survey] = await Promise.all([
        api.values.getMe().catch(() => null),
        api.values.getSurvey().catch(() => null),
      ]);
      if (me && me.vector && me.vector.length > 0) {
        setVector(me.vector);
        setSummary(me.summary);
        setNextRetake(me.next_retake_at);
        setStep(me.can_retake ? 'survey' : 'results');
      } else {
        setStep('survey');
      }
      if (survey?.questions) {
        setQuestions(survey.questions);
        if (survey.can_retake === false && step !== 'survey') {
          setNextRetake(survey.next_retake_at);
        }
      }
    } catch (e) {
      reportError('values_assessment_load_failed', e);
      setError(e?.message || 'Failed to load values assessment.');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const answeredCount = useMemo(() => {
    return Object.values(answers).filter((v) => v !== undefined).length;
  }, [answers]);

  function setAnswer(qid, val) {
    setAnswers((prev) => ({ ...prev, [qid]: val }));
  }

  async function submit() {
    if (saving) return;
    const responses = questions.map((q) => ({
      question_id: q.id,
      choice: answers[q.id] ?? 0,
    }));
    setSaving(true);
    setError(null);
    try {
      const res = await api.values.submit(responses);
      setVector(res.vector || []);
      setSummary(res.summary || null);
      setStep('results');
      setSavedAt(Date.now());
    } catch (e) {
      reportError('values_assessment_submit_failed', e);
      if (e?.data?.error === 'retake_window') {
        setError('You can retake this assessment in 90 days.');
        setNextRetake(e.data.next_retake_at);
        setStep('locked');
      } else {
        setError(e?.message || 'Failed to submit. Please try again.');
      }
    }
    setSaving(false);
  }

  async function retake() {
    setAnswers({});
    setStep('survey');
  }

  const top3 = useMemo(() => {
    if (!vector || !summary?.top) return [];
    const topSlugs = new Set(summary.top.map((t) => t.slug));
    return vector.filter((v) => topSlugs.has(v.dimension_slug)).slice(0, 3);
  }, [vector, summary]);

  const secondary = useMemo(() => {
    if (!vector || !summary?.secondary) return null;
    return vector.find((v) => v.dimension_slug === summary.secondary.slug) || null;
  }, [vector, summary]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500 dark:text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading values assessment...
      </div>
    );
  }

  if (error && step === 'loading') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
        Personal Values Assessment
      </h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-slate-400">
        A short survey that captures your values across 15 dimensions. Takes ~5 minutes.
      </p>

      {step === 'survey' && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600 dark:text-slate-400">
              {answeredCount} / {questions.length} answered
            </span>
            <div className="h-2 w-32 rounded-full bg-gray-100 dark:bg-slate-700">
              <div
                className="h-2 rounded-full bg-rose-500"
                style={{ width: `${(answeredCount / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-4">
            {questions.map((q) => (
              <SliderQuestion
                key={q.id}
                q={q}
                value={answers[q.id]}
                onChange={(v) => setAnswer(q.id, v)}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnswers({})}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? 'Submitting...' : 'Submit Assessment'}
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </>
      )}

      {step === 'results' && (
        <>
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Your values vector has been saved.</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard title="Top 3 Dominant Dimensions" dimensions={top3} />
            {secondary && (
              <SummaryCard title="Secondary Dimension" dimensions={[secondary]} />
            )}
          </div>

          <div className="mt-6 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-slate-300">Full Vector</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {vector.map((v) => (
                <div key={v.dimension_slug} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-slate-300">{v.dimension_label}</span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    {v.score > 0 ? '+' : ''}{v.score} · {(v.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {nextRetake && (
            <div className="mt-4 text-sm text-gray-500 dark:text-slate-400">
              Next retake available: {new Date(nextRetake).toLocaleDateString()}
            </div>
          )}

          {(!nextRetake || new Date() >= new Date(nextRetake)) && (
            <div className="mt-6">
              <button
                type="button"
                onClick={retake}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RefreshCw className="h-4 w-4" />
                Retake Assessment
              </button>
            </div>
          )}
        </>
      )}

      {step === 'locked' && (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center shadow-sm">
          <Heart className="mx-auto mb-3 h-10 w-10 text-rose-400" />
          <h2 className="mb-2 text-lg font-semibold text-gray-800 dark:text-slate-200">Assessment Completed</h2>
          <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">
            You already have a values vector. You can retake this assessment every 90 days.
          </p>
          {nextRetake && (
            <p className="mb-4 text-sm font-medium text-gray-700 dark:text-slate-300">
              Next retake: {new Date(nextRetake).toLocaleDateString()}
            </p>
          )}
          <button
            type="button"
            onClick={() => setStep('results')}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            View Results
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
