import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ChevronRight, Crosshair, RefreshCw, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowFocus.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { COUNT_KEYS, PCT_KEYS, metricLabel, readTarget } from '../../lib/metricTargets';

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
/**
 * `metricValue` stays HERE because it is the only piece of the target vocabulary
 * that needs this page's own formatters — `moneyValue` and `numberValue` above,
 * which the snapshot table also uses. The key sets that decide which formatter
 * applies, and the judgement itself, live in `lib/metricTargets.js` so they can
 * be run by a test; this repo already carries three copies of one CSV escaper
 * that disagree, and a second money formatter would be the next one.
 */
const metricValue = (key, value) => {
  if (value == null || !Number.isFinite(Number(value))) return 'Not recorded';
  if (PCT_KEYS.has(key)) return `${Number(value)}%`;
  if (COUNT_KEYS.has(key)) return numberValue(value);
  return moneyValue(value);
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
  const [targets, setTargets] = useState([]);
  const [targetKeys, setTargetKeys] = useState({});
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
      if (!selected) { setSnapshots([]); setTargets([]); return; }
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
      // SEPARATE FROM THE SNAPSHOTS, AND A FAILURE HERE IS NOT A FAILURE THERE.
      // The two reads answer different questions, and a founder whose targets
      // are unreachable should still see the month's numbers rather than an
      // error where the log was. So this one keeps its own state and never
      // touches `error` — the Targets view says it for itself.
      try {
        const response = await api.listMetricTargets(selected.id);
        setTargets(asList(response, 'items', 'targets'));
        setTargetKeys(response?.keys && typeof response.keys === 'object' ? response.keys : {});
      } catch {
        setTargets([]); setTargetKeys({});
      }
    } catch (cause) {
      setProject(null); setSnapshots([]); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const latest = snapshots[0] || null;
  const query = project?.id ? `?project_id=${project.id}` : '';
  const read = useMemo(() => targets.map((t) => readTarget(t, latest)), [targets, latest]);
  const metCount = read.filter((t) => t.met === true).length;
  const measured = read.filter((t) => t.met !== null).length;
  const selectedRows = useMemo(() => {
    // The Targets view is not a slice of the snapshot log — it is a different
    // table, one row per plan number. Returning the log's rows here would let
    // the zone's CSV export write a snapshot file under a Targets heading.
    if (view === 'targets') return [];
    if (view === 'six-months') {
      const cutoff = Date.now() - (183 * 24 * 60 * 60 * 1000);
      return snapshots.filter((row) => !dateValue(row.snapshot_date) || dateValue(row.snapshot_date).getTime() >= cutoff);
    }
    return snapshots.slice(0, 1);
  }, [snapshots, view]);
  const current = latest?.mrr != null ? `${moneyValue(latest.mrr)} MRR` : latest?.active_users != null ? `${numberValue(latest.active_users)} active users` : latest ? 'Snapshot recorded' : 'Not recorded';
  const nav = [['Focus', `/grow/focus${query}`], ['Customers', `/grow/customers${query}`], ['Talent', `/grow/talent${query}`], ['Brand', `/grow/brand${query}`], ['Capital match', `/grow/capital-match${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-focus" data-testid="founder-grow-focus"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-focus-crumb"><Link to={`/build/team${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Focus</b></div><div><h1>This month&apos;s focus</h1><p>The month&apos;s metric, targets, and experiment log.</p></div>{projects.length > 1 && <label className="fg-focus-picker"><span>Startup</span><select data-testid="select-grow-focus-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-focus-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Focus' ? 'is-active' : ''}>{label}</Link>)}</nav>
    <ZoneToolbar
              filters={founderZoneFilters('grow/focus', { value: view, onChange: setView, counts: { targets: read.length } })}
              actions={founderZoneActions('grow/focus', { query, view: { scope: project?.name, header: ['Snapshot', 'MRR', 'ARR', 'Active users', 'New users', 'Churn %', 'Source'], rows: selectedRows, cells: (r) => [r.snapshot_date, r.mrr, r.arr, r.active_users, r.new_users, r.monthly_churn_pct, r.source] } })}
            /></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-focus-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <FocusSkeleton /> : !project ? <EmptyFocus /> : <FocusContent project={project} latest={latest} snapshots={snapshots} selectedRows={selectedRows} view={view} setView={setView} current={current} query={query} targets={read} targetKeys={targetKeys} onSaved={load} />}
  </div><FocusRail project={project} snapshots={snapshots} latest={latest} targets={read} /></div></main>;
}

function FocusContent({ project, latest, snapshots, selectedRows, view, setView, current, query, targets, targetKeys, onSaved }) {
  return <div className="a5-sections"><div className="fg-focus-context"><div><span>Selected startup</span><strong data-testid="text-grow-focus-project">{safeText(project.name)}</strong></div><div><span>Metric source</span><strong>{snapshots.length ? 'Stored metric snapshots' : 'Unavailable'}</strong></div></div>
        {/* Its four tabs are the zone header's now. Two of them — Experiments
        and Targets — had no store behind them and rendered an Unavailable
        panel once clicked; they state their reason in the row instead, so
        the reader learns it without having to try. */}
    <div className="fg-focus-tabs"><div className="fg-focus-actions"><Link to={`/build/metrics${query}`} data-testid="link-open-grow-metrics"><BarChart3 size={13} /> Open metrics</Link></div></div>
    <div className="fg-focus-stats"><Stat label="Current" value={current} note={latest ? `Snapshot ${formatDate(latest.snapshot_date)}` : 'No metric snapshot recorded'} />
      {/* THE TARGET TILE IS THE STORE'S NOW. It read "Not recorded · No target
      source connected" on every account for twenty-one migrations, because
      `metric_targets` had neither a reader nor a writer. With a target set it
      counts the ones met; with none it says no target is SET, which is a fact
      about this project rather than about the product. */}
      <Stat
        label="Target"
        value={read.length ? `${metCount} of ${measured || read.length} met` : 'None set'}
        note={read.length
          ? (measured < read.length ? `${read.length - measured} not measured by the latest snapshot` : `Against ${latest ? formatDate(latest.snapshot_date) : 'no snapshot'}`)
          : 'Set one in the Targets view'}
        muted={!read.length}
      /><Stat label="Experiments" value="Unavailable" note="No experiment log source connected" muted /><Stat label="Moved the metric" value="Not recorded" note="No experiment effects are claimed" muted /></div>
    {view === 'targets'
      ? <section className="a5-card fg-focus-log"><Head icon={Crosshair} title="Targets" meta={latest ? `Read against ${formatDate(latest.snapshot_date)}` : 'No snapshot to read against yet'} /><TargetsPanel project={project} targets={targets} targetKeys={targetKeys} latest={latest} onSaved={onSaved} /></section>
      : <section className="a5-card fg-focus-log"><Head icon={Target} title="Metric snapshot log" meta={view === 'latest' ? 'Latest stored record' : 'Snapshots returned from the last six months'} /><SnapshotTable rows={selectedRows} latest={latest} /></section>}
    <section className="a5-focus fg-focus-read"><div className="a5-head"><div><CheckCircle2 size={15} /><h2>Read this month honestly</h2></div><span>Source-derived</span></div><p>{latest ? `The latest stored snapshot is ${formatDate(latest.snapshot_date)}. ${latest.mrr != null ? `MRR is ${moneyValue(latest.mrr)}.` : latest.active_users != null ? `Active users are ${numberValue(latest.active_users)}.` : 'The snapshot does not include a primary metric value.'} No target or experiment effect is inferred from this record.` : 'There is no stored metric snapshot for this startup, so current performance, targets, and experiment effects remain unavailable.'}</p><Link className="a5-link" to={`/build/metrics${query}`}>Open the metrics composer <ChevronRight size={14} /></Link></section>
  </div>;
}
function SnapshotTable({ rows, latest }) {
  if (!rows.length) return <div className="a5-empty"><Target size={18} /><div><b>{latest ? 'No snapshots match this view.' : 'No metric snapshots are recorded.'}</b><p>FG1 only displays stored project metrics.</p></div></div>;
  return <div className="fg-focus-table-wrap"><table><thead><tr><th>Snapshot</th><th>MRR / ARR</th><th>Active users</th><th>New users</th><th>Churn</th><th>Effect on metric</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td><strong>{formatDate(row.snapshot_date)}</strong><small>{safeText(row.source, 'Source not recorded')}</small></td><td>{row.mrr != null ? `${moneyValue(row.mrr)} / ${moneyValue(row.arr)}` : row.arr != null ? moneyValue(row.arr) : 'Not recorded'}</td><td>{numberValue(row.active_users)}</td><td>{numberValue(row.new_users)}</td><td>{row.monthly_churn_pct != null ? `${row.monthly_churn_pct}%` : 'Not recorded'}</td><td><span className="fg-focus-pill">Not claimed</span></td></tr>)}</tbody></table></div>;
}
/**
 * The plan numbers, read against the latest snapshot, and the form that sets one.
 *
 * WHY THE FORM IS HERE AND NOT IN THE ZONE HEADER. A target is about a metric,
 * and the picker has to name one — which is a choice the header row has nowhere
 * to put. `zoneActionBuilder`'s own note says the same thing about Partner's
 * `Edit fit rules`: "which rule you mean is the first thing an edit needs, and a
 * header control cannot say it."
 *
 * MET, MISSED, AND NOT MEASURED ARE THREE STATES. The third is the one a
 * comparison would swallow: a target on a metric the latest snapshot does not
 * carry is not a miss, and colouring it as one would tell a founder they are
 * behind on a number nobody recorded. `readTarget` returns `met: null` for it
 * and this table prints that as its own word.
 */
function TargetsPanel({ project, targets, targetKeys, latest, onSaved }) {
  const keys = Object.keys(targetKeys || {});
  const [metricKey, setMetricKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function save(event) {
    event.preventDefault();
    if (!project?.id || !metricKey || value === '') return;
    setBusy(true); setSaveError('');
    try {
      await api.setMetricTarget(project.id, { metric_key: metricKey, target_value: Number(value) });
      setMetricKey(''); setValue('');
      await onSaved?.();
    } catch (cause) {
      setSaveError(cause?.message || 'The target could not be saved.');
    } finally { setBusy(false); }
  }

  async function clear(key) {
    if (!project?.id) return;
    setBusy(true); setSaveError('');
    try {
      await api.setMetricTarget(project.id, { metric_key: key, target_value: null });
      await onSaved?.();
    } catch (cause) {
      setSaveError(cause?.message || 'The target could not be cleared.');
    } finally { setBusy(false); }
  }

  return <div className="fg-focus-targets">
    {saveError && <p className="fg-focus-target-error" role="alert" data-testid="status-grow-target-error">{saveError}</p>}
    {/* The picker's options ARE the route's `keys`. A hardcoded list here could
        offer a metric the write refuses, which is a form whose own dropdown
        produces a 400. When the read has not answered, there is nothing honest
        to offer, so the form is absent rather than empty. */}
    {keys.length > 0 && <form className="fg-focus-target-form" onSubmit={save} data-testid="form-grow-target">
      <label><span>Metric</span>
        <select data-testid="select-grow-target-metric" value={metricKey} onChange={(e) => setMetricKey(e.target.value)} required>
          <option value="">Choose a metric</option>
          {keys.map((key) => <option key={key} value={key}>{metricLabel(key)}{targetKeys[key] === 'down' ? ' (lower is better)' : ''}</option>)}
        </select>
      </label>
      <label><span>Target</span>
        <input data-testid="input-grow-target-value" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Plan number" required />
      </label>
      <button type="submit" data-testid="button-grow-target-save" disabled={busy || !metricKey || value === ''}>
        {busy ? 'Saving…' : 'Set target'}
      </button>
    </form>}

    {!targets.length
      ? <div className="a5-empty"><Crosshair size={18} /><div><b>No target is set for this startup.</b><p>A target is one plan number per metric, compared against every snapshot in the period.</p></div></div>
      : <div className="fg-focus-table-wrap"><table data-testid="table-grow-targets"><thead><tr><th>Metric</th><th>Target</th><th>Latest</th><th>Status</th><th /></tr></thead><tbody>
        {targets.map((t) => <tr key={t.metric_key}>
          <td><strong>{metricLabel(t.metric_key)}</strong><small>{t.label || (t.direction === 'down' ? 'Lower is better' : 'Higher is better')}</small></td>
          <td>{metricValue(t.metric_key, t.target_value)}</td>
          <td>{t.actual == null ? 'Not recorded' : metricValue(t.metric_key, t.actual)}</td>
          <td><span className={`fg-focus-pill ${t.met === true ? 'is-met' : t.met === false ? 'is-missed' : ''}`}>
            {t.met === null ? 'Not measured' : t.met ? 'Met' : 'Behind'}
          </span></td>
          <td><button type="button" className="fg-focus-target-clear" data-testid={`button-grow-target-clear-${t.metric_key}`} onClick={() => clear(t.metric_key)} disabled={busy}>Clear</button></td>
        </tr>)}
      </tbody></table></div>}

    {/* Said once, in the table's own footer, rather than as a status on every
        untouched row: the comparison is only ever as current as the snapshot. */}
    <p className="fg-focus-target-note">{latest
      ? `Status is read against the snapshot of ${formatDate(latest.snapshot_date)}. A metric that snapshot does not carry reads "Not measured", not "Behind".`
      : 'No snapshot is recorded yet, so no target can be read against one.'}</p>
  </div>;
}

function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-focus-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
/**
 * "Target tracking · No target or metric-goal source is connected" left this
 * rail together with the store that made it true. `metric_targets` has both ends
 * now, so the line would be a false claim about the product. Targets moved up
 * into `coverage`, where a count of zero is a fact about THIS project rather
 * than a capability the platform has not got — which is the distinction the
 * `unavailable` list exists to draw.
 */
function FocusRail({ project, snapshots, latest, targets }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only analytics"
    note="This rail summarizes stored metrics and targets for the selected startup. It does not create experiments or claim an experiment moved a metric."
    coverage={[project ? `${snapshots.length} metric snapshot${snapshots.length === 1 ? '' : 's'}` : 'No project selected', latest ? `Latest ${formatDate(latest.snapshot_date)}` : 'Current metric not recorded', `${targets.length} target${targets.length === 1 ? '' : 's'} set`]}
    unavailable={[['Experiment outcomes', 'No experiment log is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function FocusSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-focus-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyFocus() { return <div className="a5-empty fg-focus-empty"><Target size={20} /><div><b>No startup is available.</b><p>Focus is scoped to an authenticated startup and its stored metrics.</p></div></div>; }