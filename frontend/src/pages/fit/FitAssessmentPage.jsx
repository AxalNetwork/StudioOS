// Fit v2 — the staged assessment flow (/fit).
//
// Premium, high-trust pacing: an intro that explains what is measured and
// why, five question stages (Context → Values → Operating style → Skills →
// Consistency & evidence), then a review step before submit. Answers save
// per stage through the same writeRouter pipeline the Personal Advisor chat
// uses, so progress is shared and resume is server-side (refresh-safe).
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, AlertCircle, ArrowRight, ArrowLeft, ShieldCheck, Scale, Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import FitQuestionCard from '../../components/fit/FitQuestionCard';
import FitStageStepper from '../../components/fit/FitStageStepper';

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5';
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';

const SAVE_CHUNK = 20;

function StageIntro({ stageKey }) {
  const copy = {
    context: 'A little framing first — this shapes how we read everything else. Nothing here is scored.',
    values: 'What you optimize for. There are no right answers — honest beats impressive, and the tradeoffs matter more than the ratings.',
    archetypes: 'How you tend to operate. This is preference, not ability — every style here wins in the right seat.',
    skills: 'What you can reliably execute. Anchor on the last 12 months; claims without an example are capped, so the stories count.',
    validation: 'A short consistency pass. A couple of these deliberately re-ask earlier ground from the other side.',
  };
  const text = copy[stageKey];
  if (!text) return null;
  return <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{text}</p>;
}

