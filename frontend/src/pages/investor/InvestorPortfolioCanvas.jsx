import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, Inbox, RefreshCw, TrendingDown, TrendingUp, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import './investorPortfolioCanvas.css';

const money = (value) => {
  if (value == null) return '—';
  const amount = Number(value);
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(0)}k`;
  return `$${Math.round(amount).toLocaleString()}`;
};
const multiple = (value) => (value == null ? '—' : `${Number(value).toFixed(2)}x`);
const ownership = (value) => (value == null ? '—' : `${Number(value).toFixed(1)}%`);
const label = (value) => String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

function Skeleton() {
  return <div className="i4-skeleton" aria-busy="true"><i /><i /><i /><i /><i /></div>;
}

export default function InvestorPortfolioCanvas({ active = 'health' }) {
  const [state, setState] = useState({
    loading: true, error: '', positions: [], analytics: null, health: null, updates: [], intros: [], compliance: null,
    unavailable: { analytics: false, health: false, updates: false, intros: false, compliance: false },
  });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const positionsResult = await api.positionsList();
      const optional = await Promise.allSettled([
        api.positionsAnalytics(),
        api.portfolioHealthList({}),
        api.portfolioUpdatesList(),
        api.listIntroductions(),
        api.positionsKpiCompliance(),
      ]);
      const value = (index, fallback) => optional[index].status === 'fulfilled' ? optional[index].value : fallback;
      const analyticsResult = value(0, null);
      const healthResult = value(1, null);
      const updatesResult = value(2, { items: [] });
      const introsResult = value(3, { introductions: [] });
      const complianceResult = value(4, null);
      setState({
        loading: false,
        error: '',
        positions: Array.isArray(positionsResult?.items) ? positionsResult.items : [],
        analytics: analyticsResult,
        health: healthResult,
        updates: Array.isArray(updatesResult?.items) ? updatesResult.items : [],
        intros: Array.isArray(introsResult?.introductions) ? introsResult.introductions : [],
        compliance: complianceResult,
        unavailable: {
          analytics: optional[0].status === 'rejected',
          health: optional[1].status === 'rejected',
          updates: optional[2].status === 'rejected',
          intros: optional[3].status === 'rejected',
          compliance: optional[4].status === 'rejected',
        },
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message || 'The direct book could not be loaded.' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reportedProjects = useMemo(
    () => new Set((state.compliance?.companies || []).filter((item) => item.reported).map((item) => item.project_id)),
    [state.compliance],
  );
  const rows = useMemo(() => state.positions.map((position) => {
    const health = state.health?.items?.find((item) => item.project_id === position.project_id);
    return { ...position, health, reported: reportedProjects.has(position.project_id) };
  }), [state.positions, state.health, reportedProjects]);
  const latestUpdate = state.updates[0];
  const interventionCount = state.health?.totals?.intervention ?? rows.filter((row) => row.health?.intervention).length;
  const acceptedIntros = state.intros.filter((item) => ['accepted', 'meeting_set'].includes(item.status)).length;
  const hasPartialFailure = Object.values(state.unavailable).some(Boolean);
  const statCards = [
    { label: 'TVPI · gross', value: multiple(state.analytics?.tvpi), note: 'Total value / paid-in', delta: 'Gross of fees and carry' },
    { label: 'MOIC · gross', value: multiple(state.analytics?.moic), note: `${money(state.analytics?.paid_in)} invested`, delta: 'Marked value + realised' },
    { label: 'DPI', value: multiple(state.analytics?.dpi), note: `${money(state.analytics?.distributed)} realised`, delta: 'Cash returned' },
    { label: 'RVPI', value: multiple(state.analytics?.rvpi), note: `${money(state.analytics?.nav)} held`, delta: 'Residual value' },
  ];

  return (
    <div className="i4-shell">
    <main className="i4-portfolio" data-testid="investor-portfolio-canvas">
      <header className="i4-heading">
        <div>
          <div className="i4-eyebrow">Investor &amp; LP / Portfolio</div>
          <h1>Know how my investments are doing</h1>
          <p>Your direct book — positions, founder-maintained records, and the work around each investment.</p>
        </div>
        <button type="button" className="i4-icon-button" onClick={load} data-testid="button-refresh-investor-portfolio" aria-label="Refresh direct book"><RefreshCw size={15} /></button>
      </header>

      <nav className="i4-tabs" aria-label="Portfolio sections">
        {[['health', 'Positions', '/portfolio/health'], ['updates', 'Updates', '/portfolio/updates'], ['growth', 'Value-add', '/portfolio/value-add']].map(([id, text, to]) => (
          <Link key={id} to={to} className={active === id || (active === 'health' && id === 'health') ? 'is-active' : ''} data-testid={`link-investor-portfolio-${id}`}>{text}</Link>
        ))}
      </nav>

      {state.error && <div className="i4-error" data-testid="status-investor-portfolio-error">{state.error}<button type="button" onClick={load} data-testid="button-retry-investor-portfolio">Retry</button></div>}
      {hasPartialFailure && <div className="i4-partial" data-testid="status-investor-portfolio-partial">Some portfolio sources are temporarily unavailable. Affected sections are labelled below.</div>}
      {state.loading ? <Skeleton /> : (
        <>
          <section className="i4-stats" aria-label="Direct book performance">
            {statCards.map((stat) => <article key={stat.label} className="i4-stat"><div><span>{stat.label}</span><b>{stat.value}</b><small>{stat.note}</small></div><em>{stat.delta}</em></article>)}
          </section>

          <section className="i4-card i4-positions">
            <div className="i4-section-head"><div><h2>Positions</h2><p>{rows.length} companies{state.analytics?.as_of ? ` · marks as of ${state.analytics.as_of}` : ''}</p></div><Link to="/portfolio/positions" data-testid="link-investor-positions-detail">View dilution <ArrowUpRight size={13} /></Link></div>
            {rows.length === 0 ? <div className="i4-empty">No direct positions have been recorded. Position records will appear here when they are available to this investor role.</div> : (
              <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Invested</th><th>Own %</th><th>FMV</th><th>Multiple</th><th>Reporting</th></tr></thead><tbody>
                {rows.map((row) => <tr key={row.project_id} data-testid={`row-investor-position-${row.project_id}`}>
                  <td><strong>{row.project?.name || `Startup ${row.project_id}`}</strong><small>{[row.project?.sector, row.project?.stage].filter(Boolean).join(' · ')}</small></td>
                  <td>{money(row.total_invested)}</td><td>{ownership(row.latest_ownership_pct)}</td><td>{money(row.fmv)}</td>
                  <td className={row.multiple != null && Number(row.multiple) < 1 ? 'i4-down' : 'i4-up'}>{multiple(row.multiple)}{row.unmarked && <small>At cost</small>}</td>
                   <td>{state.unavailable.compliance
                     ? <span className="i4-report">Unavailable</span>
                     : <span className={`i4-report ${row.reported ? 'is-current' : 'is-missing'}`}>{row.reported ? 'Current' : 'Due'}</span>}</td>
                </tr>)}
              </tbody></table></div>
            )}
            <p className="i4-seam-note"><span>Founder record</span> Ownership is read from each founder’s cap table. This investor view never edits it; changes remain attributable to the company record.</p>
          </section>

          <section className="i4-lower">
            <article className="i4-card i4-updates">
               <div className="i4-section-head"><div><h2>Updates &amp; KPI collection</h2><p>{state.unavailable.updates ? 'Update source unavailable' : `${state.updates.length} founder-submitted update${state.updates.length === 1 ? '' : 's'} in this accessible book`}</p></div><Link to="/portfolio/updates" data-testid="link-investor-updates-detail">Open updates <ArrowUpRight size={13} /></Link></div>
               {state.unavailable.updates ? <div className="i4-empty"><Inbox size={16} /> Founder updates are temporarily unavailable. No empty-reporting claim is being made.</div> : latestUpdate ? <div className="i4-update"><div className="i4-proposal">Founder update</div><h3>{latestUpdate.title}</h3><p>{latestUpdate.project?.name || `Startup ${latestUpdate.project_id}`}{latestUpdate.period ? ` · ${latestUpdate.period}` : ''}</p><div className="i4-kpis">{Object.entries(latestUpdate.kpis || {}).slice(0, 4).map(([key, value]) => <div key={key}><span>{label(key)}</span><b>{String(value)}</b></div>)}</div><Link to="/portfolio/updates" className="i4-primary-link" data-testid="link-review-latest-founder-update">Review source update</Link></div> : <div className="i4-empty"><Inbox size={16} /> No founder update is available yet. Incoming reports retain their source when published.</div>}
               <div className="i4-health-line"><Activity size={14} /><span>{state.unavailable.health ? 'Health signals are temporarily unavailable.' : interventionCount ? `${interventionCount} position${interventionCount === 1 ? '' : 's'} need attention.` : 'No intervention flags in the latest health sweep.'}</span><button type="button" onClick={load} data-testid="button-refresh-investor-health">Refresh signals</button></div>
            </article>
            <article className="i4-card i4-value-add">
            <div className="i4-section-head"><div><h2>Value-add desk</h2><p>Support recorded against this investor relationship</p></div><Link to="/portfolio/value-add" data-testid="link-investor-value-add-detail">Open desk <ArrowUpRight size={13} /></Link></div>
               <div className="i4-value-row"><UsersRound size={15} /><div><b>Introductions</b><p>{state.unavailable.intros ? 'Introduction records unavailable' : `${state.intros.length} recorded · ${acceptedIntros} accepted or meeting set`}</p></div><strong>{state.unavailable.intros ? '—' : state.intros.length}</strong></div>
               <div className="i4-value-row"><TrendingUp size={15} /><div><b>Portfolio health</b><p>{state.unavailable.health ? 'Health source unavailable' : `${state.health?.totals?.green ?? 0} currently healthy in the latest sweep`}</p></div><strong>{state.unavailable.health ? '—' : (state.health?.totals?.green ?? 0)}</strong></div>
               <div className="i4-value-row"><TrendingDown size={15} /><div><b>Needs attention</b><p>{state.unavailable.health ? 'Health source unavailable' : 'Open the health register for reasons and source signals'}</p></div><strong>{state.unavailable.health ? '—' : interventionCount}</strong></div>
              <p className="i4-seam-note">Support given is kept beside the position it serves. Founder-facing records remain distinct.</p>
            </article>
          </section>
        </>
      )}
      {state.analytics?.unmarked_position_count > 0 && (
        <div className="i4-coverage" data-testid="investor-portfolio-mark-coverage">
          {state.analytics.unmarked_position_count} of {state.analytics.position_count} positions have no valuation mark and are carried at cost
          {state.analytics.mark_coverage != null ? ` · ${Math.round(state.analytics.mark_coverage * 100)}% mark coverage` : ''}.
        </div>
      )}
      <footer className="i4-boundary">Investor workspace. Data shown is governed by your existing access and permissions.</footer>
    </main>
    <aside className="i4-rail" aria-label="Portfolio assistance" data-testid="investor-portfolio-rail">
      <div className="i4-rail-label">Worker AI · Portfolio</div>
      <section>
        <strong>Manual</strong>
        <p>Tables, updates, health sweeps, and portfolio tools work without AI.</p>
      </section>
      <section className="i4-rail-accent">
        <strong>Founder records stay attributable</strong>
        <p>Updates and cap-table ownership remain linked to the company records they came from.</p>
      </section>
      <div className="i4-rail-label">This page</div>
      <section>
        <strong>Live portfolio metrics</strong>
        <p>Returns are computed from recorded positions, marks, and distributions. Missing values stay blank rather than being estimated.</p>
        <Link to="/portfolio/performance">Open performance methodology</Link>
      </section>
      <section>
        <strong>Reporting review</strong>
        <p>Review founder-submitted KPIs and narratives in their original update records.</p>
        <Link to="/portfolio/updates">Open company updates</Link>
      </section>
      <div className="i4-rail-trust"><span>Screened</span> Nothing is sent to a founder from this page.</div>
    </aside>
    </div>
  );
}