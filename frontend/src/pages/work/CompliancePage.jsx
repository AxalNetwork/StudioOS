import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Sheet } from '../../ui';
// Team's Ask: it draws nothing until #3706's panel (D1443), then opens it.
import AskButton from '../team/AskButton.jsx';
import { NOT_RECORDED } from '../../lib/absence';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import {
  COMPLIANCE_PURPOSE, CREATE_WORK_LINE, NO_PROJECTS_LINE, agenda, complianceCan, complianceTiles, gutter, linkedWork,
} from './workModel.js';
import './work.css';

/**
 * D1614 (#3968, canvas CO) — A COMPANY'S COMPLIANCE TASKS, at
 * `/account/companies/:uid/settings/compliance`.
 *
 * Companies carry the legal and compliance duties; projects carry the work
 * (the owner, 2026-11-01). The list is an agenda, not columns: an Overdue
 * section pinned in amber, then one section per month, with the date in the
 * left gutter (CO2). A task's sheet is shared with its Calendar entry and can
 * "Create work in a project…" (CO3). Only a company admin changes tasks; a
 * reader sees no checkbox and no New (CO3r). Every read and write goes through
 * `workAdapter.js`, off until #3976 (S15) lands.
 */
export default function CompliancePage() {
  const { uid } = useParams();
  const [state, setState] = useState({ status: 'loading' });
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
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
  const ag = tasks ? agenda(tasks) : null;

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
            <button type="button" className={BTN_PRIMARY} disabled={state.status !== 'ready'} title={state.status === 'off' ? state.reason : undefined} data-testid="compliance-new">+ New compliance task</button>
          ) : null}
          <AskButton label={`Compliance · ${company || 'Company'}`} />
        </div>
      </header>

      <div className="wk-tiles" data-testid="compliance-tiles">
        <div className="wk-tile" data-tone="amber"><span>Overdue</span><b>{tiles.overdue}</b></div>
        <div className="wk-tile"><span>Due in 30 days</span><b>{tiles.next30}</b></div>
        <div className="wk-tile"><span>Due this quarter</span><b>{tiles.quarter}</b></div>
        <div className="wk-tile"><span>Done this year</span><b>{tiles.doneYear}</b></div>
      </div>

      {state.status === 'loading' ? <p className={MUTED} role="status">Reading…</p> : null}
      {state.status === 'off' ? <HonestBlock testId="compliance-off">{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? (
        <HonestBlock role="alert" testId="compliance-unreadable" action={<button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>}>
          <b>Compliance could not be read.</b> That is not the same as having nothing due.
        </HonestBlock>
      ) : null}
      {ag ? <Agenda ag={ag} can={can} onOpen={setOpen} /> : null}
      {open ? <TaskSheet task={open} can={can} projects={state.projects || []} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** CO2: Overdue first, then months; the date in the gutter. */
export function Agenda({ ag, can, onOpen }) {
  if (!ag.overdue.length && !ag.months.length) {
    return <HonestBlock testId="compliance-empty"><b>No compliance tasks yet.</b></HonestBlock>;
  }
  return (
    <div className="wk-agenda" data-testid="compliance-agenda">
      {ag.overdue.length ? (
        <section className="wk-overdue" aria-label={`Overdue, ${ag.overdue.length}`}>
          <p className={`m-0 ${EYEBROW}`}>Overdue · {ag.overdue.length}</p>
          {ag.overdue.map((t) => <Row key={t.uid} t={t} can={can} onOpen={onOpen} late={t.late} />)}
        </section>
      ) : null}
      {ag.months.map((m) => (
        <section key={m.key} aria-label={m.label}>
          <p className={`m-0 ${EYEBROW}`}>{m.label}</p>
          {m.tasks.map((t) => <Row key={t.uid} t={t} can={can} onOpen={onOpen} />)}
        </section>
      ))}
    </div>
  );
}

function Row({ t, can, onOpen, late }) {
  const g = gutter(t.due);
  const link = linkedWork(t.linked_work);
  return (
    <div className="wk-row" data-testid={`compliance-row-${t.uid}`}>
      <span className="wk-gutter" aria-hidden="true">{g ? <><i>{g.month}</i><b>{g.day}</b><i>{g.weekday}</i></> : NOT_RECORDED}</span>
      {can.markDone ? <input type="checkbox" aria-label={`Mark ${t.title} done`} /> : null}
      <button type="button" className="wk-row-main" onClick={() => onOpen(t)}>
        <b>{t.title}</b>{late ? <i className="wk-late"> · overdue {late} day{late === 1 ? '' : 's'}</i> : null}
        <span className="wk-row-meta">
          {t.type ? <span className="wk-chip">{t.type}</span> : null}
          <span>{t.jurisdiction || NOT_RECORDED}</span>
          <span>{t.owner?.name || 'No owner'}</span>
          {t.recurrence ? <span>{t.recurrence}</span> : null}
          {link ? <span className="wk-link">{link}</span> : null}
        </span>
      </button>
      {can.markDone ? <button type="button" className={BTN_SECONDARY}>Mark done</button> : null}
    </div>
  );
}

/** CO3: the task sheet, with "Create work in a project…". */
export function TaskSheet({ task, can, projects, onClose }) {
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState(projects[0]?.id ?? null);
  return (
    <Sheet title={task.title} onClose={onClose} width={560} testId="compliance-task-sheet"
      footer={can.markDone ? (
        <>
          <button type="button" className={BTN_PRIMARY}>Mark done…</button>
          <button type="button" className={BTN_SECONDARY}>Reschedule</button>
          <button type="button" className={BTN_SECONDARY}>Assign owner</button>
          <button type="button" className={BTN_SECONDARY} onClick={() => setCreating(true)} data-testid="compliance-create-work">Create work in a project…</button>
        </>
      ) : null}>
      {task.description ? <p className="m-0">{task.description}</p> : null}
      <dl className="wk-fields">
        <dt>Jurisdiction</dt><dd>{task.jurisdiction || NOT_RECORDED}</dd>
        <dt>Recurrence</dt><dd>{task.recurrence || NOT_RECORDED}</dd>
        <dt>Owner</dt><dd>{task.owner?.name || 'No owner'}</dd>
        <dt>Status</dt><dd>{task.status === 'done' ? 'Done' : 'Due'}</dd>
        <dt>Linked work</dt><dd>{linkedWork(task.linked_work) || 'None'}</dd>
      </dl>
      {creating ? (
        <section className="wk-create" data-testid="compliance-create-panel">
          <p className={`m-0 ${EYEBROW}`}>Create work in a project</p>
          {projects.length ? projects.map((p) => (
            <label key={p.id} className="wk-pick"><input type="radio" name="project" checked={pick === p.id} onChange={() => setPick(p.id)} /> {p.name}</label>
          )) : <p className={`m-0 ${MUTED}`}>{NO_PROJECTS_LINE}</p>}
          <p className={`m-0 ${MUTED}`}>{CREATE_WORK_LINE(task.title)}</p>
          <span className="wk-create-acts">
            <button type="button" className={BTN_SECONDARY} onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} disabled={!pick}>Create in {projects.find((p) => p.id === pick)?.name || 'a project'}</button>
          </span>
        </section>
      ) : null}
    </Sheet>
  );
}
