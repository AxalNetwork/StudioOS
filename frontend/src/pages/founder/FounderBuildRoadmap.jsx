import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, GitBranch, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderBuildRoadmap.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { DependenciesDialog, ScenarioDialog, RiskUnavailable } from './RoadmapDialogs';

/**
 * Build · Roadmap (FB3). Task #176.
 *
 * WHAT CHANGED AND WHY IT MATTERED. Two of this zone's four chips were wrong in
 * opposite ways. `Scenarios` was honestly refused — no store. `Dependencies` was
 * LIVE and could never show a row: this page filtered on `item.dependency ||
 * item.dependencies || item.blocks`, and `roadmap_okrs` has none of those columns
 * while `/progress/roadmap/:id` returns none of them. A founder selecting it saw
 * an empty table captioned "items naming a dependency", which reads as "you have
 * none" rather than "nothing here can have one". The `Blocks` column said "Not
 * recorded" on every row and the `At risk` stat said "Unavailable" — the same
 * emptiness in three different words.
 *
 * Migration 254 stores both, and `services/okrGraph.ts` derives `Blocked` from
 * the graph. `At risk` stays unanswered, and the card below says exactly why
 * rather than showing a number that would have to be invented.
 */

const text = (value, fallback = 'Not recorded') => {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
};

