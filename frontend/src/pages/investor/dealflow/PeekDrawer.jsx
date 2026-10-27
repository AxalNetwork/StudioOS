/**
 * D1241 (#3254, part 5 of #2423) — DLS7, the deal peek: a 560-wide sheet over
 * the board or the table. The venture, its stage with Move to, the round, the
 * scores by scope (band and confidence, never a number), the facts the flow
 * holds, the firm's note, Pass and Add to compare.
 *
 * DLS7b: a click on a score opens SCORING's own breakdown panel
 * (`VentureScorecard`, D1257) for that deal, by its visibility rule: only on a
 * deal the investor may read (`can_open`). Eadwyn never changes a score here.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { actionGhost, actionPrimary } from '../../../ui';
import VentureScorecard from '../../../components/scoring/scorecard/Scorecard';
import { SCOPE_KEYS, SCOPE_LABEL, STAGE_WORD, enteredWord, moveTargets, stageWord } from './flowModel';
import { AskCell, DaysCell, FitCell, ScopeCell } from './FlowCells';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] dark:border-gray-700';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-1.5 py-0.5 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const ROW_BTN = 'flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-800 dark:disabled:hover:bg-transparent';

export default function PeekDrawer({ row, picked = [], onClose, onMove, onPass, onPick, onSaveNote, busy = false }) {
  const [breakdown, setBreakdown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(row.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const compared = picked.includes(row.id);
  const saveNote = async () => {
    setSaving(true); setError('');
    try { await onSaveNote(row, note.trim() || null); setEditing(false); } catch (e) { setError(e?.message || 'The note could not be saved. Nothing changed.'); } finally { setSaving(false); }
  };
  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      {row.inFlow && row.stage !== 'passed' && <button type="button" className={actionGhost} onClick={() => onPass(row)} disabled={busy} data-testid="dealflow-peek-pass">Pass</button>}
      <button type="button" className={actionPrimary} onClick={() => onPick(row.id)} data-testid="dealflow-peek-compare">{compared ? 'Remove from compare' : 'Add to compare'}</button>
    </div>
  );
  return (
    <Sheet label={`${row.name} details`} title={row.name} sub={[row.sector, row.round].filter(Boolean).join(' · ')} onClose={onClose} width={560} testId="dealflow-peek" footer={footer}>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${PILL} font-semibold`} data-testid="dealflow-peek-stage">{stageWord(row.stage)}</span>
          {row.inFlow && (
            <label className="flex items-center gap-1 text-[12px]"><span className="sr-only">Move {row.name} to</span>
              <select className={SELECT} value="" disabled={busy} onChange={(e) => { if (e.target.value) onMove(row, e.target.value); }} data-testid="dealflow-peek-move">
                <option value="">Move to…</option>
                {moveTargets(row.stage).map((s) => <option key={s} value={s}>{STAGE_WORD[s]}</option>)}
              </select>
            </label>
          )}
          <span className={PILL}>{row.round}</span>
          {row.canOpen
            ? <Link to={`/deals/${row.id}`} className="ml-auto text-[12.5px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100" data-testid="dealflow-peek-open">Open deal page ›</Link>
            : <span className={`${MUTED} ml-auto`}>Opens once you are invited or commit.</span>}
        </div>

        <section className="flex flex-col gap-1" aria-labelledby="peek-scores">
          <h3 id="peek-scores" className={EYE}>Scores by scope</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {SCOPE_KEYS.map((k) => (
              <li key={k}>
                <button type="button" className={ROW_BTN} disabled={!row.canOpen} onClick={() => setBreakdown(true)} data-testid={`dealflow-peek-scope-${k}`}>
                  <span>{SCOPE_LABEL[k]}</span>
                  <ScopeCell scores={row.scores} scope={k} />
                </button>
              </li>
            ))}
          </ul>
          <p className={MUTED}>{row.canOpen ? 'Each row opens the scoring breakdown panel.' : 'The scoring breakdown opens on deals you are invited to or have committed on.'}</p>
        </section>

        <section className="flex flex-col gap-1" aria-labelledby="peek-facts">
          <h3 id="peek-facts" className={EYE}>Facts</h3>
          <dl className="m-0 grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className={MUTED}>Ask</dt><dd className="m-0"><AskCell row={row} /></dd>
            <dt className={MUTED}>Fit to my thesis</dt><dd className="m-0"><FitCell fit={row.fit} /></dd>
            <dt className={MUTED}>Owner</dt><dd className="m-0">{row.owner?.name || (row.inFlow ? 'Unassigned' : 'Not on your deals')}</dd>
            <dt className={MUTED}>Entered via</dt><dd className="m-0">{row.inFlow ? enteredWord(row.enteredVia) : 'Not on your deals'}</dd>
            <dt className={MUTED}>Days in stage</dt><dd className="m-0"><DaysCell row={row} /></dd>
          </dl>
          <p className={MUTED}>Valuation cap, minimum check, closing deadline and what is committed so far are on the deal page.</p>
        </section>

        {row.inFlow && (
          <section className="flex flex-col gap-1" aria-labelledby="peek-notes">
            <h3 id="peek-notes" className={EYE}>Your notes</h3>
            {editing ? (
              <div className="flex flex-col gap-2">
                <textarea className={FIELD} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="dealflow-peek-note-field" />
                <p className={MUTED}>Your firm sees this note. Saving replaces the note on this deal.</p>
                {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" className={actionGhost} onClick={() => { setEditing(false); setNote(row.note || ''); }} disabled={saving}>Cancel</button>
                  <button type="button" className={actionPrimary} onClick={saveNote} disabled={saving} data-testid="dealflow-peek-note-save">{saving ? 'Saving…' : 'Save note'}</button>
                </div>
              </div>
            ) : (
              <>
                {row.note ? <blockquote className="m-0 border-l-2 border-violet-300 pl-3 dark:border-violet-700" data-testid="dealflow-peek-note">{row.note}</blockquote>
                  : <p className={MUTED}>No note yet.</p>}
                <button type="button" className="w-fit text-[12.5px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100" onClick={() => setEditing(true)} data-testid="dealflow-peek-note-edit">{row.note ? 'Edit the note' : 'Add a note'}</button>
              </>
            )}
          </section>
        )}
      </div>
      {breakdown && (
        <Sheet label="Scoring breakdown panel" title="Scoring breakdown" sub={row.name} onClose={() => setBreakdown(false)} width={760} testId="dealflow-peek-breakdown">
          <VentureScorecard dealId={row.id} />
        </Sheet>
      )}
    </Sheet>
  );
}
