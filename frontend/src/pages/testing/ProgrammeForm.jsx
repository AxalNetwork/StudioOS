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
 * D1202 (#3152, TST7): with `logo`, the form also takes a square PNG or SVG
 * logo, which the caller uploads once the programme is saved (D1199's routes
 * need its uid): `onSave(payload, { file, remove })`. The type and size are
 * checked here; that it is square, and safe, the Worker decides and says.
 */
const baseInput = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';
const baseButton = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50';
const ghost = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800';
const label = 'block text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

// The Worker's own limits and sentences (services/testingLogo.ts, D1199).
export const LOGO_TYPES = ['image/png', 'image/svg+xml'];
export const LOGO_MAX_BYTES = 256 * 1024;
/** Why a chosen logo file cannot be sent, or null. */
export function logoProblem(file) {
  if (!file) return null;
  if (!LOGO_TYPES.includes(file.type) && !/\.(png|svg)$/i.test(String(file.name || ''))) return 'A logo is a PNG or an SVG file.';
  if (Number(file.size) > LOGO_MAX_BYTES) return 'A logo is at most 256 KB.';
  if (Number(file.size) === 0) return 'That file is empty.';
  return null;
}

export default function ProgrammeForm({ programme = null, onSave, onCancel, saveLabel = 'Save draft', classes = {}, logo = false }) {
  const [form, setForm] = useState(() => formFrom(programme));
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
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
    const bad = logo ? logoProblem(logoFile) : null;
    if (bad) { setError(bad); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave(out.payload, logo ? { file: logoFile, remove: removeLogo && !logoFile } : undefined);
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
      {logo && (
        <div className="block" data-testid="programme-logo">
          <span className={label}>Logo · square, PNG or SVG</span>
          <input type="file" accept="image/png,image/svg+xml,.png,.svg" className={input}
            onChange={(e) => { const file = e.target.files?.[0] || null; setLogoFile(file); setRemoveLogo(false); setError(logoProblem(file)); }}
            data-testid="programme-logo-file" />
          <span className="mt-1 block text-[11px] text-axal-faint">
            {logoFile ? `${logoFile.name} is uploaded when you save.` : programme?.logo_key && !removeLogo ? 'This program has a logo. Choose a file to replace it.' : 'At most 256 KB. Without one, the program shows its first letter.'}
          </span>
          {programme?.logo_key && !logoFile && !removeLogo
            ? <button type="button" className={`${ghost} mt-1`} onClick={() => setRemoveLogo(true)} data-testid="programme-logo-remove">Remove the logo</button>
            : null}
        </div>
      )}
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
      {/* D1204 (TST16): a page may pin this bar and size its buttons on a phone (`classes.bar`, `.save`, `.cancel`). */}
      <div className={`flex flex-wrap gap-2 pt-1 ${classes.bar || ''}`} data-testid="programme-form-bar">
        <button type="submit" disabled={busy} className={`${button} ${classes.save || ''}`} data-testid="programme-save">{busy ? 'Saving…' : saveLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className={`${ghost} ${classes.cancel || ''}`} data-testid="programme-cancel">Cancel</button>}
      </div>
    </form>
  );
}
