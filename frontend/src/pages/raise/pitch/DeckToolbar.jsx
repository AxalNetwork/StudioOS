import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Play } from 'lucide-react';
import DeckMoreMenu from './DeckMoreMenu';
import { SAVE_VERSION, SHARE_ITEMS } from './deckV2Model';

/**
 * D1604 (#3716, pd0, pd3, pd13) — the editor's header row, left of the Ask:
 *
 *   save state   "✓ Saved" (titled "All changes saved · <when>"), or
 *                "● Unsaved changes" with the violet Save version, which
 *                exists only while there is something to save (main has no
 *                autosave until #3751; owner question G)
 *   ⋯            `DeckMoreMenu.jsx`, "More deck actions"
 *   ▶ Present    present mode for the version on screen; a reader keeps it
 *   Share ▾      Share link… (`ShareDialog`) and Export… (`ExportDialog`).
 *                A reader has no Share: an export writes the ledger, as on
 *                main. On a phone the two items live in ⋯ instead.
 *
 * Nothing else sits in the header (the owner's rule: Present, Share and Ask
 * stay visible, everything else goes in ⋯). The tablet keeps the same row.
 * `chip` is `saveChip()`'s; `onAction(id)` is the editor's, for the ⋯ items,
 * `share`, `export` and `save`.
 */

const BTN = 'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:hover:bg-violet-500`;

export default function DeckToolbar({ chip, presentTo = null, readOnly = false, phone = false, onAction, labels, testId = 'deck-toolbar' }) {
  const [share, setShare] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!share) return undefined;
    const doc = globalThis.document;
    const away = (e) => { if (box.current && typeof box.current.contains === 'function' && !box.current.contains(e.target)) setShare(false); };
    doc?.addEventListener?.('mousedown', away);
    return () => doc?.removeEventListener?.('mousedown', away);
  }, [share]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid={testId}>
      {chip ? (
        <span className={`text-[12px] ${chip.save ? 'font-bold text-amber-700 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`} title={chip.title} data-testid="pitch-editor-save-state">{chip.text}</span>
      ) : null}
      {chip?.save && !readOnly ? (
        <button type="button" className={PRIMARY} onClick={() => onAction?.('save')} data-testid="pitch-editor-save">{SAVE_VERSION}</button>
      ) : null}
      <DeckMoreMenu onPick={onAction} readOnly={readOnly} phone={phone} labels={labels} testId="deck-more" />
      {presentTo ? (
        <Link className={GHOST} to={presentTo} data-testid={`${testId}-present`}><Play size={13} aria-hidden="true" /> Present</Link>
      ) : null}
      {!readOnly && !phone ? (
        <div className="relative" ref={box} onKeyDown={(e) => { if (e.key === 'Escape') setShare(false); }}>
          <button type="button" className={GHOST} aria-haspopup="menu" aria-expanded={share} onClick={() => setShare((s) => !s)} data-testid={`${testId}-share`}>
            Share <ChevronDown size={13} aria-hidden="true" />
          </button>
          {share ? (
            <div role="menu" aria-label="Share" className="absolute right-0 top-[44px] z-30 flex w-[180px] flex-col rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`${testId}-share-menu`}>
              {SHARE_ITEMS.map((it) => (
                <button key={it.id} type="button" role="menuitem"
                  className="flex min-h-[36px] items-center rounded-[8px] px-2.5 text-left text-[12.5px] text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800"
                  onClick={() => { setShare(false); onAction?.(it.id); }} data-testid={`${testId}-item-${it.id}`}>{it.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
