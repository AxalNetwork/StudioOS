import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { PhoneSheet } from '../../ui/phone/PhoneSheet.jsx';
import { useEscapeClose } from '../../components/useEscapeClose.js';
import { BTN } from './AccountCenter';
import { menuKey } from './discoverModel';

/**
 * D753 F6 (#1877) — Discover's filter: a menu on desktop, a bottom sheet on a
 * phone, and the chips that show and clear each active choice. The rows and
 * their counts are `discoverFacets`'s; this file only draws and steers them.
 * Two choices are held at a time, one per group: "where" (All categories, a
 * category, a cycle or a sign-in kind) and Type. Choosing in one keeps the
 * other, and the menu stays open so both can be set while the grid updates.
 */

const ROW = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-axal-ink hover:bg-axal-ground focus:bg-axal-ground focus:outline-none dark:text-gray-100 dark:hover:bg-gray-800 dark:focus:bg-gray-800';
const MENU = 'z-30 flex w-72 flex-col rounded-xl border border-axal-hairline bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900';
const GROUP_LABEL = 'px-2.5 pb-1 pt-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400';

/** A row's count: right-aligned, or "Not recorded" with its reason as the title. */
function Count({ row }) {
  if (row.count === null) {
    return <span className="ml-auto text-[11.5px] text-axal-muted dark:text-gray-400" title={row.reason || undefined}>Not recorded</span>;
  }
  return <span className="ml-auto font-mono text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{row.count}</span>;
}

function Choice({ row, group, focused, refFor, onChoose }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={row.active} tabIndex={focused ? 0 : -1} ref={refFor}
      onClick={() => onChoose(group, row.id)} title={row.count === null ? row.reason || undefined : undefined}
      className={ROW} data-testid={`filter-${group}-${row.id}`}>
      <span className="grid w-4 place-items-center text-axal-violet dark:text-violet-300" aria-hidden="true">{row.active ? <Check size={13} /> : null}</span>
      <span className="min-w-0 truncate">{row.label}</span>
      <Count row={row} />
    </button>
  );
}

/** The menu's rows in focus order: the where group, the two submenu parents, then Type. */
function menuRows(facets) {
  const rows = [facets.all, ...facets.categories].map((r) => ({ kind: 'choice', group: 'where', row: r }));
  if (facets.cycles.length) rows.push({ kind: 'parent', sub: 'cycle', label: 'Cycle', rows: facets.cycles });
  if (facets.signIn.length) rows.push({ kind: 'parent', sub: 'sign_in', label: 'Sign-in', rows: facets.signIn });
  for (const r of facets.types) rows.push({ kind: 'choice', group: 'type', row: r });
  return rows;
}

