import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lightbox, Sheet } from '../../ui';
// D1443 (#3706): Ask opens the Ask panel, and draws nothing where no rail serves the viewer.
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { NOT_RECORDED } from '../../lib/absence';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import {
  COMPLIANCE_PURPOSE, COMPLIANCE_TYPES, CREATE_WORK_LINE, NO_PROJECTS_LINE, agenda, complianceCan, complianceTiles, filterOptions, filterTasks,
  firstMonth, gutter, linkedWork, monthGrid, refusalLine, taskFlags, timelineLine,
} from './workModel.js';
import './work.css';

/**
 * D1614 (#3968, canvas CO) — A COMPANY'S COMPLIANCE TASKS, at
 * `/account/companies/:uid/settings/compliance`.
 *
 * Companies carry the legal and compliance duties; projects carry the work
 * (the owner, 2026-11-01). The list is an agenda, not columns: an Overdue
 * section pinned in amber, then one section per month, with the date in the
 * left gutter (CO2), or a Month view. A task's sheet is shared with its
 * Calendar entry and can "Create work in a project…" (CO3). Only a company
 * admin changes tasks; a reader sees no checkbox and no New (CO3r). #3976 turns
 * every read and write on, through `workAdapter.js`.
 */
export default function CompliancePage() {
  const { uid } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  const [open, setOpen] = useState(null);
  const [making, setMaking] = useState(false);
  const [filter, setFilter] = useState({ status: 'open' });
  const [view, setView] = useState('list');
  const [said, setSaid] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
    try {
      const r = await workAdapter.complianceTasks(uid);
      setState(r.available ? { status: 'ready', ...r.data } : { status: 'off', reason: r.reason });
    } catch {
      setState({ status: 'error' });
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const company = state.company?.name || null;
  const can = complianceCan(state.viewer);
  const tasks = state.status === 'ready' ? state.tasks : null;
  const tiles = complianceTiles(tasks);
  const shown = useMemo(() => (tasks ? filterTasks(tasks, filter) : null), [tasks, filter]);
  const options = useMemo(() => filterOptions(tasks), [tasks]);

  const done = async (t) => {
    setSaid(null);
    try { await workAdapter.markDone(uid, t.uid); await load(); setSaid(`${t.title} is done.`); }
    catch (e) { setSaid(refusalLine(e)); }
  };

  return (
    <div className="wk-page" data-testid="compliance-page">
      <header className="wk-head">
        <div className="wk-head-text">
          <p className={`m-0 ${EYEBROW} wk-eyebrow`}>{company ? `${company} · Company settings › Legal` : 'Company settings › Legal'}</p>
          <h1 className="wk-title">Compliance</h1>
          <p className={`m-0 ${MUTED}`}>{COMPLIANCE_PURPOSE(company)}</p>
        </div>
        <div className="wk-head-actions">
          {state.status === 'off' || can.create ? (
            <button type="button" className={BTN_PRIMARY} disabled={state.status !== 'ready'} title={state.status === 'off' ? state.reason : undefined}
              onClick={() => setMaking(true)} data-testid="compliance-new">+ New compliance task</button>
          ) : null}
          <HeaderAsk label={`Compliance · ${company || 'Company'}`} />
        </div>
      </header>

      <div className="wk-tiles" data-testid="compliance-tiles">
        <div className="wk-tile" data-tone="amber"><span>Overdue</span><b>{tiles.overdue}</b></div>
        <div className="wk-tile"><span>Due in 30 days</span><b>{tiles.next30}</b></div>
        <div className="wk-tile"><span>Due this quarter</span><b>{tiles.quarter}</b></div>
        <div className="wk-tile"><span>Done this year</span><b>{tiles.doneYear}</b></div>
      </div>

      {state.status === 'ready' ? (
        <Filters filter={filter} setFilter={setFilter} options={options} view={view} setView={setView} />
      ) : null}
      {said ? <p role="status" className={`m-0 ${MUTED}`} data-testid="compliance-said">{said}</p> : null}
      {state.status === 'ready' && state.viewer?.read_only ? (
        <HonestBlock testId="compliance-read-only">You read this company’s compliance as an admin without a seat on it, so nothing here can be changed by you.</HonestBlock>
      ) : null}
      {state.status === 'loading' ? <p className={MUTED} role="status">Reading…</p> : null}
      {state.status === 'off' ? <HonestBlock testId="compliance-off">{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? (
        <HonestBlock role="alert" testId="compliance-unreadable" action={<button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>}>
          <b>Compliance could not be read.</b> That is not the same as having nothing due.
        </HonestBlock>
      ) : null}
      {state.truncated ? <p className={`m-0 ${MUTED}`} data-testid="compliance-truncated">Only the first 1,000 tasks are shown.</p> : null}
      {shown && view === 'list' && filter.status !== 'done' ? <Agenda ag={agenda(shown)} can={can} onOpen={setOpen} onDone={done} /> : null}
      {shown && view === 'list' && filter.status === 'done' ? <DoneList tasks={shown} onOpen={setOpen} /> : null}
      {shown && view === 'month' ? <Month tasks={shown} onOpen={setOpen} /> : null}
      {open ? (
        <TaskSheet uid={uid} task={open} can={can} viewer={state.viewer} projects={state.projects || []}
          onClose={() => setOpen(null)} onChanged={load} />
      ) : null}
      {making ? <NewTaskDialog uid={uid} projects={state.projects || []} onClose={() => setMaking(false)} onMade={async () => { setMaking(false); await load(); }} /> : null}
    </div>
  );
}

function Filters({ filter, setFilter, options, view, setView }) {
  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value || undefined }));
  return (
    <div className="wk-filters" data-testid="compliance-filters">
      <label>Status <select value={filter.status || 'open'} onChange={set('status')}>{options.status.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
      <label>Jurisdiction <select value={filter.jurisdiction || ''} onChange={set('jurisdiction')}><option value="">Any</option>{options.jurisdiction.map((j) => <option key={j} value={j}>{j}</option>)}</select></label>
      <label>Owner <select value={filter.owner || ''} onChange={set('owner')}><option value="">Anyone</option>{options.owner.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></label>
      <label>Type <select value={filter.type || ''} onChange={set('type')}><option value="">Any</option>{options.type.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <span className="wk-toggle" role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'list'} className={BTN_SECONDARY} onClick={() => setView('list')} data-testid="compliance-view-list">List</button>
        <button type="button" aria-pressed={view === 'month'} className={BTN_SECONDARY} onClick={() => setView('month')} data-testid="compliance-view-month">Month</button>
      </span>
    </div>
  );
}

/** CO2: Overdue first, then months; the date in the gutter. */
export function Agenda({ ag, can, onOpen, onDone }) {
  if (!ag.overdue.length && !ag.months.length) {
    return <HonestBlock testId="compliance-empty"><b>No compliance tasks yet.</b></HonestBlock>;
  }
  return (
    <div className="wk-agenda" data-testid="compliance-agenda">
      {ag.overdue.length ? (
        <section className="wk-overdue" aria-label={`Overdue, ${ag.overdue.length}`}>
          <p className={`m-0 ${EYEBROW}`}>Overdue · {ag.overdue.length}</p>
          {ag.overdue.map((t) => <Row key={t.uid} t={t} can={can} onOpen={onOpen} onDone={onDone} late={t.late} />)}
        </section>
      ) : null}
      {ag.months.map((m) => (
        <section key={m.key} aria-label={m.label}>
          <p className={`m-0 ${EYEBROW}`}>{m.label}</p>
          {m.tasks.map((t) => <Row key={t.uid} t={t} can={can} onOpen={onOpen} onDone={onDone} />)}
        </section>
      ))}
    </div>
  );
}

function Row({ t, can, onOpen, onDone, late }) {
  const g = gutter(t.due);
  const link = linkedWork(t.linked_work);
  return (
    <div className="wk-row" data-testid={`compliance-row-${t.uid}`}>
      <span className="wk-gutter" aria-hidden="true">{g ? <><i>{g.month}</i><b>{g.day}</b><i>{g.weekday}</i></> : NOT_RECORDED}</span>
      {can.markDone ? <input type="checkbox" checked={false} aria-label={`Mark ${t.title} done`} onChange={() => onDone?.(t)} /> : null}
      <button type="button" className="wk-row-main" onClick={() => onOpen(t)}>
        <b>{t.title}</b>{late ? <i className="wk-late"> · overdue {late} day{late === 1 ? '' : 's'}</i> : null}
        <span className="wk-row-meta">
          {t.type ? <span className="wk-chip">{t.type}</span> : null}
          <span>{t.jurisdiction || NOT_RECORDED}</span>
          <span>{t.owner?.name || 'No owner'}</span>
          {t.recurrence ? <span>{t.recurrence}</span> : null}
          {link ? <span className="wk-link">{link}</span> : null}
          {taskFlags(t).map((f) => <span key={f} className="wk-chip">{f}</span>)}
        </span>
      </button>
      {can.markDone ? <button type="button" className={BTN_SECONDARY} onClick={() => onDone?.(t)}>Mark done</button> : null}
    </div>
  );
}

function DoneList({ tasks, onOpen }) {
  if (!tasks.length) return <HonestBlock testId="compliance-none-done"><b>No task is done yet.</b></HonestBlock>;
  return (
    <div className="wk-agenda" data-testid="compliance-done">
      {tasks.map((t) => (
        <button key={t.uid} type="button" className="wk-row-main" onClick={() => onOpen(t)}>
          <b>{t.title}</b><span className="wk-row-meta"><span>Done {String(t.done_at || '').slice(0, 10) || NOT_RECORDED}</span></span>
        </button>
      ))}
    </div>
  );
}

function Month({ tasks, onOpen }) {
  const [month, setMonth] = useState(() => firstMonth(tasks));
  const grid = monthGrid(tasks, month);
  const step = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  if (!grid) return null;
  return (
    <section className="wk-month" data-testid="compliance-month" aria-label={grid.label}>
      <span className="wk-month-head">
        <button type="button" className={BTN_SECONDARY} onClick={() => step(-1)} aria-label="Earlier month">‹</button>
        <b>{grid.label}</b>
        <button type="button" className={BTN_SECONDARY} onClick={() => step(1)} aria-label="Later month">›</button>
      </span>
      <div className="wk-month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className={EYEBROW}>{d}</span>)}
        {grid.weeks.flat().map((c, i) => (
          <div key={i} className="wk-month-day">
            {c ? <><i>{c.day}</i>{c.tasks.map((t) => <button key={t.uid} type="button" className="wk-chip" onClick={() => onOpen(t)}>{t.title}</button>)}</> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "New compliance task" (company admins). */
function NewTaskDialog({ uid, projects, onClose, onMade }) {
  const [f, setF] = useState({ title: '', due: '', type: 'filing', jurisdiction: '', recurrence: 'one_time', description: '', project_id: '' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setSaid(null);
    try {
      const body = { title: f.title, due: f.due, type: f.type, recurrence: f.recurrence,
        ...(f.jurisdiction.trim() ? { jurisdiction: f.jurisdiction.trim() } : {}), ...(f.description.trim() ? { description: f.description.trim() } : {}),
        ...(f.project_id ? { project_id: Number(f.project_id) } : {}) };
      const r = await workAdapter.complianceCreate(uid, body);
      if (!r.available) { setSaid(r.reason); setBusy(false); return; }
      await onMade();
    } catch (e) { setSaid(refusalLine(e)); setBusy(false); }
  };
  return (
    <Lightbox label="New compliance task" title="New compliance task" onClose={onClose} width={520} phone="sheet" testId="compliance-new-dialog"
      footer={<>
        <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} disabled={busy || !f.title.trim() || !f.due} onClick={save} data-testid="compliance-new-save">{busy ? 'Saving…' : 'Add task'}</button>
      </>}>
      <div className="wk-form">
        <label>Title <input value={f.title} onChange={set('title')} maxLength={200} /></label>
        <label>Due <input type="date" value={f.due} onChange={set('due')} /></label>
        <label>Type <select value={f.type} onChange={set('type')}>{COMPLIANCE_TYPES.map((t) => <option key={t} value={t.toLowerCase()}>{t}</option>)}</select></label>
        <label>Jurisdiction <input value={f.jurisdiction} onChange={set('jurisdiction')} maxLength={64} placeholder="For example, Delaware" /></label>
        <label>Repeats <select value={f.recurrence} onChange={set('recurrence')}>
          <option value="one_time">Does not repeat</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Every year</option>
        </select></label>
        <label>For a project <select value={f.project_id} onChange={set('project_id')}><option value="">The company itself</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Notes <textarea value={f.description} onChange={set('description')} maxLength={5000} rows={3} /></label>
        {said ? <p role="alert" className={`m-0 ${MUTED}`} data-testid="compliance-new-refused">{said}</p> : null}
      </div>
    </Lightbox>
  );
}

/** CO3: the task sheet: its facts, owner, linked work, timeline and comments, and "Create work in a project…". */
export function TaskSheet({ uid, task, can, viewer, projects, onClose, onChanged }) {
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState(projects[0]?.id ?? null);
  const [read, setRead] = useState({ status: uid ? 'loading' : 'none' });
  const [said, setSaid] = useState(null);
  const [comment, setComment] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const r = await workAdapter.complianceTask(uid, task.uid);
      setRead(r.available ? { status: 'ready', ...r.data } : { status: 'off', reason: r.reason });
    } catch { setRead({ status: 'error' }); }
  }, [uid, task.uid]);
  useEffect(() => { load(); }, [load]);

  const t = read.status === 'ready' ? read.task : task;
  const act = async (fn, ok) => {
    setSaid(null);
    try {
      const r = await fn();
      if (r && r.available === false) { setSaid(r.reason); return; }
      await load(); await onChanged?.(); if (ok) setSaid(ok);
    } catch (e) { setSaid(refusalLine(e)); }
  };
  const openAssign = async () => {
    try { const r = await workAdapter.complianceAssignable(uid); setAssigning(r.available ? r.data : { off: r.reason }); }
    catch (e) { setSaid(refusalLine(e)); }
  };

  return (
    <Sheet title={t.title} onClose={onClose} width={560} testId="compliance-task-sheet"
      footer={can.markDone ? (
        <>
          {t.status === 'done'
            ? <button type="button" className={BTN_SECONDARY} onClick={() => act(() => workAdapter.complianceReopen(uid, t.uid), 'Reopened.')} data-testid="compliance-reopen">Reopen</button>
            : <button type="button" className={BTN_PRIMARY} onClick={() => setClosing(true)} data-testid="compliance-mark-done">Mark done…</button>}
          <button type="button" className={BTN_SECONDARY} onClick={openAssign} data-testid="compliance-assign">Assign owner</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => setCreating(true)} data-testid="compliance-create-work">Create work in a project…</button>
        </>
      ) : null}>
      {t.description ? <p className="m-0">{t.description}</p> : null}
      <dl className="wk-fields">
        <dt>Due</dt><dd>{t.due || NOT_RECORDED}</dd>
        <dt>Jurisdiction</dt><dd>{t.jurisdiction || NOT_RECORDED}</dd>
        <dt>Recurrence</dt><dd>{t.recurrence || NOT_RECORDED}</dd>
        <dt>Owner</dt><dd>{t.owner?.name || 'No owner'}{t.owner?.kind === 'agent' ? ' · agent' : ''}</dd>
        <dt>Status</dt><dd>{t.status === 'done' ? 'Done' : 'Due'}{taskFlags(t).map((f) => ` · ${f}`).join('')}</dd>
        <dt>Linked work</dt><dd>{(t.linked_items?.length ? t.linked_items : t.linked_work ? [t.linked_work] : []).map(linkedWork).filter(Boolean).join('; ') || 'None'}</dd>
      </dl>
      {said ? <p role="status" className={`m-0 ${MUTED}`} data-testid="compliance-sheet-said">{said}</p> : null}

      {closing ? (
        <section className="wk-create" data-testid="compliance-done-panel">
          <p className={`m-0 ${EYEBROW}`}>Mark done</p>
          <p className={`m-0 ${MUTED}`}>{t.recurrence && t.recurrence !== 'one_time' ? 'The next one is added for its next due date, with the same owner.' : 'It does not repeat, so nothing new is added.'}</p>
          <label className="wk-pick">Note (optional) <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} /></label>
          <span className="wk-create-acts">
            <button type="button" className={BTN_SECONDARY} onClick={() => setClosing(false)}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => act(() => workAdapter.markDone(uid, t.uid, note.trim() || undefined), 'Marked done.').then(() => setClosing(false))} data-testid="compliance-done-save">Mark done</button>
          </span>
        </section>
      ) : null}

      {assigning ? (
        <section className="wk-create" data-testid="compliance-assign-panel">
          <p className={`m-0 ${EYEBROW}`}>Owner</p>
          {assigning.off ? <p className={`m-0 ${MUTED}`}>{assigning.off}</p> : (
            <>
              {[['Company team', assigning.team], ['With a seat on the company', assigning.platform], ['Agents', assigning.agents]].map(([label, list]) => (
                <div key={label}>
                  <p className={`m-0 ${EYEBROW}`}>{label}</p>
                  {list?.length ? list.map((p) => (
                    <button key={p.uid} type="button" className={BTN_SECONDARY} onClick={() => act(() => workAdapter.complianceAssign(uid, t.uid, { kind: p.kind, uid: p.uid }), `${p.name} owns it now.`).then(() => setAssigning(null))}>
                      {p.name} · {p.role} · {p.open_tasks} open
                    </button>
                  )) : <p className={`m-0 ${MUTED}`}>None.</p>}
                </div>
              ))}
              <span className="wk-create-acts">
                <button type="button" className={BTN_SECONDARY} onClick={() => setAssigning(null)}>Cancel</button>
                {t.owner ? <button type="button" className={BTN_SECONDARY} onClick={() => act(() => workAdapter.complianceAssign(uid, t.uid, null), 'No owner now.').then(() => setAssigning(null))}>Remove the owner</button> : null}
              </span>
            </>
          )}
        </section>
      ) : null}

      {creating ? (
        <section className="wk-create" data-testid="compliance-create-panel">
          <p className={`m-0 ${EYEBROW}`}>Create work in a project</p>
          {projects.length ? projects.map((p) => (
            <label key={p.id} className="wk-pick"><input type="radio" name="project" checked={pick === p.id} onChange={() => setPick(p.id)} /> {p.name}</label>
          )) : <p className={`m-0 ${MUTED}`}>{NO_PROJECTS_LINE}</p>}
          <p className={`m-0 ${MUTED}`}>{CREATE_WORK_LINE(t.title)}</p>
          <span className="wk-create-acts">
            <button type="button" className={BTN_SECONDARY} onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} disabled={!pick}
              onClick={() => act(() => workAdapter.createWork(uid, t.uid, { projectId: pick }), 'The item is in that project’s Backlog.').then(() => setCreating(false))}
              data-testid="compliance-create-work-save">Create in {projects.find((p) => p.id === pick)?.name || 'a project'}</button>
          </span>
        </section>
      ) : null}

      {uid ? (
        <section className="wk-timeline" data-testid="compliance-timeline">
          <p className={`m-0 ${EYEBROW}`}>Timeline</p>
          {read.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading…</p> : null}
          {read.status === 'error' ? <p className={`m-0 ${MUTED}`} role="alert">The timeline could not be read. That is not the same as nothing having happened.</p> : null}
          {read.status === 'ready' ? read.timeline.map((e) => (
            <div key={e.uid} className="wk-timeline-row">
              <span>{timelineLine(e)}</span><i>{String(e.at || '').slice(0, 16).replace('T', ' ')}</i>
              {e.body ? <p className="m-0">{e.body}</p> : null}
            </div>
          )) : null}
          {viewer?.can_comment ? (
            <span className="wk-comment">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={10000} rows={2} aria-label="Comment" placeholder="Add a comment" />
              <button type="button" className={BTN_SECONDARY} disabled={!comment.trim()} onClick={() => act(() => workAdapter.complianceComment(uid, t.uid, comment.trim())).then(() => setComment(''))} data-testid="compliance-comment">Comment</button>
              {t.status !== 'done' && t.review_state !== 'ready_for_review'
                ? <button type="button" className={BTN_SECONDARY} onClick={() => act(() => workAdapter.complianceReady(uid, t.uid), 'Marked ready for review.')} data-testid="compliance-ready">Ready for review</button>
                : null}
            </span>
          ) : null}
        </section>
      ) : null}
    </Sheet>
  );
}
