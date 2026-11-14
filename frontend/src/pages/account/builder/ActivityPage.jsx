/**
 * D1320 (#2481) — Account › Builder › Activity (`/account/builder/activity`),
 * the request history: boards APIU3 (the log and its filters), APIU4 (the
 * request drawer at `/activity/[uid]`), APIU6 (failures, with the band of
 * outcomes and top reasons) and APIU12's "not on your account".
 *
 * The log reads `GET /api/developer/usage/events` (newest first, 100 a page,
 * cursor paging); "Calls by day" reads the day report; the drawer reads one
 * request by its execution id. Each read stands alone: a failed log leaves the
 * chart, and a failed chart leaves the log. The filters live in the address.
 * Connection events (an assistant approved or revoked) are #2479's to add.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { Unreadable, Unrecorded } from '../../../ui';
import { developerUsageApi } from '../../../lib/api/developerUsage.js';
import { assistantsApi } from '../../../lib/api/assistants.js';
import { accountCompaniesApi } from '../../../lib/api/accountCompanies.js';
import { downloadCsv } from '../../../lib/csvExport.js';
import {
  OUTCOME_FILTERS, WORDS, callerOf, callerOptions, categoryLine, count, daySeries, eventParams, eventsCsv, failureBand,
  requestActions, requestTokens, stamp, surfaceWord, topReasons, usageQuery, usageSearch,
} from './apiUsageModel';
import { BTN, CARD, DayChart, H3, LINK, MONO, MUTED, OutcomePill, RangeChips, SELECT, SurfacePill, Tokens, useCallers } from './usageParts';

const EXECUTION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITY = '/account/builder/activity';

function useLoad(fn, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    Promise.resolve().then(fn).then((data) => { if (live) setState({ status: 'ready', data, error: null }); },
      (error) => { if (live) setState({ status: 'error', data: null, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

/** APIU6's band: failures by outcome, and the top three reasons. */
function FailureBand({ view, api }) {
  const totals = useLoad(() => api.report({ from: view.range.from, to: view.range.to, group: 'day', key: view.caller?.startsWith('key:') ? view.caller.slice(4) : undefined }), [view.range.from, view.range.to, view.caller]);
  const reasons = useLoad(() => api.report({ from: view.range.from, to: view.range.to, group: 'category', key: view.caller?.startsWith('key:') ? view.caller.slice(4) : undefined }), [view.range.from, view.range.to, view.caller]);
  if (totals.status === 'error') return <Unreadable what="The failures by outcome" claim="That is not the same as none." onRetry={totals.retry} />;
  if (totals.status !== 'ready') return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  const band = failureBand(totals.data.totals);
  const all = totals.data.totals.errors;
  const fill = { refused: 'bg-[#f59e0b]', error: 'bg-red-600', rate_limited: 'bg-[#0ea5e9]', insufficient_tokens: 'bg-gray-400 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(0,0,0,.25)_3px_5px)]' };
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="activity-failures">
      <h3 className={H3}><span className={MONO}>{count(all)}</span> {all === 1 ? 'failure' : 'failures'} in this range</h3>
      {all > 0 ? (
        <div className="flex h-3 w-full overflow-hidden rounded-axal-pill" aria-hidden="true">
          {band.filter((b) => b.n > 0).map((b) => <span key={b.id} className={fill[b.id]} style={{ width: `${(b.n / all) * 100}%` }} />)}
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px]">{band.map((b) => <li key={b.id} data-testid="activity-failure-outcome">{b.label} <span className={MONO}>{count(b.n)}</span></li>)}</ul>
      <h4 className="m-0 text-[13px] font-bold">Top reasons</h4>
      {reasons.status === 'error' ? <Unreadable what="The reasons" claim="That is not the same as none." onRetry={reasons.retry} /> : null}
      {reasons.status === 'ready' ? (
        topReasons(reasons.data).length
          ? <ol className="m-0 flex flex-col gap-0.5 pl-5 text-[12.5px]">{topReasons(reasons.data).map((r) => <li key={r.id} data-testid="activity-reason">{r.label} <span className={MONO}>{count(r.n)}</span></li>)}</ol>
          : <p className={`m-0 text-[12.5px] ${MUTED}`}>No request failed in this range.</p>
      ) : null}
    </section>
  );
}

