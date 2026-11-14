import React, { useEffect, useRef, useState } from 'react';
import {
  AGREEMENT_TYPE_OPTIONS, FILTER_BUTTONS, LEGAL_STATUS_OPTIONS, PACKAGE_OPTIONS, PROGRAM_OPTIONS,
  activeAgreementChips, checkFilterText, filterButtonValue, toggleType, typesOf, withoutAgreementFilters, withoutChip,
} from '../../../lib/contractAgreements';

/**
 * D5050 part 2 (#5050, board CT-17): the Agreements filter row. One button per filter, in the canvas's order
 * (agreement type, legal state, licence / territory, program, Axal VC package, template, signed date); a set
 * filter reads its value, or its count when several types are chosen, and is drawn "on". One panel opens under
 * the row (a disclosure, not an ARIA menu, as the Library is), so it is never clipped by the row's scroll on a
 * phone. Under it, the active filters as removable chips with Clear all and the count the Worker answered.
 * Every value is a GET /api/admin/contracts parameter; nothing here filters rows itself.
 */
const dd = 'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[12px] font-semibold md:min-h-[30px]';
const ddOff = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ddOn = 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200';
const field = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm dark:bg-gray-900';
const small = 'min-h-[44px] rounded-lg border border-axal-hairline px-3 text-xs font-semibold md:min-h-[32px]';

function Choice({ type = 'radio', name, checked, onChange, children }) {
  return <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded px-2 text-[12.5px] hover:bg-axal-ground dark:hover:bg-gray-800 md:min-h-[32px]">
    <input type={type} name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-violet-600" />{children}</label>;
}

/** A text filter (or two) with Apply: the draft is checked before it is sent, and the reason shown when it cannot be. */
function TextFilters({ fields, filters, onApply, note = null }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(fields.map(([key]) => [key, filters[key] || ''])));
  const [problem, setProblem] = useState(null);
  const apply = (e) => {
    e?.preventDefault?.();
    const next = {};
    for (const [key] of fields) {
      const checked = checkFilterText(key, draft[key]);
      if (!checked.ok) { setProblem(checked.reason); return; }
      next[key] = checked.value;
    }
    setProblem(null);
    onApply(next);
  };
  return <form className="space-y-2 p-2" onSubmit={apply}>
    {fields.map(([key, label, props = {}]) => <label key={key} className="block text-[12px] font-semibold">{label}
      <input className={field} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} {...props} /></label>)}
    {problem && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{problem}</p>}
    {note && <p className="text-[11.5px] text-axal-muted">{note}</p>}
    <button type="submit" className={`${small} bg-violet-600 text-white`} onClick={apply}>Apply</button>
  </form>;
}

function Panel({ id, filters, set, close }) {
  const name = FILTER_BUTTONS.find(([k]) => k === id)?.[1];
  const radios = (key, options) => options.map(([value, label]) => <Choice key={value || 'any'} name={`agreement-filter-${key}`}
    checked={(filters[key] || '') === value} onChange={() => { set({ [key]: value }); close(); }}>{label}</Choice>);
  let body = null;
  if (id === 'type') {
    const chosen = typesOf(filters.agreement_type);
    body = AGREEMENT_TYPE_OPTIONS.filter(([v]) => v).map(([value, label]) => <Choice key={value} type="checkbox" checked={chosen.includes(value)}
      onChange={() => set({ agreement_type: toggleType(filters.agreement_type, value) })}>{label}</Choice>);
  } else if (id === 'state') body = radios('agreement_status', LEGAL_STATUS_OPTIONS);
  else if (id === 'program') body = radios('program', PROGRAM_OPTIONS);
  else if (id === 'package') body = radios('package', PACKAGE_OPTIONS);
  else if (id === 'licence') {
    body = <TextFilters filters={filters} onApply={(v) => { set(v); close(); }} fields={[
      ['licence', 'Licence reference or uid', { maxLength: 64, placeholder: 'AXL-FR-001' }],
      ['territory', 'Territory (country code)', { maxLength: 2, placeholder: 'FR' }]]}
      note="Type the two-letter country code. Rows and chips show the country name (D5050 part 3)." />;
  } else if (id === 'template') {
    body = <TextFilters filters={filters} onApply={(v) => { set(v); close(); }} fields={[['template', 'Template slug', { maxLength: 100, placeholder: 'program_schedule' }]]}
      note="Agreements made from this template. The template itself lives in Templates, never in this list." />;
  } else if (id === 'signed') {
    body = <TextFilters filters={filters} onApply={(v) => { set(v); close(); }} fields={[
      ['signed_from', 'Signed on or after', { type: 'date' }], ['signed_to', 'Signed on or before', { type: 'date' }]]}
      note="By signature date. Effective date is not a filter: no master licence agreement records one, so it would hide them." />;
  }
  return <div id="agreement-filter-panel" role="group" aria-label={name} data-testid={`agreement-filter-panel-${id}`}
    className="max-w-[420px] rounded-lg border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
    <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-widest text-axal-faint">{name}</p>
    {body}
    <div className="flex justify-end p-1"><button type="button" className={small} onClick={close}>Done</button></div>
  </div>;
}

export default function AgreementFilterRow({ filters, onFilters, total = null }) {
  const [open, setOpen] = useState(null);
  const opener = useRef({});
  const close = () => { const at = open; setOpen(null); opener.current[at]?.focus?.(); };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // `close` reads `open`, the only dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch) => onFilters({ ...filters, ...patch, offset: 0 });
  const chips = activeAgreementChips(filters);
  return <div className="space-y-2" data-testid="agreement-filters">
    <div role="group" aria-label="Agreement filters" className="-mx-3 flex flex-nowrap gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {FILTER_BUTTONS.map(([id, name, short]) => {
        const value = filterButtonValue(id, filters);
        return <button key={id} type="button" ref={(n) => { opener.current[id] = n; }} data-testid={`agreement-filter-${id}`}
          aria-expanded={open === id} aria-controls="agreement-filter-panel" aria-label={value ? `${name}: ${value}` : name}
          className={`${dd} ${value ? ddOn : ddOff}`} onClick={() => setOpen((o) => (o === id ? null : id))}>
          <span><span className="md:hidden">{short}</span><span className="hidden md:inline">{name}</span>{value ? `: ${value}` : ''}</span><span aria-hidden="true">▾</span></button>;
      })}
    </div>
    {open && <Panel key={open} id={open} filters={filters} set={set} close={close} />}
    {chips.length > 0 && <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60" data-testid="agreement-active-filters">
      <span className="font-mono text-[11px] text-axal-muted">Active filters</span>
      {chips.map((chip) => <span key={`${chip.key}:${chip.value || ''}`} className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 py-0.5 pl-2.5 pr-1 text-[12px] font-semibold text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
        {chip.label}<button type="button" aria-label={`Remove filter ${chip.label}`} className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full font-extrabold md:min-h-[22px] md:min-w-[22px]"
          onClick={() => onFilters(withoutChip(filters, chip))}>×</button></span>)}
      <button type="button" className="min-h-[32px] px-1 text-[12px] font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => onFilters(withoutAgreementFilters(filters))}>Clear all</button>
      {total != null && <span className="ml-auto font-mono text-[11px] text-axal-muted" data-testid="agreement-filter-count">{total} {total === 1 ? 'agreement' : 'agreements'}</span>}
    </div>}
  </div>;
}
