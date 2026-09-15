import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Database, Download, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderBuildKpi.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { metricLabel, readTarget } from '../../lib/metricTargets';
import { DefinitionsDialog, ImportCsvDialog } from './KpiDialogs';

/**
 * Every metric column `project_metrics` has, which was SEVEN of twelve.
 *
 * `net_burn`, `cash_balance`, `headcount`, `nrr_pct` and `paying_accounts` were
 * missing, and three of them are rows the canvas's own table draws (Net burn,
 * Runway, Headcount). Migration 173 added them, migration 249 carried them onto
 * the new table, `progress.ts`'s POST has always accepted them — the ledger simply
 * did not list them, so a founder who had entered a burn figure could not see it
 * here and "Missing cells" counted out of seven.
 */
/**
 * Every metric column `project_metrics` has, with the unit it is printed in.
 *
 * THE LABELS COME FROM `lib/metricTargets`, NOT FROM HERE. This list used to carry
 * its own twelve strings beside `METRIC_LABELS`'s twelve, for the same twelve
 * keys — two copies that agreed today and would not agree the first time one was
 * reworded. The unit stays local because it is this page's concern: the targets
 * module decides what a metric is CALLED, this one decides how a figure is drawn.
 *
 * IT WAS SEVEN OF TWELVE. `net_burn`, `cash_balance`, `headcount`, `nrr_pct` and
 * `paying_accounts` were missing, and three of them are rows the canvas's own
 * table draws (Net burn, Runway, Headcount). Migration 173 added them, migration
 * 249 carried them onto the new table, `progress.ts`'s POST has always accepted
 * them — the ledger simply did not list them, so a founder who had entered a burn
 * figure could not see it here and "Missing cells" counted out of seven.
 */
