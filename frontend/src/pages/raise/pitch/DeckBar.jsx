import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { STUDIO_PATH, TABS } from './pitchStudioModel';
import useMenuFocus from './useMenuFocus';

/**
 * D4254 P1 slice 2 (#4274; canvas psE, psES, psEA) — the deck bar. While a
 * deck is open, the page header, the module pills and the tile row collapse
 * into this one row:
 *
 *   ‹ Pitch       back to the Overview (`/raise/pitch`), the venture kept;
 *                 "‹" alone, named "Back to Pitch", when the bar is compact
 *   the deck      the h1 "[Venture] · vN" (`heading`)
 *   section ▾     "Decks", a menu of the five tiles (Decks, Script &
 *                 rehearsal, Review, Share & analytics, Notes)
 *   Edit/Comment  the mode: Comment opens the selected card's comments
 *                 (`CommentsSheet`), Edit closes them; a reader has no Edit
 *   `tools`       `DeckToolbar.jsx`: undo/redo, the save state, ⋯, Present,
 *                 Share ▾ and Save version, unchanged
 *   `ask`         the deck's Ask
 *
 * The AIRail stays beside the page. `compact` (a phone) drops the words from
 * the back link. Nothing here reads the network.
 */
const LINK = 'inline-flex min-h-[36px] shrink-0 items-center rounded-[9px] px-2.5 text-[12.5px] font-bold text-axal-ink/80 hover:bg-axal-ground hover:text-axal-ink max-sm:min-h-[44px] dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100';
const PILL = 'inline-flex min-h-[32px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-axal-lavender px-3 text-[12.5px] font-bold text-violet-800 max-sm:min-h-[44px] dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200';
const SEG = 'inline-flex min-h-[30px] items-center rounded-[7px] px-3 text-[12.5px] max-sm:min-h-[40px]';

export const DECK_SECTION = 'decks';

export default function DeckBar({ q = '', heading = null, tools = null, ask = null, commenting = false, onMode = null, readOnly = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const menu = useMenuFocus(open, () => setOpen(false));
  const here = TABS.find((t) => t.id === DECK_SECTION) || TABS[0];
  return (
    <div role="toolbar" aria-label="Deck" className="flex min-w-0 flex-wrap items-center gap-2 rounded-[12px] border border-axal-hairline bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900" data-testid="pitch-deck-bar">
      <Link to={`${STUDIO_PATH}${q}`} className={LINK} aria-label={compact ? 'Back to Pitch' : undefined} data-testid="pitch-back">‹{compact ? '' : ' Pitch'}</Link>
      <span aria-hidden="true" className="h-[22px] w-px shrink-0 bg-axal-hairline dark:bg-gray-700" />
      {heading ? <h1 className="m-0 min-w-0 truncate px-1 text-[14px] font-extrabold leading-tight text-axal-ink dark:text-gray-100" data-testid="pitch-heading">{heading}</h1> : null}
      <div className="relative shrink-0" ref={menu.box} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur}>
        <button type="button" ref={menu.opener} className={PILL} aria-haspopup="menu" aria-expanded={open}
          aria-label={`Pitch section: ${here.label}`} onClick={() => setOpen((v) => !v)} data-testid="pitch-deck-bar-section">
          {here.label}<ChevronDown size={12} aria-hidden="true" />
        </button>
        {open ? (
          <div role="menu" aria-label="Pitch sections" className="absolute left-0 top-full z-30 mt-1 flex min-w-[210px] flex-col rounded-[10px] border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="pitch-deck-bar-sections">
            {TABS.map((t, i) => (
              <Link key={t.id} role="menuitem" ref={menu.item(i)} to={`${t.path}${q}`} aria-current={t.id === here.id ? 'page' : undefined}
                className="flex min-h-[36px] items-center rounded-[7px] px-2.5 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground aria-[current=page]:text-violet-800 dark:text-gray-100 dark:hover:bg-gray-800 dark:aria-[current=page]:text-violet-200"
                onClick={() => setOpen(false)} data-testid={`pitch-deck-bar-section-${t.id}`}>{t.label}</Link>
            ))}
          </div>
        ) : null}
      </div>
      <span className="min-w-[8px] flex-1" aria-hidden="true" />
      {onMode ? (
        <div role="group" aria-label="Mode" className="inline-flex shrink-0 gap-0.5 rounded-[9px] border border-axal-hairline bg-axal-ground p-[3px] dark:border-gray-700 dark:bg-gray-950" data-testid="pitch-deck-bar-mode">
          {readOnly ? null : (
            <button type="button" aria-pressed={!commenting} onClick={() => commenting && onMode('edit')} data-testid="pitch-deck-bar-edit"
              className={`${SEG} ${!commenting ? 'bg-white font-bold text-axal-ink shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'font-semibold text-axal-muted dark:text-gray-400'}`}>Edit</button>
          )}
          <button type="button" aria-pressed={commenting} onClick={() => !commenting && onMode('comment')} data-testid="pitch-deck-bar-comment"
            className={`${SEG} ${commenting ? 'bg-white font-bold text-axal-ink shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'font-semibold text-axal-muted dark:text-gray-400'}`}>Comment</button>
        </div>
      ) : null}
      {tools || ask ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2" data-testid="pitch-header-tools">
          {tools}
          {ask ? <div className="shrink-0" data-testid="pitch-header-ask">{ask}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
