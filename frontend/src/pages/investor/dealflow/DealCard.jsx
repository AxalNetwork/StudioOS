/**
 * D5900 (#5900, Deals v2 DX1b) — the deal card of boards DE01 and DE01b: the
 * venture, sector and place, the three status families (company, my process,
 * transaction), the ask, the score strip, at most three chosen scopes through
 * the shared `ScopeScore`, fit to my thesis, days in stage, the owner, and
 * Open, Move to… and Compare. Move to… is a menu, so the card moves without
 * dragging (keyboard and phone). Its states (normal, low confidence, missing,
 * locked, stale, passed, unassigned) are `dealCardModel.cardStates`'s, from
 * the reads the board already has.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AskCell, DaysCell, FitCell, OwnerCell, ScopeCell, ScorecardCell, VentureCell } from './FlowCells';
import { SCOPE_LABEL, STAGE_WORD, enteredWord, moveTargets, scopeCell } from './flowModel';
import { MAX_COMPARE } from './dealFlowModel';
import { PLACE_UNRECORDED, STALE_TITLE, cardStates, familiesOf } from './dealCardModel';
// D6145 (#6145): "Assign to me" beside Move to…, where the card is in the flow and someone else (or no one) owns it.
import { AssignToMe } from './OwnerControls';

const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const TARGET = 'max-sm:min-h-[44px]';
const SELECT = `rounded-md border border-axal-hairline bg-white px-1.5 py-0.5 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 ${TARGET}`;
const BTN = `inline-flex items-center rounded-md border border-axal-hairline bg-white px-2 py-0.5 text-[12px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 ${TARGET}`;

/** Company status: a square tag, upper case, marked CO. */
export function CompanyStatus({ family, testId }) {
  return (
    <span title={family.title} className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-axal-ink dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      data-family="company" data-recorded={family.recorded ? 'true' : 'false'} data-testid={testId}>
      <span className="font-semibold text-axal-muted dark:text-gray-400">CO</span>
      <span className={family.recorded ? '' : 'italic normal-case'}>{family.word}</span>
    </span>
  );
}

/** My process: a round violet pill with a dot. */
export function ProcessStatus({ family, testId }) {
  return (
    <span title={family.title} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 text-[11px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
      data-family="process" data-testid={testId}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-violet-600 dark:bg-violet-400" />{family.word}
    </span>
  );
}

/** Transaction status: a flat tag with a teal rule on its left. */
export function TransactionStatus({ family, testId }) {
  return (
    <span title={family.title} className="inline-flex items-center rounded-md border border-l-[3px] border-gray-300 border-l-teal-700 bg-white pl-1.5 pr-2 text-[11px] font-bold text-teal-800 dark:border-gray-600 dark:border-l-teal-400 dark:bg-gray-900 dark:text-teal-300"
      data-family="transaction" data-testid={testId}>
      {family.word}
    </span>
  );
}

const FLAG = {
  stale: { word: 'Stale', title: STALE_TITLE, cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200' },
  passed: { word: 'Passed', title: 'You passed on this deal.', cls: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  unassigned: { word: 'Unassigned', title: 'No one on your side owns this deal.', cls: 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300' },
  low_confidence: { word: 'Low confidence', title: 'Every scored scope on this scorecard is low confidence.', cls: 'border-dashed border-violet-300 bg-white text-violet-800 dark:border-violet-700 dark:bg-gray-900 dark:text-violet-200' },
};

/** One card. `phone` cards are never dragged; Move to… is the way to move on every width. */
export function DealCard({ row, cards, picked, onPick, onMove, busy, draggable = true, onPeek = null }) {
  const ticked = picked.includes(row.id);
  const states = cardStates(row, cards, scopeCell);
  const fam = familiesOf(row);
  const frame = states.includes('passed')
    ? 'border-dashed border-gray-300 opacity-75 dark:border-gray-600'
    : states.includes('stale') ? 'border-amber-300 dark:border-amber-700' : 'border-axal-hairline dark:border-gray-800';
  return (
    <article className={`flex flex-col gap-1.5 rounded-lg border bg-white p-2.5 text-[12.5px] dark:bg-gray-900 ${frame}`} aria-label={row.name}
      draggable={draggable && !busy} onDragStart={(e) => { e.dataTransfer?.setData?.('text/plain', row.id); }}
      data-testid={`dealflow-card-${row.id}`} data-states={states.join(' ')}>
      <VentureCell row={row} onPeek={onPeek} />
      <span className={`${MUTED} italic`} title={PLACE_UNRECORDED} data-testid={`dealflow-card-${row.id}-place`}>Place not recorded</span>
      <div className="flex flex-wrap items-center gap-1">
        <CompanyStatus family={fam.company} testId={`dealflow-card-${row.id}-company`} />
        <ProcessStatus family={fam.process} testId={`dealflow-card-${row.id}-process`} />
        <TransactionStatus family={fam.transaction} testId={`dealflow-card-${row.id}-transaction`} />
      </div>
      {row.enteredVia && <span className={MUTED}>{enteredWord(row.enteredVia)}</span>}
      <span className="font-mono text-[12px] font-bold"><AskCell row={row} /></span>
      <ScorecardCell scores={row.scores} testId={`dealflow-card-${row.id}-strip`} />
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
        {cards.map((k) => (
          <React.Fragment key={k}><dt className={MUTED}>{SCOPE_LABEL[k]}</dt><dd className="m-0 text-right"><ScopeCell scores={row.scores} scope={k} testId={`dealflow-card-${row.id}-${k}`} /></dd></React.Fragment>
        ))}
        <dt className={MUTED}>Fit to my thesis</dt><dd className="m-0 text-right"><FitCell fit={row.fit} testId={`dealflow-card-${row.id}-fit`} /></dd>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-1.5 dark:border-gray-800">
        <span className={MUTED}><DaysCell row={row} /> in stage</span>
        <span className="flex flex-wrap items-center gap-1">
          {['stale', 'passed', 'low_confidence', 'unassigned'].filter((k) => states.includes(k)).map((k) => (
            <span key={k} title={FLAG[k].title} className={`rounded-full border px-2 text-[11px] font-bold ${FLAG[k].cls}`} data-testid={`dealflow-card-${row.id}-flag-${k}`}>{FLAG[k].word}</span>
          ))}
          {row.owner && <OwnerCell row={row} />}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.canOpen
          ? <Link to={`/deals/${row.id}`} className={BTN} data-testid={`dealflow-card-open-${row.id}`}>Open</Link>
          : <span role="link" aria-disabled="true" title="Opens once you are invited or commit." className={`${BTN} cursor-not-allowed opacity-60`} data-testid={`dealflow-card-open-${row.id}`}>Open</span>}
        <label className="flex items-center gap-1 text-[12px]"><span className="sr-only">Move {row.name} to</span>
          <select className={SELECT} value="" disabled={busy} onChange={(e) => { if (e.target.value) onMove(row, e.target.value); }} data-testid={`dealflow-move-${row.id}`}>
            <option value="">Move to…</option>
            {moveTargets(row.stage).map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
          </select>
        </label>
        <AssignToMe row={row} testId={`dealflow-card-${row.id}-assign`} />
        <label className={`flex items-center gap-1 text-[12px] ${TARGET}`}>
          <input type="checkbox" checked={ticked} disabled={!ticked && picked.length >= MAX_COMPARE} onChange={() => onPick(row.id)} aria-label={`Compare ${row.name}`} data-testid={`dealflow-tick-${row.id}`} />Compare
        </label>
      </div>
    </article>
  );
}

export default DealCard;
