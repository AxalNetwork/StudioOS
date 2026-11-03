import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import {
  AGENT_RUNS_LINE, NOT_RECORDED, SCOPES, TYPES, apiScope, byDay, coverageLine, dayCounts, emptyLine, filterRows, notYet, NO_PAGE, optionsOf, BUILD, scopedRow, viewingChip, withScope,
} from './calendarScopeModel';

/**
 * D4154 (#4154) — the Calendar's admin scopes (CA1–CA5): the scope switcher,
 * and the read-only Studio (CA2) and Platform (CA3) views over
 * `GET /api/calendar/events?scope=studio|all` (D1206, already mounted).
 *
 * READ-ONLY BY CONSTRUCTION. This view draws no New, no RSVP, no reschedule,
 * no cancel and no push: the route marks every scoped item `read_only` with
 * `can` all false, and an admin never edits another company's events from
 * here. An item's detail (CA4) says where it lives and, once C1 (#4196) sends
 * the link, opens it in its company.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const isNR = (v) => v === NOT_RECORDED;
const Cell = ({ v }) => (isNR(v) ? <span className="italic text-gray-500 dark:text-gray-400">{v}</span> : <>{v}</>);
const time = (r) => {
  if (r.allDay) return 'All day';
  const f = (iso) => { const d = new Date(iso ?? ''); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null; };
  const a = f(r.start); const b = f(r.end);
  return a && b && a !== b ? `${a}–${b}` : a || NOT_RECORDED;
};
const dayTitle = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** CA1 — the segmented control, drawn only for a viewer with a staff scope. */
export function ScopeSwitch({ scopes, scope, pathname, search }) {
  if (!scopes || scopes.length < 2) return null;
  return (
    <nav className="cal-seg" aria-label="Calendar scope" data-testid="cal-scope-switch">
      {scopes.map((s) => (
        <Link key={s.key} to={`${pathname}${withScope(search, s.key)}`} className="cal-btn cal-btn-q"
              aria-current={scope === s.key ? 'page' : undefined} data-testid={`cal-scope-${s.key}`}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** CA4 — one item, read-only. */
function ItemDetail({ row, onClose }) {
  return (
    <aside className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cal-scope-detail">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{row.title}</p>
        <button type="button" className="cal-btn cal-btn-q cal-btn-sm" onClick={onClose}>Close</button>
      </div>
      <p className={MUTED}>{row.type} · <Cell v={row.company} /> · read only</p>
      <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-axal-muted dark:text-gray-400">When</dt><dd>{row.start ? new Date(row.start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: row.allDay ? undefined : 'short' }) : <Cell v={NOT_RECORDED} />}</dd>
        <dt className="text-axal-muted dark:text-gray-400">Who</dt><dd><Cell v={row.owner} />{row.people.filter((n) => n !== row.owner).length ? ` · ${row.people.filter((n) => n !== row.owner).join(', ')}` : ''}</dd>
        <dt className="text-axal-muted dark:text-gray-400">Where it lives</dt><dd><Cell v={row.where} />{row.project ? ` · ${row.project}` : ''}</dd>
        {row.status && <><dt className="text-axal-muted dark:text-gray-400">Status</dt><dd>{row.status}</dd></>}
      </dl>
      <p className={`${MUTED} mt-3`}>Changes are made in the company it belongs to.</p>
      {row.openHref
        ? <Link to={row.openHref} className="cal-btn cal-btn-o cal-btn-sm mt-2" data-testid="cal-scope-open">Open in its company</Link>
        : <button type="button" className="cal-btn cal-btn-o cal-btn-sm mt-2" disabled title={BUILD.C1.live ? NO_PAGE : notYet('C1')} data-testid="cal-scope-open">Open in its company</button>}
    </aside>
  );
}

/** CA2 / CA3 — the scoped read, its filters, the agenda or the month counts, and its states. */
export default function CalendarScopeView({ scope, user, window: win, range, label, pathname, search, scopes, phone = false }) {
  const [state, setState] = useState({ status: 'loading' });
  const [filters, setFilters] = useState({ type: '', project: '', person: '', company: '', studio: '' });
  const [openId, setOpenId] = useState(null);
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const r = await api.listCalendarEvents({ from: win.from.toISOString(), to: win.to.toISOString(), scope: apiScope(scope) });
      setState({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [], coverage: r?.coverage ?? null });
    } catch (e) {
      reportError('calendar-scope:read', e);
      setState({ status: 'unreadable', message: e?.message || '' });
    }
  }, [scope, win.from, win.to]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (state.status === 'ready' ? state.items.map(scopedRow) : []), [state]);
  const shown = filterRows(rows, filters);
  const projects = [...new Set(rows.map((r) => r.project).filter(Boolean))].sort();
  const companies = optionsOf(rows, 'company');
  const studios = optionsOf(rows, 'studio');
  const complete = state.coverage?.complete === true;
  const month = range === 'month' && !phone;
  const open = rows.find((r) => r.id === openId) || null;

  let body;
  if (state.status === 'loading') body = <p className={MUTED} role="status" data-testid="cal-scope-reading">Reading…</p>;
  else if (state.status === 'unreadable') {
    body = (
      <div className="cal-alert" role="alert" data-testid="cal-scope-unreadable">
        <div style={{ minWidth: 0 }}><strong>The calendar could not be read.</strong> That is not the same as nothing being booked.</div>
        <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={load}>Try again</button>
      </div>
    );
  } else if (!shown.length && !month) body = <p className={MUTED} data-testid="cal-scope-empty">{emptyLine(scope, user, complete)}</p>;
  else if (month) {
    body = (
      <div className="grid grid-cols-7 gap-1" data-testid="cal-scope-month">
        {dayCounts(shown, win.from, win.to, complete).map((d) => (
          <div key={d.day} className="rounded-md border border-axal-hairline p-1.5 text-[11.5px] dark:border-gray-800">
            <span className="font-semibold text-axal-ink dark:text-gray-100">{Number(d.day.slice(8))}</span>
            <br /><span className={isNR(d.line) ? 'italic text-gray-500 dark:text-gray-400' : 'text-axal-muted dark:text-gray-400'}>{d.line}</span>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4" data-testid="cal-scope-agenda">
        {byDay(shown).map((d) => (
          <section key={d.day}>
            <p className="text-[12px] font-bold text-axal-ink dark:text-gray-100">{dayTitle(d.day)} <span className="font-normal text-axal-muted dark:text-gray-400">· {d.line}</span></p>
            <ul className="mt-1 divide-y divide-axal-hairline dark:divide-gray-800">
              {d.items.map((r) => (
                <li key={r.id}>
                  <button type="button" className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-left text-[12.5px]" onClick={() => setOpenId(r.id)} data-testid={`cal-scope-row-${r.id}`}>
                    <span className="w-24 flex-none tabular-nums text-axal-muted dark:text-gray-400">{time(r)}</span>
                    <span className="w-24 flex-none text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">{r.type}</span>
                    <span className={`min-w-0 flex-1 font-semibold text-axal-ink dark:text-gray-100 ${r.cancelled ? 'line-through' : ''}`}>{r.title}</span>
                    <span className="text-axal-muted dark:text-gray-400"><Cell v={r.owner} /> · <Cell v={r.company} />{r.project ? ` › ${r.project}` : ''}{scope === 'platform' && r.studio ? ` · ${r.studio}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="cal" data-testid="calendar-scope-page" data-scope={scope}>
      <header className="cal-head">
        <div style={{ minWidth: 0 }}>
          <h1>Calendar <span className="cal-chip" data-testid="cal-scope-chip">{viewingChip(scope, user)}</span></h1>
          <p>Everything booked on StudioOS, in one place.</p>
        </div>
        <div className="cal-head-actions"><ScopeSwitch scopes={scopes} scope={scope} pathname={pathname} search={search} /></div>
      </header>
      <div className="cal-controls">
        <div>
          <span className="cal-range cal-mono">{label}</span>
          {state.status === 'ready' && <span className="cal-meta" data-testid="cal-scope-coverage">{coverageLine(state.coverage, scope, user)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope === 'platform' && (BUILD.C1.live
            ? <select className={SELECT} value={filters.studio} onChange={(e) => setFilters((f) => ({ ...f, studio: e.target.value }))} aria-label="Branch">
                <option value="">Branch: all</option>{studios.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            : <select className={SELECT} disabled title={notYet('C1')} aria-label="Branch"><option>Branch: all</option></select>)}
          {BUILD.C1.live
            ? <select className={SELECT} value={filters.company} onChange={(e) => setFilters((f) => ({ ...f, company: e.target.value }))} aria-label="Company">
                <option value="">Company: all</option>{companies.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            : <select className={SELECT} disabled title={notYet('C1')} aria-label="Company"><option>Company: all</option></select>}
          <select className={SELECT} value={filters.project} onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value }))} aria-label="Project">
            <option value="">Project: all</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className={SELECT} value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} aria-label="Type">
            <option value="">Type: all</option>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input className={SELECT} placeholder="Person or agent, by name" value={filters.person} onChange={(e) => setFilters((f) => ({ ...f, person: e.target.value }))} aria-label="Person or agent, by name" />
          <span className="cal-chip">Read only</span>
        </div>
      </div>
      <div className={`grid gap-4 ${open ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
        <section className="min-w-0">{body}</section>
        {open ? <ItemDetail row={open} onClose={() => setOpenId(null)} /> : null}
      </div>
      <p className={`${MUTED} mt-3`}>{AGENT_RUNS_LINE}</p>
    </div>
  );
}

export { SCOPES };
