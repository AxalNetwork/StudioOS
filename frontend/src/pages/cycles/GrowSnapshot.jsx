/**
 * D4864 (#4864, GR-12, GR-15, GR-16): Grow's headline figures. Each card names its value or its state
 * (D5129's words, from `ui/Honesty.jsx`), its source and as-of date, a Stale age where the figure is from
 * an earlier period, and the one recovery action its state has. The rules are `growKpiModel.js`'s.
 */
import { Link } from 'react-router-dom';
import { DataState, StateChip } from '../../ui';
import { growKpi, sourceLine } from './growKpiModel';

const EYEBROW = 'font-mono text-[10px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const ACTION = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-3 py-2 text-[12px] font-bold text-axal-violet-deep hover:bg-axal-ground dark:border-gray-700 dark:text-violet-300 dark:hover:bg-gray-800';
const TEXT_ACTION = 'inline-flex min-h-[44px] items-center px-1 text-[12px] font-bold text-axal-violet-deep hover:underline dark:text-violet-300';
const H2 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';

/** One KPI card (GR-12's `gk`): a dashed border whenever there is no current value. */
export function GrowKpiCard({ fig, search = '', readOnly = false, onRetry, lastGood = null, kept = null, now }) {
  const kpi = growKpi(fig, { search, readOnly, lastGood, now, kept });
  const stale = kpi.stale;
  const dashed = kpi.state !== 'value' || stale;
  // The state's chip sits in the slot (DataState's tile); only Stale, a modifier, sits beside the label.
  const chip = stale ? <StateChip kind="stale" age={stale.age || undefined} /> : null;
  return (
    <div role="group" aria-label={kpi.label} data-testid={`grow-kpi-${kpi.key}`} data-kpi-state={stale?.kept ? 'kept' : kpi.state}
      className={`flex min-w-0 flex-col gap-1.5 rounded-xl border bg-white px-3.5 py-3 dark:bg-gray-900 ${dashed ? 'border-dashed border-gray-300 dark:border-gray-600' : 'border-axal-hairline dark:border-gray-800'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className={EYEBROW} aria-hidden="true">{kpi.label}</span>{chip}</div>
      <span className="sr-only">{kpi.sr}</span>
      {kpi.state === 'value' ? (<>
        <b className="font-mono text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100" aria-hidden="true">{kpi.value}</b>
        {kpi.change ? <span className={MUTED} aria-hidden="true">{kpi.change}</span> : null}
        {kpi.zero ? <span className={MUTED}>Measured zero, not missing.</span> : null}
        {stale ? <span className={MUTED}>{stale.kept ? 'Kept from the last good read; not refreshed.' : 'No change shown: the figure is from an earlier period.'}</span> : null}
      </>) : kpi.state === 'unavailable' ? (<>
        <DataState state="unavailable" size="tile" what={kpi.label} claim="This is not a claim that nothing is recorded." onRetry={onRetry} />
        {kpi.reason ? <span className={MUTED} data-testid={`grow-kpi-${kpi.key}-last-good`}>{kpi.reason}</span> : null}
      </>) : (<>
        <DataState state="not_recorded" size="tile" reason={kpi.reason} />
        {kpi.actions.length ? <div className="flex flex-wrap items-center gap-1.5">
          {kpi.actions.map((a, i) => <Link key={a.key} to={a.href} className={i === 0 ? ACTION : TEXT_ACTION} data-testid={`grow-kpi-${kpi.key}-${a.key}`}>{a.label}</Link>)}
        </div> : null}
      </>)}
      <span className="mt-auto font-mono text-[10.5px] leading-relaxed text-axal-muted dark:text-gray-400">{sourceLine(kpi)}</span>
    </div>
  );
}

/** How many figures are in each state, for the polite summary and the phone disclosure. */
export function snapshotSummary(figures = []) {
  const states = figures.map((f) => growKpi(f).state);
  const recorded = states.filter((s) => s === 'value').length;
  const unavailable = states.filter((s) => s === 'unavailable').length;
  const n = figures.length;
  return [`${n} figure${n === 1 ? '' : 's'}`, recorded ? `${recorded} recorded` : 'none recorded yet', unavailable ? `${unavailable} unavailable` : null].filter(Boolean).join(' · ');
}

/**
 * The snapshot section. `status === 'loading'` draws one skeleton per figure slot (four, as the read
 * returns); `kept` ({ at, age }) marks figures shown from the last good read after a refresh failed.
 * `collapse` (a sparse venture, GR-16a) folds it into a disclosure below 1024px.
 */
export default function GrowSnapshot({ figures = [], status = 'ready', search = '', readOnly = false, onRetry, lastGood = {}, kept = null, collapse = false, now }) {
  const cards = status === 'loading'
    ? [0, 1, 2, 3].map((i) => <div key={i} className="rounded-xl border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900"><DataState state="loading" size="tile" /></div>)
    : figures.map((f) => <GrowKpiCard key={f.key} fig={f} search={search} readOnly={readOnly} onRetry={onRetry} lastGood={lastGood[f.key] || null} kept={kept} now={now} />);
  const grid = <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards}</div>;
  const summary = status === 'loading' ? 'Loading growth figures' : snapshotSummary(figures);
  return (<>
    <section aria-labelledby="grow-snapshot-title" data-testid="grow-snapshot" className={collapse ? 'hidden lg:block' : ''}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="grow-snapshot-title" className={H2}>Growth snapshot</h2><span className={MUTED}>Each figure names its source and date</span></div>
      {grid}
      <p className="sr-only" role="status" aria-live="polite">{`Growth snapshot: ${summary}.`}</p>
    </section>
    {collapse ? (
      <details className="rounded-[12px] border border-axal-hairline bg-white lg:hidden dark:border-gray-700 dark:bg-gray-900" data-testid="grow-snapshot-phone">
        <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-2 px-4 py-2 text-[13px]"><b className="text-axal-ink dark:text-gray-100">Growth snapshot</b><span className={MUTED}>{summary}</span></summary>
        <div className="border-t border-axal-hairline p-3 dark:border-gray-700">{grid}</div>
      </details>
    ) : null}
  </>);
}
