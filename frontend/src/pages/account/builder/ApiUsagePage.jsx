/**
 * D1320 (#2481) — Account › Builder › API usage (`/account/builder/usage`),
 * boards APIU1, APIU2, APIU5, APIU7, APIU9–APIU11 and APIU12's key notice.
 *
 * Each block reads on its own, so one failed read never blanks the page: the
 * summary (`group=day`, which draws the tiles and Chart 1), the breakdown
 * (Chart 2), each key's month (D845 scope 3), the limits in force (D849) and
 * the account's own limit (D788). The range, the key and the breakdown live in
 * the address, so a link reopens the same view. Never `group=model`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../../ui';
import { developerUsageApi } from '../../../lib/api/developerUsage.js';
import { developerKeysApi } from '../../../lib/api/developerKeys.js';
import { aiBudgetApi } from '../../../lib/api/aiBudget.js';
import { assistantsApi } from '../../../lib/api/assistants.js';
import { accountCompaniesApi } from '../../../lib/api/accountCompanies.js';
import { downloadCsv } from '../../../lib/csvExport.js';
import {
  BREAKDOWNS, KEY_ALERTS, MAX_DAYS, WORDS, accountAlerts, accountMeter, breakdownRows, breakdownSummary, count, daySeries, daySummary,
  daysCsv, keyAlertLine, keyMeter, keyPreview, previousRange, rangeFor, reportParams, resetsOn, shortDay, tiles,
  tokensText, usageQuery, usageSearch,
} from './apiUsageModel';
import { BTN, CARD, DayChart, H3, LINK, MONO, MUTED, Meter, RangeChips, SELECT, Tile, Tokens, useCallers } from './usageParts';

const isUnknownKey = (e) => e?.status === 404 || e?.code === 'unknown_key' || e?.data?.error === 'unknown_key';

/** One read: `{ status: 'loading' | 'ready' | 'error', data }`, with Try again. */
function useRead(fn, deps) {
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

function Breakdown({ view, api, setView, navigate }) {
  const read = useRead(() => api.report(reportParams(view, view.group)), [view.range.from, view.range.to, view.key, view.group]);
  const rows = read.status === 'ready' ? breakdownRows(read.data, view.group) : [];
  const max = Math.max(1, ...rows.map((r) => r.charged ?? 0));
  const open = (r) => {
    if (r.id === 'other' || r.filterKey === null || r.filterKey === undefined) return null;
    if (view.group === 'key') return () => setView({ ...view, key: r.filterKey });
    if (view.group === 'tool') return () => navigate(`/account/builder/activity${usageSearch({ range: view.range, tool: r.filterKey })}`);
    return null;
  };
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="usage-breakdown" data-group={view.group}>
      <h3 className={H3}>Where the AI tokens went</h3>
      <div role="tablist" aria-label="Where the AI tokens went" className="flex flex-wrap gap-[7px]">
        {BREAKDOWNS.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={view.group === b.id} onClick={() => setView({ ...view, group: b.id })}
            className={`min-h-[32px] rounded-axal-pill border px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${view.group === b.id ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}
            data-testid={`usage-breakdown-${b.id}`}>{b.label}</button>
        ))}
      </div>
      {read.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading…</p> : null}
      {read.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2" role="alert" data-testid="usage-breakdown-unreadable">
          <span>{WORDS.breakdownUnreadable}</span><button type="button" className={BTN} onClick={read.retry}>Try again</button>
        </div>
      ) : null}
      {read.status === 'ready' ? (
        <>
          <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="usage-breakdown-summary">{breakdownSummary(rows, read.data)}</p>
          {rows.length ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-hidden="true">
                {rows.map((r, i) => (
                  <li key={r.id} className="flex flex-col gap-0.5 text-[12px]">
                    <span className="flex justify-between gap-2"><span className="truncate">{r.name}</span><span className={MONO}>{tokensText(r.charged) ?? WORDS.notRecorded}</span></span>
                    {r.charged === null ? <span className="block border-t border-dashed border-gray-400 dark:border-gray-500" />
                      : <span className="block h-2 rounded-sm" style={{ width: `${(r.charged / max) * 100}%`, minWidth: r.charged > 0 ? 2 : 0, backgroundColor: ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#6b6577', '#6b6577'][i] }} />}
                  </li>
                ))}
              </ul>
              <table className="w-full border-collapse text-[12.5px]" data-testid="usage-breakdown-table">
                <thead><tr className={`text-left ${MUTED}`}><th className="py-1 font-semibold">Name</th><th className="font-semibold">Requests</th><th className="font-semibold">Failed</th><th className="font-semibold">AI tokens</th><th className="font-semibold">Typical</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const go = open(r);
                    return (
                      <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid="usage-breakdown-row">
                        <td className="py-1.5">{go ? <button type="button" onClick={go} className={`text-left ${LINK}`} data-testid={`usage-breakdown-open-${r.id}`}>{r.name}</button> : r.name}
                          {r.other ? <span className={`ml-1 ${MUTED}`}>({r.other})</span> : null}</td>
                        <td className={MONO}>{count(r.calls)}</td>
                        <td className={MONO}>{count(r.failed)}</td>
                        <td><Tokens microusd={r.charged} reason="Not recorded: none of these requests was metered." /></td>
                        <td>{r.p50 === null ? <Unrecorded reason="Fewer than five requests, or folded into Other.">{WORDS.notRecorded}</Unrecorded> : <span className={MONO}>{r.p50} ms</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className={`m-0 text-[12px] ${MUTED}`}>A key or a tool opens its requests. Typical time is the median, in milliseconds.</p>
        </>
      ) : null}
    </section>
  );
}

function LimitsAndAlerts({ callers, keysApi, budgetApi, totals }) {
  const limits = useRead(() => keysApi.limits(), []);
  const account = useRead(() => budgetApi.spendLimit(), []);
  const live = (callers.keysRead || []).filter((k) => k.live !== false);
  const month = callers.month;
  const flagged = live.map((k) => keyAlertLine(k, month)).filter(Boolean);
  const meter = account.status === 'ready' ? accountMeter(account.data) : null;
  return (
    <section id="limits" className={`${CARD} flex flex-col gap-4 scroll-mt-6`} data-testid="usage-limits">
      <h3 className={H3}>Limits and alerts</h3>

      <div className="flex flex-col gap-2" data-testid="usage-limits-keys">
        <h4 className="m-0 text-[13px] font-bold">Per key</h4>
        {callers.keysError ? <Unreadable what="Your keys’ limits" claim="That is not the same as having no limit." onRetry={callers.reload} /> : null}
        {callers.keysRead && !live.length ? <p className={`m-0 text-[12.5px] ${MUTED}`}>You have no active API key. <Link to="/account/builder/keys" className={LINK}>Create an API key ›</Link></p> : null}
        {live.map((k) => {
          const m = keyMeter(k);
          return (
            <div key={k.uid} className="grid gap-2 border-t border-axal-hairline pt-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto] sm:items-center dark:border-gray-800" data-testid="usage-limit-key">
              <span className="min-w-0"><span className="font-semibold">{k.name}</span> <span className={`${MONO} text-[11.5px] ${MUTED}`}>{keyPreview(k)}</span></span>
              <Meter label="This month against its limit" value={m.value} percent={m.percent} alert={m.alert} testId={`usage-limit-meter-${k.uid}`} />
              <span className="flex flex-col gap-0.5 text-[12px]">
                <span className={MUTED}>{m.limit === 'No limit' ? 'No limit' : `Resets on ${resetsOn(month) ?? 'the 1st'}`}</span>
                <Link to={`/account/builder/keys/${encodeURIComponent(k.uid)}`} className={LINK}>Edit on the key ›</Link>
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2" data-testid="usage-limits-account">
        <h4 className="m-0 text-[13px] font-bold">Your account</h4>
        {account.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading…</p> : null}
        {account.status === 'error' ? <Unreadable what="Your account’s monthly limit" claim="That is not the same as having no limit." onRetry={account.retry} /> : null}
        {meter ? <Meter label="Monthly limit, from Usage › Limits" value={meter.value} percent={meter.percent} testId="usage-limit-account" link={<Link to="/account/usage/limits" className={`text-[12px] ${LINK}`}>Change in Limits ›</Link>} /> : null}
        <Link to="/account/usage/ai-tokens" className={`w-fit text-[12px] ${LINK}`}>See AI tokens ›</Link>
      </div>

      <div className="flex flex-col gap-1" data-testid="usage-limits-rate">
        <h4 className="m-0 text-[13px] font-bold">Rate limits</h4>
        {limits.status === 'error' ? <Unreadable what="The rate limits" claim="Calls are still limited." onRetry={limits.retry} /> : null}
        {limits.status === 'ready' ? (
          <>
            <p className="m-0 text-[12.5px]">
              {(limits.data?.keys || []).length ? <>Per key: <span className={MONO}>{[...new Set(limits.data.keys.map((k) => k.rate_per_minute))].join(', ')}</span> a minute. </> : null}
              Each assistant connection: <span className={MONO}>{limits.data?.connection?.calls_per_minute}</span> a minute. Across every key and assistant: <span className={MONO}>{limits.data?.member?.calls_per_minute}</span> a minute.
            </p>
            {totals ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="usage-limits-rate-count"><span className={MONO}>{count(totals.rate_limited)}</span> {totals.rate_limited === 1 ? 'request was' : 'requests were'} rate-limited in this range.</p> : null}
          </>
        ) : null}
      </div>

      <div id="alerts" className="flex flex-col gap-2 scroll-mt-6" data-testid="usage-alerts">
        <h4 className="m-0 text-[13px] font-bold">Alerts</h4>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[12.5px]">
          <li className="flex flex-wrap items-baseline gap-x-2" data-testid="usage-alert-account">
            <span className="font-semibold">When my account reaches 50%, 80%, 100% of its monthly limit</span>
            <span className={MUTED}>In the app and by email · {account.status === 'ready' ? accountAlerts(account.data) ?? 'Not recorded' : 'Reading…'}</span>
            <Link to="/account/usage/limits" className={LINK}>Change in Limits ›</Link>
          </li>
          {KEY_ALERTS.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-2" data-testid="usage-alert-key">
              <span className="font-semibold">{a.title}</span>
              <span className={MUTED}>{a.where}</span>
            </li>
          ))}
        </ul>
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="usage-alerts-fixed">{WORDS.keyAlertsFixed}</p>
        {flagged.map((line) => <p key={line} role="status" className="m-0 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200" data-testid="usage-key-flag">{line}</p>)}
        <p className={`m-0 text-[12px] ${MUTED}`}>{WORDS.limitVsAlert}</p>
      </div>
    </section>
  );
}

export default function ApiUsagePage({
  api = developerUsageApi, keysApi = developerKeysApi, budgetApi = aiBudgetApi, assistants = assistantsApi,
  companies = accountCompaniesApi, now,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const today = useMemo(() => now ?? new Date(), [now]);
  const view = usageQuery(location.search, today);
  const [keyRefused, setKeyRefused] = useState(false);
  const setView = (v) => navigate(`/account/builder/usage${usageSearch(v)}`, { replace: true });
  const callers = useCallers({ api, assistants, companies });

  const summary = useRead(() => api.report(reportParams(view, 'day')), [view.range.from, view.range.to, view.key]);
  const prevRange = previousRange(view.range);
  const previous = useRead(() => (view.compare ? api.report({ from: prevRange.from, to: prevRange.to, group: 'day', key: view.key || undefined }) : null), [view.compare, prevRange.from, prevRange.to, view.key]);

  // APIU12: a key that is not the member's resets to All keys, and the page says so.
  useEffect(() => {
    if (view.key && summary.status === 'error' && isUnknownKey(summary.error)) { setKeyRefused(true); setView({ ...view, key: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.status]);

  const report = summary.status === 'ready' ? summary.data : null;
  const series = report ? daySeries(report, view.range) : [];
  const prevSeries = view.compare && previous.status === 'ready' && previous.data ? daySeries(previous.data, prevRange) : null;
  const tileRows = report ? tiles(report, view.compare && previous.status === 'ready' ? previous.data : null) : null;
  const noCaller = report && !report.recorded && callers.keysRead && !callers.keysRead.length && callers.grantsRead && !callers.grantsRead.length;
  const noneInRange = report && !noCaller && report.totals.calls === 0;
  const since = report?.recorded_since ?? null;
  const notRecordedLabel = since ? `Usage recorded from ${shortDay(since)}` : 'Usage not recorded yet';
  const allTime = () => {
    const to = today.toISOString().slice(0, 10);
    const r = rangeFor({ range: 'custom', from: new Date(Date.parse(`${to}T00:00:00Z`) - (MAX_DAYS - 1) * 86_400_000).toISOString().slice(0, 10), to }, today);
    setView({ ...view, range: since && since > r.from ? { id: 'custom', from: since, to } : r });
  };
  const allKeys = [...(callers.keysRead || [])].sort((a, b) => Number(b.live !== false) - Number(a.live !== false));

  if (noCaller) {
    return (
      <section className={`${CARD} flex flex-col items-start gap-2`} data-testid="usage-no-caller">
        <h3 className={H3}>{WORDS.noCaller}</h3>
        <p className={`m-0 text-[13px] ${MUTED}`}>{WORDS.noCallerSub}</p>
        <span className="flex flex-wrap gap-3 text-[13px]"><Link to="/account/builder/keys" className={LINK}>Create an API key ›</Link><Link to="/account/builder" className={LINK}>Connect an assistant ›</Link></span>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-[14px]" data-testid="api-usage">
      {keyRefused ? (
        <div role="status" className="flex items-center gap-2 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] dark:border-violet-800 dark:bg-violet-950/40" data-testid="usage-key-refused">
          <span className="flex-1">{WORDS.keyNotYours}</span>
          <button type="button" className={`min-h-[44px] px-2 text-[12px] ${LINK}`} onClick={() => setKeyRefused(false)}>Dismiss</button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" data-testid="usage-toolbar">
        <RangeChips range={view.range} now={today} onChange={(range) => setView({ ...view, range })} />
        <label className="flex items-center gap-1 text-[12.5px]">Key:
          <select className={SELECT} value={view.key ?? ''} onChange={(e) => setView({ ...view, key: e.target.value || null })} data-testid="usage-key-filter">
            <option value="">All keys</option>
            {allKeys.filter((k) => k.live !== false).map((k) => <option key={k.uid} value={k.uid}>{k.name}</option>)}
            {allKeys.some((k) => k.live === false) ? <optgroup label="Revoked">{allKeys.filter((k) => k.live === false).map((k) => <option key={k.uid} value={k.uid}>{k.name}</option>)}</optgroup> : null}
          </select>
        </label>
        <label className="flex min-h-[36px] items-center gap-1.5 text-[12.5px] max-sm:min-h-[44px]">
          <input type="checkbox" checked={view.compare} onChange={(e) => setView({ ...view, compare: e.target.checked })} data-testid="usage-compare" />Compare with previous period
        </label>
        <button type="button" className={BTN} disabled={!report} onClick={() => { const f = daysCsv(series); downloadCsv(`api-usage-${view.range.from}-to-${view.range.to}.csv`, f.header, f.rows); }} data-testid="usage-csv">Download CSV</button>
      </div>

      {summary.status === 'error' && !isUnknownKey(summary.error) ? (
        <div className={`${CARD} flex flex-wrap items-center gap-2`} role="alert" data-testid="usage-summary-unreadable">
          <span>{WORDS.summaryUnreadable}</span><button type="button" className={BTN} onClick={summary.retry}>Try again</button>
        </div>
      ) : null}

      {summary.status !== 'error' ? (
        <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4" data-testid="usage-tiles">
          {(tileRows ?? [{ id: 'requests', label: 'Requests' }, { id: 'ok', label: 'OK' }, { id: 'failed', label: 'Failed' }, { id: 'charged', label: 'AI tokens charged' }])
            .map((t) => <Tile key={t.id} tile={t} loading={!tileRows} onOpen={() => navigate(`/account/builder/activity${usageSearch({ range: view.range, outcome: 'failed', caller: view.key ? `key:${view.key}` : null })}`)} />)}
        </div>
      ) : null}

      {summary.status !== 'error' ? (
        <section className={`${CARD} flex flex-col gap-2`} data-testid="usage-chart">
          <h3 className={H3}>Requests and AI tokens by day</h3>
          {report ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="usage-chart-summary">{daySummary(report, view.range)}</p> : <p className={`m-0 ${MUTED}`}>Reading…</p>}
          {noneInRange ? (
            <div className="flex flex-col items-start gap-1" data-testid="usage-none-in-range">
              <p className="m-0 font-semibold">No requests between {shortDay(view.range.from)} and {shortDay(view.range.to)}.</p>
              <p className={`m-0 text-[12.5px] ${MUTED}`}>Your keys and assistants are connected, but none called StudioOS in this range.</p>
              <button type="button" className={`text-[12.5px] ${LINK}`} onClick={allTime} data-testid="usage-all-time">Show all time</button>
            </div>
          ) : null}
          {report && !noneInRange ? <DayChart series={series} previous={prevSeries} notRecordedLabel={notRecordedLabel} /> : null}
        </section>
      ) : null}

      <Breakdown view={view} api={api} setView={setView} navigate={navigate} />
      <LimitsAndAlerts callers={callers} keysApi={keysApi} budgetApi={budgetApi} totals={report?.totals ?? null} />

      <p className={`m-0 text-[12px] ${MUTED}`} data-testid="usage-footer">{WORDS.footer} <Link to="/account/usage/cost" className={LINK}>{WORDS.byModel}</Link></p>
    </div>
  );
}