/** One request (APIU4), or "not on your account" (APIU12) for an id that is not the member's. */
export function RequestDrawer({ id, api, callers, onClose }) {
  const read = useLoad(() => api.event(id), [id]);
  const [copied, setCopied] = useState(false);
  const e = read.status === 'ready' ? read.data?.event : null;
  const notYours = read.status === 'error' && (read.error?.status === 404 || read.error?.code === 'unknown_request');
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } };
  const who = e ? callerOf(e, callers) : null;
  const company = e?.company_id == null ? null : callers.companyName(e.company_id);
  const Row = ({ k, children }) => <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 py-1 text-[12.5px]"><span className={MUTED}>{k}</span><span className="min-w-0 break-words">{children}</span></div>;
  return (
    <Lightbox label="Request" title={e ? <span className="flex flex-wrap items-center gap-2"><span className="font-mono">{e.operation}</span><OutcomePill outcome={e.outcome} /></span> : 'Request'}
      eyebrow="Builder › Activity" onClose={onClose} width={560} size="tall" pageBelow="lg" testId="activity-drawer">
      <div className="flex flex-col gap-4 text-[13px]">
        <button type="button" onClick={onClose} className={`w-fit text-[12.5px] ${LINK}`} data-testid="activity-drawer-back">‹ Activity</button>
        {read.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading…</p> : null}
        {notYours ? (
          <div className="flex flex-col gap-1" data-testid="activity-drawer-not-yours">
            <p className="m-0 font-semibold">{WORDS.notYours}</p>
            <p className={`m-0 ${MUTED}`}>{WORDS.notYoursSub}</p>
            <button type="button" onClick={onClose} className={`w-fit ${LINK}`}>Back to Activity ›</button>
          </div>
        ) : null}
        {read.status === 'error' && !notYours ? <Unreadable what="This request" claim="It may still be on your account." onRetry={read.retry} /> : null}
        {e ? (
          <>
            <section data-testid="activity-drawer-who">
              <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Who</h4>
              <Row k="Caller">{who.name}{who.sub ? <span className={`ml-1 ${MONO} text-[11.5px] ${MUTED}`}>{who.sub}</span> : null}</Row>
              <Row k="Surface"><SurfacePill surface={e.surface} /></Row>
              <Row k="Company">{e.company_id == null ? <Unrecorded reason="Not recorded: this tool does not act for a company.">None</Unrecorded> : company ?? <span className={MONO}>Company {e.company_id}</span>}</Row>
              <Row k="Provider">{e.provider ?? <Unrecorded reason="Not recorded: no provider was named for this request.">{WORDS.notRecorded}</Unrecorded>}</Row>
              <Row k="Connector">{e.connector ?? <Unrecorded reason="This request used no connector.">No connector</Unrecorded>}</Row>
            </section>
            <section data-testid="activity-drawer-when">
              <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">When</h4>
              <Row k="Started"><span className={MONO}>{stamp(e.created_at)} UTC</span></Row>
              <Row k="Took"><span className={MONO}>{count(e.duration_ms)} ms</span></Row>
            </section>
            <section data-testid="activity-drawer-tokens">
              <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">AI tokens</h4>
              {requestTokens(e).map((t) => <Row key={t.label} k={t.label}>{t.value === null ? <Unrecorded reason={t.reason}>{WORDS.notRecorded}</Unrecorded> : <span className={MONO}>{t.value}</span>}</Row>)}
              <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.tokensOnly} The model is not shown here.</p>
            </section>
            {e.outcome !== 'ok' ? (
              <section data-testid="activity-drawer-why">
                <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Why it failed</h4>
                <p className="m-0">{categoryLine(e.error_category) ?? 'It did not complete.'}</p>
                <span className="mt-1 flex flex-wrap gap-3">{requestActions(e).map((a) => <Link key={a.label} to={a.to} className={LINK}>{a.label}</Link>)}</span>
              </section>
            ) : null}
            <section data-testid="activity-drawer-ids">
              <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">IDs</h4>
              <Row k="Execution"><span className="flex flex-wrap items-center gap-2"><span className={`${MONO} break-all text-[12px]`}>{e.execution_id}</span>
                <button type="button" className={BTN} onClick={() => copy(e.execution_id)} data-testid="activity-drawer-copy">{copied ? 'Copied' : 'Copy'}</button></span></Row>
            </section>
            <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.noArgs}</p>
          </>
        ) : null}
      </div>
    </Lightbox>
  );
}

