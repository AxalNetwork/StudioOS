import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { availability } from './deckV2Adapter';
import { LATER } from './deckV2Model';
import { cardTitle, keyMove } from './editorModel';

/**
 * D1604 (#3716, pd0, pd3) — the Cards strip, in place of D898's rail: each
 * card numbered, with a thumbnail of its blocks on the Grid, its title, the
 * stale dot when a figure on it moved past its store, and "Appendix" when it
 * is one. The current card is lavender with a violet edge.
 *
 * Reorder by dragging, or Alt + ↑ / ↓ on a focused card (`move`, the editor's
 * own). Past `SHOWN` cards the rest fold under "+ N more cards" (the current
 * card always shows). Each card has its menu, the card's ⋯ (pd13): Duplicate,
 * Move up, Move down and Mark as appendix are local edits held until a
 * version is saved; Hide and Move to section read the adapter (#3788) and are
 * drawn "Coming later". A reader reads the strip and moves nothing.
 */

export const SHOWN = 8;

const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** The card's blocks as outlines on a 16:9 face, positioned on the 12 × 6 Grid. */
export function Thumb({ card }) {
  const blocks = Array.isArray(card?.blocks) ? card.blocks.filter((b) => b?.grid) : [];
  return (
    <span className="relative block aspect-[16/9] w-full overflow-hidden rounded-[6px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-950" aria-hidden="true">
      {blocks.map((b, i) => (
        <span key={b.id ?? i} className={`absolute rounded-[2px] ${b.kind === 'text' ? 'bg-axal-hairline dark:bg-gray-700' : 'bg-axal-lavender dark:bg-violet-900/50'}`}
          style={{
            left: `${3 + ((b.grid.c1 - 1) / 12) * 94}%`, width: `${((b.grid.c2 - b.grid.c1 + 1) / 12) * 94 - 1}%`,
            top: `${3 + ((b.grid.r1 - 1) / 6) * 94}%`, height: `${((b.grid.r2 - b.grid.r1 + 1) / 6) * 94 - 2}%`,
          }} />
      ))}
      {!Array.isArray(card?.blocks) ? <span className="absolute inset-[12%] rounded-[2px] bg-axal-hairline dark:bg-gray-700" /> : null}
    </span>
  );
}

function CardMenu({ index, count, card, onAction, onClose }) {
  const box = useRef(null);
  useEffect(() => {
    const doc = globalThis.document;
    const away = (e) => { if (box.current && typeof box.current.contains === 'function' && !box.current.contains(e.target)) onClose(); };
    doc?.addEventListener?.('mousedown', away);
    return () => doc?.removeEventListener?.('mousedown', away);
  }, [onClose]);
  const items = [
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'up', label: 'Move up', off: index === 0 ? 'It is the first card.' : null },
    { id: 'down', label: 'Move down', off: index === count - 1 ? 'It is the last card.' : null },
    { id: 'appendix', label: card?.appendix ? 'Not an appendix' : 'Mark as appendix' },
    { id: 'hide', label: 'Hide', adapter: 'media' },
    { id: 'section', label: 'Move to section', adapter: 'media' },
  ];
  return (
    <div ref={box} role="menu" aria-label={`Card ${index + 1}`} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="absolute left-full top-0 z-30 ml-1 flex w-[200px] flex-col rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      data-testid={`pitch-editor-card-menu-${index}`}>
      {items.map((it) => {
        const later = it.adapter ? availability(it.adapter) : null;
        const why = later?.reason || it.off || null;
        return (
          <button key={it.id} type="button" role="menuitem" aria-disabled={why ? true : undefined} title={why || undefined}
            className={`flex min-h-[34px] items-center justify-between gap-2 rounded-[8px] px-2.5 text-left text-[12.5px] ${why ? 'cursor-not-allowed text-axal-muted dark:text-gray-500' : 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
            onClick={() => { if (why) return; onClose(); onAction(it.id, index); }} data-testid={`pitch-editor-card-${it.id}-${index}`}>
            {it.label}{later ? <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default function CardsStrip({ cards, sel, stale, readOnly, onSelect, move, onAdd, onCardAction }) {
  const [drag, setDrag] = useState(null);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(null);
  const limit = all || sel >= SHOWN ? cards.length : Math.min(cards.length, SHOWN);
  const more = cards.length - limit;
  return (
    <nav className="flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-axal-hairline bg-white p-2 dark:border-gray-700 dark:bg-gray-900" aria-label="Cards" data-testid="pitch-editor-cards">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {cards.slice(0, limit).map((c, i) => (
          <li key={i} className="relative"
            draggable={!readOnly}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { if (drag != null) e.preventDefault(); }}
            onDrop={() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}>
            <button type="button"
              className={`flex w-full flex-col gap-1 rounded-[9px] border p-1.5 text-left text-[12px] ${i === sel ? 'border-axal-violet bg-axal-lavender font-bold text-axal-violet dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300' : 'border-transparent text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
              aria-current={i === sel ? 'true' : undefined}
              aria-keyshortcuts={readOnly ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (readOnly) return;
                const to = keyMove(e.key, i, cards.length);
                if (to != null && (e.altKey || e.metaKey)) { e.preventDefault(); move(i, to); }
              }}
              data-testid={`pitch-editor-rail-${i}`}>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1 truncate">{cardTitle(c, i)}</span>
                {stale.has(i) ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" title="A figure on this card has changed in its store" data-testid={`pitch-editor-stale-${i}`} /> : null}
              </span>
              <Thumb card={c} />
              {c?.appendix ? <span className="font-mono text-[10px] uppercase text-axal-muted dark:text-gray-400">Appendix</span> : null}
            </button>
            {!readOnly ? (
              <button type="button" aria-haspopup="menu" aria-expanded={menu === i} aria-label={`Card ${i + 1} menu`}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"
                onClick={() => setMenu((m) => (m === i ? null : i))} data-testid={`pitch-editor-card-menu-open-${i}`}>
                <MoreHorizontal size={13} aria-hidden="true" />
              </button>
            ) : null}
            {menu === i ? <CardMenu index={i} count={cards.length} card={c} onAction={onCardAction} onClose={() => setMenu(null)} /> : null}
          </li>
        ))}
      </ol>
      {more > 0 ? (
        <button type="button" className="min-h-[32px] rounded-[8px] text-[12px] font-bold text-axal-violet hover:bg-axal-ground dark:text-violet-300 dark:hover:bg-gray-800" onClick={() => setAll(true)} data-testid="pitch-editor-more-cards">
          + {more} more card{more === 1 ? '' : 's'}
        </button>
      ) : null}
      {!readOnly ? (
        <>
          <span className={`${MUTED} px-1 text-[11px]`}>Drag to reorder, or Alt + ↑ / ↓ on a card.</span>
          <button type="button" className={GHOST} onClick={onAdd} data-testid="pitch-editor-add-card"><Plus size={14} aria-hidden="true" /> Add card</button>
        </>
      ) : null}
    </nav>
  );
}
