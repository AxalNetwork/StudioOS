/**
 * D1240 (#3253) — the board on the firm's own stages (DLS1), and on a phone
 * one stage at a time (DLS18b). A card is dragged to another column or moved
 * with "Move to", which is also the keyboard's and the phone's way; the page
 * then says what moved, with Undo. Passed is never a drop target: a pass
 * takes its reason (part 5's dialog).
 */
import React, { useState } from 'react';
import { AskCell, DaysCell, FitCell, OwnerCell, ScopeCell, VentureCell } from './FlowCells';
import { BOARD_STAGES, SCOPE_LABEL, STAGE_WORD, columnAsks, enteredWord, moveTargets } from './flowModel';
import { MAX_COMPARE } from './dealFlowModel';

const COL = 'flex min-w-[240px] flex-1 flex-col gap-2 rounded-xl border border-axal-hairline bg-gray-50 p-2.5 dark:border-gray-800 dark:bg-gray-950';
const CARD = 'flex flex-col gap-1.5 rounded-lg border border-axal-hairline bg-white p-2.5 text-[12.5px] dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-1.5 py-0.5 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** One card: the venture, the round, how it entered, the ask, the card scopes, fit, days, owner, compare and Move to. */
export function FlowCard({ row, cards, picked, onPick, onMove, busy, draggable = true, onPeek = null }) {
  const ticked = picked.includes(row.id);
  return (
    <article className={CARD} draggable={draggable && !busy} onDragStart={(e) => { e.dataTransfer?.setData?.('text/plain', row.id); }} data-testid={`dealflow-card-${row.id}`}>
      <VentureCell row={row} onPeek={onPeek} />
      <div className="flex flex-wrap gap-1">
        <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] dark:border-gray-700">{row.round}</span>
        {row.enteredVia && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">{enteredWord(row.enteredVia)}</span>}
      </div>
      <AskCell row={row} />
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
        {cards.map((k) => (
          <React.Fragment key={k}><dt className={MUTED}>{SCOPE_LABEL[k]}</dt><dd className="m-0 text-right"><ScopeCell scores={row.scores} scope={k} testId={`dealflow-card-${row.id}-${k}`} /></dd></React.Fragment>
        ))}
        <dt className={MUTED}>Fit to my thesis</dt><dd className="m-0 text-right"><FitCell fit={row.fit} testId={`dealflow-card-${row.id}-fit`} /></dd>
      </dl>
      <div className="flex items-center justify-between gap-2">
        <span className={MUTED}><DaysCell row={row} /></span>
        <OwnerCell row={row} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1 text-[12px]">
          <input type="checkbox" checked={ticked} disabled={!ticked && picked.length >= MAX_COMPARE} onChange={() => onPick(row.id)} aria-label={`Compare ${row.name}`} data-testid={`dealflow-tick-${row.id}`} />Compare
        </label>
        <label className="flex items-center gap-1 text-[12px]"><span className="sr-only">Move {row.name} to</span>
          <select className={SELECT} value="" disabled={busy} onChange={(e) => { if (e.target.value) onMove(row, e.target.value); }} data-testid={`dealflow-move-${row.id}`}>
            <option value="">Move to…</option>
            {moveTargets(row.stage).map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

/** A column of one stage: its count, its asks, its cards, and a drop target while a card is dragged over it. */
function Column({ stage, rows, cards, picked, onPick, onMove, busy, byId, onPeek }) {
  const [over, setOver] = useState(false);
  const asks = columnAsks(rows);
  return (
    <section className={`${COL} ${over ? 'ring-2 ring-violet-400 dark:ring-violet-500' : ''}`} aria-label={STAGE_WORD[stage]}
      onDragOver={(e) => { e.preventDefault?.(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault?.(); setOver(false); const row = byId.get(e.dataTransfer?.getData?.('text/plain')); if (row && row.stage !== stage) onMove(row, stage); }}
      data-testid={`dealflow-col-${stage}`}>
      <header className="flex flex-col">
        <h3 className="m-0 text-[13px] font-bold">{STAGE_WORD[stage]} <span className="font-normal text-axal-muted dark:text-gray-400">{rows.length}</span></h3>
        {asks && <span className={MUTED} data-testid={`dealflow-col-${stage}-asks`}>{asks}</span>}
        {over && <span className="text-[12px] font-semibold text-violet-700 dark:text-violet-300">Drop to move to {STAGE_WORD[stage]}</span>}
      </header>
      {rows.map((r) => <FlowCard key={r.id} row={r} cards={cards} picked={picked} onPick={onPick} onMove={onMove} busy={busy} onPeek={onPeek} />)}
    </section>
  );
}

/** DLS1: one column per stage. Passed rows show only when the filters ask for them, in their own column. */
export function FlowBoard({ rows, cards, picked, onPick, onMove, busy, showPassed = false, onPeek = null }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stages = showPassed ? [...BOARD_STAGES, 'passed'] : BOARD_STAGES;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="dealflow-board">
      {stages.map((s) => <Column key={s} stage={s} rows={rows.filter((r) => r.stage === s)} cards={cards} picked={picked} onPick={onPick} onMove={onMove} busy={busy} byId={byId} onPeek={onPeek} />)}
    </div>
  );
}

/** DLS15: the columns with "Reading…" while the flow is read. */
export function FlowBoardLoading() {
  return (
    <div className="flex gap-3 overflow-x-auto" aria-busy="true" data-testid="dealflow-board-loading">
      {BOARD_STAGES.map((s) => <section key={s} className={COL}><h3 className="m-0 text-[13px] font-bold">{STAGE_WORD[s]}</h3><span className={MUTED}>Reading…</span><div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" /></section>)}
    </div>
  );
}

/** DLS18b: one stage at a time, its count on each tab, and Move to in place of dragging. */
export function PhoneBoard({ rows, cards, picked, onPick, onMove, busy, onPeek = null }) {
  const [stage, setStage] = useState('sourcing');
  return (
    <div className="flex flex-col gap-2" data-testid="dealflow-phone-board">
      <nav aria-label="Stage" className="flex gap-1 overflow-x-auto">
        {BOARD_STAGES.map((s) => (
          <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-semibold ${stage === s ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`dealflow-phone-stage-${s}`}>{STAGE_WORD[s]} {rows.filter((r) => r.stage === s).length}</button>
        ))}
      </nav>
      {rows.filter((r) => r.stage === stage).map((r) => <FlowCard key={r.id} row={r} cards={cards} picked={picked} onPick={onPick} onMove={onMove} busy={busy} draggable={false} onPeek={onPeek} />)}
    </div>
  );
}
