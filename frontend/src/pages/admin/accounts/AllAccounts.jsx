/**
 * D1305 (#3402, part 6 of #2377) — All accounts (ACC2, ACC3, ACC12): the
 * table over D1300's list read, the profile and sub-account chips, Filters,
 * Sort, Views with "Save this view…", Columns, the bulk bar, each row's ⋯
 * menu, paging, and the states (ACC9b no match, ACC10 loading, ACC11b trust
 * unreadable, ACC11c failed). The rules are `allAccountsModel.js`'s.
 *
 * The console (`../consoles/UsersConsole.jsx`) owns the record and the
 * actions: a row's click and every menu item are handed to it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Search, X } from 'lucide-react';
import { api } from '../../../lib/api';
import { adminAccountWritesApi } from '../../../lib/api/adminAccountWrites.js';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  COLUMNS, EXPORT_COLUMNS, FILTER_GROUPS, PAGE_SIZES, PROFILE_CHIPS, RESEND_CAP, SORTS, SUB_CHIPS,
  chipsOf, clearFilters, countLine, exportProblem, fromViewQuery, initialState, listParams, narrowed, removeChip,
  resendView, rowMenu, rowView, seenValues, sortLabel, toViewQuery, toggleOption, unreadableOf, viewProblem,
} from './allAccountsModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold';
const SECONDARY = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:border-violet-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const PRIMARY = `${BTN} border border-violet-600 bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const CHIP = (on) => `inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ${on
  ? 'border border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
  : 'border border-axal-hairline bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`;
const POP = 'absolute z-20 mt-1 rounded-xl border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900';
const ITEM = (on) => `flex min-h-[36px] w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[13px] ${on ? 'bg-axal-lavender font-bold dark:bg-violet-950/40' : 'font-medium hover:bg-gray-50 dark:hover:bg-gray-800'} ${INK}`;
const TONE = { pos: 'text-emerald-700 dark:text-emerald-400', neg: 'text-red-700 dark:text-red-400', amb: 'text-amber-800 dark:text-amber-300', mut: MUTED };
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');

/** A small popover that closes on Escape or a click outside it. */
function Pop({ open, onClose, className = '', children, testId }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`${POP} ${className}`} data-testid={testId}>{children}</div>;
}

const Box = ({ on, round }) => (
  <span aria-hidden className={`grid h-4 w-4 flex-none place-items-center text-[10px] font-extrabold leading-none ${round ? 'rounded-full' : 'rounded'} ${on ? 'border border-violet-600 bg-violet-600 text-white' : 'border-[1.5px] border-axal-hairline bg-white text-transparent dark:border-gray-600 dark:bg-gray-900'}`}>{on ? (round ? '●' : '✓') : ''}</span>
);

function Dialog({ title, onClose, footer, children, testId }) {
  return <Lightbox label={title} title={title} onClose={onClose} width={560} phone="sheet" testId={testId} footer={footer}>{children}</Lightbox>;
}

