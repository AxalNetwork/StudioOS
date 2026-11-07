/** D4491 (#4491) — Distribution Results: read-only funnels, campaigns, attribution and channel spend with each figure's source. */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { growResultsApi } from '../../../lib/api/growResults.js';
import { Card, LoadingSkeleton, SourceChip, StatusNote } from './DistributionParts.jsx';
import { DistributionReadError } from './DistributionStates.jsx';
import { useDistributionLayout } from './useDistributionLayout.js';
import { FUNNEL_STEPS, REVENUE_LINK, REVENUE_NOTE, REVENUE_PATH, SOURCE_LABELS, costMoney, figure, funnelWidth, money, sourceList, windowError, windowLabel } from './resultsModel.js';

const NUM = 'text-right font-mono tabular-nums whitespace-nowrap';
const H2 = 'text-base font-bold text-[color:var(--ds-ink)] dark:text-gray-100';
const SUB = 'mt-1 text-sm text-[color:var(--ds-muted)] dark:text-gray-400';
const CONTROL = 'min-h-[44px] rounded-lg border border-[color:var(--ds-line)] bg-[color:var(--ds-card)] px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** A recorded number in mono, or its named reason in place of 0 or a dash. */
export function Value({ value, reason, format }) {
  const f = figure(value, reason);
  if (f.value === null) return <span className="ds-not-recorded dark:text-gray-400">{f.reason}</span>;
  return <span className="font-mono tabular-nums">{format ? format(f.value) : f.value}</span>;
}
export function Sources({ sources }) {
  const list = sourceList(sources);
  if (!list.length) return null;
  return <span className="inline-flex flex-wrap justify-end gap-1">{list.map((s) => s === 'attributed'
    ? <span key={s} className="ds-chip dark:border-gray-700">{SOURCE_LABELS.attributed}</span>
    : <SourceChip key={s} source={s} />)}</span>;
}
function Table({ label, columns, children }) {
  return <div className="ds-table-scroll"><table aria-label={label} className="ds-table"><thead><tr>
    {columns.map(([key, text, numeric]) => <th key={key} scope="col" className={numeric ? 'text-right' : undefined}>{text}</th>)}
  </tr></thead><tbody>{children}</tbody></table></div>;
}

function Funnel({ row }) {
  return <Card className="min-w-0 dark:border-gray-700 dark:bg-gray-900" data-testid="results-funnel">
    <h3 className="truncate text-sm font-bold text-[color:var(--ds-ink)] dark:text-gray-100">{row.name}</h3>
    <dl className="mt-3 space-y-2">{FUNNEL_STEPS.map(([key, label]) => {
      const width = funnelWidth(row[key], row.leads);
      return <div key={key}>
        <div className="flex items-baseline justify-between gap-2 text-xs"><dt className="text-[color:var(--ds-muted)] dark:text-gray-400">{label}</dt><dd><Value value={row[key]} reason={row[`${key}_reason`]} /></dd></div>
        {width !== null && <div className="ds-progress mt-1" role="progressbar" aria-label={`${row.name}: ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)}><span style={{ width: `${width}%` }} /></div>}
      </div>;
    })}</dl>
  </Card>;
}

/** Presentation over one read: loading, the read-error card, or the figures. Makes no reads or writes. */
export function ResultsView({ state, onRetry, windowControls = null }) {
  const { phone, tablet } = useDistributionLayout();
  if (!state || state.status === 'loading') return <LoadingSkeleton label="Results" />;
  if (state.status !== 'ready') return <Card className="dark:border-gray-700 dark:bg-gray-900" data-testid="results-read-error"><h2 className={H2}>Results</h2><DistributionReadError onRetry={onRetry} /></Card>;
  const data = state.data || {};
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const funnels = campaigns.filter((c) => figure(c.leads).value !== null).sort((a, b) => b.leads - a.leads).slice(0, 3);
  const narrow = phone || tablet;
  return <div className="min-w-0 space-y-4" data-testid="distribution-results">
    <StatusNote>{REVENUE_NOTE} <Link className="inline-flex min-h-[44px] items-center font-semibold text-[color:var(--ds-violet)] dark:text-violet-300" to={REVENUE_PATH}>{REVENUE_LINK}</Link></StatusNote>
    <div className={`flex gap-3 ${phone ? 'flex-col' : 'flex-wrap items-end justify-between'}`}>
      <p className="text-sm text-[color:var(--ds-muted)] dark:text-gray-400" data-testid="results-window">{windowLabel(data)}</p>
      {windowControls}
    </div>
    {funnels.length > 0 && <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: phone ? 'minmax(0,1fr)' : `repeat(${Math.min(3, funnels.length)},minmax(0,1fr))` }}>
      {funnels.map((row) => <Funnel key={row.uid} row={row} />)}
    </div>}
    <Card className="min-w-0 dark:border-gray-700 dark:bg-gray-900"><h2 className={H2}>Campaigns</h2><p className={SUB}>From contacts tagged with each campaign’s UTM, and their status.</p>
      <Table label="Campaigns" columns={[['name', 'Campaign'], ['leads', 'Leads', true], ['demos', 'Demos', true], ['customers', 'Customers', true], ['spend', 'Spend', true], ['cpl', 'Cost per lead', true]]}>
        {campaigns.map((row) => <tr key={row.uid}>
          <th scope="row" className="text-left font-semibold text-[color:var(--ds-ink)] dark:text-gray-100">{row.name}</th>
          {['leads', 'demos', 'customers'].map((key) => <td key={key} className={NUM}><Value value={row[key]} reason={row[`${key}_reason`]} /></td>)}
          <td className={NUM}><Value value={row.spend_cents} reason={row.spend_reason} format={money} /></td>
          <td className={NUM}><div className="flex flex-col items-end gap-1"><Value value={row.cost_per_lead_cents} reason={row.cost_per_lead_reason} format={costMoney} />
            {row.cost_per_lead_cents != null && <Sources sources={row.cost_per_lead_sources} />}</div></td>
        </tr>)}
      </Table>
      {!campaigns.length && <p className="ds-not-recorded mt-2 dark:text-gray-400">Not recorded: no campaigns yet</p>}
    </Card>
    <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1.3fr) minmax(0,1fr)' }}>
      <Card className="min-w-0 dark:border-gray-700 dark:bg-gray-900"><h2 className={H2}>Attribution</h2><p className={SUB}>From post, ad and sequence to lead, demo and customer.</p>
        {Array.isArray(data.sources) ? <><Table label="Attribution" columns={[['name', 'Source'], ['leads', 'Leads', true], ['demos', 'Demos', true], ['customers', 'Customers', true], ['figure', 'Source of figure', true]]}>
          {data.sources.map((row) => <tr key={row.key}>
            <th scope="row" className="text-left font-semibold text-[color:var(--ds-ink)] dark:text-gray-100">{row.name}</th>
            {['leads', 'demos', 'customers'].map((key) => <td key={key} className={NUM}><Value value={row[key]} reason={row[`${key}_reason`]} /></td>)}
            <td className="text-right"><Sources sources={[row.figure_source]} /></td>
          </tr>)}
        </Table>{!data.sources.length && <p className="ds-not-recorded mt-2 dark:text-gray-400">Not recorded: no channel or tagged contact yet</p>}</>
          : <p className="ds-not-recorded mt-2 dark:text-gray-400">{figure(null, data.sources_reason).reason}</p>}
      </Card>
      <Card className="min-w-0 dark:border-gray-700 dark:bg-gray-900"><h2 className={H2}>Spend per channel</h2><p className={SUB}>From Mercury, as today; typed spend where Mercury has none.</p>
        {Array.isArray(data.channels) ? <><Table label="Spend per channel" columns={[['name', 'Channel'], ['spend', 'Spend', true], ['source', 'Source', true]]}>
          {data.channels.map((row) => <tr key={row.uid}>
            <th scope="row" className="text-left font-semibold text-[color:var(--ds-ink)] dark:text-gray-100">{row.name}</th>
            <td className={NUM}><Value value={row.spend_cents} reason={row.spend_reason} format={money} /></td>
            <td className="text-right"><Sources sources={row.spend_sources?.length ? row.spend_sources : ['manual']} /></td>
          </tr>)}
        </Table>{!data.channels.length && <p className="ds-not-recorded mt-2 dark:text-gray-400">Not recorded: no channels yet</p>}</>
          : <p className="ds-not-recorded mt-2 dark:text-gray-400">{figure(null, data.channels_reason).reason}</p>}
      </Card>
    </div>
  </div>;
}

/** The mounted tab: one venture-scoped read, an optional window, Try again on failure. Raw errors are never shown. */
export default function ResultsTab({ projectId }) {
  const [state, setState] = useState({ status: 'loading' });
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [invalid, setInvalid] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!projectId) return undefined;
    let live = true;
    setState({ status: 'loading' });
    growResultsApi.results(projectId, applied.from ? applied : {})
      .then((data) => { if (live) setState({ status: 'ready', data }); })
      .catch(() => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [projectId, applied, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const apply = (e) => {
    e.preventDefault();
    const error = windowError(draft.from, draft.to);
    setInvalid(error);
    if (!error) setApplied({ ...draft });
  };
  const clear = () => { setDraft({ from: '', to: '' }); setInvalid(null); setApplied({ from: '', to: '' }); };
  const controls = <form className="flex flex-wrap items-end gap-2" onSubmit={apply} aria-label="Reporting window">
    <label className="flex flex-col text-xs text-[color:var(--ds-muted)] dark:text-gray-400">From<input type="date" className={CONTROL} value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} /></label>
    <label className="flex flex-col text-xs text-[color:var(--ds-muted)] dark:text-gray-400">To<input type="date" className={CONTROL} value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} /></label>
    <button type="submit" className={CONTROL}>Show window</button>
    {applied.from && <button type="button" className={CONTROL} onClick={clear}>Lifetime</button>}
    {invalid && <p role="alert" className="w-full text-sm text-[color:var(--ds-neg)] dark:text-red-300">{invalid}</p>}
  </form>;
  return <ResultsView state={state} onRetry={retry} windowControls={controls} />;
}