const FIELDS = [
  { key: 'mrr', unit: '$' },
  { key: 'arr', unit: '$' },
  { key: 'cac', unit: '$' },
  { key: 'ltv', unit: '$' },
  { key: 'monthly_churn_pct', unit: '%' },
  { key: 'active_users', unit: '' },
  { key: 'new_users', unit: '' },
  { key: 'net_burn', unit: '$' },
  { key: 'cash_balance', unit: '$' },
  { key: 'headcount', unit: '' },
  { key: 'nrr_pct', unit: '%' },
  { key: 'paying_accounts', unit: '' },
].map((f) => ({ ...f, label: metricLabel(f.key) }));

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
  const [targets, setTargets] = useState([]);
  const [targetKeys, setTargetKeys] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [definitionSources, setDefinitionSources] = useState(['manual']);
  const [dialog, setDialog] = useState(null); // 'definitions' | 'import'
  const [opError, setOpError] = useState('');
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
      // FOUR READS, AND ONLY THE FIRST MAY FAIL THE PAGE. A missing summary,
      // target set or definition set costs one card; a missing snapshot list means
      // there is no ledger to draw, which is the one state worth an error.
      const [metrics, derived, targetsRes, defsRes] = await Promise.all([
        api.listMetricsSnapshots(chosen.id),
        api.metricsSummary(chosen.id).catch(() => null),
        api.listMetricTargets(chosen.id).catch(() => null),
        api.listMetricDefinitions(chosen.id).catch(() => null),
      ]);
      setSnapshots(metrics?.snapshots || []);
      setSummary(derived);
      setTargets(targetsRes?.items || []);
      // The key list travels with the read so the definition picker offers exactly
      // what the write accepts — the convention #194's targets editor set.
      setTargetKeys(targetsRes?.keys || FIELDS.map((f) => f.key));
      setDefinitions(defsRes?.items || []);
      setDefinitionSources(defsRes?.sources || ['manual']);
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The KPI ledger could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  /** After a write: re-read the three sets an op can change, never the whole page. */
  const reload = useCallback(async () => {
    if (!projectId) return;
    const [metrics, defsRes, targetsRes] = await Promise.all([
      api.listMetricsSnapshots(projectId).catch(() => null),
      api.listMetricDefinitions(projectId).catch(() => null),
      api.listMetricTargets(projectId).catch(() => null),
    ]);
    if (metrics?.snapshots) setSnapshots(metrics.snapshots);
    if (defsRes?.items) setDefinitions(defsRes.items);
    if (targetsRes?.items) setTargets(targetsRes.items);
  }, [projectId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);
  const orderedSnapshots = useMemo(() => [...snapshots].sort((a, b) => String(b.snapshot_date || '').localeCompare(String(a.snapshot_date || '')) || (b.id || 0) - (a.id || 0)), [snapshots]);
  const latest = orderedSnapshots[0] || null;
  const latestTracked = FIELDS.filter((field) => latest?.[field.key] !== null && latest?.[field.key] !== undefined && latest?.[field.key] !== '').length;
  const trackedFields = FIELDS.filter((field) => orderedSnapshots.some((snapshot) => snapshot[field.key] !== null && snapshot[field.key] !== undefined && snapshot[field.key] !== '')).length;
  // All four of the canvas's periods are named here rather than three of them
  // plus a fall-through. `all` used to be the fall-through, which meant a
  // mistyped period quietly returned every month on record — the widest answer
  // is the worst default for a mistake, and it looks like a working filter.
  const PERIODS = {
    latest: (rows) => rows.slice(0, 1),
    six: (rows) => rows.slice(0, 6),
    all: (rows) => rows,
    missing: (rows) => rows.filter((snapshot) => FIELDS.some((field) => snapshot[field.key] === null || snapshot[field.key] === undefined || snapshot[field.key] === '')),
  };
  const visibleSnapshots = (PERIODS[period] || PERIODS.latest)(orderedSnapshots);
  const displayed = visibleSnapshots[0] || latest;
  const targetByKey = useMemo(() => {
    const map = new Map();
    for (const t of targets) map.set(t.metric_key, t);
    return map;
  }, [targets]);
  const definitionByKey = useMemo(() => {
    const map = new Map();
    for (const d of definitions) map.set(d.metric_key, d);
    return map;
  }, [definitions]);

  /**
   * Each row: the stored value, the stored target, and the verdict between them.
   *
   * `readTarget` from `lib/metricTargets` does the comparison rather than a `>=`
   * here — migration 173 stores `direction` for one stated purpose, which is that
   * without it "the UI cannot tell whether being over the number is good news, and
   * would colour a burn overage green". Task #194 built the helper; this page
   * simply never read it, which is why the Target column said "Not recorded"
   * beside targets that were stored.
   */
  const selectedMetricRows = [
    ...FIELDS.map((field) => {
      const target = targetByKey.get(field.key) || null;
      const verdict = target && displayed ? readTarget(target, displayed) : null;
      return {
        ...field,
        value: displayed?.[field.key],
        source: displayed?.source || null,
        target,
        met: verdict?.met ?? null,
        definition: definitionByKey.get(field.key) || null,
      };
    }),
    // Runway is DERIVED from cash and burn, never typed — which is why it cannot
    // disagree with the two rows above it, and why it carries no target: a target
    // on a derived figure would be a target on the two inputs stated once removed.
    {
      key: 'runway_months', label: 'Runway', unit: 'mo',
      value: summary?.runway_months,
      source: summary?.runway_months != null ? 'Derived' : null,
      target: null, met: null,
      definition: definitionByKey.get('runway_months') || null,
    },
  ];

  /**
   * "Against target · 4 of 6" — the canvas's fourth stat, over stored rows.
   *
   * The denominator is targets that could be JUDGED, not targets that exist: a
   * target on a metric this month's snapshot left blank is neither met nor missed,
   * and counting it as missed would report a founder as off plan for a figure they
   * have not entered yet. `readTarget` returns `met: null` for exactly that, and
   * the difference is printed rather than folded away.
   */
  const targetVerdicts = useMemo(
    () => (displayed ? targets.map((t) => readTarget(t, displayed)) : []),
    [targets, displayed],
  );
  const judged = targetVerdicts.filter((v) => v.met !== null);
  const metCount = judged.filter((v) => v.met).length;

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
              <div><h1>KPI entry</h1><p className="fb-kpi-subtitle">Bulk entry, imports, metric definitions, targets and history from the selected startup's stored ledger.</p></div>
            </div>
            <nav className="fb-kpi-zone-nav" aria-label="Build sections">
              <Link to={linkFor('/build/this-week')}>This week</Link>
              <Link to={linkFor('/build/board')}>Board</Link>
              <Link to={linkFor('/build/roadmap')}>Roadmap</Link>
              <Link to={linkFor('/build/cadence')}>Cadence</Link>
              <Link to={linkFor('/build/kpi')} className="is-active" data-testid="link-kpi-zone">KPI entry</Link>
            </nav>
            <ZoneToolbar
              filters={founderZoneFilters('build/kpi', { value: period, onChange: setPeriod, counts: { all: orderedSnapshots.length } })}
              actions={founderZoneActions('build/kpi', {
                query: projectId ? `?project_id=${projectId}` : '',
                handlers: {
                  // Both need a venture. Disabled with a reason rather than
                  // absent: the artboard draws four ops and the reader sees four.
                  definitions: {
                    onClick: () => { setOpError(''); setDialog('definitions'); },
                    disabled: !projectId,
                    title: projectId ? undefined : 'Select a startup first — a definition belongs to one.',
                  },
                  importCsv: {
                    onClick: () => { setOpError(''); setDialog('import'); },
                    disabled: !projectId,
                    title: projectId ? undefined : 'Select a startup first — imported months belong to one.',
                  },
                },
              })}
            />
          </header>

          {status === 'error' && <div className="fb-kpi-alert" role="alert" data-testid="status-kpi-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-kpi"><RefreshCw size={13} /> Retry</button></div>}
          {opError && <div className="fb-kpi-alert" role="alert" data-testid="status-kpi-op-error"><AlertCircle size={16} /><span>{opError}</span></div>}
          {status === 'loading' && <KpiSkeleton />}
          {status === 'empty' && <EmptyKpi />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-kpi-context"><div><span className="fb-kpi-label">Selected startup</span><strong data-testid="text-kpi-project">{selectedProject.name || 'Startup name not recorded'}</strong><span>{selectedProject.sector || 'Sector not recorded'}</span></div><div className="fb-kpi-context-right"><span className="fb-kpi-label">Ledger coverage</span><strong>{dateRange(orderedSnapshots)}</strong><span>{orderedSnapshots.length} stored snapshot{orderedSnapshots.length === 1 ? '' : 's'}</span></div></div>
              <div className="fb-kpi-stat-strip">
                <Stat label="Months on record" value={orderedSnapshots.length || 'Unavailable'} note={orderedSnapshots.length ? dateRange(orderedSnapshots) : 'No snapshots recorded'} />
                <Stat label="Metrics tracked" value={trackedFields ? `${trackedFields}` : 'Unavailable'} note={trackedFields ? `${FIELDS.length} supported fields` : 'No metric values recorded'} />
                <Stat label="Missing cells" value={latest ? `${FIELDS.length - latestTracked}` : 'Unavailable'} note={latest ? 'In latest snapshot' : 'No latest snapshot'} muted={!latest} />
                {/* WAS `value="Unavailable"` WITH THE NOTE "Targets are not stored
                    in this source". That was false from the day #194 landed —
                    `metric_targets` has been stored and readable since migration
                    173 and given both ends by #194; this page just never read it.
                    A refusal beside a working store is the failure #193 was for. */}
                <Stat
                  label="Against target"
                  value={judged.length ? `${metCount} of ${judged.length}` : 'Not yet'}
                  note={targets.length
                    ? (judged.length
                      ? `${targets.length} target${targets.length === 1 ? '' : 's'} set${targets.length > judged.length ? ` · ${targets.length - judged.length} not measured this month` : ''}`
                      : 'No measured figure to compare this month')
                    : 'No target set'}
                  muted={!judged.length}
                />
              </div>
              <section className="fb-kpi-card fb-kpi-ledger">
                <div className="fb-kpi-card-head"><div><Database size={16} /><h2>{displayed ? `${formatDate(displayed.snapshot_date, { month: 'long', year: 'numeric' })} · entry` : 'Metric entry'}</h2></div><span>{displayed?.source ? `${displayed.source} · source shown per metric` : 'Source not recorded'}</span></div>
                <div className="fb-kpi-toolbar">
                  {/* The four period filters live in the zone header, where the
                      canvas puts them. "Definitions unavailable" USED TO SIT HERE
                      as a disabled chip — migration 251 stores them, so it is a
                      count and a way in instead of a refusal. */}
                  <div className="fb-kpi-actions">
                    <button
                      type="button"
                      className="fb-kpi-definitions-link"
                      data-testid="button-kpi-definitions"
                      onClick={() => { setOpError(''); setDialog('definitions'); }}
                    >
                      {definitions.length
                        ? `${definitions.length} definition${definitions.length === 1 ? '' : 's'} on record`
                        : 'Define a metric'}
                    </button>
                    <Link to={`/build/metrics${projectId ? `?project_id=${projectId}` : ''}`} className="fb-kpi-editor-link"><Download size={13} /> Open editor</Link>
                  </div>
                </div>
                {displayed ? <div className="fb-kpi-table-wrap"><table><thead><tr><th>Metric</th><th>Value</th><th>Target</th><th>Vs target</th><th>Source</th></tr></thead><tbody>{selectedMetricRows.map((row) => <KpiRow key={row.key} row={row} />)}</tbody></table></div> : <div className="fb-kpi-inline-empty"><Database size={18} /><div><strong>No KPI snapshots are recorded.</strong><p>Open the existing editor to enter the first dated snapshot for this startup.</p><Link to={`/build/metrics${projectId ? `?project_id=${projectId}` : ''}`}>Open KPI editor</Link></div></div>}
                {/* THIS SENTENCE NAMED FOUR THINGS AS ABSENT AND WAS WRONG ABOUT
                    ALL FOUR. Targets have been stored since migration 173 (both
                    ends built by #194), cash and burn are columns on
                    `project_metrics` this page was simply not listing, variance is
                    computed from the first two, and definitions land with migration
                    251. What is still true is the last clause, so that is what it
                    says now. */}
                <p className="fb-kpi-note">Values, sources, targets and definitions all come from stored records. Runway is derived from cash and burn by the server and never typed, which is why it cannot disagree with the two rows above it. Nothing on this page is inferred from an assumption.</p>
              </section>
              <div className="fb-kpi-lower-grid"><HistoryCard snapshots={visibleSnapshots} total={orderedSnapshots.length} /><CoverageCard latest={latest} summary={summary} /></div>
            </>
          )}
        </section>
        <PageRail project={selectedProject} snapshotCount={orderedSnapshots.length} />
      </div>

      {dialog === 'definitions' && (
        <DefinitionsDialog
          definitions={definitions}
          keys={targetKeys}
          sources={definitionSources}
          onClose={() => setDialog(null)}
          onSave={async (data) => { await api.setMetricDefinition(projectId, data); await reload(); }}
          onClear={async (key) => { await api.setMetricDefinition(projectId, { metric_key: key, definition: null }); await reload(); }}
        />
      )}
      {dialog === 'import' && (
        <ImportCsvDialog
          onClose={() => setDialog(null)}
          onRun={(data) => api.importMetricsCsv(projectId, data)}
          onDone={reload}
        />
      )}
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-kpi-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
/**
 * One ledger row: value, target, the gap, and where the figure came from.
 *
 * THE TARGET AND VARIANCE COLUMNS WERE HARD-CODED `Not recorded` AND `—`, which
 * was false from the day #194 stored the targets. `met` is tri-state and printed
 * as three different things: met, behind, or "not measured" — because behind the
 * plan and nothing-recorded-to-compare are different facts and a two-state render
 * would report every blank cell as a miss.
 */
function KpiRow({ row }) {
  const hasValue = row.value !== null && row.value !== undefined && row.value !== '';
  const gap = row.target && hasValue ? Number(row.value) - Number(row.target.target_value) : null;
  return (
    <tr data-testid={`row-kpi-${row.key}`}>
      <td>
        <strong>{row.label}</strong>
        <small>{row.key === 'runway_months' ? 'Server-derived summary' : 'Stored snapshot field'}</small>
        {/* A definition shows where it is read, not only in the dialog — the point
            of storing it is that the reader of the number sees what it counts. */}
        {row.definition && <em className="fb-kpi-row-definition" title={row.definition.definition}>{row.definition.definition}</em>}
      </td>
      <td className={hasValue ? '' : 'is-empty'}>{formatValue(row.value, row.unit)}</td>
      <td className={row.target ? '' : 'is-empty'}>
        {row.target ? formatValue(row.target.target_value, row.unit) : 'No target'}
      </td>
      <td className={row.met === null ? 'is-empty' : ''}>
        {row.met === null
          ? (row.target ? 'Not measured' : '—')
          : (
            <span className={row.met ? 'fb-kpi-verdict is-met' : 'fb-kpi-verdict is-off'}>
              {/* The SIGNED gap, with the direction's own reading of it. On a
                  `down` metric a positive gap is bad news, which is exactly what
                  migration 173 stores `direction` to make sayable. */}
              {gap === null ? (row.met ? 'On plan' : 'Off plan')
                : `${gap > 0 ? '+' : ''}${formatValue(gap, row.unit)}`}
            </span>
          )}
      </td>
      <td>
        <span className={`fb-kpi-source ${row.source === 'stripe' ? 'source-stripe' : row.source === 'Derived' ? 'source-derived' : row.source === 'csv' ? 'source-csv' : ''}`}>
          {row.source ? row.source : 'Not recorded'}
        </span>
      </td>
    </tr>
  );
}
function HistoryCard({ snapshots, total }) { return <section className="fb-kpi-card"><div className="fb-kpi-card-head"><div><Database size={16} /><h2>Snapshot history</h2></div><span>{total} total</span></div>{snapshots.length ? <div className="fb-kpi-history">{snapshots.slice(0, 6).map((snapshot) => <div className="fb-kpi-history-row" key={snapshot.id}><span>{formatDate(snapshot.snapshot_date)}</span><strong>{snapshot.source || 'Not recorded'}</strong><span>{FIELDS.filter((field) => snapshot[field.key] !== null && snapshot[field.key] !== undefined && snapshot[field.key] !== '').length} fields populated</span></div>)}</div> : <p className="fb-kpi-muted-copy">No snapshots match this filter.</p>}<p className="fb-kpi-note">History is read-only here. Use the editor for manual entry or imports.</p></section>; }
function CoverageCard({ latest, summary }) { return <section className="fb-kpi-card"><div className="fb-kpi-card-head"><div><CheckCircle2 size={16} /><h2>Ledger coverage</h2></div><span>Truthful fields only</span></div><div className="fb-kpi-coverage-row"><span>Latest recorded snapshot</span><strong>{latest ? formatDate(latest.snapshot_date) : 'Unavailable'}</strong></div><div className="fb-kpi-coverage-row"><span>Server-derived runway</span><strong>{formatValue(summary?.runway_months, 'mo')}</strong></div><p className="fb-kpi-note">Runway appears only when the server can derive it from its available records. No cash, burn, or target value is filled in from assumptions.</p></section>; }
function PageRail({ project, snapshotCount }) {
  return <WorkerRail
    workspace="Build"
    className="fb-kpi-rail"
    stance="Reads stored records"
    note="This page reads stored snapshots, targets and definitions. It does not invent a figure, fill a blank cell, or explain a variance automatically."
    coverage={[project ? `${snapshotCount} stored snapshot${snapshotCount === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? 'Metric values are available for review.' : 'Select a startup to read its ledger.'}
    unavailable={[
      // WAS `['Target comparison', 'No target source is connected.']`, which
      // stopped being true when #194 gave `metric_targets` both ends. The
      // comparison is on the page now; what is genuinely absent is the annotation.
      ['Variance explanation', 'Nothing here writes a reason for a figure being off plan — an explanation the platform invented is not one a founder can stand behind in a board meeting.'],
      ['AI annotations', 'No automated explanations or writes are enabled on this surface.'],
    ]}
    footer="Reads stored records · writes through the ops above"
  />;
}
function EmptyKpi() { return <div className="fb-kpi-empty" data-testid="empty-kpi"><Database size={24} /><h2>No startup is available</h2><p>This founder KPI ledger is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function KpiSkeleton() { return <div className="fb-kpi-loading" data-testid="status-kpi-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }