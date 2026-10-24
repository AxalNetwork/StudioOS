import React, { useEffect, useId, useRef, useState } from 'react';
import { STATUSES, statusWord } from './eventsDeskModel';
import { FEATURED, PRICES, VISIBILITIES, WHENS } from './allEventsModel';
import { INPUT } from './parts';

/**
 * D919 (#2702) — the filters All events and the Calendar share (EV6, EV8).
 * Every control is a native select, except Status, which takes several at
 * once: a disclosure of checkboxes (not an ARIA menu). On a phone each control
 * is 44 px tall. The address holds what is picked (`allEventsModel.readQuery`);
 * `onChange(patch)` writes it back.
 *
 * `fields` names the filters a tab draws: All events draws all five, the
 * Calendar draws Status, Visibility and Price (When is the calendar itself,
 * and Featured is not on EV8). Type and Format wait for part 1, Host for part 3.
 */

export const CONTROL = `${INPUT} max-sm:min-h-[44px]`;

function StatusPicker({ picked, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const label = picked.length === 0 ? 'Status: All' : picked.length === 1 ? `Status: ${statusWord(picked[0])}` : `Status: ${picked.length}`;
  const toggle = (key) => onChange(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)} className={`${CONTROL} font-semibold`} data-testid="events-filter-status">
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <fieldset id={panel} className="absolute left-0 top-full z-20 mt-1 flex min-w-[220px] flex-col gap-0.5 rounded-[10px] border border-axal-hairline bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="events-filter-status-panel">
          <legend className="sr-only">Status</legend>
          {STATUSES.map((s) => (
            <label key={s.key} className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[13px] text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:text-gray-100 dark:hover:bg-gray-800">
              <input type="checkbox" checked={picked.includes(s.key)} onChange={() => toggle(s.key)} data-testid={`events-filter-status-${s.key}`} />
              {s.word}
            </label>
          ))}
          {picked.length ? (
            <button type="button" onClick={() => onChange([])} className="mt-1 min-h-[36px] rounded-[6px] px-2 text-left text-[12.5px] font-bold text-axal-violet max-sm:min-h-[44px] dark:text-violet-300">Clear status</button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

function Pick({ label, value, options, onChange, testId }) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={CONTROL} data-testid={testId}>
        <option value="">{`${label}: All`}</option>
        {options.map((o) => <option key={o.key} value={o.key}>{`${label}: ${o.label}`}</option>)}
      </select>
    </label>
  );
}

export default function EventFilters({ query, onChange, fields = ['status', 'visibility', 'when', 'price', 'featured'] }) {
  const has = (f) => fields.includes(f);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="events-filters">
      {has('status') ? <StatusPicker picked={query.statuses} onChange={(statuses) => onChange({ status: statuses })} /> : null}
      {has('visibility') ? <Pick label="Visibility" value={query.visibility} options={VISIBILITIES} onChange={(v) => onChange({ visibility: v })} testId="events-filter-visibility" /> : null}
      {has('when') ? <Pick label="When" value={query.when} options={WHENS} onChange={(v) => onChange({ when: v })} testId="events-filter-when" /> : null}
      {has('when') && query.when === 'range' ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            From
            <input type="date" value={query.from || ''} onChange={(e) => onChange({ when: 'range', from: e.target.value || null })} className={CONTROL} data-testid="events-filter-from" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            To
            <input type="date" value={query.to || ''} onChange={(e) => onChange({ when: 'range', to: e.target.value || null })} className={CONTROL} data-testid="events-filter-to" />
          </label>
        </span>
      ) : null}
      {has('price') ? <Pick label="Price" value={query.price} options={PRICES} onChange={(v) => onChange({ price: v })} testId="events-filter-price" /> : null}
      {has('featured') ? <Pick label="Featured" value={query.featured} options={FEATURED} onChange={(v) => onChange({ featured: v })} testId="events-filter-featured" /> : null}
    </div>
  );
}
