import React, { useMemo, useState } from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { BOUND_NEVER, findIn } from './gridOps';
import { SYNCED, TYPING_WORKS, offlineLine, restoreLine } from './deckAutosave';
import { STILL_CHARGED } from './deckV2Model';
import { cardTitle } from './editorModel';

/**
 * D1515 (#3767, deck v2 A4c) — the editing lines and the Find sheet, drawn
 * by the editor above its stage:
 *
 *   RestoreBanner     pd9q's inset: "Restore unsaved changes from [14:32]?"
 *                     with Discard and Restore. The time is the device copy's,
 *                     or the Worker draft's `updated_at`; a time that cannot
 *                     be read is left out, never 00:00
 *   SyncLine          pd9p: "Offline · [3] changes saved on this device.
 *                     They'll sync when you're back." with "Typing still
 *                     works.", then "Synced" once they reached the Worker
 *   ConflictView      pd9q: "Your version" and "Their version" of the card
 *                     (the 409's `server`), Keep mine, Keep theirs and "Copy
 *                     mine to a new card"
 *   StillCharged      after an undo took an accepted, charged run off the
 *                     card: undo never refunds it (plan §4.5)
 *   FindReplaceSheet  ⋯ › Find and replace… (⌘F): Find, Replace with, Match
 *                     case, the count, Replace all (one undo step) and "Bound
 *                     figures are never replaced."
 *
 * Every line is in-page; nothing here writes. The editor carries out each
 * press.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const AMBER = 'flex flex-wrap items-center gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200';
const LAV = 'flex flex-wrap items-center gap-2 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100';

export function RestoreBanner({ at, busy = false, onRestore, onDiscard }) {
  return (
    <div className={LAV} role="region" aria-label="Unsaved changes" data-testid="pitch-restore">
      <span className="flex-1 font-bold" data-testid="pitch-restore-line">{restoreLine(at)}</span>
      <button type="button" className={GHOST} disabled={busy} onClick={onDiscard} data-testid="pitch-restore-discard">Discard</button>
      <button type="button" className={PRIMARY} disabled={busy} onClick={onRestore} data-testid="pitch-restore-run">Restore</button>
    </div>
  );
}

export function SyncLine({ sync }) {
  if (sync?.state === 'offline') {
    return (
      <div className={AMBER} role="status" data-testid="pitch-sync-offline">
        <span className="font-bold">{offlineLine(sync.queued)}</span>
        <span>{TYPING_WORKS}</span>
      </div>
    );
  }
  if (sync?.state === 'synced' && sync.recovered) return <span className={MUTED} role="status" data-testid="pitch-sync-synced">{SYNCED}</span>;
  if (sync?.state === 'error') return <span className={MUTED} role="status" data-testid="pitch-sync-error">{sync.reason} Your changes are kept on this device.</span>;
  return null;
}

/** A card, as the conflict board lists it: its title and the words of its blocks. */
function CardWords({ card, index }) {
  if (!card) return <span className={MUTED}>The draft no longer holds this card.</span>;
  const lines = (card.blocks || []).filter((b) => b.kind === 'text' && String(b.text || '').trim()).map((b) => String(b.text).trim());
  return (
    <span className="flex flex-col gap-1">
      <span className={`text-[13px] font-bold ${INK}`}>{cardTitle(card, index)}</span>
      {lines.length ? lines.slice(0, 6).map((l, i) => <span key={i} className={`text-[12.5px] ${INK}`}>{l}</span>) : <span className={MUTED}>No words on this card.</span>}
      {card.notes ? <span className={MUTED}>Notes: {String(card.notes).slice(0, 160)}</span> : null}
    </span>
  );
}