export function ConnectorFilterMenu({ facets, value, onChange, phone = false, initialOpen = false, initialSub = null, shown = null }) {
  const [open, setOpen] = useState(initialOpen);
  const rows = menuRows(facets);
  const parents = Object.fromEntries(rows.map((r, i) => [i, r.kind === 'parent' ? r.sub : null]).filter(([, s]) => s));
  const checked = Math.max(0, rows.findIndex((r) => r.kind === 'choice' && r.row.active));
  const [nav, setNav] = useState(() => ({
    open: initialOpen, index: initialSub ? rows.findIndex((r) => r.sub === initialSub) : checked, sub: initialSub, subIndex: 0,
  }));
  const trigger = useRef(null);
  const box = useRef(null);
  const itemRefs = useRef([]);
  const subRefs = useRef([]);

  const close = (returnFocus = true) => {
    setOpen(false);
    setNav((n) => ({ ...n, open: false, sub: null, subIndex: 0 }));
    if (returnFocus) trigger.current?.focus?.();
  };
  // Escape closes the topmost layer only: a lightbox under the menu stays open.
  useEscapeClose(() => close(true), { active: open && !phone });

  useEffect(() => {
    if (!open || phone) return undefined;
    const off = (e) => { if (box.current && !box.current.contains(e.target) && !trigger.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move the real focus to the row the keyboard state names.
  useEffect(() => {
    if (!open || phone) return;
    if (nav.sub) subRefs.current[nav.subIndex]?.focus?.();
    else itemRefs.current[nav.index]?.focus?.();
  }, [open, phone, nav.index, nav.sub, nav.subIndex]);

  const choose = (group, id) => onChange({ ...value, [group]: id });
  const subRows = nav.sub ? (rows.find((r) => r.sub === nav.sub)?.rows || []) : [];

  const onTriggerKey = (e) => {
    if (phone || open) return;
    const next = menuKey({ ...nav, open: false }, e.key, { size: rows.length, parents, checked });
    if (next.open) { e.preventDefault(); setOpen(true); setNav(next); }
  };
  const onMenuKey = (e) => {
    // Escape on the menu itself is the shared stack's (useEscapeClose); a submenu's Escape is ours.
    if (e.key === 'Escape' && !nav.sub) return;
    const next = menuKey(nav, e.key, { size: rows.length, subSize: subRows.length, parents, checked });
    if (next.prevent) e.preventDefault();
    if (!next.open) { close(next.returnFocus); return; }
    if (next.choose) {
      const r = nav.sub ? { group: 'where', row: subRows[nav.subIndex] } : rows[nav.index];
      if (r?.row) choose(r.group, r.row.id);
    }
    setNav(next);
  };

  const triggerBtn = (
    <button type="button" ref={trigger} className={BTN.ghost} aria-label="Filter connectors" aria-haspopup={phone ? 'dialog' : 'menu'}
      aria-expanded={open} onClick={() => (open ? close(false) : (setOpen(true), setNav({ open: true, index: checked, sub: null, subIndex: 0 })))}
      onKeyDown={onTriggerKey} data-testid="button-connectors-filter">
      <SlidersHorizontal size={14} aria-hidden="true" />
    </button>
  );

  if (phone) {
    return (
      <>
        {triggerBtn}
        {open && (
          <PhoneSheet title="Filter connectors" opener={trigger} onClose={() => close(false)}>
            <FilterSheetBody facets={facets} value={value} onChange={onChange} shown={shown} onDone={() => close(false)} />
          </PhoneSheet>
        )}
      </>
    );
  }

  let n = -1;
  return (
    <div className="relative">
      {triggerBtn}
      {open && (
        <div ref={box} role="menu" aria-label="Filter connectors" className={`${MENU} absolute right-0 top-10`} onKeyDown={onMenuKey} data-testid="connectors-filter-menu">
          <div role="group" aria-label="Category" className="flex flex-col">
            {rows.filter((r) => r.kind === 'choice' && r.group === 'where').map((r) => {
              n += 1; const i = n;
              return <Choice key={r.row.id} row={r.row} group="where" focused={nav.index === i && !nav.sub} refFor={(el) => { itemRefs.current[i] = el; }} onChoose={choose} />;
            })}
            {rows.filter((r) => r.kind === 'parent').map((r) => {
              n += 1; const i = n;
              const expanded = nav.sub === r.sub;
              const activeChild = r.rows.find((x) => x.active);
              return (
                <div key={r.sub} className="relative">
                  <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={expanded} tabIndex={nav.index === i && !nav.sub ? 0 : -1}
                    ref={(el) => { itemRefs.current[i] = el; }} onClick={() => setNav({ open: true, index: i, sub: expanded ? null : r.sub, subIndex: 0 })}
                    className={ROW} data-testid={`filter-parent-${r.sub}`}>
                    <span className="grid w-4 place-items-center text-axal-violet dark:text-violet-300" aria-hidden="true">{activeChild ? <Check size={13} /> : null}</span>
                    <span className="min-w-0 truncate">{r.label}</span>
                    <ChevronRight size={13} aria-hidden="true" className="ml-auto text-axal-muted dark:text-gray-400" />
                  </button>
                  {expanded && (
                    <div role="menu" aria-label={r.label} className={`${MENU} absolute right-full top-0 mr-1`} data-testid={`connectors-filter-sub-${r.sub}`}>
                      {r.rows.map((row, j) => (
                        <Choice key={row.id} row={row} group="where" focused={nav.subIndex === j} refFor={(el) => { subRefs.current[j] = el; }} onChoose={choose} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div role="separator" className="my-1 h-px bg-axal-hairline dark:bg-gray-800" />
          <div role="group" aria-label="Type" className="flex flex-col">
            {rows.filter((r) => r.kind === 'choice' && r.group === 'type').map((r) => {
              n += 1; const i = n;
              return <Choice key={r.row.id} row={r.row} group="type" focused={nav.index === i && !nav.sub} refFor={(el) => { itemRefs.current[i] = el; }} onChoose={choose} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The phone sheet's body: four fieldsets of native radios, no submenus. */
export function FilterSheetBody({ facets, value, onChange, shown = null, onDone = () => {} }) {
  const radio = (group, name, row) => (
    <label key={row.id} className="flex min-h-[52px] items-center gap-3 border-b border-axal-hairline px-1 text-[15px] text-axal-ink dark:border-gray-800 dark:text-gray-100"
      title={row.count === null ? row.reason || undefined : undefined} data-testid={`filter-${group}-${row.id}`}>
      <input type="radio" name={name} value={row.id} checked={row.active} onChange={() => onChange({ ...value, [group]: row.id })}
        className="h-4 w-4 accent-axal-violet" />
      <span className="min-w-0 flex-1">{row.label}</span>
      <Count row={row} />
    </label>
  );
  const fieldset = (legend, group, name, list) => list.length > 0 && (
    <fieldset className="mb-3">
      <legend className={GROUP_LABEL}>{legend}</legend>
      {list.map((row) => radio(group, name, row))}
    </fieldset>
  );
  return (
    <div data-testid="connectors-filter-sheet">
      {fieldset('Category', 'where', 'connectors-where', [facets.all, ...facets.categories])}
      {fieldset('Cycle', 'where', 'connectors-where', facets.cycles)}
      {fieldset('Sign-in', 'where', 'connectors-where', facets.signIn)}
      {fieldset('Type', 'type', 'connectors-type', facets.types)}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button type="button" className={BTN.ghost} onClick={() => onChange({ where: 'all', type: 'all' })}>Clear filters</button>
        <button type="button" className={BTN.primary} onClick={onDone} data-testid="button-connectors-filter-show">
          Show {shown ?? 0} connector{shown === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

/** The chips under the toolbar: each active choice with its ×, and "Clear filters" when both groups have one. */
export function ActiveFilters({ chips, onClear }) {
  if (!chips?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="connectors-active-filters">
      {chips.map((c) => (
        <span key={c.group} className="inline-flex items-center gap-1 rounded-full border border-axal-violet/30 bg-axal-lavender py-1 pl-3 pr-1.5 text-[12px] font-semibold text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300">
          {c.label}
          <button type="button" aria-label={`Clear ${c.label}`} onClick={() => onClear(c.group)} className="grid h-4 w-4 place-items-center rounded-full hover:bg-white/60 dark:hover:bg-gray-800"><X size={11} aria-hidden="true" /></button>
        </span>
      ))}
      {chips.length > 1 && <button type="button" className={BTN.link} onClick={() => onClear('all')}>Clear filters</button>}
    </div>
  );
}