function FiltersPanel({ state, set, rows, matched, onClose }) {
  const [country, setCountry] = useState('');
  return (
    <div className="flex w-[min(420px,calc(100vw-32px))] flex-col gap-3 p-2" data-testid="accounts-filters-panel">
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {FILTER_GROUPS.map((g) => {
          const options = g.options || seenValues(rows, g.key, state.filters[g.key]).map((v) => [v, v === 'free' ? 'Free' : v]);
          return (
            <fieldset key={g.key} className="border-b border-axal-hairline py-2.5 last:border-0 dark:border-gray-800" data-testid={`accounts-filter-${g.key}`}>
              <legend className={`mb-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[.07em] ${MUTED}`}>{g.label}</legend>
              {g.search ? (
                <form className="mb-1.5 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); const c = country.trim(); if (c && !state.filters.country.includes(c)) set(toggleOption(state, 'country', c)); setCountry(''); }}>
                  <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder={g.search} maxLength={60} className="min-h-[36px] flex-1 rounded-[7px] border border-axal-hairline bg-white px-2.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-filter-country-input" />
                  <button type="submit" className={SECONDARY}>Add</button>
                </form>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {options.length ? options.map(([v, label]) => {
                  const on = g.single ? (state[g.key] || '') === v : (state.filters[g.key] || []).includes(v);
                  return (
                    <button key={v || 'any'} type="button" role={g.single ? 'radio' : 'checkbox'} aria-checked={on ? 'true' : 'false'}
                      onClick={() => set(toggleOption(state, g.key, v))} className={`flex min-h-[32px] items-center gap-2 text-[13px] ${INK}`} data-testid={`accounts-filter-${g.key}-${v || 'any'}`}>
                      <Box on={on} round={g.single} />{label}
                    </button>
                  );
                }) : <span className={`text-[12.5px] ${MUTED}`}>None on this page yet.</span>}
              </div>
              {g.key === 'joined' && state.joined === 'custom' ? (
                <div className="mt-1.5 flex gap-2">
                  <label className={`flex flex-col text-[11.5px] ${MUTED}`}>From<input type="date" value={state.joined_from} onChange={(e) => set({ ...state, joined_from: e.target.value, page: 0 })} className="min-h-[36px] rounded-[7px] border border-axal-hairline px-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-filter-joined-from" /></label>
                  <label className={`flex flex-col text-[11.5px] ${MUTED}`}>To<input type="date" value={state.joined_to} onChange={(e) => set({ ...state, joined_to: e.target.value, page: 0 })} className="min-h-[36px] rounded-[7px] border border-axal-hairline px-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-filter-joined-to" /></label>
                </div>
              ) : null}
              {g.extra ? <p className={`mt-1 text-[11.5px] ${MUTED}`}>{g.extra}</p> : null}
            </fieldset>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={SECONDARY} onClick={() => set(clearFilters(state))} data-testid="accounts-filters-clear">Clear all</button>
        <button type="button" className={PRIMARY} onClick={onClose} data-testid="accounts-filters-show">{matched == null ? 'Show accounts' : `Show ${fmt(matched)} account${matched === 1 ? '' : 's'}`}</button>
      </div>
    </div>
  );
}

function SaveViewDialog({ state, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState('admin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problem = viewProblem(name, scope);
  const save = async () => {
    setBusy(true); setErr('');
    try { await adminAccountWritesApi.adminSaveAccountView({ name: name.trim(), scope, query: toViewQuery(state) }); onSaved(name.trim()); }
    catch (e) { setErr(e?.message || 'The view could not be saved. Nothing was saved.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Save this view" onClose={onClose} testId="accounts-save-view"
      footer={<div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy || !!problem} onClick={save} data-testid="accounts-save-view-save">{busy ? 'Saving…' : 'Save view'}</button></div>}>
      <label className={`flex flex-col gap-1 text-[12px] font-semibold ${MUTED}`}>Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-h-[40px] rounded-[7px] border border-axal-hairline px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-save-view-name" />
      </label>
      <div role="radiogroup" aria-label="Who sees it" className="mt-3 flex flex-col gap-1">
        {[['admin', 'Only me'], ['studio', 'Every admin of this studio']].map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={scope === k ? 'true' : 'false'} onClick={() => setScope(k)} className={`flex min-h-[40px] items-center gap-2 text-[13px] ${INK}`} data-testid={`accounts-save-view-${k}`}><Box on={scope === k} round />{label}</button>
        ))}
      </div>
      <p className={`mt-2 text-[12.5px] ${MUTED}`}>It keeps the profile, filters, sort and columns. Nobody is told.</p>
      {err ? <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400">{err}</p> : null}
    </Dialog>
  );
}

function ResendDialog({ ids, onClose, onDone }) {
  const [dry, setDry] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    adminAccountWritesApi.adminBulkResendVerification(ids, { dryRun: true })
      .then((r) => { if (live) setDry(r); })
      .catch((e) => { if (live) setErr(e?.message || 'Who would be emailed could not be read. Nothing was sent.'); });
    return () => { live = false; };
  }, [ids]);
  const v = dry ? resendView(dry) : null;
  const send = async () => {
    setBusy(true); setErr('');
    try { const r = await adminAccountWritesApi.adminBulkResendVerification(ids); onDone(`Sent ${r.sent} verification email${r.sent === 1 ? '' : 's'}.`); }
    catch (e) { setErr(e?.message || 'Nothing was sent.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={v ? v.title : 'Resend the verification email'} onClose={onClose} testId="accounts-resend"
      footer={<div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>{v?.send ? <button type="button" className={PRIMARY} disabled={busy} onClick={send} data-testid="accounts-resend-send">{busy ? 'Sending…' : v.send}</button> : null}</div>}>
      {!dry && !err ? <p className={`text-[13px] ${MUTED}`}>Reading who would be emailed…</p> : null}
      {v?.skipped ? <p className={`text-[13px] ${INK}`} data-testid="accounts-resend-skipped">{v.skipped}</p> : null}
      {v?.none ? <p className={`text-[13px] ${INK}`} data-testid="accounts-resend-none">{v.none}</p> : null}
      {v ? <p className={`mt-2 text-[12.5px] ${MUTED}`}>Each send is recorded in that account’s activity.</p> : null}
      {err ? <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400">{err}</p> : null}
    </Dialog>
  );
}

function ExportDialog({ ids, onClose, onDone }) {
  const [columns, setColumns] = useState(EXPORT_COLUMNS.map(([k]) => k));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problem = exportProblem(reason, columns);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await adminAccountWritesApi.adminExportAccounts({ reason: reason.trim(), user_ids: ids, columns });
      try {
        const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = r.filename || 'accounts.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { /* the file could not be offered; the export is recorded either way */ }
      onDone(`Exported ${r.rows} account${r.rows === 1 ? '' : 's'}. Recorded under your name, with your reason.`);
    } catch (e) { setErr(e?.message || 'Nothing was exported.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Export accounts" onClose={onClose} testId="accounts-export"
      footer={<div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY} disabled={busy || !!problem} onClick={go} data-testid="accounts-export-go">{busy ? 'Exporting…' : 'Export CSV'}</button></div>}>
      <p className={`text-[13px] ${INK}`} data-testid="accounts-export-which">The {fmt(ids.length)} selected.</p>
      <fieldset className="mt-3"><legend className={`mb-1 text-[12px] font-semibold ${MUTED}`}>Columns</legend>
        <div className="grid grid-cols-2 gap-x-4">
          {EXPORT_COLUMNS.map(([k, label]) => {
            const on = columns.includes(k);
            return <button key={k} type="button" role="checkbox" aria-checked={on ? 'true' : 'false'} onClick={() => setColumns((c) => (on ? c.filter((x) => x !== k) : [...c, k]))} className={`flex min-h-[34px] items-center gap-2 text-[13px] ${INK}`} data-testid={`accounts-export-col-${k}`}><Box on={on} />{label}</button>;
          })}
        </div>
      </fieldset>
      <p className={`mt-2 text-[12.5px] ${MUTED}`}>Format: CSV</p>
      <label className={`mt-2 flex flex-col gap-1 text-[12px] font-semibold ${MUTED}`}>Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Required" className="rounded-[7px] border border-axal-hairline px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-export-reason" />
      </label>
      <p className={`mt-2 text-[12.5px] ${INK}`}>The file holds names and emails. Each export is recorded under your name.</p>
      {err ? <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700 dark:text-red-400">{err}</p> : null}
    </Dialog>
  );
}

/**
 * The table. `controlsFor(u)` is the console's `drawsAccountControls`;
 * `onOpen(u)` opens a record and `onAction(id, u)` runs a menu item.
 */
export default function AllAccounts({ scopeLine = '', controlsFor = () => false, onOpen, onAction, onRows, reloadKey = 0 }) {
  const [state, setState] = useState(initialState);
  const [query, setQuery] = useState('');
  const [read, setRead] = useState({ status: 'loading', env: null });
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(null); // 'filters' | 'sort' | 'views' | 'columns' | `menu:<id>`
  const [checked, setChecked] = useState([]);
  const [views, setViews] = useState({ status: 'loading', list: [] });
  const [dialog, setDialog] = useState(null);
  const [note, setNote] = useState('');

  // The search waits for a pause and two characters, as D128's route refuses one.
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.q === query ? s : { ...s, q: query, page: 0 })), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: r.env ? 'refreshing' : 'loading', env: r.env }));
    api.adminListUsers(listParams(state))
      .then((env) => { if (live) { setRead({ status: 'ok', env }); onRows?.(Array.isArray(env?.results) ? env.results : []); } })
      .catch((e) => { reportError('AllAccounts:list', e); if (live) setRead({ status: 'error', env: null, message: e?.message || '' }); });
    return () => { live = false; };
  }, [state, tick, reloadKey]);

  const loadViews = () => {
    adminAccountWritesApi.adminAccountViews()
      .then((r) => setViews({ status: 'ok', list: Array.isArray(r?.views) ? r.views : [] }))
      .catch((e) => { reportError('AllAccounts:views', e); setViews({ status: 'error', list: [] }); });
  };
  useEffect(loadViews, []);

  const set = (next) => { setState(next); setChecked([]); };
  const env = read.env;
  const rows = env?.results || [];
  const now = Date.now();
  const cols = state.columns;
  const chips = chipsOf(state);
  const isNarrowed = narrowed(state);
  const byRole = env?.by_role || null;
  const allChecked = rows.length > 0 && rows.every((u) => checked.includes(Number(u.id)));
  const toggleRow = (id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const done = (text) => { setDialog(null); setChecked([]); setNote(text); setTick((t) => t + 1); };

  const viewName = (() => {
    const q = JSON.stringify(toViewQuery(state));
    const hit = views.list.find((v) => JSON.stringify(v.query || {}) === q);
    return hit ? hit.name : chips.length || state.sort !== 'joined_desc' ? 'Custom' : 'All accounts';
  })();

  return (
    <div className="flex flex-col gap-3" data-testid="all-accounts">
      <div className="flex flex-wrap items-center gap-2" data-testid="accounts-profile-chips">
        {PROFILE_CHIPS.map((c) => {
          const on = (state.profile || null) === c.value;
          const n = byRole ? (c.value ? Number(byRole[c.value] || 0) : Number(env?.total || 0)) : null;
          return (
            <button key={c.value || 'all'} type="button" aria-pressed={on ? 'true' : 'false'} className={CHIP(on)} onClick={() => set({ ...state, profile: c.value, page: 0 })} data-testid={`accounts-chip-${c.value || 'all'}`}>
              {c.label}{n != null ? <span className="font-mono text-[11.5px] font-medium">{fmt(n)}</span> : null}
            </button>
          );
        })}
        <span className={`ml-1 font-mono text-[10.5px] uppercase tracking-[.07em] ${MUTED}`}>Sub-account</span>
        {SUB_CHIPS.map((c) => {
          const on = state.sub === c.value;
          return <button key={c.value} type="button" aria-pressed={on ? 'true' : 'false'} className={CHIP(on)} onClick={() => set({ ...state, sub: on ? null : c.value, page: 0 })} data-testid={`accounts-chip-${c.value}`}>{c.label}</button>;
        })}
      </div>

      {checked.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2 dark:border-violet-800 dark:bg-violet-950/40" data-testid="accounts-bulk-bar">
          <span className={`text-[13px] font-bold ${INK}`} data-testid="accounts-bulk-count">{checked.length} selected</span>
          <button type="button" className={SECONDARY} disabled={checked.length > RESEND_CAP} title={checked.length > RESEND_CAP ? `At most ${RESEND_CAP} at a time` : undefined} onClick={() => setDialog('resend')} data-testid="accounts-bulk-resend">Resend verification email</button>
          <button type="button" className={SECONDARY} onClick={() => setDialog('export')} data-testid="accounts-bulk-export">Export selected</button>
          <button type="button" className={`${BTN} text-axal-violet-deep dark:text-violet-300`} onClick={() => setChecked([])} data-testid="accounts-bulk-clear">Clear selection</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" data-testid="accounts-toolbar">
          <div className="relative">
            <button type="button" aria-expanded={open === 'views' ? 'true' : 'false'} className={SECONDARY} onClick={() => setOpen(open === 'views' ? null : 'views')} data-testid="accounts-views-open">Views: {viewName} ▾</button>
            <Pop open={open === 'views'} onClose={() => setOpen(null)} className="w-[280px]" testId="accounts-views">
              <button type="button" className={ITEM(viewName === 'All accounts')} onClick={() => { set({ ...initialState(), q: state.q }); setOpen(null); }} data-testid="accounts-view-all">All accounts</button>
              {views.status === 'error' ? <p className={`px-2.5 py-1.5 text-[12.5px] ${MUTED}`} data-testid="accounts-views-unreadable">Saved views could not be read. <button type="button" className="font-semibold text-axal-violet underline dark:text-violet-300" onClick={loadViews}>Try again</button></p> : null}
              {views.list.map((v) => (
                <div key={v.uid} className="flex items-center">
                  <button type="button" className={ITEM(viewName === v.name)} onClick={() => { set(fromViewQuery(v.query, { q: state.q })); setOpen(null); }} data-testid={`accounts-view-${v.uid}`}>
                    <span className="min-w-0 flex-1 truncate">{v.name}</span><span className={`text-[11px] ${MUTED}`}>{v.scope === 'studio' ? 'Studio' : 'Only me'}</span>
                  </button>
                  {v.can_change ? <button type="button" aria-label={`Delete the view ${v.name}`} className={`grid h-9 w-9 flex-none place-items-center rounded-[7px] ${MUTED} hover:bg-gray-50 dark:hover:bg-gray-800`} onClick={() => setDialog({ deleteView: v })} data-testid={`accounts-view-delete-${v.uid}`}><X size={14} /></button> : null}
                </div>
              ))}
              <div className="mt-1 border-t border-axal-hairline pt-1 dark:border-gray-800">
                <button type="button" className={ITEM(false)} onClick={() => { setOpen(null); setDialog('save'); }} data-testid="accounts-save-view-open">Save this view…</button>
              </div>
            </Pop>
          </div>
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search name, email or account ID</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-axal-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or account ID" className="min-h-[36px] w-full rounded-[9px] border border-axal-hairline bg-white py-1.5 pl-9 pr-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="accounts-search" />
          </label>
          <div className="relative">
            <button type="button" aria-expanded={open === 'filters' ? 'true' : 'false'} className={chips.length ? CHIP(true) : SECONDARY} onClick={() => setOpen(open === 'filters' ? null : 'filters')} data-testid="accounts-filters-open">
              Filters{chips.length ? <span className="font-mono text-[11.5px]">{chips.length}</span> : null}
            </button>
            <Pop open={open === 'filters'} onClose={() => setOpen(null)} className="right-0 sm:left-0 sm:right-auto">
              <FiltersPanel state={state} set={set} rows={rows} matched={env?.matched ?? null} onClose={() => setOpen(null)} />
            </Pop>
          </div>
          <div className="relative">
            <button type="button" aria-expanded={open === 'sort' ? 'true' : 'false'} className={SECONDARY} onClick={() => setOpen(open === 'sort' ? null : 'sort')} data-testid="accounts-sort-open">Sort: {sortLabel(state.sort)} ▾</button>
            <Pop open={open === 'sort'} onClose={() => setOpen(null)} className="w-[280px]" testId="accounts-sort">
              {SORTS.map(([k, label]) => <button key={k} type="button" role="menuitemradio" aria-checked={state.sort === k ? 'true' : 'false'} className={ITEM(state.sort === k)} onClick={() => { set({ ...state, sort: k, page: 0 }); setOpen(null); }} data-testid={`accounts-sort-${k}`}><span className="flex-1">{label}</span>{state.sort === k ? '✓' : ''}</button>)}
            </Pop>
          </div>
          <div className="relative">
            <button type="button" aria-expanded={open === 'columns' ? 'true' : 'false'} className={SECONDARY} onClick={() => setOpen(open === 'columns' ? null : 'columns')} data-testid="accounts-columns-open">Columns</button>
            <Pop open={open === 'columns'} onClose={() => setOpen(null)} className="right-0 w-[240px]" testId="accounts-columns">
              {COLUMNS.map((c) => {
                const on = cols.includes(c.key);
                return <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={on ? 'true' : 'false'} className={ITEM(false)} onClick={() => setState((s) => ({ ...s, columns: on ? s.columns.filter((x) => x !== c.key) : COLUMNS.map((x) => x.key).filter((x) => x === c.key || s.columns.includes(x)) }))} data-testid={`accounts-column-${c.key}`}><Box on={on} />{c.label}</button>;
              })}
              <button type="button" className={ITEM(false)} onClick={() => setState((s) => ({ ...s, columns: initialState().columns }))} data-testid="accounts-columns-reset">Reset</button>
            </Pop>
          </div>
          <span className={`ml-auto font-mono text-[12px] ${MUTED}`} data-testid="accounts-count">{env ? countLine(env) : ''}</span>
        </div>
      )}
      {scopeLine ? <p className={`-mt-1 text-[12px] ${MUTED}`} data-testid="accounts-scope">{scopeLine}. Type at least two characters.</p> : null}

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="accounts-chips">
          {chips.map((c) => (
            <span key={c.id} className={CHIP(true)}>{c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => set(removeChip(state, c.id))} className="grid h-5 w-5 place-items-center" data-testid={`accounts-chip-remove-${c.id}`}><X size={12} /></button>
            </span>
          ))}
          <button type="button" className={`${BTN} text-axal-violet-deep dark:text-violet-300`} onClick={() => set(clearFilters(state))} data-testid="accounts-chips-clear">Clear all</button>
        </div>
      ) : null}

      {note ? <p role="status" className="text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="accounts-note">{note}</p> : null}
      {read.status === 'ok' && unreadableOf(env, 'trust') && cols.includes('trust') ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2 text-[13px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200" data-testid="accounts-trust-unreadable">
          <span className="flex-1">Trust scores could not be read. The accounts are shown without them.</span>
          <button type="button" className={SECONDARY} onClick={() => setTick((t) => t + 1)}>Try again</button>
        </div>
      ) : null}

      <div className={`${CARD} overflow-hidden`}>
        {read.status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-6" data-testid="accounts-failed">
            <p className={`m-0 text-[14px] font-bold ${INK}`}>We could not load the accounts.</p>
            <p className={`m-0 text-[13px] ${MUTED}`}>The rest of Accounts still works.</p>
            <button type="button" className={SECONDARY} onClick={() => setTick((t) => t + 1)} data-testid="accounts-retry">Try again</button>
          </div>
        ) : read.status === 'loading' ? (
          <p className={`m-0 p-6 text-[13px] ${MUTED}`} data-testid="accounts-loading">Reading…</p>
        ) : !rows.length ? (
          <div className="flex flex-col items-start gap-2 p-6" data-testid="accounts-none">
            <p className={`m-0 text-[14px] font-bold ${INK}`}>{isNarrowed ? 'No accounts match these filters.' : 'No accounts yet.'}</p>
            {isNarrowed ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={SECONDARY} onClick={() => { setQuery(''); set({ ...clearFilters(state), q: '' }); }} data-testid="accounts-none-clear">Clear filters</button>
                {state.profile ? <button type="button" className={SECONDARY} onClick={() => set({ ...state, profile: null, page: 0 })} data-testid="accounts-none-every">Search every profile</button> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="accounts-table">
              <thead>
                <tr className={`border-b border-axal-hairline bg-gray-50 text-left text-[11.5px] font-semibold dark:border-gray-800 dark:bg-gray-800/40 ${MUTED}`}>
                  <th className="w-10 px-3 py-2.5"><button type="button" role="checkbox" aria-checked={allChecked ? 'true' : 'false'} aria-label="Select every row on this page" onClick={() => setChecked(allChecked ? [] : rows.map((u) => Number(u.id)))} className="grid h-8 w-8 place-items-center" data-testid="accounts-check-all"><Box on={allChecked} /></button></th>
                  <th className="px-3 py-2.5">Account</th>
                  {COLUMNS.filter((c) => cols.includes(c.key)).map((c) => <th key={c.key} className="px-3 py-2.5" data-testid={`accounts-th-${c.key}`}>{c.label}</th>)}
                  <th className="w-12 px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const r = rowView(u, env, now);
                  const on = checked.includes(r.id);
                  const menu = rowMenu(u, { controls: controlsFor(u) });
                  const cell = {
                    profile: <span className="inline-flex flex-wrap items-center gap-1">{r.profile}{r.subs.map((s) => <span key={s} className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold dark:border-gray-700">{s}</span>)}</span>,
                    status: <span className={r.active ? INK : MUTED}>{r.status}</span>,
                    email: <span className={`text-[12px] font-semibold ${r.email_word === 'Verified' ? TONE.pos : TONE.amb}`}>{r.email_word}</span>,
                    identity: <span className="inline-flex flex-wrap items-center gap-1"><span className={`text-[12px] font-semibold ${TONE[r.identity_tone]}`}>{r.identity}</span>{r.limited ? <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[10.5px] text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Limited access</span> : null}</span>,
                    plan: r.plan, country: r.country, last_active: <span className="font-mono text-[12px]">{r.last_active}</span>,
                    joined: <span className="font-mono text-[12px]">{r.joined}</span>,
                    trust: r.trust == null ? <span className={MUTED} title={r.trust_reason}>—</span> : <span className="font-mono text-[12px]" title={r.trust_reason}>{r.trust}</span>,
                    persona: r.persona, completeness: r.completeness,
                  };
                  return (
                    <tr key={r.id} className={`border-b border-axal-hairline last:border-0 dark:border-gray-800 ${on ? 'bg-axal-lavender/60 dark:bg-violet-950/20' : 'hover:bg-violet-50/40 dark:hover:bg-gray-800/40'}`} data-testid={`accounts-row-${r.id}`}>
                      <td className="px-3 py-2"><button type="button" role="checkbox" aria-checked={on ? 'true' : 'false'} aria-label={`Select ${r.name}`} onClick={() => toggleRow(r.id)} className="grid h-8 w-8 place-items-center" data-testid={`accounts-check-${r.id}`}><Box on={on} /></button></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => onOpen?.(u)} className="flex min-h-[40px] flex-col items-start text-left" data-testid={`accounts-open-${r.id}`}>
                          <span className={`font-semibold ${INK}`}>{r.name}</span><span className={`text-[12px] ${MUTED}`}>{r.email}</span>
                        </button>
                      </td>
                      {COLUMNS.filter((c) => cols.includes(c.key)).map((c) => <td key={c.key} className={`px-3 py-2 ${INK}`}>{cell[c.key]}</td>)}
                      <td className="relative px-3 py-2 text-right">
                        <button type="button" aria-label={`Actions for ${r.name}`} aria-expanded={open === `menu:${r.id}` ? 'true' : 'false'} onClick={() => setOpen(open === `menu:${r.id}` ? null : `menu:${r.id}`)} className={`inline-grid h-10 w-10 place-items-center rounded-[7px] ${MUTED} hover:bg-gray-50 dark:hover:bg-gray-800`} data-testid={`accounts-menu-${r.id}`}><MoreHorizontal size={16} /></button>
                        <Pop open={open === `menu:${r.id}`} onClose={() => setOpen(null)} className="right-3 w-[300px] text-left" testId={`accounts-menu-list-${r.id}`}>
                          {menu.items.map((m) => (
                            <button key={m.id} type="button" role="menuitem" className={`${ITEM(false)} ${m.danger ? '!text-red-700 dark:!text-red-400' : ''}`} onClick={() => { setOpen(null); if (m.id === 'open') onOpen?.(u); else onAction?.(m.id, u); }} data-testid={`accounts-menu-${r.id}-${m.id}`}>{m.label}</button>
                          ))}
                          {menu.note ? <p className={`m-0 px-2.5 pb-1 pt-1.5 text-[12px] ${MUTED}`} data-testid={`accounts-menu-${r.id}-note`}>{menu.note} <Link to="/admin/licences" className="font-semibold text-axal-violet underline dark:text-violet-300">Licences</Link></p> : null}
                        </Pop>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {env && rows.length ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-axal-hairline px-3.5 py-2.5 text-[12.5px] dark:border-gray-800" data-testid="accounts-pager">
            <span className={MUTED}>Rows per page</span>
            {PAGE_SIZES.map((n) => <button key={n} type="button" aria-pressed={state.pageSize === n ? 'true' : 'false'} onClick={() => set({ ...state, pageSize: n, page: 0 })} className={`min-h-[32px] px-1.5 font-mono ${state.pageSize === n ? `font-bold ${INK}` : MUTED}`} data-testid={`accounts-size-${n}`}>{n}</button>)}
            <span className={`ml-auto font-mono ${MUTED}`}>{countLine(env)}</span>
            <button type="button" className={SECONDARY} disabled={state.page === 0} onClick={() => set({ ...state, page: state.page - 1 })} data-testid="accounts-prev">Previous</button>
            <button type="button" className={SECONDARY} disabled={env.next_offset == null} onClick={() => set({ ...state, page: state.page + 1 })} data-testid="accounts-next">Next</button>
          </div>
        ) : null}
      </div>

      {dialog === 'save' ? <SaveViewDialog state={state} onClose={() => setDialog(null)} onSaved={(name) => { setDialog(null); setNote(`Saved the view “${name}”.`); loadViews(); }} /> : null}
      {dialog === 'resend' ? <ResendDialog ids={checked} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog === 'export' ? <ExportDialog ids={checked} onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); setNote(t); }} /> : null}
      {dialog?.deleteView ? (
        <Dialog title={`Delete the view “${dialog.deleteView.name}”?`} onClose={() => setDialog(null)} testId="accounts-delete-view"
          footer={<div className="flex justify-end gap-2"><button type="button" className={SECONDARY} onClick={() => setDialog(null)}>Cancel</button><button type="button" className={`${BTN} border border-red-700 bg-red-700 text-white`} onClick={async () => {
            try { await adminAccountWritesApi.adminDeleteAccountView(dialog.deleteView.uid); setDialog(null); setNote('The view was deleted.'); loadViews(); }
            catch (e) { setDialog(null); setNote(e?.message || 'The view could not be deleted.'); }
          }} data-testid="accounts-delete-view-go">Delete view</button></div>}>
          <p className={`text-[13px] ${INK}`}>{dialog.deleteView.scope === 'studio' ? 'Every admin of this studio stops seeing it.' : 'Only you saw it.'} The accounts are not changed.</p>
        </Dialog>
      ) : null}
    </div>
  );
}
