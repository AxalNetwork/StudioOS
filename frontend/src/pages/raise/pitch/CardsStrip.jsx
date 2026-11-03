import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import VirtualList from '../../../components/VirtualList';
import { availability } from './deckV2Adapter';
import { LATER } from './deckV2Model';
import { cardTitle, keyMove } from './editorModel';
import useMenuFocus from './useMenuFocus';
import { langAttrs } from './deckLanguage';
import {
  ALL_CARDS, ANYONE, PILL_TONE, STATUSES, STATUS_SEGMENTS, UNASSIGNED,
  assigneeOfCard, countLine, filterCards, initials, isFiltered, isTracked, personName, statusLabel, statusOf,
} from './cardStatusModel';

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
 * version is saved; Comments opens the card's threads (pd33, D1570). D1545 (#3788): Hide (Show
 * on a hidden card) and Move to section are local edits too; a hidden card is
 * dimmed and tagged "Hidden" (Present, the share link, the PDF and every export
 * skip it), and a card in a section carries its name. A reader
 * reads the strip and moves nothing. The card menu keeps the keyboard a menu
 * promises (`useMenuFocus.js`).
 *
 * `orientation`: 'column' beside the stage (1024 px and up, the 150 px
 * strip), 'row' above it below that (pd9l): one scrolling row of 120 px
 * thumbnails with "+ N more" and Add card at its end, so the Grid stays the
 * centre on a tablet. In the row the card menu opens below its card, outside
 * the scrolling row so it is never clipped.
 *
 * D1579 (#3826, pd34, the STRIP): each card carries its status pill (Done
 * positive, In progress a violet outline, To do neutral) and its assignee's
 * avatar once the deck is tracked; above the cards, the filter card: the
 * segment All · To do · In progress · Done, "Assignee: anyone ▾" and
 * "[3] of [12] cards" (`cardStatusModel.filterCards`, the Worker's rule over
 * the cards on screen). The card menu leads with Set status › and Assign ›,
 * each opening its list in place, with Back. `people` is who a card can be
 * assigned to (D1570's rule), from `deckV2Adapter.cardStatus`; null until read.
 */

export const SHOWN = 8;

const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
/** D1545 (#3788): from this many cards on screen the column strip renders only the cards in view. */
export const VIRTUALIZE_AT = 24;
/** A column card's height in the virtual list: the thumbnail and title, plus its pill and tag lines. */
export const cardHeight = (card, tracked) => 122 + ((statusOf(card, tracked) || card?.assignee != null) ? 22 : 0)
  + ((card?.appendix || card?.hidden || card?.section) ? 16 : 0);

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
          }}>
          {/* D1545: an image block shows its picture, fetched only once the card scrolls into view. */}
          {b.kind === 'image' && b.image_url ? <img src={b.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full rounded-[2px] object-cover" data-testid="pitch-editor-thumb-image" /> : null}
        </span>
      ))}
      {!Array.isArray(card?.blocks) ? <span className="absolute inset-[12%] rounded-[2px] bg-axal-hairline dark:bg-gray-700" /> : null}
    </span>
  );
}

/** A card-menu item is "Coming later" only while its adapter surface answers unavailable. */
export function cardMenuItems(index, count, card, avail = availability, people = null) {
  const assignOff = !Array.isArray(people) ? 'Who can work on this deck could not be read.' : !people.length ? 'Nobody can be assigned on this deck yet.' : null;
  return [
    // D1579 (#3826, pd34): Set status › and Assign › lead the menu; each opens its list in place.
    { id: 'status', label: 'Set status ›', sub: true },
    { id: 'assign', label: 'Assign ›', sub: true, off: assignOff },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'up', label: 'Move up', off: index === 0 ? 'It is the first card.' : null },
    { id: 'down', label: 'Move down', off: index === count - 1 ? 'It is the last card.' : null },
    { id: 'appendix', label: card?.appendix ? 'Not an appendix' : 'Mark as appendix' },
    // D1545 (#3788): wired on main (`deckV2Adapter.media` is swapped); both are local edits held until a save.
    { id: 'hide', label: card?.hidden ? 'Show' : 'Hide' },
    { id: 'section', label: card?.section ? 'Change section' : 'Move to section' },
    // D1570 (#3817, pd33): wired on main (`deckV2Adapter.comments` is swapped), so it reads no adapter here.
    { id: 'comments', label: 'Comments' },
  ].map((it) => {
    const a = it.adapter ? avail(it.adapter) : null;
    const later = Boolean(it.adapter) && (!a || a.available !== true);
    return { ...it, later, why: (later ? a?.reason || 'Not switched on yet.' : null) || it.off || null };
  });
}

