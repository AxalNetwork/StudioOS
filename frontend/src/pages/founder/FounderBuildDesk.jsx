import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ChevronRight, ClipboardCheck, KanbanSquare, LineChart, Route, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ExecutionPage from '../ExecutionPage';
import './founderBuildDesk.css';

const clean = (value) => String(value || '').trim();
const statusName = (value) => clean(value).replace(/_/g, ' ') || 'Not recorded';
const dateRange = () => {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const format = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return `${format(start)}–${format(end)}`;
};
const metricValue = (value, unit = '') => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Not recorded';
  if (unit === '$') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
  if (unit === '%') return `${numeric.toFixed(1)}%`;
  return numeric.toLocaleString();
};

export default function FounderBuildDesk() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = location.state?.founderBuildSeed;
  const workspace = searchParams.get('mode') === 'workspace';
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => seed?.projectId || null);
  const [okrs, setOkrs] = useState(() => seed?.okrs || []);
  const [deals, setDeals] = useState(() => seed?.deals || []);
  const [snapshots, setSnapshots] = useState(() => seed?.snapshots || []);
  const [summary, setSummary] = useState(() => seed?.summary || null);
  const [state, setState] = useState(() => seed ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (workspace) return;
    let alive = true;
    setState(seed ? 'ready' : 'loading');
    Promise.all([api.listProjects(), api.pipelineActive().catch(() => [])]).then(([list, active]) => {
      if (!alive) return;
      const available = list || [];
      const requested = Number(searchParams.get('project_id'));
      const chosen = available.find((item) => item.id === requested) || available.find((item) => item.id === seed?.projectId) || available[0];
      setProjects(available); setDeals(active || []); setProjectId(chosen?.id || null); setError('');
      if (!chosen) setState('ready');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'The operating records could not be loaded.'); setState('error');
    });
    return () => { alive = false; };
  }, [workspace, reloadKey]);

  useEffect(() => {
    if (!projectId || workspace) return;
    let alive = true;
    setState('loading');
    setSearchParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(projectId)); return next; }, { replace: true });
    Promise.all([
      api.listOkrs(projectId),
      api.listMetricsSnapshots(projectId),
      api.metricsSummary(projectId).catch(() => null),
    ]).then(([roadmap, metrics, metricSummary]) => {
      if (!alive) return;
      setOkrs(roadmap?.okrs || []); setSnapshots(metrics?.snapshots || []); setSummary(metricSummary); setState('ready'); setError('');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'Records for this startup could not be loaded.'); setState('error');
    });
    return () => { alive = false; };
  }, [projectId, workspace, reloadKey]);

  const data = useMemo(() => {
    const now = okrs.filter((item) => item.kanban_status === 'now');
    const commitments = now.flatMap((item) => (item.key_results || []).filter((result) => clean(result.text)).map((result, index) => ({
      id: `${item.id}-${index}`, text: result.text, current: result.current, target: result.target, unit: result.unit,
    })));
    const selectedDeal = deals.find((deal) => Number(deal.id) === Number(projectId));
    const taskCounts = selectedDeal?.task_counts || {};
    const board = [
      ['Backlog', Number(taskCounts.todo) || 0],
      ['In progress', Number(taskCounts.in_progress) || 0],
      ['Shipped', Number(taskCounts.done) || 0],
    ];
    const boardTotal = board.reduce((sum, [, count]) => sum + count, 0);
    const roadmap = ['now', 'next', 'later'].map((status) => ({
      status,
      items: okrs.filter((item) => item.kanban_status === status),
    }));
    return { now, commitments, board, boardTotal, roadmap, selectedDeal };
  }, [okrs, deals, projectId]);

  const navigationState = { founderBuildSeed: { projects, projectId, okrs, deals, snapshots, summary } };
  if (workspace) return <ExecutionPage />;
  const roadmapLink = `/build/roadmap${projectId ? `?project_id=${projectId}` : ''}`;
  const metricsLink = `/build/metrics${projectId ? `?project_id=${projectId}` : ''}`;
  const kpiLink = `/build/kpi${projectId ? `?project_id=${projectId}` : ''}`;
  const cadenceLink = `/build/cadence${projectId ? `?project_id=${projectId}` : ''}`;
  const weekLink = `/build/this-week${projectId ? `?project_id=${projectId}` : ''}`;
  const boardLink = `/build/board${projectId ? `?project_id=${projectId}` : ''}`;
  const executionLink = `/execution?mode=workspace${projectId ? `&project_id=${projectId}` : ''}`;

  return <main className="build-desk" data-testid="founder-build-desk">
    <section className="build-canvas">
      <div className="build-main">
        <header className="build-hero">
          <div className="build-eyebrow">Founder / Build</div>
          <div className="build-hero-line">
            <div><h1>Operate the company this week</h1><p>Commitments first, with execution, roadmap, cadence, and metrics serving the days ahead.</p></div>
            <div className="build-actions">
              {projects.length > 1 && <select data-testid="select-build-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
              <Link data-testid="link-open-execution-workspace" className="build-open" to={executionLink} state={navigationState}>Open execution workspace <ArrowUpRight size={14} /></Link>
            </div>
          </div>
          <nav aria-label="Operating desk sections" className="build-anchors">
            {['This week', 'Board', 'Cadence', 'Roadmap', 'KPI entry'].map((label, index) => label === 'This week'
              ? <Link data-testid={`link-build-anchor-${index}`} key={label} to={weekLink}>{label}</Link>
              : label === 'Roadmap'
                ? <Link data-testid={`link-build-anchor-${index}`} key={label} to={roadmapLink}>{label}</Link>
              : label === 'KPI entry'
                ? <Link data-testid={`link-build-anchor-${index}`} key={label} to={kpiLink}>{label}</Link>
              : label === 'Cadence'
                ? <Link data-testid={`link-build-anchor-${index}`} key={label} to={cadenceLink}>{label}</Link>
              // Board was the one pill that never became a link: it fell
              // through to `href="#build-1"`, an anchor onto a section of this
              // page, while /build/board sat unreachable from the desk.
              : <Link data-testid={`link-build-anchor-${index}`} key={label} to={boardLink}>{label}</Link>)}
          </nav>
        </header>
        {state === 'error' && <div className="build-error" data-testid="status-build-error"><AlertCircle size={16} /> {error} <button data-testid="button-retry-build" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
        <BuildSections loading={state === 'loading'} hasProjects={projects.length > 0} data={data} snapshots={snapshots} summary={summary} weekLink={weekLink} roadmapLink={roadmapLink} kpiLink={kpiLink} metricsLink={metricsLink} boardLink={boardLink} executionLink={executionLink} navigationState={navigationState} />
      </div>
      <WorkerRail
        workspace="Build"
        className="build-rail"
        stance="Manual operating view"
        note="This desk reads stored records. It does not move cards, generate plans, or change commitments."
        coverage={[
          `${data.commitments.length} current key result${data.commitments.length === 1 ? '' : 's'}`,
          `${data.boardTotal} stored execution card${data.boardTotal === 1 ? '' : 's'} for this startup`,
        ]}
        action={<Link data-testid="link-rail-open-execution" to={executionLink} state={navigationState}>Open workspace <ChevronRight size={14} /></Link>}
      />
    </section>
  </main>;
}

function BuildSections({ loading, hasProjects, data, snapshots, summary, weekLink, roadmapLink, kpiLink, metricsLink, boardLink, executionLink, navigationState }) {
  const latest = snapshots[0];
  return <div className="build-sections">
     <section className="build-card build-week" id="build-0"><SectionHead icon={ClipboardCheck} title={`This week · ${dateRange()}`} meta={loading ? 'Reading source records' : `${data.commitments.length} stored current key result${data.commitments.length === 1 ? '' : 's'}`} />
      {loading ? <Skeleton rows={4} /> : !hasProjects ? <Empty icon={Target} text="No startup is available to this view yet." detail="Create or select a startup before setting operating commitments." link={executionLink} state={navigationState} /> : data.commitments.length ? <><p className="build-source">Current key results from Now roadmap items. Weekly assignment and ownership are not recorded.</p><div className="commitments">{data.commitments.map((item) => <div className="commitment" key={item.id}><i /><strong>{item.text}</strong><span>{item.target !== null && item.target !== undefined ? `${item.current ?? 0} / ${item.target}${item.unit ? ` ${item.unit}` : ''}` : 'Progress not recorded'}</span></div>)}</div></> : <Empty icon={ClipboardCheck} text="No current commitments are recorded." detail="This desk does not invent a Monday plan. Add Now OKRs and key results in Roadmap." link={roadmapLink} state={navigationState} />}
       <Link data-testid="link-open-this-week" className="manage-link" to={weekLink} state={navigationState}>Open detailed weekly view <ChevronRight size={14} /></Link>
       <Link data-testid="link-manage-roadmap" className="manage-link" to={roadmapLink} state={navigationState}>Manage commitments in Roadmap <ChevronRight size={14} /></Link>
    </section>
    <div className="build-pair">
      <section className="build-card" id="build-1"><SectionHead icon={KanbanSquare} title="Execution board" meta={loading ? 'Reading board' : `${data.boardTotal} stored card${data.boardTotal === 1 ? '' : 's'}`} />
        {loading ? <Skeleton rows={2} /> : data.selectedDeal && data.boardTotal > 0 ? <div className="stage-grid">{data.board.map(([stage, count]) => <div key={stage}><span>{stage}</span><strong>{count}</strong><small>stored cards</small></div>)}</div> : <Empty icon={KanbanSquare} text="No execution cards are recorded." detail="Open the detailed board to review the selected startup's stored task record." link={boardLink} state={navigationState} />}
        <Link data-testid="link-open-board-workspace" className="manage-link" to={boardLink} state={navigationState}>Open detailed board <ChevronRight size={14} /></Link>
      </section>
      <section className="build-card" id="build-2"><SectionHead icon={Route} title="Operating cadence" meta="Not recorded" /><div className="cadence-empty"><Route size={20} /><strong>No operating cadence recorded</strong><p>There is no cadence store connected to this operating desk. No schedule is assumed.</p></div></section>
    </div>
    <section className="build-card" id="build-3"><SectionHead icon={Target} title="Roadmap" meta={loading ? 'Reading roadmap' : `${okrsCount(data.roadmap)} stored objective${okrsCount(data.roadmap) === 1 ? '' : 's'}`} />
      {loading ? <Skeleton rows={3} /> : okrsCount(data.roadmap) ? <div className="roadmap-list">{data.roadmap.map((column) => <article key={column.status}><span>{statusName(column.status)}</span>{column.items.length ? column.items.map((item) => <div className="roadmap-item" key={item.id}><strong>{item.objective}</strong><small>{(item.key_results || []).filter((result) => clean(result.text)).length} stored key result{(item.key_results || []).filter((result) => clean(result.text)).length === 1 ? '' : 's'}</small></div>) : <small>No objectives recorded</small>}</article>)}</div> : <Empty icon={Target} text="No roadmap items are recorded." detail="Roadmap status comes directly from stored OKRs." link={roadmapLink} state={navigationState} />}
      <Link data-testid="link-edit-roadmap" className="manage-link" to={roadmapLink} state={navigationState}>Edit roadmap <ChevronRight size={14} /></Link>
    </section>
    <section className="build-card" id="build-4"><SectionHead icon={LineChart} title="KPI entry" meta={latest?.snapshot_date ? `Latest snapshot · ${latest.snapshot_date}` : 'Not recorded'} />
      {loading ? <Skeleton rows={2} /> : <><div className="kpi-grid">{[{ label: 'MRR', value: latest?.mrr, unit: '$' }, { label: 'Active users', value: latest?.active_users }, { label: 'Net burn', value: summary?.net_burn ?? latest?.net_burn, unit: '$' }, { label: 'Runway', value: summary?.runway_months, unit: ' mo' }].map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.unit === ' mo' ? (item.value == null ? 'Not recorded' : `${Number(item.value).toFixed(1)} mo`) : metricValue(item.value, item.unit)}</strong></div>)}</div><p className="build-source">Only values in the latest stored snapshot and server-derived summary are shown.</p></>}
         <Link data-testid="link-open-kpi-ledger" className="manage-link" to={kpiLink} state={navigationState}>Open KPI ledger <ChevronRight size={14} /></Link>
         <Link data-testid="link-enter-metrics" className="manage-link" to={metricsLink} state={navigationState}>Enter or review metrics <ChevronRight size={14} /></Link>
    </section>
  </div>;
}
function SectionHead({ icon: Icon, title, meta }) { return <div className="build-section-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Empty({ icon: Icon, text, detail, link, state }) { return <div className="build-empty"><Icon size={21} /><div><strong>{text}</strong><p>{detail}</p>{link && <Link data-testid="link-build-empty-action" to={link} state={state}>Open detailed editor <ChevronRight size={13} /></Link>}</div></div>; }
function Skeleton({ rows }) { return <div className="build-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function okrsCount(roadmap) { return roadmap.reduce((count, column) => count + column.items.length, 0); }
