import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ChevronRight, RefreshCw, Sparkles, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { FounderWorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowFocus.css';

const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const safeText = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const dateValue = (value) => value ? new Date(value) : null;
const formatDate = (value) => {
  const date = dateValue(value);
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
    : 'Date not recorded';
};
const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : 'Not recorded';
const moneyValue = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
};
const latestFirst = (rows) => [...rows].sort((a, b) => {
  const left = dateValue(a.snapshot_date)?.getTime() || 0;
  const right = dateValue(b.snapshot_date)?.getTime() || 0;
  return right - left || Number(b.id || 0) - Number(a.id || 0);
});

export default function FounderGrowFocus() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [view, setView] = useState('latest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = asList(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; the requested metric source is still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project', unavailable_name: true } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setSnapshots([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await api.listMetricsSnapshots(selected.id);
        setSnapshots(latestFirst(asList(response, 'snapshots', 'items')));
      } catch (cause) {
        setSnapshots([]);
        setError(cause?.message || 'The metric snapshot source is unavailable.');
      }
    } catch (cause) {
      setProject(null); setSnapshots([]); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const latest = snapshots[0] || null;
  const query = project?.id ? `?project_id=${project.id}` : '';
  const selectedRows = useMemo(() => {
    if (view === 'six-months') {
      const cutoff = Date.now() - (183 * 24 * 60 * 60 * 1000);
      return snapshots.filter((row) => !dateValue(row.snapshot_date) || dateValue(row.snapshot_date).getTime() >= cutoff);
    }
    return view === 'latest' ? snapshots.slice(0, 1) : [];
  }, [snapshots, view]);
  const current = latest?.mrr != null ? `${moneyValue(latest.mrr)} MRR` : latest?.active_users != null ? `${numberValue(latest.active_users)} active users` : latest ? 'Snapshot recorded' : 'Not recorded';
  const nav = [['Focus', `/grow/focus${query}`], ['Customers', `/grow/customers${query}`], ['Talent', `/grow/talent${query}`], ['Brand', `/grow/brand${query}`], ['Capital match', `/grow/capital-match${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-focus" data-testid="founder-grow-focus"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-focus-crumb"><Link to={`/build/team${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Focus</b></div><span>Founder / Grow</span><div><h1>This month&apos;s focus</h1><p>The month&apos;s metric, targets, and experiment log.</p></div>{projects.length > 1 && <label className="fg-focus-picker"><span>Startup</span><select data-testid="select-grow-focus-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-focus-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Focus' ? 'is-active' : ''}>{label}</Link>)}</nav></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-focus-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <FocusSkeleton /> : !project ? <EmptyFocus /> : <FocusContent project={project} latest={latest} snapshots={snapshots} selectedRows={selectedRows} view={view} setView={setView} current={current} query={query} />}
  </div><FocusRail project={project} snapshots={snapshots} latest={latest} /></div></main>;
}

function FocusContent({ project, latest, snapshots, selectedRows, view, setView, current, query }) {
  return <div className="a5-sections"><div className="fg-focus-context"><div><span>Selected startup</span><strong data-testid="text-grow-focus-project">{safeText(project.name)}</strong></div><div><span>Metric source</span><strong>{snapshots.length ? 'Stored metric snapshots' : 'Unavailable'}</strong></div></div>
    <div className="fg-focus-tabs"><div>{[['latest', 'Latest'], ['six-months', 'Last 6 mo'], ['experiments', 'Experiments'], ['targets', 'Targets']].map(([key, label]) => <button type="button" className={view === key ? 'is-active' : ''} key={key} onClick={() => setView(key)}>{label}</button>)}</div><div className="fg-focus-actions"><Link to={`/build/metrics${query}`} data-testid="link-open-grow-metrics"><BarChart3 size={13} /> Open metrics</Link></div></div>
    <div className="fg-focus-stats"><Stat label="Current" value={current} note={latest ? `Snapshot ${formatDate(latest.snapshot_date)}` : 'No metric snapshot recorded'} /><Stat label="Target" value="Not recorded" note="No target source connected" muted /><Stat label="Experiments" value="Unavailable" note="No experiment log source connected" muted /><Stat label="Moved the metric" value="Not recorded" note="No experiment effects are claimed" muted /></div>
    <section className="a5-card fg-focus-log"><Head icon={view === 'experiments' ? Sparkles : Target} title={view === 'experiments' ? 'Experiment log' : view === 'targets' ? 'Metric targets' : 'Metric snapshot log'} meta={view === 'latest' ? 'Latest stored record' : view === 'six-months' ? 'Snapshots returned from the last six months' : 'Source unavailable'} />{view === 'experiments' || view === 'targets' ? <Unavailable view={view} /> : <SnapshotTable rows={selectedRows} latest={latest} />}</section>
    <section className="a5-focus fg-focus-read"><div className="a5-head"><div><CheckCircle2 size={15} /><h2>Read this month honestly</h2></div><span>Source-derived</span></div><p>{latest ? `The latest stored snapshot is ${formatDate(latest.snapshot_date)}. ${latest.mrr != null ? `MRR is ${moneyValue(latest.mrr)}.` : latest.active_users != null ? `Active users are ${numberValue(latest.active_users)}.` : 'The snapshot does not include a primary metric value.'} No target or experiment effect is inferred from this record.` : 'There is no stored metric snapshot for this startup, so current performance, targets, and experiment effects remain unavailable.'}</p><Link className="a5-link" to={`/build/metrics${query}`}>Open the metrics composer <ChevronRight size={14} /></Link></section>
  </div>;
}
function SnapshotTable({ rows, latest }) {
  if (!rows.length) return <div className="a5-empty"><Target size={18} /><div><b>{latest ? 'No snapshots match this view.' : 'No metric snapshots are recorded.'}</b><p>FG1 only displays stored project metrics.</p></div></div>;
  return <div className="fg-focus-table-wrap"><table><thead><tr><th>Snapshot</th><th>MRR / ARR</th><th>Active users</th><th>New users</th><th>Churn</th><th>Effect on metric</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td><strong>{formatDate(row.snapshot_date)}</strong><small>{safeText(row.source, 'Source not recorded')}</small></td><td>{row.mrr != null ? `${moneyValue(row.mrr)} / ${moneyValue(row.arr)}` : row.arr != null ? moneyValue(row.arr) : 'Not recorded'}</td><td>{numberValue(row.active_users)}</td><td>{numberValue(row.new_users)}</td><td>{row.monthly_churn_pct != null ? `${row.monthly_churn_pct}%` : 'Not recorded'}</td><td><span className="fg-focus-pill">Not claimed</span></td></tr>)}</tbody></table></div>;
}
function Unavailable({ view }) { return <div className="a5-empty fg-focus-unavailable"><Sparkles size={18} /><div><b>{view === 'experiments' ? 'No experiment log source is connected.' : 'No target source is connected.'}</b><p>FG1 does not convert metric snapshots into experiments, wins, targets, or effect sizes.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-focus-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function FocusRail({ project, snapshots, latest }) {
  return <FounderWorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only analytics"
    note="This rail summarizes stored metrics for the selected startup. It does not create experiments, targets, or claims."
    coverage={[project ? `${snapshots.length} metric snapshot${snapshots.length === 1 ? '' : 's'}` : 'No project selected', latest ? `Latest ${formatDate(latest.snapshot_date)}` : 'Current metric not recorded']}
    unavailable={[['Experiment outcomes', 'No experiment log is connected.'], ['Target tracking', 'No target or metric-goal source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function FocusSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-focus-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyFocus() { return <div className="a5-empty fg-focus-empty"><Target size={20} /><div><b>No startup is available.</b><p>Focus is scoped to an authenticated startup and its stored metrics.</p></div></div>; }