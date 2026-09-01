import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import './investorPortfolioCanvas.css';
import './investorPortfolioUpdates.css';

const money = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Math.round(Number(value)).toLocaleString()}`;
const title = (value, fallback = 'Not recorded') => String(value ?? '').trim().replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || fallback;
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const kpiText = (update) => Object.entries(update?.kpis || {}).slice(0, 4).map(([key, value]) => `${title(key)} ${typeof value === 'number' ? money(value) : String(value)}`).join(' · ');

export default function InvestorPortfolioUpdates() {
  const [filter, setFilter] = useState('period');
  const [state, setState] = useState({ loading: true, error: '', positions: [], updates: [], compliance: null, health: null, unavailable: { positions: false, updates: false, compliance: false, health: false } });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const positionsResult = await api.positionsList();
      const optional = await Promise.allSettled([api.portfolioUpdatesList(), api.positionsKpiCompliance(), api.portfolioHealthList({})]);
      setState({
        loading: false, error: '',
        positions: list(positionsResult, 'items', 'positions'),
        updates: optional[0].status === 'fulfilled' ? list(optional[0].value, 'items', 'updates') : [],
        compliance: optional[1].status === 'fulfilled' ? optional[1].value : null,
        health: optional[2].status === 'fulfilled' ? optional[2].value : null,
        unavailable: { positions: false, updates: optional[0].status === 'rejected', compliance: optional[1].status === 'rejected', health: optional[2].status === 'rejected' },
      });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error?.message || 'The positions source could not be loaded.', unavailable: { positions: true, updates: true, compliance: true, health: true } }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const complianceByProject = new Map((state.compliance?.companies || []).map((item) => [String(item.project_id), item]));
    const healthByProject = new Map((state.health?.items || []).map((item) => [String(item.project_id), item]));
    const latestByProject = new Map();
    state.updates.forEach((update) => {
      const date = update.submitted_at || update.updated_at || update.created_at;
      const current = latestByProject.get(String(update.project_id));
      if (date && (!current || new Date(date) > new Date(current.submitted_at || current.updated_at || current.created_at))) latestByProject.set(String(update.project_id), update);
    });
    return state.positions.map((position) => {
      const compliance = complianceByProject.get(String(position.project_id)) || null;
      const update = latestByProject.get(String(position.project_id)) || null;
      const current = state.unavailable.compliance ? null : Boolean(compliance?.reported);
      return { ...position, compliance, health: healthByProject.get(String(position.project_id)) || null, update, current, arrived: current === true && update ? update.submitted_at || update.updated_at : null, status: state.unavailable.updates ? 'Unavailable' : current === false ? 'Not reported' : update ? 'Received' : 'Not recorded' };
    });
  }, [state]);
  const visible = rows.filter((row) => {
    if (filter === 'overdue') return row.current === false;
    if (filter === 'parse') return false;
    if (filter === 'rules') return false;
    return true;
  });
  const complianceUnavailable = state.unavailable.compliance;
  const healthUnavailable = state.unavailable.health;
  const arrived = complianceUnavailable ? 'Unavailable' : state.compliance?.reported_count ?? 0;
  const total = complianceUnavailable ? 'Unavailable' : state.compliance?.total_count ?? rows.length;
  const neverArrived = complianceUnavailable ? 'Unavailable' : Math.max(0, Number(total) - Number(arrived));
  const runwayAlerts = healthUnavailable ? 'Unavailable' : rows.filter((row) => Number(row.health?.runway_months) < 6).length;
  const partial = Object.values(state.unavailable).some(Boolean);

  return <div className="i4-shell ip2-shell"><main className="i4-portfolio ip2-updates" data-testid="investor-portfolio-updates"><header className="i4-heading"><div><div className="i4-eyebrow">Portfolio / Updates</div><h1>Updates &amp; KPI collection</h1><p>Inbox, cadence compliance and source-preserved founder updates from the investor-accessible portfolio.</p></div><button type="button" className="i4-icon-button" onClick={load} aria-label="Refresh portfolio updates"><RefreshCw size={15} /></button></header>
    <nav className="i4-tabs" aria-label="Portfolio sections"><Link to="/portfolio/positions">Positions</Link><Link className="is-active" to="/portfolio/updates">Updates</Link><Link to="/portfolio/value-add">Value-add</Link></nav>
    {state.error && <div className="i4-error" data-testid="status-investor-updates-error"><span>{String(state.error).toLowerCase() === 'not found' ? 'Portfolio update source unavailable in local development. No empty inbox claim is being made.' : state.error}</span><button type="button" onClick={load}>Retry</button></div>}
    {partial && !state.loading && <div className="i4-partial" data-testid="status-investor-updates-partial">Some portfolio sources are temporarily unavailable. Affected metrics and cells are labelled rather than treated as zero.</div>}
    {state.loading ? <Skeleton /> : <><div className="ip2-filters"><div><button className={filter === 'period' ? 'is-active' : ''} onClick={() => setFilter('period')}>This period</button><button className={filter === 'overdue' ? 'is-active' : ''} onClick={() => setFilter('overdue')}>Overdue</button><button className={filter === 'parse' ? 'is-active' : ''} onClick={() => setFilter('parse')}>Parse review</button><button className={filter === 'rules' ? 'is-active' : ''} onClick={() => setFilter('rules')}>Rules</button></div></div>
      <section className="i4-stats"><Stat label="Arrived" value={complianceUnavailable ? 'Unavailable' : `${arrived} of ${total}`} note={complianceUnavailable ? 'Cadence source unavailable' : `${rows.filter((row) => row.current === true && row.update).length} with a stored update`} /><Stat label="Never arrived" value={complianceUnavailable ? 'Unavailable' : neverArrived} note={complianceUnavailable ? 'Cadence source unavailable' : 'Current period not reported'} /><Stat label="Parse review" value="Unavailable" note="No parse-review state is stored" muted /><Stat label="Runway alerts" value={runwayAlerts} note={healthUnavailable ? 'Health source unavailable' : 'Below 6 months from health records'} /></section>
      <section className="i4-card i4-positions ip2-inbox"><div className="i4-section-head"><div><h2>Update inbox</h2><p>{filter === 'rules' ? 'Extraction rules are not available in this read-only feed' : filter === 'parse' ? 'No parse-review state is recorded by the source' : 'Cadence status and founder-submitted content'}</p></div><span>Source-preserved · no write</span></div><UpdateTable rows={visible} updatesUnavailable={state.unavailable.updates} complianceUnavailable={complianceUnavailable} filter={filter} /><p className="i4-seam-note"><span>Founder record</span> Submitted updates remain attributable to their source company. IP2 does not edit, parse, chase, or submit an update.</p></section>
      <section className="i4-card ip2-unavailable"><div className="i4-section-head"><div><h2>Extraction rules</h2><p>Not available in the stored investor feed</p></div></div><strong>Parse review and editable proposals are unavailable.</strong><p>The API exposes submitted KPI values and narratives, but not an extraction proposal, ambiguity state, or rule editor. IP2 does not manufacture those states.</p></section>
      <footer className="i4-boundary">Investor workspace · updates shown are restricted to this investor’s accessible portfolio.</footer></>}
  </main><UpdatesRail rows={rows} unavailable={state.unavailable} /></div>;
}

function UpdateTable({ rows, updatesUnavailable, complianceUnavailable, filter }) {
  if (updatesUnavailable) return <div className="i4-empty"><AlertCircle size={16} />Portfolio update source unavailable. No empty-reporting claim is being made.</div>;
  if (filter === 'parse' || filter === 'rules') return <div className="i4-empty"><AlertCircle size={16} />{filter === 'parse' ? 'No parse-review records are available from this source.' : 'Extraction rules are unavailable in this read-only collection.'}</div>;
  if (!rows.length) return <div className="i4-empty"><Inbox size={16} />No accessible portfolio companies are recorded for this investor.</div>;
  return <div className="i4-table-wrap"><table><thead><tr><th>Company</th><th>Arrived</th><th>State</th><th>What came in</th></tr></thead><tbody>{rows.map((row) => <tr key={row.project_id} data-testid={`row-investor-update-${row.project_id}`}><td><strong>{row.project?.name || `Startup ${row.project_id}`}</strong><small>{row.project?.stage || 'Stage not recorded'}</small></td><td>{row.arrived ? dateLabel(row.arrived) : '—'}{row.update && !row.current && !complianceUnavailable && <small>Last stored update: {dateLabel(row.update.submitted_at || row.update.updated_at)}</small>}</td><td><span className={`ip2-state is-${row.status.toLowerCase().replace(/\s+/g, '-')}`}>{row.status}</span></td><td>{row.update ? <><strong>{row.update.title || 'Untitled update'}</strong><small>{kpiText(row.update) || 'No KPI values recorded'}</small></> : <span className="ip2-muted">{complianceUnavailable ? 'Cadence status unavailable' : 'No current update recorded'}</span>}</td></tr>)}</tbody></table></div>;
}
function Stat({ label, value, note, muted }) { return <article className={`i4-stat${muted ? ' ip2-muted-stat' : ''}`}><div><span>{label}</span><b>{value}</b><small>{note}</small></div></article>; }
function UpdatesRail({ rows, unavailable }) { return <aside className="i4-rail" aria-label="Portfolio assistance"><div className="i4-rail-label">Worker AI · Portfolio</div><section><strong>Read-only update feed</strong><p>Source-preserved KPI values and narratives are shown without parsing, editing, chasing, or submitting.</p></section><section className="i4-rail-accent"><strong>Advisor fills the blanks</strong><p>Any extraction or follow-up proposal remains off on IP2.</p></section><div className="i4-rail-label">Feed coverage</div><section><strong>{unavailable.updates ? 'Update source unavailable' : `${rows.length} accessible company records`}</strong><p>{unavailable.compliance ? 'Cadence compliance unavailable.' : 'Current-period reporting status is read from cadence compliance.'}</p></section><section><strong>Parse review</strong><p>No parse-review or extraction-rule fields are returned by the source.</p></section><div className="i4-rail-trust"><span>Screened</span> Nothing is sent to a founder from this page.</div></aside>; }
function Skeleton() { return <div className="i4-skeleton" aria-busy="true"><i /><i /><i /><i /></div>; }