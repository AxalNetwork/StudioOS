import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill, Skeleton, Unreadable, Unrecorded } from '../../../ui';
import { api } from '../../../lib/api';
import { ZoneHeading, ghostButtonClass } from '../expertise/kit';
import {
  ACCESS_ACTION_LABEL, accessRecord, accessWho, distinctOf, filterAccessRows, stampLabel,
} from './practiceTools';

/** Ops A4: the same recorded opens, scoped to the advisor's own actor or the client's owned project. Read-only. */

const LABEL = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const GRID_CLIENT = 'grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_90px_130px] md:items-center';
const GRID_OWN = 'grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_90px_130px] md:items-center';
const READ_ONLY = 'Read-only. Rows cannot be edited or removed by anyone.';
const filterInput = 'mt-1 rounded-lg border border-axal-hairline bg-white px-2 py-1 text-[12px] dark:border-gray-700 dark:bg-gray-900';

/** The rows, with their filters. Nothing in a row is a control. */
export function AccessLogTable({ rows, showClient = true, initialFilters }) {
  const [filters, setFilters] = useState({ client: '', who: '', from: '', to: '', ...(initialFilters || {}) });
  const list = Array.isArray(rows) ? rows : [];
  const clients = showClient ? distinctOf(list, (r) => r.client) : [];
  const whos = distinctOf(list, accessWho);
  const shown = filterAccessRows(list, showClient ? filters : { ...filters, client: '' });
  const filtered = Boolean(filters.client || filters.who || filters.from || filters.to);
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const grid = showClient ? GRID_CLIENT : GRID_OWN;

  return (
    <div data-testid="access-log-table">
      <div className="flex flex-wrap items-end gap-2">
        {showClient && clients.length > 0 && (
          <label className="text-[11px] text-axal-faint">Client
            <select className={`${filterInput} block`} value={filters.client} onChange={set('client')} data-testid="filter-access-client">
              <option value="">All clients</option>
              {clients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {whos.length > 0 && (
          <label className="text-[11px] text-axal-faint">Who
            <select className={`${filterInput} block`} value={filters.who} onChange={set('who')} data-testid="filter-access-who">
              <option value="">Everyone</option>
              {whos.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
        )}
        <label className="text-[11px] text-axal-faint">From
          <input type="date" className={`${filterInput} block`} value={filters.from} onChange={set('from')} data-testid="filter-access-from" />
        </label>
        <label className="text-[11px] text-axal-faint">To
          <input type="date" className={`${filterInput} block`} value={filters.to} onChange={set('to')} data-testid="filter-access-to" />
        </label>
        {filtered && (
          <button type="button" className={ghostButtonClass}
            onClick={() => setFilters({ client: '', who: '', from: '', to: '' })}>Clear filters</button>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-axal-faint" data-testid="access-count">
          {shown.length} of {list.length} {list.length === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-[10px] border border-dashed border-axal-hairline p-3 text-[12px] text-axal-muted dark:border-gray-700"
          data-testid="access-log-empty">
          No access recorded for this client in this period.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-[10px] border border-axal-hairline dark:border-gray-700">
          <div className={`${grid} hidden border-b border-axal-hairline bg-axal-ground px-3 py-2 md:grid dark:border-gray-700 dark:bg-gray-900/40`}>
            <span className={LABEL}>Who</span>
            <span className={LABEL}>Record</span>
            {showClient && <span className={LABEL}>Client</span>}
            <span className={LABEL}>Action</span>
            <span className={LABEL}>When</span>
          </div>
          {shown.map((row, i) => {
            const record = accessRecord(row);
            const who = accessWho(row);
            const when = stampLabel(row.created_at);
            return (
              <div key={`${row.created_at}-${i}`} className={`${grid} border-b border-axal-hairline px-3 py-2 text-[12px] last:border-b-0 dark:border-gray-800`}
                data-testid="access-row">
                <span className="col-span-2 md:col-span-1">
                  {who ? <Pill tone="neutral">{who}</Pill> : <Unrecorded>Not recorded</Unrecorded>}
                </span>
                <span className="font-semibold">
                  {record.label || <Unrecorded reason={record.missing}>Not recorded</Unrecorded>}
                </span>
                {showClient && <span className="text-axal-muted">{row.client || <Unrecorded>Not recorded</Unrecorded>}</span>}
                <span className="text-axal-muted">{ACCESS_ACTION_LABEL[row.action] || <Unrecorded>Not recorded</Unrecorded>}</span>
                <span className="tabular-nums text-axal-faint">{when || <Unrecorded>Not recorded</Unrecorded>}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-axal-faint" data-testid="access-read-only">{READ_ONLY}</p>
    </div>
  );
}

// ───────────────────────────── the advisor's side ─────────────────────────────

export default function AdvisorAccessLog() {
  const [state, setState] = useState({ loading: true, error: '', items: [], detail: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorAccessLog();
      setState({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [], detail: res?.detail || '' });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your client list could not be read.', items: [], detail: '' });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <AdvisorAccessLogView state={state} onRetry={load} />;
}


/** The advisor's view, from props, so a guard can render each state. */
export function AdvisorAccessLogView({ state, onRetry }) {
  const items = Array.isArray(state?.items) ? state.items : [];
  return (
    <Card padding="md" id="access-log" className="mt-3 scroll-mt-24" data-testid="access-log-advisor">
      <ZoneHeading
        title="Client data access log"
        blurb="Who opened which client record, and when. Read-only. The client company sees the same log for its own records."
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-[10px] border border-emerald-300 p-3 dark:border-emerald-800" data-testid="viewer-advisor">
          <div className="text-[12.5px] font-bold">Advisor view</div>
          <div className="text-[11.5px] text-axal-muted">Every record you opened, across your clients.</div>
          <div className="mt-1.5 text-[11.5px]">
            The newest 200 opens are shown below.
          </div>
        </div>
        <div className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700" data-testid="viewer-client">
          <div className="text-[12.5px] font-bold">Client company view</div>
          <div className="text-[11.5px] text-axal-muted">Every record of theirs you opened. Same rows, their side.</div>
          <div className="mt-1.5 text-[11.5px] text-axal-faint">Each client company reads it on its data room page, under Advisors.</div>
        </div>
      </div>

      <div className="mt-3">
        {state?.loading && <div className="space-y-2" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>}
        {!state?.loading && state?.error && (
          <Unreadable what="Your access log" claim="This is not a claim that no record was opened." onRetry={onRetry} />
        )}
        {!state?.loading && !state?.error && (items.length
          ? <AccessLogTable rows={items} />
          : <p className="mt-2 text-[12px] text-axal-muted" data-testid="access-log-no-clients">No client record opens recorded yet.</p>)}
        {items.length >= ACCESS_LOG_LIMIT && <p className="mt-2 text-[11px] text-axal-faint">The newest 200 opens are shown; older rows are kept.</p>}
      </div>
      <p className="mt-3 text-[11px] text-axal-faint">{READ_ONLY}</p>
    </Card>
  );
}

// ───────────────────────────── the client company's side ─────────────────────────────

/** Mounted under the advisor grants on the founder's data room page. */
export function ClientCompanyAccessLog({ projectUid }) {
  const [state, setState] = useState({ status: 'loading', rows: [] });
  const load = useCallback(async () => {
    if (!projectUid) return;
    setState({ status: 'loading', rows: [] });
    try {
      const res = await api.advisorClientAccessLog(projectUid);
      setState({ status: 'ready', rows: Array.isArray(res?.items) ? res.items : [] });
    } catch {
      setState({ status: 'unreadable', rows: [] });
    }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);
  if (!projectUid) return null;
  return <ClientCompanyAccessLogView state={state} onRetry={load} />;
}

/** The route keeps the newest 200 (`LIMIT 200`); a full page says older rows exist. */
export const ACCESS_LOG_LIMIT = 200;

export function ClientCompanyAccessLogView({ state, onRetry }) {
  const rows = Array.isArray(state?.rows) ? state.rows : [];
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800" data-testid="access-log-client">
      <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Who opened your record</h4>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        Every record of yours an advisor opened, newest first. {READ_ONLY}
      </p>
      <div className="mt-2">
        {state?.status === 'loading' && <div className="space-y-2" aria-busy="true"><Skeleton className="h-8" /></div>}
        {state?.status === 'unreadable' && (
          <Unreadable what="The access log" claim="This is not a claim that no advisor opened your record." onRetry={onRetry} />
        )}
        {state?.status === 'ready' && rows.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="access-log-client-empty">
            No advisor has opened your record yet.
          </p>
        )}
        {state?.status === 'ready' && rows.length > 0 && <AccessLogTable rows={rows} showClient={false} />}
        {state?.status === 'ready' && rows.length >= ACCESS_LOG_LIMIT && (
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            The newest {ACCESS_LOG_LIMIT} rows are shown. Older ones are kept, and not listed here.
          </p>
        )}
      </div>
    </div>
  );
}
