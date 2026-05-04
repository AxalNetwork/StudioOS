import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, Check, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { PERSONAS } from '../lib/personas';

// Epic 1 — guided persona onboarding. Three states:
//   1. INTRO    — collect a free-form first message
//   2. CONFIRM  — show classifier suggestion (or alternatives if disambiguation)
//   3. ANSWERS  — walk the chosen persona's follow-up bank, then finalize
const FOUNDER_IDS = new Set(['founder_new', 'founder_existing']);

export default function OnboardingPersonaPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('intro');
  const [firstMessage, setFirstMessage] = useState('');
  const [taxonomy, setTaxonomy] = useState(PERSONAS);
  const [classifyResult, setClassifyResult] = useState(null);
  const [chosenPersona, setChosenPersona] = useState(null);
  const [secondaryPersona, setSecondaryPersona] = useState(null);
  const [questionBank, setQuestionBank] = useState([]);
  const [answers, setAnswers] = useState({});
  const [questionIdx, setQuestionIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.getPersonaTaxonomy().then((r) => setTaxonomy(r.personas || PERSONAS)).catch(() => {});
    api.getMyPersonas().then((r) => {
      if (r?.personas?.length > 0) {
        const primary = r.personas.find((p) => p.is_primary) || r.personas[0];
        setChosenPersona(primary.persona_id);
      }
    }).catch(() => {});
  }, []);

  const personaById = useMemo(() => {
    const map = {};
    for (const p of taxonomy) map[p.id] = p;
    return map;
  }, [taxonomy]);

  const classify = async () => {
    if (!firstMessage.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api.classifyPersona(firstMessage.trim());
      setClassifyResult(r);
      if (r.persona_id && !r.needs_disambiguation) setChosenPersona(r.persona_id);
      setStage('confirm');
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        // Route missing on this deployment. Don't show "Not found" — let the
        // user proceed by picking their persona manually instead of being
        // stuck on an onboarding form they can't escape.
        setClassifyResult({ persona_id: null, needs_disambiguation: true });
        setStage('confirm');
      } else if (e?.status >= 500) {
        setError("Couldn't reach the persona router right now. Pick your role manually below or try again in a moment.");
        setClassifyResult({ persona_id: null, needs_disambiguation: true });
        setStage('confirm');
      } else {
        setError(e.message || 'Failed to classify');
      }
    }
    finally { setBusy(false); }
  };

  const startQuestions = (personaId) => {
    const persona = personaById[personaId];
    if (!persona) return;
    setChosenPersona(personaId);
    setQuestionBank(persona.follow_up_questions || []);
    setQuestionIdx(0);
    setAnswers({});
    setStage('answers');
  };

  const submitAnswer = async () => {
    const q = questionBank[questionIdx];
    if (!q) return;
    const value = answers[q.key];
    if (value === undefined || value === null || value === '') {
      setError('Please answer this question.');
      return;
    }
    setBusy(true); setError('');
    try {
      await api.answerPersona(chosenPersona, q.key, value);
      if (questionIdx + 1 < questionBank.length) {
        setQuestionIdx(questionIdx + 1);
      } else {
        const conf = classifyResult?.persona_id === chosenPersona ? (classifyResult?.confidence || 0.8) : 1.0;
        const source = classifyResult?.persona_id === chosenPersona ? 'router' : 'self_select';
        await api.finalizePersona(chosenPersona, conf, source, secondaryPersona);
        setDone(true);
        setStage('done');
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const renderQuestionInput = (q) => {
    const val = answers[q.key] ?? '';
    const set = (v) => setAnswers((a) => ({ ...a, [q.key]: v }));
    if (q.type === 'choice' && Array.isArray(q.choices)) {
      return (
        <div className="flex flex-wrap gap-2">
          {q.choices.map((c) => (
            <button key={c} type="button" onClick={() => set(c)}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${val === c ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-violet-400'}`}>
              {c}
            </button>
          ))}
        </div>
      );
    }
    if (q.type === 'number') {
      return (
        <input type="number" value={val} onChange={(e) => set(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-violet-500"
          placeholder="Enter a number" />
      );
    }
    return (
      <input type="text" value={val} onChange={(e) => set(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-violet-500"
        placeholder="Type your answer" />
    );
  };

  const offerSecondary = chosenPersona && FOUNDER_IDS.has(chosenPersona);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={22} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900">Tell us who you are</h1>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Two minutes. We'll tailor StudioOS to your role and only ask the questions that matter for you.
      </p>

      {error && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}

      {stage === 'intro' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            In one or two sentences, what brings you to Axal?
          </label>
          <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-violet-500"
            placeholder="e.g. I run a $50M family office and we're looking to allocate to AI-native venture studios." />
          <div className="flex justify-end">
            <button onClick={classify} disabled={busy || !firstMessage.trim()}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
              {busy ? <Loader2 className="animate-spin" size={14} /> : <ArrowRight size={14} />}
              Continue
            </button>
          </div>
        </div>
      )}

      {stage === 'confirm' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          {classifyResult?.persona_id && !classifyResult?.needs_disambiguation ? (
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Suggested persona</div>
              <div className="text-lg font-semibold text-gray-900">{personaById[classifyResult.persona_id]?.label}</div>
              <p className="text-sm text-gray-600 mt-1">{personaById[classifyResult.persona_id]?.short_description}</p>
              {classifyResult.rationale && <p className="text-xs text-gray-500 mt-2 italic">{classifyResult.rationale}</p>}
              <div className="flex gap-2 mt-4">
                <button onClick={() => startQuestions(classifyResult.persona_id)}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg">
                  <Check size={14} /> Yes, that's me
                </button>
                <button onClick={() => { setClassifyResult({ ...classifyResult, needs_disambiguation: true }); }}
                  className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">
                  Pick a different one
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm font-medium text-gray-900 mb-3">Pick the persona that best describes you</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {taxonomy.map((p) => (
                  <button key={p.id} onClick={() => startQuestions(p.id)}
                    className="text-left border border-gray-200 hover:border-violet-400 rounded-lg p-3 transition-colors">
                    <div className="text-sm font-semibold text-gray-900">{p.label}</div>
                    <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{p.short_description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'answers' && questionBank[questionIdx] && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {personaById[chosenPersona]?.label}
            </div>
            <div className="text-xs text-gray-500">{questionIdx + 1} / {questionBank.length}</div>
          </div>
          <label className="block text-sm font-medium text-gray-800">{questionBank[questionIdx].prompt}</label>
          {renderQuestionInput(questionBank[questionIdx])}

          {questionIdx === questionBank.length - 1 && offerSecondary && (
            <div className="border-t border-gray-100 pt-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-1" checked={secondaryPersona === 'operator_advisor'}
                  onChange={(e) => setSecondaryPersona(e.target.checked ? 'operator_advisor' : null)} />
                <span>I also want to be listed as an <span className="font-medium">Operator / Advisor</span> for other studio ventures.</span>
              </label>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setQuestionIdx(Math.max(0, questionIdx - 1))} disabled={questionIdx === 0 || busy}
              className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 px-3 py-2">
              Back
            </button>
            <button onClick={submitAnswer} disabled={busy}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg">
              {busy ? <Loader2 className="animate-spin" size={14} /> : <ArrowRight size={14} />}
              {questionIdx + 1 === questionBank.length ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {stage === 'done' && done && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-1">
            <Check size={18} /> All set
          </div>
          <p className="text-sm text-emerald-800">
            We've tagged you as <span className="font-medium">{personaById[chosenPersona]?.label}</span>
            {secondaryPersona && <> and <span className="font-medium">{personaById[secondaryPersona]?.label}</span></>}.
            Your sidebar and dashboard now reflect what's most useful to you.
          </p>
          <button onClick={() => navigate('/dashboard')}
            className="mt-3 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg">
            <ArrowRight size={14} /> Go to dashboard
          </button>
        </div>
      )}
    </div>
  );
}
