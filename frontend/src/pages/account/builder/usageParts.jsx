/**
 * D1320 (#2481) — the pieces API usage and Activity share: the range chips,
 * a tile, the requests-by-day chart (Chart 1, and Activity's "Calls by day"),
 * an outcome pill, a meter, and the readers of who called (keys, assistants,
 * companies). Chart colours follow the canvas's fixed order; every mark keeps a
 * word beside it, and "Not recorded" is a dashed hairline, never a zero bar.
 */
import { useCallback, useEffect, useState } from 'react';
import { Unrecorded } from '../../../ui';
import { developerUsageApi } from '../../../lib/api/developerUsage.js';
import { assistantsApi } from '../../../lib/api/assistants.js';
import { accountCompaniesApi } from '../../../lib/api/accountCompanies.js';
import { RANGES, MAX_DAYS, count, outcomeWord, rangeFor, shortDay, tokensText, WORDS } from './apiUsageModel';

export const CARD = 'rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
export const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const MONO = 'font-mono tabular-nums';
export const LINK = 'font-semibold text-axal-violet hover:underline dark:text-violet-300';
export const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-axal-md border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
export const SELECT = 'min-h-[36px] rounded-axal-sm border border-axal-hairline bg-white px-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';

/** The chart palette, in the canvas's fixed order (light, dark). */
export const SERIES = Object.freeze({
  ok: 'bg-[#7c3aed] dark:bg-[#a78bfa]',
  failed: 'bg-[#f59e0b]',
  tokens: '#0ea5e9',
});

const PILL = {
  ok: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  refused: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
  rate_limited: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200',
  insufficient_tokens: 'border-gray-300 bg-gray-50 text-gray-700 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(107,101,119,.12)_4px_6px)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
};

/** An outcome, always as a word (never colour alone). */
export function OutcomePill({ outcome }) {
  return <span className={`inline-flex w-fit items-center rounded-axal-pill border px-2 py-0.5 text-[11px] font-bold ${PILL[outcome] ?? PILL.error}`} data-outcome={outcome}>{outcomeWord(outcome)}</span>;
}

export function SurfacePill({ surface }) {
  return <span className={`inline-flex w-fit rounded-axal-pill border border-axal-hairline px-1.5 py-0.5 font-mono text-[10.5px] font-bold dark:border-gray-700 ${MUTED}`}>{surface === 'api' ? 'API' : 'MCP'}</span>;
}

/** AI tokens: a figure, "Free" for a measured zero, or "Not recorded" with its reason. */
export function Tokens({ microusd, reason = 'Not recorded: this request was not metered.' }) {
  const t = tokensText(microusd);
  return t === null ? <Unrecorded reason={reason}>{WORDS.notRecorded}</Unrecorded> : <span className={MONO}>{t}</span>;
}

/** The range chips, and a from–to picker for Custom. */
export function RangeChips({ range, onChange, now = new Date() }) {
  const [custom, setCustom] = useState(range.id === 'custom' ? { from: range.from, to: range.to } : null);
  const pick = (id) => {
    if (id === 'custom') { setCustom({ from: range.from, to: range.to }); return; }
    setCustom(null);
    onChange(rangeFor({ range: id }, now));
  };
  const apply = () => {
    const r = rangeFor({ range: 'custom', ...custom }, now);
    if (r.id === 'custom') onChange(r);
  };
  const bad = custom && rangeFor({ range: 'custom', ...custom }, now).id !== 'custom';
  return (
    <div className="flex flex-wrap items-center gap-[7px]" data-testid="usage-range">
      {RANGES.map((r) => (
        <button key={r.id} type="button" onClick={() => pick(r.id)} aria-pressed={(custom ? 'custom' : range.id) === r.id}
          className={`min-h-[32px] rounded-axal-pill border px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${(custom ? 'custom' : range.id) === r.id ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}
          data-testid={`usage-range-${r.id}`}>{r.label}</button>
      ))}
      {custom ? (
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <label className="flex items-center gap-1">From <input type="date" className={SELECT} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} data-testid="usage-range-from" /></label>
          <label className="flex items-center gap-1">to <input type="date" className={SELECT} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} data-testid="usage-range-to" /></label>
          <button type="button" className={BTN} onClick={apply} disabled={bad} data-testid="usage-range-apply">Show</button>
          {bad ? <span className="text-[12px] text-red-700 dark:text-red-300" role="alert">Choose a start before the end, at most {MAX_DAYS} days.</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** A tile: its figure, or grey bars while reading (never 0), or "Not recorded" with why. */
export function Tile({ tile, loading, onOpen }) {
  const body = loading ? <span aria-hidden="true" className="block h-6 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
    : tile.value === null ? <Unrecorded reason={tile.reason}>{WORDS.notRecorded}</Unrecorded>
      : <span className={`${MONO} text-[22px] font-extrabold text-axal-ink dark:text-gray-100`}>{tile.value}</span>;
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1`} data-testid={`usage-tile-${tile.id}`}>
      <span className={`font-mono text-[10.5px] uppercase tracking-[.07em] ${MUTED}`}>{tile.label}</span>
      {body}
      {!loading && tile.value === null && tile.reason ? <span className={`text-[12px] ${MUTED}`}>{tile.reason}</span> : null}
      {!loading && tile.sub ? <span className={`${MONO} text-[12px] ${MUTED}`}>{tile.sub}</span> : null}
      {!loading && tile.prev ? <span className={`${MONO} text-[12px] ${MUTED}`} data-testid={`usage-tile-prev-${tile.id}`}>Previous · {tile.prev}</span> : null}
      {!loading && tile.link && onOpen ? <button type="button" onClick={onOpen} className={`w-fit text-[12px] ${LINK}`} data-testid="usage-tile-failed-open">See them in Activity ›</button> : null}
    </div>
  );
}

/**
 * Requests by day: bars stacked OK and Failed, and AI tokens charged as a
 * line on its own axis. A day before usage was recorded has no bar and a
 * dashed hairline; a day's unmetered charge breaks the line. `previous` draws
 * the previous period's requests as a dotted line. Every day is a button, so
 * its figures are reachable by keyboard; `asTable` shows the same days as rows.
 */
export function DayChart({ series, previous = null, notRecordedLabel = 'Usage not recorded yet', testId = 'usage-day-chart' }) {
  const [active, setActive] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...series.map((d) => d.calls ?? 0), ...(previous || []).map((d) => d.calls ?? 0));
  const maxTok = Math.max(1, ...series.map((d) => d.charged ?? 0));
  const n = series.length;
  const x = (i) => ((i + 0.5) / n) * 100;
  const line = (rows, f, top) => rows.map((d, i) => (d[f] === null || d[f] === undefined ? null : `${x(i)},${100 - (d[f] / top) * 100}`));
  const segments = (pts) => pts.reduce((acc, p) => { if (p === null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((s) => s.length > 1);
  const a = series.find((d) => d.day === active);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <div className="flex justify-end">
        <button type="button" className={`text-[12px] ${LINK}`} onClick={() => setAsTable(!asTable)} data-testid={`${testId}-toggle`}>{asTable ? 'View as chart' : 'View as table'}</button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse text-[12.5px]" data-testid={`${testId}-table`}>
            <thead><tr className={`text-left ${MUTED}`}><th className="py-1 font-semibold">Day</th><th className="font-semibold">Requests</th><th className="font-semibold">OK</th><th className="font-semibold">Failed</th><th className="font-semibold">AI tokens</th></tr></thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.day} className="border-t border-axal-hairline dark:border-gray-800">
                  <td className={`py-1 ${MONO}`}>{shortDay(d.day)}</td>
                  {d.recorded ? <><td className={MONO}>{count(d.calls)}</td><td className={MONO}>{count(d.ok)}</td><td className={MONO}>{count(d.failed)}</td><td><Tokens microusd={d.charged} reason="Not recorded: no request this day was metered." /></td></>
                    : <td colSpan={4}><Unrecorded reason={notRecordedLabel}>{WORDS.notRecorded}</Unrecorded></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="relative h-44 border-b border-axal-hairline dark:border-gray-700">
            <div className="absolute inset-0 flex items-stretch gap-[2px]">
              {series.map((d) => (
                <button key={d.day} type="button" onMouseEnter={() => setActive(d.day)} onFocus={() => setActive(d.day)} onClick={() => setActive(d.day)}
                  className="relative flex min-w-0 flex-1 flex-col justify-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet"
                  aria-label={d.recorded ? `${shortDay(d.day)}: ${count(d.calls)} requests, ${count(d.failed)} failed, AI tokens ${tokensText(d.charged) ?? 'not recorded'}` : `${shortDay(d.day)}: ${notRecordedLabel}`}
                  data-day={d.day} data-recorded={d.recorded ? '1' : '0'}>
                  {d.recorded ? (
                    <>
                      <span className={`block w-full ${SERIES.failed}`} style={{ height: `${(d.failed / max) * 100}%` }} data-testid="usage-bar-failed" />
                      <span className={`block w-full ${SERIES.ok}`} style={{ height: `${(d.ok / max) * 100}%` }} data-testid="usage-bar-ok" />
                    </>
                  ) : <span className="absolute inset-x-0 bottom-0 border-t border-dashed border-gray-400 dark:border-gray-500" data-testid="usage-bar-unrecorded" />}
                </button>
              ))}
            </div>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {segments(line(series, 'charged', maxTok)).map((s, i) => <polyline key={`t${i}`} points={s.join(' ')} fill="none" stroke={SERIES.tokens} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
              {previous ? segments(line(previous, 'calls', max)).map((s, i) => <polyline key={`p${i}`} points={s.join(' ')} fill="none" stroke="currentColor" className="text-axal-muted dark:text-gray-400" strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />) : null}
            </svg>
          </div>
          <div className={`flex justify-between font-mono text-[11px] ${MUTED}`}><span>{shortDay(series[0]?.day)}</span><span>{shortDay(series.at(-1)?.day)}</span></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${SERIES.ok}`} />OK</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${SERIES.failed}`} />Failed</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-3" style={{ backgroundColor: SERIES.tokens }} />AI tokens charged (right axis)</span>
            {previous ? <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 border-t-2 border-dotted border-gray-500" />Previous period</span> : null}
            {series.some((d) => !d.recorded) ? <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 border-t border-dashed border-gray-500" />{notRecordedLabel}</span> : null}
          </div>
          {a ? (
            <p role="status" className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`${testId}-day`}>
              <strong className="text-axal-ink dark:text-gray-100">{shortDay(a.day)}</strong>{' · '}
              {a.recorded ? `${count(a.calls)} requests, ${count(a.failed)} failed, AI tokens ${tokensText(a.charged) ?? 'not recorded'}` : notRecordedLabel}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A meter: the share of a limit used, with its words. A missing share draws no bar. */
export function Meter({ label, value, percent, alert, link, testId }) {
  const p = percent === null || percent === undefined ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold">{label}</span>
        <span className={MONO}>{value}</span>
      </div>
      {p !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-axal-pill bg-gray-100 dark:bg-gray-800" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`${label}: ${p}% used`}>
          <div className={`h-full ${alert === 'at_limit' ? 'bg-red-600' : alert === 'near_limit' ? 'bg-amber-500' : 'bg-[#7c3aed] dark:bg-[#a78bfa]'}`} style={{ width: `${p}%` }} />
        </div>
      ) : null}
      {link}
    </div>
  );
}

/**
 * Who could have called: the member's keys (with this month's charge and
 * flags, D845 scope 3), their assistant connections, and their companies.
 * Each read stands alone; a failed one leaves the others.
 */
export function useCallers({ api = developerUsageApi, assistants = assistantsApi, companies = accountCompaniesApi } = {}) {
  const [state, setState] = useState({ keys: null, keysError: false, month: null, grants: null, projects: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const set = (patch) => { if (live) setState((s) => ({ ...s, ...patch })); };
    Promise.resolve().then(() => api.keys()).then((r) => set({ keys: Array.isArray(r?.keys) ? r.keys : [], month: r?.month ?? null, keysError: false }), () => set({ keys: null, keysError: true }));
    Promise.resolve().then(() => assistants.grants()).then((r) => set({ grants: Array.isArray(r?.grants) ? r.grants : [] }), () => set({ grants: null }));
    Promise.resolve().then(() => companies.projects()).then((r) => set({ projects: Array.isArray(r?.projects) ? r.projects : [] }), () => set({ projects: null }));
    return () => { live = false; };
  }, [api, assistants, companies, tick]);
  const companyName = useCallback((id) => (state.projects || []).find((p) => Number(p.id) === Number(id))?.name ?? null, [state.projects]);
  return { ...state, keys: state.keys ?? [], keysRead: state.keys, grants: state.grants ?? [], grantsRead: state.grants, companyName, reload: () => setTick((t) => t + 1) };
}
