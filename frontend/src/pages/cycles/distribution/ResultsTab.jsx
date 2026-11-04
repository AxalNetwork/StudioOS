/** D4491 — read-only Results presentation; the container supplies recorded, venture-scoped figures. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Card, LoadingSkeleton, ProgressBar, SourceChip, StatusNote, Table } from './DistributionParts.jsx';
import { figure, funnelWidth, money, REVENUE_NOTE, REVENUE_PATH } from './resultsModel.js';
function Value({ value, reason, monetary = false }) {
  const result = figure(value, reason);
  return result.value === null ? <span className="ds-not-recorded">{result.reason}</span> : <span className="font-mono tabular-nums">{monetary ? money(result.value) : result.value}</span>;
}
function Sources({ sources = [] }) {
  if (!sources.length) return <span className="ds-not-recorded">Not recorded</span>;
  return <span className="inline-flex flex-wrap gap-1">{sources.map((source) => source === 'attributed'
    ? <span className="ds-chip" key={source}>UTM attribution</span> : <SourceChip key={source} source={source} />)}</span>;
}
export default function ResultsTab({ state, onRetry }) {
  if (!state || state.status === 'loading') return <LoadingSkeleton label="Results" />;
  if (state.status !== 'ready') return <Card><h2>Results</h2><p>Couldn’t be read. This is not a claim that there are none.</p><button type="button" className="ds-secondary" onClick={onRetry}>Try again</button></Card>;
  const { campaigns = [], sources = [], channels = [] } = state;
  return <div className="min-w-0 space-y-4" data-testid="distribution-results">
    <StatusNote>{REVENUE_NOTE} <Link to={REVENUE_PATH}>Open Revenue and traction ›</Link></StatusNote>
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card><h2>Attribution</h2><p>From post, ad and sequence to lead, demo and customer.</p>
        <Table label="Attribution" columns={['Source','Leads','Demos','Customers','Source of figure'].map(label => ({key:label,label}))}>
          {sources.map(row => <tr key={row.key}><th scope="row">{row.name}</th>{['leads','demos','customers'].map(key => <td key={key} className="text-right"><Value value={row[key]} reason={row[`${key}_reason`]} /></td>)}<td><Sources sources={row.figure_sources} /></td></tr>)}
        </Table>{!sources.length && <p>No attribution recorded.</p>}</Card>
      <Card><h2>Spend per channel</h2><p>Recorded Mercury and manual channel spend.</p>
        <Table label="Spend per channel" columns={['Channel','Spend','Source'].map(label => ({key:label,label}))}>
          {channels.map(row => <tr key={row.uid}><th scope="row">{row.name}</th><td className="text-right"><Value value={row.spend_cents} reason={row.spend_reason} monetary /></td><td><Sources sources={row.spend_sources} /></td></tr>)}
        </Table>{!channels.length && <p>No channel spend recorded.</p>}</Card>
    </div>
    <div className="grid gap-4 md:grid-cols-3">{campaigns.slice(0,3).map(row => <Card key={row.uid}><h2>{row.name}</h2>{['leads','demos','customers'].map(key => <div key={key}><span>{key}</span> <Value value={row[key]} reason={row[`${key}_reason`]} /><ProgressBar value={funnelWidth(row[key],row.leads)} label={`${row.name}: ${key}`} /></div>)}</Card>)}</div>
    <Card><h2>Campaigns</h2><p>From contacts tagged with each campaign’s UTM, and their status.</p>
      <Table label="Campaigns" columns={['Campaign','Leads','Demos','Customers','Spend','Cost per lead'].map(label => ({key:label,label}))}>
        {campaigns.map(row => <tr key={row.uid}><th scope="row">{row.name}</th>{['leads','demos','customers','spend_cents','cost_per_lead_cents'].map(key => <td key={key} className="text-right"><Value value={row[key]} reason={row[`${key}_reason`]} monetary={key.endsWith('_cents')} />{key==='cost_per_lead_cents' && <Sources sources={row.cost_sources} />}</td>)}</tr>)}
      </Table>{!campaigns.length && <p>No campaigns recorded.</p>}</Card>
  </div>;
}
