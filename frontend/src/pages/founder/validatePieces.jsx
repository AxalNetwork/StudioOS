/**
 * The interview pieces the Ops canvas added to Validate (D635), now drawn by
 * Customer research's record (#1659).
 *
 * `InterviewEvidenceFields` edits an interview's ICP fit, quote consent and
 * company. `PainSeverity` ("How badly did they need it?") moved here from the
 * old Interviews page unchanged (D697, #1659). It is the one piece here that
 * writes for itself, through `api.setInterviewPainSeverity`.
 *
 * D704 (#1666) removed `VerdictPanel`, `earlierDecisions` and `ClaimLinkList`
 * with the Verdict and Hypotheses pages that drew them: a decision is the
 * Verdict module's (D693), and a claim's links are its record's.
 */
import React, { useState } from 'react';
import { api } from '../../lib/api';

const FIT_OPTIONS = [
  ['', 'Not recorded'],
  ['strong', 'Strong'],
  ['partial', 'Partial'],
  ['none', 'None'],
];
const CONSENT_OPTIONS = [
  ['', 'Not asked'],
  ['yes', 'Yes'],
  ['no', 'No'],
];

export function InterviewEvidenceFields({ fit, consent, company, onSave, disabled }) {
  const fitValue = fit == null || fit === '' ? '' : String(fit);
  const consentValue = consent === true ? 'yes' : consent === false ? 'no' : '';
  const save = (patch) => onSave?.(patch);
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="interview-evidence">
      <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
        ICP fit
        <select
          value={fitValue}
          disabled={disabled}
          data-testid="select-icp-fit"
          onChange={(e) => save({ icp_fit: e.target.value || null })}
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {FIT_OPTIONS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
        Quote consent
        <select
          value={consentValue}
          disabled={disabled}
          data-testid="select-quote-consent"
          onChange={(e) => save({ quote_consent: e.target.value === '' ? null : e.target.value === 'yes' })}
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          {CONSENT_OPTIONS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
        Company
        <input
          defaultValue={company || ''}
          disabled={disabled}
          data-testid="input-interviewee-company"
          onBlur={(e) => save({ interviewee_company: e.target.value })}
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
      </label>
    </div>
  );
}

/**
 * How severe was this pain, in this conversation?
 *
 * WRITES `interview_pain_severities`, which migration 211 created with the
 * right shape, a unique index on `(interview_id, phrase_norm)`, and no reader
 * and no writer anywhere in the worker — migration 215's header names it as its
 * example of a column that comes to exist and is never read. The consequence on
 * screen was `/validate/pain-map`'s `Need-to-have` chip, which carried exactly
 * that reason.
 *
 * THREE STATES, NOT TWO. A pain is a need, a nice-to-have, or unjudged — and
 * unjudged is the one that must stay reachable, because "nobody has decided"
 * and "everybody said optional" are different findings and the map reports them
 * differently. Clicking the current answer clears it.
 *
 * OPTIMISTIC, WITH THE SERVER'S ANSWER WINNING. The PUT returns the severity it
 * stored; a failed write rolls the row back to what it was rather than leaving
 * a judgement on screen that is not on file.
 */
export function PainSeverity({ interviewId, pains, onChanged }) {
  const [byPhrase, setByPhrase] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const set = async (phrase, severity) => {
    const current = byPhrase[phrase] ?? null;
    const next = current === severity ? null : severity;
    setBusy(phrase); setError('');
    setByPhrase((m) => ({ ...m, [phrase]: next }));
    try {
      const r = await api.setInterviewPainSeverity(interviewId, phrase, next);
      setByPhrase((m) => ({ ...m, [phrase]: r?.severity ?? next }));
      onChanged?.();
    } catch (e) {
      setByPhrase((m) => ({ ...m, [phrase]: current }));
      setError(e?.message || 'That judgement was not saved.');
    } finally { setBusy(null); }
  };

  return (
    <div className="mt-2">
      <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
        How badly did they need it?
      </div>
      <ul className="mt-1 space-y-1">
        {pains.map((p) => {
          const phrase = typeof p === 'string' ? p : String(p?.pain ?? '');
          if (!phrase) return null;
          const chosen = byPhrase[phrase] ?? null;
          return (
            <li key={phrase} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-axal-muted">{phrase}</span>
              {[['need', 'Need-to-have'], ['nice', 'Nice-to-have']].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={busy === phrase}
                  aria-pressed={chosen === key}
                  onClick={() => set(phrase, key)}
                  data-testid={`button-pain-severity-${key}`}
                  className={`rounded-[6px] border px-2 py-0.5 text-[10.5px] font-semibold disabled:opacity-60 ${
                    chosen === key
                      ? 'border-axal-violet bg-axal-violet/10 text-axal-violet'
                      : 'border-axal-hairline text-axal-muted hover:border-axal-faint'
                  }`}
                >
                  {label}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
