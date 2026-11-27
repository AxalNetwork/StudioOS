import { useCallback, useEffect, useRef } from 'react';

/**
 * D1604 (#3716) — the keyboard a `role="menu"` promises, shared by the
 * editor's three menus: ⋯ (`DeckMoreMenu.jsx`), Share ▾ (`DeckToolbar.jsx`)
 * and a card's ⋯ (`CardsStrip.jsx`).
 *
 *   open        focus moves to the first menu item
 *   ↓ / ↑       the next or previous item, wrapping; Home and End the ends
 *   Escape      closes and puts the focus back on the button that opened it
 *   Tab out     focus leaving for an element outside the menu (and outside
 *               its button) closes it
 *   a press     outside the menu and its button closes it
 *
 * `box` is the menu (or the element that holds it and its button), `opener`
 * the button, and `item(i)` the ref for the i-th menu item. Nothing here
 * reads the network.
 */
export default function useMenuFocus(open, close) {
  const box = useRef(null);
  const opener = useRef(null);
  const items = useRef([]);
  const closeRef = useRef(close);
  closeRef.current = close;

  const inside = useCallback((node) => {
    if (!node) return false;
    const has = (ref) => Boolean(ref.current && typeof ref.current.contains === 'function' && ref.current.contains(node));
    return node === opener.current || has(box) || has(opener);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    items.current.find(Boolean)?.focus?.();
    const doc = globalThis.document;
    const away = (e) => { if (!inside(e.target)) closeRef.current?.(); };
    doc?.addEventListener?.('mousedown', away);
    return () => doc?.removeEventListener?.('mousedown', away);
  }, [open, inside]);

  const item = useCallback((i) => (node) => { items.current[i] = node; }, []);

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault?.();
      closeRef.current?.();
      opener.current?.focus?.();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const list = items.current.filter(Boolean);
    if (!list.length) return;
    e.preventDefault?.();
    const at = list.indexOf(globalThis.document?.activeElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? list.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % list.length
          : (at <= 0 ? list.length - 1 : at - 1);
    list[next]?.focus?.();
  };

  // Only a move to a known element outside closes it: a press on a button that
  // takes no focus (Safari) blurs to nothing, and the press handler decides.
  const onBlur = (e) => {
    if (!open) return;
    const to = e?.relatedTarget;
    if (to && !inside(to)) closeRef.current?.();
  };

  return { box, opener, item, onKeyDown, onBlur };
}