const TONE = { blocked: 'blocked', in_flight: 'active', done: 'done', provisional: 'neutral' };

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
  const [graph, setGraph] = useState(null);
  // All four of the canvas's views are live as of migration 254. `timeline` is
  // source order, `board` groups by the stored kanban column, `dependencies`
  // shows the items that are actually in the graph, and `scenarios` lists what
  // has been saved beside the roadmap.
  const [view, setView] = useState('timeline');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);

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
        setGraph(null);
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
      setGraph(await api.roadmapGraph(chosen.id));
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The roadmap could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId]);
  const items = graph?.items || [];
  const dependencies = graph?.dependencies || [];
  const scenarios = graph?.scenarios || [];
  const stats = graph?.stats || { items: 0, quarters: 0, dependencies: 0, unresolved: 0, blocked: 0, scenarios: 0 };

  // "Board" is the same items read down their stored kanban column instead of in
  // source order. Nothing is added, dropped or re-scored by the regrouping.
  const boardOrder = useMemo(() => {
    const rank = { now: 0, next: 1, later: 2, done: 3 };
    return [...items].sort((a, b) => (rank[a.kanban_status] ?? 9) - (rank[b.kanban_status] ?? 9));
  }, [items]);
  // The dependency view is the items that are IN the graph — either end of a
  // link. Before migration 254 this filter read three fields that did not exist,
  // so it was always empty; it now has a store behind it.
  const inGraph = useMemo(
    () => items.filter((i) => (i.blocks || []).length > 0 || (i.blocked_by || []).length > 0),
    [items],
  );
  const rows = view === 'board' ? boardOrder : view === 'dependencies' ? inGraph : items;

  const refresh = async () => { if (selectedId) setGraph(await api.roadmapGraph(selectedId)); };

  const handlers = {
    newScenario: () => setDialog({ kind: 'scenario', scenario: null }),
  };

  return (
    <main className="fb-roadmap" data-testid="founder-build-roadmap">
      <div className="fb-roadmap-shell">
        <section className="fb-roadmap-main">
          <header className="fb-roadmap-header">
            <div className="fb-roadmap-crumb"><Link to="/execution" data-testid="link-roadmap-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>Roadmap</strong></div>
            <div className="fb-roadmap-title-row">
              <div><h1>Roadmap</h1><p className="fb-roadmap-subtitle">Timeline, dependency chain and saved scenarios for the selected startup.</p></div>
            </div>
            <nav className="fb-roadmap-zone-nav" aria-label="Build sections">
              <Link to={`/build/this-week${selectedId ? `?project_id=${selectedId}` : ''}`}>This week</Link>
              <Link to={`/build/board${selectedId ? `?project_id=${selectedId}` : ''}`}>Board</Link>
              <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`} className="is-active" data-testid="link-roadmap-zone">Roadmap</Link>
              <Link to={`/build/cadence${selectedId ? `?project_id=${selectedId}` : ''}`}>Cadence</Link>
              <Link to={`/build/kpi${selectedId ? `?project_id=${selectedId}` : ''}`}>KPI entry</Link>
            </nav>
            <ZoneToolbar
              filters={founderZoneFilters('build/roadmap', { value: view, onChange: setView })}
              actions={founderZoneActions('build/roadmap', {
                query: selectedId ? `?project_id=${selectedId}` : '',
                handlers,
                view: {
                  scope: selectedProject?.name,
                  header: ['Objective', 'Quarter', 'State', 'Blocks', 'Blocked by'],
                  rows: items,
                  cells: (i) => [
                    i.objective, i.quarter, i.state_label,
                    (i.blocks || []).map((b) => b.objective).join(' · '),
                    (i.blocked_by || []).map((b) => b.objective).join(' · '),
                  ],
                },
              })}
            />
          </header>

          {status === 'error' && <div className="fb-roadmap-alert" role="alert" data-testid="status-roadmap-error"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load} data-testid="button-retry-roadmap"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <RoadmapSkeleton />}
          {status === 'empty' && <EmptyRoadmap />}
          {status === 'ready' && selectedProject && (
            <>
              <div className="fb-roadmap-context"><div><span className="fb-roadmap-label">Selected startup</span><strong data-testid="text-roadmap-project">{text(selectedProject.name)}</strong><span>{text(selectedProject.sector, 'Sector not recorded')}</span></div><div className="fb-roadmap-context-right"><span className="fb-roadmap-label">Operating week</span><strong>{weekRange()}</strong><span>Quarters and links are stored on the roadmap</span></div></div>
              <div className="fb-roadmap-stat-strip">
                <Stat label="Items" value={stats.items} note={stats.quarters ? `across ${stats.quarters} recorded quarter${stats.quarters === 1 ? '' : 's'}` : 'Quarter not recorded'} />
                <Stat
                  label="Dependencies"
                  value={stats.dependencies}
                  note={stats.dependencies ? `${stats.unresolved} unresolved` : 'No link recorded yet'}
                  muted={!stats.dependencies}
                />
                <Stat label="Saved scenarios" value={stats.scenarios} note={stats.scenarios ? 'Compared against the live roadmap' : 'None saved yet'} muted={!stats.scenarios} />
                {/* `At risk` WAS THE FOURTH CARD AND IS NOT A NUMBER. `okrGraph.ts`
                    carries the proof that the obvious derivation is always empty;
                    `Blocked` is what the graph can honestly say. */}
                <Stat label="Blocked" value={stats.blocked} note={stats.blocked ? 'Waiting on an unfinished objective' : 'Nothing is waiting on anything'} muted={!stats.blocked} />
              </div>

              {view === 'scenarios' ? (
                <ScenarioList
                  scenarios={scenarios}
                  onOpen={(scenario) => setDialog({ kind: 'scenario', scenario })}
                  onNew={() => setDialog({ kind: 'scenario', scenario: null })}
                />
              ) : (
                <section className="fb-roadmap-card fb-roadmap-instrument">
                  <div className="fb-roadmap-card-head">
                    <div><GitBranch size={16} /><h2>{view === 'dependencies' ? 'Dependency chain' : view === 'board' ? 'Roadmap board' : 'Roadmap timeline'}</h2></div>
                    <span>
                      {rows.length} item{rows.length === 1 ? '' : 's'} ·{' '}
                      {view === 'dependencies' ? 'in the dependency graph' : view === 'board' ? 'grouped by stored column' : 'source order'}
                    </span>
                  </div>
                  <div className="fb-roadmap-toolbar">
                    <button type="button" data-testid="button-open-dependencies" onClick={() => setDialog({ kind: 'dependencies' })}>
                      Edit dependency links
                    </button>
                  </div>
                  {rows.length ? (
                    <div className="fb-roadmap-table-wrap">
                      <table><thead><tr><th>Item</th><th>Quarter</th><th>State</th><th>Blocks</th></tr></thead>
                        <tbody>{rows.map((item) => <RoadmapRow key={item.id} item={item} />)}</tbody>
                      </table>
                    </div>
                  ) : view === 'dependencies' ? (
                    // TWO DISTINCT EMPTY STATES, because they are different
                    // problems: no objectives at all, versus objectives with no
                    // links between them. The old page had one message for both
                    // and it was true of neither.
                    <div className="fb-roadmap-inline-empty" data-testid="empty-dependencies">
                      <GitBranch size={18} />
                      <div>
                        <strong>No dependency link is recorded.</strong>
                        <p>
                          {items.length
                            ? `All ${items.length} objective${items.length === 1 ? '' : 's'} stand on their own so far. Record a link and the blocked one starts showing as Blocked here.`
                            : 'There is no objective to link yet.'}
                        </p>
                        {items.length >= 2 && (
                          <button type="button" data-testid="button-empty-add-dependency" onClick={() => setDialog({ kind: 'dependencies' })}>
                            Record a link
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="fb-roadmap-inline-empty"><CircleDot size={18} /><div><strong>No roadmap items are recorded.</strong><p>Use the roadmap editor to add an objective and key results for this startup.</p><Link to={`/execution/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Open roadmap editor</Link></div></div>
                  )}
                  <p className="fb-roadmap-note">
                    Quarter and column come from the stored roadmap item. <strong>Blocked</strong> is
                    derived: the objective has at least one link from something that is not Done.
                    Nothing is inferred from item names or from the order they were written in.
                  </p>
                </section>
              )}

              <div className="fb-roadmap-lower-grid">
                <RiskUnavailable />
                <SourceSummary stats={stats} />
              </div>
            </>
          )}
        </section>
        <PageRail project={selectedProject} stats={stats} />
      </div>

      {dialog?.kind === 'dependencies' && (
        <DependenciesDialog
          items={items}
          dependencies={dependencies}
          onClose={() => setDialog(null)}
          onAdd={async (body) => { await api.addOkrDependency(selectedId, body); await refresh(); }}
          onRemove={async (id) => { await api.deleteOkrDependency(id); await refresh(); }}
        />
      )}
      {dialog?.kind === 'scenario' && (
        <ScenarioDialog
          items={items}
          scenario={dialog.scenario}
          onClose={() => setDialog(null)}
          onSave={async (body) => { await api.saveRoadmapScenario(selectedId, body); await refresh(); setDialog(null); }}
          onDelete={async (id) => { await api.deleteRoadmapScenario(id); await refresh(); setDialog(null); }}
        />
      )}
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-roadmap-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }

function RoadmapRow({ item }) {
  const blocks = (item.blocks || []).map((b) => b.objective);
  return (
    <tr data-testid={`row-roadmap-item-${item.id}`}>
      <td>
        <strong>{text(item.objective)}</strong>
        {(item.blocked_by || []).length > 0 && (
          <small data-testid={`text-blocked-by-${item.id}`}>
            Waiting on {item.blocked_by.map((b) => b.objective).join(', ')}
          </small>
        )}
      </td>
      <td>{text(item.quarter, 'Quarter not recorded')}</td>
      <td><span className={`fb-roadmap-status status-${TONE[item.state] || 'neutral'}`}>{text(item.state_label)}</span></td>
      <td>{blocks.length ? blocks.join(', ') : 'Nothing downstream'}</td>
    </tr>
  );
}

function ScenarioList({ scenarios, onOpen, onNew }) {
  return (
    <section className="fb-roadmap-card" data-testid="card-scenarios">
      <div className="fb-roadmap-card-head">
        <div><GitBranch size={16} /><h2>Saved scenarios</h2></div>
        <span>{scenarios.length} saved · compared, never applied</span>
      </div>
      {scenarios.length === 0 ? (
        <div className="fb-roadmap-inline-empty" data-testid="empty-scenarios">
          <CircleDot size={18} />
          <div>
            <strong>No scenario is saved.</strong>
            <p>A scenario is a named what-if: where each objective would land instead. It sits beside the roadmap and never moves anything on it.</p>
            <button type="button" data-testid="button-empty-new-scenario" onClick={onNew}>New scenario</button>
          </div>
        </div>
      ) : (
        <ul className="fb-roadmap-scenarios" data-testid="scenarios-list">
          {scenarios.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.moves_count === 0
                    ? 'Moves nothing — every objective is already where this scenario puts it'
                    : `Moves ${s.moves_count} objective${s.moves_count === 1 ? '' : 's'}`}
                  {s.note ? ` · ${s.note}` : ''}
                </small>
                {s.moves_count > 0 && (
                  <ul className="fb-roadmap-scenario-moves">
                    {s.moves.map((m) => (
                      <li key={m.okr_id}>{m.objective}: {m.from || 'no quarter'} → {m.to || 'no quarter'}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" data-testid={`button-scenario-open-${s.id}`} onClick={() => onOpen(s)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SourceSummary({ stats }) {
  return (
    <section className="fb-roadmap-card">
      <div className="fb-roadmap-card-head"><div><CheckCircle2 size={16} /><h2>Source coverage</h2></div><span>Stored on this roadmap</span></div>
      <div className="fb-roadmap-source-row"><span>Roadmap items</span><strong>{stats.items}</strong></div>
      <div className="fb-roadmap-source-row"><span>Recorded quarters</span><strong>{stats.quarters || 'None'}</strong></div>
      <div className="fb-roadmap-source-row"><span>Dependency links</span><strong>{stats.dependencies}</strong></div>
      <div className="fb-roadmap-source-row"><span>Saved scenarios</span><strong>{stats.scenarios}</strong></div>
      <p className="fb-roadmap-note">Objectives and their quarters are edited in the roadmap editor. Links and scenarios are edited here.</p>
    </section>
  );
}

function PageRail({ project, stats }) {
  return <WorkerRail
    workspace="Build"
    className="fb-roadmap-rail"
    stance="Manual operating view"
    note="This rail reads the roadmap and its dependency graph. It does not reorder items, write links, or draft scenarios."
    coverage={[project ? `${stats.items} roadmap item${stats.items === 1 ? '' : 's'}, ${stats.dependencies} link${stats.dependencies === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? 'Objectives, quarters, links and saved scenarios are available for review.' : 'Select a startup to read its roadmap.'}
    unavailable={[
      // Corrected with the store: the old pair claimed there was no scenario
      // source and no dependency graph. Both exist now, so what is genuinely
      // absent is the reasoning over them.
      ['Risk assessment', 'Nothing records why or when an objective became stuck, so no risk can be derived from the graph.'],
      ['Scenario reasoning', 'Scenarios are compared arithmetically here; no model is asked which one to take.'],
    ]}
    footer="Objectives edited in the roadmap editor · links and scenarios edited here"
  />;
}

function EmptyRoadmap() { return <div className="fb-roadmap-empty" data-testid="empty-roadmap"><GitBranch size={24} /><h2>No startup is available</h2><p>This founder roadmap is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function RoadmapSkeleton() { return <div className="fb-roadmap-loading" data-testid="status-roadmap-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }
