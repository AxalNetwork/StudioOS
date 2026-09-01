import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarClock, CircleDot, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import './founderBuildCadence.css';

const text = (value, fallback = 'Not recorded') => value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);

export default function FounderBuildCadence() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(requestedId ? Number(requestedId) : null);
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = async () => {
    setStatus('loading'); setError('');
    try {
      const available = (await api.listProjects()) || [];
      setProjects(available);
      const requested = Number(requestedId);
      const chosen = available.find((project) => project.id === requested) || available[0];
      setSelectedId(chosen?.id || null);
      if (!chosen) { setStatus('empty'); return; }
      if (String(chosen.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(chosen.id)); return next; }, { replace: true });
      }
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The operating cadence could not be loaded.');
      setStatus('error');
    }
  };
  useEffect(() => { load(); }, [requestedId]);

  const project = useMemo(() => projects.find((item) => item.id === selectedId), [projects, selectedId]);
  const query = selectedId ? `?project_id=${selectedId}` : '';
  const filters = [['all', 'All rituals'], ['plans', 'Plans'], ['retros', 'Retros'], ['skipped', 'Skipped']];

  return <main className="fb-cadence" data-testid="founder-build-cadence"><div className="fb-cadence-shell"><section className="fb-cadence-main">
    <header className="fb-cadence-header">
      <div className="fb-cadence-crumb"><Link to={`/execution${query}`}><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>Cadence</strong></div>
      <div className="fb-cadence-title-row"><div><p>Founder / Build</p><h1>Operating cadence</h1><span>Ritual scheduler, review archive and templates for the selected startup.</span></div>{projects.length > 1 && <label><span>Startup</span><select data-testid="select-cadence-project" value={selectedId || ''} onChange={(event) => { const id = Number(event.target.value); setSelectedId(id); setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(id)); return next; }, { replace: true }); }}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
      <nav aria-label="Build sections"><Link to={`/build/this-week${query}`}>This week</Link><Link to={`/build/board${query}`}>Board</Link><Link to={`/build/roadmap${query}`}>Roadmap</Link><Link to={`/build/cadence${query}`} className="is-active">Cadence</Link><Link to={`/build/kpi${query}`}>KPI entry</Link></nav>
    </header>
    {status === 'error' && <div className="fb-cadence-alert" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <CadenceSkeleton />}
    {status === 'empty' && <EmptyCadence />}
    {status === 'ready' && project && <><div className="fb-cadence-context"><div><span>Selected startup</span><strong data-testid="text-cadence-project">{text(project.name)}</strong><small>{text(project.sector, 'Sector not recorded')}</small></div><div><span>Record source</span><strong>Cadence store unavailable</strong><small>No ritual schedule or review archive is connected</small></div></div>
      <div className="fb-cadence-stats"><Stat label="Reviews archived" /><Stat label="Adherence" /><Stat label="Templates" /><Stat label="Avg retro length" /></div>
      <section className="fb-cadence-card"><div className="fb-cadence-card-head"><div><CalendarClock size={16} /><h2>Review archive</h2></div><span>Source unavailable</span></div>
        <div className="fb-cadence-toolbar"><div><Filter size={13} />{filters.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
        <div className="fb-cadence-empty-feed"><CircleDot size={19} /><div><strong>{filter === 'all' ? 'No operating cadence is recorded.' : `No ${filter} can be shown.`}</strong><p>The current founder APIs do not expose project-scoped rituals, schedules, skipped runs, templates, review notes, or archived outcomes. FB4 does not reconstruct them from calendar events or roadmap activity.</p></div></div>
        <p className="fb-cadence-note">A calendar event is not treated as an operating ritual, and roadmap changes are not treated as review outcomes without an explicit cadence record.</p>
      </section>
      <section className="fb-cadence-card fb-cadence-source"><div className="fb-cadence-card-head"><div><AlertCircle size={16} /><h2>Capability coverage</h2></div><span>Read-only</span></div><div><span>Ritual scheduler</span><strong>Unavailable</strong></div><div><span>Review archive</span><strong>Unavailable</strong></div><div><span>Templates</span><strong>Unavailable</strong></div></section>
    </>}
  </section><CadenceRail project={project} /></div></main>;
}

function Stat({ label }) { return <div><span>{label}</span><strong>Unavailable</strong><small>No cadence record source</small></div>; }
function CadenceRail({ project }) { return <aside className="fb-cadence-rail"><div className="fb-cadence-rail-head"><span>Worker AI · Build</span><Sparkles size={14} /></div><div className="fb-cadence-callout"><strong>Manual cadence view</strong><p>This rail reports source coverage only. It does not draft retros, create rituals, alter templates, or file review summaries.</p></div><div><span>Selected startup</span><strong>{project ? text(project.name) : 'No project selected'}</strong><p>{project ? 'No project-scoped cadence records are exposed.' : 'Select a startup to inspect coverage.'}</p></div><div className="fb-cadence-muted"><span>Unavailable here</span><strong>Retro summary</strong><p>No review archive exists to summarize.</p><strong>Schedule reasoning</strong><p>No ritual scheduler is connected.</p></div><footer>Read-only summary · no automated actions</footer></aside>; }
function EmptyCadence() { return <div className="fb-cadence-no-project"><CalendarClock size={24} /><h2>No startup is available</h2><p>Cadence is scoped to an authenticated startup.</p><Link to="/execution">Back to execution</Link></div>; }
function CadenceSkeleton() { return <div className="fb-cadence-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }