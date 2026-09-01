import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, Filter, GitBranch, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import './founderBuildRoadmap.css';

const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
};

const pretty = (value) => text(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const COLUMN_LABELS = { now: 'Now', next: 'Next', later: 'Later', done: 'Done' };

const stateFor = (item) => {
  const label = COLUMN_LABELS[item.kanban_status] || pretty(item.kanban_status);
  const tone = item.kanban_status === 'done' ? 'done' : item.kanban_status === 'now' ? 'active' : 'neutral';
  return [label, tone];
};

const weekRange = () => {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const format = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
  return `${format(start)}–${format(end)}`;
};

export default function FounderBuildRoadmap() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(requestedId ? Number(requestedId) : null);
  const [okrs, setOkrs] = useState([]);
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
      setSelectedId(chosen?.id || null);
      if (!chosen) {
        setOkrs([]);
        setStatus('empty');
        return;
      }
      if (String(chosen.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true });
      }
      const result = await api.listOkrs(chosen.id);
      setOkrs(result?.okrs || []);
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The roadmap could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId]);
  const sortedOkrs = useMemo(() => [...okrs].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), [okrs]);
  const quarters = useMemo(() => new Set(sortedOkrs.map((item) => item.quarter).filter(Boolean)).size, [sortedOkrs]);
  const dependencies = sortedOkrs.filter((item) => item.dependency || item.dependencies || item.blocks);

  return (
    <main className="fb-roadmap" data-testid="founder-build-roadmap">
      <div className="fb-roadmap-shell">
        <section className="fb-roadmap-main">
          <header className="fb-roadmap-header">
            <div className="fb-roadmap-crumb"><Link to="/execution" data-testid="link-roadmap-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>Roadmap</strong></div>
            <div className="fb-roadmap-title-row">
              <div><p className="fb-roadmap-kicker">Founder / Build</p><h1>Roadmap</h1><p className="fb-roadmap-subtitle">Timeline view, scenarios and dependencies from the selected startup's stored OKRs.</p></div>
              {projects.length > 1 && <label className="fb-roadmap-picker"><span>Startup</span><select data-testid="select-roadmap-project" value={selectedId || ''} onChange={(event) => { const id = Number(event.target.value); setSelectedId(id); setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(id)); return next; }, { replace: true }); }}><option value="" disabled>Select a startup</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            </div>
            <nav className="fb-roadmap-zone-nav" aria-label="Build sections">
              <Link to={`/build/this-week${selectedId ? `?project_id=${selectedId}` : ''}`}>This week</Link>
              <Link to={`/build/board${selectedId ? `?project_id=${selectedId}` : ''}`}>Board</Link>
              <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`} className="is-active" data-testid="link-roadmap-zone">Roadmap</Link>
              <Link to={`/build/cadence${selectedId ? `?project_id=${selectedId}` : ''}`}>Cadence</Link>
              <Link to={`/build/kpi${selectedId ? `?project_id=${selectedId}` : ''}`}>KPI entry</Link>
            </nav>
          </header>

          {status === 'error' && <div className="fb-roadmap-alert" role="alert" data-testid="status-roadmap-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-roadmap"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <RoadmapSkeleton />}
          {status === 'empty' && <EmptyRoadmap />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-roadmap-context"><div><span className="fb-roadmap-label">Selected startup</span><strong data-testid="text-roadmap-project">{text(selectedProject.name)}</strong><span>{text(selectedProject.sector, 'Sector not recorded')}</span></div><div className="fb-roadmap-context-right"><span className="fb-roadmap-label">Operating week</span><strong>{weekRange()}</strong><span>Timeline records are stored on roadmap items</span></div></div>
              <div className="fb-roadmap-stat-strip">
                <Stat label="Items" value={sortedOkrs.length} note={quarters ? `across ${quarters} recorded quarter${quarters === 1 ? '' : 's'}` : 'Quarter not recorded'} />
                <Stat label="Dependencies" value={dependencies.length ? dependencies.length : 'Unavailable'} note={dependencies.length ? 'Stored dependency fields' : 'No dependency source'} muted={!dependencies.length} />
                <Stat label="Saved scenarios" value="Unavailable" note="No scenario source connected" muted />
                <Stat label="At risk" value="Unavailable" note="Risk is not stored on roadmap items" muted />
              </div>
              <section className="fb-roadmap-card fb-roadmap-instrument">
                <div className="fb-roadmap-card-head"><div><GitBranch size={16} /><h2>Roadmap timeline</h2></div><span>{sortedOkrs.length} stored item{sortedOkrs.length === 1 ? '' : 's'} · source order</span></div>
                <div className="fb-roadmap-toolbar"><div className="fb-roadmap-filters"><Filter size={13} /><button type="button" className="is-selected">Timeline</button><Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Board editor</Link><button type="button" disabled>Dependencies</button><button type="button" disabled>Scenarios</button></div><Link className="fb-roadmap-secondary-action" to={`/execution/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Edit roadmap</Link></div>
                {sortedOkrs.length ? <div className="fb-roadmap-table-wrap"><table><thead><tr><th>Item</th><th>Quarter</th><th>State</th><th>Blocks</th></tr></thead><tbody>{sortedOkrs.map((item) => <RoadmapRow key={item.id} item={item} />)}</tbody></table></div> : <div className="fb-roadmap-inline-empty"><CircleDot size={18} /><div><strong>No roadmap items are recorded.</strong><p>Use the existing roadmap editor to add an objective and key results for this startup.</p><Link to={`/execution/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Open roadmap editor</Link></div></div>}
                <p className="fb-roadmap-note">Quarter and state come from stored roadmap items. Dependency links, risk labels, and downstream blocks are shown only when explicitly returned by the source; no relationships are inferred from item names or order.</p>
              </section>
              <div className="fb-roadmap-lower-grid"><DependencySummary dependencies={dependencies} /><SourceSummary okrCount={sortedOkrs.length} quarterCount={quarters} /></div>
            </>
          )}
        </section>
        <WorkerRail project={selectedProject} itemCount={sortedOkrs.length} />
      </div>
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-roadmap-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function RoadmapRow({ item }) { const [label, tone] = stateFor(item); const dependency = item.dependency || item.dependencies || item.blocks; return <tr data-testid={`row-roadmap-item-${item.id}`}><td><strong>{text(item.objective)}</strong><small>{(item.key_results || []).length} key result{(item.key_results || []).length === 1 ? '' : 's'}</small></td><td>{text(item.quarter, 'Quarter not recorded')}</td><td><span className={`fb-roadmap-status status-${tone}`}>{label}</span></td><td>{text(dependency, 'Not recorded')}</td></tr>; }
function DependencySummary({ dependencies }) { return <section className="fb-roadmap-card fb-roadmap-unavailable-card"><div className="fb-roadmap-card-head"><div><GitBranch size={16} /><h2>Dependency chain</h2></div><span>{dependencies.length ? `${dependencies.length} stored` : 'Unavailable'}</span></div><strong>{dependencies.length ? 'Stored links returned by the roadmap' : 'Dependency links are unavailable'}</strong><p>{dependencies.length ? 'Only explicit dependency fields are shown in the timeline; unresolved state is not inferred.' : 'The current roadmap source returns objectives and key results, but no dependency graph or downstream blocks.'}</p></section>; }
function SourceSummary({ okrCount, quarterCount }) { return <section className="fb-roadmap-card"><div className="fb-roadmap-card-head"><div><CheckCircle2 size={16} /><h2>Source coverage</h2></div><span>Read-only view</span></div><div className="fb-roadmap-source-row"><span>Stored roadmap items</span><strong>{okrCount}</strong></div><div className="fb-roadmap-source-row"><span>Recorded quarters</span><strong>{quarterCount || 'Unavailable'}</strong></div><p className="fb-roadmap-note">Scenario snapshots, risk assessment, and timeline dependencies require separate stored records.</p></section>; }
function WorkerRail({ project, itemCount }) { return <aside className="fb-roadmap-rail"><div className="fb-roadmap-rail-heading"><span>Worker AI · Build</span><Sparkles size={14} /></div><div className="fb-roadmap-rail-callout"><b>Manual operating view</b><p>This rail reads the roadmap source. It does not reorder items, create scenarios, or write dependencies.</p></div><div className="fb-roadmap-rail-block"><span className="fb-roadmap-label">Record coverage</span><strong>{project ? `${itemCount} stored roadmap item${itemCount === 1 ? '' : 's'}` : 'No project selected'}</strong><p>{project ? 'Objectives and key results are available for review.' : 'Select a startup to read its roadmap.'}</p></div><div className="fb-roadmap-rail-block fb-roadmap-rail-muted"><span>Unavailable here</span><strong>Scenario comparison</strong><p>No saved scenario source is connected.</p><strong>Dependency reasoning</strong><p>No graph or AI reorder action is enabled on this read-only surface.</p></div><div className="fb-roadmap-rail-foot">Read-only summary · edit through roadmap editor</div></aside>; }
function EmptyRoadmap() { return <div className="fb-roadmap-empty" data-testid="empty-roadmap"><GitBranch size={24} /><h2>No startup is available</h2><p>This founder roadmap is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function RoadmapSkeleton() { return <div className="fb-roadmap-loading" data-testid="status-roadmap-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }