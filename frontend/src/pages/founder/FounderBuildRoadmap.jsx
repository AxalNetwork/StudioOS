import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, GitBranch, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { text } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import './founderBuildRoadmap.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { DependenciesDialog, ScenarioDialog, RiskUnavailable } from './RoadmapDialogs';
import {
  DOOR, LANDING_SUB, addFirstHref, dueText, horizonOf, itemParam, itemSheetHref, landingBack, landingView, pickProject, quarterGroups,
} from '../cycles/roadmapShortcut.js';

/**
 * Build · Quarters, dependencies and scenarios (`/build/roadmap`). FB3, task #176; D8776 (#8776).
 *
 * WHAT CHANGED AND WHY IT MATTERED (#176). Two of this zone's four chips were wrong in
 * opposite ways. `Scenarios` was honestly refused — no store. `Dependencies` was
 * LIVE and could never show a row: this page filtered on `item.dependency ||
 * item.dependencies || item.blocks`, and `roadmap_okrs` has none of those columns
 * while `/progress/roadmap/:id` returns none of them. Migration 254 stores both,
 * and `services/okrGraph.ts` derives `Blocked` from the graph. `At risk` stays
 * unanswered, and the card below says exactly why rather than showing a number
 * that would have to be invented.
 *
 * D8776 (#8776, BLR00 to BLR07). Product roadmap is the Now / Next / Later board and links here as
 * "Quarters, dependencies and scenarios"; this page's h1 is those words. It keeps the venture from the link,
 * says how an item's horizon, quarter, links and what-ifs relate, and opens By quarter (owner question 3,
 * option A: no Board view and no zone row here). `?view=` names the view and `?item=` the item it was opened
 * from, which is highlighted and focused; Back returns to that item, or to the board as it was left. A project
 * in the link that is not the reader's is said, not silently swapped. At zero items there is one action, Add
 * the first item, on Product roadmap (owner question 2, option A: the `/execution` editor is no longer offered).
 */

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
  const location = useLocation();
  const requestedId = params.get('project_id');
  const view = landingView(params.get('view'));
  const itemId = itemParam(params.get('item'));
  // Where the board handed over (its view and column), read once: a view change replaces the address.
  const [from] = useState(() => (typeof location.state?.roadmapFrom === 'string' ? location.state.roadmapFrom : null));
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(requestedId ? Number(requestedId) : null);
  const [refused, setRefused] = useState(null);
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  // The venture this page wrote into the address itself; that rewrite is not a new venture to read again.
  const rewrote = useRef(null);

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const available = (await api.listProjects()) || [];
      setProjects(available);
      const picked = pickProject(available, requestedId);
      const chosen = picked.chosen;
      // The address is rewritten to the venture shown; the refusal stays said across that rewrite.
      setRefused((prev) => picked.refused ?? (prev && chosen && String(chosen.id) === requestedId ? prev : null));
      setSelectedId(chosen?.id || null);
      if (!chosen) {
        setGraph(null);
        setStatus('empty');
        return;
      }
      if (String(chosen.id) !== requestedId) {
        rewrote.current = String(chosen.id);
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true, state: location.state });
      }
      setGraph(await api.roadmapGraph(chosen.id));
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The roadmap could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (rewrote.current != null && rewrote.current === requestedId) { rewrote.current = null; return; }
    load();
  }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps -- reload on the venture only

  const setView = (next) => setParams((old) => {
    const out = new URLSearchParams(old);
    out.set('view', next);
    return out;
  }, { replace: true, state: location.state });

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId]);
  const items = graph?.items || [];
  const dependencies = graph?.dependencies || [];
  const scenarios = graph?.scenarios || [];
  const stats = graph?.stats || { items: 0, quarters: 0, dependencies: 0, unresolved: 0, blocked: 0, scenarios: 0 };
  // A reader the Worker would refuse is offered no edit; an older read without the flag keeps the old behaviour.
  const canWrite = graph?.can_write !== false;
  const linked = itemId == null ? null : items.find((i) => Number(i.id) === itemId) ?? null;
  const missingItem = status === 'ready' && itemId != null && !linked;
  const back = landingBack({
    projectId: selectedId,
    item: itemId != null && !missingItem ? { id: itemId, objective: linked?.objective } : null,
    from,
  });
  const q = selectedId ? `?project_id=${selectedId}` : '';

  // The dependency view is the items that are IN the graph — either end of a link.
  const inGraph = useMemo(
    () => items.filter((i) => (i.blocks || []).length > 0 || (i.blocked_by || []).length > 0),
    [items],
  );

  // Arriving, focus goes to the h1, or to the item the page was opened from once its row is drawn.
  const headingRef = useRef(null);
  const rowRef = useRef(null);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    if (itemId == null || missingItem || view !== 'quarters') {
      if (headingRef.current?.focus) { focused.current = true; headingRef.current.focus(); }
      return;
    }
    if (rowRef.current?.focus) { focused.current = true; rowRef.current.focus(); }
  });

  const refresh = async () => { if (selectedId) setGraph(await api.roadmapGraph(selectedId)); };
  const handlers = canWrite ? { newScenario: () => setDialog({ kind: 'scenario', scenario: null }) } : {};
  const zero = status === 'ready' && items.length === 0;
  const primary = status !== 'ready' || zero || !canWrite ? null
    : view === 'dependencies' && items.length >= 2 ? <button type="button" className="fb-roadmap-primary" data-testid="button-open-dependencies" onClick={() => setDialog({ kind: 'dependencies' })}>Edit dependency links</button>
      : view === 'scenarios' ? <button type="button" className="fb-roadmap-primary" data-testid="button-new-scenario" onClick={() => setDialog({ kind: 'scenario', scenario: null })}>New scenario</button>
        : null;

  return (
    <main className="fb-roadmap" data-testid="founder-build-roadmap">
      <div className="fb-roadmap-shell">
        <section className="fb-roadmap-main">
          <header className="fb-roadmap-header">
            <nav className="fb-roadmap-crumb" aria-label="Breadcrumb">
              <Link to={`/build${q}`}><ArrowLeft size={13} /> Build</Link><span>/</span>
              <Link to={`/build/product-roadmap${q}`}>Product roadmap</Link><span>/</span><strong>{DOOR}</strong>
            </nav>
            <Link className="fb-roadmap-back" to={back.href} state={back.focus ? { roadmapFocus: back.focus } : undefined} data-testid="link-roadmap-back">
              <span aria-hidden="true">‹</span> {back.label}
            </Link>
            <div className="fb-roadmap-title-row">
              <div>
                <h1 ref={headingRef} tabIndex={-1} data-testid="text-roadmap-heading">{DOOR}</h1>
                <p className="fb-roadmap-subtitle">{LANDING_SUB}</p>
              </div>
              {primary}
            </div>
            {!zero && status !== 'empty' && (
              <ZoneToolbar
                filters={founderZoneFilters('build/roadmap', { value: view, onChange: setView })}
                actions={founderZoneActions('build/roadmap', {
                  query: q,
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
            )}
          </header>

          {refused && selectedProject && (
            <div className="fb-roadmap-notice" role="status" data-testid="status-roadmap-refused">
              <AlertCircle size={16} />
              <div><strong>Project {refused} isn’t one you can open</strong><p>Showing {text(selectedProject.name)}, your first venture. Back goes to Product roadmap for {text(selectedProject.name)}.</p></div>
            </div>
          )}
          {status === 'error' && <div className="fb-roadmap-alert" role="alert" data-testid="status-roadmap-error"><AlertCircle size={16} /><span>Unavailable · {error} Nothing is shown as 0.</span><button type="button" onClick={load} data-testid="button-retry-roadmap"><RefreshCw size={13} /> Retry</button></div>}
          {status === 'loading' && <RoadmapSkeleton />}
          {status === 'empty' && <EmptyRoadmap />}
          {status === 'ready' && selectedProject && zero && <ZeroItems projectId={selectedId} canWrite={canWrite} />}
          {status === 'ready' && selectedProject && !zero && (
            <>
              <div className="fb-roadmap-context">
                <div><span className="fb-roadmap-label">Venture</span><strong data-testid="text-roadmap-project">{text(selectedProject.name)}</strong><span>Kept from the link you followed</span></div>
                <div className="fb-roadmap-context-right"><span className="fb-roadmap-label">Opened from</span><strong data-testid="text-roadmap-from">{linked ? `Product roadmap · ${linked.objective}` : 'Product roadmap'}</strong><span>Back returns there · week of {weekRange()}</span></div>
              </div>
              {missingItem && (
                <p className="fb-roadmap-notice" role="status" data-testid="status-roadmap-item-missing">Item {itemId} is not on this venture’s roadmap, so nothing is highlighted.</p>
              )}
              {!canWrite && (
                <p className="fb-roadmap-notice" role="status" data-testid="status-roadmap-read-only">
                  <span className="fb-roadmap-status status-neutral">⊘ Read only</span> You can read this venture. Edit dependency links and New scenario are not offered.
                </p>
              )}
              <Relation linked={linked} />
              <div className="fb-roadmap-stat-strip">
                <Stat label="Items" value={stats.items} note={stats.quarters ? `across ${stats.quarters} recorded quarter${stats.quarters === 1 ? '' : 's'}` : 'Quarter not recorded'} />
                <Stat
                  label="Dependencies"
                  value={stats.dependencies}
                  note={stats.dependencies ? `${stats.unresolved} unresolved` : 'No link recorded yet'}
                  muted={!stats.dependencies}
                />
                <Stat label="Saved scenarios" value={stats.scenarios} note={stats.scenarios ? 'Compared, never applied' : 'None saved yet'} muted={!stats.scenarios} />
                {/* `At risk` WAS THE FOURTH CARD AND IS NOT A NUMBER. `okrGraph.ts`
                    carries the proof that the obvious derivation is always empty;
                    `Blocked` is what the graph can honestly say. */}
                <Stat label="Blocked" value={stats.blocked} note={stats.blocked ? 'Waiting on an unfinished item' : 'Nothing is waiting on anything'} muted={!stats.blocked} />
              </div>

              {view === 'scenarios' ? (
                <ScenarioList
                  scenarios={scenarios}
                  canWrite={canWrite}
                  onOpen={(scenario) => setDialog({ kind: 'scenario', scenario })}
                  onNew={() => setDialog({ kind: 'scenario', scenario: null })}
                />
              ) : view === 'dependencies' ? (
                <section className="fb-roadmap-card fb-roadmap-instrument" data-testid="card-dependencies">
                  <div className="fb-roadmap-card-head">
                    <div><GitBranch size={16} /><h2>Dependency chain</h2></div>
                    <span>{stats.dependencies} link{stats.dependencies === 1 ? '' : 's'} · {stats.unresolved} unresolved</span>
                  </div>
                  {inGraph.length ? (
                    <div className="fb-roadmap-table-wrap">
                      <table><thead><tr><th>Item</th><th>Quarter</th><th>State</th><th>Blocks</th></tr></thead>
                        <tbody>{inGraph.map((item) => <RoadmapRow key={item.id} item={item} />)}</tbody>
                      </table>
                    </div>
                  ) : (
                    // TWO DISTINCT EMPTY STATES, because they are different
                    // problems: no objectives at all, versus objectives with no
                    // links between them.
                    <div className="fb-roadmap-inline-empty" data-testid="empty-dependencies">
                      <GitBranch size={18} />
                      <div>
                        <strong>No dependency link is recorded.</strong>
                        <p>
                          {`All ${items.length} item${items.length === 1 ? '' : 's'} stand on their own so far. Record a link and the blocked one starts showing as Blocked here.`}
                        </p>
                        {canWrite && items.length >= 2 && (
                          <button type="button" data-testid="button-empty-add-dependency" onClick={() => setDialog({ kind: 'dependencies' })}>
                            Record a link
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="fb-roadmap-note">
                    A link resolves when its blocker reaches Done on Product roadmap. <strong>Blocked</strong> is
                    derived: the item has at least one link from something that is not Done.
                    Nothing is inferred from item names or from the order they were written in.
                  </p>
                </section>
              ) : (
                <QuarterView items={items} highlighted={linked} rowRef={rowRef} projectId={selectedId} canWrite={canWrite} />
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

/** BLR02: one record, two placements. Open by default; on a phone it folds (BLR07B). */
function Relation({ linked }) {
  return (
    <details className="fb-roadmap-card fb-roadmap-relation" open data-testid="card-roadmap-relation">
      <summary><h2>How this relates to Now, Next and Later</h2></summary>
      <p className="fb-roadmap-relation-lead">{linked ? `${linked.objective} is one record with two placements.` : 'Each item is one record with two placements.'}</p>
      <dl>
        <div><dt>Now · Next · Later</dt><dd>The order you work in. Set on Product roadmap, with the target date, owner, theme and KPI.</dd></div>
        <div><dt>Quarter and key results</dt><dd>When you aim to finish it and how you’ll know. The quarter is set with Edit on the item in Product roadmap.</dd></div>
        <div><dt>Dependencies and scenarios</dt><dd>What waits on what, and where items would land instead. Set here; a scenario never moves an item.</dd></div>
      </dl>
    </details>
  );
}

/** BLR02: By quarter, calendar order, No quarter recorded as its own group; the linked item highlighted. */
function QuarterView({ items, highlighted, rowRef, projectId, canWrite }) {
  const { quarters, none } = quarterGroups(items);
  const row = (item) => {
    const on = highlighted && Number(highlighted.id) === Number(item.id);
    return <QuarterRow key={item.id} item={item} on={on} rowRef={on ? rowRef : undefined} projectId={projectId} />;
  };
  return (
    <section className="fb-roadmap-card fb-roadmap-instrument" data-testid="card-quarters">
      <div className="fb-roadmap-card-head">
        <div><GitBranch size={16} /><h2>By quarter</h2></div>
        <span>{items.length} item{items.length === 1 ? '' : 's'} · {quarters.length} recorded quarter{quarters.length === 1 ? '' : 's'} · source order within a quarter</span>
      </div>
      {quarters.map((g) => (
        <section key={g.key} className="fb-roadmap-quarter" data-testid="roadmap-quarter" aria-label={g.label}>
          <h3>{g.label}<small>{g.range ? `${g.range} · ` : ''}{g.items.length} item{g.items.length === 1 ? '' : 's'}</small></h3>
          <ul>{g.items.map(row)}</ul>
        </section>
      ))}
      {none.length > 0 && (
        <section className="fb-roadmap-quarter is-none" data-testid="roadmap-quarter-none" aria-label="No quarter recorded">
          <h3>No quarter recorded<small>{none.length} item{none.length === 1 ? '' : 's'} · <span className="fb-roadmap-status status-neutral">○ Not recorded</span></small></h3>
          <ul>{none.map(row)}</ul>
          {canWrite && (
            <p className="fb-roadmap-note">
              Set a quarter with Edit on the item: {none.map((item, i) => (
                <span key={item.id}>{i ? ', ' : ''}<Link to={itemSheetHref(projectId, item.id) || '#'} data-testid={`link-set-quarter-${item.id}`}>{text(item.objective)}</Link></span>
              ))}.
            </p>
          )}
        </section>
      )}
    </section>
  );
}

function QuarterRow({ item, on, rowRef, projectId }) {
  const horizon = horizonOf(item.kanban_status);
  const blocks = (item.blocks || []).map((b) => b.objective);
  return (
    <li ref={rowRef} tabIndex={on ? -1 : undefined} aria-current={on ? 'true' : undefined} className={on ? 'is-current' : undefined} data-testid={`row-quarter-item-${item.id}`}>
      <div>
        <Link to={itemSheetHref(projectId, item.id) || '#'}><strong>{text(item.objective)}</strong></Link>
        {on && <span className="fb-roadmap-status status-active" data-testid="text-roadmap-opened-from">Opened from Product roadmap</span>}
      </div>
      <div className="fb-roadmap-quarter-tags">
        <span className="fb-roadmap-status status-neutral" data-testid={`text-horizon-${item.id}`}>↦ {horizon || 'No column'}</span>
        <span className={`fb-roadmap-status status-${TONE[item.state] || 'neutral'}`}>
          {item.state === 'blocked' && (item.blocked_by || []).length ? `Blocked · waits on ${item.blocked_by.map((b) => b.objective).join(', ')}` : text(item.state_label)}
        </span>
        {blocks.length > 0 && <span className="fb-roadmap-status status-neutral">→ Blocks {blocks.join(', ')}</span>}
      </div>
      <small>{dueText(item.target_date)} · {item.owner || 'No owner'}</small>
    </li>
  );
}

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

function ScenarioList({ scenarios, canWrite, onOpen, onNew }) {
  return (
    <section className="fb-roadmap-card fb-roadmap-instrument" data-testid="card-scenarios">
      <div className="fb-roadmap-card-head">
        <div><GitBranch size={16} /><h2>Saved scenarios</h2></div>
        <span>{scenarios.length} saved · compared, never applied</span>
      </div>
      {scenarios.length === 0 ? (
        <div className="fb-roadmap-inline-empty" data-testid="empty-scenarios">
          <CircleDot size={18} />
          <div>
            <strong>No scenario is saved.</strong>
            <p>A scenario is a named what-if: where each item would land instead. It sits beside the roadmap and never moves anything on it.</p>
            {canWrite && <button type="button" data-testid="button-empty-new-scenario" onClick={onNew}>New scenario</button>}
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
                    ? 'Moves nothing — every item is already where this scenario puts it'
                    : `Moves ${s.moves_count} item${s.moves_count === 1 ? '' : 's'}`}
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
              {canWrite && <button type="button" data-testid={`button-scenario-open-${s.id}`} onClick={() => onOpen(s)}>Edit</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="fb-roadmap-note">A scenario sits beside the roadmap. Nothing on Product roadmap moves; Now, Next and Later stay as they are.</p>
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
      <p className="fb-roadmap-note">Items and their quarters are edited on Product roadmap. Links and scenarios are edited here.</p>
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
    coverageNote={project ? 'Items, quarters, links and saved scenarios are available for review.' : 'Select a startup to read its roadmap.'}
    unavailable={[
      // Corrected with the store: the old pair claimed there was no scenario
      // source and no dependency graph. Both exist now, so what is genuinely
      // absent is the reasoning over them.
      ['Risk assessment', 'Nothing records why or when an objective became stuck, so no risk can be derived from the graph.'],
      ['Scenario reasoning', 'Scenarios are compared arithmetically here; no model is asked which one to take.'],
    ]}
    footer="Items edited on Product roadmap · links and scenarios edited here"
  />;
}

/** BLR05B: no item yet. One action, on Product roadmap, never a third editor. */
function ZeroItems({ projectId, canWrite }) {
  return (
    <div className="fb-roadmap-empty" data-testid="empty-roadmap-items">
      <CircleDot size={24} />
      <h2>No roadmap items yet.</h2>
      <p>Quarters, dependencies and scenarios are drawn from the items on Product roadmap. Add the first one there; it lands in Next.</p>
      {canWrite
        ? <Link className="fb-roadmap-primary" to={addFirstHref(projectId)} data-testid="link-roadmap-add-first">Add the first item</Link>
        : <p data-testid="text-roadmap-zero-read-only">You can read this venture; its founder adds the items.</p>}
    </div>
  );
}

function EmptyRoadmap() { return <div className="fb-roadmap-empty" data-testid="empty-roadmap"><GitBranch size={24} /><h2>No venture is available</h2><p>Quarters, dependencies and scenarios belong to a venture. Create one in Build first.</p><Link to="/build">Back to Build</Link></div>; }
function RoadmapSkeleton() { return <div className="fb-roadmap-loading" data-testid="status-roadmap-loading" role="status" aria-label="Loading quarters, dependencies and scenarios"><i /><i /><div><i /><i /><i /><i /></div></div>; }
