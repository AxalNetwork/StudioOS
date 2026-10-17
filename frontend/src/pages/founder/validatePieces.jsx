/**
 * The three controls the Ops canvas adds to Validate (D635).
 *
 * The pages already exist. These are the pieces they were not drawing:
 * the venture's own decision, the evidence on an interview row, and the
 * unlink on a claim's pain themes.
 *
 * `PainSeverity` ("How badly did they need it?") moved here from
 * `FounderValidateWorkspace.jsx` unchanged (D697, #1659), so the interview
 * record can draw it once that page is gone. It is the one piece here that
 * writes for itself, through `api.setInterviewPainSeverity`.
 */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Unreadable, Unrecorded } from '../../ui/Honesty';

const DECISION_LABEL = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
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

export function earlierDecisions(payload) {
  const rows = Array.isArray(payload?.history) ? payload.history : [];
  const currentId = payload?.current?.id;
  return rows.filter((row) => row && row.id !== currentId);
}

function decisionLabel(value) {
  return DECISION_LABEL[value] || value || '';
}

export function VerdictPanel({ phase, current, earlier = [], onRecord, onRetry, saving, saveError }) {
  const [choice, setChoice] = useState('proceed');
  const [reasoning, setReasoning] = useState('');
  if (phase === 'hidden') return null;
  if (phase === 'loading') {
    return <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="text-verdict-loading">Reading the decisions…</p>;
  }
  if (phase === 'unreadable') {
    return (
      <Unreadable
        what="Decisions"
        claim="This is not a claim that no decision was recorded."
        onRetry={onRetry}
      />
    );
  }
  const record = () => onRecord?.(choice, reasoning);
  return (
    <section data-testid="card-venture-decision" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <h2 className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Verdict</h2>
      <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">Record Proceed, Pivot or Stop with your reasoning. A later decision keeps the earlier ones.</p>
      {phase === 'empty' && (
        <p className="mt-3 text-[12.5px] text-gray-600 dark:text-gray-300" data-testid="text-verdict-empty">No decision recorded yet.</p>
      )}
      {current && (
        <div className="mt-3" data-testid="text-decision-current">
          <div className="text-base font-extrabold text-gray-900 dark:text-gray-100">{decisionLabel(current.decision)}</div>
          {current.reasoning
            ? <p className="mt-1 text-[12.5px] text-gray-600 dark:text-gray-300">{current.reasoning}</p>
            : <p className="mt-1 text-[12.5px]"><Unrecorded reason="Reasoning: this decision was recorded without any.">Not recorded</Unrecorded></p>}
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Recorded {String(current.decided_at || '').slice(0, 10)}</div>
        </div>
      )}
      {earlier.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="list-decision-earlier">
          {earlier.map((row) => (
            <li key={row.id} className="text-[12px] text-gray-600 dark:text-gray-300" data-testid={`text-decision-earlier-${row.id}`}>
              <span className="font-semibold">{decisionLabel(row.decision)}</span>
              {' · '}
              {String(row.decided_at || '').slice(0, 10)}
              {row.reasoning ? ` · ${row.reasoning}` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row" data-testid="verdict-options">
        {['proceed', 'pivot', 'stop'].map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`button-decision-${key}`}
            onClick={() => setChoice(key)}
            className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold ${choice === key ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
          >
            {decisionLabel(key)}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-[11px] font-semibold text-gray-500 dark:text-gray-400">
        Reasoning
        <textarea
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          data-testid="input-decision-reasoning"
          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          rows={3}
        />
      </label>
      {saveError && <p className="mt-2 text-[12px] text-rose-700 dark:text-rose-300" data-testid="text-decision-error">{saveError}</p>}
      <button
        type="button"
        onClick={record}
        disabled={saving}
        data-testid="button-record-decision"
        className="mt-3 rounded-lg bg-violet-600 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {phase === 'empty' ? 'Record a decision' : 'Record a later decision'}
      </button>
    </section>
  );
}

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

const DIR_LABEL = { supports: 'Supporting', contradicts: 'Contradicting' };

export function ClaimLinkList({ links = [], groups = [], withheld, onUnlink, busyId }) {
  const titleOf = (id) => groups.find((g) => g.id === id)?.title || null;
  return (
    <div className="mt-2" data-testid="claim-links">
      {withheld && (
        <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200" data-testid="text-verdict-withheld">
          Verdict withheld
        </p>
      )}
      {links.length === 0 ? (
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400" data-testid="text-claim-links-empty">This claim has no linked themes.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {links.map((link) => {
            const title = titleOf(link.pain_group_id);
            const dir = DIR_LABEL[link.direction];
            return (
              <li key={link.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-[12px]">
                <span>
                  {title || <Unrecorded reason="Pain theme: this link names a theme that is not on the project.">Not recorded</Unrecorded>}
                  {' · '}
                  {dir || <Unrecorded reason="Direction: this link was made without supporting or contradicting set.">Not recorded</Unrecorded>}
                </span>
                <button
                  type="button"
                  data-testid={`button-unlink-${link.id}`}
                  disabled={busyId === link.id}
                  onClick={() => onUnlink?.(link.id)}
                  className="text-[11px] font-semibold text-rose-700 underline dark:text-rose-300"
                >
                  Unlink
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
