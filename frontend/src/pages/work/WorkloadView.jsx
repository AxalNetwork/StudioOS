// D1614 W6 (#3974) — WK7, a project's Workload: one row per person and per
// agent, one column per week, each item a bar in the week it is scheduled or
// due. A week over a person's recorded capacity is amber; a person with no
// capacity recorded is never "over". Drag a bar to another row to reassign it
// (W1's PATCH); "Schedule work" gives a person's item a time block (W4's
// PATCH). An agent's scheduled sessions (#3957) come in the same read (#3972): each slot is a
// teal bar in its week, never dragged and never opened as a task, and counts as not estimated.
import React, { useCallback, useEffect, useState } from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { capacityBody, isSession, scheduleBody, weekLabel, workloadByRole, workloadRows } from './workModel.js';

/** A project editor drags a bar to another row to reassign it; no one else can, so no one else is told to. */
export const WORKLOAD_LINE = 'Bars sit in the week they are scheduled or due; their label is the estimate. Drag a bar to another row to reassign it.';
export const WORKLOAD_LINE_READ = 'Bars sit in the week they are scheduled or due; their label is the estimate.';

/** Their own, or a project editor's for anyone on the project: the Worker's rule for `PUT /work/capacity/:person`. */
export const canSetCapacity = (viewer, row) => !!viewer && row?.kind === 'person' && !!row.who?.uid && (viewer.can_manage === true || (!!viewer.user_uid && viewer.user_uid === row.who.uid));

export default function WorkloadView({ projectId, viewer = null, onOpenItem, onNotice }) {
  const canManage = viewer?.can_manage === true;
  const [state, setState] = useState({ status: 'loading' });
  const [drag, setDrag] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const r = await workAdapter.workload(projectId, { weeks: 4 });
      // D1614 W8 (#3994): rows grouped by role, from the Team's own read. Without it the rows stay ungrouped.
      let team = null;
      if (r.available) { try { const t = await workAdapter.assignable(projectId); team = t.available ? t.data?.team || [] : null; } catch { team = null; } }
      setState(r.available ? { status: 'ready', data: r.data, team } : { status: 'off', reason: r.reason });
    } catch { setState({ status: 'error' }); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const reassign = async (item, to) => {
    if (!item || !to || to.key === item.from) return;
    try {
      const r = await workAdapter.assign(item.uid, { kind: to.kind, uid: to.who.uid });
      if (!r.available) { onNotice?.(r.reason); return; }
      onNotice?.(`Reassigned “${item.title}” to ${to.who.name || 'them'}.`);
      load();
    } catch (e) { onNotice?.(e?.data?.message || e?.message || 'That could not be reassigned.'); }
  };

  if (state.status === 'loading') return <p className={MUTED} data-testid="work-workload-loading">Reading…</p>;
  if (state.status === 'off') return <HonestBlock>{state.reason}</HonestBlock>;
  if (state.status === 'error') return <HonestBlock>Workload could not be read. That is not the same as nobody having work. <button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button></HonestBlock>;
  const weeks = state.data?.weeks || [];
  const rows = workloadRows(state.data);
  const groups = state.team ? workloadByRole(rows, state.team) : [{ key: 'all', label: null, rows }];
  return (
    <section className="wk-workload" data-testid="work-workload">
      <p className={MUTED}>{canManage ? WORKLOAD_LINE : WORKLOAD_LINE_READ}</p>
      <div role="table" aria-label="Workload" className="wk-wl-grid" style={{ gridTemplateColumns: `200px repeat(${weeks.length}, minmax(140px, 1fr))` }}>
        <div role="row" className="wk-wl-head">
          <span role="columnheader">Person or agent</span>
          {weeks.map((w) => <span key={w} role="columnheader" data-testid="work-workload-week">{weekLabel(w)}</span>)}
        </div>
        {groups.map((g) => (<React.Fragment key={g.key}>
        {g.label ? <div role="row" className="wk-wl-group" data-testid="work-workload-group"><span role="rowheader" style={{ gridColumn: '1 / -1' }}><b>{g.label}</b></span></div> : null}
        {g.rows.map((r) => (
          <div role="row" key={r.key} className="wk-wl-row" data-testid="work-workload-row">
            <span role="rowheader" className="wk-wl-who">
              <b>{r.who?.name || 'Not recorded'}</b>
              <span className={MUTED}>{r.kind === 'agent' ? 'AI agent' : `Capacity · ${r.capacity}`}</span>
              {canSetCapacity(viewer, r) ? (
                <button type="button" className={BTN_SECONDARY} onClick={() => setCapacity({ row: r, text: r.capacityPoints == null ? '' : String(r.capacityPoints) })}
                  data-testid="work-workload-capacity">{r.capacityPoints == null ? 'Set capacity' : 'Change capacity'}</button>
              ) : null}
            </span>
            {r.cells.map((c) => (
              <span key={c.week} role="cell" className="wk-wl-cell" data-over={c.over ? 'true' : undefined} data-testid="work-workload-cell"
                onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (canManage) reassign(drag, r); setDrag(null); }}>
                <span className={MUTED}>{c.load}{c.over ? ' · over capacity' : ''}</span>
                {c.items.map((it) => (isSession(it) ? (
                  <span key={`${it.uid}:${it.when?.at ?? ''}`} className="wk-wl-bar wk-wl-session" data-testid="work-workload-session">
                    {it.title} · agent session
                  </span>
                ) : (
                  <button key={it.uid} type="button" draggable={canManage} className="wk-wl-bar" onDragStart={canManage ? () => setDrag({ ...it, from: r.key }) : undefined}
                    onClick={() => onOpenItem?.(it.uid)} data-testid="work-workload-bar">
                    {it.title}{it.estimate_points == null ? '' : ` · ${it.estimate_points} pts`}
                  </button>
                )))}
              </span>
            ))}
          </div>
        ))}
        </React.Fragment>))}
      </div>
      {rows.some((r) => r.unscheduled.length) ? (
        <div className="wk-wl-unscheduled" data-testid="work-workload-unscheduled">
          <h3 className={MUTED}>Not scheduled yet</h3>
          {rows.filter((r) => r.unscheduled.length).map((r) => (
            <p key={r.key}>
              <b>{r.who?.name || 'Not recorded'}</b>{' · '}
              {r.unscheduled.map((it) => (
                <span key={it.uid}>
                  {it.title}{' '}
                  {r.kind === 'person' ? <button type="button" className={BTN_SECONDARY} onClick={() => setSchedule({ item: it, day: '', from: '09:00', to: '11:00' })} data-testid="work-workload-schedule">Schedule work</button> : null}{' '}
                </span>
              ))}
            </p>
          ))}
        </div>
      ) : null}
      {schedule ? <ScheduleBox s={schedule} onChange={setSchedule} onDone={(msg) => { setSchedule(null); onNotice?.(msg); load(); }} /> : null}
      {capacity ? <CapacityBox projectId={projectId} c={capacity} onChange={setCapacity} onDone={(msg) => { setCapacity(null); onNotice?.(msg); load(); }} /> : null}
    </section>
  );
}

