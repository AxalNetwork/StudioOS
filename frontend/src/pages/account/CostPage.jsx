import { useState } from 'react';
import { Link } from 'react-router-dom';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { EmptyState, Unrecorded, Unreadable } from '../../ui';
import { BTN, INPUT, PanelCard, useAccountRead } from './AccountCenter';
import { COST_GROUPS, COST_RANGES, COST_SUBTITLE, costReadable, costTableRows, costTotals, totalUnits } from './costModel';
import { DailyCostChart } from './UsageCharts';
import { UsageCardState } from './UsageOverview';
import UsageDetails from './AccountUsage';
import { microUsd, usd } from './usageModel';

const countText = (v) => Number.isSafeInteger(v) && v >= 0 ? v.toLocaleString('en-US') : null;
function Missing({ value, reason }) {
  return value == null ? <Unrecorded reason={reason}>Not recorded</Unrecorded> : value;
}
export function CostTable({ data, group = 'model', model = '' }) {
  const rows = costTableRows(data, group, model);
  if (!rows) return <Unrecorded reason="The cost table was not returned.">Not recorded</Unrecorded>;
  const selected = model && group === 'model' ? data.models.find((m) => m.model === model) : null;
  const totals = selected || data.totals;
  const columns = ['Runs', 'Input tokens', 'Output tokens', 'Other units', 'Cloudflare cost', 'Charged'];
  const units = selected ? rows[0]?.units : totalUnits(data);
  const row = (r, total = false) => <div key={r.key} data-testid={total ? 'cost-table-total' : 'cost-table-row'}
    className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-axal-hairline py-3 text-xs last:border-0 dark:border-gray-800 lg:grid-cols-[minmax(140px,1.5fr)_repeat(6,minmax(60px,1fr))]">
    <div className="col-span-2 flex min-w-0 items-start gap-2 font-semibold lg:col-span-1">
      {r.colour && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.colour }} />}
      <span className="break-words">{r.label}{r.page && <small className="block font-normal">{r.page}</small>}</span>
    </div>
    {[countText(r.runs), countText(r.input), countText(r.output), r.units, r.cost, r.charged].map((v, i) =>
      <div key={columns[i]} className="min-w-0 break-words font-mono lg:text-right">
        <span className="mb-0.5 block font-sans text-[11px] text-axal-muted dark:text-gray-400 lg:hidden">{columns[i]}</span>
        <Missing value={v} reason={i === 3 && group !== 'model' ? 'The grouped read does not return non-token units.'
          : i === 4 && group !== 'model' ? 'The grouped read does not return Cloudflare cost.'
            : 'This figure was not returned; older or held runs may have no recorded charge.'} />
        {i === 5 && r.partial > 0 && <span className="block font-sans text-[11px]">Not recorded for {r.partial} runs; shown amount is partial.</span>}
      </div>)}
  </div>;
  return <PanelCard title={`By ${group}`} data-testid="cost-table">
    <div className="hidden grid-cols-[minmax(140px,1.5fr)_repeat(6,minmax(60px,1fr))] gap-3 border-b border-axal-hairline pb-2 text-[10px] font-semibold uppercase text-axal-muted dark:border-gray-800 dark:text-gray-400 lg:grid">
      <span>{group}</span>{columns.map((c) => <span key={c} className="text-right">{c}</span>)}
    </div>
    {!rows.length ? <p className="text-sm">No AI runs in this range.</p> : rows.map((r) => row(r))}
    {row({ key: 'total', label: selected ? 'Selected model total' : 'Range total', runs: totals.runs, input: totals.input_tokens, output: totals.output_tokens,
      units, cost: usd(totals.cost_usd), charged: microUsd(totals.charged_microusd), partial: totals.not_recorded }, true)}
    {group !== 'model' && <p className="mt-3 text-xs text-axal-muted dark:text-gray-400">Page and option groups return charges and token counts. Cloudflare cost and other units are Not recorded for these groups.</p>}
    {data.totals.output_not_recorded > 0 && <p className="mt-3 text-xs" data-testid="cost-missing-output">Not recorded: {data.totals.output_not_recorded} streamed replies recorded no output count. They are charged on the input they read. Token columns sum the counts that were recorded.</p>}
    {data.totals.output_not_recorded == null && <Unrecorded reason="The read did not return the count of runs with missing output tokens.">Not recorded</Unrecorded>}
  </PanelCard>;
}
export function CostContents({ cost, group, model, onModel, onChangeRange }) {
  const read = cost.status === 'ready' && costReadable(cost.data) ? cost.data : null;
  const totals = read && costTotals(read);
  return <UsageCardState read={cost} what="Cost">
    {!read ? <Unrecorded reason="The cost read did not return the daily and model breakdowns.">Not recorded</Unrecorded> : <>
      <p className="text-xs text-axal-muted dark:text-gray-400">Range totals · all models</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {totals.map((t) => <PanelCard key={t.label} title={t.label}><div className="font-mono text-xl"><Missing value={t.value} reason="The read did not record this amount." /></div></PanelCard>)}
      </div>
      {read.totals.not_recorded > 0 && <p className="text-xs">Not recorded: charges for {read.totals.not_recorded} runs. The charged total includes recorded charges only.</p>}
      {read.totals.by_kind?.other?.cost_usd > 0 && <p className="text-xs">Other model cost: {usd(read.totals.by_kind.other.cost_usd)}. Included in the range's Cloudflare total.</p>}
      {read.truncated && <p role="status" className="text-xs">This view and its CSV cover the newest 10,000 runs in the range; totals are partial.</p>}
      <label className="flex flex-wrap items-center gap-2 text-xs">Chart model{group === 'model' ? ' and table' : ' (table shows all models)'}
        <select className={INPUT} aria-label="Model" value={model} onChange={(e) => onModel(e.target.value)}>
          <option value="">All models</option>{read.models.map((m) => <option key={m.model} value={m.model}>{m.name || m.model}</option>)}
        </select>
      </label>
      <PanelCard title="Daily cost" aside={read.range ? `${read.range.from} – ${read.range.to} · UTC` : 'UTC'}>
        <DailyCostChart data={read} model={model} />
      </PanelCard>
      {!read.totals.runs && <div><EmptyState size="sm" title="No AI runs in this range." /><button type="button" className={BTN.ghost} onClick={onChangeRange}>Change the range</button></div>}
      <CostTable data={read} group={group} model={group === 'model' ? model : ''} />
    </>}
  </UsageCardState>;
}
function CostRead({ range, group, model, setModel, setRange }) {
  const cost = useAccountRead(() => aiBudgetApi.cost({ range, group }));
  return <CostContents cost={cost} group={group} model={model} onModel={setModel} onChangeRange={() => setRange(range === '30d' ? 'mtd' : '30d')} />;
}
export function downloadCostCsv(client, range, group) {
  return client.costCsv({ range, group });
}
export default function CostPage({ role }) {
  const [range, setRange] = useState('mtd');
  const [group, setGroup] = useState('model');
  const [model, setModel] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const changeRange = (v) => { setRange(v); setModel(''); setExportError(false); };
  const reset = () => { changeRange('mtd'); setGroup('model'); };
  const csv = async () => {
    setExporting(true); setExportError(false);
    try { await downloadCostCsv(aiBudgetApi, range, group); } catch { setExportError(true); }
    finally { setExporting(false); }
  };
  return <div className="flex min-w-0 flex-col gap-4" data-testid="usage-cost-page">
    <Link to="/account/usage" className="text-xs font-semibold text-axal-violet dark:text-violet-300">← Usage overview</Link>
    <header><h2 className="text-xl font-extrabold tracking-axal-heading">Cost</h2><p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{COST_SUBTITLE}</p></header>
    <PanelCard><div className="flex flex-wrap items-center gap-3">
      <label className="text-xs">Range<select className={INPUT} aria-label="Range" value={range} onChange={(e) => changeRange(e.target.value)}>{COST_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="text-xs">Group by<select className={INPUT} aria-label="Group by" value={group} onChange={(e) => { setGroup(e.target.value); setModel(''); }}>{COST_GROUPS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <button type="button" className={BTN.ghost} onClick={reset}>Reset</button>
      <button type="button" className={BTN.ghost} onClick={csv} disabled={exporting}>{exporting ? 'Downloading…' : 'Download CSV · all models'}</button>
    </div>{exportError && <Unreadable what="The CSV download" claim="Try Download CSV again." onRetry={csv} />}</PanelCard>
    <CostRead key={`${range}:${group}`} range={range} group={group} model={model} setModel={setModel} setRange={changeRange} />
    <details open data-testid="usage-preserved-details" className="min-w-0">
      <summary className="mb-3 cursor-pointer text-sm font-semibold">Allowance, top-ups, where it went, models, rate card, last run and storage</summary>
      <UsageDetails role={role} details />
    </details>
  </div>;
}
