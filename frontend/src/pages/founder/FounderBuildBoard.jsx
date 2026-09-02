import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, Clock3, Filter, Layers3, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderBuildBoard.css';

const STAGES = [
  ['idea', 'Idea'],
  ['mvp_dev', 'MVP Dev'],
  ['traction_review', 'Traction Review'],
  ['decision_gate', 'Decision Gate'],
  ['spinout_ready', 'Spin-Out Ready'],
  ['iterate', 'Iterate'],
];
const TASK_STATUS = [
  ['all', 'All tasks'],
  ['todo', 'Backlog'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
];

const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
};
const pretty = (value) => text(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value, fallback = 'Not recorded') => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? text(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};

export default function FounderBuildBoard() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState(requestedId ? Number(requestedId) : null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [query, setQuery] = useState('');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const active = await api.pipelineActive();
      const available = Array.isArray(active) ? active : [];
      setProjects(available);
      const requested = Number(requestedId);
      const chosen = available.find((project) => project.id === requested) || available[0];
      setSelectedId(chosen?.id || null);
      if (!chosen) {
        setDetail(null);
        setStatus('empty');
        return;
      }
      if (String(chosen.id) !== requestedId) setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(chosen.id)); return next; }, { replace: true });
      try {
        const result = await api.pipelineDealDetail(chosen.id);
        setDetail(result);
      } catch (cause) {
        if (cause?.status !== 404) throw cause;
        setDetail({
          project: chosen,
          tasks: [],
          stages: chosen.pipeline_stage ? [{
            id: `pipeline-${chosen.id}`,
            stage_name: chosen.pipeline_stage,
            status: 'active',
            start_date: chosen.pipeline_stage_started,
          }] : [],
          metrics: [],
          gates: [],
          current_stage: chosen.pipeline_stage || null,
          detail_unavailable: true,
        });
      }
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The execution record could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);
  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId) || detail?.project, [projects, selectedId, detail]);
  const tasks = detail?.tasks || [];
  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchesStatus = taskFilter === 'all' || task.status === taskFilter;
    const haystack = `${task.title || ''} ${task.description || ''} ${task.assigned_to || ''}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase());
  }), [tasks, taskFilter, query]);
  const counts = useMemo(() => ({
    total: tasks.length,
    todo: tasks.filter((task) => task.status === 'todo').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
  }), [tasks]);
  const detailUnavailable = detail?.detail_unavailable === true;
  const stageLabel = STAGES.find(([id]) => id === (detail?.current_stage || selectedProject?.pipeline_stage))?.[1] || pretty(detail?.current_stage || selectedProject?.pipeline_stage);

  return (
    <main className="fb-board" data-testid="founder-build-board">
      <div className="fb-board-shell">
        <section className="fb-board-main">
          <header className="fb-board-header">
            <div className="fb-board-crumb"><Link to="/execution" data-testid="link-board-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>Board</strong></div>
            <div className="fb-title-row">
              <div><p className="fb-kicker">Founder / Build</p><h1>Execution board</h1><p className="fb-subtitle">The stored work record for this startup. Read-only for founder accounts.</p></div>
              {projects.length > 1 && <label className="fb-project-picker"><span>Startup</span><select data-testid="select-board-project" value={selectedId || ''} onChange={(event) => { const id = Number(event.target.value); setSelectedId(id); setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(id)); return next; }, { replace: true }); }}><option value="" disabled>Select a startup</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            </div>
            <nav className="fb-zone-nav" aria-label="Build sections">
              <Link to={`/build/this-week${selectedId ? `?project_id=${selectedId}` : ''}`}>This week</Link>
              <Link to={`/build/board${selectedId ? `?project_id=${selectedId}` : ''}`} className="is-active" data-testid="link-board-zone">Board</Link>
              <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Roadmap</Link>
              <Link to={`/build/cadence${selectedId ? `?project_id=${selectedId}` : ''}`}>Cadence</Link>
              <Link to={`/build/kpi${selectedId ? `?project_id=${selectedId}` : ''}`}>KPI entry</Link>
            </nav>
          </header>

          {status === 'error' && <div className="fb-alert" role="alert" data-testid="status-board-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-board"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <BoardSkeleton />}
          {status === 'empty' && <EmptyBoard />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-project-context"><div><span className="fb-label">Selected startup</span><strong data-testid="text-board-project">{text(selectedProject.name)}</strong><span>{text(selectedProject.sector, 'Sector not recorded')}</span></div><div className="fb-context-stage"><span className="fb-label">Current pipeline stage</span><strong>{stageLabel}</strong><span>Started {date(selectedProject.pipeline_stage_started)}</span></div></div>
              <div className="fb-stat-strip">
                <Stat label="Open cards" value={detailUnavailable ? 'Unavailable' : counts.todo + counts.inProgress} note={detailUnavailable ? 'Task detail is not exposed by this backend' : `${counts.total} stored tasks`} muted={detailUnavailable} />
                <Stat label="In progress" value={detailUnavailable ? 'Unavailable' : counts.inProgress} note={detailUnavailable ? 'No task-level source record' : 'Status from task record'} muted={detailUnavailable} />
                <Stat label="Done" value={detailUnavailable ? 'Unavailable' : counts.done} note={detailUnavailable ? 'No task-level source record' : counts.total ? `${Math.round((counts.done / counts.total) * 100)}% of stored tasks` : 'No completion rate'} muted={detailUnavailable} />
                <Stat label="WIP limits" value="Unavailable" note="No source record" muted />
              </div>
              <section className="fb-card fb-instrument">
                <div className="fb-card-head"><div><Layers3 size={16} /><h2>Stored task record</h2></div><span>{counts.total} task{counts.total === 1 ? '' : 's'} · newest activity first</span></div>
                <div className="fb-toolbar"><div className="fb-filters"><Filter size={13} />{TASK_STATUS.map(([value, label]) => <button type="button" key={value} className={taskFilter === value ? 'is-selected' : ''} onClick={() => setTaskFilter(value)} data-testid={`button-filter-task-${value}`}>{label}</button>)}</div><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stored tasks" aria-label="Search stored tasks" data-testid="input-search-board-tasks" /></div>
                {filteredTasks.length ? <div className="fb-table-wrap"><table><thead><tr><th>Card</th><th>Status</th><th>Owner</th><th>Due</th><th>Updated</th></tr></thead><tbody>{filteredTasks.map((task) => <TaskRow key={task.id} task={task} />)}</tbody></table></div> : <div className="fb-inline-empty"><CircleDot size={18} /><div><strong>{detailUnavailable ? 'Task-level board records are unavailable.' : tasks.length ? 'No stored tasks match this view.' : 'No execution tasks are recorded.'}</strong><p>{detailUnavailable ? 'The selected startup is available, but this backend does not expose its detailed task record.' : tasks.length ? 'Change the status filter or search terms; no cards are inferred.' : 'This page does not create cards for founder accounts.'}</p></div></div>}
                <p className="fb-note">{detailUnavailable ? 'Project and stage context come from the authenticated pipeline list. Task rows, lane ownership, WIP policy, and automation rules are unavailable and are intentionally not inferred.' : 'This board reports task rows returned by the authenticated pipeline detail endpoint. Lane ownership, WIP policy, and automation rules are not present in the available record and are intentionally not inferred.'}</p>
              </section>
              <div className="fb-lower-grid"><StageTimeline stages={detail?.stages || []} current={detail?.current_stage} /><EvidenceSummary detail={detail} unavailable={detailUnavailable} /></div>
            </>
          )}
        </section>
        <PageRail taskCount={detailUnavailable ? null : counts.total} project={selectedProject} />
      </div>
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-stat ${muted ? 'is-muted' : ''}`} data-testid={`stat-board-${label.toLowerCase().replace(/\s+/g, '-')}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function TaskRow({ task }) { return <tr data-testid={`row-board-task-${task.id}`}><td><strong>{text(task.title)}</strong>{task.description && <small>{task.description}</small>}{task.ai_generated && <em>AI-generated source flag</em>}</td><td><span className={`fb-status status-${task.status}`}>{pretty(task.status)}</span></td><td>{text(task.assigned_to, 'Unassigned')}</td><td>{date(task.due_date, 'Not due')}</td><td>{date(task.updated_at || task.created_at)}</td></tr>; }
function StageTimeline({ stages, current }) { return <section className="fb-card fb-timeline"><div className="fb-card-head"><div><Clock3 size={16} /><h2>Stage history</h2></div><span>Pipeline record</span></div>{stages.length ? <div className="fb-stage-list">{stages.map((stage) => <div key={stage.id} className={stage.stage_name === current ? 'is-current' : ''}><span className="fb-stage-dot">{stage.stage_name === current ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}</span><div><strong>{pretty(stage.stage_name)}</strong><small>{stage.status === 'active' ? 'Active stage' : `Recorded ${date(stage.end_date || stage.start_date)}`}</small></div></div>)}</div> : <Unavailable text="Stage history is not recorded for this project." />}</section>; }
function EvidenceSummary({ detail, unavailable }) { const metrics = detail?.metrics || []; const gates = detail?.gates || []; return <section className="fb-card fb-evidence"><div className="fb-card-head"><div><ShieldCheck size={16} /><h2>Evidence surface</h2></div><span>Available source records</span></div><div className="fb-evidence-row"><span>Metrics</span><strong>{unavailable ? '—' : metrics.length}</strong><small>{unavailable ? 'Detail record unavailable' : metrics.length ? 'Stored pipeline metrics' : 'Not recorded'}</small></div><div className="fb-evidence-row"><span>Decision gates</span><strong>{unavailable ? '—' : gates.length}</strong><small>{unavailable ? 'Detail record unavailable' : gates.length ? 'Stored gate records' : 'Not recorded'}</small></div><p className="fb-note">No score, owner, WIP limit, or automation value is displayed unless it is returned by the authenticated API.</p></section>; }
function PageRail({ taskCount, project }) {
  const hasTaskDetail = taskCount !== null;
  return <WorkerRail
    workspace="Build"
    className="fb-worker-rail"
    stance="Manual operating view"
    note="This rail reads the same stored project record as the board. It does not generate tasks, move cards, or change commitments."
    coverage={[project ? hasTaskDetail ? `${taskCount} stored task${taskCount === 1 ? '' : 's'}` : 'Task detail unavailable' : 'No project selected']}
    coverageNote={project ? hasTaskDetail ? 'Task detail is available for review.' : 'Project context is available; task rows are not exposed here.' : 'Select a startup to read its board.'}
    unavailable={[['WIP policy', 'No WIP configuration is returned by the available founder read API.'], ['Automations', 'No automation definitions or run history are returned.']]}
    footer="Read-only founder surface · no automated actions"
  />;
}
function Unavailable({ text: message }) { return <div className="fb-unavailable-state"><CircleDot size={16} /><span>{message}</span></div>; }
function EmptyBoard() { return <div className="fb-empty" data-testid="empty-board"><Layers3 size={24} /><h2>No startup is available</h2><p>This founder board can only display authenticated pipeline records. There is no project to inspect yet.</p><Link to="/execution" data-testid="link-empty-board-execution">Back to execution</Link></div>; }
function BoardSkeleton() { return <div className="fb-loading" data-testid="status-board-loading"><i /><i /><i /><div className="fb-loading-table"><i /><i /><i /><i /></div></div>; }