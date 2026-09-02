import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Database, Download, FileText, Filter, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderBuildKpi.css';

const FIELDS = [
  { key: 'mrr', label: 'MRR', unit: '$' },
  { key: 'arr', label: 'ARR', unit: '$' },
  { key: 'cac', label: 'CAC', unit: '$' },
  { key: 'ltv', label: 'LTV', unit: '$' },
  { key: 'monthly_churn_pct', label: 'Monthly churn', unit: '%' },
  { key: 'active_users', label: 'Active users', unit: '' },
  { key: 'new_users', label: 'New users', unit: '' },
];

const formatValue = (value, unit) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (unit === '$') return `$${number.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (unit === '%') return `${number.toFixed(1)}%`;
  if (unit === 'mo') return `${number.toFixed(1)} mo`;
  return number.toLocaleString();
};

const formatDate = (value, options = { month: 'short', year: 'numeric' }) => {
  if (!value) return 'Date not recorded';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, options).format(date);
};

const dateRange = (snapshots) => {
  if (!snapshots.length) return 'No dates recorded';
  const dates = snapshots.map((snapshot) => snapshot.snapshot_date).filter(Boolean).sort();
  return dates.length === 1 ? formatDate(dates[0]) : `${formatDate(dates[dates.length - 1])} – ${formatDate(dates[0])}`;
};

export default function FounderBuildKpi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(requestedId ? Number(requestedId) : null);
  const [snapshots, setSnapshots] = useState([]);
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState('latest');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const available = (await api.listProjects()) || [];
      setProjects(available);
      const requested = Number(requestedId);
      const chosen = available.find((project) => project.id === requested) || available[0];
      setProjectId(chosen?.id || null);
      if (!chosen) {
        setSnapshots([]);
        setSummary(null);
        setStatus('empty');
        return;
      }
      if (String(chosen.id) !== requestedId) {
        setSearchParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true });
      }
      const [metrics, derived] = await Promise.all([
        api.listMetricsSnapshots(chosen.id),
        api.metricsSummary(chosen.id).catch(() => null),
      ]);
      setSnapshots(metrics?.snapshots || []);
      setSummary(derived);
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The KPI ledger could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);
  const orderedSnapshots = useMemo(() => [...snapshots].sort((a, b) => String(b.snapshot_date || '').localeCompare(String(a.snapshot_date || '')) || (b.id || 0) - (a.id || 0)), [snapshots]);
  const latest = orderedSnapshots[0] || null;
  const latestTracked = FIELDS.filter((field) => latest?.[field.key] !== null && latest?.[field.key] !== undefined && latest?.[field.key] !== '').length;
  const trackedFields = FIELDS.filter((field) => orderedSnapshots.some((snapshot) => snapshot[field.key] !== null && snapshot[field.key] !== undefined && snapshot[field.key] !== '')).length;
  const visibleSnapshots = period === 'six' ? orderedSnapshots.slice(0, 6) : period === 'missing' ? orderedSnapshots.filter((snapshot) => FIELDS.some((field) => snapshot[field.key] === null || snapshot[field.key] === undefined || snapshot[field.key] === '')) : orderedSnapshots;
  const displayed = visibleSnapshots[0] || latest;
  const selectedMetricRows = [
    ...FIELDS.map((field) => ({ ...field, value: displayed?.[field.key], source: displayed?.source || null })),
    { key: 'runway_months', label: 'Runway', unit: 'mo', value: summary?.runway_months, source: summary?.runway_months != null ? 'Derived' : null },
  ];

  const linkFor = (path) => `${path}${projectId ? `?project_id=${projectId}` : ''}`;
  const selectProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setSearchParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return (
    <main className="fb-kpi" data-testid="founder-build-kpi">
      <div className="fb-kpi-shell">
        <section className="fb-kpi-main">
          <header className="fb-kpi-header">
            <div className="fb-kpi-crumb"><Link to="/execution" data-testid="link-kpi-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>KPI entry</strong></div>
            <div className="fb-kpi-title-row">
              <div><p className="fb-kpi-kicker">Founder / Build</p><h1>KPI entry</h1><p className="fb-kpi-subtitle">Bulk entry, imports, metric definitions, targets and history from the selected startup's stored ledger.</p></div>
              {projects.length > 1 && <label className="fb-kpi-picker"><span>Startup</span><select data-testid="select-kpi-project" value={projectId || ''} onChange={(event) => selectProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            </div>
            <nav className="fb-kpi-zone-nav" aria-label="Build sections">
              <Link to={linkFor('/build/this-week')}>This week</Link>
              <Link to={linkFor('/build/board')}>Board</Link>
              <Link to={linkFor('/build/roadmap')}>Roadmap</Link>
              <Link to={linkFor('/build/cadence')}>Cadence</Link>
              <Link to={linkFor('/build/kpi')} className="is-active" data-testid="link-kpi-zone">KPI entry</Link>
            </nav>
          </header>

          {status === 'error' && <div className="fb-kpi-alert" role="alert" data-testid="status-kpi-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-kpi"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <KpiSkeleton />}
          {status === 'empty' && <EmptyKpi />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-kpi-context"><div><span className="fb-kpi-label">Selected startup</span><strong data-testid="text-kpi-project">{selectedProject.name || 'Startup name not recorded'}</strong><span>{selectedProject.sector || 'Sector not recorded'}</span></div><div className="fb-kpi-context-right"><span className="fb-kpi-label">Ledger coverage</span><strong>{dateRange(orderedSnapshots)}</strong><span>{orderedSnapshots.length} stored snapshot{orderedSnapshots.length === 1 ? '' : 's'}</span></div></div>
              <div className="fb-kpi-stat-strip">
                <Stat label="Months on record" value={orderedSnapshots.length || 'Unavailable'} note={orderedSnapshots.length ? dateRange(orderedSnapshots) : 'No snapshots recorded'} />
                <Stat label="Metrics tracked" value={trackedFields ? `${trackedFields}` : 'Unavailable'} note={trackedFields ? `${FIELDS.length} supported fields` : 'No metric values recorded'} />
                <Stat label="Missing cells" value={latest ? `${FIELDS.length - latestTracked}` : 'Unavailable'} note={latest ? 'In latest snapshot' : 'No latest snapshot'} muted={!latest} />
                <Stat label="Against target" value="Unavailable" note="Targets are not stored in this source" muted />
              </div>
              <section className="fb-kpi-card fb-kpi-ledger">
                <div className="fb-kpi-card-head"><div><Database size={16} /><h2>{displayed ? `${formatDate(displayed.snapshot_date, { month: 'long', year: 'numeric' })} · entry` : 'Metric entry'}</h2></div><span>{displayed?.source ? `${displayed.source} · source shown per metric` : 'Source not recorded'}</span></div>
                <div className="fb-kpi-toolbar"><div className="fb-kpi-filters"><Filter size={13} /><button type="button" className={period === 'latest' ? 'is-selected' : ''} onClick={() => setPeriod('latest')}>Latest</button><button type="button" className={period === 'six' ? 'is-selected' : ''} onClick={() => setPeriod('six')}>Last 6</button><button type="button" className={period === 'all' ? 'is-selected' : ''} onClick={() => setPeriod('all')}>All {orderedSnapshots.length || 0}</button><button type="button" className={period === 'missing' ? 'is-selected' : ''} onClick={() => setPeriod('missing')}>Missing only</button></div><div className="fb-kpi-actions"><span className="fb-kpi-action-disabled"><FileText size={13} /> Definitions unavailable</span><Link to={`/build/metrics${projectId ? `?project_id=${projectId}` : ''}`} className="fb-kpi-editor-link"><Download size={13} /> Open editor</Link></div></div>
                {displayed ? <div className="fb-kpi-table-wrap"><table><thead><tr><th>Metric</th><th>Value</th><th>Target</th><th>Vs target</th><th>Source</th></tr></thead><tbody>{selectedMetricRows.map((row) => <KpiRow key={row.key} row={row} />)}</tbody></table></div> : <div className="fb-kpi-inline-empty"><Database size={18} /><div><strong>No KPI snapshots are recorded.</strong><p>Open the existing editor to enter the first dated snapshot for this startup.</p><Link to={`/build/metrics${projectId ? `?project_id=${projectId}` : ''}`}>Open KPI editor</Link></div></div>}
                <p className="fb-kpi-note">Values and sources come from the stored metric snapshot. Targets, target variance, cash/burn fields, and metric definitions are not returned by the current source, so this ledger does not infer them.</p>
              </section>
              <div className="fb-kpi-lower-grid"><HistoryCard snapshots={visibleSnapshots} total={orderedSnapshots.length} /><CoverageCard latest={latest} summary={summary} /></div>
            </>
          )}
        </section>
        <PageRail project={selectedProject} snapshotCount={orderedSnapshots.length} />
      </div>
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-kpi-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function KpiRow({ row }) { return <tr data-testid={`row-kpi-${row.key}`}><td><strong>{row.label}</strong><small>{row.key === 'runway_months' ? 'Server-derived summary' : 'Stored snapshot field'}</small></td><td className={row.value === null || row.value === undefined ? 'is-empty' : ''}>{formatValue(row.value, row.unit)}</td><td className="is-empty">Not recorded</td><td className="is-empty">—</td><td><span className={`fb-kpi-source ${row.source === 'stripe' ? 'source-stripe' : row.source === 'Derived' ? 'source-derived' : ''}`}>{row.source ? row.source : 'Not recorded'}</span></td></tr>; }
function HistoryCard({ snapshots, total }) { return <section className="fb-kpi-card"><div className="fb-kpi-card-head"><div><Database size={16} /><h2>Snapshot history</h2></div><span>{total} total</span></div>{snapshots.length ? <div className="fb-kpi-history">{snapshots.slice(0, 6).map((snapshot) => <div className="fb-kpi-history-row" key={snapshot.id}><span>{formatDate(snapshot.snapshot_date)}</span><strong>{snapshot.source || 'Not recorded'}</strong><span>{FIELDS.filter((field) => snapshot[field.key] !== null && snapshot[field.key] !== undefined && snapshot[field.key] !== '').length} fields populated</span></div>)}</div> : <p className="fb-kpi-muted-copy">No snapshots match this filter.</p>}<p className="fb-kpi-note">History is read-only here. Use the editor for manual entry or imports.</p></section>; }
function CoverageCard({ latest, summary }) { return <section className="fb-kpi-card"><div className="fb-kpi-card-head"><div><CheckCircle2 size={16} /><h2>Ledger coverage</h2></div><span>Truthful fields only</span></div><div className="fb-kpi-coverage-row"><span>Latest recorded snapshot</span><strong>{latest ? formatDate(latest.snapshot_date) : 'Unavailable'}</strong></div><div className="fb-kpi-coverage-row"><span>Server-derived runway</span><strong>{formatValue(summary?.runway_months, 'mo')}</strong></div><p className="fb-kpi-note">Runway appears only when the server can derive it from its available records. No cash, burn, or target value is filled in from assumptions.</p></section>; }
function PageRail({ project, snapshotCount }) {
  return <WorkerRail
    workspace="Build"
    className="fb-kpi-rail"
    stance="Manual ledger view"
    note="This page reads stored metric snapshots. It does not write entries, sync Stripe, or explain a variance automatically."
    coverage={[project ? `${snapshotCount} stored snapshot${snapshotCount === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? 'Metric values are available for review.' : 'Select a startup to read its ledger.'}
    unavailable={[['Target comparison', 'No target source is connected.'], ['AI annotations', 'No automated explanations or writes are enabled on this read-only surface.']]}
    footer="Read-only ledger · edit through KPI editor"
  />;
}
function EmptyKpi() { return <div className="fb-kpi-empty" data-testid="empty-kpi"><Database size={24} /><h2>No startup is available</h2><p>This founder KPI ledger is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function KpiSkeleton() { return <div className="fb-kpi-loading" data-testid="status-kpi-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }