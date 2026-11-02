import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Sheet } from '../../ui';
import { api } from '../../lib/api';
// D1443 (#3706): Ask opens the Ask panel, and draws nothing where no rail serves the viewer.
import { PageAsk } from '../../ui/AskButton.jsx';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, MUTED, HonestBlock } from '../team/teamUi.jsx';
import { workAdapter } from './workAdapter.js';
import { NOT_RECORDED as NOT_RECORDED_WORD } from '../../lib/absence';
import {
  BACKLOG_COLUMNS, BURN_RANGES, BURN_SPLITS, WORK_PURPOSE, WORK_TABS,
  assigneeLine, backlogRows, boardColumns, burnup, columnLabel, dueLine, moveTargets, needsYou, runChip, runCost, runOutcome,
} from './workModel.js';
import './work.css';

/**
 * D1614 (#3968, canvas WK) — WORK, a project's board, backlog and burn-up, at
 * `/projects/:id/work`.
 *
 * Only projects have Work (the owner, 2026-11-01). Every read and write goes
 * through `workAdapter.js`, which is off until the Worker parts land (W1 #3969,
 * W2 #3970, W3 #3971): until then the page draws its header, its views and the
 * honest "not switched on yet" block, never an invented board. The views take
 * the shapes the Worker parts answer, so turning a method on is the only change.
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
      setBoard(r.available ? { status: 'ready', items: r.data?.items || [] } : { status: 'off', reason: r.reason });
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
          <button type="button" className={BTN_PRIMARY} disabled={off} title={off ? board.reason : undefined} data-testid="work-new-item">+ New item</button>
          <PageAsk label={`Work · ${name}`} />
        </div>
      </header>

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

      {board.status === 'ready' && tab === 'board' ? <Board items={board.items} onOpen={setItemUid} /> : null}
      {board.status === 'ready' && tab === 'backlog' ? <Backlog items={board.items} onOpen={setItemUid} /> : null}
      {tab === 'burnup' && burn.status === 'ready' ? <Burnup series={burn.series} /> : null}
      {tab === 'mine' && board.status === 'ready' ? <p className={MUTED} data-testid="work-mine-later">My items arrive with #3994 (W8).</p> : null}

      {itemUid ? <ItemSheet uid={itemUid} onClose={() => setItemUid(null)} onRun={setRunUid} /> : null}
      {runUid ? <RunSheet uid={runUid} onClose={() => setRunUid(null)} /> : null}
    </div>
  );
}

/** WK1: the six columns, the "Needs you" strip, cards with "Move to ▾". */
export function Board({ items, onOpen, readOnly = false }) {
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
          <section key={c.key} className="wk-col" data-tone={c.tone} aria-label={`${c.label}, ${c.count}`} data-testid={`work-col-${c.key}`}>
            <header className="wk-col-head">
              <span className="wk-dot" aria-hidden="true" /><b>{c.label}</b><span className="wk-count">{c.count}</span>
            </header>
            <p className="wk-col-est">Estimate: {c.estimate}</p>
            <p className="wk-col-line">{c.line}</p>
            {c.cards.map((card) => <Card key={card.uid} card={card} onOpen={onOpen} readOnly={readOnly} />)}
          </section>
        ))}
      </div>
    </>
  );
}

function Card({ card, onOpen, readOnly }) {
  const [menu, setMenu] = useState(false);
  const who = assigneeLine(card);
  const due = dueLine(card.due);
  const chip = runChip(card.run);
  return (
    <article className="wk-card" tabIndex={0} aria-label={card.title} onClick={() => onOpen?.(card.uid)}
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
              {moveTargets(card).map((t) => <li key={t.key} role="menuitem" data-tone={t.tone}>{t.label}</li>)}
            </ul>
          ) : null}
        </span>
      )}
    </article>
  );
}

/** WK2: the backlog as a table, with "Done hidden". */
export function Backlog({ items, onOpen }) {
  const rows = backlogRows(items);
  return (
    <div className="wk-table-wrap" data-testid="work-backlog">
      <table className="wk-table">
        <thead><tr>{BACKLOG_COLUMNS.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid} onClick={() => onOpen?.(r.uid)}>
              <td>{r.title}</td>
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
export function ItemSheet({ uid, onClose, onRun }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    workAdapter.item(uid).then((r) => { if (live) setState(r.available ? { status: 'ready', item: r.data } : { status: 'off', reason: r.reason }); }, () => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [uid]);
  const it = state.item;
  return (
    <Sheet title={it?.title || 'Item'} onClose={onClose} width={560} testId="work-item-sheet"
      footer={it ? <><button type="button" className={BTN_PRIMARY}>Assign</button><button type="button" className={BTN_SECONDARY}>Move ▾</button><button type="button" className={BTN_SECONDARY}>Schedule</button></> : null}>
      {state.status === 'off' ? <HonestBlock>{state.reason}</HonestBlock> : null}
      {state.status === 'error' ? <HonestBlock role="alert">This item could not be read.</HonestBlock> : null}
      {it ? (
        <dl className="wk-fields">
          <dt>Assignee</dt><dd>{assigneeLine(it).text}</dd>
          <dt>Column</dt><dd>{columnLabel(it.column) || NOT_RECORDED_WORD}</dd>
          <dt>Due</dt><dd>{dueLine(it.due)?.text || NOT_RECORDED_WORD}</dd>
          <dt>Goal</dt><dd>{it.goal || NOT_RECORDED_WORD}</dd>
          {it.compliance ? <><dt>Compliance</dt><dd>{it.compliance.title} · the obligation stays with {it.compliance.company}; this work happens in the project</dd></> : null}
          <dt>Agent runs</dt>
          <dd>{(it.runs || []).length ? it.runs.map((r) => <button key={r.uid} type="button" className={BTN_TEXT} onClick={() => onRun(r.uid)}>{runOutcome(r).title} · {runCost(r)}</button>) : 'None'}</dd>
        </dl>
      ) : null}
    </Sheet>
  );
}

/** WK5: what a run read, produced and cost, named by source and tool, never a raw prompt. */
export function RunSheet({ uid, onClose }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    workAdapter.run(uid).then((r) => { if (live) setState(r.available ? { status: 'ready', run: r.data } : { status: 'off', reason: r.reason }); }, () => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [uid]);
  const run = state.run;
  const out = run ? runOutcome(run) : null;
  return (
    <Sheet title={out ? out.title : 'Run'} onClose={onClose} width={560} testId="work-run-sheet"
      footer={run?.status === 'failed' ? <button type="button" className={BTN_PRIMARY}>Retry</button> : null}>
      {state.status === 'off' ? <HonestBlock>{state.reason}</HonestBlock> : null}
      {run ? (
        <dl className="wk-fields">
          <dt>Skill</dt><dd>{run.skill || NOT_RECORDED_WORD}</dd>
          <dt>Worked on</dt><dd>{run.worked_on || NOT_RECORDED_WORD}</dd>
          <dt>Read</dt><dd>{(run.read || []).join(' · ') || NOT_RECORDED_WORD}</dd>
          <dt>Outcome</dt><dd data-tone={out.tone}>{out.title}{out.reason ? `. ${out.reason}` : ''}</dd>
          <dt>Cost</dt><dd>{runCost(run)}</dd>
        </dl>
      ) : null}
    </Sheet>
  );
}