export function ScheduleBox({ s, onChange, onDone }) {
  const [error, setError] = useState(null);
  const save = async () => {
    const b = scheduleBody(s.day, s.from, s.to);
    if (b.error) { setError(b.error); return; }
    try {
      const r = await workAdapter.schedule(s.item.uid, b.body);
      if (!r.available) { setError(r.reason); return; }
      onDone(`“${s.item.title}” is scheduled.`);
    } catch (e) { setError(e?.data?.message || e?.message || 'The time block could not be saved.'); }
  };
  return (
    <div role="group" aria-label={`Schedule ${s.item.title}`} className="wk-wl-schedule" data-testid="work-workload-schedule-box">
      <b>Schedule “{s.item.title}”</b>
      <label>Day <input type="date" value={s.day} onChange={(e) => onChange({ ...s, day: e.target.value })} data-testid="work-schedule-day" /></label>
      <label>From <input type="time" value={s.from} onChange={(e) => onChange({ ...s, from: e.target.value })} data-testid="work-schedule-from" /></label>
      <label>To <input type="time" value={s.to} onChange={(e) => onChange({ ...s, to: e.target.value })} data-testid="work-schedule-to" /></label>
      <span className={MUTED}>Times are UTC.</span>
      <button type="button" className={BTN_PRIMARY} onClick={save} data-testid="work-schedule-save">Save</button>
      <button type="button" className={BTN_SECONDARY} onClick={() => onChange(null)}>Cancel</button>
      {error ? <p role="alert" className={MUTED} data-testid="work-schedule-error">{error}</p> : null}
    </div>
  );
}

/**
 * A person's weekly capacity, in points (#4735). Blank clears it: a capacity that is not recorded is "Not recorded",
 * never 0. The Worker decides who may set it (their own, or a project editor's), and says why when it refuses;
 * its sentence is shown, never the thrown message.
 */
export function CapacityBox({ projectId, c, onChange, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = c.row.who?.name || 'this person';
  const save = async () => {
    const b = capacityBody(c.text);
    if (b.error) { setError(b.error); return; }
    setBusy(true); setError(null);
    try {
      const r = await workAdapter.setCapacity(projectId, c.row.who.uid, b.body.weekly_capacity_points);
      if (!r.available) { setError(r.reason); return; }
      onDone(b.body.weekly_capacity_points == null ? `${name}'s capacity is cleared.` : `${name}'s capacity is ${b.body.weekly_capacity_points} points a week.`);
    } catch (e) { setError(e?.data?.message || e?.data?.detail || 'The capacity could not be saved. Nothing changed.'); }
    finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label={`Weekly capacity for ${name}`} className="wk-wl-schedule" data-testid="work-capacity-box">
      <b>Weekly capacity · {name}</b>
      <label>Points a week <input type="number" min="0" max="1000" step="1" inputMode="numeric" value={c.text}
        onChange={(e) => onChange({ ...c, text: e.target.value })} data-testid="work-capacity-input" /></label>
      <span className={MUTED}>Leave it blank to clear it. Not recorded is not 0.</span>
      <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy} data-testid="work-capacity-save">Save</button>
      <button type="button" className={BTN_SECONDARY} onClick={() => onChange(null)}>Cancel</button>
      {error ? <p role="alert" className={MUTED} data-testid="work-capacity-error">{error}</p> : null}
    </div>
  );
}