export function ConflictView({ conflict, index, onMine, onTheirs, onCopy }) {
  if (!conflict) return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-amber-300 bg-white p-3 dark:border-amber-700 dark:bg-gray-900" role="alertdialog" aria-label="This card changed elsewhere" data-testid="pitch-conflict">
      <span className={`text-[13px] font-bold ${INK}`}>Card {index + 1} changed in another tab or by another member while you were editing.</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid="pitch-conflict-mine">
          <span className={EYE}>Your version</span>
          <CardWords card={conflict.mine} index={index} />
        </div>
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-2.5 dark:border-gray-700" data-testid="pitch-conflict-theirs">
          <span className={EYE}>Their version</span>
          <CardWords card={conflict.theirs} index={index} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} onClick={onMine} data-testid="pitch-conflict-mine-keep">Keep mine</button>
        <button type="button" className={GHOST} onClick={onTheirs} disabled={!conflict.theirs} data-testid="pitch-conflict-theirs-keep">Keep theirs</button>
        <button type="button" className={GHOST} onClick={onCopy} disabled={!conflict.theirs} data-testid="pitch-conflict-copy">Copy mine to a new card</button>
      </div>
    </div>
  );
}

export function StillCharged({ onClose }) {
  return (
    <div className={AMBER} role="status" data-testid="pitch-still-charged">
      <span className="flex-1">{STILL_CHARGED}</span>
      <button type="button" className="min-h-[36px] font-bold underline max-sm:min-h-[44px]" onClick={onClose} data-testid="pitch-still-charged-close">OK</button>
    </div>
  );
}

/**
 * ⋯ › Find and replace… (pd3, l.429–431). The count says how many matches
 * Replace all changes and on how many cards, and how many sit in bound
 * figures, which it leaves alone.
 */
export function FindReplaceSheet({ doc, readOnly = false, onReplace, onClose }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [said, setSaid] = useState(null);
  const found = useMemo(() => (find ? findIn(doc, { find, matchCase }) : null), [doc, find, matchCase]);
  const run = () => {
    const r = onReplace?.({ find, replace, matchCase });
    setSaid(r?.error ? { error: r.error } : { line: `Replaced ${r?.count ?? found?.matches ?? 0}. One undo step puts them back.` });
  };
  const count = found
    ? `${found.matches} ${found.matches === 1 ? 'match' : 'matches'}${found.matches ? ` on ${found.cards} ${found.cards === 1 ? 'card' : 'cards'}` : ''}${found.skipped ? ` · ${found.skipped} in bound figures, left as they are` : ''}`
    : null;
  return (
    <Sheet label="Find and replace" title="Find and replace" eyebrow="More deck actions" width={480} onClose={onClose} testId="pitch-sheet-find">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1"><span className={EYE}>Find · ⌘F</span>
          <input className={FIELD} value={find} spellCheck={false} onChange={(e) => { setFind(e.target.value); setSaid(null); }} data-testid="pitch-find-field" />
        </label>
        <label className="flex flex-col gap-1"><span className={EYE}>Replace with</span>
          <input className={FIELD} value={replace} spellCheck onChange={(e) => { setReplace(e.target.value); setSaid(null); }} disabled={readOnly} data-testid="pitch-find-replace" />
        </label>
        <label className={`flex min-h-[44px] items-center gap-2 text-[12.5px] ${INK}`}>
          <input type="checkbox" checked={matchCase} onChange={(e) => { setMatchCase(e.target.checked); setSaid(null); }} data-testid="pitch-find-case" /> Match case
        </label>
        {count ? <span className={MUTED} role="status" data-testid="pitch-find-count">{count}</span> : null}
        {!readOnly ? (
          <button type="button" className={PRIMARY} disabled={!find || !found?.matches} onClick={run} data-testid="pitch-find-run">Replace all</button>
        ) : null}
        {said?.line ? <span className={MUTED} role="status" data-testid="pitch-find-said">{said.line}</span> : null}
        {said?.error ? <span className={MUTED} role="status" data-testid="pitch-find-said">{said.error}</span> : null}
        <span className={MUTED} data-testid="pitch-find-bound">{BOUND_NEVER}</span>
        <span className={MUTED}>Searches card titles, the words in text blocks and the speaker notes. Nothing is saved until you save a version.</span>
      </div>
    </Sheet>
  );
}
