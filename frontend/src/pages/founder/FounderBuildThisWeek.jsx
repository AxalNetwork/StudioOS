import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, CircleDot, ClipboardCheck, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { text } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import './founderBuildThisWeek.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';


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
  const [weeks, setWeeks] = useState(null);
  const [view, setView] = useState('now');
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
      // The week windows are a SEPARATE read and a soft one. Without them the page
      // is what it was — the Now column — rather than broken, so a failure here
      // costs three chips and not the zone.
      const [result, windows] = await Promise.all([
        api.listOkrs(chosen.id),
        api.listOkrWeeks(chosen.id).catch(() => null),
      ]);
      setOkrs(result?.okrs || []);
      setWeeks(windows);
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The weekly commitment record could not be loaded.');
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, [requestedId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId]);
  const nowObjectives = useMemo(() => okrs.filter((item) => item.kanban_status === 'now'), [okrs]);

  /**
   * Which objectives each chip keeps.
   *
   * ALL FOUR ARE LIVE AS OF MIGRATION 252, and three of them were `unbuilt` under
   * one reason: a key result carried no week, and nothing recorded a commitment
   * moving from one week to the next. `okr_column_moves` records the transitions
   * and `GET /progress/roadmap/:id/weeks` derives the windows; the sets arrive as
   * IDS, so this page intersects them with the OKRs it already has rather than
   * being sent the same rows four times.
   *
   * `now` NEEDS NO HISTORY — it is the current column — which is why it kept
   * working while the other three could not.
   */
  const VIEWS = useMemo(() => {
    const ids = (key) => new Set((weeks?.[key] || []).map(Number));
    return {
      now: () => nowObjectives,
      recent: () => { const s = ids('last_four'); return okrs.filter((o) => s.has(Number(o.id))); },
      all: () => { const s = ids('ever_committed'); return okrs.filter((o) => s.has(Number(o.id))); },
      carried: () => { const s = ids('carried'); return okrs.filter((o) => s.has(Number(o.id))); },
    };
  }, [okrs, nowObjectives, weeks]);

  const shownObjectives = useMemo(() => (VIEWS[view] || VIEWS.now)(), [VIEWS, view]);
  const counts = useMemo(() => {
    const out = {};
    for (const key of Object.keys(VIEWS)) out[key] = VIEWS[key]().length;
    // `All weeks` labels itself with the number of WEEKS on record, not the number
    // of objectives — the canvas's chip is "All 14", meaning fourteen weeks.
    out.all = weeks?.weeks?.length || 0;
    return out;
  }, [VIEWS, weeks]);

  const commitments = useMemo(() => shownObjectives.flatMap((objective) => (objective.key_results || [])
    .filter((result) => text(result.text, '').trim())
    .map((result, index) => ({ ...result, id: `${objective.id}-${index}`, objective: objective.objective }))), [shownObjectives]);
  const progressRecorded = commitments.filter((item) => item.current !== null && item.current !== undefined).length;
  const carriedCount = (weeks?.carried || []).length;

  return (
    <main className="fb-week" data-testid="founder-build-this-week">
      <div className="fb-week-shell">
        <section className="fb-week-main">
          <header className="fb-week-header">
            <div className="fb-week-crumb"><Link to="/execution" data-testid="link-week-back"><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>This week</strong></div>
            <div className="fb-week-title-row">
              <div><h1>This week · {weekRange()}</h1><p className="fb-week-subtitle">Current commitments read from the selected startup's roadmap.</p></div>
            </div>
            <nav className="fb-week-zone-nav" aria-label="Build sections">
              <Link to={`/build/this-week${selectedId ? `?project_id=${selectedId}` : ''}`} className="is-active" data-testid="link-week-zone">This week</Link>
              <Link to={`/build/board${selectedId ? `?project_id=${selectedId}` : ''}`}>Board</Link>
              <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Roadmap</Link>
              <Link to={`/build/cadence${selectedId ? `?project_id=${selectedId}` : ''}`}>Cadence</Link>
              <Link to={`/build/kpi${selectedId ? `?project_id=${selectedId}` : ''}`}>KPI entry</Link>
            </nav>
            <ZoneToolbar
              filters={founderZoneFilters('build/this-week', { value: view, onChange: setView, counts })}
              actions={founderZoneActions('build/this-week', { query: selectedId ? `?project_id=${selectedId}` : '', view: { scope: selectedProject?.name, header: ['Commitment', 'Objective', 'Current', 'Target', 'Unit'], rows: commitments, cells: (r) => [r.text, r.objective, r.current, r.target, r.unit] } })}
            />
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
                {/* WAS `value="Unavailable"` WITH THE NOTE "No cadence history
                    source". Migration 252 is that source. The figure is weeks on
                    record, and it reads "Not yet" rather than "Unavailable" while
                    the log is empty: the platform can answer; nothing has moved on
                    the board since the log started. #180's distinction exactly. */}
                <Stat
                  label="Weeks on record"
                  value={weeks?.weeks?.length ? weeks.weeks.length : 'Not yet'}
                  note={weeks?.history_since
                    ? `since the week of ${weeks.history_since}${carriedCount ? ` · ${carriedCount} carried` : ''}`
                    : 'No column move has been logged yet'}
                  muted={!weeks?.weeks?.length}
                />
              </div>
              <section className="fb-week-card fb-week-instrument">
                <div className="fb-week-card-head"><div><ClipboardCheck size={16} /><h2>Current commitment records</h2></div><span>{commitments.length} stored key result{commitments.length === 1 ? '' : 's'}</span></div>
                {/* The three filter buttons that stood here moved into the zone
                    header's ZoneToolbar, which is where the canvas draws them.
                    Two of the three were `disabled` — a greyed control is still
                    a promise, and `ZoneActions.jsx` has refused to draw one for
                    actions since it was written. They are prose now, and they
                    say what is missing: no week is stamped on a key result. */}
                <div className="fb-week-toolbar"><Link className="fb-week-secondary-action" to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Review roadmap</Link></div>
                {commitments.length ? <div className="fb-week-table-wrap"><table><thead><tr><th>Commitment</th><th>Objective</th><th>Progress</th><th>State</th><th>Source</th></tr></thead><tbody>{commitments.map((item) => <CommitmentRow key={item.id} item={item} />)}</tbody></table></div> : <div className="fb-week-inline-empty" data-testid="week-empty"><CircleDot size={18} /><div>
                  {/* TWO DIFFERENT EMPTIES, SAID DIFFERENTLY. "Nothing in Now" is a
                      roadmap the founder has not filled; "nothing in the last four
                      weeks" over a log that starts later is the HISTORY being young,
                      not the answer being none. Collapsing them is how an empty set
                      reads as an answer. */}
                  <strong>{view === 'now'
                    ? 'No current commitments are recorded.'
                    : 'No commitment matches this window.'}</strong>
                  <p>{view === 'now'
                    ? 'This desk does not invent a Monday plan. Add Now objectives and key results in Roadmap.'
                    : weeks?.history_since
                      ? `The column history starts in the week of ${weeks.history_since}. Anything committed before then is in Now without a logged move.`
                      : 'No column move has been logged yet — the history starts the first time an objective moves on the board.'}</p>
                  <Link to={`/build/roadmap${selectedId ? `?project_id=${selectedId}` : ''}`}>Open roadmap</Link>
                </div></div>}
                {/* THIS SENTENCE NAMED CARRY-OVER HISTORY AS ABSENT AND IS NOW
                    HALF WRONG, so only the half that is still true survives.
                    Migration 252 logs every column move, which is what carry-over
                    is derived from. Outcomes, streaks and retro notes are a
                    different record — they live in the cadence store (migration
                    250), on `/build/cadence`, and are deliberately not restated
                    here. */}
                <p className="fb-week-note">
                  Commitments are stored key results; the week a commitment was made
                  comes from the roadmap's own column history. Progress is shown only
                  when it is stored on the key result, and no completion rate is
                  inferred from a missing value. Outcomes and retro notes are the
                  cadence record, on Cadence.
                </p>
              </section>
              <div className="fb-week-lower-grid"><CommitmentHistory weeks={weeks} /><SourceSummary objectiveCount={nowObjectives.length} commitmentCount={commitments.length} /></div>
            </>
          )}
        </section>
        <PageRail project={selectedProject} commitmentCount={commitments.length} />
      </div>
    </main>
  );
}

function Stat({ label, value, note, muted }) { return <div className={`fb-week-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CommitmentRow({ item }) { const [label, tone] = commitmentState(item); return <tr data-testid={`row-week-commitment-${item.id}`}><td><strong>{text(item.text)}</strong></td><td>{text(item.objective)}</td><td>{formatProgress(item)}</td><td><span className={`fb-week-status status-${tone}`}>{label}</span></td><td><span className="fb-week-source">Roadmap · Now</span></td></tr>; }
/**
 * The weeks on record, newest first.
 *
 * REPLACES a card headed "Weekly history is unavailable" whose body said carry-overs
 * "require a cadence history source that is not connected to this desk". Migration
 * 252 connected one. The card now lists the weeks and names the log's start date,
 * because the one thing a reader needs from a young history is to know it is young.
 */
function CommitmentHistory({ weeks }) {
  const list = weeks?.weeks || [];
  return (
    <section className="fb-week-card">
      <div className="fb-week-card-head">
        <div><CircleDot size={16} /><h2>Commitment history</h2></div>
        <span>{list.length ? `${list.length} week${list.length === 1 ? '' : 's'}` : 'Nothing logged'}</span>
      </div>
      {list.length ? (
        <>
          <ul className="fb-week-history" data-testid="week-history">
            {list.slice(0, 8).map((w) => (
              <li key={w}>
                <span>Week of {w}</span>
                {w === weeks.week_start && <strong>this week</strong>}
              </li>
            ))}
          </ul>
          <p className="fb-week-note">
            A week appears here once an objective moved into or out of a column in it.
            {list.length > 8 ? ` ${list.length - 8} earlier week${list.length - 8 === 1 ? '' : 's'} not shown.` : ''}
          </p>
        </>
      ) : (
        <p className="fb-week-note">
          The history starts the first time an objective moves on the roadmap board.
          Nothing is backfilled — a week inferred from when a row was last edited
          would be a confident wrong answer, and an objective already sitting in Now
          appears under This week without a logged move.
        </p>
      )}
    </section>
  );
}
function SourceSummary({ objectiveCount, commitmentCount }) { return <section className="fb-week-card"><div className="fb-week-card-head"><div><CheckCircle2 size={16} /><h2>Source coverage</h2></div><span>Read-only</span></div><div className="fb-week-source-row"><span>Now objectives</span><strong>{objectiveCount}</strong></div><div className="fb-week-source-row"><span>Key results</span><strong>{commitmentCount}</strong></div><p className="fb-week-note">Progress is shown only when it is stored on the key result. No completion rate is inferred from missing values.</p></section>; }
function PageRail({ project, commitmentCount }) {
  return <WorkerRail
    workspace="Build"
    className="fb-week-rail"
    stance="Manual operating view"
    note="This rail reads stored roadmap records. It does not generate plans, alter commitments, or write to the roadmap."
    coverage={[project ? `${commitmentCount} stored current commitment${commitmentCount === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? 'Current Now key results are available for review.' : 'Select a startup to read its roadmap.'}
    unavailable={[
      // WAS `['Weekly history', 'No cadence archive is returned by the available
      // founder read API.']`, which stopped being true with migration 252. What is
      // genuinely absent is a plan the platform wrote.
      ['AI Monday plan', 'Nothing here proposes a week. A commitment somebody did not make is one nobody will keep.'],
      ['Completion rate', 'Progress is shown only where it is stored on the key result; a rate over missing values would be a figure about the blanks.'],
    ]}
    footer="Read-only summary · no automated actions"
  />;
}
function EmptyWeek() { return <div className="fb-week-empty" data-testid="empty-week"><ClipboardCheck size={24} /><h2>No startup is available</h2><p>This founder desk can only display authenticated roadmap records. There is no project to inspect yet.</p><Link to="/execution">Back to execution</Link></div>; }
function WeekSkeleton() { return <div className="fb-week-loading" data-testid="status-week-loading"><i /><i /><div><i /><i /><i /></div></div>; }