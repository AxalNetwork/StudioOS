import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportingApi } from '../../lib/api/reporting';
import { Unreadable } from '../../ui';
import { companyHref } from '../cycles/reportingModel';
import {
  HOLDING_NOTES, KIND_WORDS, ROUTE_WORDS, SORTS, STATE_FILTERS, STRIP_LEGEND, companyRows, filterRows, reportTiles,
} from './portfolioReportsModel';

/**
 * D1061 (#2931) — RPT9, Portfolio › Reports: what each company the investor
 * signed into owes them and what it sent. Four tiles, then one row per
 * company with the holding, the next due, the last received, a state pill and
 * the last eight periods, with search, filters and a sort. Read from
 * `GET /api/reporting/portfolio` (D1058); the holding's amount is the
 * investor's own position. Nothing ranks a company, and lateness is amber,
 * never red.
 */

export const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
export const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
export const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const SELECT = 'min-h-[36px] rounded-lg border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** A state pill: green for sent, amber for late or missing, neutral otherwise. Never red. */
export const PILL_TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  late: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  neutral: 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
};
export function Pill({ pill, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL_TONE[pill.tone] || PILL_TONE.neutral}`} data-testid={testId}>{pill.text}</span>;
}

export default function PortfolioReports() {
  const [state, setState] = useState({ status: 'loading', companies: [], positions: [], positionsRead: true });
  const [filters, setFilters] = useState({ q: '', state: '', kind: '', route: '', sort: 'due' });
  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.allSettled([reportingApi.portfolio(), api.positionsList()]).then(([p, pos]) => {
      if (p.status === 'rejected') { setState({ status: 'unreadable', companies: [], positions: [], positionsRead: true }); return; }
      const positions = pos.status === 'fulfilled' ? (Array.isArray(pos.value) ? pos.value : pos.value?.items || pos.value?.positions || []) : [];
      setState({ status: 'ready', companies: Array.isArray(p.value?.companies) ? p.value.companies : [], positions, positionsRead: pos.status === 'fulfilled' });
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => companyRows(state.companies, state.positions), [state.companies, state.positions]);
  const tiles = useMemo(() => reportTiles(state.companies), [state.companies]);
  const shown = filterRows(rows, filters);
  const kinds = [...new Set(rows.flatMap((r) => r.kinds))];
  const routes = [...new Set(rows.map((r) => r.route).filter((r) => r && r !== 'mixed'))];
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  if (state.status === 'loading') return <section className={CARD} aria-busy="true" data-testid="portfolio-reports-loading"><h2 className={H2}>Companies you signed into</h2><div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  if (state.status === 'unreadable') return <section className={CARD} data-testid="portfolio-reports"><Unreadable what="What your companies owe you" claim="This is not a claim that nothing is due or late." onRetry={load} /></section>;
  if (!rows.length) {
    return (
      <section className={CARD} data-testid="portfolio-reports">
        <h2 className={H2}>Companies you signed into</h2>
        <p className={MUTED} data-testid="portfolio-reports-none">No company owes you reports under a document you signed yet. A duty is created when a closing you are a line of is marked Closed.</p>
        <p className={MUTED} data-testid="portfolio-reports-lp">If you are an LP of an Axal VC fund, company reports go to the fund, and you receive the fund’s quarterly report in <Link className={LINK} to="/funds/reporting">Axal VC Fund</Link>.</p>
      </section>
    );
  }
  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="portfolio-reports">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="portfolio-reports-tiles">
        {tiles.map((t) => (
          <div key={t.key} className={CARD} data-testid={`portfolio-tile-${t.key}`}>
            <span className="text-[11px] font-bold uppercase text-axal-muted dark:text-gray-400">{t.label}</span>
            <span className="text-[20px] font-extrabold tabular-nums text-axal-ink dark:text-gray-100">{t.value}</span>
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{t.sub}</span>
          </div>
        ))}
      </div>
      <section className={CARD}>
        <h2 className={H2}>Companies you signed into</h2>
        <div className="flex flex-wrap items-center gap-2" data-testid="portfolio-reports-filters">
          <input aria-label="Search companies" placeholder="Search companies" value={filters.q} onChange={set('q')} className={SELECT} data-testid="portfolio-reports-search" />
          <select aria-label="State" value={filters.state} onChange={set('state')} className={SELECT} data-testid="portfolio-reports-state">{STATE_FILTERS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          <select aria-label="Kind" value={filters.kind} onChange={set('kind')} className={SELECT} data-testid="portfolio-reports-kind"><option value="">Every kind</option>{kinds.map((k) => <option key={k} value={k}>{KIND_WORDS[k] || k}</option>)}</select>
          <select aria-label="Holding" value={filters.route} onChange={set('route')} className={SELECT} data-testid="portfolio-reports-route"><option value="">Every holding</option>{routes.map((r) => <option key={r} value={r}>{ROUTE_WORDS[r]}</option>)}</select>
          <select aria-label="Sort" value={filters.sort} onChange={set('sort')} className={SELECT} data-testid="portfolio-reports-sort">{SORTS.map(([v, t]) => <option key={v} value={v}>Sort: {t}</option>)}</select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]" data-testid="portfolio-reports-table">
            <thead><tr className="text-[11px] uppercase text-axal-muted dark:text-gray-400"><th className="py-1">Company</th><th>Your holding</th><th>Next due</th><th>Last received</th><th>State</th><th>Last 8 periods</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.uid} className="border-t border-axal-ground align-top dark:border-gray-800" data-testid={`portfolio-report-row-${r.uid}`}>
                  <td className="py-2">
                    {companyHref(r.uid) ? <Link to={companyHref(r.uid, 'reports')} className={LINK}>{r.name}</Link> : <span className="font-semibold">{r.name}</span>}
                    {r.route === 'axal_fund' ? <div className="text-[11.5px] text-axal-muted dark:text-gray-400">{HOLDING_NOTES.axal_fund.split('.')[0]}</div> : null}
                  </td>
                  <td>{r.holding}</td>
                  <td className="font-mono">{r.next ? <><div>{r.next.due}</div><div className="font-sans text-[11.5px] text-axal-muted dark:text-gray-400">{r.next.label} · {r.next.kind}</div></> : <span className="text-axal-muted dark:text-gray-400">Nothing due</span>}</td>
                  <td>{r.last ? <><div>{r.last.label} · {r.last.kind}</div><div className="text-[11.5px] text-axal-muted dark:text-gray-400">Received {r.last.on}</div></> : <span className="text-axal-muted dark:text-gray-400">Nothing received yet</span>}</td>
                  <td><Pill pill={r.state} testId={`portfolio-report-state-${r.uid}`} />{r.state.expected ? <div className="text-[11.5px] text-axal-muted dark:text-gray-400">Expected {r.state.expected}</div> : null}</td>
                  <td className="font-mono text-[12px] tracking-[.06em]" title="Oldest to newest" data-testid={`portfolio-report-strip-${r.uid}`}>{r.strip.map((s) => <span key={s.uid} title={s.title} className="mr-1">{s.mark}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length ? <p className={MUTED} data-testid="portfolio-reports-filtered">No company matches these filters.</p> : null}
        <p className={MUTED}>{shown.length} of {rows.length} · Only companies you signed into. Figures come from the companies’ reports, not your bank. {STRIP_LEGEND}</p>
        {!state.positionsRead ? <p className={MUTED} data-testid="portfolio-reports-positions-unread">Your positions could not be read, so each holding shows its route only.</p> : null}
      </section>
    </section>
  );
}
