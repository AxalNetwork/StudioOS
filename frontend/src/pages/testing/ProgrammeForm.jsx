import React, { useState } from 'react';
import { MAX_QUESTIONS, ROLE_OPTIONS, formFrom, formToPayload, refusalText } from './programmeModel';

/**
 * D815 (#2261) — "New programme", and editing a draft, for a partner (D4) and
 * for HQ's own (D5). The same fields D812 stores: product, summary, what
 * testers do, time needed, the four dates, places, who can apply, and up to
 * five screening questions.
 *
 * `onSave(payload)` writes it (create or PATCH) and resolves with the saved
 * programme; a refusal is shown in the Worker's own words. `classes` carries
 * the caller's accent: amber in the partner workspace, violet on HQ.
 *
 * The logo is not asked for: D812 stores a `logo_key`, and nothing uploads one
 * yet (D815 §3).
 */
const baseInput = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';
const baseButton = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50';
const ghost = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800';
const label = 'block text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

export default function ProgrammeForm({ programme = null, onSave, onCancel, saveLabel = 'Save draft', classes = {} }) {
  const [form, setForm] = useState(() => formFrom(programme));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = classes.input || baseInput;
  const button = classes.button || baseButton;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleRole = (role) => setForm((f) => ({
    ...f,
    eligible_roles: f.eligible_roles.includes(role) ? f.eligible_roles.filter((r) => r !== role) : [...f.eligible_roles, role],
  }));
  const setQuestion = (i) => (e) => setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === i ? e.target.value : q)) }));
  const addQuestion = () => setForm((f) => (f.questions.length >= MAX_QUESTIONS ? f : { ...f, questions: [...f.questions, ''] }));
  const removeQuestion = (i) => () => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }));

  async function submit(e) {
    e?.preventDefault?.();
    const out = formToPayload(form);
    if (out.error) { setError(out.error); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave(out.payload);
    } catch (err) {
      setError(refusalText(err, 'Axal could not save this programme. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const text = (key, title, hint, rows) => (
    <label className="block">
      <span className={label}>{title}</span>
      {rows
        ? <textarea rows={rows} value={form[key]} onChange={set(key)} className={input} data-testid={`programme-${key}`} />
        : <input value={form[key]} onChange={set(key)} className={input} data-testid={`programme-${key}`} />}
      {hint && <span className="mt-1 block text-[11px] text-axal-faint">{hint}</span>}
    </label>
  );
  const date = (key, title) => (
    <label className="block">
      <span className={label}>{title}</span>
      <input type="date" value={form[key]} onChange={set(key)} className={input} data-testid={`programme-${key}`} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="programme-form">
      {text('product_name', 'Product')}
      {text('summary', 'Summary', 'One or two sentences members read on the programme card.', 2)}
      {text('tester_tasks', 'What testers do', null, 3)}
      {text('time_needed', 'Time needed', 'For example, 2 hours over 2 weeks.')}
      <div className="grid gap-3 sm:grid-cols-2">
        {date('opens_at', 'Applications open')}
        {date('closes_at', 'Applications close')}
        {date('testing_starts', 'Testing starts')}
        {date('testing_ends', 'Testing ends')}
      </div>
      <label className="block">
        <span className={label}>Places</span>
        <input inputMode="numeric" value={form.places} onChange={set('places')} className={input} data-testid="programme-places" />
      </label>
      <fieldset>
        <legend className={label}>Who can apply</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {ROLE_OPTIONS.map(([key, name]) => (
            <label key={key} className="inline-flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={form.eligible_roles.includes(key)} onChange={() => toggleRole(key)}
                data-testid={`programme-role-${key}`} />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={label}>Screening questions ({form.questions.length} of {MAX_QUESTIONS})</legend>
        <div className="mt-1 space-y-2">
          {form.questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <input value={q} onChange={setQuestion(i)} className={input} aria-label={`Question ${i + 1}`}
                data-testid={`programme-question-${i}`} />
              <button type="button" onClick={removeQuestion(i)} className={`${ghost} mt-1`}>Remove</button>
            </div>
          ))}
          {form.questions.length < MAX_QUESTIONS && (
            <button type="button" onClick={addQuestion} className={ghost} data-testid="programme-add-question">Add a question</button>
          )}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="programme-form-error">{error}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={busy} className={button} data-testid="programme-save">{busy ? 'Saving…' : saveLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className={ghost}>Cancel</button>}
      </div>
    </form>
  );
}
