import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, CircleDot, FileText, Filter, RefreshCw, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaiseStatus.css';

const asList = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const clean = (value) => String(value ?? '').trim();
const display = (value, fallback = 'Not recorded') => clean(value) || fallback;
const money = (value) => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Not recorded';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
};
const date = (value) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const stateText = (value) => display(value).replace(/[_-]/g, ' ');
const stateTone = (value) => {
  const normalized = clean(value).toLowerCase();
  if (['signed', 'filed', 'closed', 'done', 'passed', 'committed'].includes(normalized)) return 'good';
  if (['due', 'partial', 'in progress', 'active', 'contacted'].includes(normalized)) return 'warn';
  return 'open';
};

export default function FounderRaiseStatus() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(Number(requestedId) || null);
  const [records, setRecords] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('overview');
  const lastAutoLoad = useRef(null);

  const load = async () => {
    setLoading(true);
    const nextErrors = {};
    try {
      const listResponse = await api.listProjects();
      const available = asList(listResponse, 'items');
      const requested = Number(requestedId);
      const selected = available.find((item) => Number(item.id) === requested) || available[0];
      setProjects(available);
      setProjectId(selected?.id || null);
      if (!selected) {
        setRecords({});
        setLoading(false);
        return;
      }
      if (String(selected.id) !== requestedId) {
        setSearchParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(selected.id));
          return next;
        }, { replace: true });
      }
      const calls = {
        round: api.raiseRound(selected.id),
        prospects: api.raiseProspects(selected.id),
        legal: api.listDocuments(selected.id),
      };
      const results = await Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request]));
      const next = {};
      results.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1];
        else nextErrors[key] = result.reason?.message || 'Unavailable';
      });
      setRecords(next);
    } catch (cause) {
      nextErrors.projects = cause?.message || 'The project list is unavailable.';
      setRecords({});
    } finally {
      setErrors(nextErrors);
      setLoading(false);
    }
  };

  useEffect(() => {
    const key = requestedId || 'default';
    if (lastAutoLoad.current === key) return;
    lastAutoLoad.current = key;
    load();
  }, [requestedId]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const roundInfo = records.round || {};
  const round = roundInfo.round || null;
  const prospects = asList(records.prospects, 'items');
  const documents = asList(records.legal, 'documents');
  const rows = useMemo(() => [
    ...documents.map((document, index) => ({
      id: `document-${document.id || index}`,
      label: display(document.title || document.name || document.doc_type, 'Untitled legal document'),
      owner: display(document.owner_name || document.owner, 'Not recorded'),
      state: stateText(document.status),
      holds: display(document.holds_up || document.blocks || document.next_step, 'Not recorded'),
      source: 'Legal record',
    })),
    ...prospects.map((prospect, index) => ({
      id: `prospect-${prospect.id || index}`,
      label: display(prospect.name || prospect.investor_name || prospect.company, 'Unnamed investor prospect'),
      owner: display(prospect.owner_name || prospect.owner, 'Not recorded'),
      state: stateText(prospect.stage || prospect.status),
      holds: display(prospect.next_step || prospect.notes || prospect.holds_up, 'Not recorded'),
      source: 'Investor prospect',
    })),
  ], [documents, prospects]);
  const visibleRows = filter === 'blockers' ? rows.filter((row) => !['signed', 'filed', 'closed', 'done', 'passed', 'committed'].includes(row.state.toLowerCase())) : filter === 'investors' ? rows.filter((row) => row.source === 'Investor prospect') : rows;
  const target = round?.target_amount;
  const raised = roundInfo.raised;
  const coverage = target != null && Number(target) > 0 && Number.isFinite(Number(raised)) ? Math.min(100, Math.round(Number(raised) / Number(target) * 100)) : null;
  const query = projectId ? `?project_id=${projectId}` : '';
  const blockerCount = Array.isArray(roundInfo.blockers) ? roundInfo.blockers.length : (Number.isFinite(Number(roundInfo.blockers)) ? Number(roundInfo.blockers) : null);
  const openDate = round?.open_date || round?.opened_at || round?.start_date;

  const chooseProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setSearchParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return <main className="fr-status" data-testid="founder-raise-status">
    <div className="fr-status-shell">
      <section className="fr-status-main">
        <header className="fr-status-header">
          <div className="fr-status-crumb"><Link to="/raise/pitch" data-testid="link-status-back"><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Status</strong></div>
          <div className="fr-status-title-row"><div><p className="fr-status-kicker">Founder / Raise</p><h1>Raise war-room</h1><p className="fr-status-subtitle">Blockers, investor list, timeline and the pace that decides the close.</p></div>{projects.length > 1 && <label className="fr-status-picker"><span>Startup</span><select data-testid="select-status-project" value={projectId || ''} onChange={(event) => chooseProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          <nav className="fr-status-zone-nav" aria-label="Raise sections">
            <Link to={query ? `/raise/status${query}` : '/raise/status'} className="is-active" data-testid="link-status-zone">Status</Link>
            <Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><span className="fr-status-zone-disabled">Liquidity unavailable</span>
          </nav>
        </header>
        {(errors.projects || Object.keys(errors).length > 0) && <div className="fr-status-alert" role="alert" data-testid="status-raise-status-partial"><AlertCircle size={16} /><span>{errors.projects || 'Some selected-project raise records are unavailable.'}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <StatusSkeleton /> : errors.projects ? <UnavailableStatus onRetry={load} /> : !project ? <EmptyStatus /> : <StatusContent project={project} round={round} roundInfo={roundInfo} target={target} raised={raised} coverage={coverage} rows={visibleRows} allRows={rows} blockerCount={blockerCount} openDate={openDate} documents={documents} prospects={prospects} errors={errors} filter={filter} setFilter={setFilter} query={query} />}
      </section>
      <PageRail project={project} rows={rows} target={target} raised={raised} errors={errors} />
    </div>
  </main>;
}

function StatusContent({ project, round, roundInfo, target, raised, coverage, rows, allRows, blockerCount, openDate, documents, prospects, errors, filter, setFilter, query }) {
  return <div className="fr-status-content">
    <div className="fr-status-context"><div><span className="fr-status-label">Selected startup</span><strong data-testid="text-status-project">{display(project.name)}</strong><span>{display(project.sector, 'Sector not recorded')}</span></div><div className="fr-status-context-right"><span className="fr-status-label">Round record</span><strong>{errors.round ? 'Round source unavailable' : display(round?.name, 'No round recorded')}</strong><span>{errors.round ? 'Could not read this source' : (openDate ? `Open since ${date(openDate)}` : 'Open date not recorded')}</span></div></div>
    <div className="fr-status-stat-strip">
      <Stat label="Signed" value={errors.round ? 'Unavailable' : money(raised)} note={errors.round ? 'Round source unavailable' : (coverage !== null ? `${coverage}% of target` : 'Committed amount')} muted={Boolean(errors.round)} />
      <Stat label="Weighted pipeline" value="Unavailable" note="Probability data not returned" muted />
      <Stat label="Blockers" value={blockerCount === null ? 'Unavailable' : blockerCount} note={blockerCount === null ? 'No blocker source' : `${blockerCount} explicitly tracked`} muted={blockerCount === null} />
      <Stat label="Projected close" value={errors.round ? 'Unavailable' : date(round?.close_date)} note={errors.round ? 'Round source unavailable' : (round?.close_date ? 'From round record' : 'Close date not recorded')} muted={Boolean(errors.round)} />
    </div>
    <section className="fr-status-card fr-status-items">
      <div className="fr-status-card-head"><div><Target size={16} /><h2>Open items, and what each one holds up</h2></div><span>{allRows.length} stored record{allRows.length === 1 ? '' : 's'}</span></div>
      <div className="fr-status-toolbar"><div className="fr-status-filters"><Filter size={13} /><button type="button" className={filter === 'overview' ? 'is-selected' : ''} onClick={() => setFilter('overview')}>Overview</button><button type="button" className={filter === 'blockers' ? 'is-selected' : ''} onClick={() => setFilter('blockers')}>Blockers</button><button type="button" className={filter === 'investors' ? 'is-selected' : ''} onClick={() => setFilter('investors')}>Investors</button><button type="button" disabled>Timeline unavailable</button></div><span className="fr-status-filter-meta">Records first · explicit holds-up only</span></div>
      {rows.length ? <div className="fr-status-table-wrap"><table><thead><tr><th>Blocker / record</th><th>Owner</th><th>State</th><th>Holds up</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} data-testid={`row-raise-status-${row.id}`}><td><strong>{row.label}</strong><small>{row.source}</small></td><td>{row.owner}</td><td><span className={`fr-status-pill pill-${stateTone(row.state)}`}>{row.state}</span></td><td>{row.holds}</td></tr>)}</tbody></table></div> : <div className="fr-status-inline-empty"><CircleDot size={18} /><div><strong>{filter === 'overview' ? 'No raise records are stored.' : 'No records match this view.'}</strong><p>FR1 shows only records returned for the selected startup.</p></div></div>}
      <p className="fr-status-note">The table combines stored legal records and investor prospects. Owners, hold-up consequences, and blocker classifications are shown only when returned by their source; the page does not infer close risk from names or ordering.</p>
    </section>
    <div className="fr-status-lower-grid"><section className="fr-status-card"><div className="fr-status-card-head"><div><CheckCircle2 size={16} /><h2>Round coverage</h2></div><span>{errors.round ? 'Source unavailable' : (round ? 'Stored round fields' : 'No round')}</span></div><div className="fr-status-coverage-row"><span>Target</span><strong>{errors.round ? 'Unavailable' : money(target)}</strong></div><div className="fr-status-coverage-row"><span>Committed</span><strong>{errors.round ? 'Unavailable' : money(raised)}</strong></div><div className="fr-status-coverage-row"><span>Investor prospects</span><strong>{errors.prospects ? 'Unavailable' : prospects.length}</strong></div><p className="fr-status-note">Weighted conversion and pace-to-close are not computed without explicit probability and timeline fields.</p><Link className="fr-status-editor-link" to={`/raise/capital${query}`}>Open capital workspace <ChevronRight size={13} /></Link></section><section className="fr-status-card"><div className="fr-status-card-head"><div><FileText size={16} /><h2>Source coverage</h2></div><span>Read-only</span></div><div className="fr-status-coverage-row"><span>Legal records</span><strong>{errors.legal ? 'Unavailable' : documents.length}</strong></div><div className="fr-status-coverage-row"><span>Investor records</span><strong>{errors.prospects ? 'Unavailable' : prospects.length}</strong></div><div className="fr-status-coverage-row"><span>Timeline events</span><strong>Unavailable</strong></div><p className="fr-status-note">Use the detailed workspaces to update source records. This war-room does not create blockers or investor activity.</p></section></div>
  </div>;
}

