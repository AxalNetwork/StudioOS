/**
 * D695: the one dialog for every cycle Add and Edit, which CycleRoute mounts
 * at a module's `/new` address or for `state.editing` (a page below 1024px).
 * The parent owns navigation, API writes and per-row keys. Legacy forms are
 * adapted here until their registry owners merge; no registry is changed early.
 *
 * D1328 (#3489, part 5 of #2431): `fill` (`{ page, form, project, aiOff,
 * edited? }`) mounts Fill with Eadwyn on a form FILL_FIELDS lists. The form
 * reads `GET /api/fills/sheet` once: a blank field the read gives a trigger
 * draws "Fill [field] with Eadwyn" beside its label, and the form draws its
 * "Fill" (AF3). Both open the one `FillSheet`. Accept places the values in
 * this form, each marked "Not saved" until the member types over it (AF7).
 * Nothing is written until Save: the form's own route writes, then
 * `POST /api/fills/record` keeps only the placed values that still equal
 * Eadwyn's proposal. `edited` is a waiting row opened by its Edit (AF16): its
 * values open the form, and Save decides the proposal as edited.
 *
 * #3712: `readOnly` explains a read-only sheet; `renderReadRecovery(error,
 * retry)` replaces a failed choices read with its domain's access form.
 * Recovery sits outside the data form so its own submit cannot save a record.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Lightbox from '../../ui/Lightbox.jsx';
import { MODULES } from './modules.js';
import { CYCLES, safeHref } from './cycleModel.js';
import { validate } from './forms.js';
import FillSheet from '../../ui/FillSheet.jsx';
import { FillFormTrigger, FillMark, FillTrigger } from '../../ui/FillMark.jsx';
import { fillsApi } from '../../lib/api/fills.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import { reportError } from '../../lib/log.js';
import { placeValues, placedProposals, savedId, stillPlaced } from '../../lib/fillForms.js';
import { activeSupportSession } from '../../lib/supportSession.js';
import { SUPPORT_OFF } from '../../lib/fillScoped.js';

const INPUT = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-[9px] text-[13px] text-axal-ink outline-none focus:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-lg:rounded-xl';
const LABEL = 'text-[10px] font-extrabold uppercase tracking-[0.09em] text-axal-muted dark:text-gray-400';
const CHOICE = 'flex cursor-pointer max-lg:min-h-9 items-center gap-2 rounded-full border px-[11px] py-1.5 text-xs font-semibold has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-axal-violet dark:has-[:focus-visible]:outline-violet-400';
const SELECTED = 'border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300';
const UNSELECTED = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
export function cleanFormCopy(value, { money = false } = {}) {
  const copy = String(value ?? '').replace(/\[|\]/g, '');
  return money ? copy.replace(/€/g, '$') : copy;
}
const own = (value, key) => value != null && Object.hasOwn(value, key);
const blankValue = (v) => v == null || String(v).trim() === '';
const linkOf = (href) => typeof href === 'string' && !/[\\\u0000-\u001f\u007f]/.test(href) ? safeHref(href) : null;

/** The single boundary for canvas/Worker fields and today's legacy fields. */
export function formFields(form, loaded = {}, current = null) {
  return (form?.fields ?? []).map((source) => {
    const field = { ...source, ...(loaded?.[source.name] ?? {}) };
    const kind = field.kind || (field.type === 'select' ? 'CH' : 'T');
    // D969: `keep(current)` names the chip an Edit opened with, kept when the read does not list it.
    const kept = typeof field.keep === 'function' && current ? field.keep(current) : null;
    const listed = field.options ?? field.opts ?? [];
    const all = kept && !listed.some((option) => String(option?.value ?? option) === String(kept.value)) ? [...listed, kept] : listed;
    const options = all.map((option) => {
      if (typeof option === 'string') return { value: option, label: cleanFormCopy(option) };
      if (Array.isArray(option)) return { value: String(option[0]), label: cleanFormCopy(option[0]), meta: cleanFormCopy(option[1]), checked: !!option[2] };
      return { ...option, value: String(option.value ?? option.t ?? option.label), label: cleanFormCopy(option.label ?? option.t ?? option.value), meta: cleanFormCopy(option.meta ?? option.m), checked: !!(option.checked ?? option.on) };
    });
    return { ...field, kind, label: cleanFormCopy(field.k ?? field.label), input: field.input ?? field.type ?? 'text', options,
      parts: field.parts ? formFields({ fields: field.parts }, loaded, current) : null };
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

/** Search matches by their `group`, in the order each group first appears. */
const groupsOf = (options) => {
  const groups = new Map();
  for (const option of options) { const g = option.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(option); }
  return [...groups];
};

function Note({ note, values, id, name }) {
  const content = typeof note === 'function' ? note(values) : note;
  if (!content) return null;
  const href = typeof content === 'object' ? linkOf(content.href) : null;
  return <p id={id} data-testid={'cycle-form-note-' + name} className="m-0 text-xs leading-normal text-axal-muted dark:text-gray-400">
    {cleanFormCopy(typeof content === 'object' ? content.text : content)}
    {href && <> <a href={href} className="font-semibold text-axal-violet underline dark:text-violet-300">{cleanFormCopy(content.link || 'Connect a tool')}</a></>}
  </p>;
}

function Field({ field, values, errors, setValue, prefix, busy, compact = false, search = null, fill = null }) {
  if (!fieldVisible(field, values)) return null;
  const id = prefix + '-' + field.name;
  const error = errors[field.name];
  const description = [error ? id + '-error' : null, field.note || field.hint ? id + '-note' : null].filter(Boolean).join(' ') || undefined;
  if (field.parts) return <fieldset className="min-w-0 space-y-1.5">
    <legend className={LABEL}>{field.label}</legend>
    <div className="grid grid-cols-2 gap-2">{field.parts.map((part) => <Field key={part.name} field={part} values={values} errors={errors} setValue={setValue} prefix={prefix} busy={busy} compact search={search} />)}</div>
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
        : 'flex max-lg:min-h-12 cursor-pointer items-center gap-2.5 rounded-[9px] border border-axal-hairline px-2.5 py-2 text-[12.5px] text-axal-ink dark:text-gray-200 has-[:disabled]:cursor-default has-[:disabled]:opacity-50 dark:border-gray-700'}>
        <input {...common} id={id + '-' + index} type={field.kind === 'CH' ? 'radio' : 'checkbox'} value={option.value} checked={checked(option)} disabled={common.disabled || option.disabled} onChange={() => {
          if (field.kind === 'CH') setValue(field.name, option.value);
          else setValue(field.name, checked(option) ? value.filter((item) => item !== option.value) : [...(Array.isArray(value) ? value : []), option.value]);
        }} className={field.kind === 'CH' ? 'sr-only' : 'h-4 w-4 accent-axal-violet dark:accent-violet-500'} />
        <span className="flex-1">{option.label}</span>
        {option.meta && <span className="text-right text-[11.5px] text-axal-muted dark:text-gray-400">{option.meta}</span>}
      </label>) : <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{field.empty || 'No ' + field.label.toLowerCase() + ' recorded yet.'}</p>}
    </div>;
  } else if (field.input === 'file') {
    input = <input {...common} type="file" accept={field.accept} multiple={field.multiple || undefined}
      onChange={(event) => setValue(field.name, field.multiple ? Array.from(event.target.files ?? []) : event.target.files?.[0] ?? null)} className={INPUT} />;
  } else {
    const props = { ...common, value: value ?? '', onChange: (event) => { setValue(field.name, event.target.value); if (field.search) search?.type(field, event.target.value); }, maxLength: field.max, placeholder: cleanFormCopy(field.ph ?? field.placeholder, { money: field.input === 'money' }), className: INPUT, style: field.h ? { minHeight: field.h } : undefined };
    if (field.input === 'textarea' || (field.input === 'text' && parseFloat(field.h) >= 48)) input = <textarea {...props} rows={2} style={{ minHeight: field.h || 56 }} />;
    else input = <input {...props} type={['date', 'email', 'number'].includes(field.input) ? field.input : field.input === 'score' ? 'number' : 'text'} inputMode={field.input === 'money' ? 'decimal' : undefined} min={field.input === 'score' ? 0 : undefined} max={field.input === 'score' ? 10 : undefined} step={field.input === 'score' ? 1 : undefined} />;
  }
  return <div className="flex min-w-0 flex-col gap-1.5">
    <FieldHead fill={compact ? null : fill} name={field.name} label={field.label} value={value} busy={busy}>
      {group ? <span id={id + '-label'} className={LABEL}>{field.label}</span> : <label htmlFor={id} className={compact ? 'sr-only' : LABEL}>{field.label}</label>}
    </FieldHead>
    {input}
    {field.search && search?.found[field.name]?.length > 0 && <div data-testid={'cycle-form-found-' + field.name} className="space-y-1.5">
      {groupsOf(search.found[field.name]).map(([group, options]) => <div key={group || 'found'} className="space-y-1">
        {group && <p className="m-0 text-[11px] font-semibold text-axal-muted dark:text-gray-400">{cleanFormCopy(group)}</p>}
        <div className="flex flex-wrap gap-1.5">{options.map((option) => <button key={(option.into || '') + option.value} type="button" onClick={() => search.pick(field, option)} className={CHOICE + ' ' + UNSELECTED}>{cleanFormCopy(option.label)}</button>)}</div>
      </div>)}
    </div>}
    {error && <p id={id + '-error'} role="alert" className="m-0 text-[11.5px] text-red-700 dark:text-red-300">{error}</p>}
    <Note note={field.note ?? field.hint} values={values} id={id + '-note'} name={field.name} />
  </div>;
}

/**
 * D1328: a field's label row with its Fill controls. The trigger is drawn only
 * where the sheet read gives one (`field.trigger`: never a typed, never-fill
 * or decision field, never a reader) and while the box is still blank; a
 * placed value reads "Not saved" until it is typed over.
 */
function FieldHead({ fill, name, label, value, busy, children }) {
  if (!fill) return children;
  const view = fill.field(name);
  const placed = stillPlaced(fill.placed, name, value);
  const trigger = view && view.trigger && blankValue(value) && !placed;
  if (!trigger && !placed) return children;
  return <div className="flex min-h-8 items-center justify-between gap-2">
    <span className="flex min-w-0 items-center">{children}{placed ? <FillMark mark={null} placed /> : null}</span>
    {trigger ? <FillTrigger field={view} label={label} aiOff={fill.aiOff} busyElsewhere={busy} onOpen={fill.open} /> : null}
  </div>;
}

export default function FormLightbox({ form: base, current = null, cycle, slug, moduleName, onSubmit, onSaved, onClose, loadOptions = null, onSearch = null, searchDelay = 250, search = '', bar, refused = '', renderAssistant, fill = null, readOnly = '', renderReadRecovery = null }) {
  const id = useId();
  const initialFields = useMemo(() => formFields(base, {}, current), [base, current]);
  const queryValues = useMemo(() => typeof base?.fromQuery === 'function' ? base.fromQuery(new URLSearchParams(search)) : {}, [base, search]);
  // D1328: a waiting row opened by its Edit seeds the form as a record's values would.
  const seed = current ?? fill?.edited?.row ?? null;
  const [values, setValues] = useState(() => formValues(initialFields, seed, queryValues));
  const [errors, setErrors] = useState({});
  // `refused`: a sentence the form opens with and nothing to save (a record that refused its read).
  const [refusal, setRefusal] = useState(refused);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(refused ? null : loadOptions ? undefined : {});
  // D969: a failed read of the choices says so with Try again, and reads them again.
  const [readFailed, setReadFailed] = useState(false);
  const [readError, setReadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const fields = useMemo(() => formFields(base, loaded, current), [base, loaded, current]);
  // A T box with `search` offers what `onSearch` finds for its text, each
  // match under its `group`'s label; a pick fills the box and is sent under
  // its own `into` (else `search.into`) while the box still holds it.
  const [found, setFound] = useState({});
  const [picks, setPicks] = useState({});
  const searching = useRef({ timer: null, serial: 0 });
  useEffect(() => () => clearTimeout(searching.current.timer), []);
  const finder = {
    found,
    type: (field, text) => {
      const s = searching.current;
      clearTimeout(s.timer);
      const serial = ++s.serial;
      const q = String(text ?? '').trim();
      if (!onSearch || q.length < 2) { setFound((old) => ({ ...old, [field.name]: [] })); return; }
      s.timer = setTimeout(() => {
        Promise.resolve().then(() => onSearch(field, q)).then((list) => {
          if (s.serial === serial) setFound((old) => ({ ...old, [field.name]: Array.isArray(list) ? list.slice(0, 20) : [] }));
        }, () => { if (s.serial === serial) setFound((old) => ({ ...old, [field.name]: [] })); });
      }, searchDelay);
    },
    pick: (field, option) => {
      searching.current.serial += 1;
      setPicks((old) => ({ ...old, [field.name]: { into: option.into || field.search.into, value: option.value, label: option.label } }));
      setValues((old) => ({ ...old, [field.name]: option.label }));
      setFound((old) => ({ ...old, [field.name]: [] }));
    },
  };
  const picked = () => Object.fromEntries(Object.entries(picks).filter(([name, p]) => values[name] === p.label).map(([, p]) => [p.into, p.value]));
  const blocked = typeof base?.blocked === 'function' && !!loaded && base.blocked(fields);
  useEffect(() => {
    if (!loadOptions || refused) return undefined;
    let live = true;
    Promise.resolve().then(loadOptions).then((read) => {
      if (!live) return;
      const result = read ?? {};
      setLoaded(result); setReadFailed(false); setReadError(null);
      setValues(formValues(formFields(base, result, current), seed, queryValues));
    }, (error) => { if (live) { setLoaded(null); setReadFailed(true); setReadError(error); setRefusal(error?.message || 'The choices could not be read.'); } });
    return () => { live = false; };
    // The caller keys a mounted form per row; a new callback does not re-read. Try again does (`attempt`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  // D1328 (#3489): Fill with Eadwyn's read for this form, once; a failure is "Unreadable" with Try again.
  const [fillRead, setFillRead] = useState(fill && !refused ? { status: 'loading', data: null } : null);
  const [fillTick, setFillTick] = useState(0);
  const [fillOpen, setFillOpen] = useState(false);
  const [placed, setPlaced] = useState(() => (fill?.edited?.row ? placeValues(Object.entries(fill.edited.row).map(([field, value]) => ({ field, value, source_kind: 'eadwyn' })), Object.keys(fill.edited.row)).placed : {}));
  useEffect(() => {
    if (!fill || refused || readOnly) return undefined;
    let live = true;
    setFillRead({ status: 'loading', data: null });
    Promise.resolve().then(() => fillsApi.sheet({ page: fill.page, form: fill.form, project: fill.project }))
      .then((data) => { if (live) setFillRead({ status: 'ready', data }); },
        (error) => { if (live) { reportError('fill-form:read', error); setFillRead({ status: 'unreadable', data: null }); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill?.page, fill?.form, fill?.project, fillTick, readOnly]);
  const fillFields = fillRead?.status === 'ready' && Array.isArray(fillRead.data?.fields) ? fillRead.data.fields : [];
  const fillNames = fillFields.map((f) => f.field);
  const fillCtl = !readOnly && fill && fillRead?.status === 'ready' ? {
    field: (name) => fillFields.find((f) => f.field === name) || null,
    placed, aiOff: !!fill.aiOff, open: () => setFillOpen(true),
  } : null;
  const fillable = fillFields.some((f) => f.trigger && blankValue(values[f.field]) && !stillPlaced(placed, f.field, values[f.field]));
  const placedCount = fillNames.filter((n) => stillPlaced(placed, n, values[n])).length;
  const place = (list) => {
    const out = placeValues(list, fillNames);
    setValues((old) => ({ ...old, ...out.values }));
    setPlaced((old) => ({ ...old, ...out.placed }));
  };
  /** After the form's own Save: the record step (D1326 §2), and a waiting row's Edit decided. Neither undoes the Save. */
  const afterSave = async (result, sent) => {
    if (!fill) return;
    const uids = placedProposals(placed);
    const id = savedId(result);
    if (uids.length && id) {
      try { await fillsApi.record({ page: fill.page, form: fill.form, project: fill.project, record: id, proposals: uids }); }
      catch (error) { reportError('fill-form:record', error); }
    }
    if (fill.edited?.uid) {
      const row = Object.fromEntries(Object.keys(fill.edited.row || {}).filter((k) => Object.hasOwn(sent, k)).map((k) => [k, sent[k]]));
      try { await railProposalsApi.decide(fill.edited.uid, 'edit', { row }); }
      catch (error) { reportError('fill-form:edited-row', error); }
    }
  };
  const readAgain = () => { setLoaded(undefined); setReadFailed(false); setReadError(null); setRefusal(''); setAttempt((n) => n + 1); };
  const readRecovery = readFailed && renderReadRecovery?.(readError, readAgain);
  if (!base) return null;
  const cycleKey = String(cycle ?? '').toLowerCase();
  const name = moduleName || MODULES[cycleKey]?.find((module) => module.slug === slug)?.name;
  const eyebrow = [CYCLES[cycleKey]?.name || cycle, name].filter(Boolean).join(' · ');
  const save = async (event) => {
    event.preventDefault();
    if (saving.current || !loaded || done || blocked || readOnly) return;
    const found = formErrors(base, fields, values);
    setErrors(found); setRefusal('');
    if (Object.keys(found).length) return;
    saving.current = true; setBusy(true);
    try {
      const sent = { ...submittedValues(fields, values), ...picked() };
      const result = await onSubmit(sent);
      await afterSave(result, sent);
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
    {!readOnly && base.foot && <p className="m-0 text-xs text-axal-muted dark:text-gray-400">{cleanFormCopy(base.foot)}</p>}
    <div className="flex justify-end gap-2 max-lg:flex-col">
      <button type="button" onClick={onClose} className="rounded-[9px] border border-axal-hairline bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{done || (readOnly && loaded) ? 'Close' : 'Cancel'}</button>
      {!done && !readOnly && <button type="submit" form={id} disabled={busy || !loaded || blocked} data-testid="cycle-form-save" className="rounded-[9px] bg-axal-violet px-3.5 py-[9px] text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600 dark:text-white max-lg:h-[52px] max-lg:w-full">{busy ? 'Saving…' : base.cta || base.button || 'Save'}</button>}
    </div>
  </div>;
  return <Lightbox pageBelow="lg" width={560} label={base.title} eyebrow={eyebrow} title={base.title} sub={base.sub ?? base.lead} onClose={onClose} footer={footer} focusKey={readRecovery ? 'read-reason' : done ? 'done' : 'form'} testId="cycle-form" bar={bar}>
    {readOnly ? <p role="status" data-testid="cycle-form-read-only" className="m-0 px-5 pt-4 text-[13px] text-axal-muted dark:text-gray-400">{readOnly}</p> : null}
    {readRecovery ? <div className="px-5 py-4">{readRecovery}</div> : null}
    {!readRecovery && <form id={id} onSubmit={save} noValidate className="flex flex-col gap-3.5 px-5 py-4">
      {!readRecovery && refusal && <p role="alert" data-testid="cycle-form-refusal" className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{refusal}</p>}
      {readFailed && !readRecovery && <button type="button" onClick={readAgain} data-testid="cycle-form-read-again" className="self-start rounded-[9px] border border-axal-hairline bg-white px-3.5 py-[9px] text-[12.5px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">Try again</button>}
      {done ? <div data-testid="cycle-form-done" className="space-y-3 text-[13px] text-axal-ink dark:text-gray-200">
        <p>{done.text}</p>
        {linkOf(done.href) && <a href={done.href} className="font-bold text-axal-violet underline dark:text-violet-300">Continue</a>}
        {done.copy && <><p className="break-all">{done.copy}</p><button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(done.copy); setCopied(true); }
          catch { setRefusal('The link could not be copied.'); }
        }} className="font-bold text-axal-violet dark:text-violet-300">{copied ? 'Copied' : 'Copy link'}</button></>}
      </div> : <>
        {loaded === undefined && <p data-testid="cycle-form-loading" className="m-0 text-xs text-axal-muted dark:text-gray-400">Reading the choices…</p>}
        {loaded && fill && fillRead?.status === 'unreadable' ? <p role="status" data-testid="fill-form-unreadable" className="m-0 flex flex-wrap items-center gap-2 text-xs text-axal-muted dark:text-gray-400">
          Unreadable: Eadwyn's suggestions for this form could not be read. Type the values, or
          <button type="button" onClick={() => setFillTick((n) => n + 1)} className="font-semibold text-axal-violet underline dark:text-violet-300" data-testid="fill-form-retry">Try again</button>
        </p> : null}
        {/* D1329 (#3490, AF15): a support session reads the form, its marks and no trigger, and says why. */}
        {loaded && fill && fillRead?.status === 'ready' && fillRead.data?.can_fill === false && activeSupportSession()
          ? <p role="status" data-testid="fill-form-support" className="m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">{SUPPORT_OFF}</p> : null}
        {loaded && fillCtl && (fillable || placedCount > 0) ? <div className="flex flex-wrap items-center justify-between gap-2" data-testid="fill-form-bar">
          <span className="text-xs text-axal-muted dark:text-gray-400" data-testid="fill-form-placed">{placedCount
            ? `${placedCount} ${placedCount === 1 ? 'value' : 'values'} placed. Nothing is saved until you press ${cleanFormCopy(base.cta || base.button || 'Save')}.`
            : fill.aiOff ? 'Ask fills the blank fields from your sources only.' : 'Ask Eadwyn to fill the blank fields, or fill them from your sources.'}</span>
          {fillable ? <FillFormTrigger aiOff={!!fill.aiOff} disabled={busy} onOpen={() => setFillOpen(true)} /> : null}
        </div> : null}
        {loaded && fields.map((field) => <Field key={field.name} field={readOnly ? { ...field, note: null, hint: null } : field} values={values} errors={errors} setValue={setValue} prefix={id} busy={busy || !!readOnly} search={finder} fill={fillCtl} />)}
        {loaded && !readOnly && renderAssistant?.({ fields, values, setValue, busy })}
      </>}
    </form>}
    {fillOpen && fill && !readOnly ? <FillSheet page={fill.page} form={fill.form} project={fill.project} title={cleanFormCopy(base.title || 'this form').toLowerCase()}
      values={Object.fromEntries(fillNames.map((n) => [n, values[n]]))} aiOff={!!fill.aiOff} onPlace={place} onClose={() => setFillOpen(false)} /> : null}
  </Lightbox>;
}
