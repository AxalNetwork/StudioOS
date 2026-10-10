import { useState } from 'react';
import { X } from 'lucide-react';
import { initialValues, validate } from './forms';

/**
 * D661 (#1474) — one side sheet for every cycle Add form (`forms.js`), drawn
 * like the cycle action sheets (`Cycle Action.dc.html`, Share an update): a
 * header naming the cycle and the form, the fields, then one primary action.
 *
 * It sends nothing it can already tell is wrong (`validate`), and when the
 * Worker refuses, its own sentence is shown, on the field it names when it
 * names one. Saving closes the sheet and the page reads the module again.
 *
 *   form      a form from `forms.js`, an Add form or an Edit form
 *   current   an Edit form's starting values (`form.valuesOf(row)`)
 *   cycle     the cycle's name, for the header
 *   onSubmit  (values) => Promise — the form's writes, already bound to the venture
 *   onSaved   after a save
 *   onClose
 */
const INPUT = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink outline-none focus:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function Field({ field, value, error, onChange }) {
  const id = `cycle-form-${field.name}`;
  const common = { id, name: field.name, value: value ?? '', onChange: (e) => onChange(e.target.value), 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-error` : field.hint ? `${id}-hint` : undefined };
  let input;
  if (field.type === 'textarea') input = <textarea {...common} rows={4} maxLength={field.max} className={INPUT} />;
  else if (field.type === 'select') {
    input = (
      <select {...common} className={INPUT}>
        <option value="">Choose…</option>
        {(field.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (field.type === 'date') input = <input {...common} type="date" className={INPUT} />;
  else if (field.type === 'money') input = <input {...common} type="text" inputMode="decimal" placeholder="0.00" className={`${INPUT} font-mono tabular-nums`} />;
  else if (field.type === 'score') input = <input {...common} type="number" min={0} max={10} step={1} className={`${INPUT} font-mono tabular-nums`} />;
  else input = <input {...common} type={field.type === 'email' ? 'email' : 'text'} maxLength={field.max} className={INPUT} />;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-semibold text-axal-ink dark:text-gray-100">
        {field.label}{field.required ? <span className="text-axal-muted dark:text-gray-400"> · required</span> : null}
      </label>
      {input}
      {error
        ? <span id={`${id}-error`} role="alert" className="text-[11.5px] text-red-700 dark:text-red-300">{error}</span>
        : field.hint ? <span id={`${id}-hint`} className="text-[11.5px] text-axal-muted dark:text-gray-400">{field.hint}</span> : null}
    </div>
  );
}

export default function RecordFormSheet({ form, current = null, cycle, onSubmit, onSaved, onClose }) {
  const [values, setValues] = useState(() => initialValues(form, current));
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  if (!form) return null;

  const save = async (e) => {
    e.preventDefault();
    const found = validate(form, values);
    setErrors(found);
    setRefusal('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSubmit(values);
      onSaved?.();
      onClose?.();
    } catch (err) {
      const sentence = err?.message || 'This could not be saved. Try again.';
      if (err?.field && form.fields.some((f) => f.name === err.field)) setErrors({ [err.field]: sentence });
      else setRefusal(sentence);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside role="dialog" aria-label={form.title} data-testid="cycle-form-sheet" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950">
      <header className="border-b border-axal-hairline p-5 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.1em] text-axal-faint dark:text-gray-500">{cycle}</div>
            <h2 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">{form.title}</h2>
            {form.lead && <p className="m-0 mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">{form.lead}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100"><X size={18} /></button>
        </div>
      </header>
      <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
          {refusal && <p role="alert" data-testid="cycle-form-refusal" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{refusal}</p>}
          {form.fields.map((f) => (
            <Field key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => setValues((old) => ({ ...old, [f.name]: v }))} />
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-axal-hairline p-4 dark:border-gray-800">
          <button type="button" onClick={onClose} className="rounded-[9px] border border-axal-hairline px-3.5 py-2 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={busy} data-testid="cycle-form-save" className="rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </aside>
  );
}
