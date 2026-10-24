import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
import { filtersOn } from './lightboxModel';

/**
 * D934 (#2718) — the shell the four Community lightboxes share (CM3–CM6).
 *
 * A centred `Lightbox` over the overview, never a drawer; below 1024px it is
 * a full-screen page with a back link to Community (CM12, `pageBelow="lg"`).
 * Esc and Close call `onClose`, which takes `?open=` off the address, and the
 * `Lightbox` puts focus back on what opened it.
 *
 * Each lightbox owns its read (`useBoxRead`), so a failed read costs only that
 * lightbox and says it is not the same as none. Nothing here decides anything:
 * a row's link opens the item in its console.
 */

export const CTRL = 'min-h-[36px] rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
export const MONO = 'font-mono tabular-nums';
export const TAG = 'rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal text-axal-muted dark:text-gray-400';
export const LINK = 'font-bold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300';

/**
 * One read, made when the lightbox opens, again on Try again, and again when
 * `dep` changes (the activity read's query). `{ status: 'loading' | 'ready' |
 * 'error', data }`. `tag` names it in the error log; nothing else is logged.
 */
export function useBoxRead(load, tag, dep = '') {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  // Only Try again reads again: a new `load` each render does not.
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', data: null });
    loader.current().then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError(`admin-community:${tag}`, e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick, tag, dep]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { read, retry };
}

export function Failed({ id, reason, onRetry }) {
  return (
    <div role="alert" data-testid={`${id}-unreadable`} className="m-5 flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <span>{reason}</span>
      <button type="button" className={DANGER} onClick={onRetry} data-testid={`${id}-retry`}>Try again</button>
    </div>
  );
}

export function Reading({ id }) {
  return <p className={`m-5 font-mono text-[12px] text-axal-muted dark:text-gray-400`} data-testid={`${id}-reading`}>Reading…</p>;
}

/** Search, one select per filter, and the sort. Every change goes back to page 1. */
export function ListControls({ id, spec, state, setState, phone }) {
  const set = (patch) => setState((s) => ({ ...s, ...patch, page: 1 }));
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4" data-testid={`${id}-controls`}>
      <input type="search" aria-label={spec.placeholder} placeholder={spec.placeholder} value={state.q}
        onChange={(e) => set({ q: e.target.value })} className={`${CTRL} min-w-[180px] flex-1`} data-testid={`${id}-search`} />
      {phone ? <span className={`${SUB} ${MONO}`} data-testid={`${id}-filters-on`}>{`Filters · ${filtersOn(state)}`}</span> : null}
      {spec.filters.map((f) => (
        <select key={f.key} aria-label={f.label} value={state.filters[f.key]} className={CTRL} data-testid={`${id}-filter-${f.key}`}
          onChange={(e) => set({ filters: { ...state.filters, [f.key]: e.target.value } })}>
          <option value="">{f.all}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      <select aria-label="Sort" value={state.sort} className={CTRL} data-testid={`${id}-sort`} onChange={(e) => set({ sort: e.target.value })}>
        {spec.sorts.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
      </select>
    </div>
  );
}

/** "1–25 of [N]", with Previous and Next. */
export function Pager({ id, view, none, onPage, note }) {
  const line = view.total ? `${view.from.toLocaleString('en-US')}–${view.to.toLocaleString('en-US')} of ${view.total.toLocaleString('en-US')}` : none;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-testid={`${id}-pager`}>
      <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} data-testid={`${id}-range`}>{line}</span>
      {note ? <span className={SUB}>{note}</span> : null}
      <span className="flex gap-2">
        <button type="button" className={GHOST} disabled={view.page <= 1} onClick={() => onPage(view.page - 1)} data-testid={`${id}-prev`}>‹ Previous</button>
        <button type="button" className={GHOST} disabled={view.page >= view.pages} onClick={() => onPage(view.page + 1)} data-testid={`${id}-next`}>Next ›</button>
      </span>
    </div>
  );
}

/**
 * A table on a desktop, a list on a phone. `cols` is `[{ key, label, tag?,
 * mono? }]`; the first column is the row's title and its console link.
 */
export function BoxTable({ id, cols, rows, phone, phoneLine, phoneValue, empty }) {
  if (!rows.length) return <p className={`${SUB} px-5 py-6`} data-testid={`${id}-empty`}>{empty}</p>;
  if (phone) {
    return (
      <ul className="m-0 flex list-none flex-col p-0" data-testid={`${id}-rows`}>
        {rows.map((r) => (
          <li key={r.id ?? r.key} className="flex items-start justify-between gap-3 border-t border-axal-hairline px-5 py-3 dark:border-gray-800" data-testid={`${id}-row`}>
            <span className="min-w-0">
              {r.href ? <Link to={r.href} className={`${LINK} block text-[13.5px]`}>{r.title}</Link> : <span className="block text-[13.5px] font-bold">{r.title}</span>}
              <span className={`${MONO} block text-[11.5px] text-axal-muted dark:text-gray-400`}>{phoneLine(r)}</span>
            </span>
            <span className={`${MONO} whitespace-nowrap text-[12px] font-semibold`}>{phoneValue(r)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto px-5 pt-3">
      <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]" data-testid={`${id}-table`}>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            {cols.map((c) => (
              <th key={c.key} scope="col" className="whitespace-nowrap px-2 py-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">
                {c.label}{c.tag ? <> <span className={TAG}>{c.tag}</span></> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-testid={`${id}-rows`}>
          {rows.map((r) => (
            <tr key={r.id ?? r.key} className="border-b border-axal-hairline align-top dark:border-gray-800" data-testid={`${id}-row`}>
              {cols.map((c, i) => (
                <td key={c.key} className={`px-2 py-2.5 ${c.mono ? MONO : ''} ${i ? 'whitespace-nowrap text-axal-ink dark:text-gray-100' : ''}`}>
                  {i === 0 && r.href ? <Link to={r.href} className={LINK}>{r[c.key]}</Link> : r[c.key]}
                  {i === 0 && r.badge ? <> <span className={TAG}>{r.badge}</span></> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The `Lightbox`, with the Close footer the canvas draws. `children` is called with whether this is the phone page. */
export function BoxShell({ id, title, sub, onClose, children }) {
  const phone = usePhoneWidth();
  return (
    <Lightbox label={title} title={title} sub={sub} eyebrow="Community" onClose={onClose} width={1040} pageBelow="lg" testId={id}
      footer={phone ? null : <div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose} data-testid={`${id}-done`}>Close</button></div>}>
      {children(phone)}
    </Lightbox>
  );
}