function Stat({ label, value, note, muted }) { return <div className={`fr-status-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function PageRail({ project, rows, target, raised, errors }) {
  return <WorkerRail
    workspace="Raise"
    className="fr-status-rail"
    stance="Manual war-room view"
    note="This page reads selected-project raise records. It does not score prospects, rank blockers, or write a close plan."
    coverage={[project ? `${rows.length} stored raise record${rows.length === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? (errors.round ? 'Round totals are currently unavailable.' : `${money(raised)} committed against ${money(target)} target`) : 'Select a startup to read its raise status.'}
    unavailable={[['Weighted pace', 'No probability timeline is connected.'], ['AI war-room brief', 'No automated summary or write action is enabled.']]}
    footer="Read-only analytics · source rows only"
  />;
}
function UnavailableStatus({ onRetry }) { return <div className="fr-status-empty" data-testid="unavailable-raise-status"><AlertCircle size={24} /><h2>Project source unavailable</h2><p>The selected startup cannot be read right now. No empty-state or raise totals are inferred from this failed request.</p><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>; }
function EmptyStatus() { return <div className="fr-status-empty" data-testid="empty-raise-status"><Target size={24} /><h2>No startup is available</h2><p>This founder raise status is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/raise/pitch">Back to raise</Link></div>; }
function StatusSkeleton() { return <div className="fr-status-loading" data-testid="status-raise-status-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }