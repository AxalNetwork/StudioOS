/**
 * D695 PR 1: reusable form body, not yet mounted by CycleRoute.
 * The parent owns navigation, API writes and per-row keys. Legacy forms are
 * adapted here until their registry owners merge; no registry is changed early.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Lightbox from '../../ui/Lightbox.jsx';
import { MODULES } from './modules.js';
import { CYCLES, safeHref } from './cycleModel.js';
import { validate } from './forms.js';

const INPUT = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-[9px] text-[13px] text-axal-ink outline-none focus:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-lg:rounded-xl';
const LABEL = 'text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400';
const CHOICE = 'flex cursor-pointer max-lg:min-h-9 items-center gap-2 rounded-full border px-[11px] py-1.5 text-xs font-semibold has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-axal-violet dark:has-[:focus-visible]:outline-violet-400';
const SELECTED = 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300';
const UNSELECTED = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
export function cleanFormCopy(value, { money = false } = {}) {
  const copy = String(value ?? '').replace(/\[|\]/g, '');
  return money ? copy.replace(/€/g, '
const own = (value, key) => value != null && Object.hasOwn(value, key);
const linkOf = (href) => typeof href === 'string' && !/[\\\u0000-\u001f\u007f]/.test(href) ? safeHref(href) : null;

/** The single boundary for canvas/Worker fields and today's legacy fields. */
export function formFields(form, loaded = {}) {
  return (form?.fields ?? []).map((source) => {
    const field = { ...source, ...(loaded?.[source.name] ?? {}) };
    const kind = field.kind || (field.type === 'select' ? 'CH' : 'T');
    const options = (field.options ?? field.opts ?? []).map((option) => {
      if (typeof option === 'string') return { value: option, label: cleanFormCopy(option) };
      if (Array.isArray(option)) return { value: String(option[0]), label: cleanFormCopy(option[0]), meta: cleanFormCopy(option[1]), checked: !!option[2] };
      return { ...option, value: String(option.value ?? option.t ?? option.label), label: cleanFormCopy(option.label ?? option.t ?? option.value), meta: cleanFormCopy(option.meta ?? option.m), checked: !!(option.checked ?? option.on) };
    });
    return { ...field, kind, label: cleanFormCopy(field.k ?? field.label), input: field.input ?? field.type ?? 'text', options,
      parts: field.parts ? formFields({ fields: field.parts }, loaded) : null };
  });
}

export function fieldVisible(field, values) {
  if (!field.when) return true;
  if (typeof field.when === 'function') return !!field.when(values);
  const value = values[field.when.name];
  return Array.isArray(value) ? value.includes(field.when.value) : value === field.when.value;
}
const leaves = (fields, values) => fields.flatMap((field) => fieldVisible(field, values) ? field.parts ? leaves(field.parts, values) : [field] : []);

export function formValues(fields, current = null, queryValues = {}) {
  const values = {};
  const walk = (list) => list.forEach((field) => {
    if (field.parts) { walk(field.parts); return; }
    let value = own(current, field.name) ? current[field.name] : own(queryValues, field.name) ? queryValues[field.name]
      : own(field, 'value') ? field.value : own(field, 'initial') ? field.initial : field.def;
    if (field.kind === 'CK') {
      value = Array.isArray(value) ? value.map(String) : field.options.filter((option) => option.checked).map((option) => option.value);
    } else {
      if (typeof value === 'number' && field.kind === 'CH' && !field.options.some((option) => option.value === String(value))) value = field.options[value]?.value;
      value = value == null ? (field.options.find((option) => option.checked)?.value ?? '') : String(value);
    }
    values[field.name] = value;
  });
  walk(fields);
  return values;
}

/** Hidden fields are neither validated nor sent (e.g. a signal's stale amount). */
export function submittedValues(fields, values) {
  return Object.fromEntries(leaves(fields, values).map((field) => [field.name, values[field.name]]));
}
export function formErrors(form, fields, values) {
  const visible = leaves(fields, values);
  const errors = validate({ ...form, fields: visible.map((field) => ({ ...field, type: field.kind === 'CH' ? 'select' : field.input })) }, submittedValues(fields, values));
  for (const field of visible.filter((item) => item.kind === 'CK')) {
    const selected = Array.isArray(values[field.name]) ? values[field.name] : [];
    if (field.required && !selected.length) errors[field.name] = field.label + ' is required.';
    else if (selected.some((value) => !field.options.some((option) => option.value === value))) errors[field.name] = 'Pick the recorded choices for ' + field.label.toLowerCase() + '.';
  }
  return errors;
}

function Note({ note, values, id, name }) {
  const content = typeof note === 'function' ? note(values) : note;
  if (!content) return null;
  const href = typeof content === 'object' ? linkOf(content.href) : null;
  return <p id={id} data-testid={'cycle-form-note-' + name} className="m-0 text-xs leading-normal text-axal-muted dark:text-gray-400">
    {cleanFormCopy(typeof content === 'object' ? content.text : content)}
    {href && <> <a href={href} className="font-semibold text-axal-violet underline dark:text-violet-300">Connect a tool</a></>}
  </p>;
}

function Field({ field, values, errors, setValue, prefix, busy, compact = false }) {
  if (!fieldVisible(field, values)) return null;
  const id = prefix + '-' + field.name;
  const error = errors[field.name];
  const description = [error ? id + '-error' : null, field.note || field.hint ? id + '-note' : null].filter(Boolean).join(' ') || undefined;
  if (field.parts) return <fieldset className="min-w-0 space-y-1.5">
    <legend className={LABEL}>{field.label}</legend>
    <div className="grid grid-cols-2 gap-2">{field.parts.map((part) => <Field key={part.name} field={part} values={values} errors={errors} setValue={setValue} prefix={prefix} busy={busy} compact />)}</div>
    <Note note={field.note} values={values} id={id + '-note'} name={field.name} />
  </fieldset>;
  const common = { id, name: field.name, 'data-testid': 'cycle-form-' + field.name, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': description, 'aria-required': field.required || undefined, disabled: busy || field.disabled };
  const value = values[field.name];
  const group = field.kind === 'CH' || field.kind === 'CK';
  let input;
  if (group) {
    const checked = (option) => field.kind === 'CH' ? value === option.value : Array.isArray(value) && value.includes(option.value);
    input = <div role={field.kind === 'CH' ? 'radiogroup' : 'group'} aria-labelledby={id + '-label'} aria-describedby={description} className={field.kind === 'CH' ? 'flex flex-wrap gap-1.5' : 'space-y-1'}>
      {field.options.length ? field.options.map((option, index) => <label key={option.value} className={field.kind === 'CH'
        ? CHOICE + ' ' + (checked(option) ? SELECTED : UNSELECTED)
        : 'flex max-lg:min-h-12 cursor-pointer items-center gap-2.5 rounded-[9px] border border-axal-hairline px-2.5 py-2 text-[12.5px] has-[:disabled]:cursor-default has-[:disabled]:opacity-50 dark:border-gray-700'}>
        <input {...common} id={id + '-' + index} type={field.kind === 'CH' ? 'radio' : 'checkbox'} value={option.value} checked={checked(option)} disabled={common.disabled || option.disabled} onChange={() => {
          if (field.kind === 'CH') setValue(field.name, option.value);
          else setValue(field.name, checked(option) ? value.filter((item) => item !== option.value) : [...(Array.isArray(value) ? value : []), option.value]);
        }} className={field.kind === 'CH' ? 'sr-only' : 'h-4 w-4 accent-axal-violet dark:accent-violet-500'} />
        <span className="flex-1 text-axal-ink dark:text-gray-200">{option.label}</span>
        {option.meta && <span className="text-right text-[11.5px] text-axal-muted dark:text-gray-400">{option.meta}</span>}
      </label>) : <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{field.empty || 'No ' + field.label.toLowerCase() + ' recorded yet.'}</p>}
    </div>;
  } else if (field.input === 'file') {
    input = <input {...common} type="file" accept={field.accept} onChange={(event) => setValue(field.name, event.target.files?.[0] ?? null)} className={INPUT} />;
  } else {
    const props = { ...common, value: value ?? '', onChange: (event) => setValue(field.name, event.target.value), maxLength: field.max, placeholder: cleanFormCopy(field.ph ?? field.placeholder, { money: field.input === 'money' }), className: INPUT, style: field.h ? { minHeight: field.h } : undefined };
    if (field.input === 'textarea' || (field.input === 'text' && parseFloat(field.h) >= 48)) input = <textarea {...props} rows={2} style={{ minHeight: field.h || 56 }} />;
    else input = <input {...props} type={['date', 'email', 'number'].includes(field.input) ? field.input : field.input === 'score' ? 'number' : 'text'} inputMode={field.input === 'money' ? 'decimal' : undefined} min={field.input === 'score' ? 0 : undefined} max={field.input === 'score' ? 10 : undefined} step={field.input === 'score' ? 1 : undefined} />;
  }
  return <div className="flex min-w-0 flex-col gap-1.5">
    {group ? <span id={id + '-label'} className={LABEL}>{field.label}</span> : <label htmlFor={id} className={compact ? 'sr-only' : LABEL}>{field.label}</label>}
    {input}
    {error && <p id={id + '-error'} role="alert" className="m-0 text-[11.5px] text-red-700 dark:text-red-300">{error}</p>}
    <Note note={field.note ?? field.hint} values={values} id={id + '-note'} name={field.name} />
  </div>;
}

export default function FormLightbox({ form: base, current = null, cycle, slug, moduleName, onSubmit, onSaved, onClose, loadOptions = null, search = '', bar }) {
  const id = useId();
  const initialFields = useMemo(() => formFields(base), [base]);
  const queryValues = useMemo(() => typeof base?.fromQuery === 'function' ? base.fromQuery(new URLSearchParams(search)) : {}, [base, search]);
  const [values, setValues] = useState(() => formValues(initialFields, current, queryValues));
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(loadOptions ? undefined : {});
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const fields = useMemo(() => formFields(base, loaded), [base, loaded]);
  useEffect(() => {
    if (!loadOptions) return undefined;
    let live = true;
    Promise.resolve().then(loadOptions).then((read) => {
      if (!live) return;
      const result = read ?? {};
      setLoaded(result);
      setValues(formValues(formFields(base, result), current, queryValues));
    }, (error) => { if (live) { setLoaded(null); setRefusal(error?.message || 'The choices could not be read.'); } });
    return () => { live = false; };
    // The caller keys a mounted form per row; a new callback does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!base) return null;
  const cycleKey = String(cycle ?? '').toLowerCase();
  const name = moduleName || MODULES[cycleKey]?.find((module) => module.slug === slug)?.name;
  const eyebrow = [CYCLES[cycleKey]?.name || cycle, name].filter(Boolean).join(' · ');
  const save = async (event) => {
    event.preventDefault();
    if (saving.current || !loaded || done) return;
    const found = formErrors(base, fields, values);
    setErrors(found); setRefusal('');
    if (Object.keys(found).length) return;
    saving.current = true; setBusy(true);
    try {
      const result = await onSubmit(submittedValues(fields, values));
      const completion = base.done?.(result);
      if (completion) setDone(completion);
      onSaved?.(result);
      if (!completion) onClose?.();
    } catch (error) {
      const sentence = error?.message || 'This could not be saved. Try again.';
      if (error?.field && leaves(fields, values).some((field) => field.name === error.field)) setErrors({ [error.field]: sentence });
      else setRefusal(sentence);
    } finally { saving.current = false; setBusy(false); }
  };
  const setValue = (name, value) => setValues((old) => ({ ...old, [name]: value }));
  const footer = <div className="flex flex-wrap items-center justify-between gap-2.5 max-lg:flex-col max-lg:items-stretch">
    {base.foot && <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{cleanFormCopy(base.foot)}</p>}
    <div className="flex justify-end gap-2 max-lg:flex-col">
      <button type="button" onClick={onClose} className="rounded-[9px] border border-axal-hairline bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{done ? 'Close' : 'Cancel'}</button>
      {!done && <button type="submit" form={id} disabled={busy || !loaded} data-testid="cycle-form-save" className="rounded-[9px] bg-axal-violet px-3.5 py-[9px] text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600 dark:text-white max-lg:h-[52px] max-lg:w-full">{busy ? 'Saving…' : base.cta || base.button || 'Save'}</button>}
    </div>
  </div>;
  return <Lightbox pageBelow="lg" width={560} label={base.title} eyebrow={eyebrow} title={base.title} sub={base.sub ?? base.lead} onClose={onClose} footer={footer} testId="cycle-form" bar={bar}>
    <form id={id} onSubmit={save} noValidate className="flex flex-col gap-3.5 px-5 py-4">
      {refusal && <p role="alert" data-testid="cycle-form-refusal" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{refusal}</p>}
      {done ? <div data-testid="cycle-form-done" className="space-y-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p>{done.text}</p>
        {linkOf(done.href) && <a href={done.href} className="font-bold text-axal-violet underline dark:text-violet-300">Continue</a>}
        {done.copy && <><p className="break-all">{done.copy}</p><button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(done.copy); setCopied(true); }
          catch { setRefusal('The link could not be copied.'); }
        }} className="font-bold text-axal-violet dark:text-violet-300">{copied ? 'Copied' : 'Copy link'}</button></>}
      </div> : <>
        {loaded === undefined && <p data-testid="cycle-form-loading" className="m-0 text-xs text-axal-muted dark:text-gray-400">Reading the choices…</p>}
        {loaded && fields.map((field) => <Field key={field.name} field={field} values={values} errors={errors} setValue={setValue} prefix={id} busy={busy} />)}
      </>}
    </form>
  </Lightbox>;
}
) : copy;
}
const own = (value, key) => value != null && Object.hasOwn(value, key);
const linkOf = (href) => typeof href === 'string' && !/[\\\u0000-\u001f\u007f]/.test(href) ? safeHref(href) : null;

/** The single boundary for canvas/Worker fields and today's legacy fields. */
export function formFields(form, loaded = {}) {
  return (form?.fields ?? []).map((source) => {
    const field = { ...source, ...(loaded?.[source.name] ?? {}) };
    const kind = field.kind || (field.type === 'select' ? 'CH' : 'T');
    const options = (field.options ?? field.opts ?? []).map((option) => {
      if (typeof option === 'string') return { value: option, label: cleanFormCopy(option) };
      if (Array.isArray(option)) return { value: String(option[0]), label: cleanFormCopy(option[0]), meta: cleanFormCopy(option[1]), checked: !!option[2] };
      return { ...option, value: String(option.value ?? option.t ?? option.label), label: cleanFormCopy(option.label ?? option.t ?? option.value), meta: cleanFormCopy(option.meta ?? option.m), checked: !!(option.checked ?? option.on) };
    });
    return { ...field, kind, label: cleanFormCopy(field.k ?? field.label), input: field.input ?? field.type ?? 'text', options,
      parts: field.parts ? formFields({ fields: field.parts }, loaded) : null };
  });
}

export function fieldVisible(field, values) {
  if (!field.when) return true;
  if (typeof field.when === 'function') return !!field.when(values);
  const value = values[field.when.name];
  return Array.isArray(value) ? value.includes(field.when.value) : value === field.when.value;
}
const leaves = (fields, values) => fields.flatMap((field) => fieldVisible(field, values) ? field.parts ? leaves(field.parts, values) : [field] : []);

export function formValues(fields, current = null, queryValues = {}) {
  const values = {};
  const walk = (list) => list.forEach((field) => {
    if (field.parts) { walk(field.parts); return; }
    let value = own(current, field.name) ? current[field.name] : own(queryValues, field.name) ? queryValues[field.name]
      : own(field, 'value') ? field.value : own(field, 'initial') ? field.initial : field.def;
    if (field.kind === 'CK') {
      value = Array.isArray(value) ? value.map(String) : field.options.filter((option) => option.checked).map((option) => option.value);
    } else {
      if (typeof value === 'number' && field.kind === 'CH' && !field.options.some((option) => option.value === String(value))) value = field.options[value]?.value;
      value = value == null ? (field.options.find((option) => option.checked)?.value ?? '') : String(value);
    }
    values[field.name] = value;
  });
  walk(fields);
  return values;
}

/** Hidden fields are neither validated nor sent (e.g. a signal's stale amount). */
export function submittedValues(fields, values) {
  return Object.fromEntries(leaves(fields, values).map((field) => [field.name, values[field.name]]));
}
export function formErrors(form, fields, values) {
  const visible = leaves(fields, values);
  const errors = validate({ ...form, fields: visible.map((field) => ({ ...field, type: field.kind === 'CH' ? 'select' : field.input })) }, submittedValues(fields, values));
  for (const field of visible.filter((item) => item.kind === 'CK')) {
    const selected = Array.isArray(values[field.name]) ? values[field.name] : [];
    if (field.required && !selected.length) errors[field.name] = field.label + ' is required.';
    else if (selected.some((value) => !field.options.some((option) => option.value === value))) errors[field.name] = 'Pick the recorded choices for ' + field.label.toLowerCase() + '.';
  }
  return errors;
}

function Note({ note, values, id, name }) {
  const content = typeof note === 'function' ? note(values) : note;
  if (!content) return null;
  const href = typeof content === 'object' ? linkOf(content.href) : null;
  return <p id={id} data-testid={'cycle-form-note-' + name} className="m-0 text-xs leading-normal text-axal-muted dark:text-gray-400">
    {cleanFormCopy(typeof content === 'object' ? content.text : content)}
    {href && <> <a href={href} className="font-semibold text-axal-violet underline dark:text-violet-300">Connect a tool</a></>}
  </p>;
}

function Field({ field, values, errors, setValue, prefix, busy, compact = false }) {
  if (!fieldVisible(field, values)) return null;
  const id = prefix + '-' + field.name;
  const error = errors[field.name];
  const description = [error ? id + '-error' : null, field.note || field.hint ? id + '-note' : null].filter(Boolean).join(' ') || undefined;
  if (field.parts) return <fieldset className="min-w-0 space-y-1.5">
    <legend className={LABEL}>{field.label}</legend>
    <div className="grid grid-cols-2 gap-2">{field.parts.map((part) => <Field key={part.name} field={part} values={values} errors={errors} setValue={setValue} prefix={prefix} busy={busy} compact />)}</div>
    <Note note={field.note} values={values} id={id + '-note'} name={field.name} />
  </fieldset>;
  const common = { id, name: field.name, 'data-testid': 'cycle-form-' + field.name, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': description, 'aria-required': field.required || undefined, disabled: busy || field.disabled };
  const value = values[field.name];
  const group = field.kind === 'CH' || field.kind === 'CK';
  let input;
  if (group) {
    const checked = (option) => field.kind === 'CH' ? value === option.value : Array.isArray(value) && value.includes(option.value);
    input = <div role={field.kind === 'CH' ? 'radiogroup' : 'group'} aria-labelledby={id + '-label'} aria-describedby={description} className={field.kind === 'CH' ? 'flex flex-wrap gap-1.5' : 'space-y-1'}>
      {field.options.length ? field.options.map((option, index) => <label key={option.value} className={field.kind === 'CH'
        ? CHOICE + ' ' + (checked(option) ? SELECTED : UNSELECTED)
        : 'flex max-lg:min-h-12 cursor-pointer items-center gap-2.5 rounded-[9px] border border-axal-hairline px-2.5 py-2 text-[12.5px] has-[:disabled]:cursor-default has-[:disabled]:opacity-50 dark:border-gray-700'}>
        <input {...common} id={id + '-' + index} type={field.kind === 'CH' ? 'radio' : 'checkbox'} value={option.value} checked={checked(option)} disabled={common.disabled || option.disabled} onChange={() => {
          if (field.kind === 'CH') setValue(field.name, option.value);
          else setValue(field.name, checked(option) ? value.filter((item) => item !== option.value) : [...(Array.isArray(value) ? value : []), option.value]);
        }} className={field.kind === 'CH' ? 'sr-only' : 'h-4 w-4 accent-axal-violet dark:accent-violet-500'} />
        <span className="flex-1 text-axal-ink dark:text-gray-200">{option.label}</span>
        {option.meta && <span className="text-right text-[11.5px] text-axal-muted dark:text-gray-400">{option.meta}</span>}
      </label>) : <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{field.empty || 'No ' + field.label.toLowerCase() + ' recorded yet.'}</p>}
    </div>;
  } else if (field.input === 'file') {
    input = <input {...common} type="file" accept={field.accept} onChange={(event) => setValue(field.name, event.target.files?.[0] ?? null)} className={INPUT} />;
  } else {
    const props = { ...common, value: value ?? '', onChange: (event) => setValue(field.name, event.target.value), maxLength: field.max, placeholder: cleanFormCopy(field.ph ?? field.placeholder), className: INPUT, style: field.h ? { minHeight: field.h } : undefined };
    if (field.input === 'textarea' || (field.input === 'text' && parseFloat(field.h) >= 48)) input = <textarea {...props} rows={2} style={{ minHeight: field.h || 56 }} />;
    else input = <input {...props} type={['date', 'email', 'number'].includes(field.input) ? field.input : field.input === 'score' ? 'number' : 'text'} inputMode={field.input === 'money' ? 'decimal' : undefined} min={field.input === 'score' ? 0 : undefined} max={field.input === 'score' ? 10 : undefined} step={field.input === 'score' ? 1 : undefined} />;
  }
  return <div className="flex min-w-0 flex-col gap-1.5">
    {group ? <span id={id + '-label'} className={LABEL}>{field.label}</span> : <label htmlFor={id} className={compact ? 'sr-only' : LABEL}>{field.label}</label>}
    {input}
    {error && <p id={id + '-error'} role="alert" className="m-0 text-[11.5px] text-red-700 dark:text-red-300">{error}</p>}
    <Note note={field.note ?? field.hint} values={values} id={id + '-note'} name={field.name} />
  </div>;
}

export default function FormLightbox({ form: base, current = null, cycle, slug, moduleName, onSubmit, onSaved, onClose, loadOptions = null, search = '', bar }) {
  const id = useId();
  const initialFields = useMemo(() => formFields(base), [base]);
  const queryValues = useMemo(() => typeof base?.fromQuery === 'function' ? base.fromQuery(new URLSearchParams(search)) : {}, [base, search]);
  const [values, setValues] = useState(() => formValues(initialFields, current, queryValues));
  const [errors, setErrors] = useState({});
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(loadOptions ? undefined : {});
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const fields = useMemo(() => formFields(base, loaded), [base, loaded]);
  useEffect(() => {
    if (!loadOptions) return undefined;
    let live = true;
    Promise.resolve().then(loadOptions).then((read) => {
      if (!live) return;
      const result = read ?? {};
      setLoaded(result);
      setValues(formValues(formFields(base, result), current, queryValues));
    }, (error) => { if (live) { setLoaded(null); setRefusal(error?.message || 'The choices could not be read.'); } });
    return () => { live = false; };
    // The caller keys a mounted form per row; a new callback does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!base) return null;
  const cycleKey = String(cycle ?? '').toLowerCase();
  const name = moduleName || MODULES[cycleKey]?.find((module) => module.slug === slug)?.name;
  const eyebrow = [CYCLES[cycleKey]?.name || cycle, name].filter(Boolean).join(' · ');
  const save = async (event) => {
    event.preventDefault();
    if (saving.current || !loaded || done) return;
    const found = formErrors(base, fields, values);
    setErrors(found); setRefusal('');
    if (Object.keys(found).length) return;
    saving.current = true; setBusy(true);
    try {
      const result = await onSubmit(submittedValues(fields, values));
      const completion = base.done?.(result);
      if (completion) setDone(completion);
      onSaved?.(result);
      if (!completion) onClose?.();
    } catch (error) {
      const sentence = error?.message || 'This could not be saved. Try again.';
      if (error?.field && leaves(fields, values).some((field) => field.name === error.field)) setErrors({ [error.field]: sentence });
      else setRefusal(sentence);
    } finally { saving.current = false; setBusy(false); }
  };
  const setValue = (name, value) => setValues((old) => ({ ...old, [name]: value }));
  const footer = <div className="flex flex-wrap items-center justify-between gap-2.5 max-lg:flex-col max-lg:items-stretch">
    {base.foot && <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{cleanFormCopy(base.foot)}</p>}
    <div className="flex justify-end gap-2 max-lg:flex-col">
      <button type="button" onClick={onClose} className="rounded-[9px] border border-axal-hairline bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{done ? 'Close' : 'Cancel'}</button>
      {!done && <button type="submit" form={id} disabled={busy || !loaded} data-testid="cycle-form-save" className="rounded-[9px] bg-axal-violet px-3.5 py-[9px] text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600 dark:text-white max-lg:h-[52px] max-lg:w-full">{busy ? 'Saving…' : base.cta || base.button || 'Save'}</button>}
    </div>
  </div>;
  return <Lightbox pageBelow="lg" width={560} label={base.title} eyebrow={eyebrow} title={base.title} sub={base.sub ?? base.lead} onClose={onClose} footer={footer} testId="cycle-form" bar={bar}>
    <form id={id} onSubmit={save} noValidate className="flex flex-col gap-3.5 px-5 py-4">
      {refusal && <p role="alert" data-testid="cycle-form-refusal" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{refusal}</p>}
      {done ? <div data-testid="cycle-form-done" className="space-y-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p>{done.text}</p>
        {linkOf(done.href) && <a href={done.href} className="font-bold text-axal-violet underline dark:text-violet-300">Continue</a>}
        {done.copy && <><p className="break-all">{done.copy}</p><button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(done.copy); setCopied(true); }
          catch { setRefusal('The link could not be copied.'); }
        }} className="font-bold text-axal-violet dark:text-violet-300">{copied ? 'Copied' : 'Copy link'}</button></>}
      </div> : <>
        {loaded === undefined && <p data-testid="cycle-form-loading" className="m-0 text-xs text-axal-muted dark:text-gray-400">Reading the choices…</p>}
        {loaded && fields.map((field) => <Field key={field.name} field={field} values={values} errors={errors} setValue={setValue} prefix={id} busy={busy} />)}
      </>}
    </form>
  </Lightbox>;
}
