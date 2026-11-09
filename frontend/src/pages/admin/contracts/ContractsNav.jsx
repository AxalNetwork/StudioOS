import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * D4811 (#4811) part 7 — the Contracts desk's information architecture (boards
 * CT-01, CT-90 "Navigation", CT-92 "Tabs and URL"): four workflow tabs,
 * Agreements · Templates · Corporate Governance · Closings. NDAs and Partner
 * deals are categories inside Agreements (a radiogroup, CT-93); Forms and
 * Document types sit under a Library disclosure (not an ARIA menu, CT-93).
 *
 * Every existing address keeps working: `?tab=ndas`, `?tab=partner-deals`,
 * `?tab=forms` and `?tab=document-types` still open their view, now inside
 * the new grouping. Other pages link to them (the trust member pages), and
 * the Eadwyn rail tells the views apart by `tab=`.
 */
export const PRIMARY_TABS = Object.freeze(['agreements', 'templates', 'governance', 'closings']);
export const AGREEMENT_CATEGORIES = Object.freeze([['agreements', 'All agreements'], ['ndas', 'NDAs'], ['partner-deals', 'Partner deals']]);
export const LIBRARY_ITEMS = Object.freeze([['forms', 'Forms'], ['document-types', 'Document types']]);

/** Which primary tab a desk view belongs to; null for a Library view. */
export function primaryOf(tab, { governance = false } = {}) {
  if (governance) return 'governance';
  if (AGREEMENT_CATEGORIES.some(([k]) => k === tab)) return 'agreements';
  if (tab === 'templates') return 'templates';
  return null;
}
export const isLibrary = (tab) => LIBRARY_ITEMS.some(([k]) => k === tab);

const tabClass = (on) => `inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${on ? 'border-violet-600 text-axal-ink dark:text-white' : 'border-transparent text-axal-muted'}`;

export default function ContractsNav({ tab, governance, hqDesk, superAdmin, onTab }) {
  const primary = primaryOf(tab, { governance });
  const library = !governance && isLibrary(tab);
  const items = LIBRARY_ITEMS.filter(([k]) => superAdmin || k !== 'document-types');
  return <div className="flex flex-wrap items-end justify-between gap-2 border-b border-axal-hairline">
    <nav aria-label="Contracts" className="flex gap-1 overflow-x-auto">
      <button type="button" className={tabClass(primary === 'agreements')} aria-current={primary === 'agreements' ? 'page' : undefined} onClick={() => onTab('agreements')}>Agreements</button>
      <button type="button" className={tabClass(primary === 'templates')} aria-current={primary === 'templates' ? 'page' : undefined} onClick={() => onTab('templates')}>Templates</button>
      {/* D4563 (#4563): Corporate Governance is at its own path. HQ only. */}
      {hqDesk && <Link to="/admin/contracts/governance" className={tabClass(primary === 'governance')} aria-current={primary === 'governance' ? 'page' : undefined} data-testid="contracts-tab-governance">Corporate Governance</Link>}
      {/* D1219 (#3216): Closings is its own page (D1213), reached from the tab row. */}
      <Link to="/admin/contracts/closings" className={tabClass(false)} data-testid="contracts-tab-closings">Closings</Link>
    </nav>
    <LibraryMenu items={items} current={library ? tab : null} onTab={onTab} />
  </div>;
}

/** The Library disclosure: a button that shows a short list of the configuration views. Escape closes it and returns focus. */
function LibraryMenu({ items, current, onTab }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return <div className="relative pb-1">
    <button ref={button} type="button" aria-expanded={open} aria-controls="contracts-library" data-testid="contracts-library"
      className={`min-h-[44px] rounded-lg border px-3 text-[12.5px] font-semibold ${current ? 'border-violet-600' : 'border-axal-hairline'}`}
      onClick={() => setOpen((o) => !o)}>Library{current ? `: ${items.find(([k]) => k === current)?.[1] || ''}` : ''} <span aria-hidden="true">▾</span></button>
    {open && <ul id="contracts-library" className="absolute right-0 z-10 mt-1 min-w-48 rounded-lg border border-axal-hairline bg-white p-1 shadow-lg dark:bg-gray-900">
      {items.map(([k, label]) => <li key={k}><button type="button" aria-current={current === k ? 'page' : undefined}
        className="block min-h-[44px] w-full rounded px-3 text-left text-[12.5px] hover:bg-axal-ground dark:hover:bg-gray-800"
        onClick={() => { setOpen(false); onTab(k); }}>{label}</button></li>)}
    </ul>}
  </div>;
}

/** The categories inside Agreements (CT-93: a radiogroup; arrow keys move, Tab leaves). */
export function AgreementCategories({ tab, onTab }) {
  const index = Math.max(0, AGREEMENT_CATEGORIES.findIndex(([k]) => k === tab));
  const onKeyDown = (e) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    onTab(AGREEMENT_CATEGORIES[(index + step + AGREEMENT_CATEGORIES.length) % AGREEMENT_CATEGORIES.length][0]);
  };
  return <div role="radiogroup" aria-label="Agreement category" className="flex flex-wrap gap-2" data-testid="agreement-categories" onKeyDown={onKeyDown}>
    {AGREEMENT_CATEGORIES.map(([k, label], i) => <button key={k} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1}
      className={`min-h-[44px] rounded-full border px-3 text-[12.5px] font-semibold ${i === index ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/30' : 'border-axal-hairline'}`}
      onClick={() => onTab(k)}>{label}</button>)}
  </div>;
}
