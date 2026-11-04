import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Sheet } from '../../ui';
import { api } from '../../lib/api';
// D1443 (#3706): Ask opens the Ask panel, and draws nothing where no rail serves the viewer.
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { NOT_RECORDED as NOT_RECORDED_WORD } from '../../lib/absence';
import {
  BACKLOG_COLUMNS, BURN_RANGES, BURN_SPLITS, WORK_PURPOSE, WORK_TABS,
  assigneeLine, backlogRows, boardColumns, burnup, canMove, columnLabel, dueLine, moveTargets, needsYou, runChip, runCost, runOutcome, runSheet,
} from './workModel.js';
import WorkloadView from './WorkloadView.jsx';
import MyTasks from './MyTasks.jsx';
import AssignPicker from './AssignPicker.jsx';
// D1531 (#3742 E8): Goals (TM10), the engine's banner (TM19b) and Start this task (TM19f).
import GoalsView from '../team/GoalsView.jsx';
import { EngineBanner, StartTask } from '../team/EngineControl.jsx';
import { EXPIRED_LINE, isExpiredBlock } from '../team/engineModel.js';
import './work.css';

/**
 * D1614 (#3968, canvas WK) — WORK, a project's board, backlog and burn-up, at
 * `/projects/:id/work`.
 *
 * Only projects have Work (the owner, 2026-11-01). Every read and write goes
 * through `workAdapter.js`. W1's board, item, move, assign and create and W2's
 * burn-up are live (#3973); an engine that is off answers the honest "not
 * switched on yet" block, never an invented board. A card moves (Move to ▾, or
 * dragged to a column) only where the Worker allows it: a project editor, or
 * the card's own assignee (`canMove`, from the board's `viewer`).
 */
export default function WorkPage() {
  const { id } = useParams();
  const [q, setQ] = useSearchParams();
  const tab = WORK_TABS.some((t) => t.key === q.get('view')) ? q.get('view') : 'board';
  const [project, setProject] = useState(null);
  const [board, setBoard] = useState({ status: 'loading' });
  const [burn, setBurn] = useState({ status: 'loading' });
  const [itemUid, setItemUid] = useState(null);
  const [runUid, setRunUid] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.resolve(api.getProject(id)).then((p) => { if (live) setProject(p || null); }, () => { if (live) setProject(null); });
    return () => { live = false; };
  }, [id]);

  const load = useCallback(async () => {
    setBoard({ status: 'loading' });
    try {
      const r = await workAdapter.board(id);
      setBoard(r.available ? { status: 'ready', items: r.data?.items || [], viewer: r.data?.viewer || null } : { status: 'off', reason: r.reason });
    } catch {
      setBoard({ status: 'error' });
    }
    try {
      const b = await workAdapter.burnup(id);
      setBurn(b.available ? { status: 'ready', series: b.data?.series || [] } : { status: 'off', reason: b.reason });
    } catch {
      setBurn({ status: 'error' });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const move = useCallback(async (uid, column) => {
    setNotice(null);
    try {
      const r = await workAdapter.move(uid, column);
      if (!r.available) setNotice(r.reason);
    } catch (e) {
      setNotice(e?.message || 'That move did not go through. Nothing changed.');
    }
    load();
  }, [load]);
  const create = useCallback(async (title) => {
    setNotice(null);
    try {
      const r = await workAdapter.create(id, { title });
      if (!r.available) setNotice(r.reason);
      setAdding(false);
    } catch (e) {
      setNotice(e?.message || 'The item was not created.');
    }
    load();
  }, [id, load]);

  const name = project?.name || 'this project';
  const company = project?.company_name || project?.company?.name || null;
  const off = board.status === 'off';

  return (
    <div className="wk-page" data-testid="work-page">
      <header className="wk-head">
        <div className="wk-head-text">
          <p className={`m-0 ${EYEBROW} wk-eyebrow`}>{company ? `${company} › ${name}` : name}</p>
          <h1 className="wk-title">Work</h1>
          <p className={`m-0 ${MUTED}`}>{WORK_PURPOSE}</p>
        </div>
        <div className="wk-head-actions">
          <button type="button" className={BTN_PRIMARY} disabled={off || board.status !== 'ready' || !board.viewer?.can_manage}
            title={off ? board.reason : board.viewer && !board.viewer.can_manage ? 'Only a project editor can add items.' : undefined}
            onClick={() => setAdding(true)} data-testid="work-new-item">+ New item</button>
          <HeaderAsk label={`Work · ${name}`} />
        </div>
      </header>

      {!off ? <EngineBanner scope="project" id={id} /> : null}

      <div className="wk-bar">
        <nav className="wk-tabs" aria-label="Work views">
          {WORK_TABS.map((t) => (
            <button key={t.key} type="button" className="wk-tab" aria-current={t.key === tab ? 'page' : undefined}
              onClick={() => setQ(t.key === 'board' ? {} : { view: t.key })} data-testid={`work-tab-${t.key}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <input type="search" className="wk-filter" placeholder="Filter by keyword or field" aria-label="Filter work" disabled={off} />
      </div>

      {board.status === 'loading' ? <p className={MUTED} role="status">Reading…</p> : null}
      {board.status === 'error' ? (
        <HonestBlock role="alert" testId="work-unreadable" action={<button type="button" className={BTN_SECONDARY} onClick={load}>Try again</button>}>
          <b>Work could not be read.</b> That is not the same as having nothing to do.
        </HonestBlock>
      ) : null}
      {off ? (
        <HonestBlock testId="work-off" action={<Link to={`/projects/${encodeURIComponent(id)}/settings/team`} className={BTN_TEXT}>Open the project’s Team ›</Link>}>
          {board.reason}
        </HonestBlock>
      ) : null}

      {adding ? <NewItem onCreate={create} onCancel={() => setAdding(false)} /> : null}
      {notice ? <p className="wk-notice" role="status" data-testid="work-notice">{notice}</p> : null}
      {board.status === 'ready' && tab === 'board' ? <Board items={board.items} viewer={board.viewer} onOpen={setItemUid} onMove={move} /> : null}
      {board.status === 'ready' && tab === 'backlog' ? <Backlog items={board.items} onOpen={setItemUid} projectId={id} /> : null}
      {tab === 'burnup' && burn.status === 'ready' ? <Burnup series={burn.series} /> : null}
      {/* D1614 W8 (#3994): My items is My tasks narrowed to this project. */}
      {tab === 'mine' ? <MyTasks licence="founder" project={id} title="My items" testId="work-mine" /> : null}
      {tab === 'workload' ? <WorkloadView projectId={id} onOpenItem={setItemUid} onNotice={setNotice} /> : null}
      {tab === 'goals' ? <GoalsView scope="project" id={id} canManage={!!board.viewer?.can_manage} /> : null}

      {itemUid ? <ItemSheet uid={itemUid} projectId={id} onClose={() => setItemUid(null)} onRun={setRunUid} onAssigned={load} /> : null}
      {runUid ? <RunSheet uid={runUid} onClose={() => setRunUid(null)} /> : null}
    </div>
  );
}

/** "+ New item": a title, then the project's To triage column. */
function NewItem({ onCreate, onCancel }) {
  const [title, setTitle] = useState('');
  return (
    <form className="wk-new" onSubmit={(e) => { e.preventDefault(); if (title.trim()) onCreate(title.trim()); }} data-testid="work-new-form">
      <input aria-label="Item title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="work-new-title" />
      <button type="submit" className={BTN_PRIMARY} disabled={!title.trim()} data-testid="work-new-create">Add</button>
      <button type="button" className={BTN_TEXT} onClick={onCancel}>Cancel</button>
    </form>
  );
}

/**
 * WK1: the six columns, the "Needs you" strip, cards with "Move to ▾". A card
 * this reader may move is draggable to a column; any other card is not, and
 * has no Move menu. Without `viewer` (a board read before #3973) nothing moves.
 */
export function Board({ items, onOpen, onMove, viewer = null }) {
  const cols = boardColumns(items);
  const needs = needsYou(items);
  return (
    <>
      {needs ? (
        <div className="wk-needs" role="status" data-testid="work-needs-you">
          <b>Needs you</b><span>{needs.line}</span>
          {needs.review ? <button type="button" className={BTN_SECONDARY}>{needs.review}</button> : null}
          {needs.failed ? <button type="button" className={BTN_TEXT}>See the failed run</button> : null}
        </div>
      ) : null}
      <div className="wk-board" data-testid="work-board">
        {cols.map((c) => (
          <section key={c.key} className="wk-col" data-tone={c.tone} aria-label={`${c.label}, ${c.count}`} data-testid={`work-col-${c.key}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const uid = e.dataTransfer?.getData('text/plain');
              const card = (items || []).find((i) => i?.uid === uid);
              if (card && card.column !== c.key && canMove(card, viewer)) onMove?.(uid, c.key);
            }}>
            <header className="wk-col-head">
              <span className="wk-dot" aria-hidden="true" /><b>{c.label}</b><span className="wk-count">{c.count}</span>
            </header>
            <p className="wk-col-est">Estimate: {c.estimate}</p>
            <p className="wk-col-line">{c.line}</p>
            {c.cards.map((card) => <Card key={card.uid} card={card} onOpen={onOpen} onMove={onMove} readOnly={!canMove(card, viewer)} />)}
          </section>
        ))}
      </div>
    </>
  );
}

function Card({ card, onOpen, onMove, readOnly }) {
  const [menu, setMenu] = useState(false);
  const who = assigneeLine(card);
  const due = dueLine(card.due);
  const chip = runChip(card.run);
  return (
    <article className="wk-card" tabIndex={0} aria-label={card.title} onClick={() => onOpen?.(card.uid)}
      draggable={!readOnly} onDragStart={readOnly ? undefined : (e) => e.dataTransfer?.setData('text/plain', card.uid)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(card.uid); }} data-testid={`work-card-${card.uid}`}>
      <b className="wk-card-title">{card.title}</b>
      {card.source ? <span className="wk-chip">{card.source}</span> : null}
      <span className="wk-who" data-agent={who.agent ? 'true' : 'false'}>{who.text}{who.role ? <i>{who.role}</i> : null}</span>
      <span className="wk-meta">
        {due ? <span data-soon={due.soon ? 'true' : 'false'}>{due.text}{due.soon ? ' · soon' : ''}</span> : null}
        <span>{card.estimate == null ? NOT_RECORDED_WORD : `${card.estimate} pts`}</span>
        {card.blocked ? <span className="wk-blocked">Blocked</span> : null}
      </span>
      {chip ? <span className="wk-run" data-tone={chip.tone}>{chip.words}{chip.cost ? <i>{chip.cost}</i> : null}</span> : null}
      {readOnly ? null : (
        <span className="wk-move" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>Move to ▾</button>
          {menu ? (
            <ul role="menu" className="wk-menu">
              {moveTargets(card).map((t) => (
                <li key={t.key} role="none">
                  <button type="button" role="menuitem" data-tone={t.tone} onClick={() => { setMenu(false); onMove?.(card.uid, t.key); }}
                    data-testid={`work-move-${card.uid}-${t.key}`}>{t.label}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      )}
    </article>
  );
}

/** WK2: the backlog as a table, with "Done hidden". */
export function Backlog({ items, onOpen, projectId = null }) {
  const rows = backlogRows(items);
  return (
    <div className="wk-table-wrap" data-testid="work-backlog">
      <table className="wk-table">
        <thead><tr>{BACKLOG_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid} onClick={() => onOpen?.(r.uid)}>
              <td>{r.title}{isExpiredBlock(r) ? <span className={`block ${MUTED}`} data-testid="work-expired">{EXPIRED_LINE} <Link to={`/projects/${encodeURIComponent(projectId ?? '')}/settings/team?tab=approvals`} className={BTN_TEXT} onClick={(e) => e.stopPropagation()}>Decide now ›</Link></span> : null}</td>
              <td>{assigneeLine(r).text}</td>
              <td><span className="wk-chip">{columnLabel(r.column)}</span></td>
              <td>{r.priority || NOT_RECORDED_WORD}</td>
              <td>{r.estimate ?? NOT_RECORDED_WORD}</td>
              <td>{dueLine(r.due)?.text || '—'}</td>
              <td>{r.goal || '—'}</td>
              <td>{r.module || '—'}</td>
              <td>{runChip(r.run)?.cost || (r.run ? NOT_RECORDED_WORD : '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`m-0 ${MUTED}`}>Sorted by title · Done hidden · {rows.length} open</p>
    </div>
  );
}

/** WK3: scope as a solid line, completed dashed, the gap shaded as open. */
export function Burnup({ series }) {
  const g = burnup(series);
  return (
    <section className="wk-burn" data-testid="work-burnup">
      <div className="wk-seg" role="group" aria-label="Range">{BURN_RANGES.map((r, i) => <button key={r} type="button" aria-pressed={i === 0}>{r}</button>)}</div>
      <div className="wk-seg" role="group" aria-label="Who">{BURN_SPLITS.map((r) => <button key={r} type="button" aria-pressed={r === 'Both'}>{r}</button>)}</div>
      {g.empty ? <p className="wk-nr" data-testid="work-burnup-empty">{g.line}</p> : (
        <>
          <div className="wk-tiles">
            <Tile k="Scope" v={`${g.tiles.scope} items`} /><Tile k="Completed" v={g.tiles.completed} /><Tile k="Open" v={g.tiles.open} />
          </div>
          <p className={`m-0 ${MUTED}`}>{g.line}</p>
          <svg viewBox="0 0 1000 260" className="wk-chart" role="img" aria-label={g.line}>
            <path d={g.area} className="wk-area" />
            <path d={g.scope} className="wk-scope" />
            <path d={g.completed} className="wk-done" />
          </svg>
        </>
      )}
    </section>
  );
}

const Tile = ({ k, v }) => <div className="wk-tile"><span>{k}</span><b>{v}</b></div>;

/** WK4: the item sheet. Its read is #3969's; until then it says so. */
export function ItemSheet({ uid, projectId = null, onClose, onRun, onAssigned }) {
  const [state, setState] = useState({ status: 'loading' });
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    let live = true;
    workAdapter.item(uid).then((r) => { if (live) setState(r.available ? { status: 'ready', item: r.data } : { status: 'off', reason: r.reason }); }, () => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [uid]);
  const it = state.item;
  // D1614 W8 (#3994): Assign opens the Team picker, this Team's people then its agents.
  const assigned = (task) => { if (task) setState({ status: 'ready', item: task }); setPicking(false); onAssigned?.(task); };
  return (
    <Sheet title={it?.title || 'Item'} onClose={onClose} width={560} testId="work-item-sheet"
      footer={it ? <><button type="button" className={BTN_PRIMARY} onClick={() => setPicking((v) => !v)} disabled={projectId == null} data-testid="work-item-assign">Assign</button><button type="button" className={BTN_SECONDARY}>Move ▾</button><button type="button" className={BTN_SECONDARY}>Schedule</button></> : null}>
      {it && picking && projectId != null ? <AssignPicker projectId={projectId} taskUid={uid} current={it.assignee} onAssigned={assigned} onCancel={() => setPicking(false)} /> : null}
      {state.status === 'off' ? <HonestBlock>{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? <HonestBlock role="alert">This item could not be read.</HonestBlock> : null}
      {it ? (
        <dl className="wk-fields">
          <dt>Assignee</dt><dd>{assigneeLine(it).text}</dd>
          <dt>Column</dt><dd>{columnLabel(it.column) || NOT_RECORDED_WORD}</dd>
          <dt>Due</dt><dd>{dueLine(it.due)?.text || NOT_RECORDED_WORD}</dd>
          <dt>Goal</dt><dd>{it.goal || NOT_RECORDED_WORD}</dd>
          {it.compliance ? <><dt>Compliance</dt><dd>{it.compliance.title} · the obligation stays with {it.compliance.company}; this work happens in the project</dd></> : null}
          {assigneeLine(it).agent && !['done', 'cancelled'].includes(String(it.column || it.status || '')) ? (
            <><dt>Start</dt><dd><StartTask task={it} agentName={assigneeLine(it).text} onStarted={(run) => { if (run?.uid) onRun(run.uid); }} /></dd></>
          ) : null}
          <dt>Agent runs</dt>
          <dd>{(it.runs || []).length ? it.runs.map((r) => <button key={r.uid} type="button" className={BTN_TEXT} onClick={() => onRun(r.uid)}>{runOutcome(r).title} · {runCost(r)}</button>) : 'None'}</dd>
        </dl>
      ) : null}
    </Sheet>
  );
}

/**
 * WK5: what a run worked on, read, produced and decided, its outcome, timing and
 * cost, named by source and tool, never a raw prompt. D1614 W6 (#3974): W3's
 * `detail` (#4183); a Failed run that may be retried has Retry; a cost that was
 * never recorded reads "Not recorded", never $0.
 */
export function RunSheet({ uid, onClose, onRetried }) {
  const [state, setState] = useState({ status: 'loading' });
  const [retry, setRetry] = useState({ status: 'idle' });
  useEffect(() => {
    let live = true;
    workAdapter.run(uid).then((r) => { if (live) setState(r.available ? { status: 'ready', run: r.data } : { status: 'off', reason: r.reason }); }, () => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [uid]);
  const sheet = state.run ? runSheet(state.run) : null;
  const doRetry = async () => {
    setRetry({ status: 'busy' });
    try {
      const r = await workAdapter.retry(uid);
      setRetry(r.available ? { status: 'done' } : { status: 'off', message: r.reason });
      if (r.available) onRetried?.(r.data);
    } catch (e) {
      setRetry({ status: 'error', message: e?.data?.message || e?.message || 'The run could not be retried. Try again.' });
    }
  };
  return (
    <Sheet title={sheet ? sheet.title : 'Run'} onClose={onClose} width={560} testId="work-run-sheet"
      footer={sheet?.retryable ? (
        <button type="button" className={BTN_PRIMARY} disabled={retry.status === 'busy' || retry.status === 'done'} onClick={doRetry} data-testid="work-run-retry">
          {retry.status === 'busy' ? 'Retrying…' : retry.status === 'done' ? 'Retry started' : 'Retry'}
        </button>
      ) : null}>
      {state.status === 'off' ? <HonestBlock>{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? <HonestBlock>The run could not be read. That is not the same as it not existing.</HonestBlock> : null}
      {sheet ? (
        <>
          <p className={MUTED} data-testid="work-run-agent">{sheet.agent}</p>
          <dl className="wk-fields" data-testid="work-run-fields">
            {sheet.rows.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd data-tone={k === 'Outcome' ? sheet.tone : undefined}>{v}</dd></React.Fragment>))}
          </dl>
          {retry.message ? <p role="status" className={MUTED} data-testid="work-run-retry-said">{retry.message}</p> : null}
        </>
      ) : null}
    </Sheet>
  );
}
