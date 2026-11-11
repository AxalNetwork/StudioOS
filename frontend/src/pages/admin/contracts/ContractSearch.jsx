import React, { useEffect, useId, useRef, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { LifecycleBadge, SafetyOverlayBadge } from './LifecycleBadge';
import { input } from './parts';
import { EMPTY_FILTERS, OBJECT_TAGS, SEARCH_DEBOUNCE_MS, UPDATED_WINDOWS, activeFilterCount, applyFilters, filterOptions, resultBadge, resultOverlays, resultTarget, summaryLine, versionLine } from './contractSearchModel';

/**
 * D4811 (#4811) part 4 — cross-object legal search on the Contracts desk
 * (board CT-13, interactions CT-92 "Search"): one box over templates,
 * agreements and governance records. "/" focuses it from anywhere on the
 * desk; results follow 250 ms after typing stops; ↑/↓ move through them,
 * Enter opens the highlighted (or top) result, Escape clears. Current
 * versions by default; "Include historical versions" adds them, tagged. Each
 * result names its object type, context, lifecycle state and version. The
 * count and what was left out are announced in a polite live region.
 */
export default function ContractSearch({ onOpen }) {
  const [q, setQ] = useState('');
  const [historical, setHistorical] = useState(false);
  const [state, setState] = useState({ phase: 'idle' }); // idle | loading | done { data } | failed { message }
  const [active, setActive] = useState(-1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const box = useRef(null);
  const ids = useId();
  const listId = `${ids}-results`;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.defaultPrevented) return;
      const tag = String(e.target?.tagName || '').toUpperCase();
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return;
      e.preventDefault();
      box.current?.focus?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setState({ phase: 'idle' }); setActive(-1); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setState({ phase: 'loading' });
      try {
        const data = await contractsApi.search({ q: term, historical });
        if (live) { setState({ phase: 'done', data }); setActive(-1); setFilters(EMPTY_FILTERS); }
      } catch (e) {
        reportError('contracts:search', e);
        if (live) setState({ phase: 'failed', message: e?.message || 'Search could not be read. Try again.' });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [q, historical]);

  const all = state.phase === 'done' ? state.data.items : [];
  const items = applyFilters(all, filters);
  const options = filterOptions(all);
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setActive(-1); };
  const open = (r) => { const target = resultTarget(r); if (target) onOpen(target); };
  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && items.length) { e.preventDefault(); open(items[active >= 0 ? active : 0]); }
    else if (e.key === 'Escape') { setQ(''); }
  }
  const expanded = state.phase === 'done' || state.phase === 'failed';

  return <section aria-label="Search contracts" className="space-y-2" data-testid="contract-search">
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${ids}-q`} className="sr-only">Legal search across templates, agreements and governance records</label>
      <input id={`${ids}-q`} ref={box} className={`${input} min-w-64 flex-1`} type="search" role="combobox" autoComplete="off" maxLength={200}
        aria-expanded={expanded} aria-controls={listId} aria-activedescendant={active >= 0 ? `${ids}-r${active}` : undefined}
        placeholder="Search templates, agreements and governance  ( / )" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} />
      <label className="flex min-h-[44px] items-center gap-2 text-[12px]"><input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Include historical versions</label>
    </div>
    <p role="status" aria-live="polite" className="text-[11.5px] text-axal-muted" data-testid="contract-search-summary">
      {state.phase === 'loading' ? 'Searching…' : state.phase === 'done' ? summaryLine(state.data) + (activeFilterCount(filters) ? ` · filtered to ${items.length} of ${all.length} shown` : '') : ''}</p>
    {state.phase === 'done' && all.length > 0 && <div role="group" aria-label="Filter results" className="flex flex-wrap items-end gap-2 text-[11px]" data-testid="contract-search-filters">
      <FilterSelect id={`${ids}-ft`} label="Type" value={filters.type} onChange={(v) => setFilter('type', v)} options={[['all', 'All types'], ...options.types]} />
      <FilterSelect id={`${ids}-fs`} label="State" value={filters.state} onChange={(v) => setFilter('state', v)} options={[['all', 'Any state'], ...options.states]} />
      <FilterSelect id={`${ids}-fc`} label="Entity or company" value={filters.context} onChange={(v) => setFilter('context', v)} options={[['all', 'Any'], ...options.contexts]} />
      <FilterSelect id={`${ids}-fu`} label="Updated" value={filters.updated} onChange={(v) => setFilter('updated', v)} options={UPDATED_WINDOWS.map(([k, l]) => [k, l])} />
      {activeFilterCount(filters) > 0 && <button type="button" className="min-h-[44px] underline md:min-h-0" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
    </div>}
    {state.phase === 'failed' && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{state.message}</p>}
    {state.phase === 'done' && <ul id={listId} role="listbox" aria-label="Search results" className="divide-y divide-axal-hairline rounded-xl border border-axal-hairline bg-white dark:bg-gray-900">
      {items.length === 0 ? <li role="option" aria-selected="false" aria-disabled="true" className="p-3 text-[12.5px] text-axal-muted">{all.length > 0 ? 'No result passes these filters.' : <>No template, agreement or governance record matches “{state.data.q}”.</>}</li>
        : items.map((r, i) => <li key={r.key} id={`${ids}-r${i}`} role="option" aria-selected={i === active}
          className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-[12.5px] ${i === active ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => open(r)} data-testid={`search-result-${r.key}`}>
          <span className="min-w-0"><span className="block font-semibold">{r.title}</span>
            <span className="block text-[11px] text-axal-muted"><span className={`mr-1 rounded border px-1 font-bold uppercase tracking-wider ${r.type === 'template' ? 'border-dashed' : ''} border-axal-hairline`}>{OBJECT_TAGS[r.type]}</span>
              {r.context || 'No entity or company recorded'}</span></span>
          <span className="flex flex-wrap items-center gap-1.5">
            {resultBadge(r) ? <LifecycleBadge badge={resultBadge(r)} testId={`search-badge-${r.type}`} /> : <span className="text-[11px] text-axal-muted">State not recorded</span>}
            {resultOverlays(r).map((k) => <SafetyOverlayBadge key={k} kind={k} />)}
            {versionLine(r) && <span className="font-mono text-[11px] text-axal-muted">{versionLine(r)}</span>}
          </span></li>)}
    </ul>}
  </section>;
}

function FilterSelect({ id, label, value, onChange, options }) {
  return <label htmlFor={id} className="flex flex-col gap-0.5 font-semibold">{label}
    <select id={id} className="min-h-[44px] rounded-lg border border-axal-hairline bg-white px-2 py-1 font-normal dark:bg-gray-900 md:min-h-0" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}
