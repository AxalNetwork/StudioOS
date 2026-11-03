// D1614 W6 (#3974) — WK7, a project's Workload: one row per person and per
// agent, one column per week, each item a bar in the week it is scheduled or
// due. A week over a person's recorded capacity is amber; a person with no
// capacity recorded is never "over". Drag a bar to another row to reassign it
// (W1's PATCH); "Schedule work" gives a person's item a time block (W4's
// PATCH). Agents' scheduled sessions join when #3957 merges (`workAdapter.agentSessions`).
import React, { useCallback, useEffect, useState } from 'react';
import { BTN_PRIMARY, BTN_SECONDARY, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { scheduleBody, weekLabel, workloadRows } from './workModel.js';

export const WORKLOAD_LINE = 'Bars sit in the week they are scheduled or due; their label is the estimate. Drag a bar to another row to reassign it.';

export default function WorkloadView({ projectId, onOpenItem, onNotice }) {
  const [state, setState] = useState({ status: 'loading' });
  const [drag, setDrag] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const r = await workAdapter.workload(projectId, { weeks: 4 });
      setState(r.available ? { status: 'ready', data: r.data } : { status: 'off', reason: r.reason });
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
  return (
    <section className="wk-workload" data-testid="work-workload">
      <p className={MUTED}>{WORKLOAD_LINE}</p>
      <div role="table" aria-label="Workload" className="wk-wl-grid" style={{ gridTemplateColumns: `200px repeat(${weeks.length}, minmax(140px, 1fr))` }}>
        <div role="row" className="wk-wl-head">
          <span role="columnheader">Person or agent</span>
          {weeks.map((w) => <span key={w} role="columnheader" data-testid="work-workload-week">{weekLabel(w)}</span>)}
        </div>
        {rows.map((r) => (
          <div role="row" key={r.key} className="wk-wl-row" data-testid="work-workload-row">
            <span role="rowheader" className="wk-wl-who">
              <b>{r.who?.name || 'Not recorded'}</b>
              <span className={MUTED}>{r.kind === 'agent' ? 'AI agent' : `Capacity · ${r.capacity}`}</span>
            </span>
            {r.cells.map((c) => (
              <span key={c.week} role="cell" className="wk-wl-cell" data-over={c.over ? 'true' : undefined} data-testid="work-workload-cell"
                onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); reassign(drag, r); setDrag(null); }}>
                <span className={MUTED}>{c.load}{c.over ? ' · over capacity' : ''}</span>
                {c.items.map((it) => (
                  <button key={it.uid} type="button" draggable className="wk-wl-bar" onDragStart={() => setDrag({ ...it, from: r.key })}
                    onClick={() => onOpenItem?.(it.uid)} data-testid="work-workload-bar">
                    {it.title}{it.estimate_points == null ? '' : ` · ${it.estimate_points} pts`}
                  </button>
                ))}
              </span>
            ))}
          </div>
        ))}
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
    </section>
  );
}

function ScheduleBox({ s, onChange, onDone }) {
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