export default function FitAssessmentPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('loading'); // loading | intro | assess | error
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [roleChoice, setRoleChoice] = useState(null);
  const [envelope, setEnvelope] = useState(null); // { session, stages, questions, answered, progress }
  const [drafts, setDrafts] = useState({});      // qid -> raw string (local, incl. unsaved)
  const [savedMap, setSavedMap] = useState({});  // qid -> raw string (server-acknowledged)
  const [stageKey, setStageKey] = useState('context');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveNote, setSaveNote] = useState(null);

  // Boot: role config + resume probe.
  useEffect(() => {
    let alive = true;
    Promise.all([api.fit.config(), api.fit.sessionCurrent()])
      .then(([cfg, cur]) => {
        if (!alive) return;
        setConfig(cfg);
        setRoleChoice(cfg.default_role);
        if (cur?.session) {
          hydrate(cur);
          setPhase('assess');
        } else {
          setPhase('intro');
        }
      })
      .catch((e) => { if (alive) { setError(e?.message || 'Failed to load'); setPhase('error'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = (env) => {
    setEnvelope(env);
    setDrafts({ ...(env.answered || {}) });
    setSavedMap({ ...(env.answered || {}) });
    const cur = env.session?.current_stage;
    const keys = (env.stages || []).map((s) => s.key);
    setStageKey(cur && (keys.includes(cur) || cur === 'review') ? cur : keys[0] || 'context');
  };

  const start = async () => {
    setPhase('loading');
    try {
      const env = await api.fit.startSession({ role_context: roleChoice });
      hydrate(env);
      setPhase('assess');
    } catch (e) {
      setError(e?.message || 'Failed to start');
      setPhase('error');
    }
  };

  const questionsByStage = useMemo(() => {
    const map = {};
    for (const q of envelope?.questions || []) {
      (map[q.stage] = map[q.stage] || []).push(q);
    }
    return map;
  }, [envelope]);

  const stages = envelope?.stages || [];
  const stageIdx = stages.findIndex((s) => s.key === stageKey);
  const progress = useMemo(() => {
    const out = {};
    for (const s of stages) {
      const ids = s.question_ids || [];
      out[s.key] = { answered: ids.filter((id) => (drafts[id] || '') !== '').length, total: ids.length };
    }
    return out;
  }, [stages, drafts]);
  const totalAnswered = Object.values(progress).reduce((a, p) => a + p.answered, 0);
  const totalQuestions = Object.values(progress).reduce((a, p) => a + p.total, 0);

  const dirtyItems = useCallback((ids) =>
    ids
      .filter((id) => (drafts[id] ?? '') !== (savedMap[id] ?? '') && (drafts[id] ?? '') !== '')
      .map((id) => ({ question_id: id, value: drafts[id] })), [drafts, savedMap]);

  const saveStage = async (nextStage) => {
    if (!envelope?.session) return;
    const ids = stages.find((s) => s.key === stageKey)?.question_ids || [];
    const items = dirtyItems(ids);
    setSaving(true);
    setSaveNote(null);
    try {
      for (let i = 0; i < items.length; i += SAVE_CHUNK) {
        const chunk = items.slice(i, i + SAVE_CHUNK);
        const res = await api.fit.submitAnswers(envelope.session.uid, chunk, nextStage);
        const failed = (res.results || []).filter((r) => r.status === 'invalid' || r.status === 'failed');
        const okIds = new Set((res.results || []).filter((r) => r.status === 'saved').map((r) => r.question_id));
        setSavedMap((prev) => {
          const next = { ...prev };
          for (const it of chunk) if (okIds.has(it.question_id)) next[it.question_id] = it.value;
          return next;
        });
        if (failed.length) {
          setSaveNote(`${failed.length} answer${failed.length > 1 ? 's' : ''} need attention: ${failed[0].hint || failed[0].status}`);
        }
      }
      if (items.length === 0 && nextStage) {
        // Still persist the stage pointer for resume.
        await api.fit.submitAnswers(envelope.session.uid, [], nextStage).catch(() => {});
      }
      if (nextStage) setStageKey(nextStage);
    } catch (e) {
      setSaveNote(e?.message || 'Save failed — your answers are still here, try again.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!envelope?.session) return;
    setSubmitting(true);
    try {
      // Flush anything unsaved across all stages first.
      const allIds = stages.flatMap((s) => s.question_ids || []);
      const items = dirtyItems(allIds);
      for (let i = 0; i < items.length; i += SAVE_CHUNK) {
        await api.fit.submitAnswers(envelope.session.uid, items.slice(i, i + SAVE_CHUNK));
      }
      await api.fit.submit(envelope.session.uid);
      navigate('/fit/results');
    } catch (e) {
      setSaveNote(e?.message || 'Submit failed — try again.');
      setSubmitting(false);
    }
  };

  // ── phases ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="max-w-3xl mx-auto p-6 flex items-center justify-center min-h-[40vh] text-gray-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className={CARD}>
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Scale size={20} className="text-violet-600 dark:text-violet-400" /> Axal VC Fit &amp; Values
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This is not a personality quiz. It measures three things separately — <strong>what you optimize for</strong> (values),
            <strong> how you operate</strong> (archetype), and <strong>what you can reliably execute</strong> (skills) — cross-checks
            your answers for consistency, and returns a decision with named strengths, gaps, and next steps.
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            About 20 minutes. You can leave and resume any time — progress saves as you go, and your Personal Advisor
            conversation feeds the same profile.
          </p>
        </div>
        <div className={CARD}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Assess yourself against a role</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            The values and style layers are the same everywhere; the skills weighting and the decision bar change per role.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(config?.roles || []).map((r) => {
              const active = roleChoice === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRoleChoice(r.key)}
                  className={
                    active
                      ? 'text-left rounded-lg border border-violet-500 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/30 p-3'
                      : 'text-left rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:border-violet-400 dark:hover:border-violet-500'
                  }
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{r.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.description}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <ShieldCheck size={14} className="text-emerald-500" /> Honest beats impressive — inconsistency costs more than a low rating.
            </div>
            <button type="button" className={BTN_PRIMARY} onClick={start} disabled={!roleChoice}>
              Begin <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── assess ─────────────────────────────────────────────────────────────────
  const isReview = stageKey === 'review';
  const stageQuestions = isReview ? [] : (questionsByStage[stageKey] || []);
  const nextStageKey = isReview ? null : stageIdx >= 0 && stageIdx < stages.length - 1 ? stages[stageIdx + 1].key : 'review';
  const prevStageKey = isReview ? stages[stages.length - 1]?.key : stageIdx > 0 ? stages[stageIdx - 1].key : null;
  const unanswered = stages.flatMap((s) =>
    (s.question_ids || []).filter((id) => (drafts[id] || '') === '').map((id) => ({ stage: s, id })));

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Scale size={18} className="text-violet-600 dark:text-violet-400" /> Fit Assessment
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            · {config?.roles?.find((r) => r.key === envelope?.session?.role_context)?.label || envelope?.session?.role_context}
          </span>
        </h1>
        <div className="text-xs text-gray-500 dark:text-gray-400">{totalAnswered}/{totalQuestions} answered</div>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mb-5 overflow-hidden">
        <div
          className="h-full rounded-full bg-violet-500 transition-all"
          style={{ width: `${totalQuestions ? Math.round((totalAnswered / totalQuestions) * 100) : 0}%` }}
        />
      </div>

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-6">
        <div className="mb-4 lg:mb-0">
          <FitStageStepper stages={stages} progress={progress} currentKey={stageKey} onSelect={(k) => saveStage(k)} />
        </div>

        <div>
          {saveNote ? (
            <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              {saveNote}
            </div>
          ) : null}

          {!isReview ? (
            <>
              <StageIntro stageKey={stageKey} />
              <div className="space-y-3">
                {stageQuestions.map((q, i) => (
                  <FitQuestionCard
                    key={q.id}
                    question={q}
                    index={i + 1}
                    value={drafts[q.id] ?? ''}
                    onChange={(next) => setDrafts((prev) => ({ ...prev, [q.id]: next }))}
                    disabled={saving || submitting}
                  />
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between">
                {prevStageKey ? (
                  <button type="button" className={BTN_GHOST} onClick={() => saveStage(prevStageKey)} disabled={saving}>
                    <ArrowLeft size={15} /> Back
                  </button>
                ) : <span />}
                <button type="button" className={BTN_PRIMARY} onClick={() => saveStage(nextStageKey)} disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                  {nextStageKey === 'review' ? 'Save & review' : 'Save & continue'} <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className={CARD}>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                  <Sparkles size={15} className="text-violet-600 dark:text-violet-400" /> Ready to score
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {unanswered.length === 0
                    ? 'Every question is answered. Submitting computes your three-layer profile and decision.'
                    : `${unanswered.length} question${unanswered.length > 1 ? 's are' : ' is'} still open. You can submit anyway — unanswered questions lower coverage and confidence, never your scores.`}
                </p>
                {unanswered.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {unanswered.slice(0, 8).map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => saveStage(u.stage.key)}
                          className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          → {u.stage.label}: {u.id.split('.v2_')[1]?.replace(/_/g, ' ')}
                        </button>
                      </li>
                    ))}
                    {unanswered.length > 8 ? (
                      <li className="text-xs text-gray-500 dark:text-gray-400">…and {unanswered.length - 8} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <button type="button" className={BTN_GHOST} onClick={() => setStageKey(prevStageKey)} disabled={submitting}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={submitting}>
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                  Submit &amp; see my decision <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
