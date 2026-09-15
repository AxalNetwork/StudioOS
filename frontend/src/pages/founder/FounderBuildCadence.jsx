import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CalendarClock, CircleDot, Plus, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { text } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import './founderBuildCadence.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { dayLabel, kindLabel, todayIso, WEEKDAYS } from '../../lib/cadence';
import { RitualDialog, RunDialog, TemplatesDialog } from './CadenceDialogs';

/**
 * FB4 — Build · Cadence, the FEED.
 *
 * WHAT CHANGED AND WHY THE OLD PAGE IS GONE. This zone used to load the project
 * list, no second source, and render the repo's generic unavailable treatment:
 * four "Unavailable" stat cards, a "Review archive" card whose body was a
 * paragraph about missing APIs, and a "Capability coverage" list of three
 * Unavailable rows. Its four filter chips and three ops were all registered
 * `unbuilt`, which renders NOTHING — so the toolbar the artboard draws was empty
 * and the page explained, three times over, that it could not work. Task #176
 * called it the largest of the five Build gaps and it was.
 *
 * Migration 250 and `routes/founder_cadence.ts` give it rituals, runs and
 * templates. Everything the old page said was unavailable is now read from those,
 * and the sentences that claimed otherwise are deleted rather than softened — a
 * page that says "source unavailable" beside a working source is worse than one
 * that says nothing.
 *
 * THE ONE SENTENCE THAT SURVIVES, because it is still true and still load-bearing:
 * a calendar event is not treated as an operating ritual, and a roadmap change is
 * not treated as a review outcome. The store is what a founder wrote down. An
 * archive assembled from side effects would report a cadence nobody ran.
 *
 * WHY THE EMPTY STATE IS NOT THE OLD EMPTY STATE. With the store present and no
 * rows in it, the honest thing to say is "nothing has been filed yet" and to put
 * the control that files something next to it — not to describe the absence of a
 * capability. The distinction is the whole of #180: a built feature waiting on
 * data and a feature that does not exist read identically if you let them.
 */


/**
 * Which runs each chip keeps. The keys are `founderZoneFilters`' four keys.
 *
 * IN THE PAGE, NOT THE SHARED MODULE, AND A GUARD IS WHY. `zoneFilterBuilder`'s
 * contract is that the table owns the labels and the PAGE owns the predicate
 * (`FounderValidateWorkspace`'s `PAIN_VIEWS` is the same shape), and
 * `profile_zone_filters.test.mjs` proves a live filter key appears in the page
 * that would have to serve it. With these four in `lib/cadence.js` the keys were
 * nowhere in this file and that guard failed — correctly: a page that never names
 * a key is a page nothing forces to implement it.
 *
 * THE ROW MIXES TWO AXES ON PURPOSE. `plans` and `retros` select the ritual's
 * KIND; `skipped` selects the run's STATE. So a missed retro is under both and
 * the four counts do not sum to the total. That is the canvas's filter row, and
 * `founder_cadence.ts` exports `CADENCE_VIEWS` with the same four keys so the
 * server's own reading of them cannot drift from this one —
 * `cadence_vocabulary.test.mjs` compares the two.
 */
export const CADENCE_VIEWS = {
  all: () => true,
  plans: (run) => String(run?.ritual_kind) === 'plan',
  retros: (run) => String(run?.ritual_kind) === 'retro',
  skipped: (run) => String(run?.state) === 'missed',
};

/** `weekday` + `frequency` as one phrase, or the part that is recorded. */
function scheduleLabel(ritual) {
  const day = ritual?.weekday == null ? null : WEEKDAYS[Number(ritual.weekday)];
  const freq = String(ritual?.frequency || 'weekly');
  if (day && freq === 'weekly') return `Every ${day}`;
  if (day && freq === 'biweekly') return `Every other ${day}`;
  if (day && freq === 'monthly') return `Monthly, on a ${day}`;
  if (freq === 'weekly') return 'Weekly';
  if (freq === 'biweekly') return 'Every two weeks';
  return 'Monthly';
}