/** D1579: a submenu's items: the three statuses, or Unassigned and each person who can work on the deck. */
export function subMenuItems(sub, card, people, tracked) {
  if (sub === 'status') {
    const now = statusOf(card, tracked);
    return STATUSES.map((st) => ({ id: `status-${st.id}`, label: st.label, value: st.id, on: now === st.id }));
  }
  const who = Number(card?.assignee) || null;
  return [{ id: 'assign-none', label: 'Unassigned', value: null, on: who === null },
    ...(Array.isArray(people) ? people : []).map((p) => ({ id: `assign-${p.id}`, label: personName(p), value: Number(p.id), on: who === Number(p.id) }))];
}

function CardMenu({ index, count, card, onAction, onClose, menu, row = false, left = 0, people = null, tracked = false }) {
  const [sub, setSub] = useState(null);
  const first = useRef(null);
  useEffect(() => { if (sub) first.current?.focus?.(); }, [sub]);
  const items = sub ? null : cardMenuItems(index, count, card, availability, people);
  const subs = sub ? subMenuItems(sub, card, people, tracked) : null;
  const ITEM = 'flex min-h-[34px] items-center justify-between gap-2 rounded-[8px] px-2.5 text-start text-[12.5px]';
  const LIVE = 'text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div ref={menu.box} role="menu" aria-label={sub === 'status' ? `Card ${index + 1} status` : sub === 'assign' ? `Assign card ${index + 1}` : `Card ${index + 1}`} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur}
      className={`absolute z-30 flex w-[200px] flex-col rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900 ${row ? 'top-full mt-1' : 'left-full top-0 ml-1'}`}
      style={row ? { left } : undefined}
      data-testid={`pitch-editor-card-menu-${index}`}>
      {subs ? (
        <>
          {subs.map((it, i) => (
            <button key={it.id} ref={(n) => { menu.item(i)(n); if (i === 0) first.current = n; }} type="button" role="menuitemradio" aria-checked={it.on}
              className={`${ITEM} ${LIVE} ${it.on ? 'font-bold' : ''}`}
              onClick={() => { onClose(); onAction(sub, index, it.value); }} data-testid={`pitch-editor-card-${it.id}-${index}`}>
              {it.label}{it.on ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
          <button ref={menu.item(subs.length)} type="button" role="menuitem" className={`${ITEM} ${LIVE} border-t border-axal-hairline dark:border-gray-700`}
            onClick={() => setSub(null)} data-testid={`pitch-editor-card-back-${index}`}>‹ Back</button>
        </>
      ) : items.map((it, i) => (
        <button key={it.id} ref={menu.item(i)} type="button" role="menuitem" aria-haspopup={it.sub ? 'menu' : undefined} aria-disabled={it.why ? true : undefined} title={it.why || undefined}
          className={`${ITEM} ${it.why ? 'cursor-not-allowed text-axal-muted dark:text-gray-500' : LIVE}`}
          onClick={() => { if (it.why) return; if (it.sub) { setSub(it.id); return; } onClose(); onAction(it.id, index); }} data-testid={`pitch-editor-card-${it.id}-${index}`}>
          {it.label}{it.later ? <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** pd34's pill: Done positive, In progress a violet outline, To do neutral. */
export function StatusPill({ status, testId }) {
  if (!statusLabel(status)) return null;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-bold ${PILL_TONE[status]}`} data-status={status} data-testid={testId}>{statusLabel(status)}</span>;
}

/** The assignee's avatar: their initials, named in full on hover and to a screen reader. */
export function Avatar({ person, testId }) {
  if (!person) return null;
  const name = personName(person);
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-axal-lavender font-mono text-[9px] font-bold text-axal-violet dark:bg-violet-950/60 dark:text-violet-300"
      title={`Assigned to ${name}`} aria-label={`Assigned to ${name}`} role="img" data-testid={testId}>{initials(person.name)}</span>
  );
}

/** pd34's filter card: the status segment, "Assignee: anyone ▾" and "[3] of [12] cards". */
function FilterCard({ filter, onFilter, people, shown, total, row }) {
  return (
    <div className={`flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline p-1.5 dark:border-gray-700 ${row ? 'w-[200px] shrink-0' : ''}`} data-testid="pitch-editor-cards-filter">
      <div className="grid grid-cols-2 gap-0.5 rounded-[8px] bg-axal-ground p-0.5 dark:bg-gray-800" role="radiogroup" aria-label="Status">
        {STATUS_SEGMENTS.map((seg) => {
          const on = filter.status === seg.id;
          return (
            <button key={seg.id} type="button" role="radio" aria-checked={on} onClick={() => onFilter({ ...filter, status: seg.id })}
              className={`rounded-[6px] px-1 py-1 text-[10.5px] font-bold ${on ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}
              data-testid={`pitch-editor-cards-filter-${seg.id}`}>{seg.label}</button>
          );
        })}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-axal-muted dark:text-gray-400">
        <span>Assignee:</span>
        <select className="min-w-0 flex-1 rounded-[6px] border border-axal-hairline bg-white px-1 py-0.5 text-[11px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          value={String(filter.assignee)} onChange={(e) => onFilter({ ...filter, assignee: e.target.value === ANYONE || e.target.value === UNASSIGNED ? e.target.value : Number(e.target.value) })}
          data-testid="pitch-editor-cards-filter-assignee">
          <option value={ANYONE}>anyone</option>
          <option value={UNASSIGNED}>unassigned</option>
          {(Array.isArray(people) ? people : []).map((p) => <option key={p.id} value={String(p.id)}>{personName(p)}</option>)}
        </select>
      </label>
      <span className="font-mono text-[10.5px] text-axal-muted dark:text-gray-400" role="status" data-testid="pitch-editor-cards-filter-count">{countLine(shown, total)}</span>
    </div>
  );
}

export default function CardsStrip({ cards, sel, stale, readOnly, onSelect, move, onAdd, onCardAction, orientation = 'column', theme = null, people = null }) {
  // D1571 (#3818): each card's title is the deck's words, so its thumbnail carries the deck's language and direction.
  const words = langAttrs(theme);
  const [drag, setDrag] = useState(null);
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(null);
  // D1579: the filter, and which cards it lets through (each keeps its place on the deck).
  const [filter, setFilter] = useState(ALL_CARDS);
  const tracked = isTracked(cards);
  const showFilter = tracked || cards.some((c) => c?.assignee != null) || isFiltered(filter);
  const visible = filterCards(cards, showFilter ? filter : ALL_CARDS);
  const focus = useMenuFocus(menu != null, () => setMenu(null));
  const row = orientation === 'row';
  const list = useRef(null);
  const slots = useRef(new Map());
  const selAt = visible.findIndex((v) => v.index === sel);
  const limit = all || selAt >= SHOWN ? visible.length : Math.min(visible.length, SHOWN);
  const more = visible.length - limit;
  // In the row the menu sits under its card, measured against the row's scroll.
  const menuLeft = () => {
    const li = slots.current.get(menu);
    const x = (Number(li?.offsetLeft) || 0) - (Number(list.current?.scrollLeft) || 0);
    return Math.max(0, x);
  };
  const cardMenu = (i, c) => (
    <CardMenu key={i} index={i} count={cards.length} card={c} onAction={onCardAction} onClose={() => setMenu(null)} menu={focus}
      row={row} left={row ? menuLeft() : 0} people={people} tracked={tracked} />
  );
  const shown = visible.slice(0, limit);
  // D1545 (#3788): the column strip virtualises past VIRTUALIZE_AT cards; the row stays one scrolling row.
  const virtual = !row && shown.length >= VIRTUALIZE_AT;
  const Tag = virtual ? 'div' : 'li';
  const renderCard = ({ card: c, index: i }, at = null) => (
      // D1500: keyed on the card's uid, so React keeps each card's own row through a reorder.
      <Tag key={c?.uid ?? `card-${i}`} className={`relative ${row ? 'w-[120px] shrink-0' : ''} ${virtual ? 'pb-1.5' : ''}`} style={at?.style} {...(at?.aria || {})}
        data-hidden={c?.hidden ? 'true' : undefined}
        ref={(n) => { if (n) slots.current.set(i, n); else slots.current.delete(i); }}
        draggable={!readOnly}
        onDragStart={() => setDrag(i)}
        onDragOver={(e) => { if (drag != null) e.preventDefault(); }}
        onDrop={() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}>
        <button type="button"
          className={`flex w-full flex-col gap-1 rounded-[9px] border p-1.5 text-start text-[12px] ${i === sel ? 'border-axal-violet bg-axal-lavender font-bold text-axal-violet dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300' : 'border-transparent text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800'}`}
          aria-current={i === sel ? 'true' : undefined}
          lang={words.lang} dir={words.dir}
          aria-keyshortcuts={readOnly ? undefined : row ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : 'Alt+ArrowUp Alt+ArrowDown'}
          onClick={() => onSelect(i)}
          onKeyDown={(e) => {
            if (readOnly) return;
            const key = row ? ({ ArrowLeft: 'ArrowUp', ArrowRight: 'ArrowDown' })[e.key] || e.key : e.key;
            const to = keyMove(key, i, cards.length);
            if (to != null && (e.altKey || e.metaKey)) { e.preventDefault(); move(i, to); }
          }}
          data-testid={`pitch-editor-rail-${i}`}>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span>
            <span className="min-w-0 flex-1 truncate">{cardTitle(c, i)}</span>
            {stale.has(i) ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" title="A figure on this card has changed in its store" data-testid={`pitch-editor-stale-${i}`} /> : null}
          </span>
          <span className={c?.hidden ? 'opacity-50' : undefined}><Thumb card={c} /></span>
          {/* D1579 (pd34): the status pill and the assignee's avatar, once the deck is tracked or the card assigned. */}
          {statusOf(c, tracked) || c?.assignee != null ? (
            <span className="flex items-center justify-between gap-1">
              <StatusPill status={statusOf(c, tracked)} testId={`pitch-editor-card-pill-${i}`} />
              <Avatar person={assigneeOfCard(c, people)} testId={`pitch-editor-card-avatar-${i}`} />
            </span>
          ) : null}
          {c?.appendix || c?.hidden || c?.section ? (
            <span className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[10px] uppercase text-axal-muted dark:text-gray-400">
              {c?.appendix ? <span>Appendix</span> : null}
              {c?.hidden ? <span data-testid={`pitch-editor-card-hidden-${i}`}>Hidden</span> : null}
              {c?.section ? <span className="min-w-0 truncate normal-case" title={`Section: ${c.section}`} data-testid={`pitch-editor-card-section-${i}`}>{c.section}</span> : null}
            </span>
          ) : null}
        </button>
        {!readOnly ? (
          <button type="button" ref={menu === i ? focus.opener : undefined} aria-haspopup="menu" aria-expanded={menu === i} aria-label={`Card ${i + 1} menu`}
            className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"
            onClick={() => setMenu((m) => (m === i ? null : i))} data-testid={`pitch-editor-card-menu-open-${i}`}>
            <MoreHorizontal size={13} aria-hidden="true" />
          </button>
        ) : null}
        {menu === i && !row && !virtual ? cardMenu(i, c) : null}
      </Tag>
  );
  return (
    <nav className={`relative flex min-w-0 gap-1.5 rounded-[12px] border border-axal-hairline bg-white p-2 dark:border-gray-700 dark:bg-gray-900 ${row ? 'flex-row items-center' : 'flex-col'}`}
      aria-label="Cards" data-orientation={orientation} data-testid="pitch-editor-cards">
      {showFilter ? <FilterCard filter={filter} onFilter={setFilter} people={people} shown={visible.length} total={cards.length} row={row} /> : null}
      {virtual ? (
        <VirtualList items={shown} threshold={0} height={Math.min(720, shown.reduce((h, v) => h + cardHeight(v.card, tracked) + 6, 0))}
          itemHeight={(n) => cardHeight(shown[n]?.card, tracked) + 6} ariaLabel="Cards" className="min-w-0" testId="pitch-editor-cards-list"
          virtualRow={(v, n, style, aria) => renderCard(v, { style, aria })}>
          {() => null}
        </VirtualList>
      ) : (
        <ol ref={list} className={`m-0 flex min-w-0 list-none gap-1.5 p-0 ${row ? 'flex-1 flex-row overflow-x-auto' : 'flex-col'}`} data-testid="pitch-editor-cards-list">
          {shown.map((v) => renderCard(v))}
        </ol>
      )}
      {(row || virtual) && menu != null && cards[menu] ? cardMenu(menu, cards[menu]) : null}
      {more > 0 ? (
        <button type="button" className={`min-h-[32px] rounded-[8px] text-[12px] font-bold text-axal-violet hover:bg-axal-ground dark:text-violet-300 dark:hover:bg-gray-800 ${row ? 'shrink-0 px-2' : ''}`} onClick={() => setAll(true)} data-testid="pitch-editor-more-cards">
          + {more} more card{more === 1 ? '' : 's'}
        </button>
      ) : null}
      {!readOnly ? (
        <>
          <span className={`${MUTED} px-1 text-[11px] ${row ? 'w-[120px] shrink-0' : ''}`}>{row ? 'Drag to reorder, or Alt + ← / → on a card.' : 'Drag to reorder, or Alt + ↑ / ↓ on a card.'}</span>
          <button type="button" className={`${GHOST} ${row ? 'shrink-0' : ''}`} onClick={onAdd} data-testid="pitch-editor-add-card"><Plus size={14} aria-hidden="true" /> Add card</button>
        </>
      ) : null}
    </nav>
  );
}
