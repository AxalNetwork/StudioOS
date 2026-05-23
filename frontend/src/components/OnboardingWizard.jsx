import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react';
import { api } from '../lib/api';

// Phase 0.2 / Task #23 — Shared multi-step wizard shell.
// Persists `{flow, step, total_steps, data}` to /api/onboarding/progress
// after every step so a refresh / re-login resumes where the user left
// off. Calls onFinish() after the final step + POST /complete.
//
// `steps` is: [{ key, title, description?, render: ({values, set, error}) => JSX, validate?: (values) => string|null }]
export default function OnboardingWizard({ flow, steps, onFinish, finishLabel = 'Finish' }) {
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState({});
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  // Hydrate from server so refresh / re-login resumes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.onboardingGetProgress();
        if (cancelled) return;
        if (p?.flow === flow) {
          setValues(p.data || {});
          // Clamp to valid range — schema may have changed since the user
          // last saved; never resume past the last step.
          const safeStep = Math.max(0, Math.min(steps.length - 1, p.step || 0));
          setStepIdx(safeStep);
          if (p.completed_at) setCompleted(true);
        }
      } catch {
        // Surface nothing — first-time users have no row yet.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [flow, steps.length]);

  const setField = useCallback((key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const persist = useCallback(async (nextStep, nextValues) => {
    try {
      await api.onboardingSaveProgress({
        flow,
        step: nextStep,
        total_steps: steps.length,
        data: nextValues,
      });
    } catch (e) {
      // Persistence failure shouldn't block forward motion — surface as
      // a soft warning the next render.
      setError('Could not save progress. Your changes may not persist.');
    }
  }, [flow, steps.length]);

  const goNext = async () => {
    setError('');
    const step = steps[stepIdx];
    if (step.validate) {
      const v = step.validate(values);
      if (v) { setError(v); return; }
    }
    setBusy(true);
    if (stepIdx + 1 < steps.length) {
      const nextStep = stepIdx + 1;
      await persist(nextStep, values);
      setStepIdx(nextStep);
      setBusy(false);
    } else {
      // Final step — persist final values then mark complete.
      await persist(stepIdx, values);
      try {
        await api.onboardingComplete(flow);
        setCompleted(true);
      } catch (e) {
        setError(e?.message || 'Could not finalize onboarding');
        setBusy(false);
        return;
      }
      setBusy(false);
      if (onFinish) onFinish(values);
    }
  };

  const goBack = () => {
    setError('');
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  if (!hydrated) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  if (completed) {
    return (
      <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-xl p-10 text-center dark:bg-gray-900 dark:border-gray-800">
        <div className="mx-auto h-12 w-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center mb-4">
          <Check size={22} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">You're all set</h2>
        <p className="text-sm text-gray-600 mt-2">Onboarding complete — redirecting you to your dashboard.</p>
      </div>
    );
  }

  const step = steps[stepIdx];
  const pct = Math.round(((stepIdx + 1) / steps.length) * 100);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Step {stepIdx + 1} of {steps.length}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-violet-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 dark:bg-gray-900 dark:border-gray-800">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">{step.title}</h2>
        {step.description && (
          <p className="text-sm text-gray-600 mt-1">{step.description}</p>
        )}
        <div className="mt-5">
          {step.render({ values, set: setField, error })}
        </div>
        {error && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIdx === 0 || busy}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={busy}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {stepIdx + 1 === steps.length ? finishLabel : 'Continue'}
            {stepIdx + 1 < steps.length && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Tiny field helpers shared across the per-role wizards. They're plain
// functions (not components) so each step's `render` can just compose
// them inline without prop-drilling values/set.
export function TextField({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">{label}</span>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-800"
      />
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">{label}</span>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        rows={rows}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-800"
      />
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function ChoiceField({ label, options, value, onChange }) {
  return (
    <div>
      <span className="block text-xs font-medium text-gray-700 mb-2 dark:text-gray-300">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const lab = typeof opt === 'string' ? opt : opt.label;
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                active
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300'
              }`}
            >
              {lab}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MultiChoiceField({ label, options, value, onChange }) {
  const arr = Array.isArray(value) ? value : [];
  const toggle = (v) => {
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };
  return (
    <div>
      <span className="block text-xs font-medium text-gray-700 mb-2 dark:text-gray-300">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const lab = typeof opt === 'string' ? opt : opt.label;
          const active = arr.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                active
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300'
              }`}
            >
              {lab}
            </button>
          );
        })}
      </div>
    </div>
  );
}