function Filters({ view, setView, callers, tools, now }) {
  const options = callerOptions(callers);
  const groups = [...new Set(options.map((o) => o.group))];
  const set = (k) => (ev) => setView({ ...view, [k]: ev.target.value || null });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="activity-filters">
      <RangeChips range={view.range} now={now} onChange={(range) => setView({ ...view, range })} />
      <select className={SELECT} aria-label="Caller" value={view.caller ?? ''} onChange={set('caller')} data-testid="activity-filter-caller">
        <option value="">Caller: all</option>
        {groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
      </select>
      <select className={SELECT} aria-label="Surface" value={view.surface ?? ''} onChange={set('surface')} data-testid="activity-filter-surface">
        <option value="">Surface: all</option><option value="mcp">MCP</option><option value="api">API</option>
      </select>
      <select className={SELECT} aria-label="Outcome" value={view.outcome ?? ''} onChange={set('outcome')} data-testid="activity-filter-outcome">
        <option value="">Outcome: all</option>{OUTCOME_FILTERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <select className={SELECT} aria-label="Tool" value={view.tool ?? ''} onChange={set('tool')} data-testid="activity-filter-tool">
        <option value="">Tool: all</option>{[...new Set([...(tools || []), ...(view.tool ? [view.tool] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select className={SELECT} aria-label="Company" value={view.company ?? ''} onChange={set('company')} data-testid="activity-filter-company">
        <option value="">Company: all</option>{(callers.projects || []).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
      </select>
    </div>
  );
}

export default function ActivityPage({
  drawerId = null, api = developerUsageApi, assistants = assistantsApi, companies = accountCompaniesApi, now,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const today = useMemo(() => now ?? new Date(), [now]);
  const view = usageQuery(location.search, today);
  const search = usageSearch(view);
  const setView = (v) => navigate(`${ACTIVITY}${usageSearch(v)}`, { replace: true });
  const callers = useCallers({ api, assistants, companies });
  const [cursors, setCursors] = useState([null]);
  const [phoneFilters, setPhoneFilters] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState('');
  const page = cursors[cursors.length - 1];
  const filterKey = JSON.stringify(eventParams(view));
  useEffect(() => { setCursors([null]); }, [filterKey]);

  const log = useLoad(() => api.events(eventParams(view, page)), [filterKey, page]);
  const chart = useLoad(() => api.report({ from: view.range.from, to: view.range.to, group: 'day', key: view.caller?.startsWith('key:') ? view.caller.slice(4) : undefined }), [view.range.from, view.range.to, view.caller]);
  const tools = useLoad(() => api.report({ from: view.range.from, to: view.range.to, group: 'tool' }), [view.range.from, view.range.to]);
  const events = log.status === 'ready' ? log.data?.events || [] : [];
  const open = (id) => navigate(`${ACTIVITY}/${encodeURIComponent(id)}${search}`);
  const close = () => navigate(`${ACTIVITY}${search}`);
  const activeFilters = ['caller', 'surface', 'outcome', 'tool', 'company'].filter((k) => view[k]).length;

  const runSearch = (ev) => {
    ev.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (EXECUTION.test(q)) { open(q); return; }
    const key = callers.keys.find((k) => k.name.toLowerCase() === q.toLowerCase() || `axk_${k.key_id}`.toLowerCase() === q.toLowerCase().replace(/_?•+$/, ''));
    if (key) { setView({ ...view, caller: `key:${key.uid}` }); return; }
    setView({ ...view, tool: q });
  };

  // The whole filtered history, page by page, saved to the member's device (#2419). At most 100 pages.
  const saveCsv = async () => {
    setSaving('Reading every page…');
    try {
      const all = [];
      let cursor = null;
      for (let i = 0; i < 100; i += 1) {
        const r = await api.events(eventParams(view, cursor));
        all.push(...(r?.events || []));
        cursor = r?.next_cursor || null;
        if (!cursor) break;
      }
      const f = eventsCsv(all, callers);
      downloadCsv(`api-requests-${view.range.from}-to-${view.range.to}.csv`, f.header, f.rows);
      setSaving(cursor ? `Saved the newest ${count(all.length)} requests. Narrow the range for the rest.` : '');
    } catch { setSaving('The requests could not be read, so nothing was saved. Try again.'); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-[14px]" data-testid="activity" data-failures={view.outcome === 'failed' ? '1' : '0'}>
      <form onSubmit={runSearch} className="flex flex-wrap items-center gap-2" role="search">
        <input type="search" value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search tool, key or request ID" aria-label="Search tool, key or request ID"
          className={`${SELECT} min-w-0 flex-1 sm:max-w-sm`} data-testid="activity-search" />
        <button type="submit" className={BTN}>Search</button>
        <button type="button" className={`${BTN} sm:hidden`} onClick={() => setPhoneFilters(!phoneFilters)} aria-expanded={phoneFilters} data-testid="activity-filters-toggle">Filters · {activeFilters}</button>
        <button type="button" className={BTN} onClick={saveCsv} disabled={!!saving && saving.startsWith('Reading')} data-testid="activity-csv">Download CSV</button>
      </form>
      {saving ? <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid="activity-csv-status">{saving}</p> : null}
      <div className={`${phoneFilters ? '' : 'max-sm:hidden'}`}>
        <Filters view={view} setView={setView} callers={callers} tools={tools.status === 'ready' ? (tools.data?.groups || []).map((g) => g.key).filter(Boolean) : []} now={today} />
      </div>
      {view.outcome === 'failed' ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="rounded-axal-pill border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 font-semibold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">Outcome: failed</span>
          <button type="button" className={LINK} onClick={() => setView({ ...view, outcome: null })} aria-label="Clear the failed filter" data-testid="activity-clear-failed">✕</button>
        </div>
      ) : null}

      {view.outcome === 'failed' ? <FailureBand view={view} api={api} /> : (
        <section className={`${CARD} flex flex-col gap-2`} data-testid="activity-chart">
          <h3 className={H3}>Calls by day</h3>
          {chart.status === 'error' ? <Unreadable what="Calls by day" claim="The log below was read separately." onRetry={chart.retry} /> : null}
          {chart.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading…</p> : null}
          {chart.status === 'ready' ? <DayChart series={daySeries(chart.data, view.range)} testId="activity-day-chart" /> : null}
        </section>
      )}

      <section className={`${CARD} flex min-w-0 flex-col gap-2`} data-testid="activity-log">
        {log.status === 'loading' ? (
          <div className="flex flex-col gap-2" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} className="block h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}</div>
        ) : null}
        {log.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-2" role="alert" data-testid="activity-log-unreadable">
            <span>{WORDS.logUnreadable} {view.outcome === 'failed' ? 'The band above was read separately and stays.' : 'The chart above was read separately and stays.'}</span>
            <button type="button" className={BTN} onClick={log.retry}>Try again</button>
          </div>
        ) : null}
        {log.status === 'ready' && !events.length ? <p className={`m-0 ${MUTED}`} data-testid="activity-empty">No requests match these filters in this range.</p> : null}
        {events.length ? (
          <>
            <table className="hidden w-full border-collapse text-[12.5px] lg:table" data-testid="activity-table">
              <thead><tr className={`text-left ${MUTED}`}>{['Time', 'Caller', 'Surface', 'Tool', 'Company', 'Outcome', 'Took', 'AI tokens'].map((h) => <th key={h} className="py-1 pr-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {events.map((e) => {
                  const who = callerOf(e, callers);
                  const why = categoryLine(e.error_category);
                  return (
                    <tr key={e.execution_id} className="cursor-pointer border-t border-axal-hairline align-top hover:bg-axal-ground dark:border-gray-800 dark:hover:bg-gray-800/60" onClick={() => open(e.execution_id)} data-testid="activity-row">
                      <td className={`py-1.5 pr-2 ${MONO}`}>{stamp(e.created_at)}</td>
                      <td className="pr-2"><span className="block">{who.name}</span>{who.sub ? <span className={`${MONO} text-[11px] ${MUTED}`}>{who.sub}</span> : null}</td>
                      <td className="pr-2"><SurfacePill surface={e.surface} /></td>
                      <td className="pr-2"><button type="button" className={`font-mono text-left ${LINK}`} onClick={(ev) => { ev.stopPropagation(); open(e.execution_id); }} data-testid={`activity-open-${e.execution_id}`}>{e.operation}</button>
                        {why ? <span className={`block text-[11.5px] ${MUTED}`} data-testid="activity-row-why">{why}</span> : null}</td>
                      <td className="pr-2">{e.company_id == null ? <span className={MUTED}>None</span> : callers.companyName(e.company_id) ?? <span className={MONO}>Company {e.company_id}</span>}</td>
                      <td className="pr-2"><OutcomePill outcome={e.outcome} /></td>
                      <td className={`pr-2 ${MONO}`}>{count(e.duration_ms)} ms</td>
                      <td><Tokens microusd={e.charged_microusd} reason={e.reservation_uid ? 'Not recorded: the hold has not settled yet.' : 'Not recorded: this request was not metered.'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="activity-cards">
              {events.map((e) => (
                <li key={e.execution_id}>
                  <button type="button" onClick={() => open(e.execution_id)} className="flex min-h-[44px] w-full flex-col gap-1 rounded-axal-md border border-axal-hairline p-3 text-left dark:border-gray-700" data-testid="activity-card">
                    <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono font-semibold">{e.operation}</span><OutcomePill outcome={e.outcome} /></span>
                    <span className={`text-[12px] ${MUTED}`}>{callerOf(e, callers).name} · {surfaceWord(e.surface)}</span>
                    <span className="flex justify-between gap-2 text-[12px]"><Tokens microusd={e.charged_microusd} /><span className={MONO}>{stamp(e.created_at)}</span></span>
                    {categoryLine(e.error_category) ? <span className={`text-[11.5px] ${MUTED}`}>{categoryLine(e.error_category)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {log.status === 'ready' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className={MUTED}>Newest first · 100 a page</span>
            <span className="flex gap-2">
              <button type="button" className={BTN} disabled={cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))} data-testid="activity-newer">‹ Newer</button>
              <button type="button" className={BTN} disabled={!log.data?.next_cursor} onClick={() => setCursors([...cursors, log.data.next_cursor])} data-testid="activity-older">Older ›</button>
            </span>
          </div>
        ) : null}
      </section>

      <p className={`m-0 text-[12px] ${MUTED}`} data-testid="activity-connection-events">{WORDS.connectionEvents}</p>
      <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.activityFooter}</p>

      {drawerId ? <RequestDrawer id={drawerId} api={api} callers={callers} onClose={close} /> : null}
    </div>
  );
}
