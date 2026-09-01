import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, ClipboardCheck, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import './founderBuildThisWeek.css';

const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
};

const formatProgress = (item) => {
  if (item.target !== null && item.target !== undefined && item.target !== '') {
    return `${text(item.current, '0')} / ${item.target}${item.unit ? ` ${item.unit}` : ''}`;
  }
  return item.current !== null && item.current !== undefined ? `${item.current}${item.unit ? ` ${item.unit}` : ''}` : 'Progress not recorded';
};

const weekRange = () => {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const format = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
  return `${format(start)}–${format(end)}`;
};

function commitmentState(item) {
  if (item.current === null || item.current === undefined || item.current === '') return ['Not recorded', 'neutral'];
  if (item.target !== null && item.target !== undefined && Number(item.current) >= Number(item.target)) return ['Complete', 'done'];
  return ['In progress', 'active'];
}

export default function FounderBuildThisWeek() {
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
      setError(cause?.message || 'The weekly commitment record could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId]);
  const nowObjectives = useMemo(() => okrs.filter((item) => item.kanban_status === 'now'), [okrs]);
  const commitments = useMemo(() => nowObjectives.flatMap((objective) => (objective.key_results || [])
    .filter((result) => text(result.text, '').trim())
    .map((result, index) => ({ ...result, id: `${objective.id}-${index}`, objective: objective.objective }))), [nowObjectives]);
  const progressRecorded = commitments.filter((item) => item.current !== null && item.current !== undefined).length;

  return (
    <main className="fb-week" data-testid="founder-build-this-week">
      <div className="fb-week-shell">
        <section className="fb-week-main">
          <header className="fb-week-header">
            <div className="fb-week-crumb"><Link to="/execution" data-testid="link-week-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>This week</strong></div>
            <div className="fb-week-title-row">
              <div><p className="fb-week-kicker">Founder / Build</p><h1>This week · {weekRange()}</h1><p className="fb-week-subtitle">Current commitments read from the selected startup's roadmap.</p></div>
              {projects.length > 1 && <label className="fb-week-picker"><span>Startup</span><select data-testid="select-week-project" value={selectedId || ''} onChange={(event) => { const id = Number(event.target.value); setSelectedId(id); setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(id)); return next; }, { replace: true }); }}><option value="" disabled>Select a startup</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            </div>
            <nav className="fb-week-zone-nav" aria-label="Build sections">
              <Link to={`/build/this-week${selectedId ? `?project_id=${selectedId}` : ''}`} className="is-active" data-testid="link-week-zone">This week</Link>
              <Link to={`/build/board${selectedId ? `?project_id=${selectedId}` : ''}`}>Board</Link>
              <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Roadmap</Link>
              <Link to={`/build/cadence${selectedId ? `?project_id=${selectedId}` : ''}`}>Cadence</Link>
              <Link to={`/build/kpi${selectedId ? `?project_id=${selectedId}` : ''}`}>KPI entry</Link>
            </nav>
          </header>

          {status === 'error' && <div className="fb-week-alert" role="alert" data-testid="status-week-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-week"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <WeekSkeleton />}
          {status === 'empty' && <EmptyWeek />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-week-context"><div><span className="fb-week-label">Selected startup</span><strong data-testid="text-week-project">{text(selectedProject.name)}</strong><span>{text(selectedProject.sector, 'Sector not recorded')}</span></div><div className="fb-week-context-right"><span className="fb-week-label">Source</span><strong>Roadmap · Now</strong><span>Stored objective and key results</span></div></div>
              <div className="fb-week-stat-strip">
                <Stat label="Current commitments" value={commitments.length} note="Stored Now key results" />
                <Stat label="Now objectives" value={nowObjectives.length} note="Current roadmap column" />
                <Stat label="Progress recorded" value={progressRecorded} note={commitments.length ? `of ${commitments.length} commitments` : 'No commitment rows'} />
                <Stat label="Weekly history" value="Unavailable" note="No cadence history source" muted />
              </div>
              <section className="fb-week-card fb-week-instrument">
                <div className="fb-week-card-head"><div><ClipboardCheck size={16} /><h2>Current commitment records</h2></div><span>{commitments.length} stored key result{commitments.length === 1 ? '' : 's'}</span></div>
                <div className="fb-week-toolbar"><div className="fb-week-filters"><Filter size={13} /><button type="button" className="is-selected">Current records</button><button type="button" disabled>Last 4 weeks</button><button type="button" disabled>Carried only</button></div><Link className="fb-week-secondary-action" to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Review roadmap</Link></div>
                {commitments.length ? <div className="fb-week-table-wrap"><table><thead><tr><th>Commitment</th><th>Objective</th><th>Progress</th><th>State</th><th>Source</th></tr></thead><tbody>{commitments.map((item) => <CommitmentRow key={item.id} item={item} />)}</tbody></table></div> : <div className="fb-week-inline-empty"><CircleDot size={18} /><div><strong>No current commitments are recorded.</strong><p>This desk does not invent a Monday plan. Add Now objectives and key results in Roadmap.</p><Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Open roadmap</Link></div></div>}
                <p className="fb-week-note">Only stored Now objectives and key results appear here. Weekly assignment, carry-over history, outcomes, streaks, and retro notes are not available from the current source record.</p>
              </section>
              <div className="fb-week-lower-grid"><HistoryUnavailable /><SourceSummary objectiveCount={nowObjectives.length} commitmentCount={commitments.length} /></div>
            </>
          )}
        </section>
        <WorkerRail project={selectedProject} commitmentCount={commitments.length} />
      </div>
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-week-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CommitmentRow({ item }) { const [label, tone] = commitmentState(item); return <tr data-testid={`row-week-commitment-${item.id}`}><td><strong>{text(item.text)}</strong></td><td>{text(item.objective)}</td><td>{formatProgress(item)}</td><td><span className={`fb-week-status status-${tone}`}>{label}</span></td><td><span className="fb-week-source">Roadmap · Now</span></td></tr>; }
function HistoryUnavailable() { return <section className="fb-week-card fb-week-unavailable-card"><div className="fb-week-card-head"><div><CircleDot size={16} /><h2>Commitment history</h2></div><span>Not recorded</span></div><strong>Weekly history is unavailable</strong><p>Carry-overs, skipped commitments, streaks, and retro notes require a cadence history source that is not connected to this desk.</p></section>; }
function SourceSummary({ objectiveCount, commitmentCount }) { return <section className="fb-week-card"><div className="fb-week-card-head"><div><CheckCircle2 size={16} /><h2>Source coverage</h2></div><span>Read-only</span></div><div className="fb-week-source-row"><span>Now objectives</span><strong>{objectiveCount}</strong></div><div className="fb-week-source-row"><span>Key results</span><strong>{commitmentCount}</strong></div><p className="fb-week-note">Progress is shown only when it is stored on the key result. No completion rate is inferred from missing values.</p></section>; }
function WorkerRail({ project, commitmentCount }) { return <aside className="fb-week-rail"><div className="fb-week-rail-heading"><span>Worker AI · Build</span><Sparkles size={14} /></div><div className="fb-week-rail-callout"><b>Manual operating view</b><p>This rail reads stored roadmap records. It does not generate plans, alter commitments, or write to the roadmap.</p></div><div className="fb-week-rail-block"><span className="fb-week-label">Record coverage</span><strong>{project ? `${commitmentCount} stored current commitment${commitmentCount === 1 ? '' : 's'}` : 'No project selected'}</strong><p>{project ? 'Current Now key results are available for review.' : 'Select a startup to read its roadmap.'}</p></div><div className="fb-week-rail-block fb-week-rail-muted"><span>Unavailable here</span><strong>Weekly history</strong><p>No cadence archive is returned by the available founder read API.</p><strong>AI Monday plan</strong><p>Worker AI assistance is not enabled for this manual surface.</p></div><div className="fb-week-rail-foot">Read-only summary · no automated actions</div></aside>; }
function EmptyWeek() { return <div className="fb-week-empty" data-testid="empty-week"><ClipboardCheck size={24} /><h2>No startup is available</h2><p>This founder desk can only display authenticated roadmap records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function WeekSkeleton() { return <div className="fb-week-loading" data-testid="status-week-loading"><i /><i /><div><i /><i /><i /></div></div>; }