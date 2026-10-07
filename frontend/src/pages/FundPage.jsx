import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkspaceShell from '../workspaces/WorkspaceShell';
import WorkerRail from '../ui/WorkerRail';
import { api } from '../lib/api';
import { readableFund, useFundReport } from '../hooks/useFundReport';
import './fundPage.css';

export function fundMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  const value = BigInt(cents);
  return `$${(value / 100n).toLocaleString('en-US')}.${String(value % 100n).padStart(2, '0')}`;
}
export function Recorded({ value, reason }) {
  return value !== null && value !== undefined && value !== '' ? <span>{value}</span>
    : <span><b>Not recorded</b><small>{reason}</small></span>;
}
export function FundReadState({ reading }) {
  if (reading.loading) return <div className="fd-card" aria-busy="true">Loading fund records…</div>;
  if ([403, 404].includes(reading.error?.status)) return <div className="fd-card" role="alert">Fund not available. This account cannot read that fund or reporting period.</div>;
  return <div className="fd-card" role="alert"><strong>Unreadable</strong><p>The fund records could not be read.</p><button type="button" onClick={reading.reload}>Try again</button></div>;
}
export default function FundPage({ role = 'investor', reading: supplied }) {
  const { fundId } = useParams();
  const resource = useFundReport(fundId);
  const reading = supplied || resource;
  const page = !reading.loading && !reading.error && readableFund(reading.data) ? reading.data : null;
  const [download, setDownload] = useState({ busy: false, error: null });
  const openLpa = async () => {
    setDownload({ busy: true, error: null });
    try { await api.downloadFundLpa(page.fund.id); setDownload({ busy: false, error: null }); }
    catch { setDownload({ busy: false, error: 'Unreadable: the LPA could not be downloaded. Try again.' }); }
  };
  return <div className="fd-surface"><WorkspaceShell role={role} activeSlug={null} title={page?.fund.name || 'Fund page'}
    intro="Recorded fund facts, the general partner of record and service providers."
    rail={<WorkerRail role={role} workspace="Fund" stance="Recorded fund facts" coverage={page ? ['Fund record and live totals read'] : []}
      note="Missing providers are shown as Not recorded. Failed reads are Unreadable." />}>
    {reading.loading || reading.error || !page ? <FundReadState reading={reading} /> : <>
      <section className="fd-facts" aria-label="Fund facts">
        <Fact label="Size · USD" value={fundMoney(page.fund.size_cents)} reason="The fund size has not been recorded." />
        <Fact label="Status" value={page.fund.status} reason="The fund status has not been recorded." />
        <Fact label="LPs · live count" value={page.fund.lp_count} />
        <Fact label="Vintage" value={page.fund.vintage_year} reason="The vintage year has not been recorded." />
      </section>
      {page.fund.lp_count === 0 && <p>No LP has committed yet.</p>}
      <section className="fd-two" aria-label="Fund totals">
        <Fact label="Committed · USD" value={fundMoney(page.totals.committed_cents)} reason={page.totals.committed_reason} note="Sum of this fund’s recorded LP commitments." />
        <Fact label="Invested · USD" value={fundMoney(page.totals.invested_cents)} reason={page.totals.invested_reason} note="Original invested amounts on positions attributed to this fund." />
      </section>
      <section className="fd-two">
        <article className="fd-card"><h2>General partner of record</h2><dl>{[['name', 'Name'], ['title', 'Title'], ['entity', 'Entity'], ['email', 'Email']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={page.fund.gp[key]} reason={`The GP ${label.toLowerCase()} has not been recorded.`} /></dd></div>)}</dl></article>
        <article className="fd-card"><h2>Limited partnership agreement</h2>{page.lpa ? <><dl><div><dt>Status</dt><dd><Recorded value={page.lpa.status} reason="The LPA status has not been recorded." /></dd></div><div><dt>Version</dt><dd><Recorded value={page.lpa.version} reason="The LPA version has not been recorded." /></dd></div><div><dt>Updated</dt><dd><Recorded value={page.lpa.updated_at} reason="The LPA update date has not been recorded." /></dd></div></dl><button type="button" disabled={download.busy} onClick={openLpa}>{download.busy ? 'Opening…' : 'Open LPA'}</button>{download.error && <p role="alert">{download.error}</p>}</> : <Recorded value={null} reason="No LPA is attached to this fund." />}</article>
      </section>
      <article className="fd-card"><h2>Service providers</h2><dl>{[['fund_admin', 'Fund administrator'], ['auditor', 'Auditor'], ['legal_counsel', 'Legal counsel'], ['custodian', 'Custodian'], ['valuation_policy', 'Valuation policy']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Recorded value={page.fund.providers[key]} reason={`${label} has not been recorded for this fund.`} /></dd></div>)}</dl></article>
      <article className="fd-card"><h2>Reporting periods</h2>{page.periods.length ? <ul>{page.periods.map(period => <li key={period.id}><Link to={`/funds/${page.fund.id}/reporting/${period.id}`}>{period.period}</Link> · {period.status}</li>)}</ul> : <p>{page.can_manage ? 'No reporting period has been recorded.' : 'No issued reporting period is recorded.'}</p>}</article>
      {page.can_manage && <div className="fd-actions"><Link to={`/funds/${page.fund.id}/reporting/new`}>New reporting period</Link><Link to={`/funds/reporting?fund=${page.fund.id}`}>Reporting archive</Link><Link to={`/funds/lps?fund=${page.fund.id}`}>Open LPs</Link></div>}
    </>}
  </WorkspaceShell></div>;
}
function Fact({ label, value, reason, note }) {
  return <article className="fd-card"><h2>{label}</h2><div className="fd-number"><Recorded value={value} reason={reason} /></div>{note && <small>{note}</small>}</article>;
}
