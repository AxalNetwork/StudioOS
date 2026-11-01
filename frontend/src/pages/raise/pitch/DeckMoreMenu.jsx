import React, { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import useAssistMode from '../../../hooks/useAssistMode';
import { availability } from './deckV2Adapter';
import { LATER, MORE_MENU, SHARE_ITEMS, moreName, moreState } from './deckV2Model';
import useMenuFocus from './useMenuFocus';

/**
 * D1604 (#3716, pd13) — the editor header's ⋯ menu, "More deck actions", in
 * three sections: THIS DECK, THIS CARD and WHOLE DECK · USES AI (plan §2.2,
 * `MORE_MENU` in `deckV2Model.js`). On a phone a SHARE section comes first,
 * because the header there has no Share ▾.
 *
 * Each item is wired on main, and pressing it calls `onPick(id)` (the editor
 * opens the sheet or makes the local edit), or it reads `deckV2Adapter.js`:
 * greyed, "Coming later", titled with the adapter's reason, and still reached
 * by the keyboard so the reason is read out. A write is greyed for a reader.
 * When items that run a model are off because AI is paused (or the founder is
 * out of tokens), the button's name says ", N off: <why>" and an amber dot
 * shows. While the editor is not on screen (`waiting`, the sentence why), the
 * items it carries out are greyed with that sentence; Share's stay live.
 * The keyboard is `useMenuFocus.js`'s. Nothing here runs a model or reads
 * the network.
 */

const ITEM = 'flex min-h-[36px] w-full items-center justify-between gap-3 rounded-[8px] px-2.5 text-left text-[12.5px]';

export default function DeckMoreMenu({ onPick, readOnly = false, phone = false, labels = {}, outOfTokens = false, waiting = null, testId = 'deck-more' }) {
  const [aiOn] = useAssistMode('raise');
  const [open, setOpen] = useState(false);
  const menu = useMenuFocus(open, () => setOpen(false));
  const sections = useMemo(() => (phone ? [{ id: 'share', label: 'Share', items: readOnly ? [] : SHARE_ITEMS }, ...MORE_MENU] : MORE_MENU)
    .filter((s) => s.items.length), [phone, readOnly]);
  const state = moreState(sections, { readOnly, aiOn, outOfTokens, availability, waiting });

  const choose = (it) => {
    if (it.disabled) return;
    setOpen(false);
    onPick?.(it.id);
  };
  let n = 0;

  return (
    <div className="relative" ref={menu.box} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur} data-testid={testId}>
      <button type="button" ref={menu.opener} aria-haspopup="menu" aria-expanded={open} aria-label={moreName(state.off, state.why)}
        className="relative inline-flex h-10 min-w-[40px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-2.5 text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        onClick={() => setOpen((o) => !o)} data-testid={`${testId}-open`}>
        <MoreHorizontal size={16} aria-hidden="true" />
        {state.off > 0 ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" data-testid={`${testId}-dot`} /> : null}
      </button>
      {open ? (
        <div role="menu" aria-label={moreName(state.off, state.why)}
          className="absolute right-0 top-[44px] z-30 flex max-h-[70vh] w-[280px] flex-col gap-1 overflow-auto rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          data-testid={`${testId}-menu`}>
          {state.sections.map((s) => (
            <div key={s.id} role="group" aria-label={s.label} className="flex flex-col" data-testid={`${testId}-section-${s.id}`}>
              <span className="px-2.5 pb-0.5 pt-1.5 font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400" aria-hidden="true">{s.label}</span>
              {s.items.map((it) => (
                <button key={it.id} ref={menu.item(n++)} type="button" role="menuitem" aria-disabled={it.disabled || undefined} title={it.why || undefined}
                  className={`${ITEM} ${it.disabled ? 'cursor-not-allowed text-axal-muted dark:text-gray-500' : 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
                  onClick={() => choose(it)} data-testid={`${testId}-${it.id}`}>
                  <span>{labels[it.id] || it.label}{it.note ? <span className="ml-1.5 text-[11px] text-axal-muted dark:text-gray-400">· {it.note}</span> : null}</span>
                  {it.later ? <span className="whitespace-nowrap font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span> : null}
                  {!it.later && it.disabled && it.why && it.ai ? <span className="whitespace-nowrap font-mono text-[10px] text-amber-700 dark:text-amber-300">Off</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
