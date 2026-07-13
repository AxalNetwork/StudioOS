// Fit v2 — one question, rendered by kind. Self-contained (no dependency on
// the gamified play mechanics) so the answer contract stays exactly what the
// worker normalizer expects (services/fitDecision.ts::normalizeV2Answer):
//   likert / confidence_check → "0".."5"
//   forced_choice / sjt / tradeoff → option key
//   rank_order → comma-joined option keys, best-first (partial order allowed)
//   multi_select → comma-joined option keys
//   behavioral_evidence → free text (min_len gate server-side)
// Controlled: `value` is the raw string, `onChange(next)` receives the next one.
import React from 'react';
import { Check, GripVertical } from 'lucide-react';

const OPTION_BASE =
  'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors cursor-pointer ' +
  'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 ' +
  'hover:border-violet-400 dark:hover:border-violet-500';
const OPTION_ACTIVE =
  'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors cursor-pointer ' +
  'border-violet-500 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-900 dark:text-violet-100';

function ScaleInput({ value, onChange, disabled }) {
  const current = value === '' || value == null ? null : Number(value);
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup">
      {[0, 1, 2, 3, 4, 5].map((n) => {
        const active = current === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(String(n))}
            className={
              active
                ? 'w-10 h-10 rounded-lg text-sm font-semibold bg-violet-600 text-white dark:bg-violet-500'
                : 'w-10 h-10 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:border-violet-400 dark:hover:border-violet-500'
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function ChoiceInput({ options, value, onChange, disabled }) {
  return (
    <div className="space-y-2">
      {(options || []).map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? '' : o.key)}
            className={active ? OPTION_ACTIVE : OPTION_BASE}
          >
            <span className="flex items-start gap-2">
              <span
                className={
                  active
                    ? 'mt-0.5 w-4 h-4 rounded-full bg-violet-600 dark:bg-violet-400 flex items-center justify-center flex-shrink-0'
                    : 'mt-0.5 w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 flex-shrink-0'
                }
              >
                {active ? <Check size={11} className="text-white dark:text-gray-900" /> : null}
              </span>
              <span>{o.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Tap-to-rank: tapping an unranked option appends it to the order; tapping a
// ranked one removes it. Produces a partial or full order — both are valid.
function RankInput({ options, value, onChange, disabled }) {
  const order = value ? value.split(',').filter(Boolean) : [];
  const toggle = (key) => {
    if (disabled) return;
    const next = order.includes(key) ? order.filter((k) => k !== key) : [...order, key];
    onChange(next.join(','));
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">Tap in order — most like you first. Tap again to remove.</p>
      {(options || []).map((o) => {
        const idx = order.indexOf(o.key);
        const active = idx >= 0;
        return (
          <button key={o.key} type="button" disabled={disabled} onClick={() => toggle(o.key)} className={active ? OPTION_ACTIVE : OPTION_BASE}>
            <span className="flex items-center gap-2">
              {active ? (
                <span className="w-5 h-5 rounded-full bg-violet-600 dark:bg-violet-400 text-white dark:text-gray-900 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </span>
              ) : (
                <GripVertical size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              )}
              <span>{o.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MultiInput({ options, value, onChange, disabled }) {
  const selected = new Set(value ? value.split(',').filter(Boolean) : []);
  const toggle = (key) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next).join(','));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {(options || []).map((o) => {
        const active = selected.has(o.key);
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => toggle(o.key)}
            className={
              active
                ? 'rounded-full px-3 py-1.5 text-sm border border-violet-500 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-900 dark:text-violet-100'
                : 'rounded-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:border-violet-400 dark:hover:border-violet-500'
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function EvidenceInput({ value, onChange, minLen, disabled }) {
  const len = (value || '').length;
  const target = minLen || 80;
  return (
    <div>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={5}
        placeholder="A specific, real story — what happened, what you did, what it cost or produced…"
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 p-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      <div className={`mt-1 text-xs ${len >= target ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
        {len} / {target}+ characters for a scoreable example
      </div>
    </div>
  );
}

export default function FitQuestionCard({ question, value, onChange, disabled = false, index }) {
  const q = question;
  let input;
  switch (q.kind) {
    case 'likert':
    case 'confidence_check':
      input = <ScaleInput value={value} onChange={onChange} disabled={disabled} />;
      break;
    case 'forced_choice':
    case 'sjt':
    case 'tradeoff':
      input = <ChoiceInput options={q.options} value={value} onChange={onChange} disabled={disabled} />;
      break;
    case 'rank_order':
      input = <RankInput options={q.options} value={value} onChange={onChange} disabled={disabled} />;
      break;
    case 'multi_select':
      input = <MultiInput options={q.options} value={value} onChange={onChange} disabled={disabled} />;
      break;
    case 'behavioral_evidence':
      input = <EvidenceInput value={value} onChange={onChange} minLen={q.min_len} disabled={disabled} />;
      break;
    default:
      input = <EvidenceInput value={value} onChange={onChange} minLen={q.min_len} disabled={disabled} />;
  }
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:p-5">
      <div className="mb-3">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {index != null ? <span className="text-gray-400 dark:text-gray-500 mr-1.5">{index}.</span> : null}
          {q.prompt}
        </p>
        {q.hint ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{q.hint}</p> : null}
      </div>
      {input}
    </div>
  );
}
