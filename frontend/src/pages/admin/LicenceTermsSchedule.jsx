/**
 * D801 (#2234) — the licence's terms schedule on HQ's licence page (canvas
 * board L9): D797's sections, each value editable in its unit with a
 * "Contract §" beside it, and "Save terms" with the reason the history keeps.
 *
 * THE FIELDS COME FROM D797'S MODULE (`lib/licenceTermsForm.js` imports
 * `services/licenceTerms.ts`), so a term D797 adds appears here with no edit.
 *
 * ONLY WHAT CHANGED IS SENT. `buildSave` compares the form with the stored
 * schedule and sends those keys alone; a cleared field is `null`, which reads
 * "Not recorded". The PUT takes the money-write bar: a lapsed step-up raises
 * the shared step-up prompt (`StepUpModal`) and the save is retried once.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { licenceTermsApi } from '../../lib/api/licenceTerms';
import { reportError } from '../../lib/log';
import {
  NOT_RECORDED, buildSave, displayValue, enumLabel, initialForm, termRowId, termSections, unitOf,
} from '../../lib/licenceTermsForm';

const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';

/** The server's refusal as a sentence: the field it names, or the step-up it needs. */
export function saveError(e) {
  if (e?.code === 'step_up_required') return 'Your step-up has lapsed. Confirm with your authenticator, then save again. Nothing was saved.';
  return e?.message || 'The terms could not be saved. Nothing was changed.';
}

function TermInput({ field, value, onChange, currency }) {
  const id = `term-input-${field.key}`;
  if (field.type === 'enum') {
    return (
      <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={field.label}>
        <option value="">{NOT_RECORDED}</option>
        {field.values.map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}
      </select>
    );
  }
  if (field.type === 'bool') {
    return (
      <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={field.label}>
        <option value="">{NOT_RECORDED}</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (field.type === 'text') {
    return (
      <textarea id={id} rows={2} maxLength={field.max} className={inputCls} value={value}
        placeholder={NOT_RECORDED} aria-label={field.label} onChange={(e) => onChange(e.target.value)} />
    );
  }
  const unit = unitOf(field, currency);
  return (
    <div className="flex items-center gap-2">
      <input id={id} inputMode="decimal" className={inputCls} value={value} placeholder={NOT_RECORDED}
        aria-label={field.label} onChange={(e) => onChange(e.target.value)} />
      {unit && <span className="shrink-0 text-[11px] text-gray-500">{unit}</span>}
    </div>
  );
}

/** The editor, given the stored schedule. Separate from the loader so a test can draw it. */
export function TermsScheduleForm({ licence, stored, highlight, onSave }) {
  const [form, setForm] = useState(() => initialForm(stored));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm(initialForm(stored)); }, [stored]);
  useEffect(() => {
    if (!highlight) return;
    const el = typeof document !== 'undefined' ? document.getElementById(termRowId(highlight)) : null;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  const setValue = (key) => (v) => { setSaved(false); setForm((f) => ({ ...f, values: { ...f.values, [key]: v } })); };
  const setSection = (key) => (v) => { setSaved(false); setForm((f) => ({ ...f, sections: { ...f.sections, [key]: v } })); };

  async function save(e) {
    e?.preventDefault?.();
    setServerError('');
    const built = buildSave(stored, form, reason);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      await onSave(built.body);
      setReason('');
      setSaved(true);
    } catch (err) {
      reportError('licence_terms_schedule_save_failed', err);
      setServerError(saveError(err));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} data-testid="licence-terms-schedule">
      {termSections().map((s) => (
        <section key={s.group} className="mb-5" data-testid={`terms-section-${s.group}`}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{s.title}</h3>
          <div className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {s.fields.map((f) => (
              <div key={f.key} id={termRowId(f.key)} data-testid={`term-row-${f.key}`}
                className={`grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_7rem] sm:items-start ${highlight === f.key ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                <div>
                  <label htmlFor={`term-input-${f.key}`} className="text-sm text-gray-800 dark:text-gray-200">{f.label}</label>
                  <div className="text-[11px] text-gray-500">Now: {displayValue(f, stored?.terms?.[f.key] ?? null, licence.currency)}</div>
                </div>
                <div>
                  <TermInput field={f} value={form.values[f.key]} onChange={setValue(f.key)} currency={licence.currency} />
                  {errors[f.key] && <p className="mt-1 text-[11px] text-red-600" role="alert">{errors[f.key]}</p>}
                </div>
                <label className="text-[11px] text-gray-500">
                  Contract §
                  <input className={`${inputCls} mt-0.5`} value={form.sections[f.key]} maxLength={40} placeholder="§"
                    aria-label={`${f.label}: contract section`} onChange={(e) => setSection(f.key)(e.target.value)} />
                </label>
              </div>
            ))}
          </div>
        </section>
      ))}
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Reason for this change · kept in the licence&apos;s history</span>
        <textarea rows={2} maxLength={500} className={`${inputCls} mt-1`} value={reason}
          placeholder="Why these terms are changing" onChange={(e) => { setSaved(false); setReason(e.target.value); }} />
      </label>
      {errors.reason && <p className="mt-1 text-[11px] text-red-600" role="alert">{errors.reason}</p>}
      {errors.form && <p className="mt-1 text-[11px] text-gray-600" role="status">{errors.form}</p>}
      {serverError && <p className="mt-1 text-[11px] text-red-600" role="alert">{serverError}</p>}
      {saved && <p className="mt-1 text-[11px] text-green-700" role="status">Saved. The change is in the licence&apos;s history.</p>}
      <button type="submit" disabled={busy}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save terms'}
      </button>
    </form>
  );
}

/** The section: loads the schedule, saves it, and tells the page so its history reloads. */
export default function LicenceTermsSchedule({ licence, highlight, onSaved }) {
  const [stored, setStored] = useState(undefined);
  const load = useCallback(() => {
    licenceTermsApi.get(licence.uid)
      .then((r) => setStored({ terms: r?.terms || {}, sections: r?.sections || {} }))
      .catch((e) => { reportError('licence_terms_schedule_load_failed', e); setStored(null); });
  }, [licence.uid]);
  useEffect(load, [load]);

  if (stored === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  if (stored === null) return <p className="text-sm text-red-600">The terms schedule could not be read, so it cannot be edited here.</p>;
  return (
    <TermsScheduleForm licence={licence} stored={stored} highlight={highlight}
      onSave={async (body) => {
        const r = await licenceTermsApi.save(licence.uid, body);
        setStored({ terms: r?.terms || {}, sections: r?.sections || {} });
        onSaved?.();
      }} />
  );
}