export default function FounderBuildCadence() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(requestedId ? Number(requestedId) : null);
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [cadence, setCadence] = useState(null);
  const [starters, setStarters] = useState([]);
  const [dialog, setDialog] = useState(null); // { kind: 'ritual' | 'run' | 'templates', row? }
  const [opError, setOpError] = useState('');

  const loadCadence = useCallback(async (projectId) => {
    if (!projectId) { setCadence(null); return; }
    const view = await api.getCadence(projectId);
    setCadence(view);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading'); setError('');
    try {
      const available = (await api.listProjects()) || [];
      setProjects(available);
      const requested = Number(requestedId);
      const chosen = available.find((project) => project.id === requested) || available[0];
      setSelectedId(chosen?.id || null);
      if (!chosen) { setStatus('empty'); return; }
      if (String(chosen.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true });
      }
      await loadCadence(chosen.id);
      // The starting points are a constant list the worker owns; a failure to
      // read them costs the "Start from" row and nothing else, so it must not
      // fail the page.
      api.getCadenceStarters()
        .then((r) => setStarters(r?.starters || []))
        .catch(() => setStarters([]));
      setStatus('ready');
    } catch (cause) {
      setError(cause?.message || 'The operating cadence could not be loaded.');
      setStatus('error');
    }
  }, [requestedId, setParams, loadCadence]);

  useEffect(() => { load(); }, [load]);

  const project = useMemo(() => projects.find((item) => item.id === selectedId), [projects, selectedId]);
  const query = selectedId ? `?project_id=${selectedId}` : '';

  const runs = cadence?.runs || [];
  const rituals = cadence?.rituals || [];
  const templates = cadence?.templates || [];
  const stats = cadence?.stats || null;

  /** The archive under the selected chip. The predicate is the page's, per D67. */
  const shown = useMemo(() => {
    const keep = CADENCE_VIEWS[filter] || CADENCE_VIEWS.all;
    return runs.filter(keep);
  }, [runs, filter]);

  const counts = useMemo(() => {
    const out = {};
    for (const key of Object.keys(CADENCE_VIEWS)) out[key] = runs.filter(CADENCE_VIEWS[key]).length;
    return out;
  }, [runs]);

  /** `Export archive` — the rows this view is showing, in the columns it shows. */
  const exportPayload = useMemo(() => ({
    scope: project?.name || 'cadence',
    zone: 'cadence',
    header: ['Date', 'Ritual', 'Kind', 'State', 'Length (min)', 'What came out of it'],
    rows: shown,
    cells: (run) => [
      run.run_date, run.ritual_name, kindLabel(run.ritual_kind),
      run.state, run.duration_minutes, run.outcome,
    ],
  }), [shown, project]);

  const afterWrite = useCallback(async () => {
    setDialog(null); setOpError('');
    try { await loadCadence(selectedId); } catch (cause) {
      setOpError(cause?.message || 'Saved, but the view could not be reloaded.');
    }
  }, [loadCadence, selectedId]);

  const removeTemplate = useCallback(async (id) => {
    setOpError('');
    try {
      await api.deleteRitualTemplate(id);
      await loadCadence(selectedId);
    } catch (cause) {
      setOpError(cause?.message || 'The template could not be deleted.');
    }
  }, [loadCadence, selectedId]);

  const actions = founderZoneActions('build/cadence', {
    query,
    view: exportPayload,
    handlers: {
      // Both ops need a venture. `disabled` with a `title` rather than an absent
      // control: the artboard draws three ops and the reader should see three.
      newRitual: {
        onClick: () => { setOpError(''); setDialog({ kind: 'ritual' }); },
        disabled: !selectedId,
        title: selectedId ? undefined : 'Select a startup first — a ritual belongs to one.',
      },
      editTemplates: {
        onClick: () => { setOpError(''); setDialog({ kind: 'templates' }); },
        disabled: !selectedId,
        title: selectedId ? undefined : 'Select a startup first — templates are stored per venture.',
      },
    },
  });

  return (
    <main className="fb-cadence" data-testid="founder-build-cadence">
      <div className="fb-cadence-shell">
        <section className="fb-cadence-main">
          <header className="fb-cadence-header">
            <div className="fb-cadence-crumb">
              <Link to={`/execution${query}`}><ArrowLeft size={13} /> Execution</Link><span>/</span><strong>Cadence</strong>
            </div>
            <div className="fb-cadence-title-row">
              <div>
                <h1>Operating cadence</h1>
                <span>Ritual scheduler, review archive and templates for the selected startup.</span>
              </div>
              {/* The in-body startup picker stays. Task #181 asks for these to go
                  and the ledger in `scripts/inline-project-pickers-baseline.json`
                  freezes all 21 of them, this one included, until the product
                  question behind the deletion is answered — a founder with two
                  startups inside one company has no other way to switch here. */}
            </div>
            <nav aria-label="Build sections">
              <Link to={`/build/this-week${query}`}>This week</Link>
              <Link to={`/build/board${query}`}>Board</Link>
              <Link to={`/build/roadmap${query}`}>Roadmap</Link>
              <Link to={`/build/cadence${query}`} className="is-active">Cadence</Link>
              <Link to={`/build/kpi${query}`}>KPI entry</Link>
            </nav>
            <ZoneToolbar
              filters={founderZoneFilters('build/cadence', { value: filter, onChange: setFilter, counts })}
              actions={actions}
            />
          </header>

          {status === 'error' && (
            <div className="fb-cadence-alert" role="alert">
              <AlertCircle size={16} /><span>{error}</span>
              <button type="button" onClick={load}><RefreshCw size={13} /> Retry</button>
            </div>
          )}
          {opError && <div className="fb-cadence-alert" role="alert"><AlertCircle size={16} /><span>{opError}</span></div>}
          {status === 'loading' && <CadenceSkeleton />}
          {status === 'empty' && <EmptyCadence />}

          {status === 'ready' && project && (
            <>
              <div className="fb-cadence-context">
                <div>
                  <span>Selected startup</span>
                  <strong data-testid="text-cadence-project">{text(project.name)}</strong>
                  <small>{text(project.sector, 'Sector not recorded')}</small>
                </div>
                <div>
                  <span>Record source</span>
                  <strong data-testid="text-cadence-source">
                    {rituals.length === 1 ? '1 ritual on record' : `${rituals.length} rituals on record`}
                  </strong>
                  <small>
                    {stats?.runs_recorded
                      ? `${stats.runs_recorded} ${stats.runs_recorded === 1 ? 'review' : 'reviews'} filed by hand`
                      : 'Nothing filed yet'}
                  </small>
                </div>
              </div>

              <div className="fb-cadence-stats">
                <Stat
                  label="Reviews archived"
                  value={stats?.runs_recorded ? String(stats.runs_recorded) : null}
                  note={stats?.runs_recorded ? 'Filed on this venture' : 'Nothing filed yet'}
                />
                <Stat
                  label="Adherence"
                  value={stats?.adherence_pct == null ? null : `${stats.adherence_pct}%`}
                  // The denominator is printed with the figure. Adherence over
                  // three runs and over three hundred are different claims, and a
                  // bare percentage hides which one this is.
                  note={stats?.adherence_pct == null
                    ? 'Needs a done or missed run'
                    : `${stats.done} done · ${stats.missed} missed`}
                />
                <Stat
                  label="Templates"
                  value={templates.length ? String(templates.length) : null}
                  note={templates.length
                    ? `${stats?.templates_customised || 0} customised`
                    : 'None stored'}
                />
                <Stat
                  label="Avg retro length"
                  value={stats?.avg_retro_minutes == null ? null : `${stats.avg_retro_minutes} min`}
                  note={stats?.retro_target_minutes
                    ? `target ${stats.retro_target_minutes}`
                    : 'No target set'}
                />
              </div>

              {/* ── The FEED: the review archive, newest first ── */}
              <section className="fb-cadence-card">
                <div className="fb-cadence-card-head">
                  <div><CalendarClock size={16} /><h2>Review archive</h2></div>
                  <span>{shown.length === runs.length ? 'Newest first' : `${shown.length} of ${runs.length}`}</span>
                </div>

                {runs.length === 0 ? (
                  <div className="fb-cadence-empty-feed" data-testid="cadence-archive-empty">
                    <CircleDot size={19} />
                    <div>
                      <strong>Nothing has been filed yet.</strong>
                      <p>
                        The store is here — a review is a ritual, a date, whether it
                        happened and what came out of it. File the first one and the
                        four figures above start reporting.
                      </p>
                      <button
                        type="button"
                        className="fb-cadence-inline-op"
                        data-testid="button-file-first-review"
                        disabled={!rituals.some((r) => Number(r.active ?? 1) === 1)}
                        title={rituals.some((r) => Number(r.active ?? 1) === 1)
                          ? undefined
                          : 'Add a ritual first — a review belongs to one.'}
                        onClick={() => { setOpError(''); setDialog({ kind: 'run' }); }}
                      >
                        <Plus size={12} /> File a review
                      </button>
                    </div>
                  </div>
                ) : shown.length === 0 ? (
                  <div className="fb-cadence-empty-feed" data-testid="cadence-archive-filtered-empty">
                    <CircleDot size={19} />
                    <div>
                      <strong>No review matches this filter.</strong>
                      <p>{runs.length} {runs.length === 1 ? 'review is' : 'reviews are'} on record under the other chips.</p>
                    </div>
                  </div>
                ) : (
                  <div className="fb-cadence-table-wrap">
                    <table className="fb-cadence-table" data-testid="cadence-archive">
                      <thead>
                        <tr><th>Date</th><th>Ritual</th><th>State</th><th>What came out of it</th><th aria-label="Edit" /></tr>
                      </thead>
                      <tbody>
                        {shown.map((run) => (
                          <tr key={run.id} data-testid={`cadence-run-${run.id}`}>
                            <td>{dayLabel(run.run_date)}</td>
                            <td>
                              <strong>{text(run.ritual_name, 'Ritual removed')}</strong>
                              <small>{kindLabel(run.ritual_kind)}{run.duration_minutes ? ` · ${run.duration_minutes} min` : ''}</small>
                            </td>
                            <td>
                              <span className={run.state === 'missed' ? 'fb-cadence-pill is-missed' : 'fb-cadence-pill'}>
                                {run.state === 'missed' ? 'Missed' : 'Done'}
                              </span>
                            </td>
                            {/* An unannotated run says so rather than showing a
                                blank cell — the archive's whole value is the
                                fourth column, so its absence is the finding. */}
                            <td>{text(run.outcome, run.state === 'missed' ? 'Skipped. No note left.' : 'Nothing written down.')}</td>
                            <td>
                              <button
                                type="button"
                                data-testid={`button-run-edit-${run.id}`}
                                onClick={() => { setOpError(''); setDialog({ kind: 'run', row: run }); }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="fb-cadence-note">
                  A calendar event is not treated as an operating ritual, and roadmap
                  changes are not treated as review outcomes. The archive is what
                  someone wrote down — which is what makes it auditable.
                </p>
              </section>

              {/* ── The schedule the archive is measured against ── */}
              <section className="fb-cadence-card">
                <div className="fb-cadence-card-head">
                  <div><CalendarClock size={16} /><h2>The cadence</h2></div>
                  <span>{rituals.filter((r) => Number(r.active ?? 1) === 1).length} active</span>
                </div>
                {rituals.length === 0 ? (
                  <div className="fb-cadence-empty-feed" data-testid="cadence-rituals-empty">
                    <CircleDot size={19} />
                    <div>
                      <strong>No ritual is on record.</strong>
                      <p>A cadence is the standing intentions — a Monday plan, a Friday retro. Add the first with “New ritual” above.</p>
                    </div>
                  </div>
                ) : (
                  <ul className="fb-cadence-rituals" data-testid="cadence-rituals">
                    {rituals.map((ritual) => (
                      <li key={ritual.id} className={Number(ritual.active ?? 1) === 1 ? '' : 'is-retired'}>
                        <div>
                          <strong>{text(ritual.name)}</strong>
                          <small>
                            {kindLabel(ritual.kind)} · {scheduleLabel(ritual)}
                            {ritual.target_minutes ? ` · target ${ritual.target_minutes} min` : ''}
                            {Number(ritual.active ?? 1) === 1 ? '' : ' · retired'}
                          </small>
                        </div>
                        <div className="fb-cadence-rituals-ops">
                          <button
                            type="button"
                            data-testid={`button-ritual-log-${ritual.id}`}
                            disabled={Number(ritual.active ?? 1) !== 1}
                            title={Number(ritual.active ?? 1) === 1 ? undefined : 'Retired rituals keep their archive but take no new runs.'}
                            onClick={() => {
                              setOpError('');
                              setDialog({ kind: 'run', row: { ritual_id: ritual.id, run_date: todayIso() } });
                            }}
                          >
                            File
                          </button>
                          <button
                            type="button"
                            data-testid={`button-ritual-edit-${ritual.id}`}
                            onClick={() => { setOpError(''); setDialog({ kind: 'ritual', row: ritual }); }}
                          >
                            Edit
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </section>
        <CadenceRail project={project} stats={stats} runs={runs} />
      </div>

      {dialog?.kind === 'ritual' && (
        <RitualDialog
          ritual={dialog.row}
          templates={templates}
          onClose={() => setDialog(null)}
          onSave={async (data) => {
            if (dialog.row?.id) await api.updateRitual(dialog.row.id, data);
            else await api.createRitual(selectedId, data);
            await afterWrite();
          }}
        />
      )}
      {dialog?.kind === 'run' && (
        <RunDialog
          run={dialog.row}
          rituals={rituals}
          onClose={() => setDialog(null)}
          onSave={async (data) => {
            if (dialog.row?.id) await api.updateRitualRun(dialog.row.id, data);
            else await api.logRitualRun(selectedId, data);
            await afterWrite();
          }}
        />
      )}
      {dialog?.kind === 'templates' && (
        <TemplatesDialog
          templates={templates}
          starters={starters}
          onClose={() => setDialog(null)}
          onCreate={async (data) => { await api.createRitualTemplate(selectedId, data); await loadCadence(selectedId); }}
          onUpdate={async (id, data) => { await api.updateRitualTemplate(id, data); await loadCadence(selectedId); }}
          onDelete={removeTemplate}
        />
      )}
    </main>
  );
}

/**
 * One stat card. A null value reads "Not yet" rather than "Unavailable".
 *
 * The word matters and it is the whole of #180: "Unavailable" says the platform
 * cannot answer, which was true of this zone until migration 250 and is now
 * false. "Not yet" says the account has not got there, which is what an empty
 * archive actually means.
 */
function Stat({ label, value, note }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value == null ? 'Not yet' : value}</strong>
      <small>{note}</small>
    </div>
  );
}

function CadenceRail({ project, stats, runs }) {
  const unannotated = (runs || []).filter((r) => r.state === 'done' && !String(r.outcome || '').trim()).length;
  return (
    <WorkerRail
      workspace="Build"
      className="fb-cadence-rail"
      stance="Reads the archive"
      note="This rail reports what the stored cadence says. It does not draft retros, create rituals, alter templates, or file review summaries — every row in the archive was written by a person."
      coverage={[project ? text(project.name) : 'No project selected']}
      coverageNote={project
        ? `${stats?.runs_recorded || 0} reviews, ${stats?.templates || 0} templates on record.`
        : 'Select a startup to inspect coverage.'}
      unavailable={[
        ['Retro summary', 'A summary the platform wrote is not a review someone held; nothing here drafts one.'],
        ['Schedule reasoning', 'The cadence is the founder’s to set; nothing here proposes a change to it.'],
      ]}
      footer={unannotated
        ? `${unannotated} filed ${unannotated === 1 ? 'review has' : 'reviews have'} no outcome written down`
        : 'Read-only summary · no automated actions'}
    />
  );
}

function EmptyCadence() {
  return (
    <div className="fb-cadence-no-project">
      <CalendarClock size={24} />
      <h2>No startup is available</h2>
      <p>Cadence is scoped to an authenticated startup.</p>
      <Link to="/execution">Back to execution</Link>
    </div>
  );
}

function CadenceSkeleton() {
  return <div className="fb-cadence-loading"><i /><i /><div><i /><i /><i /><i /></div></div>;
}
