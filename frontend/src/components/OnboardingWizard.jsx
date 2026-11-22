import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Check } from 'lucide-react';
import { api } from '../lib/api';
import { ONBOARDING_COMPLETE_EVENT } from '../lib/onboarding';

// Phase 0.2 / Task #23 — Shared multi-step wizard shell.
// Persists `{flow, step, total_steps, data}` to /api/onboarding/progress
// after every step so a refresh / re-login resumes where the user left
// off. Calls onFinish() after the final step + POST /complete.
//
// `steps` is: [{ key, title, description?, render: ({values, set, error}) => JSX, validate?: (values) => string|null,
//   skip?: { label, clears: [keys] } }]. A step with `skip` offers a quiet "skip for now": it
//   drops the step's own answers (`clears`), skips its validation, and moves on, or finishes.

export default function OnboardingWizard({ flow, steps, onFinish, finishLabel = 'Finish', onDark = false, renderComplete, requireFinalSave = false, reviewFlow = null }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState({});
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [resumedComplete, setResumedComplete] = useState(false);
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const pressLock = useRef(false);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus?.(); }, [stepIdx, hydrated]);

  // Hydrate from server so refresh / re-login resumes.
  useEffect(() => {
    let cancelled = false;
    setReadError(false);
    setHydrated(false);
    (async () => {
      try {
        const p = await api.onboardingGetProgress();
        if (cancelled) return;
        if (p?.flow === flow) {
          setValues(p.data || {});
          // Clamp to valid range — schema may have changed since the user
          // last saved; never resume past the last step.
          const safeStep = reviewFlow ? reviewFlow.resumeStep(p) : Math.max(0, Math.min(steps.length - 1, Number.isInteger(p.step) ? p.step : 0));
          setStepIdx(safeStep);
          if (p.completed_at) { setCompleted(true); setResumedComplete(true); }
        }
      } catch {
        if (!cancelled && reviewFlow) setReadError(true);
        // Surface nothing — first-time users have no row yet.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [flow, steps.length, readAttempt]);

  const setField = useCallback((key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  const persist = useCallback(async (nextStep, nextValues) => {
    try {
      await api.onboardingSaveProgress({
        flow,
        step: nextStep,
        total_steps: steps.length,
        data: reviewFlow ? { ...nextValues, _investor_onboarding_version: 2 } : nextValues,
      });
      return true;
    } catch (e) {
      // Persistence failure shouldn't block forward motion — surface as
      // a soft warning the next render.
      setError('Could not save progress. Your changes may not persist.');
      return false;
    }
  }, [flow, steps.length]);

  const goNext = async () => {
    if (pressLock.current) return;
    setError('');
    const step = steps[stepIdx];
    if (step.validate) {
      const v = step.validate(values);
      if (v) { setError(v); return; }
    }
    const next = reviewFlow && values._skipped?.includes(step.key)
      ? { ...values, _skipped: values._skipped.filter(key => key !== step.key) } : values;
    setValues(next);
    await advance(next);
  };

  // Skip for now: the step's answers are dropped, not saved half-filled, so a
  // skipped company step leaves no company name for the Worker to make a
  // project from (`applyFounderOnboarding` skips a seed without one).
  const skipStep = async () => {
    if (pressLock.current) return;
    setError('');
    const next = { ...values };
    for (const key of steps[stepIdx].skip?.clears || []) delete next[key];
    if (reviewFlow) next._skipped = [...new Set([...(next._skipped || []), steps[stepIdx].key])];
    setValues(next);
    await advance(next);
  };

  const advance = async (nextValues) => {
    if (pressLock.current) return;
    pressLock.current = true;
    setBusy(true);
    try {
    if (steps[stepIdx].beforeAdvance) {
      try { await steps[stepIdx].beforeAdvance(nextValues); }
      catch (e) { setError(e?.message || 'Could not save this step'); return; }
    }
    if (stepIdx + 1 < steps.length) {
      const nextStep = returnToReview ? steps.length - 1 : stepIdx + 1;
      const saved = await persist(nextStep, nextValues);
      if (!saved && reviewFlow) return;
      setStepIdx(nextStep);
      setReturnToReview(false);
      setBusy(false);
    } else {
      // Final step — persist final values then mark complete.
      const saved = await persist(stepIdx, nextValues);
      if (!saved && requireFinalSave) { setBusy(false); return; }
      try {
        await api.onboardingComplete(flow);
        setCompleted(true);
        // TELL THE APP SHELL, or its wizard-resume gate undoes this.
        //
        // App.jsx reads onboarding progress in an effect keyed on
        // `[user?.id]`, so it fetches once per session and never again. It
        // therefore still believes this user is mid-wizard, and the moment
        // onFinish() navigates anywhere outside /onboarding the gate fires
        // and sends them back to WIZARD_FOR_LICENCE[their role] — which is
        // how an investor who just finished ended up staring at the FOUNDER
        // wizard. Re-fetching would be a second round trip for a fact we
        // already hold, so we hand it over directly.
        window.dispatchEvent(new CustomEvent(ONBOARDING_COMPLETE_EVENT, { detail: { flow } }));
      } catch (e) {
        setError(e?.message || 'Could not finalize onboarding');
        setBusy(false);
        return;
      }
      setBusy(false);
      if (onFinish) onFinish(nextValues);
    }
    } finally { pressLock.current = false; setBusy(false); }
  };

  const goBack = () => {
    if (pressLock.current) return;
    setError('');
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  if (!hydrated) {
    return (
      <div className={`min-h-[400px] flex items-center justify-center ${onDark ? 'text-white/80' : 'text-gray-500'}`}>
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  if (readError) return <section className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-6 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" role="alert">
    <h2 className="text-xl font-semibold">Your progress is unreadable</h2>
    <p className="mt-2 text-sm">We could not read your saved answers. Try again before changing them.</p>
    <button type="button" className="mt-4 min-h-11 rounded-lg bg-violet-700 px-4 text-white dark:bg-violet-600" onClick={() => setReadAttempt(n => n + 1)}>Try again</button>
  </section>;

  if (completed) {
    if (renderComplete) return renderComplete(values, { resumed: resumedComplete });
    return (
      <div className="max-w-2xl mx-auto bg-white border border-gray-200 rounded-xl p-10 text-center dark:bg-gray-900 dark:border-gray-800">
        <div className="mx-auto h-12 w-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center mb-4">
          <Check size={22} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">You're all set</h2>
        {/* Destination-neutral on purpose: this shell serves the founder,
            investor and partner flows, and each `onFinish` now sends its
            own role somewhere different. Naming Studio here was already
            wrong for two of the three. */}
        <p className="text-sm text-gray-600 mt-2">Onboarding complete — taking you to your workspace.</p>
      </div>
    );
  }

  const step = steps[stepIdx];
  const pct = Math.round(((stepIdx + 1) / steps.length) * 100);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className={`flex items-center justify-between text-xs mb-1.5 ${onDark ? 'text-white/80' : 'text-gray-500'}`}>
          <span>{reviewFlow && stepIdx === steps.length - 1 ? 'Review your answers' : `Step ${stepIdx + 1} of ${reviewFlow ? steps.length - 1 : steps.length}`}</span>
          <span>{pct}%</span>
        </div>
        <div className={`h-1.5 rounded-full overflow-hidden ${onDark ? 'bg-white/25' : 'bg-gray-100'}`}>
          <div className="h-full bg-violet-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 dark:bg-gray-900 dark:border-gray-800">
        <h2 ref={heading} tabIndex={-1} className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">{step.title}</h2>
        {step.description && (
          <p className="text-sm text-gray-600 mt-1 dark:text-gray-300">{step.description}</p>
        )}
        <div className="mt-5">
          {step.render({ values, set: setField, error, edit: (key) => {
            const index = steps.findIndex(s => s.key === key);
            if (busy || index < 0 || index === steps.length - 1) return;
            setError(''); setReturnToReview(true); setStepIdx(index);
          } })}
        </div>
        {error && (
          <div role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
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
          {step.skip && (
            <button
              type="button"
              onClick={skipStep}
              disabled={busy}
              data-testid="onboarding-skip-step"
              className="ml-auto text-sm font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-40 dark:text-gray-300 dark:hover:text-gray-100"
            >
              {step.skip.label}
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={busy}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {stepIdx + 1 === steps.length ? finishLabel : returnToReview ? 'Return to review' : 'Continue'}
            {stepIdx + 1 < steps.length && <ArrowRight size={14} />}
          </button>
        </div>
        {reviewFlow && <div className="mt-5 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
          {confirmRestart ? <><p>Start over? Your saved answers will be cleared only after you confirm.</p><div className="mt-2 flex flex-wrap gap-4">
            <button type="button" disabled={busy} onClick={async () => {
              if (pressLock.current) return;
              pressLock.current = true; setBusy(true);
              try { if (await persist(0, {})) { setValues({}); setStepIdx(0); setReturnToReview(false); setConfirmRestart(false); } }
              finally { pressLock.current = false; setBusy(false); }
            }}>Confirm start over</button><button type="button" disabled={busy} onClick={() => setConfirmRestart(false)}>Keep my answers</button>
          </div></> : <button type="button" disabled={busy} onClick={() => setConfirmRestart(true)}>Start over</button>}
        </div>}
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
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
      />
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3, hint, className = '' }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">{label}</span>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        rows={rows}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 ${className}`}
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
              aria-pressed={active}
              onClick={() => onChange(v)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                active
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700'
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

export function MultiChoiceField({ label, options, value, onChange, searchable = false, disabledValues = [] }) {
  const [search, setSearch] = useState('');
  const arr = Array.isArray(value) ? value : [];
  const toggle = (v) => {
    if (disabledValues.includes(v) && !arr.includes(v)) return;
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };
  return (
    <div>
      <span className="block text-xs font-medium text-gray-700 mb-2 dark:text-gray-300">{label}</span>
      {searchable && <><label className="mb-3 block text-sm text-gray-700 dark:text-gray-300">Search {label.toLowerCase()}<input type="search" value={search} onChange={e => setSearch(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" /></label><p className="mb-2 text-xs text-gray-600 dark:text-gray-400" role="status">{arr.length} picked</p></>}
      <div className="flex flex-wrap gap-2">
        {options.filter(opt => String(typeof opt === 'string' ? opt : opt.label).toLowerCase().includes(search.toLowerCase())).map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const lab = typeof opt === 'string' ? opt : opt.label;
          const active = arr.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              disabled={disabledValues.includes(v) && !active}
              onClick={() => toggle(v)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                active
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700'
              }`}
            >
              {lab}{disabledValues.includes(v) ? ' · In your thesis' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SliderField({ label, value, onChange }) {
  const v = typeof value === 'number' ? value : 0.5;
  // The fill has to be drawn, not accented. `appearance-none` removes the
  // native widget, and `accent-color` only styles a native one — the two
  // together are why these read as five blank pills with nothing to show
  // where the value sat. `--range-pct` drives the gradient stop in the
  // `.axal-range` rule in index.css; the thumb is drawn there too, because
  // a thumb needs per-engine pseudo-elements no utility class can reach.
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-xs font-semibold text-violet-700 tabular-nums dark:text-violet-300">
          {Math.round(v * 100)}%
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--range-pct': `${v * 100}%` }}
        className="axal-range"
        aria-label={label}
      />
    </label>
  );
}

export function SelectField({ label, options, value, onChange, placeholder = 'Select…', required = false, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">
        {label}
        {required && <span className="ml-1 text-violet-600" aria-hidden="true">*</span>}
      </span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
      >
        {/* An empty first option is what makes "nothing chosen" a real state
            rather than a silent default. Without it the browser preselects
            the first country and a required field is satisfied by a value
            the member never looked at. */}
        <option value="">{placeholder}</option>
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const lab = typeof opt === 'string' ? opt : opt.label;
          return <option key={v} value={v}>{lab}</option>;
        })}
      </select>
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}
